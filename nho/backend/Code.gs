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
  // Where RIGHT_ARRIVES_AT switches Thư to.
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
  },

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
 * Thư: from RIGHT_ARRIVES_AT on, Vietnam time, unless her phone reported a new timezone after landing
 * (then the phone wins, so a delayed flight or a later trip still comes out right).
 */
function tzOf_(side, people) {
  const p = people[side] || {};
  let tz = normTz_(p.tz) || NH.DEFAULT_TZ[side];
  if (side === 'right') {
    const arrives = Date.parse(PropertiesService.getScriptProperties().getProperty('RIGHT_ARRIVES_AT') || '');
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

const STARTER_LINES = [
  // kind, to, when, text
  ['nhắc', 'both', '', '{you} nhớ uống nước nhé 💧'],
  ['nhắc', 'both', '', '{you} nhớ mặc ấm đấy 🧣'],
  ['nhắc', 'both', '', 'Nhớ skincare nha ✨'],
  ['nhắc', 'both', '', 'Nhớ ăn đủ đấy, không được bỏ bữa 🍚'],
  ['nhắc', 'both', '', 'Đứng dậy vươn vai một cái đi {you} 🙆'],
  ['nhắc', 'both', '', 'Thả lỏng vai ra, {you} đang gồng đó 😌'],
  ['nhắc', 'both', '', 'Hôm nay {you} cười chưa? Cười một cái đi 😄'],
  ['nhắc', 'both', '', '{you} nhớ sạc điện thoại nha 🔋'],
  ['nhắc', 'both', '', 'Tự khen mình một câu hôm nay đi {you} 🌟'],
  ['nhắc', 'both', 'sáng', 'Ăn sáng chưa đó? 🥐'],
  ['nhắc', 'both', 'sáng', 'Ra đường nhớ bôi kem chống nắng nha ☀️'],
  ['nhắc', 'both', 'trưa', 'Nhớ ăn trưa đàng hoàng nha 🍱'],
  ['nhắc', 'both', 'chiều', 'Nghỉ mắt 20 giây, nhìn ra thật xa một chút 👀'],
  ['nhắc', 'both', 'chiều', 'Ly cà phê thứ ba để mai uống nha ☕'],
  ['nhắc', 'both', 'chiều', 'Ra ngoài hít thở chút không khí đi {you} 🌿'],
  ['nhắc', 'both', 'tối', 'Tắt màn hình đi ngủ sớm nào {you} 🌙'],
  ['nhắc', 'both', 'tối', 'Nhớ khoá cửa trước khi ngủ 🔑'],
  ['nhắc', 'Thư', '', 'Bên đó lạnh, ra ngoài nhớ mang găng tay nha 🧤'],
  ['quote', 'both', '', 'Fun fact: bạch tuộc có ba trái tim. {me} chỉ có một, đang ở chỗ {you} 🐙'],
  ['quote', 'both', '', 'Fun fact: rái cá nắm tay nhau khi ngủ để không trôi xa 🦦'],
  ['quote', 'both', '', 'Fun fact: chim cánh cụt tặng sỏi cho người mình thích 🐧'],
  ['quote', 'both', '', 'Fun fact: mật ong để cả nghìn năm vẫn không hỏng 🍯'],
  ['quote', 'both', '', 'Khoảng cách chỉ là con số. Múi giờ mới là kẻ thù thật sự 🕰️'],
  ['quote', 'both', '', 'Ngủ đủ giấc là loại skincare miễn phí nhất 😴'],
  ['quote', 'both', '', 'Hôm nay chưa ổn thì mai làm lại. Mặt trời cũng làm vậy mỗi ngày 🌅'],
  ['quote', 'both', '', 'Pin 1% đáng sợ hơn mọi bộ phim kinh dị 🔋'],
  ['quote', 'both', '', 'Một bước nhỏ mỗi ngày vẫn là đang tiến về phía trước 👣'],
  ['quote', 'both', '', 'Có công mài sắt, có ngày nên kim ⚔️'],
  ['quote', 'both', '', 'Đi một ngày đàng, học một sàng khôn 🧭'],
  ['quote', 'both', '', 'Kiếm đạo dạy: thắng chính mình trước, rồi mới tới đối thủ 🥋'],
];

const WHEN_ = { 'sáng': [5, 11], 'trưa': [11, 14], 'chiều': [14, 18], 'tối': [18, 29] };   // 29 = 05:00 next day
const SIDE_ALIAS_ = { both: 'both', '': 'both', left: 'left', right: 'right', 'luân': 'left', 'luan': 'left', 'thư': 'right', 'thu': 'right' };

/** The NH_Lines tab, created with the starter lines the first time it is needed. */
function linesSheet_() {
  let sh = sheet_('NH_Lines');
  if (sh && sh.getLastRow() > 1) return sh;   // already has lines (yours)
  sh = sh || SS_.insertSheet('NH_Lines');
  const head = NH.SHEETS.NH_Lines;
  sh.getRange(1, 1, 1, head.length).setValues([head]).setFontWeight('bold');
  sh.setFrozenRows(1);
  sh.getRange(2, 1, STARTER_LINES.length, head.length).setNumberFormat('@').setValues(STARTER_LINES);
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
  }).filter(o => o.id || o.token || o.side || o.text);
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
