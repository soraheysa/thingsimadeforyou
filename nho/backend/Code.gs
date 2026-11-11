/**
 * Nhớ — backend (Google Apps Script web app) for the "Anh nhớ em / Em nhớ anh" button in Our Story.
 *
 * Its own Apps Script project, like Lăng kính. It never sees the access code: every request carries
 * the email + token the pages already hold, and this script asks the Hai nửa backend ("whoami")
 * whether they are valid. Nothing changes in the Hai nửa code.
 *
 * What it does
 *  - counts every tap, by day and by night (night = the other person was asleep, see NH.SLEEP),
 *  - sends a phone notification through Firebase Cloud Messaging, except while the other person sleeps,
 *  - follows each person's timezone from their phone, with a fallback switch to Vietnam time
 *    at Thư's landing time (Script property RIGHT_ARRIVES_AT).
 *  - "Về nhà" (shared/venha.js): Thư's landing time and flight for the countdown, the letters in tab NH_Letters
 *    (remembers when Thư first saw each), the reminders in tab NH_Reminders, and flight tracking in tab NH_Flight:
 *    it reads the ticket Thư sends on the Quà Giáng sinh page, asks AeroDataBox for the flight status
 *    (weekly → daily in the last week → hourly on departure day → every 15 min in the last 6 h) and pushes
 *    the changes to Luân. All of it runs from veNhaTick, every 5 minutes.
 *
 * Setup (once)
 *  1. script.google.com → New project → name it "Our Story – Nhớ" → paste this file as Code.gs.
 *  2. Project Settings → Script properties → add
 *       AUTH_API_URL        = the Hai nửa web app URL (…/exec), same as AUTH_API_URL in shared/config.js
 *       FCM_SERVICE_ACCOUNT = the whole JSON file from Firebase → Project settings → Service accounts →
 *                             "Generate new private key" (open the file, copy everything, paste)
 *       RIGHT_ARRIVES_AT    = Thư's landing time in Vietnam, e.g. 2026-12-20T14:30:00+07:00 (optional)
 *  3. Pick the function "setup" in the toolbar → Run → allow access. It creates the sheet "Our Story – Nhớ".
 *  4. Pick "checkPush" → Run. The log should say "FCM OK".
 *  5. Deploy → New deployment → Web app → Execute as: Me, Who has access: Anyone → Deploy.
 *  6. Copy the URL (…/exec) into NHO.API_URL in shared/config.js.
 *  7. "Về nhà" (countdown, letters, reminders, flight), once:
 *       - Script property RIGHT_ARRIVES_AT = 2027-01-15T07:00:00+07:00 (same as RETURN_AT in shared/config.js);
 *         the plan until Thư sends her ticket
 *       - Script property AERODATABOX_KEY = your RapidAPI key (rapidapi.com → AeroDataBox → Subscribe, free plan)
 *       - Run "setup" again: it adds the tabs NH_Letters, NH_Reminders and NH_Flight with placeholder text.
 *       - Run "setupVeNha": it starts the 5-minute check and logs the plan. "showPlan" logs it again any time.
 *       - When you see her ticket: put the first flight (from Germany) in NH_Flight, leg 1: flight and date.
 *         The last flight (into Vietnam) fills itself from the ticket.
 * Later code changes: Deploy → Manage deployments → edit (pencil) → Version: New version (same URL).
 * Script properties take effect at once, no new deployment needed.
 */

