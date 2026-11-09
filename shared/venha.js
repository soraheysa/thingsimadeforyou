/*
 * "Về nhà": the countdown to Thư's landing in Vietnam, the welcome-home letter, and the letters
 * shown in "Những bức Thư anh gửi đến em" (thu-gui-em/).
 *
 * In a page, after shared/config.js, shared/mock.js and shared/auth.js:
 *   <link rel="stylesheet" href="../shared/venha.css">
 *   <div data-venha="banner"></div>      the countdown (home page, right below the Nhớ card)
 *   <script src="../shared/venha.js"></script>
 *
 * Settings: RETURN in shared/config.js. The letters themselves live in the Google Sheet of the
 * Nhớ backend (nho/backend/Code.gs, tab NH_Letters), so their text never sits in this public repo.
 *
 *  - Before landing: a live countdown, for both.
 *  - For ARRIVED_HOURS after landing: "Em về rồi". After that the banner goes away.
 *  - The first time Thư opens the app after landing, the welcome letter opens by itself, once.
 *  - Luân sees a "Xem thử" button that opens the letter any time; that never counts as Thư seeing it.
 */
(function () {
  'use strict';

  const A = window.Auth;
  if (!A) return;
  const SC = window.SHARED_CONFIG || {};
  const CFG = SC.RETURN || {};
  const API = (SC.NHO || {}).API_URL;
  const ENABLED = A.DEMO || !!API;
  const AT = Date.parse(CFG.AT || '') || 0;
  const ARRIVED_MS = (CFG.ARRIVED_HOURS || 48) * 3600e3;
  const T = Object.assign({
    kicker: { left: 'Thư về nhà', right: 'Em về nhà' },
    arrived: 'Em về rồi 🧡',
    arrivedSub: { left: 'Thư đã về tới Việt Nam.', right: 'Chào mừng em về nhà.' },
    preview: 'Xem thử màn hình chào',
    close: 'Cất thư',
    stored: 'Lá thư này được cất trong “Những bức Thư anh gửi đến em”.',
  }, CFG.TEXT || {});

  const now = A.now || Date.now;   // the preview can pretend it is another moment (see shared/auth.js)

  const tz = (() => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone; } catch (e) { return ''; } })();
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const bySide = v => (v && typeof v === 'object' ? (v[side()] || v.right || '') : (v || ''));
  const side = () => A.ls.get('side') || 'right';
  const call = (action, payload) => A.post(API, Object.assign({ action, tz }, A.credentials(), payload || {}));
  const toast = msg => { if (window.Pwa && window.Pwa.toast) window.Pwa.toast(msg); };

  /** 'before' the landing, 'arrived' for ARRIVED_HOURS after it, then 'after'. */
  function phase() {
    if (!AT) return 'off';
    const t = now();
    return t < AT ? 'before' : t < AT + ARRIVED_MS ? 'arrived' : 'after';
  }

  const pad = n => String(n).padStart(2, '0');
  function split(ms) {
    const s = Math.max(0, Math.floor(ms / 1000));
    return { d: Math.floor(s / 86400), h: Math.floor(s % 86400 / 3600), m: Math.floor(s % 3600 / 60), s: s % 60 };
  }

  /** "07:00, Thứ Sáu 15/1 giờ Việt Nam" plus Germany time while Thư is still there. */
  function landingText() {
    const d = new Date(AT);
    const f = (zone, o) => new Intl.DateTimeFormat('vi-VN', Object.assign({ timeZone: zone }, o)).format(d);
    const hm = { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' };
    const vn = `${f('Asia/Ho_Chi_Minh', hm)}, ${f('Asia/Ho_Chi_Minh', { weekday: 'long', day: 'numeric', month: 'numeric' })} giờ Việt Nam`;
    return phase() === 'before' ? `${vn} (${f('Europe/Berlin', hm)} giờ Đức)` : vn;
  }

  /* ───────── The letter screen ───────── */

  function dateText(iso) {
    const d = new Date(iso);
    if (isNaN(d)) return '';
    return new Intl.DateTimeFormat('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh', day: 'numeric', month: 'long', year: 'numeric' }).format(d);
  }

  /**
   * Show one letter full screen.
   *  opts.preview → Luân's look: a note that Thư hasn't seen it (or when she did)
   *  opts.stored  → add the line saying where the letter is kept
   */
  function openLetter(letter, opts) {
    opts = opts || {};
    document.querySelectorAll('.vn-letter-root').forEach(el => el.remove());
    const el = document.createElement('div');
    el.className = 'vn-letter-root';
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-modal', 'true');
    el.setAttribute('aria-labelledby', 'vn-letter-title');
    const note = !opts.preview ? ''
      : letter.seenAt ? `Thư đã mở lá thư này lúc ${esc(new Intl.DateTimeFormat('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh', hour: '2-digit', minute: '2-digit', hourCycle: 'h23', day: 'numeric', month: 'numeric' }).format(new Date(letter.seenAt)))}.`
      : letter.locked ? 'Xem thử: Thư chưa thấy lá thư này. Nó sẽ tự mở khi Thư vào app lần đầu sau giờ hạ cánh.'
      : 'Xem thử: Thư chưa mở lá thư này.';
    el.innerHTML = `
      <div class="vn-letter-bg" aria-hidden="true"></div>
      <div class="vn-letter-wrap">
        <article class="vn-letter">
          ${note ? `<p class="vn-letter-note">${note}</p>` : ''}
          <p class="vn-letter-date">${esc(dateText(letter.opensAt || letter.date))}</p>
          <h1 class="vn-letter-title" id="vn-letter-title">${esc(letter.title)}</h1>
          <div class="vn-letter-text">${esc(letter.text)}</div>
          <button type="button" class="vn-letter-btn">${esc(T.close)}</button>
          ${opts.stored ? `<p class="vn-letter-stored">${esc(T.stored)}</p>` : ''}
        </article>
      </div>`;
    const prev = document.activeElement;
    const close = () => {
      el.classList.add('is-leaving');
      setTimeout(() => { el.remove(); document.documentElement.classList.remove('vn-open'); if (prev && prev.focus) prev.focus(); }, 220);
      document.removeEventListener('keydown', onKey);
      if (opts.onClose) opts.onClose();
    };
    const onKey = e => { if (e.key === 'Escape') close(); };
    el.querySelector('.vn-letter-btn').addEventListener('click', close);
    document.addEventListener('keydown', onKey);
    document.body.appendChild(el);
    document.documentElement.classList.add('vn-open');
    setTimeout(() => el.querySelector('.vn-letter-btn').focus({ preventScroll: true }), 60);
  }

  /** All letters this person may see: Thư gets the opened ones, Luân gets every one. */
  async function letters() {
    const r = await call('letters');
    if (!r.ok && r.error === 'auth') A.expired();
    return r;
  }

  /* ───────── The banner ───────── */

  let banners = [];
  let lastPhase = '';
  let popupChecked = false;

  function draw() {
    const p = phase();
    lastPhase = p;
    banners.forEach(el => {
      if (p === 'off' || p === 'after') { el.innerHTML = ''; return; }
      const previewBtn = side() === 'left'
        ? `<button type="button" class="vn-preview" data-venha-preview>${esc(T.preview)}</button>` : '';
      if (p === 'arrived') {
        el.innerHTML = `
          <section class="vn vn-is-home" aria-label="${esc(T.arrived)}">
            <p class="vn-arrived">${esc(T.arrived)}</p>
            <p class="vn-when">${esc(bySide(T.arrivedSub))}</p>
            ${previewBtn}
          </section>`;
        return;
      }
      el.innerHTML = `
        <section class="vn" aria-label="${esc(bySide(T.kicker))}">
          <p class="vn-kicker">${esc(bySide(T.kicker))}</p>
          <div class="vn-count" role="timer" aria-live="off">
            <div><b data-u="d">0</b><span>ngày</span></div>
            <div><b data-u="h">00</b><span>giờ</span></div>
            <div><b data-u="m">00</b><span>phút</span></div>
            <div><b data-u="s">00</b><span>giây</span></div>
          </div>
          <p class="vn-when">${esc(landingText())}</p>
          ${previewBtn}
        </section>`;
    });
    tick();
  }

  function tick() {
    const p = phase();
    if (p !== lastPhase) { draw(); maybePopup(); return; }
    if (p !== 'before') return;
    const t = split(AT - now());
    banners.forEach(el => {
      const set = (u, v) => { const b = el.querySelector(`[data-u=${u}]`); if (b && b.textContent !== v) b.textContent = v; };
      set('d', String(t.d)); set('h', pad(t.h)); set('m', pad(t.m)); set('s', pad(t.s));
    });
  }

  /** Thư, first visit after landing: open the welcome letter by itself, once ever. */
  async function maybePopup() {
    if (popupChecked || side() !== 'right' || phase() === 'before' || phase() === 'off') return;
    popupChecked = true;
    const r = await letters();
    if (!r.ok || !r.popup) return;
    openLetter(r.popup, { stored: true });
    call('letterSeen', { id: r.popup.id });   // counts as seen as soon as it is on screen
  }

  async function preview(btn) {
    btn.disabled = true;
    const r = await letters();
    btn.disabled = false;
    if (!r.ok) { toast(r.message || 'Chưa tải được lá thư. Thử lại sau nhé.'); return; }
    const l = (r.letters || []).find(x => x.popup) || (r.letters || [])[0];
    if (!l) { toast('Chưa có lá thư nào trong Google Sheet (tab NH_Letters).'); return; }
    openLetter(l, { preview: true, stored: true });
  }

  let started = false;
  function start() {
    if (!ENABLED || !AT || !A.hasSession() || !A.confirmed()) return;
    banners = Array.from(document.querySelectorAll('[data-venha="banner"]'));
    draw();
    maybePopup();
    if (started) return;
    started = true;
    setInterval(tick, 1000);
    document.addEventListener('click', e => {
      const b = e.target.closest('[data-venha-preview]');
      if (b) preview(b);
    });
  }

  window.VeNha = { start, now, phase, letters, openLetter, call };
})();
