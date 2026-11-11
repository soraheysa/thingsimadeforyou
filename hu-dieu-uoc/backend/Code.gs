/**
 * Hũ điều ước — backend (Google Apps Script web app).
 *
 * Its own Apps Script project, like Lăng kính. It never sees the access code: every request carries
 * the email + token the pages already hold, and this script asks the Hai nửa backend ("whoami")
 * whether they are valid. Nothing changes in the Hai nửa code.
 *
 * The rules (who sees what, the jar, one draw a day, the two taps) live in hu-dieu-uoc/rules.js,
 * which the preview uses too. This project needs a copy of it as a second file named Rules.gs.
 *
 * Setup (once):
 *  1. script.google.com → New project → name it "Hũ điều ước" → paste this file as Code.gs.
 *  2. File + → Script → name it Rules → paste all of hu-dieu-uoc/rules.js into it.
 *  3. Project Settings → Script properties → add
 *       AUTH_API_URL = the Hai nửa web app URL (…/exec), the same as AUTH_API_URL in shared/config.js
 *       FOLDER_ID    = (optional) a Drive folder id, to keep the data sheet there
 *  4. Choose the function "setup" in the toolbar → Run → allow access.
 *     It creates a spreadsheet "Hũ điều ước – data" with one tab, HU_Wishes.
 *  5. Deploy → New deployment → Web app → Execute as: Me, Who has access: Anyone → Deploy.
 *  6. Copy the URL (…/exec) into API_URL in hu-dieu-uoc/config.js.
 * Later code changes (here or in Rules.gs): Deploy → Manage deployments → edit (pencil) →
 * Version: New version. That keeps the same URL.
 *
 * In the sheet, every value is plain text. You can read it, but editing by hand is at your own risk:
 * keep the column names, and use TRUE (capitals) in "deleted".
 */

const HU = {
  SHEET: 'HU_Wishes',
  DEFAULT_TZ: 'Asia/Ho_Chi_Minh',
};

/* ───────────────────────── Setup ───────────────────────── */

function setup() {
  const p = PropertiesService.getScriptProperties();
  let ss;
  if (p.getProperty('SHEET_ID')) {
    ss = SpreadsheetApp.openById(p.getProperty('SHEET_ID'));
  } else {
    ss = SpreadsheetApp.create('Hũ điều ước – data');
    p.setProperty('SHEET_ID', ss.getId());
    const folder = p.getProperty('FOLDER_ID');
    if (folder) DriveApp.getFileById(ss.getId()).moveTo(DriveApp.getFolderById(folder));
  }
  const head = HU_RULES.FIELDS;
  const sh = ss.getSheetByName(HU.SHEET) || ss.insertSheet(HU.SHEET);
  sh.getRange(1, 1, sh.getMaxRows(), Math.max(head.length, sh.getMaxColumns())).setNumberFormat('@');   // plain text only
  sh.getRange(1, 1, 1, head.length).setValues([head]).setFontWeight('bold');
  sh.setFrozenRows(1);
  ss.getSheets().forEach(s => { if (s.getName() !== HU.SHEET && ss.getSheets().length > 1) ss.deleteSheet(s); });
  must_('AUTH_API_URL');
  Logger.log('Xong. Bảng dữ liệu: ' + ss.getUrl());
}

/* ───────────────────────── Web app ───────────────────────── */

function doGet() {
  return out_({ ok: true, app: 'hu-dieu-uoc' });
}

function doPost(e) {
  let req;
  try { req = JSON.parse(e.postData.contents); } catch (x) { return out_({ ok: false, error: 'bad_request' }); }
  try {
    const me = whoami_(req);
    if (!me) return out_({ ok: false, error: 'auth' });
    const fn = ACTIONS[req.action];
    if (!fn) return out_({ ok: false, error: 'bad_request', message: 'Yêu cầu không hợp lệ.' });
    return out_(fn(req, me));
  } catch (err) {
    console.error(err && err.stack || err);
    return out_({ ok: false, error: 'server', message: 'Máy chủ đang bận. Thử lại sau chút nữa nhé.' });
  }
}

/** Every answer that changes something also returns the fresh state, so the page redraws at once. */
function state_(me, req, extra) {
  return Object.assign({ ok: true }, HU_RULES.stateFor(rows_(), me.side, today_(req.tz)), extra || {});
}