const NH = {
  NAMES: { left: 'Luân', right: 'Thư' },
  PRONOUN: { left: 'anh', right: 'em' },
  EMOJI: { left: '🩷', right: '🧡' },

  // No notification between these local times ("night"). Taps still count, on the night counter.
  // By side, then by timezone; '*' covers any other timezone.
  SLEEP: {
    left: { '*': ['00:00', '05:00'] },
    right: {
      'Europe/Berlin': ['01:00', '07:00'],
      'Asia/Ho_Chi_Minh': ['01:00', '09:00'],   // in Vietnam she sleeps ~01–02 to ~08–09: the wider window
      '*': ['01:00', '09:00'],
    },
  },

  // Before a phone has reported its timezone.
  DEFAULT_TZ: { left: 'Asia/Ho_Chi_Minh', right: 'Europe/Berlin' },
  // Where Thư's landing switches her to.
  ARRIVAL_TZ: 'Asia/Ho_Chi_Minh',

  MIN_GAP_MS: 3000,          // one tap every 3 s per person, so a double tap doesn't send twice
  TTL_MAX_S: 4 * 3600,       // a notification for a phone that is offline waits at most 4 h (and never into sleep time)

  SHEETS: {
    NH_Misses: ['id', 'from', 'to', 'at', 'fromDay', 'toDay', 'night', 'toTz', 'pushed'],
    NH_Tokens: ['token', 'side', 'device', 'createdAt', 'updatedAt', 'removed'],
    NH_People: ['side', 'name', 'tz', 'tzChangedAt'],
    // The notification's second line. Edit freely in the sheet; changes apply from the next heart.
    //  kind: nhắc (a little reminder) or quote (fun fact, quote, proverb)
    //  to:   both, Thư or Luân (who receives it; "right"/"left" work too)
    //  when: sáng, trưa, chiều or tối in the receiver's own time; empty = any time
    //  text: {you} = the receiver (em/anh), {me} = the sender; the first letter is capitalised for you
    NH_Lines: ['kind', 'to', 'when', 'text'],
    // Letters for "Những bức Thư anh gửi đến em" (thu-gui-em/ and the welcome screen). Edit freely in the sheet.
    //  id:      a short unique name, e.g. ve-nha
    //  title, text: the letter; line breaks in the cell are kept
    //  opensAt: when Thư can see it, e.g. 2027-01-15T07:00:00+07:00; "landing" = when she lands (follows the flight); empty = now
    //  popup:   TRUE = opens by itself the first time Thư uses the app after opensAt (only once)
    //  seenAt:  filled in when Thư first sees it; clear it to show the popup to her again
    NH_Letters: ['id', 'title', 'text', 'opensAt', 'popup', 'seenAt'],
    // Countdown reminders, sent by veNhaTick. One row per reminder and person; edit title and body freely.
    //  id: 1-thang (one month before), 1-tuan (one week before): at REMINDERS.AT in that person's own time
    //      24-gio: exactly 24 hours before the scheduled landing, to both at once
    //      di-san-bay: Thư, TRAVEL.NOTICE_MIN before she should leave home for the train to the airport
    //      any other id: needs "at"
    //  to: Luân or Thư.
    //  at: optional exact time, e.g. 2027-01-13T18:30:00+01:00. On di-san-bay it is when she leaves home
    //      (put her real train time here once she books it); empty = worked out from the flight (see TRAVEL).
    //  title, body: {leave} = leave-home time, {dep} = first flight's departure, {flight} = first flight (German time)
    //  sentAt: filled in when sent; clear it to send again. Reminders ignore sleep times.
    NH_Reminders: ['id', 'to', 'title', 'body', 'at', 'sentAt'],
    // Thư's flights home, one row per leg. Leg 2 (into Vietnam) fills itself from her ticket; leg 1 is yours to fill.
    //  leg: 1, 2…   flight: e.g. QR70   date: departure date at that airport, e.g. 2027-01-14
    //  source: "vé" = from her ticket (kept in step with it); anything else = yours, never overwritten
    //  the rest is written by the flight check; times are UTC. note: what the check last said.
    NH_Flight: ['leg', 'flight', 'date', 'from', 'to', 'source', 'status',
      'depScheduled', 'depEstimated', 'depActual', 'arrScheduled', 'arrEstimated', 'arrActual',
      'fromTz', 'toTz', 'checkedAt', 'note'],
  },

  FLIGHT: {
    // The Quà Giáng sinh backend (same URL as API_URL in qua-giang-sinh/index.html); Script property XMAS_API_URL overrides it.
    XMAS_API_URL: 'https://script.google.com/macros/s/AKfycbxiNKLgQZETm-182B8dccnqoIPfR1bTABICoKA0MJ0pipJptqil4aTeEKU3Tqp1ek46/exec',
    TICKET_SYNC_MIN: 30,        // how often to look for a new or changed ticket
    MAX_CALLS_PER_MONTH: 250,   // safety cap on AeroDataBox calls (free plan: 600 units a month)
    DELAY_NOTIFY_MIN: 15,       // tell Luân when the landing estimate moves by this much
    GUESS_TRIP_H: 16,           // before leg 1 is known: assume she leaves Frankfurt this long before landing (QR70 + QR974)
    AIRPORTS: { FRA: 'Frankfurt', HAM: 'Hamburg', DOH: 'Doha', SGN: 'Tân Sơn Nhất', HAN: 'Nội Bài', DAD: 'Đà Nẵng' },
    AIRPORT_TZ: { FRA: 'Europe/Berlin', HAM: 'Europe/Berlin', DOH: 'Asia/Qatar', SGN: 'Asia/Ho_Chi_Minh', HAN: 'Asia/Ho_Chi_Minh', DAD: 'Asia/Ho_Chi_Minh' },
  },

  // Thư's trip to the airport, for the di-san-bay reminder.
  TRAVEL: {
    TZ: 'Europe/Berlin',
    AIRPORT_BEFORE_MIN: 180,    // at the airport 3 h before an international flight
    HOME_TO_AIRPORT_MIN: 300,   // Pinneberg → Hamburg Hbf → ICE → Frankfurt Flughafen, with a margin (~4 h 45 by train)
    EARLIEST_LEAVE: '04:30',    // no useful trains before this…
    LATEST_LEAVE: '22:00',      // …or after this: a leave time in between moves to 22:00 the evening before
    NOTICE_MIN: 45,             // the reminder comes this long before she should leave
  },

  REMINDERS: {
    AT: '08:00',        // local time for 1-thang and 1-tuan
    WINDOW_H: 3,        // if the phone or Google was down, keep trying this long after the due time
    // Written into NH_Reminders by "setup" when that tab is empty. After that, the sheet is what counts.
    DEFAULTS: [
      { id: '1-thang', to: 'Luân', title: 'Còn 1 tháng nữa 🧡', body: 'Còn đúng một tháng nữa là Thư về rồi.' },
      { id: '1-thang', to: 'Thư', title: 'Còn 1 tháng nữa 🧡', body: 'Còn đúng một tháng nữa là em về nhà rồi.' },
      { id: '1-tuan', to: 'Luân', title: 'Còn 1 tuần nữa 🧡', body: 'Một tuần nữa thôi là Thư về.' },
      { id: '1-tuan', to: 'Thư', title: 'Còn 1 tuần nữa 🧡', body: 'Một tuần nữa thôi là em về nhà.' },
      { id: '24-gio', to: 'Luân', title: 'Còn 24 giờ nữa 🧡', body: 'Giờ này ngày mai Thư hạ cánh rồi.' },
      { id: '24-gio', to: 'Thư', title: 'Còn 24 giờ nữa 🧡', body: 'Giờ này ngày mai em hạ cánh rồi. Đi đường bình an nhé.' },
      { id: 'di-san-bay', to: 'Thư', title: 'Sắp tới giờ ra ga rồi em ơi 🚆',
        body: 'Em rời nhà lúc {leave} nhé, cho kịp chuyến {flight} lúc {dep}. Nhớ hộ chiếu, vé và sạc điện thoại.' },
    ],
  },
  // Written into NH_Letters by "setup" when that tab is empty.
  LETTER_DEFAULTS: [
    { id: 've-nha', title: 'Chào mừng em về nhà', text: '(Lá thư chào em về nhà. Anh sẽ viết nội dung thật vào ô này.)',
      opensAt: 'landing', popup: 'TRUE', seenAt: '' },
  ],

  QUOTE_SHARE: 0.25,   // about 1 heart in 4 carries a quote instead of a reminder
};

/* ───────────────────────── Setup ───────────────────────── */

function setup() {
  const p = PropertiesService.getScriptProperties();
  let ss;
  if (p.getProperty('SHEET_ID')) {
    ss = SpreadsheetApp.openById(p.getProperty('SHEET_ID'));
  } else {
    ss = SpreadsheetApp.create('Our Story – Nhớ');
    p.setProperty('SHEET_ID', ss.getId());
  }
  Object.keys(NH.SHEETS).forEach(name => {
    const head = NH.SHEETS[name];
    const sh = ss.getSheetByName(name) || ss.insertSheet(name);
    sh.getRange(1, 1, sh.getMaxRows(), Math.max(head.length, sh.getMaxColumns())).setNumberFormat('@');
    sh.getRange(1, 1, 1, head.length).setValues([head]).setFontWeight('bold');
    sh.setFrozenRows(1);
  });
  ss.getSheets().forEach(sh => { if (!NH.SHEETS[sh.getName()] && ss.getSheets().length > 1) ss.deleteSheet(sh); });
  SS_ = ss;
  if (!rows_('NH_Letters').length) NH.LETTER_DEFAULTS.forEach(r => append_('NH_Letters', r));
  if (!rows_('NH_Reminders').length) NH.REMINDERS.DEFAULTS.forEach(r => append_('NH_Reminders', r));
  if (!rows_('NH_Flight').length) {
    append_('NH_Flight', { leg: 1, note: 'Chuyến từ Đức. Điền flight + date khi thấy vé. Dự đoán: QR70, 09:15 Frankfurt → 17:15 Doha, 2027-01-14.' });
    append_('NH_Flight', { leg: 2, note: 'Chuyến về Việt Nam: tự điền từ vé Thư gửi ở trang Quà Giáng sinh.' });
  }
  ss.getSheetByName('NH_Letters').setColumnWidth(3, 520);
  Logger.log('Xong. Bảng dữ liệu: ' + ss.getUrl());
}

/** Run from the editor: checks the Firebase key and shows each person's timezone and sleep state. */
function checkPush() {
  fcmAccess_();
  Logger.log('FCM OK, project ' + serviceAccount_().project_id);
  const people = people_();
  ['left', 'right'].forEach(side => {
    const tz = tzOf_(side, people);
    Logger.log(`${NH.NAMES[side]}: ${tz}, ${Utilities.formatDate(new Date(), tz, 'HH:mm')} → ` +
      (asleep_(side, tz, new Date()) ? 'đang ngủ (không gửi thông báo)' : 'đang thức') +
      `, ${activeTokens_(side).length} thiết bị bật thông báo`);
  });
}

/* ───────────────────────── Web app ───────────────────────── */

