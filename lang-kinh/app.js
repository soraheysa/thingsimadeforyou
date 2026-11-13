/*
 * Lăng kính — the board.
 * Polaroids and sticky notes clipped to a red thread: horizontal on desktop, down the middle on phones,
 * newest first. Photos stay private in Drive and come through the backend only for the two of you.
 */
(function () {
  'use strict';

  const A = window.Auth;
  const C = window.LK_CONFIG;
  const Sky = window.LKSky;
  const $ = s => document.querySelector(s);
  const $$ = (s, root) => Array.from((root || document).querySelectorAll(s));
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const pad = n => String(n).padStart(2, '0');
  const cap = s => s ? s.charAt(0).toUpperCase() + s.slice(1) : s;

  const MOCK = A.DEMO;
  const NO_BACKEND = !MOCK && !C.API_URL;
  const TZ = (() => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone; } catch (e) { return ''; } })();
  const isDesktop = () => window.matchMedia('(min-width: 760px)').matches;

  const me = { side: A.ls.get('side') || 'right' };
  const other = () => (me.side === 'left' ? 'right' : 'left');
  const nameOf = side => C.NAMES[side] || '';
  const selfWord = () => C.SELF[me.side] || 'mình';
  const paperHex = key => (C.PAPERS.find(p => p.key === key) || C.PAPERS[0]).hex;

  const state = {
    posts: [], hasMore: false, loading: false, places: {},
    revealed: new Set(),           // un-blurred during this visit only
    photos: {}, photosLarge: {},   // id → data URL
    stickers: {},                  // sticker id → data URL
    pack: null, mine: null,        // sticker lists for the tray
    place: null,                   // this device's place (rounded)
    viewing: null, trayTab: 'pack',
    known: new Set(),              // posts already on the thread: anything else slides up when it arrives
  };

  /* ───────── Icons ───────── */
  const svg = (d, size, extra) => `<svg width="${size || 14}" height="${size || 14}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" ${extra || ''}>${d}</svg>`;
  const I = {
    pin: s => svg('<path d="M12 22s7-6.2 7-12a7 7 0 0 0-14 0c0 5.8 7 12 7 12z"/><circle cx="12" cy="10" r="2.5"/>', s),
    eye: s => svg('<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>', s),
    eyeClosed: s => svg('<path d="M2 10c3 4 6.5 6 10 6s7-2 10-6"/><path d="M5 13.5l-1.5 2M9.3 15.6l-.6 2.4M14.7 15.6l.6 2.4M19 13.5l1.5 2"/>', s),
    eyeOff: s => svg('<path d="M3 3l18 18"/><path d="M10.6 5.1A10 10 0 0 1 12 5c6.5 0 10 7 10 7a17 17 0 0 1-3.2 4.1M6.6 6.6C3.9 8.4 2 12 2 12s3.5 7 10 7a9.7 9.7 0 0 0 5.4-1.6"/><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2"/>', s),
    x: s => svg('<path d="M18 6L6 18M6 6l12 12"/>', s, 'stroke-width="2.6"'),
    upload: s => svg('<path d="M12 16V4M7 9l5-5 5 5"/><path d="M4 20h16"/>', s),
    sun: s => svg('<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>', s),
    moon: s => svg('<path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z"/>', s),
    cloud: s => svg('<path d="M7 18a4.5 4.5 0 1 1 1-8.9A5.5 5.5 0 0 1 18.6 11 3.5 3.5 0 0 1 18 18H7z"/>', s),
    rain: s => svg('<path d="M7 15a4 4 0 1 1 1-7.9A5 5 0 0 1 17.6 9 3.5 3.5 0 0 1 17 16H7"/><path d="M8 19l-1 2M12 19l-1 2M16 19l-1 2"/>', s),
    snow: s => svg('<path d="M12 2v20M4.9 7l14.2 10M4.9 17L19.1 7"/>', s),
  };
  function weatherIcon(kind, phase, size) {
    if (kind === 'rain' || kind === 'storm') return I.rain(size);
    if (kind === 'snow') return I.snow(size);
    if (kind === 'overcast' || kind === 'fog') return I.cloud(size);
    return phase === 'night' ? I.moon(size) : I.sun(size);
  }

  /* ───────── Small helpers ───────── */
  let toastTimer;
  function toast(msg) {
    const t = $('#toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('show'), 3200);
  }

  function hash(s) { let h = 0x811c9dc5; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; } return h >>> 0; }
  function tilts(id) {
    const h = hash(id);
    const a = (h % 1000) / 1000;
    const sign = (h >> 11) & 1 ? 1 : -1;
    return { tilt: (sign * (1.2 + a * 2.3)).toFixed(2) + 'deg', mtilt: (3.5 + a * 2).toFixed(2) + 'deg' };
  }

  function fmtTime(iso) {
    const d = new Date(iso);
    if (isNaN(d)) return '';
    const hm = pad(d.getHours()) + ':' + pad(d.getMinutes());
    return d.toDateString() === new Date().toDateString() ? hm : pad(d.getDate()) + '/' + pad(d.getMonth() + 1) + ' ' + hm;
  }

  function confirmBox(title, text, yes) {
    const dlg = $('#dlg-confirm');
    $('#confirm-title').textContent = title;
    $('#confirm-text').textContent = text;
    $('#confirm-yes').textContent = yes;
    dlg.showModal();
    return new Promise(res => {
      const done = e => {
        const b = e.target.closest('[data-answer]');
        if (!b) return;
        dlg.removeEventListener('click', done);
        dlg.close();
        res(b.dataset.answer === 'yes');
      };
      dlg.addEventListener('click', done);
      dlg.addEventListener('close', () => res(false), { once: true });
    });
  }

  /* ───────── Backend ───────── */
  async function api(action, payload) {
    if (MOCK) return window.LKMock.handle(Object.assign({ action }, payload || {}), me.side);
    try {
      const res = await fetch(C.API_URL, {
        method: 'POST',   // no Content-Type header, so Apps Script needs no CORS preflight
        body: JSON.stringify(Object.assign({ action, tz: TZ }, A.credentials(), payload || {})),
        redirect: 'follow',
      });
      if (!res.ok) return { ok: false, error: 'network' };
      const r = await res.json();
      if (r && r.error === 'auth') { A.expired(); return new Promise(() => {}); }
      return r;
    } catch (e) {
      return { ok: false, error: 'network' };
    }
  }
  const errText = r => r.message || (r.error === 'network' ? 'Không kết nối được. Kiểm tra mạng rồi thử lại nhé.' : 'Có lỗi xảy ra. Thử lại sau chút nữa nhé.');

  /* Photos and stickers never change, so each device keeps them after the first download. */
  const cache = (() => {
    let dbp = null;
    const open = () => dbp || (dbp = new Promise((res, rej) => {
      const r = indexedDB.open('lang-kinh', 1);
      r.onupgradeneeded = () => r.result.createObjectStore('img');
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    }));
    return {
      async get(k) {
        if (MOCK) return null;
        try { const db = await open(); return await new Promise(res => { const q = db.transaction('img').objectStore('img').get(k); q.onsuccess = () => res(q.result || null); q.onerror = () => res(null); }); }
        catch (e) { return null; }
      },
      async set(k, v) {
        if (MOCK) return;
        try { const db = await open(); db.transaction('img', 'readwrite').objectStore('img').put(v, k); } catch (e) { /* storage full or blocked */ }
      },
    };
  })();

  const inFlight = new Set();
  async function loadPhotos(ids, size) {
    const store = size === 'large' ? state.photosLarge : state.photos;
    ids = ids.filter(id => !store[id] && !inFlight.has(size + id));
    if (!ids.length) return;
    ids.forEach(id => inFlight.add(size + id));
    const missing = [];
    for (const id of ids) {
      const v = await cache.get(size + ':' + id);
      if (v) store[id] = v; else missing.push(id);
    }
    for (let i = 0; i < missing.length; i += 12) {
      const chunk = missing.slice(i, i + 12);
      const r = await api('lkImages', { ids: chunk, size });
      if (r.ok) Object.keys(r.images || {}).forEach(id => { store[id] = r.images[id]; cache.set(size + ':' + id, r.images[id]); });
    }
    ids.forEach(id => inFlight.delete(size + id));
    ids.forEach(id => patchPhoto(id));
  }

  async function loadStickers(ids) {
    ids = Array.from(new Set(ids)).filter(id => id && !state.stickers[id] && !inFlight.has('st' + id));
    if (!ids.length) return;
    ids.forEach(id => inFlight.add('st' + id));
    const missing = [];
    for (const id of ids) {
      const v = await cache.get('st:' + id);
      if (v) state.stickers[id] = v; else missing.push(id);
    }
    for (let i = 0; i < missing.length; i += 20) {
      const r = await api('lkStickerImages', { ids: missing.slice(i, i + 20) });
      if (r.ok) Object.keys(r.images || {}).forEach(id => { state.stickers[id] = r.images[id]; cache.set('st:' + id, r.images[id]); });
    }
    ids.forEach(id => inFlight.delete('st' + id));
    $$('.st[data-sid]').forEach(b => {
      const src = state.stickers[b.dataset.sid];
      if (src && !b.querySelector('img')) { b.classList.remove('is-loading'); b.insertAdjacentHTML('afterbegin', `<img src="${src}" alt="">`); }
    });
    if (state.viewing) renderTray();
  }

  /* ───────── Drawing a post ───────── */
  const STICKER_SPOTS = [
    'right:-18px;top:30px;--r:14deg', 'left:-16px;bottom:26px;--r:-10deg', 'right:-14px;top:96px;--r:-8deg',
    'left:-18px;top:150px;--r:-14deg', 'right:-12px;bottom:44px;--r:10deg', 'left:-12px;top:40px;--r:-12deg',
  ];

  function isSoft(p) { return p.blurred && !state.revealed.has(p.id); }

  function seenHTML(p) {
    if (p.seenAt) {
      const t = fmtTime(p.seenAt);
      return `<span aria-label="Đã xem lúc ${esc(t)}">${I.eye(15)}${esc(t)}</span>`;
    }
    return `<span class="unseen" aria-label="Chưa xem">${I.eyeClosed(16)}</span>`;
  }

  function stickersHTML(p, inViewer) {
    return (p.reactions || []).slice(0, 6).map((r, i) => {
      const src = state.stickers[r.stickerId];
      const mine = r.author === me.side;
      const label = inViewer && mine ? 'Gỡ sticker của mình' : 'Sticker của ' + nameOf(r.author);
      return `<button type="button" class="st${src ? '' : ' is-loading'}" data-act="sticker" data-rid="${esc(r.id)}" data-sid="${esc(r.stickerId)}"
        style="${STICKER_SPOTS[i]};transform:rotate(var(--r))" aria-label="${esc(label)}">${src ? `<img src="${src}" alt="">` : ''}${inViewer && mine ? `<span class="x">${I.x(12)}</span>` : ''}</button>`;
    }).join('');
  }

  function cardHTML(p, o) {
    o = o || {};
    const t = tilts(p.id);
    const soft = isSoft(p);
    const cls = ['post', p.type === 'note' ? 'is-note' : 'is-photo', 'by-' + p.author];
    if (!o.inViewer) { cls.push(o.index % 2 ? 'pos-r' : 'pos-l'); if (o.index === 0) cls.push('is-first'); }
    let body;
    if (p.type === 'photo') {
      const src = o.inViewer ? (state.photosLarge[p.id] || state.photos[p.id]) : state.photos[p.id];
      const img = soft || !src ? `<img class="is-soft" src="${esc(p.preview || '')}" alt="">` : `<img src="${src}" alt="${esc(p.caption || 'Ảnh')}">`;
      body = `<button class="photo" type="button" data-act="${soft ? 'reveal' : 'open'}" aria-label="${soft ? 'Chạm để xem ảnh' : 'Mở ảnh'}">${img}${soft ? `<span class="reveal">${I.eyeOff(18)} Chạm để xem</span>` : ''}</button>
        ${p.caption ? `<p class="caption">${esc(p.caption)}</p>` : ''}`;
    } else {
      const long = p.body.length > 150 || (p.body.match(/\n/g) || []).length > 4;
      body = `<div class="note-wrap"><p class="note-text${soft ? ' is-soft' : ''}">${esc(p.body)}</p>
          ${soft ? `<button class="reveal" type="button" data-act="reveal">${I.eyeOff(18)} Chạm để xem</button>` : ''}</div>
        ${!soft && long && !o.inViewer ? '<span class="read-more">…đọc tiếp</span>' : ''}`;
    }
    const opener = p.type === 'note' && !soft && !o.inViewer ? `<button class="note-open" type="button" data-act="open" aria-label="Mở ghi chú"></button>` : '';
    return `<article class="${cls.join(' ')}" data-id="${esc(p.id)}" style="--tilt:${t.tilt};--mtilt:${t.mtilt};--paper-bg:${paperHex(p.paper)}">
      <span class="clip" aria-hidden="true"><i></i><i></i><b></b></span>
      <div class="card">${body}
        <div class="meta">${p.city ? `<span>${I.pin(14)}${esc(p.city)}</span>` : '<span></span>'}${seenHTML(p)}</div>
        ${opener}
      </div>
      ${stickersHTML(p, o.inViewer)}
    </article>`;
  }

  /* ───────── The board ───────── */
  const postById = id => state.posts.find(p => p.id === id);

  function render() {
    const parts = ['<div class="thread" aria-hidden="true"></div>'];
    if (!state.posts.length) parts.push('<p class="empty">Sợi chỉ còn trống. Kẹp tấm đầu tiên nhé!</p>');
    else {
      parts.push('<div class="washi">Mới nhất</div>');
      state.posts.forEach((p, i) => {
        let html = cardHTML(p, { index: i });
        if (!state.known.has(p.id)) html = html.replace('class="post ', 'class="post is-new ');
        parts.push(html);
      });
      if (state.hasMore) parts.push('<span class="more-mark" aria-hidden="true">…</span>');
    }
    $('#track').innerHTML = parts.join('');
    state.posts.forEach(p => state.known.add(p.id));
    fillImages();
    updateNav();
  }

  function rerenderPost(p) {
    const el = $(`#track .post[data-id="${CSS.escape(p.id)}"]`);
    if (el) el.outerHTML = cardHTML(p, { index: state.posts.indexOf(p) });
    fillImages();
  }

  function patchPhoto(id) {
    const p = postById(id) || (state.viewing && state.viewing.id === id ? state.viewing : null);
    if (!p || isSoft(p)) return;
    const boardImg = $(`#track .post[data-id="${CSS.escape(id)}"] .photo img`);
    if (boardImg && state.photos[id]) { boardImg.src = state.photos[id]; boardImg.classList.remove('is-soft'); boardImg.alt = p.caption || 'Ảnh'; }
    const viewImg = $(`#viewer-post .post[data-id="${CSS.escape(id)}"] .photo img`);
    const src = state.photosLarge[id] || state.photos[id];
    if (viewImg && src) { viewImg.src = src; viewImg.classList.remove('is-soft'); }
  }

  function fillImages() {
    loadPhotos(state.posts.filter(p => p.type === 'photo' && p.hasPhoto !== false && !isSoft(p)).map(p => p.id), 'thumb');
    const ids = [];
    state.posts.forEach(p => (p.reactions || []).forEach(r => ids.push(r.stickerId)));
    loadStickers(ids);
  }

  async function loadFirst() {
    const r = await api('lkList', { limit: C.PAGE_SIZE });
    if (!r.ok) { $('#track').innerHTML = `<div class="thread" aria-hidden="true"></div><p class="empty">${esc(errText(r))}</p>`; return false; }
    if (r.me && r.me.side) me.side = r.me.side;
    state.posts = r.posts || [];
    state.posts.forEach(p => state.known.add(p.id));
    state.hasMore = !!r.hasMore;
    state.places = r.places || {};
    render();
    setTimeout(() => $('#track').classList.add('no-anim'), 900);
    updateOtherChip();
    return true;
  }

  async function poll() {
    if (document.hidden || state.loading || NO_BACKEND) return;
    const r = await api('lkList', { limit: Math.min(40, Math.max(C.PAGE_SIZE, state.posts.length)) });
    if (!r.ok) return;
    const before = JSON.stringify(state.posts);
    const page = r.posts || [];
    const oldest = page.length ? page[page.length - 1].createdAt : '';
    const older = r.hasMore && oldest ? state.posts.filter(p => p.createdAt < oldest) : [];
    state.posts = page.concat(older);
    if (!older.length) state.hasMore = !!r.hasMore;
    state.places = r.places || state.places;
    if (JSON.stringify(state.posts) !== before) render();
    updateOtherChip();
  }

  async function loadMore() {
    if (!state.hasMore || state.loading || !state.posts.length) return;
    state.loading = true;
    const r = await api('lkList', { limit: C.PAGE_SIZE, before: state.posts[state.posts.length - 1].createdAt });
    state.loading = false;
    if (!r.ok) return;
    const have = new Set(state.posts.map(p => p.id));
    state.posts = state.posts.concat((r.posts || []).filter(p => !have.has(p.id)));
    state.posts.forEach(p => state.known.add(p.id));
    state.hasMore = !!r.hasMore;
    render();
  }

  function updateNav() {
    const b = $('#board');
    $('#btn-newest').disabled = b.scrollLeft < 10;
    $('#btn-older').disabled = b.scrollLeft + b.clientWidth >= b.scrollWidth - 10 && !state.hasMore;
  }

  /* ───────── Seeing, revealing ───────── */
  function markSeen(p) {
    if (p.author === me.side || p.seenAt) return;
    p.seenAt = new Date().toISOString();
    api('lkSeen', { id: p.id }).then(r => { if (r.ok && r.seenAt) p.seenAt = r.seenAt; });
  }

  function reveal(p) {
    state.revealed.add(p.id);
    markSeen(p);
    rerenderPost(p);
  }

  /* ───────── Opened post + stickers ───────── */
  function openViewer(p) {
    state.revealed.add(p.id);
    markSeen(p);
    state.viewing = p;
    renderViewer();
    const dlg = $('#dlg-viewer');
    if (!dlg.open) dlg.showModal();
    if (p.type === 'photo') loadPhotos([p.id], 'large');
    ensureTray();
  }

  function renderViewer() {
    const p = state.viewing;
    if (!p) return;
    $('#viewer-who').textContent = nameOf(p.author) + ' kẹp · ' + fmtTime(p.createdAt);
    $('#viewer-actions').innerHTML = p.author === me.side
      ? '<button type="button" data-v="edit">Sửa</button><button type="button" data-v="delete">Xoá</button>' : '';
    $('#viewer-post').innerHTML = cardHTML(p, { inViewer: true });
    renderTray();
  }

  async function ensureTray() {
    if (state.pack) return;
    const r = await api('lkStickers');
    if (!r.ok) { state.pack = []; state.mine = []; renderTray(); return; }
    state.pack = r.pack || [];
    state.mine = r.mine || [];
    renderTray();
    loadStickers(state.pack.concat(state.mine).map(s => s.id));
  }

  function myCount(p) { return (p.reactions || []).filter(r => r.author === me.side).length; }

  function renderTray() {
    const p = state.viewing;
    if (!p) return;
    const n = myCount(p);
    const full = n >= C.STICKERS_PER_PERSON;
    $('#tray-count').textContent = cap(selfWord()) + ' đã dán ' + n + '/' + C.STICKERS_PER_PERSON;
    $('#tab-mine').textContent = 'Sticker của ' + selfWord();
    $$('#tray-tabs button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.tab === state.trayTab)));
    const list = state.trayTab === 'pack' ? state.pack : state.mine;
    let html;
    if (!list) html = '<p class="tray-empty">Đang lấy sticker…</p>';
    else {
      html = list.map(s => {
        const src = state.stickers[s.id];
        return `<button type="button" data-sid="${esc(s.id)}" aria-label="Dán sticker" ${full ? 'disabled' : ''}>${src ? `<img src="${src}" alt="">` : ''}</button>`;
      }).join('');
      if (!list.length && state.trayTab === 'pack') html = '<p class="tray-empty">Bộ sticker đang được chuẩn bị.</p>';
    }
    html += `<button type="button" class="upload" data-upload ${full ? 'disabled' : ''}>${I.upload(20)}Tải ảnh lên</button>`;
    $('#tray-grid').innerHTML = html;
  }

  async function react(p, stickerId) {
    if (myCount(p) >= C.STICKERS_PER_PERSON) { toast('Mỗi người dán tối đa ' + C.STICKERS_PER_PERSON + ' sticker cho một ghim thôi.'); return; }
    const r = await api('lkReact', { postId: p.id, stickerId });
    if (!r.ok) { toast(errText(r)); return; }
    p.reactions = (p.reactions || []).concat([r.reaction]);
    renderViewer();
    rerenderPost(p);
  }

  async function unreact(p, rid) {
    const ok = await confirmBox('Gỡ sticker này?', 'Sticker sẽ được gỡ khỏi ghim.', 'Gỡ');
    if (!ok) return;
    const r = await api('lkUnreact', { id: rid });
    if (!r.ok) { toast(errText(r)); return; }
    p.reactions = (p.reactions || []).filter(x => x.id !== rid);
    renderViewer();
    rerenderPost(p);
  }

  async function uploadSticker(file) {
    const p = state.viewing;
    let data;
    try { data = await makeSticker(file); } catch (e) { toast('Ảnh này chưa đọc được. Chọn ảnh JPG hoặc PNG nhé.'); return; }
    toast('Đang làm sticker…');
    const r = await api('lkUploadSticker', { data: data.split(',')[1] });
    if (!r.ok) { toast(errText(r)); return; }
    state.stickers[r.sticker.id] = data;
    cache.set('st:' + r.sticker.id, data);
    state.mine = [{ id: r.sticker.id }].concat(state.mine || []);
    state.trayTab = 'mine';
    if (p) await react(p, r.sticker.id);
  }

  async function deletePost(p) {
    const ok = await confirmBox('Gỡ ghim này khỏi sợi chỉ?', 'Ghim sẽ được cất vào thùng rác trong Drive, không mất hẳn.', 'Gỡ ghim');
    if (!ok) return;
    const r = await api('lkDelete', { id: p.id });
    if (!r.ok) { toast(errText(r)); return; }
    state.posts = state.posts.filter(x => x.id !== p.id);
    closeSheet($('#dlg-viewer'));
    render();
    toast('Đã gỡ ghim khỏi sợi chỉ.');
  }

  /* ───────── Images on the device ───────── */
  async function decodeImage(file) {
    if ('createImageBitmap' in window) {
      try { return await createImageBitmap(file, { imageOrientation: 'from-image' }); } catch (e) { /* older browser: fall back */ }
    }
    const url = URL.createObjectURL(file);
    try {
      return await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = url; });
    } finally { setTimeout(() => URL.revokeObjectURL(url), 2000); }
  }
  const dims = img => ({ w: img.width || img.naturalWidth, h: img.height || img.naturalHeight });

  function toJpeg(img, max, quality) {
    const d = dims(img);
    const s = Math.min(1, max / Math.max(d.w, d.h));
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(d.w * s));
    c.height = Math.max(1, Math.round(d.h * s));
    const x = c.getContext('2d');
    x.fillStyle = '#FFFFFF';
    x.fillRect(0, 0, c.width, c.height);
    x.drawImage(img, 0, 0, c.width, c.height);
    return c.toDataURL('image/jpeg', quality);
  }

  async function processPhoto(file) {
    const img = await decodeImage(file);
    if (!dims(img).w) throw new Error('decode');
    return { large: toJpeg(img, 1600, 0.85), thumb: toJpeg(img, 480, 0.8), preview: toJpeg(img, 24, 0.5) };
  }

  /** A round sticker with a white die-cut border. */
  async function makeSticker(file) {
    const img = await decodeImage(file);
    const d = dims(img);
    const side = Math.min(d.w, d.h);
    const c = document.createElement('canvas');
    c.width = c.height = 256;
    const x = c.getContext('2d');
    x.fillStyle = '#FFFFFF';
    x.beginPath(); x.arc(128, 128, 127, 0, Math.PI * 2); x.fill();
    x.save();
    x.beginPath(); x.arc(128, 128, 116, 0, Math.PI * 2); x.clip();
    x.drawImage(img, (d.w - side) / 2, (d.h - side) / 2, side, side, 12, 12, 232, 232);
    x.restore();
    return c.toDataURL('image/png');
  }

  function uploadOriginal(id, file) {
    if (MOCK || file.size > 22 * 1024 * 1024) return;
    const fr = new FileReader();
    fr.onload = async () => {
      const r = await api('lkOriginal', { id, data: String(fr.result).split(',')[1], mime: file.type, name: file.name });
      if (!r.ok) toast('Ảnh đã lên, nhưng ảnh gốc chưa lưu được.');
    };
    fr.readAsDataURL(file);
  }

  /* ───────── New / edit ───────── */
  const compose = { mode: 'photo', paper: 'kem', blur: false, file: null, url: '', edit: null };

  function openCompose(edit) {
    compose.edit = edit || null;
    compose.mode = edit ? (edit.type === 'note' ? 'note' : 'photo') : compose.mode;
    compose.paper = edit ? edit.paper : 'kem';
    compose.blur = edit ? !!edit.blurred : false;
    if (!edit) { compose.file = null; if (compose.url) URL.revokeObjectURL(compose.url); compose.url = ''; }
    $('#in-caption').value = edit ? edit.caption || '' : '';
    $('#in-note').value = edit ? edit.body || '' : '';
    $('#compose-title').textContent = edit ? 'Sửa ghim' : 'Ghim mới';
    $('#btn-submit').textContent = edit ? 'Lưu thay đổi' : 'Kẹp lên sợi chỉ';
    $('#compose-tabs').hidden = !!edit;
    $('#btn-pick').hidden = !!edit;
    $('#compose-error').textContent = '';
    syncCompose();
    $('#dlg-compose').showModal();
  }

  function syncCompose() {
    const photo = compose.mode === 'photo';
    $$('#compose-tabs button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.mode === compose.mode)));
    $$('[data-for]').forEach(el => { el.hidden = el.dataset.for !== compose.mode; });
    $$('#paper-grid button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.paper === compose.paper)));
    $('#paper-name').textContent = (C.PAPERS.find(p => p.key === compose.paper) || C.PAPERS[0]).name;
    $('#sw-blur').setAttribute('aria-checked', String(compose.blur));
    $('#btn-pick-label').textContent = compose.file ? 'Đổi ảnh' : 'Chọn ảnh';
    $('#caption-count').textContent = $('#in-caption').value.length + '/' + C.CAPTION_MAX;
    $('#note-count').textContent = $('#in-note').value.length + '/' + C.NOTE_MAX;
    const city = state.place && state.place.city;
    $('#compose-city').innerHTML = city ? `${I.pin(14)} Kẹp từ ${esc(city)}` : '';

    const bg = paperHex(compose.paper);
    const soft = compose.blur ? ' is-soft-preview' : '';
    let html;
    if (photo) {
      const src = compose.url || (compose.edit && state.photos[compose.edit.id]) || '';
      const pic = src ? `<img class="${soft}" src="${src}" alt="">` : '<span class="photo-empty">Chọn một tấm ảnh</span>';
      html = `<div class="card is-photo-card" style="--paper-bg:${bg}"><div class="photo">${pic}</div>
        <p class="caption">${esc($('#in-caption').value) || '&nbsp;'}</p></div>`;
    } else {
      html = `<div class="card is-note-card" style="--paper-bg:${bg}"><p class="note-text${soft}">${esc($('#in-note').value) || 'Viết gì đó cho nhau…'}</p></div>`;
    }
    $('#compose-preview').innerHTML = html;
  }

  async function submitCompose(e) {
    e.preventDefault();
    const err = $('#compose-error');
    const btn = $('#btn-submit');
    err.textContent = '';
    const caption = $('#in-caption').value.trim();
    const body = $('#in-note').value.trim();

    if (compose.edit) {
      const p = compose.edit;
      const payload = { id: p.id, paper: compose.paper, blurred: compose.blur };
      if (p.type === 'photo') payload.caption = caption;
      else { if (!body) { err.textContent = 'Ghi chú không được để trống.'; return; } payload.body = body; }
      btn.disabled = true;
      const r = await api('lkEdit', payload);
      btn.disabled = false;
      if (!r.ok) { err.textContent = errText(r); return; }
      Object.assign(p, r.post);
      closeSheet($('#dlg-compose'));
      rerenderPost(p);
      if (state.viewing === p) renderViewer();
      toast('Đã lưu.');
      return;
    }

    const photo = compose.mode === 'photo';
    if (photo && !compose.file) { err.textContent = 'Chọn một tấm ảnh trước đã nhé.'; return; }
    if (!photo && !body) { err.textContent = 'Viết vài chữ trước đã nhé.'; return; }
    btn.disabled = true;
    btn.textContent = 'Đang kẹp…';
    const payload = { type: photo ? 'photo' : 'note', paper: compose.paper, blurred: compose.blur,
      city: (state.place && state.place.city) || '', caption: photo ? caption : '', body: photo ? '' : body };
    let imgs = null;
    if (photo) {
      try { imgs = await processPhoto(compose.file); } catch (x) {
        btn.disabled = false; btn.textContent = 'Kẹp lên sợi chỉ';
        err.textContent = 'Ảnh này chưa đọc được (có thể là HEIC/HEIF). Đổi máy ảnh sang JPG hoặc chọn ảnh khác nhé.';
        return;
      }
      Object.assign(payload, imgs);
    }
    const r = await api('lkCreate', payload);
    btn.disabled = false;
    btn.textContent = 'Kẹp lên sợi chỉ';
    if (!r.ok) { err.textContent = errText(r); return; }
    if (imgs) {
      state.photos[r.post.id] = imgs.thumb; cache.set('thumb:' + r.post.id, imgs.thumb);
      state.photosLarge[r.post.id] = imgs.large; cache.set('large:' + r.post.id, imgs.large);
      uploadOriginal(r.post.id, compose.file);
    }
    state.posts.unshift(r.post);
    closeSheet($('#dlg-compose'));
    render();
    $('#board').scrollTo({ left: 0, top: 0, behavior: 'smooth' });
    toast('Đã kẹp lên sợi chỉ.');
  }

  /* ───────── Sky + the two places ───────── */
  function fallbackPlace() {
    const f = C.FALLBACK_PLACES[TZ];
    return f ? Object.assign({ tz: TZ }, f) : Object.assign({}, C.DEFAULT_PLACES[me.side]);
  }

  async function drawOwnSky() {
    const pl = state.place || fallbackPlace();
    let w = null;
    try { w = await Sky.fetchWeather(pl.lat, pl.lon); } catch (e) { /* offline: time of day only */ }
    const ph = Sky.phaseAt(pl.lat, pl.lon, new Date());
    const wo = w ? Sky.weatherOf(w.code) : { kind: 'partly', label: '' };
    Sky.draw($('#sky'), ph.phase, wo.kind, { elevation: ph.elevation });
    const now = new Date();
    const time = pad(now.getHours()) + ':' + pad(now.getMinutes());
    const chip = $('#chip-own');
    chip.innerHTML = `${weatherIcon(wo.kind, ph.phase, 16)}<span>${esc(pl.city || '')}${w ? ' · ' + esc(wo.label) + ' ' + w.tempC + '°C' : ''} · ${time}</span>`;
    chip.hidden = false;
  }

  async function updateOtherChip() {
    const side = other();
    const pl = Object.assign({}, C.DEFAULT_PLACES[side], state.places[side] || {});
    let w = null;
    try { w = await Sky.fetchWeather(pl.lat, pl.lon); } catch (e) { /* offline */ }
    const tz = pl.tz || (w && w.tz) || '';
    let time = '';
    try { time = tz ? new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date()) : ''; } catch (e) { /* bad tz */ }
    const ph = Sky.phaseAt(pl.lat, pl.lon, new Date());
    const wo = w ? Sky.weatherOf(w.code) : null;
    const chip = $('#chip-other');
    chip.innerHTML = `<span class="label">Bầu trời bên kia</span><span class="sep"></span>${weatherIcon(wo ? wo.kind : 'partly', ph.phase, 18)}
      <strong>${esc(pl.city || nameOf(side))}</strong><span>${wo ? esc(wo.label) + ' ' + w.tempC + '°C · ' : ''}${esc(time)}</span>`;
    chip.hidden = false;
  }

  async function startSky() {
    drawOwnSky();
    setInterval(drawOwnSky, 5 * 60e3);
    setInterval(updateOtherChip, 60e3);
    const place = await Sky.locate(C.FALLBACK_PLACES);
    if (!place) return;
    state.place = place;
    drawOwnSky();
    if ($('#dlg-compose').open) syncCompose();
    const key = [place.lat, place.lon, place.city].join('|');
    if (!NO_BACKEND && A.ss.get('lk_place_sent') !== key) {
      const r = await api('lkPlace', { lat: place.lat, lon: place.lon, city: place.city, tz: place.tz || TZ });
      if (r.ok) A.ss.set('lk_place_sent', key);
    }
  }

  /* ───────── Sheets: slide down to close (button, Esc, or drag) ───────── */
  function closeSheet(dlg, fromDrag) {
    if (!dlg || !dlg.open || dlg.classList.contains('is-closing')) return;
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduce) { dlg.close(); return; }
    if (!fromDrag) dlg.style.removeProperty('--drag');
    dlg.classList.remove('is-dragging', 'is-settling');
    dlg.style.transform = '';
    dlg.classList.add('is-closing');
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      dlg.classList.remove('is-closing');
      dlg.style.removeProperty('--drag');
      dlg.close();
    };
    dlg.addEventListener('animationend', finish, { once: true });
    setTimeout(finish, 400);   // in case the animation never reports back
  }

  /**
   * Drag a sheet down to close it, like a phone bottom sheet.
   * The drag starts only when the sheet's scroll area is at the top (or on a grip area), so scrolling still works.
   */
  function enableDragClose(dlg, scroller, grips) {
    let y0 = 0, t0 = 0, dy = 0, armed = false, dragging = false, fromGrip = false, moved = false;
    const atTop = () => { const sc = scroller(); return !sc || sc.scrollTop <= 0; };
    const skip = el => el.closest('input, textarea, select, [contenteditable="true"]');

    function start(y, target) {
      if (!dlg.open || dlg.classList.contains('is-closing') || skip(target)) return;
      armed = true; dragging = false; moved = false; dy = 0; y0 = y; t0 = performance.now();
      fromGrip = !!(grips && target.closest(grips));
    }
    function move(y, e) {
      if (!armed) return;
      const d = y - y0;
      if (!dragging) {
        if (Math.abs(d) < 8) return;
        if (d < 0 || (!fromGrip && !atTop())) { armed = false; return; }   // an upward move or a scroll
        dragging = true;
        dlg.classList.add('is-dragging');
      }
      if (e && e.cancelable) e.preventDefault();
      moved = true;
      dy = Math.max(0, d);
      dlg.style.transform = 'translateY(' + dy + 'px)';
    }
    function end() {
      if (!armed) return;
      armed = false;
      if (!dragging) return;
      dragging = false;
      setTimeout(() => { moved = false; }, 0);   // only the click that ends this drag is swallowed
      const speed = dy / Math.max(1, performance.now() - t0);   // px per ms
      dlg.classList.remove('is-dragging');
      if (dy > Math.min(140, dlg.offsetHeight * 0.25) || (dy > 40 && speed > 0.6)) {
        dlg.style.setProperty('--drag', dy + 'px');
        closeSheet(dlg, true);
      } else {
        dlg.classList.add('is-settling');
        dlg.style.transform = '';
        setTimeout(() => dlg.classList.remove('is-settling'), 300);
      }
    }

    dlg.addEventListener('touchstart', e => { if (e.touches.length === 1) start(e.touches[0].clientY, e.target); }, { passive: true });
    dlg.addEventListener('touchmove', e => { if (e.touches.length === 1) move(e.touches[0].clientY, e); }, { passive: false });
    dlg.addEventListener('touchend', end);
    dlg.addEventListener('touchcancel', end);
    dlg.addEventListener('mousedown', e => { if (e.button === 0) start(e.clientY, e.target); });
    window.addEventListener('mousemove', e => move(e.clientY, e));
    window.addEventListener('mouseup', end);
    // A drag that ends on a button must not also press it.
    dlg.addEventListener('click', e => { if (moved) { moved = false; e.stopPropagation(); e.preventDefault(); } }, true);
  }

  /* ───────── Wiring ───────── */
  function wire() {
    $('#paper-grid').innerHTML = C.PAPERS.map(p =>
      `<button type="button" data-paper="${p.key}" aria-label="${esc(p.name)}" style="background:${p.hex}"></button>`).join('');
    $('#in-caption').maxLength = C.CAPTION_MAX;
    $('#in-note').maxLength = C.NOTE_MAX;

    $('#btn-new').addEventListener('click', () => openCompose(null));
    $('#compose-tabs').addEventListener('click', e => { const b = e.target.closest('[data-mode]'); if (b) { compose.mode = b.dataset.mode; syncCompose(); } });
    $('#paper-grid').addEventListener('click', e => { const b = e.target.closest('[data-paper]'); if (b) { compose.paper = b.dataset.paper; syncCompose(); } });
    $('#sw-blur').addEventListener('click', () => { compose.blur = !compose.blur; syncCompose(); });
    $('#btn-pick').addEventListener('click', () => $('#file-photo').click());
    $('#file-photo').addEventListener('change', e => {
      const f = e.target.files && e.target.files[0];
      e.target.value = '';
      if (!f) return;
      if (compose.url) URL.revokeObjectURL(compose.url);
      compose.file = f;
      compose.url = URL.createObjectURL(f);
      syncCompose();
    });
    $('#in-caption').addEventListener('input', syncCompose);
    $('#in-note').addEventListener('input', syncCompose);
    $('#form-compose').addEventListener('submit', submitCompose);
    $$('[data-close]').forEach(b => b.addEventListener('click', () => closeSheet(b.closest('dialog'))));
    [$('#dlg-compose'), $('#dlg-viewer')].forEach(d => d.addEventListener('cancel', e => { e.preventDefault(); closeSheet(d); }));
    enableDragClose($('#dlg-viewer'), () => $('#dlg-viewer .viewer-body'));
    enableDragClose($('#dlg-compose'), () => $('#dlg-compose'), '.sheet-grip, .sheet-head, .compose-preview');

    // The board
    $('#track').addEventListener('click', e => {
      const el = e.target.closest('[data-act]');
      if (!el) return;
      const art = el.closest('.post');
      const p = art && postById(art.dataset.id);
      if (!p) return;
      const act = el.dataset.act;
      if (act === 'reveal') reveal(p);
      else if (act === 'open') openViewer(p);
      else if (act === 'sticker') {
        const r = (p.reactions || []).find(x => x.id === el.dataset.rid);
        if (r) toast(nameOf(r.author) + ' dán · ' + fmtTime(r.createdAt));
      }
    });

    const board = $('#board');
    board.addEventListener('wheel', e => {
      if (!isDesktop() || e.ctrlKey || Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return;
      board.scrollLeft += e.deltaY;
      e.preventDefault();
    }, { passive: false });
    board.addEventListener('scroll', () => {
      updateNav();
      const near = isDesktop()
        ? board.scrollLeft + board.clientWidth > board.scrollWidth - 700
        : board.scrollTop + board.clientHeight > board.scrollHeight - 900;
      if (near) loadMore();
    }, { passive: true });
    $('#btn-newest').addEventListener('click', () => board.scrollTo({ left: 0, behavior: 'smooth' }));
    $('#btn-older').addEventListener('click', () => { board.scrollBy({ left: board.clientWidth * 0.8, behavior: 'smooth' }); loadMore(); });

    // Opened post
    $('#viewer-actions').addEventListener('click', e => {
      const b = e.target.closest('[data-v]');
      if (!b || !state.viewing) return;
      if (b.dataset.v === 'edit') openCompose(state.viewing);
      if (b.dataset.v === 'delete') deletePost(state.viewing);
    });
    $('#viewer-post').addEventListener('click', e => {
      const p = state.viewing;
      const st = e.target.closest('.st');
      if (!p || !st) return;
      const r = (p.reactions || []).find(x => x.id === st.dataset.rid);
      if (!r) return;
      if (r.author === me.side) unreact(p, r.id);
      else toast(nameOf(r.author) + ' dán · ' + fmtTime(r.createdAt));
    });
    $('#tray-tabs').addEventListener('click', e => { const b = e.target.closest('[data-tab]'); if (b) { state.trayTab = b.dataset.tab; renderTray(); } });
    $('#tray-grid').addEventListener('click', e => {
      const b = e.target.closest('button');
      if (!b || b.disabled || !state.viewing) return;
      if (b.hasAttribute('data-upload')) $('#file-sticker').click();
      else react(state.viewing, b.dataset.sid);
    });
    $('#file-sticker').addEventListener('change', e => {
      const f = e.target.files && e.target.files[0];
      e.target.value = '';
      if (f) uploadSticker(f);
    });
    $('#dlg-viewer').addEventListener('close', () => {
      const p = state.viewing;
      state.viewing = null;
      if (p) rerenderPost(p);
    });
  }

  async function boot() {
    if (MOCK) { $('#preview-banner').hidden = false; document.body.classList.add('is-preview'); }
    await A.require();
    // Luân can look around in preview mode (?demo) before the reveal.
    if (!(MOCK && A.ls.get('side') === 'left')) await A.waitForRelease('lang-kinh/');
    me.side = A.ls.get('side') || me.side;
    wire();
    startSky();
    if (NO_BACKEND) {
      const why = A.early && A.early()
        ? 'Chưa nối máy chủ: API_URL trong lang-kinh/config.js đang trống.'
        : 'Lăng kính đang được nối với máy chủ. Đợi anh chút nhé.';
      $('#track').innerHTML = '<div class="thread" aria-hidden="true"></div><p class="empty">' + why + '</p>';
      updateOtherChip();
      return;
    }
    await loadFirst();
    setInterval(poll, C.POLL_SECONDS * 1000);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) poll(); });
  }

  boot();
})();
