/**
 * Lăng kính — backend (Google Apps Script web app).
 *
 * This is its own Apps Script project, separate from Hai nửa. It never sees the access code:
 * every request carries the email + token the pages already hold, and this script asks the
 * Hai nửa backend ("whoami") whether they are valid. So nothing changes in the Hai nửa code.
 *
 * Setup (once):
 *  1. script.google.com → New project → paste this file as Code.gs.
 *  2. Project Settings → Script properties → add
 *       AUTH_API_URL = the Hai nửa web app URL (…/exec), the same as AUTH_API_URL in shared/config.js
 *       FOLDER_ID    = 1zRVcl0-fBPq7dEjNEL9ZVM292RNRYN8U   (Drive folder "Our Moodboard")
 *  3. Choose the function "setup" in the toolbar → Run → allow access.
 *     It creates the sub-folders and a spreadsheet "Lăng kính – data" inside Our Moodboard.
 *  4. Deploy → New deployment → Web app → Execute as: Me, Who has access: Anyone → Deploy.
 *  5. Copy the URL (…/exec) into API_URL in lang-kinh/config.js.
 * Later code changes: Deploy → Manage deployments → edit (pencil) → Version: New version.
 * That keeps the same URL.
 */

const LK = {
  PAGE: 20,
  CAPTION_MAX: 120,
  NOTE_MAX: 5000,
  STICKERS_PER_PERSON: 3,
  PAPERS: ['kem', 'bo', 'hong', 'bacha', 'troi', 'oaihuong'],
  MAX_LARGE: 6 * 1024 * 1024,       // base64 characters
  MAX_THUMB: 600 * 1024,
  MAX_PREVIEW: 12000,
  MAX_ORIGINAL: 30 * 1024 * 1024,
  MAX_STICKER: 700 * 1024,
  SHEETS: {
    LK_Posts: ['id', 'type', 'author', 'paper', 'caption', 'body', 'blurred', 'origId', 'largeId', 'thumbId',
      'preview', 'city', 'createdAt', 'editedAt', 'seenAt', 'deleted', 'deletedAt'],
    LK_Reactions: ['id', 'postId', 'author', 'stickerId', 'createdAt', 'removed'],
    LK_Stickers: ['id', 'owner', 'source', 'fileId', 'createdAt', 'removed'],
    LK_Places: ['side', 'city', 'lat', 'lon', 'tz', 'updatedAt'],
  },
};

/* ───────────────────────── Setup ───────────────────────── */

function setup() {
  const p = PropertiesService.getScriptProperties();
  const root = DriveApp.getFolderById(must_('FOLDER_ID'));
  const sub = (parent, name) => {
    const it = parent.getFoldersByName(name);
    return it.hasNext() ? it.next() : parent.createFolder(name);
  };
  const stickers = sub(root, 'stickers');
  p.setProperties({
    F_ORIGINALS: sub(root, 'originals').getId(),
    F_LARGE: sub(root, 'large').getId(),
    F_THUMBS: sub(root, 'thumbs').getId(),
    F_STICKERS: stickers.getId(),
    F_PACK: sub(stickers, 'pack').getId(),
    F_TRASH: sub(root, 'trash bin').getId(),
  });

  let ss;
  if (p.getProperty('SHEET_ID')) {
    ss = SpreadsheetApp.openById(p.getProperty('SHEET_ID'));
  } else {
    ss = SpreadsheetApp.create('Lăng kính – data');
    DriveApp.getFileById(ss.getId()).moveTo(root);
    p.setProperty('SHEET_ID', ss.getId());
  }
  Object.keys(LK.SHEETS).forEach(name => {
    const head = LK.SHEETS[name];
    const sh = ss.getSheetByName(name) || ss.insertSheet(name);
    sh.getRange(1, 1, sh.getMaxRows(), Math.max(head.length, sh.getMaxColumns())).setNumberFormat('@');   // keep everything as plain text
    sh.getRange(1, 1, 1, head.length).setValues([head]).setFontWeight('bold');
    sh.setFrozenRows(1);
  });
  ss.getSheets().forEach(sh => { if (!LK.SHEETS[sh.getName()] && ss.getSheets().length > 1) ss.deleteSheet(sh); });
  Logger.log('Xong. Bảng dữ liệu: ' + ss.getUrl());
  Logger.log('Thả các sticker PNG của bộ sticker vào thư mục: Our Moodboard / stickers / pack');
}

/* ───────────────────────── Web app ───────────────────────── */