function doGet() {
  return out_({ ok: true, app: 'nho' });
}

function doPost(e) {
  let req;
  try { req = JSON.parse(e.postData.contents); } catch (x) { return out_({ ok: false, error: 'bad_request' }); }
  try {
    const me = whoami_(req);
    if (!me) return out_({ ok: false, error: 'auth' });
    const fn = ACTIONS[req.action];
    if (!fn) return out_({ ok: false, error: 'bad_request', message: 'Yêu cầu không hợp lệ.' });
    rememberTz_(me, req.tz);
    return out_(fn(req, me));
  } catch (err) {
    console.error(err && err.stack || err);
    return out_({ ok: false, error: 'server', message: 'Máy chủ đang bận. Thử lại sau chút nữa nhé.' });
  }
}

const ACTIONS = {

  /** Counters and both people's sleep state. */
  nhoState(req, me) {
    return { ok: true, state: state_(me) };
  },

  /** One tap on the heart. */
  nhoSend(req, me) {
    const to = other_(me.side);
    const now = new Date();
    const people = people_();
    const toTz = tzOf_(to, people);
    const night = asleep_(to, toTz, now);
    const toDay = day_(now, toTz);

    const row = withLock_(() => {
      const mine = rows_('NH_Misses').filter(r => r.from === me.side);
      const last = mine.length ? Date.parse(mine[mine.length - 1].at) : 0;
      if (now.getTime() - last < NH.MIN_GAP_MS) return null;
      const r = {
        id: 'nh_' + Utilities.getUuid().replace(/-/g, '').slice(0, 10),
        from: me.side, to, at: now.toISOString(),
        fromDay: day_(now, tzOf_(me.side, people)), toDay,
        night: night ? 'TRUE' : 'FALSE', toTz, pushed: '0',
      };
      append_('NH_Misses', r);
      r._row = sheet_('NH_Misses').getLastRow();
      return r;
    });
    if (!row) return { ok: false, error: 'too_fast', message: 'Chậm lại một chút, tim đang bay tới rồi.' };

    let pushed = 0;
    if (!night) {
      const n = rows_('NH_Misses').filter(r => r.to === to && r.toDay === toDay).length;
      pushed = push_(to, {
        title: `${cap_(NH.PRONOUN[me.side])} nhớ ${NH.PRONOUN[to]} ${NH.EMOJI[me.side]}` + (n > 1 ? ` ×${n}` : ''),
        body: pickLine_(me.side, to, toTz, now),
        tag: 'nho',
      }, Math.min(NH.TTL_MAX_S, secondsUntilSleep_(to, toTz, now)));
      if (pushed) withLock_(() => update_('NH_Misses', row._row, { pushed }));
    }
    return { ok: true, silenced: night, pushed, state: state_(me) };
  },

  /** Save this device's notification address (FCM token). */
  pushSave(req, me) {
    // req.token is the sign-in token; the device's FCM token comes as pushToken.
    const token = String(req.pushToken || '').trim();
    if (!/^[\w:.-]{20,4096}$/.test(token)) return bad_('Thiếu mã thông báo của thiết bị.');
    const device = clean_(req.device, 120);
    const now = new Date().toISOString();
    withLock_(() => {
      const hit = rows_('NH_Tokens').find(r => r.token === token);
      if (hit) update_('NH_Tokens', hit._row, { side: me.side, device, updatedAt: now, removed: 'FALSE' });
      else append_('NH_Tokens', { token, side: me.side, device, createdAt: now, updatedAt: now, removed: 'FALSE' });
    });
    return { ok: true, state: state_(me) };
  },

  /** Stop notifications on this device. */
  pushRemove(req, me) {
    const token = String(req.pushToken || '').trim();
    withLock_(() => {
      rows_('NH_Tokens').filter(r => r.token === token && r.side === me.side)
        .forEach(r => update_('NH_Tokens', r._row, { removed: 'TRUE', updatedAt: new Date().toISOString() }));
    });
    return { ok: true, state: state_(me) };
  },

  /** "Về nhà" letters: Thư gets the ones already open, Luân gets all of them. popup = the one to open by itself for Thư. */
  letters(req, me) {
    const all = rows_('NH_Letters').filter(r => r.id.trim() && (r.title.trim() || r.text.trim())).map(letterOut_);
    const list = me.side === 'left' ? all : all.filter(l => !l.locked);
    const popup = me.side === 'right' ? (list.find(l => l.popup && !l.seenAt) || null) : null;
    return { ok: true, letters: list, popup };
  },

  /** The countdown banner: landing time (follows the flight) and the flight's legs and status. */
  veNha(req, me) {
    return Object.assign({ ok: true }, veNhaOut_());
  },

  /** Thư saw a letter (only her own views count; Luân's previews never do). */
  letterSeen(req, me) {
    if (me.side !== 'right') return { ok: true };
    const id = String(req.id || '').trim();
    withLock_(() => {
      const r = rows_('NH_Letters').find(x => x.id.trim() === id);
      if (r && !r.seenAt.trim() && !letterOut_(r).locked) update_('NH_Letters', r._row, { seenAt: new Date().toISOString() });
    });
    return { ok: true };
  },

  /** A test notification to the caller's own devices (ignores sleep time). */
  pushTest(req, me) {
    const n = push_(me.side, { title: 'Thử thông báo 🔔', body: 'Máy này đã nhận được thông báo của Our Story.', tag: 'nho-test' }, 600);
    return n ? { ok: true, pushed: n } : { ok: false, error: 'no_push', message: 'Chưa gửi được. Bật thông báo trên máy này trước nhé.' };
  },
};

/* ───────────────────────── State ───────────────────────── */

function state_(me) {
  const now = new Date();
  const people = people_();
  const sides = ['left', 'right'];
  const tz = {}, today = {};
  sides.forEach(s => { tz[s] = tzOf_(s, people); today[s] = day_(now, tz[s]); });
  const myDay = today[me.side];

  // Counts per sender. "Today" is always the viewer's calendar day.
  const counts = {};
  sides.forEach(s => { counts[s] = { day: 0, night: 0, total: 0, lastAt: '' }; });
  rows_('NH_Misses').forEach(r => {
    const c = counts[r.from];
    if (!c) return;
    c.total++;
    c.lastAt = r.at;
    const day = r.to === me.side ? r.toDay : r.fromDay;
    if (day === myDay) c[r.night === 'TRUE' ? 'night' : 'day']++;
  });

  const tokens = rows_('NH_Tokens').filter(r => r.removed !== 'TRUE');
  const person = s => ({
    side: s,
    name: (people[s] && people[s].name) || NH.NAMES[s],
    pronoun: NH.PRONOUN[s],
    tz: tz[s],
    localTime: Utilities.formatDate(now, tz[s], 'HH:mm'),
    asleep: asleep_(s, tz[s], now),
    sleep: sleepWindow_(s, tz[s]).join('–'),
    pushOn: tokens.some(t => t.side === s),
    sent: counts[s],
  });
  return {
    me: person(me.side),
    other: person(other_(me.side)),
    dayKey: myDay,
    pushReady: !!PropertiesService.getScriptProperties().getProperty('FCM_SERVICE_ACCOUNT'),
  };
}

/* ───────────────────────── Time & sleep ───────────────────────── */