const ACTIONS = {

  huList(req, me) {
    return state_(me, req);
  },

  huAdd(req, me) {
    const v = HU_RULES.validate(req, true);
    if (!v.ok) return bad_(v.message);
    const r = HU_RULES.checkRecipient(v.value.category, v.value.recipient);
    if (!r.ok) return bad_(r.message);
    return withLock_(() => {
      const id = Utilities.getUuid().replace(/-/g, '').slice(0, 12);
      append_(Object.assign({}, v.value, {
        id, author: me.side, recipient: v.value.category === 'someone' ? v.value.recipient : '',
        createdAt: new Date().toISOString(),
      }));
      return state_(me, req, { id });
    });
  },

  /** Title, note, link and recipient. The category stays as it was added. */
  huEdit(req, me) {
    const v = HU_RULES.validate(req, false);
    if (!v.ok) return bad_(v.message);
    return withLock_(() => {
      const w = find_(req.id);
      if (!w || !HU_RULES.canChange(w, me.side)) return notFound_();
      const r = HU_RULES.checkRecipient(w.category, v.value.recipient);
      if (!r.ok) return bad_(r.message);
      update_(w._row, {
        title: v.value.title, note: v.value.note, link: v.value.link,
        recipient: w.category === 'someone' ? v.value.recipient : '',
        editedAt: new Date().toISOString(),
      });
      return state_(me, req);
    });
  },

  huDelete(req, me) {
    return withLock_(() => {
      const w = find_(req.id);
      if (!w || !HU_RULES.canChange(w, me.side)) return notFound_();
      update_(w._row, { deleted: 'TRUE', deletedAt: new Date().toISOString() });
      return state_(me, req);
    });
  },

  /** Opens one random wish from the other person's jar. One a day, by the drawer's own calendar. */
  huDraw(req, me) {
    return withLock_(() => {
      const rows = rows_();
      const today = today_(req.tz);
      if (HU_RULES.drewToday(rows, me.side, today)) {
        return { ok: false, error: 'drew_today', message: 'Hôm nay bốc rồi. Mai bốc tiếp nhé.' };
      }
      const pool = HU_RULES.jarFor(rows, me.side);
      if (!pool.length) return { ok: false, error: 'empty', message: 'Hũ đang trống.' };
      const w = pool[Math.floor(Math.random() * pool.length)];
      const patch = { drawnBy: me.side, drawnAt: new Date().toISOString(), drawnDay: today };
      update_(w._row, patch);
      Object.assign(w, patch);
      return state_(me, req, { drawn: HU_RULES.view(w, me.side) });
    });
  },

  huGrant(req, me) {
    return withLock_(() => {
      const w = find_(req.id);
      const r = HU_RULES.grant(w, me.side, new Date().toISOString());
      if (!r.ok) return r;
      if (Object.keys(r.patch).length) update_(w._row, r.patch);
      return state_(me, req);
    });
  },

  huUngrant(req, me) {
    return withLock_(() => {
      const w = find_(req.id);
      const r = HU_RULES.ungrant(w, me.side);
      if (!r.ok) return r;
      update_(w._row, r.patch);
      return state_(me, req);
    });
  },
};

/* ───────────────────────── Sign-in (via Hai nửa) ───────────────────────── */

function whoami_(req) {
  const email = String(req.email || '').trim().toLowerCase();
  const token = String(req.token || '');
  if (!email || !token) return null;
  const digest = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, email + '|' + token, Utilities.Charset.UTF_8);
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
function notFound_() { return { ok: false, error: 'not_found', message: 'Điều ước này không đổi được nữa.' }; }

function must_(name) {
  const v = PropertiesService.getScriptProperties().getProperty(name);
  if (!v) throw new Error('Thiếu Script property: ' + name + ' (xem hướng dẫn ở đầu file).');
  return v;
}

/** "2026-11-11" in the caller's own time zone (falls back to Vietnam). */
function today_(tz) {
  try { return Utilities.formatDate(new Date(), String(tz || HU.DEFAULT_TZ), 'yyyy-MM-dd'); }
  catch (x) { return Utilities.formatDate(new Date(), HU.DEFAULT_TZ, 'yyyy-MM-dd'); }
}

let SH_ = null;
function sheet_() {
  if (!SH_) SH_ = SpreadsheetApp.openById(must_('SHEET_ID')).getSheetByName(HU.SHEET);
  return SH_;
}

function rows_() {
  const values = sheet_().getDataRange().getValues();
  const head = values.shift() || [];
  return values.map((v, i) => {
    const o = { _row: i + 2 };
    HU_RULES.FIELDS.forEach(f => {
      const j = head.indexOf(f);
      const x = j < 0 ? '' : v[j];
      o[f] = x instanceof Date ? x.toISOString() : String(x == null ? '' : x);
    });
    return o;
  }).filter(o => o.id);
}

function find_(id) {
  id = String(id || '');
  return id ? rows_().find(r => r.id === id) || null : null;
}

function append_(obj) {
  sheet_().appendRow(HU_RULES.FIELDS.map(h => obj[h] == null ? '' : String(obj[h])));
}

function update_(rowNum, patch) {
  const sh = sheet_();
  Object.keys(patch).forEach(k => {
    const col = HU_RULES.FIELDS.indexOf(k);
    if (col >= 0) sh.getRange(rowNum, col + 1).setValue(String(patch[k]));
  });
}

function withLock_(fn) {
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try { return fn(); } finally { lock.releaseLock(); }
}