function doGet() {
  return out_({ ok: true, app: 'lang-kinh' });
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

const ACTIONS = {

  /** A page of posts, newest first, plus both people's places. */
  lkList(req, me) {
    const limit = Math.min(Number(req.limit) || LK.PAGE, 40);
    let posts = rows_('LK_Posts').filter(r => r.deleted !== 'TRUE');
    posts.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    if (req.before) posts = posts.filter(r => r.createdAt < String(req.before));
    const page = posts.slice(0, limit);
    const ids = {};
    page.forEach(r => { ids[r.id] = true; });
    const reactions = {};
    rows_('LK_Reactions').forEach(r => {
      if (r.removed === 'TRUE' || !ids[r.postId]) return;
      (reactions[r.postId] = reactions[r.postId] || []).push({ id: r.id, author: r.author, stickerId: r.stickerId, createdAt: r.createdAt });
    });
    return {
      ok: true,
      me: { side: me.side, name: me.name },
      posts: page.map(r => postOut_(r, reactions[r.id] || [])),
      hasMore: posts.length > limit,
      places: places_(),
    };
  },

  /** New polaroid or sticky note. The photo arrives already resized by the page. */
  lkCreate(req, me) {
    const type = req.type === 'note' ? 'note' : 'photo';
    const paper = LK.PAPERS.indexOf(req.paper) >= 0 ? req.paper : 'kem';
    const caption = clean_(req.caption, LK.CAPTION_MAX);
    const body = clean_(req.body, LK.NOTE_MAX);
    if (type === 'note' && !body) return bad_('Viết vài chữ trước đã nhé.');
    const row = {
      id: 'lk_' + Utilities.getUuid().replace(/-/g, '').slice(0, 10),
      type, author: me.side, paper,
      caption: type === 'photo' ? caption : '',
      body: type === 'note' ? body : '',
      blurred: req.blurred ? 'TRUE' : 'FALSE',
      origId: '', largeId: '', thumbId: '', preview: '',
      city: clean_(req.city, 60),
      createdAt: new Date().toISOString(), editedAt: '', seenAt: '', deleted: 'FALSE', deletedAt: '',
    };
    if (type === 'photo') {
      const large = b64_(req.large, LK.MAX_LARGE);
      const thumb = b64_(req.thumb, LK.MAX_THUMB);
      if (!large || !thumb) return bad_('Ảnh chưa tải lên được. Thử lại nhé.');
      const preview = String(req.preview || '');
      if (!/^data:image\/(jpeg|webp|png);base64,/.test(preview) || preview.length > LK.MAX_PREVIEW) return bad_('Ảnh chưa tải lên được. Thử lại nhé.');
      row.largeId = save_(large, 'image/jpeg', row.id + '.jpg', 'F_LARGE');
      row.thumbId = save_(thumb, 'image/jpeg', row.id + '.jpg', 'F_THUMBS');
      row.preview = preview;
    }
    withLock_(() => append_('LK_Posts', row));
    return { ok: true, post: postOut_(row, []) };
  },

  /** The untouched original, sent after the post is up. */
  lkOriginal(req, me) {
    const r = find_('LK_Posts', req.id);
    if (!r || r.deleted === 'TRUE' || r.type !== 'photo') return notFound_();
    if (r.author !== me.side) return bad_('Chỉ người kẹp mới gửi được ảnh gốc.');
    const data = b64_(req.data, LK.MAX_ORIGINAL);
    if (!data) return bad_('Ảnh gốc quá lớn.');
    const mime = /^image\/[a-z0-9.+-]+$/i.test(req.mime || '') ? req.mime : 'application/octet-stream';
    const name = r.id + '-' + clean_(req.name, 80).replace(/[\\/]/g, '_');
    const id = save_(data, mime, name, 'F_ORIGINALS');
    withLock_(() => update_('LK_Posts', r._row, { origId: id }));
    return { ok: true };
  },

  lkEdit(req, me) {
    const r = find_('LK_Posts', req.id);
    if (!r || r.deleted === 'TRUE') return notFound_();
    if (r.author !== me.side) return bad_('Chỉ sửa được ghim của mình thôi.');
    const patch = { editedAt: new Date().toISOString() };
    if (req.paper !== undefined && LK.PAPERS.indexOf(req.paper) >= 0) patch.paper = req.paper;
    if (req.blurred !== undefined) patch.blurred = req.blurred ? 'TRUE' : 'FALSE';
    if (req.caption !== undefined && r.type === 'photo') patch.caption = clean_(req.caption, LK.CAPTION_MAX);
    if (req.body !== undefined && r.type === 'note') {
      patch.body = clean_(req.body, LK.NOTE_MAX);
      if (!patch.body) return bad_('Ghi chú không được để trống.');
    }
    withLock_(() => update_('LK_Posts', r._row, patch));
    return { ok: true, post: postOut_(Object.assign({}, r, patch), reactionsFor_(r.id)) };
  },

  /** Nothing is ever destroyed: the files move to "trash bin" and the row is marked. */
  lkDelete(req, me) {
    const r = find_('LK_Posts', req.id);
    if (!r || r.deleted === 'TRUE') return notFound_();
    if (r.author !== me.side) return bad_('Chỉ xoá được ghim của mình thôi.');
    const trash = DriveApp.getFolderById(must_('F_TRASH'));
    [r.origId, r.largeId, r.thumbId].forEach(id => { if (id) try { DriveApp.getFileById(id).moveTo(trash); } catch (x) { /* already gone */ } });
    withLock_(() => update_('LK_Posts', r._row, { deleted: 'TRUE', deletedAt: new Date().toISOString() }));
    return { ok: true };
  },

  /** Photos for signed-in people only, as data URLs. size: 'thumb' | 'large'. */
  lkImages(req) {
    const want = (Array.isArray(req.ids) ? req.ids : []).slice(0, 24).map(String);
    const size = req.size === 'large' ? 'largeId' : 'thumbId';
    const images = {};
    rows_('LK_Posts').forEach(r => {
      if (want.indexOf(r.id) < 0 || r.deleted === 'TRUE' || !r[size]) return;
      try { images[r.id] = dataUrl_(DriveApp.getFileById(r[size])); } catch (x) { /* missing file */ }
    });
    return { ok: true, images };
  },

  /** The other person opened the post (tapped to unblur, or opened it full screen). */
  lkSeen(req, me) {
    const r = find_('LK_Posts', req.id);
    if (!r || r.deleted === 'TRUE') return notFound_();
    if (r.author === me.side || r.seenAt) return { ok: true, seenAt: r.seenAt || '' };
    const seenAt = new Date().toISOString();
    withLock_(() => update_('LK_Posts', r._row, { seenAt }));
    return { ok: true, seenAt };
  },

  lkReact(req, me) {
    const post = find_('LK_Posts', req.postId);
    if (!post || post.deleted === 'TRUE') return notFound_();
    const stickerId = String(req.stickerId || '');
    if (!stickerAllowed_(stickerId)) return bad_('Sticker này không còn nữa.');
    let row;
    const result = withLock_(() => {
      const mine = rows_('LK_Reactions').filter(r => r.postId === post.id && r.author === me.side && r.removed !== 'TRUE');
      if (mine.length >= LK.STICKERS_PER_PERSON) return { ok: false, error: 'limit', message: 'Mỗi người dán tối đa ' + LK.STICKERS_PER_PERSON + ' sticker cho một ghim thôi.' };
      row = { id: 'rx_' + Utilities.getUuid().replace(/-/g, '').slice(0, 10), postId: post.id, author: me.side,
        stickerId, createdAt: new Date().toISOString(), removed: 'FALSE' };
      append_('LK_Reactions', row);
      return null;
    });
    if (result) return result;
    return { ok: true, reaction: { id: row.id, author: row.author, stickerId: row.stickerId, createdAt: row.createdAt } };
  },

  lkUnreact(req, me) {
    const r = find_('LK_Reactions', req.id);
    if (!r || r.removed === 'TRUE') return { ok: true };
    if (r.author !== me.side) return bad_('Chỉ gỡ được sticker của mình thôi.');
    withLock_(() => update_('LK_Reactions', r._row, { removed: 'TRUE' }));
    return { ok: true };
  },

  /** The starter pack (files in stickers/pack) and this person's own uploads. */
  lkStickers(req, me) {
    const pack = [];
    const it = DriveApp.getFolderById(must_('F_PACK')).getFiles();
    while (it.hasNext()) {
      const f = it.next();
      if (/^image\//.test(f.getMimeType())) pack.push({ id: f.getId(), name: f.getName() });
    }
    pack.sort((a, b) => a.name.localeCompare(b.name));
    const mine = rows_('LK_Stickers').filter(r => r.owner === me.side && r.removed !== 'TRUE')
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map(r => ({ id: r.fileId }));
    return { ok: true, pack: pack.map(p => ({ id: p.id })), mine };
  },

  lkStickerImages(req) {
    const want = (Array.isArray(req.ids) ? req.ids : []).slice(0, 40).map(String);
    const images = {};
    want.forEach(id => {
      if (!stickerAllowed_(id)) return;
      try { images[id] = dataUrl_(DriveApp.getFileById(id)); } catch (x) { /* missing */ }
    });
    return { ok: true, images };
  },

  /** A custom sticker, already cut round with a white border by the page. */
  lkUploadSticker(req, me) {
    const data = b64_(req.data, LK.MAX_STICKER);
    if (!data) return bad_('Ảnh sticker quá lớn.');
    const id = save_(data, 'image/png', me.side + '-' + Date.now() + '.png', 'F_STICKERS');
    withLock_(() => append_('LK_Stickers', { id, owner: me.side, source: 'custom', fileId: id, createdAt: new Date().toISOString(), removed: 'FALSE' }));
    return { ok: true, sticker: { id } };
  },

  /** Where this person is, to the nearest ~10 km, for the "Bầu trời bên kia" chip. */
  lkPlace(req, me) {
    const lat = Math.round(Number(req.lat) * 10) / 10;
    const lon = Math.round(Number(req.lon) * 10) / 10;
    if (!isFinite(lat) || !isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) return bad_('Vị trí không hợp lệ.');
    const row = { side: me.side, city: clean_(req.city, 60), lat: String(lat), lon: String(lon), tz: clean_(req.tz, 60), updatedAt: new Date().toISOString() };
    withLock_(() => {
      const r = rows_('LK_Places').find(x => x.side === me.side);
      if (r) update_('LK_Places', r._row, row); else append_('LK_Places', row);
    });
    return { ok: true };
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
function notFound_() { return { ok: false, error: 'not_found', message: 'Ghim này không còn nữa.' }; }

function must_(name) {
  const v = PropertiesService.getScriptProperties().getProperty(name);
  if (!v) throw new Error('Thiếu Script property: ' + name + ' (chạy setup() trước).');
  return v;
}

function clean_(s, max) {
  return String(s == null ? '' : s).replace(/\r\n?/g, '\n').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').trim().slice(0, max);
}

/** Strips an optional data: prefix; returns null when missing or too big. */
function b64_(s, max) {
  s = String(s || '').replace(/^data:[^;]+;base64,/, '');
  if (!s || s.length > max || !/^[A-Za-z0-9+/=]+$/.test(s)) return null;
  return s;
}

function save_(b64, mime, name, folderProp) {
  const blob = Utilities.newBlob(Utilities.base64Decode(b64), mime, name);
  return DriveApp.getFolderById(must_(folderProp)).createFile(blob).getId();
}

function dataUrl_(file) {
  const blob = file.getBlob();
  return 'data:' + blob.getContentType() + ';base64,' + Utilities.base64Encode(blob.getBytes());
}

let SS_ = null;
function sheet_(name) {
  if (!SS_) SS_ = SpreadsheetApp.openById(must_('SHEET_ID'));
  return SS_.getSheetByName(name);
}

function rows_(name) {
  const sh = sheet_(name);
  const values = sh.getDataRange().getValues();
  const head = values.shift() || [];
  return values.map((v, i) => {
    const o = { _row: i + 2 };
    head.forEach((h, j) => { o[h] = v[j] instanceof Date ? v[j].toISOString() : String(v[j]); });
    return o;
  }).filter(o => o.id || o.side);
}

function find_(name, id) {
  id = String(id || '');
  return id ? rows_(name).find(r => r.id === id) || null : null;
}

function append_(name, obj) {
  const head = LK.SHEETS[name];
  sheet_(name).appendRow(head.map(h => obj[h] == null ? '' : String(obj[h])));
}

function update_(name, rowNum, patch) {
  const head = LK.SHEETS[name];
  const sh = sheet_(name);
  Object.keys(patch).forEach(k => {
    const col = head.indexOf(k);
    if (col >= 0) sh.getRange(rowNum, col + 1).setValue(String(patch[k]));
  });
}

function withLock_(fn) {
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try { return fn(); } finally { lock.releaseLock(); }
}

function reactionsFor_(postId) {
  return rows_('LK_Reactions').filter(r => r.postId === postId && r.removed !== 'TRUE')
    .map(r => ({ id: r.id, author: r.author, stickerId: r.stickerId, createdAt: r.createdAt }));
}

function postOut_(r, reactions) {
  return {
    id: r.id, type: r.type, author: r.author, paper: r.paper,
    caption: r.caption, body: r.body, blurred: r.blurred === 'TRUE',
    hasPhoto: !!r.thumbId, preview: r.preview, city: r.city,
    createdAt: r.createdAt, editedAt: r.editedAt, seenAt: r.seenAt,
    reactions,
  };
}

function places_() {
  const out = {};
  rows_('LK_Places').forEach(r => {
    out[r.side] = { city: r.city, lat: Number(r.lat), lon: Number(r.lon), tz: r.tz, updatedAt: r.updatedAt };
  });
  return out;
}

/** Only stickers from the pack folder or uploaded through this app can be shown. */
function stickerAllowed_(id) {
  if (!/^[A-Za-z0-9_-]{10,}$/.test(id)) return false;
  if (rows_('LK_Stickers').some(r => r.fileId === id && r.removed !== 'TRUE')) return true;
  try {
    const parents = DriveApp.getFileById(id).getParents();
    const pack = must_('F_PACK');
    while (parents.hasNext()) if (parents.next().getId() === pack) return true;
  } catch (x) { /* not found */ }
  return false;
}