const TZ_ALIAS = { 'Asia/Saigon': 'Asia/Ho_Chi_Minh' };
function normTz_(tz) {
  tz = String(tz || '').trim();
  tz = TZ_ALIAS[tz] || tz;
  return /^[A-Za-z]+(\/[A-Za-z0-9_+-]+){1,2}$/.test(tz) ? tz : '';
}

/** Store the timezone the phone reports. Only a change is written, with the moment it changed. */
function rememberTz_(me, rawTz) {
  const tz = normTz_(rawTz);
  withLock_(() => {
    const row = rows_('NH_People').find(r => r.side === me.side);
    if (!row) {
      append_('NH_People', { side: me.side, name: me.name, tz, tzChangedAt: tz ? new Date().toISOString() : '' });
      return;
    }
    const patch = {};
    if (me.name && row.name !== me.name) patch.name = me.name;
    if (tz && row.tz !== tz) { patch.tz = tz; patch.tzChangedAt = new Date().toISOString(); }
    if (Object.keys(patch).length) update_('NH_People', row._row, patch);
  });
}

function people_() {
  const out = {};
  rows_('NH_People').forEach(r => { out[r.side] = r; });
  return out;
}

/**
 * The timezone to use for one person.
 * Thư: from her landing (arrivesAt_) on, Vietnam time, unless her phone reported a new timezone after landing
 * (then the phone wins, so a delayed flight or a later trip still comes out right).
 */
function tzOf_(side, people) {
  const p = people[side] || {};
  let tz = normTz_(p.tz) || NH.DEFAULT_TZ[side];
  if (side === 'right') {
    const a = arrivesAt_();
    const arrives = a ? a.getTime() : NaN;
    const changed = Date.parse(p.tzChangedAt || '');
    if (!isNaN(arrives) && Date.now() >= arrives && !(changed >= arrives)) tz = NH.ARRIVAL_TZ;
  }
  return tz;
}

function sleepWindow_(side, tz) {
  const s = NH.SLEEP[side] || {};
  return s[tz] || s['*'] || ['00:00', '00:00'];
}

const mins_ = hhmm => { const [h, m] = String(hhmm).split(':').map(Number); return h * 60 + (m || 0); };
function localMins_(date, tz) {
  const [h, m] = Utilities.formatDate(date, tz, 'HH:mm').split(':').map(Number);
  return h * 60 + m;
}

function asleep_(side, tz, date) {
  const [a, b] = sleepWindow_(side, tz).map(mins_);
  const m = localMins_(date, tz);
  if (a === b) return false;
  return a < b ? (m >= a && m < b) : (m >= a || m < b);
}

/** Seconds until this person's sleep starts (so an offline phone never buzzes inside it). */
function secondsUntilSleep_(side, tz, date) {
  const a = mins_(sleepWindow_(side, tz)[0]);
  const diff = (a - localMins_(date, tz) + 1440) % 1440;
  return Math.max(60, diff * 60 - date.getSeconds());
}

function day_(date, tz) { return Utilities.formatDate(date, tz, 'yyyy-MM-dd'); }

/* ───────────────────────── Lines for the notification ───────────────────────── */

const WHEN_ = { 'sáng': [5, 11], 'trưa': [11, 14], 'chiều': [14, 18], 'tối': [18, 29] };   // 29 = 05:00 next day
const SIDE_ALIAS_ = { both: 'both', '': 'both', left: 'left', right: 'right', 'luân': 'left', 'luan': 'left', 'thư': 'right', 'thu': 'right' };

/** The NH_Lines tab. Created empty (headers only) if missing; the lines themselves are yours to add in the sheet. */
function linesSheet_() {
  let sh = sheet_('NH_Lines');
  if (sh) return sh;
  sh = SS_.insertSheet('NH_Lines');
  const head = NH.SHEETS.NH_Lines;
  sh.getRange(1, 1, sh.getMaxRows(), head.length).setNumberFormat('@');
  sh.getRange(1, 1, 1, head.length).setValues([head]).setFontWeight('bold');
  sh.setFrozenRows(1);
  sh.setColumnWidth(4, 520);
  return sh;
}

/** A random line for the notification body: mostly reminders, sometimes a quote; never the same one twice in a row. */
function pickLine_(from, to, toTz, date) {
  try {
    linesSheet_();
    const hour = Number(Utilities.formatDate(date, toTz, 'HH'));
    const fits = w => {
      const range = WHEN_[String(w || '').trim().toLowerCase()];
      if (!range) return true;
      const h = hour < 5 ? hour + 24 : hour;
      return h >= range[0] && h < range[1];
    };
    const all = rows_('NH_Lines').filter(r => r.text.trim()
      && [to, 'both'].indexOf(SIDE_ALIAS_[String(r.to || '').trim().toLowerCase()] || 'both') >= 0
      && fits(r.when));
    const props = PropertiesService.getScriptProperties();
    const last = props.getProperty('LAST_LINE_' + to) || '';
    const isQuote = r => /^quote/i.test(String(r.kind || '').trim());
    const pool = kind => all.filter(r => isQuote(r) === kind && r.text !== last);
    let list = pool(Math.random() < NH.QUOTE_SHARE);
    if (!list.length) list = pool(true).concat(pool(false));
    if (!list.length) return 'Chạm để mở Our Story';
    const text = list[Math.floor(Math.random() * list.length)].text.trim();
    props.setProperty('LAST_LINE_' + to, text);
    const out = text
      .replace(/\{you\}/gi, NH.PRONOUN[to])
      .replace(/\{me\}/gi, NH.PRONOUN[from]);
    return cap_(out);
  } catch (err) {
    console.warn(err);
    return 'Chạm để mở Our Story';
  }
}

/* ───────────────────────── Về nhà: landing time, flight, letters, reminders ───────────────────────── */
/*
 * Where Thư's landing time comes from, best first:
 *   1. the flight being tracked (tab NH_Flight, last leg): actual landing, else the airline's estimate
 *   2. the scheduled landing in NH_Flight, filled from the ticket she sends on the Quà Giáng sinh page
 *   3. Script property RIGHT_ARRIVES_AT (the plan before any ticket)
 */

let FLIGHT_MEMO_ = null;
/** The NH_Flight rows that have a flight number, by leg order. */
function flightLegs_() {
  if (FLIGHT_MEMO_) return FLIGHT_MEMO_;
  const sh = sheet_('NH_Flight');
  FLIGHT_MEMO_ = !sh ? [] : rows_('NH_Flight')
    .filter(r => r.flight.trim())
    .sort((a, b) => Number(a.leg) - Number(b.leg));
  return FLIGHT_MEMO_;
}
const t_ = s => { const t = Date.parse(String(s || '').trim()); return isNaN(t) ? 0 : t; };

/** Scheduled landing (no delays): last leg's schedule, else RIGHT_ARRIVES_AT. Reminders count from this. */
function scheduledArrival_() {
  const legs = flightLegs_();
  const last = legs[legs.length - 1];
  const t = last && t_(last.arrScheduled);
  if (t) return new Date(t);
  const p = t_(PropertiesService.getScriptProperties().getProperty('RIGHT_ARRIVES_AT'));
  return p ? new Date(p) : null;
}

/** Best-known landing: actual, else estimated, else scheduled. The countdown, letters and timezone switch use this. */
function arrivesAt_() {
  const legs = flightLegs_();
  const last = legs[legs.length - 1];
  const t = last && (t_(last.arrActual) || t_(last.arrEstimated));
  return t ? new Date(t) : scheduledArrival_();
}

function letterOut_(r) {
  const raw = String(r.opensAt || '').trim();
  const arrives = arrivesAt_();
  const at = /^landing$/i.test(raw) ? (arrives ? arrives.getTime() : NaN) : raw ? Date.parse(raw) : 0;
  return {
    id: r.id.trim(),
    title: r.title.trim(),
    text: String(r.text || '').replace(/\r\n?/g, '\n').trim(),
    opensAt: at ? (isNaN(at) ? '' : new Date(at).toISOString()) : '',
    // A date that can't be read keeps the letter closed for Thư rather than showing it early.
    locked: isNaN(at) || (at > 0 && Date.now() < at),
    popup: /^(true|1|x|yes|có)$/i.test(String(r.popup || '').trim()),
    seenAt: String(r.seenAt || '').trim(),
  };
}

/** For the banner (action veNha): landing time and the flight, for both people. */
function veNhaOut_() {
  const iso = t => (t ? new Date(t).toISOString() : '');
  const arrives = arrivesAt_(), sched = scheduledArrival_();
  const legs = flightLegs_().map(r => ({
    leg: Number(r.leg), flight: r.flight.trim(),
    from: r.from.trim(), to: r.to.trim(),
    fromName: airportName_(r.from), toName: airportName_(r.to),
    fromTz: r.fromTz.trim() || airportTz_(r.from), toTz: r.toTz.trim() || airportTz_(r.to),
    status: r.status.trim(),
    dep: { s: iso(t_(r.depScheduled)), e: iso(t_(r.depEstimated)), a: iso(t_(r.depActual)) },
    arr: { s: iso(t_(r.arrScheduled)), e: iso(t_(r.arrEstimated)), a: iso(t_(r.arrActual)) },
  }));
  const last = legs[legs.length - 1];
  return {
    arrivesAt: arrives ? arrives.toISOString() : '',
    scheduledAt: sched ? sched.toISOString() : '',
    landedAt: last && last.arr.a ? last.arr.a : '',
    legs,
    checkedAt: PropertiesService.getScriptProperties().getProperty('FLIGHT_CHECKED_AT') || '',
  };
}

const airportName_ = code => NH.FLIGHT.AIRPORTS[String(code || '').trim().toUpperCase()] || String(code || '').trim();
const airportTz_ = code => NH.FLIGHT.AIRPORT_TZ[String(code || '').trim().toUpperCase()] || 'Asia/Ho_Chi_Minh';

/* ───── Ticket from the Quà Giáng sinh page ───── */

/** Copies the ticket Thư sent (flight number, airport, landing time) into the last leg of NH_Flight. */
function syncTicket_() {
  const url = PropertiesService.getScriptProperties().getProperty('XMAS_API_URL') || NH.FLIGHT.XMAS_API_URL;
  if (!url) return;
  let s;
  try {
    const res = UrlFetchApp.fetch(url + '?action=state&t=' + Date.now(), { muteHttpExceptions: true, followRedirects: true });
    s = JSON.parse(res.getContentText());
  } catch (e) { console.warn('Quà Giáng sinh: ' + e); return; }
  const t = s && s.ticket;
  if (!t || !t.flightNo || !t_(t.landingISO)) return;
  const flight = normFlight_(t.flightNo);
  const landing = new Date(t_(t.landingISO)).toISOString();
  const to = String(t.airport || '').trim().toUpperCase();
  withLock_(() => {
    const rows = rows_('NH_Flight');
    const legs = rows.map(r => Number(r.leg)).filter(n => n > 0);
    // The ticket goes into the highest leg (2 by default). Luân's own entry there wins if he changed "source".
    const leg = legs.length ? Math.max.apply(null, legs) : 2;
    const row = rows.find(r => Number(r.leg) === leg);
    const patch = { flight, date: Utilities.formatDate(new Date(landing), airportTz_(to || 'SGN'), 'yyyy-MM-dd'),
      to: to || (row && row.to) || '', arrScheduled: landing, source: 'vé' };
    if (!row) { append_('NH_Flight', Object.assign({ leg }, patch)); FLIGHT_MEMO_ = null; return; }
    if (row.source.trim() && row.source.trim() !== 'vé') return;
    if (row.flight.trim() === flight && t_(row.arrScheduled) === t_(landing)) return;
    // A new or changed ticket: start that leg's tracking from scratch.
    update_('NH_Flight', row._row, Object.assign(patch, { status: '', depScheduled: '', depEstimated: '', depActual: '',
      arrEstimated: '', arrActual: '', checkedAt: '' }));
    FLIGHT_MEMO_ = null;
    PropertiesService.getScriptProperties().deleteProperty('FLIGHT_CHECKED_AT');   // check the new flight on the next tick
    PropertiesService.getScriptProperties().deleteProperty('FLIGHT_TOLD_ETA');
  });
}

const normFlight_ = s => String(s || '').toUpperCase().replace(/[\s-]/g, '');

/* ───── Flight status (AeroDataBox through RapidAPI) ───── */

/**
 * How often to ask for the flight status (Luân's rules):
 *   weekly → daily in the last 7 days → hourly from departure day (Germany) → every 15 min in the last 6 h → stop after landing.
 */
function nextCheckGap_(now) {
  const legs = flightLegs_();
  if (!legs.length) return null;
  const last = legs[legs.length - 1];
  if (t_(last.arrActual) || /^(arrived|canceled)$/i.test(last.status.trim())) return null;
  const arrives = arrivesAt_();
  const first = legs[0];
  const dep = t_(first.depScheduled) || (arrives ? arrives.getTime() - NH.FLIGHT.GUESS_TRIP_H * 3600e3 : 0);
  const depDay = dep ? Utilities.formatDate(new Date(dep), NH.TRAVEL.TZ, 'yyyy-MM-dd') : '';
  const today = Utilities.formatDate(now, NH.TRAVEL.TZ, 'yyyy-MM-dd');
  if (arrives && now.getTime() >= arrives.getTime() - 6 * 3600e3) return 15 * 60e3;
  if (depDay && today >= depDay) return 60 * 60e3;
  if (dep && now.getTime() >= dep - 7 * 864e5) return 24 * 3600e3;
  return 7 * 864e5;
}

/** One call to AeroDataBox for one flight on one local date. Returns the list it sent, [] when none, null on error. */
function fetchFlight_(flight, date) {
  const key = PropertiesService.getScriptProperties().getProperty('AERODATABOX_KEY');
  if (!key) return null;
  const props = PropertiesService.getScriptProperties();
  const month = 'FLIGHT_CALLS_' + Utilities.formatDate(new Date(), 'UTC', 'yyyy-MM');
  const used = Number(props.getProperty(month) || 0);
  if (used >= NH.FLIGHT.MAX_CALLS_PER_MONTH) { console.warn('Đã dùng hết lượt gọi AeroDataBox tháng này.'); return null; }
  props.setProperty(month, String(used + 1));
  const res = UrlFetchApp.fetch(`https://aerodatabox.p.rapidapi.com/flights/number/${encodeURIComponent(flight)}/${date}` +
    '?withAircraftImage=false&withLocation=false', {
    headers: { 'X-RapidAPI-Key': key, 'X-RapidAPI-Host': 'aerodatabox.p.rapidapi.com' },
    muteHttpExceptions: true,
  });
  const code = res.getResponseCode();
  if (code === 204 || code === 404) return [];
  if (code !== 200) { console.warn('AeroDataBox ' + code + ': ' + res.getContentText().slice(0, 300)); return null; }
  try { const j = JSON.parse(res.getContentText()); return Array.isArray(j) ? j : []; } catch (e) { return null; }
}

/** AeroDataBox writes "2027-01-14 08:15Z"; Date.parse wants a T. */
const adbTime_ = o => (o && o.utc ? t_(String(o.utc).replace(' ', 'T')) : 0);

/** Pick the right flight from AeroDataBox's answer: the one closest to what we expect, on the right route. */
function pickFlight_(list, row) {
  if (!list.length) return null;
  const want = t_(row.arrScheduled) || t_(row.depScheduled);
  const to = row.to.trim().toUpperCase(), from = row.from.trim().toUpperCase();
  const fits = list.filter(f => (!to || ((f.arrival || {}).airport || {}).iata === to) && (!from || ((f.departure || {}).airport || {}).iata === from));
  const pool = fits.length ? fits : list;
  if (!want) return pool[0];
  const key = f => Math.abs((adbTime_((f.arrival || {}).scheduledTime) || adbTime_((f.departure || {}).scheduledTime)) - want);
  return pool.slice().sort((a, b) => key(a) - key(b))[0];
}

/** Ask for every leg that hasn't landed yet, write what changed to NH_Flight, and tell Luân. */
function checkFlights_() {
  const now = new Date();
  const before = JSON.parse(JSON.stringify(veNhaOut_()));
  let asked = 0;
  flightLegs_().forEach(row => {
    if (t_(row.arrActual)) return;   // this leg is done
    const date = row.date.trim() || (t_(row.depScheduled) ? Utilities.formatDate(new Date(t_(row.depScheduled)), airportTz_(row.from), 'yyyy-MM-dd') : '');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return;
    const list = fetchFlight_(normFlight_(row.flight), date);
    asked++;
    if (!list) return;
    const f = pickFlight_(list, row);
    if (!f) { withLock_(() => update_('NH_Flight', row._row, { checkedAt: now.toISOString(), note: 'Chưa có dữ liệu cho ngày ' + date })); return; }
    const d = f.departure || {}, a = f.arrival || {};
    const iso = t => (t ? new Date(t).toISOString() : '');
    const status = String(f.status || '').trim();
    const departed = /^(departed|enroute|approaching|arrived|diverted)$/i.test(status);
    const patch = {
      status,
      from: (d.airport && d.airport.iata) || row.from, to: (a.airport && a.airport.iata) || row.to,
      fromTz: (d.airport && d.airport.timeZone) || row.fromTz, toTz: (a.airport && a.airport.timeZone) || row.toTz,
      depScheduled: iso(adbTime_(d.scheduledTime)) || row.depScheduled,
      depEstimated: iso(adbTime_(d.revisedTime) || adbTime_(d.scheduledTime)),
      depActual: iso(adbTime_(d.runwayTime) || (departed ? adbTime_(d.revisedTime) : 0)),
      arrScheduled: iso(adbTime_(a.scheduledTime)) || row.arrScheduled,
      arrEstimated: iso(adbTime_(a.revisedTime) || adbTime_(a.predictedTime) || adbTime_(a.scheduledTime)),
      arrActual: iso(adbTime_(a.runwayTime) || (/^arrived$/i.test(status) ? adbTime_(a.revisedTime) : 0)),
      checkedAt: now.toISOString(), note: '',
    };
    withLock_(() => update_('NH_Flight', row._row, patch));
  });
  FLIGHT_MEMO_ = null;
  if (asked) PropertiesService.getScriptProperties().setProperty('FLIGHT_CHECKED_AT', now.toISOString());
  tellLuan_(before, veNhaOut_());
}

/** Pushes to Luân when something about the flight changes. These ignore his sleep time (it's that night). */
function tellLuan_(before, after) {
  const vn = t => Utilities.formatDate(new Date(t), 'Asia/Ho_Chi_Minh', 'HH:mm');
  const at = (t, tz) => Utilities.formatDate(new Date(t), tz, 'HH:mm');
  const send = (title, body, tag) => push_('left', { title, body, tag: tag || 've-nha-flight' }, 3 * 3600);
  const n = after.legs.length;
  after.legs.forEach((l, i) => {
    const b = before.legs.find(x => x.leg === l.leg && x.flight === l.flight) || { dep: {}, arr: {}, status: '' };
    const isLast = i === n - 1;
    const next = after.legs[i + 1];
    if (/^(canceled|canceleduncertain)$/i.test(l.status) && b.status !== l.status) {
      send(`⚠️ Chuyến ${l.flight} bị huỷ`, `${l.fromName} → ${l.toName}. Gọi cho Thư ngay nhé.`, 've-nha-alert');
    } else if (/^diverted$/i.test(l.status) && b.status !== l.status) {
      send(`⚠️ Chuyến ${l.flight} phải hạ cánh nơi khác`, `Không xuống ${l.toName} như dự kiến. Gọi cho Thư ngay nhé.`, 've-nha-alert');
    }
    if (l.dep.a && !b.dep.a) {
      const eta = l.arr.e || l.arr.s;
      send(`✈️ Thư đã cất cánh từ ${l.fromName}`,
        `${l.flight}` + (eta ? ` · dự kiến tới ${l.toName} lúc ${at(eta, l.toTz)}` + (l.toTz !== 'Asia/Ho_Chi_Minh' ? ` (${vn(eta)} giờ VN)` : '') : ''));
    }
    if (l.arr.a && !b.arr.a) {
      if (isLast) send('🧡 Thư hạ cánh rồi!', `${l.flight} đã đáp xuống ${l.toName} lúc ${vn(l.arr.a)}.`, 've-nha-landed');
      else send(`🛬 Thư đã tới ${l.toName}`, next ? `Chuyến tiếp ${next.flight} cất cánh lúc ${at(next.dep.e || next.dep.s, next.fromTz)} giờ ${next.fromName} (${vn(next.dep.e || next.dep.s)} giờ VN).` : '');
    }
  });
  // Delay on the final landing: tell when it moves by DELAY_NOTIFY_MIN or more since the last message.
  const last = after.legs[n - 1];
  if (last && !last.arr.a && last.arr.e && last.arr.s) {
    const props = PropertiesService.getScriptProperties();
    const told = t_(props.getProperty('FLIGHT_TOLD_ETA')) || t_(last.arr.s);
    const eta = t_(last.arr.e);
    if (Math.abs(eta - told) >= NH.FLIGHT.DELAY_NOTIFY_MIN * 60e3) {
      const late = Math.round((eta - t_(last.arr.s)) / 60e3);
      send(late > 0 ? `⏱ Thư sẽ hạ cánh trễ ${late} phút` : late < 0 ? `Thư sẽ hạ cánh sớm ${-late} phút` : 'Thư hạ cánh đúng giờ trở lại',
        `${last.flight} dự kiến đáp xuống ${last.toName} lúc ${vn(eta)}, ${Utilities.formatDate(new Date(eta), 'Asia/Ho_Chi_Minh', 'dd/MM')}.`, 've-nha-eta');
      props.setProperty('FLIGHT_TOLD_ETA', new Date(eta).toISOString());
    }
  }
}

/* ───── Reminders ───── */

/**
 * When Thư should leave home for the airport: the first flight's departure minus the time at the airport
 * and the trip from Pinneberg. Trains don't run at night, so a time between LATEST_LEAVE and EARLIEST_LEAVE
 * moves to LATEST_LEAVE the evening before. The "at" cell on the di-san-bay row overrides all this.
 */
function leaveHome_() {
  const legs = flightLegs_();
  const first = legs[0];
  const arrives = scheduledArrival_();
  const dep = (first && t_(first.depScheduled)) || (arrives ? arrives.getTime() - NH.FLIGHT.GUESS_TRIP_H * 3600e3 : 0);
  if (!dep) return null;
  const T = NH.TRAVEL;
  let leave = new Date(dep - (T.AIRPORT_BEFORE_MIN + T.HOME_TO_AIRPORT_MIN) * 60e3);
  const hm = Utilities.formatDate(leave, T.TZ, 'HH:mm');
  const day = Utilities.formatDate(leave, T.TZ, 'yyyy-MM-dd');
  if (hm >= T.LATEST_LEAVE) leave = localTime_(day, T.LATEST_LEAVE, T.TZ);
  else if (hm < T.EARLIEST_LEAVE) {
    const prev = Utilities.formatDate(new Date(localTime_(day, '12:00', T.TZ).getTime() - 864e5), T.TZ, 'yyyy-MM-dd');
    leave = localTime_(prev, T.LATEST_LEAVE, T.TZ);
  }
  return { leave, dep: new Date(dep), flight: first ? first.flight.trim() : '' };
}

/** When one reminder row is due, or null. */
function reminderDue_(r, side, people) {
  if (side !== 'left' && side !== 'right') return null;
  const id = r.id.trim();
  const at = t_(r.at);
  if (id === 'di-san-bay') {   // "at" here is when she leaves home; the reminder comes NOTICE_MIN before
    const leave = at ? new Date(at) : (leaveHome_() || {}).leave;
    return leave ? new Date(leave.getTime() - NH.TRAVEL.NOTICE_MIN * 60e3) : null;
  }
  if (at) return new Date(at);
  const arrives = scheduledArrival_();
  if (!arrives) return null;
  if (id === '24-gio') return new Date(arrives.getTime() - 24 * 3600e3);
  const [y, m, d] = Utilities.formatDate(arrives, NH.ARRIVAL_TZ, 'yyyy-MM-dd').split('-').map(Number);
  const day = id === '1-thang' ? new Date(Date.UTC(y, m - 2, d))
    : id === '1-tuan' ? new Date(Date.UTC(y, m - 1, d - 7)) : null;
  if (!day) return null;
  return localTime_(Utilities.formatDate(day, 'UTC', 'yyyy-MM-dd'), NH.REMINDERS.AT, tzOf_(side, people));
}

/** {leave} {dep} {flight} in a reminder's text. */
function fillReminder_(text, r) {
  const plan = leaveHome_() || {};
  const leave = t_(r.at) ? new Date(t_(r.at)) : plan.leave;
  const T = NH.TRAVEL.TZ;
  return String(text || '')
    .replace(/\{leave\}/gi, leave ? Utilities.formatDate(leave, T, 'HH:mm') : '')
    .replace(/\{dep\}/gi, plan.dep ? Utilities.formatDate(plan.dep, T, 'HH:mm') : '')
    .replace(/\{flight\}/gi, plan.flight || 'của em');
}

/** "2026-12-15", "08:00", "Europe/Berlin" → that moment. */
function localTime_(ymd, hhmm, tz) {
  const guess = new Date(`${ymd}T${hhmm}:00Z`);
  const off = Utilities.formatDate(guess, tz, 'Z');   // e.g. +0100
  return new Date(`${ymd}T${hhmm}:00${off.slice(0, 3)}:${off.slice(3)}`);
}

function sendReminders_(now) {
  const arrives = arrivesAt_();
  if (!arrives || now > arrives) return;
  const windowMs = NH.REMINDERS.WINDOW_H * 3600e3;
  const people = people_();
  rows_('NH_Reminders').forEach(r => {
    if (r.sentAt.trim()) return;
    const side = SIDE_ALIAS_[String(r.to || '').trim().toLowerCase()];
    const due = reminderDue_(r, side, people);
    if (!due || now < due) return;
    if (now - due > windowMs) {
      withLock_(() => update_('NH_Reminders', r._row, { sentAt: 'bỏ lỡ: không gửi được trong ' + NH.REMINDERS.WINDOW_H + ' giờ' }));
      return;
    }
    const ttl = Math.round((due.getTime() + windowMs - now.getTime()) / 1000);
    const n = push_(side, { title: fillReminder_(r.title.trim(), r) || 'Our Story', body: fillReminder_(r.body.trim(), r), tag: 've-nha-' + r.id.trim() }, ttl);
    if (n) withLock_(() => update_('NH_Reminders', r._row, { sentAt: now.toISOString() }));
  });
}

/* ───── The 5-minute trigger ───── */

/** Run once from the editor: starts the 5-minute check and logs the plan (rerun any time to see it again). */
function setupVeNha() {
  ScriptApp.getProjectTriggers()
    .filter(t => ['veNhaTick', 'remindersTick'].indexOf(t.getHandlerFunction()) >= 0)
    .forEach(t => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('veNhaTick').timeBased().everyMinutes(5).create();
  showPlan();
}

/** Run from the editor: logs the landing time, the flight and when each reminder goes out. */
function showPlan() {
  syncTicket_();
  const vnT = d => Utilities.formatDate(d, 'Asia/Ho_Chi_Minh', 'dd/MM HH:mm') + ' giờ VN';
  const deT = d => Utilities.formatDate(d, NH.TRAVEL.TZ, 'dd/MM HH:mm') + ' giờ Đức';
  const a = arrivesAt_();
  Logger.log('Hạ cánh: ' + (a ? vnT(a) : 'chưa rõ (thiếu RIGHT_ARRIVES_AT và vé)'));
  flightLegs_().forEach(l => Logger.log(`Chặng ${l.leg}: ${l.flight} ${l.from}→${l.to} ngày ${l.date} (${l.source || 'Luân điền'})`));
  if (!PropertiesService.getScriptProperties().getProperty('AERODATABOX_KEY')) Logger.log('Chưa có AERODATABOX_KEY: chưa theo dõi chuyến bay.');
  const plan = leaveHome_();
  if (plan) Logger.log(`Thư rời nhà (tự tính): ${deT(plan.leave)}, bay ${deT(plan.dep)}`);
  const people = people_();
  rows_('NH_Reminders').forEach(r => {
    const side = SIDE_ALIAS_[String(r.to || '').trim().toLowerCase()];
    const due = reminderDue_(r, side, people);
    Logger.log(`Nhắc ${r.id} → ${r.to}: ` + (due ? `${vnT(due)} / ${deT(due)}` : 'không rõ id hoặc người nhận') + (r.sentAt ? ` [đã gửi: ${r.sentAt}]` : ''));
  });
}

/** Every 5 minutes (setupVeNha): ticket, flight status when due, then reminders. */
function veNhaTick() {
  const now = new Date();
  const props = PropertiesService.getScriptProperties();
  if (now.getTime() - t_(props.getProperty('TICKET_SYNC_AT')) >= NH.FLIGHT.TICKET_SYNC_MIN * 60e3) {
    syncTicket_();
    props.setProperty('TICKET_SYNC_AT', now.toISOString());
  }
  const gap = nextCheckGap_(now);
  if (gap !== null && props.getProperty('AERODATABOX_KEY') && now.getTime() - t_(props.getProperty('FLIGHT_CHECKED_AT')) >= gap - 60e3) {
    checkFlights_();
  }
  sendReminders_(now);
}

/* ───────────────────────── Firebase Cloud Messaging ───────────────────────── */

function serviceAccount_() {
  return JSON.parse(must_('FCM_SERVICE_ACCOUNT'));
}

/** OAuth access token for FCM, signed with the service account key, cached ~50 minutes. */
function fcmAccess_() {
  const cache = CacheService.getScriptCache();
  const hit = cache.get('fcm_access');
  if (hit) return hit;
  const sa = serviceAccount_();
  const now = Math.floor(Date.now() / 1000);
  const enc = o => Utilities.base64EncodeWebSafe(JSON.stringify(o)).replace(/=+$/, '');
  const unsigned = enc({ alg: 'RS256', typ: 'JWT' }) + '.' + enc({
    iss: sa.client_email,
    scope: 'https://www.googleapis.com/auth/firebase.messaging',
    aud: 'https://oauth2.googleapis.com/token',
    iat: now, exp: now + 3600,
  });
  const sig = Utilities.base64EncodeWebSafe(Utilities.computeRsaSha256Signature(unsigned, sa.private_key)).replace(/=+$/, '');
  const res = UrlFetchApp.fetch('https://oauth2.googleapis.com/token', {
    method: 'post',
    payload: { grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: unsigned + '.' + sig },
    muteHttpExceptions: true,
  });
  const j = JSON.parse(res.getContentText() || '{}');
  if (!j.access_token) throw new Error('FCM auth failed: ' + res.getContentText());
  cache.put('fcm_access', j.access_token, 3000);
  return j.access_token;
}

/**
 * Send one notification to every active device of one side. Returns how many were delivered to FCM.
 * Data-only message: sw.js draws it, so the "Our Story" icon, tag and tap action are ours.
 */
function push_(side, note, ttlSeconds) {
  if (!PropertiesService.getScriptProperties().getProperty('FCM_SERVICE_ACCOUNT')) return 0;
  const tokens = activeTokens_(side);
  if (!tokens.length) return 0;
  const access = fcmAccess_();
  const url = `https://fcm.googleapis.com/v1/projects/${serviceAccount_().project_id}/messages:send`;
  const reqs = tokens.map(t => ({
    url, method: 'post', contentType: 'application/json', muteHttpExceptions: true,
    headers: { Authorization: 'Bearer ' + access },
    payload: JSON.stringify({ message: {
      token: t.token,
      data: { kind: 'nho', title: note.title, body: note.body, tag: note.tag || 'nho' },
      webpush: { headers: { Urgency: 'high', TTL: String(Math.max(60, Math.round(ttlSeconds || 3600))) } },
    } }),
  }));
  let sent = 0;
  UrlFetchApp.fetchAll(reqs).forEach((res, i) => {
    const code = res.getResponseCode();
    if (code === 200) { sent++; return; }
    const body = res.getContentText();
    console.warn('FCM ' + code + ': ' + body);
    // The phone dropped this address (app removed, data cleared…): stop using it.
    if (code === 404 || (code === 400 && /registration token|UNREGISTERED/i.test(body))) {
      withLock_(() => update_('NH_Tokens', tokens[i]._row, { removed: 'TRUE', updatedAt: new Date().toISOString() }));
    }
  });
  return sent;
}

function activeTokens_(side) {
  return rows_('NH_Tokens').filter(r => r.side === side && r.removed !== 'TRUE');
}

/* ───────────────────────── Sign-in (asks the Hai nửa backend) ───────────────────────── */

function whoami_(req) {
  const email = String(req.email || '').trim().toLowerCase();
  const token = String(req.token || '').trim();
  if (!email || !token) return null;
  const digest = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, email + '|' + token);
  const key = 'me_' + Utilities.base64EncodeWebSafe(digest);
  const cache = CacheService.getScriptCache();
  const hit = cache.get(key);
  if (hit) return JSON.parse(hit);
  const res = UrlFetchApp.fetch(must_('AUTH_API_URL'), {
    method: 'post',
    contentType: 'text/plain;charset=utf-8',
    payload: JSON.stringify({ action: 'whoami', email, token, tz: String(req.tz || '') }),
    followRedirects: true,
    muteHttpExceptions: true,
  });
  let r;
  try { r = JSON.parse(res.getContentText()); } catch (x) { return null; }
  if (!r || !r.ok || !r.me || (r.me.side !== 'left' && r.me.side !== 'right')) return null;
  const me = { side: r.me.side, name: String(r.me.name || '') };
  cache.put(key, JSON.stringify(me), 600);   // 10 minutes
  return me;
}

/* ───────────────────────── Helpers ───────────────────────── */

function out_(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}
function bad_(message) { return { ok: false, error: 'bad_request', message }; }
const other_ = side => (side === 'left' ? 'right' : 'left');
const cap_ = s => s.charAt(0).toUpperCase() + s.slice(1);

function must_(name) {
  const v = PropertiesService.getScriptProperties().getProperty(name);
  if (!v) throw new Error('Thiếu Script property: ' + name + ' (xem hướng dẫn ở đầu file).');
  return v;
}

function clean_(s, max) {
  return String(s == null ? '' : s).replace(/[\u0000-\u001F]/g, ' ').trim().slice(0, max);
}

let SS_ = null;
function sheet_(name) {
  if (!SS_) SS_ = SpreadsheetApp.openById(must_('SHEET_ID'));
  return SS_.getSheetByName(name);
}

function rows_(name) {
  const values = sheet_(name).getDataRange().getValues();
  const head = values.shift() || [];
  return values.map((v, i) => {
    const o = { _row: i + 2 };
    head.forEach((h, j) => { o[h] = v[j] instanceof Date ? v[j].toISOString() : String(v[j]); });
    return o;
  }).filter(o => o.id || o.token || o.side || o.text || o.leg);
}

/** Writes as plain text, so Sheets never turns "2026-11-03" into a date. */
function append_(name, obj) {
  const head = NH.SHEETS[name];
  const sh = sheet_(name);
  sh.getRange(sh.getLastRow() + 1, 1, 1, head.length)
    .setNumberFormat('@')
    .setValues([head.map(h => obj[h] == null ? '' : String(obj[h]))]);
}

function update_(name, rowNum, patch) {
  const head = NH.SHEETS[name];
  const sh = sheet_(name);
  Object.keys(patch).forEach(k => {
    const col = head.indexOf(k);
    if (col >= 0) sh.getRange(rowNum, col + 1).setNumberFormat('@').setValue(String(patch[k]));
  });
}

function withLock_(fn) {
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try { return fn(); } finally { lock.releaseLock(); }
}
