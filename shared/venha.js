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
 * The landing time follows the flight: the backend (action veNha) knows Thư's ticket and the flight's
 * live status; RETURN.AT is only the plan used until it answers.
 *
 *  - Before landing: a live countdown, for both. Tap it to show the landing time, the flights and their
 *    status (and Luân's preview link); tap again to hide them. It always opens collapsed.
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
  let AT = Date.parse(CFG.AT || '') || 0;   // landing: the plan until the backend answers
  let info = null;                            // what the backend said: { arrivesAt, scheduledAt, landedAt, legs }
  let landedAt = 0;
  let ready = false;                          // nothing is drawn until the backend has answered (or failed)
  const ARRIVED_MS = (CFG.ARRIVED_HOURS || 48) * 3600e3;
  const T = Object.assign({
    kicker: { left: 'Thư về nhà', right: 'Em về nhà' },
    arrived: 'Em về rồi 🧡',
    arrivedSub: { left: 'Thư đã về tới Việt Nam.', right: 'Chào mừng em về nhà.' },
    preview: 'Xem thử màn hình chào',
    close: 'Cất thư',
    stored: 'Lá thư này được cất trong “Những bức Thư anh gửi đến em”.',
  }, CFG.TEXT || {});
  const AIRPORTS = Object.assign({ FRA: 'Frankfurt', HAM: 'Hamburg', DOH: 'Doha', SGN: 'Tân Sơn Nhất', HAN: 'Nội Bài' }, CFG.AIRPORTS || {});

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
    const at = landedAt && landedAt <= t ? landedAt : AT;   // a real landing counts even if it beat the estimate
    return t < at ? 'before' : t < at + ARRIVED_MS ? 'arrived' : 'after';
  }

  const pad = n => String(n).padStart(2, '0');
  function split(ms) {
    const s = Math.max(0, Math.floor(ms / 1000));
    return { d: Math.floor(s / 86400), h: Math.floor(s % 86400 / 3600), m: Math.floor(s % 3600 / 60), s: s % 60 };
  }

  const fmt = (t, zone, o) => new Intl.DateTimeFormat('vi-VN', Object.assign({ timeZone: zone }, o)).format(new Date(t));
  const HM = { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' };
  const hm = (t, zone) => fmt(t, zone || 'Asia/Ho_Chi_Minh', HM);
  const ms = iso => { const t = Date.parse(iso || ''); return isNaN(t) ? 0 : t; };

  /** "Hạ cánh 07:15, thứ Sáu 15/1 giờ Việt Nam (01:15 giờ Đức)"; "Dự kiến…" once the airline moves it. */
  function landingText() {
    const sched = info ? ms(info.scheduledAt) : 0;
    const moved = sched && Math.abs(AT - sched) >= 60e3;
    const vn = `${hm(AT)}, ${fmt(AT, 'Asia/Ho_Chi_Minh', { weekday: 'long', day: 'numeric', month: 'numeric' })} giờ Việt Nam`;
    return (moved ? 'Dự kiến hạ cánh ' : 'Hạ cánh ') + vn + ` (${hm(AT, 'Europe/Berlin')} giờ Đức)` + (moved ? `, lịch cũ ${hm(sched)}` : '');
  }

  /* ───────── The flight ───────── */

  const legs = () => (info && info.legs) || [];
  const name = (l, end) => l[end + 'Name'] || AIRPORTS[l[end]] || l[end] || '';
  const st = l => String(l.status || '').toLowerCase();
  const departed = l => !!(l.dep && l.dep.a) || /^(departed|enroute|approaching|arrived|diverted)$/.test(st(l));
  const arrived = l => !!(l.arr && l.arr.a) || st(l) === 'arrived';

  /** "QR70 Frankfurt → Doha · QR974 Doha → Tân Sơn Nhất" */
  function routeText() {
    return legs().map(l => `${l.flight} ${name(l, 'from')} → ${name(l, 'to')}`.replace(/\s+→/, ' →')).join(' · ');
  }

  /** Where the trip stands, for both of them: { text, tone } with tone ok | warn | bad | quiet. */
  function statusLine() {
    const L = legs();
    if (!L.length) return null;
    const t = now();
    const last = L[L.length - 1];
    const first = L[0];
    const firstDep = ms(first.dep.e) || ms(first.dep.s);
    const lateMin = last.arr.s && last.arr.e ? Math.round((ms(last.arr.e) - ms(last.arr.s)) / 60e3) : 0;
    const late = lateMin >= 5 ? ` · trễ ${lateMin} phút` : lateMin <= -5 ? ` · sớm ${-lateMin} phút` : '';
    const tone = lateMin >= 15 ? 'warn' : 'ok';
    const bad = L.find(l => /^(canceled|canceleduncertain|diverted)$/.test(st(l)));
    if (bad) return { tone: 'bad', text: st(bad) === 'diverted' ? `Chuyến ${bad.flight} phải hạ cánh nơi khác` : `Chuyến ${bad.flight} bị huỷ` };
    if (arrived(last)) return { tone: 'ok', text: `Đã hạ cánh ở ${name(last, 'to')} lúc ${hm(ms(last.arr.a) || ms(last.arr.e))}` };
    const i = L.findIndex(l => !arrived(l));
    const cur = L[i];
    if (departed(cur)) {
      const soon = st(cur) === 'approaching' || (ms(cur.arr.e) && ms(cur.arr.e) - t < 30 * 60e3);
      return { tone, text: (soon ? `Sắp hạ cánh ở ${name(cur, 'to')}` : `Đang bay tới ${name(cur, 'to')}`) + (cur === last ? late : '') };
    }
    if (i > 0) {   // between flights
      return { tone, text: `Đang ở ${name(cur, 'from')} · ${cur.flight} cất cánh ${hm(ms(cur.dep.e) || ms(cur.dep.s), cur.fromTz)} giờ ${name(cur, 'from')}` + late };
    }
    if (!firstDep || firstDep - t > 7 * 864e5) return { tone: 'quiet', text: 'Theo dõi chuyến bay từ 7 ngày trước khi bay' };
    const depLate = first.dep.s && first.dep.e ? Math.round((ms(first.dep.e) - ms(first.dep.s)) / 60e3) : 0;
    const depTone = depLate >= 15 || lateMin >= 15 ? 'warn' : 'ok';
    return { tone: depTone, text: `Cất cánh ${hm(firstDep, first.fromTz || 'Europe/Berlin')} giờ Đức, ${fmt(firstDep, first.fromTz || 'Europe/Berlin', { day: 'numeric', month: 'numeric' })} từ ${name(first, 'from')}` +
      (depLate >= 5 ? ` · trễ ${depLate} phút` : late) };
  }

  function flightHTML() {
    if (!legs().length) return '';
    const s = statusLine();
    const checked = info && ms(info.checkedAt);
    const ago = checked ? Math.round((now() - checked) / 60e3) : -1;
    const fresh = ago < 0 ? '' : ago < 2 ? 'vừa cập nhật' : ago < 60 ? `cập nhật ${ago} phút trước` : ago < 48 * 60 ? `cập nhật ${Math.round(ago / 60)} giờ trước` : '';
    return `
      <div class="vn-flight">
        <p class="vn-route">${esc(routeText())}</p>
        ${s ? `<p class="vn-status vn-tone-${s.tone}">${esc(s.text)}</p>` : ''}
        ${fresh && s && s.tone !== 'quiet' ? `<p class="vn-fresh">${esc(fresh)}</p>` : ''}
      </div>`;
  }

  /** Ask the backend for the landing time and the flight. */
  async function fetchInfo() {
    const r = await call('veNha');
    ready = true;
    if (!r || !r.ok) { draw(); maybePopup(); return; }   // offline: the plan in RETURN.AT is the best we have
    info = r;
    const a = ms(r.arrivesAt);
    if (a) AT = a;
    landedAt = ms(r.landedAt);
    draw();
    maybePopup();
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
  let expanded = false;   // the details under the countdown; collapsed every time the page opens
  let popupChecked = false;
  let popupTries = 0;

  function draw() {
    if (!ready) return;
    const p = phase();
    lastPhase = p;
    banners.forEach((el, i) => {
      if (p === 'off' || p === 'after') { el.innerHTML = ''; return; }
      const previewBtn = side() === 'left'
        ? `<button type="button" class="vn-preview" data-venha-preview>${esc(T.preview)}</button>` : '';
      if (p === 'arrived') {
        el.innerHTML = `
          <section class="vn vn-is-home" aria-label="${esc(T.arrived)}">
            <p class="vn-arrived">${esc(T.arrived)}</p>
            <p class="vn-when">${esc(bySide(T.arrivedSub))}${landedAt ? ` Hạ cánh lúc ${esc(hm(landedAt))}.` : ''}</p>
            ${previewBtn}
          </section>`;
        return;
      }
      const s = statusLine();
      const alert = s && (s.tone === 'warn' || s.tone === 'bad') ? s.tone : '';
      el.innerHTML = `
        <section class="vn${expanded ? ' is-open' : ''}" aria-label="${esc(bySide(T.kicker))}">
          <button type="button" class="vn-toggle" data-venha-toggle aria-expanded="${expanded}" aria-controls="vn-more-${i}">
            <span class="vn-kicker">
              <span class="vn-kicker-text">${esc(bySide(T.kicker))}</span>
              <span class="vn-more-label">${alert ? `<span class="vn-alert vn-alert-${alert}" aria-hidden="true"></span>` : ''}<span data-venha-label>${expanded ? 'Thu gọn' : 'Chi tiết'}</span><span class="vn-chev" aria-hidden="true"></span></span>
            </span>
            <span class="vn-count" role="timer" aria-live="off">
              <span class="vn-cell"><b data-u="d">0</b><small>ngày</small></span>
              <span class="vn-cell"><b data-u="h">00</b><small>giờ</small></span>
              <span class="vn-cell"><b data-u="m">00</b><small>phút</small></span>
              <span class="vn-cell"><b data-u="s">00</b><small>giây</small></span>
            </span>
          </button>
          <div class="vn-more" id="vn-more-${i}"${expanded ? '' : ' inert'}>
            <div class="vn-more-in">
              <p class="vn-when">${esc(landingText())}</p>
              ${flightHTML()}
              ${previewBtn}
            </div>
          </div>
        </section>`;
    });
    tick();
  }

  function tick() {
    if (!ready) return;
    const p = phase();
    if (p !== lastPhase) { draw(); maybePopup(); fetchInfo(); return; }   // fetch: the real landing time
    if (p !== 'before') return;
    const t = split(AT - now());
    banners.forEach(el => {
      const set = (u, v) => { const b = el.querySelector(`[data-u=${u}]`); if (b && b.textContent !== v) b.textContent = v; };
      set('d', String(t.d)); set('h', pad(t.h)); set('m', pad(t.m)); set('s', pad(t.s));
    });
  }

  /** Show or hide the details under the countdown (in place, so it can animate). */
  function toggle() {
    expanded = !expanded;
    banners.forEach(el => {
      const sec = el.querySelector('.vn');
      if (!sec) return;
      sec.classList.toggle('is-open', expanded);
      const btn = sec.querySelector('[data-venha-toggle]');
      if (btn) btn.setAttribute('aria-expanded', String(expanded));
      const label = sec.querySelector('[data-venha-label]');
      if (label) label.textContent = expanded ? 'Thu gọn' : 'Chi tiết';
      const more = sec.querySelector('.vn-more');
      if (more) more.toggleAttribute('inert', !expanded);
    });
  }

  /** Thư, first visit after landing: open the welcome letter by itself, once ever. */
  async function maybePopup() {
    if (!ready || popupChecked || side() !== 'right' || phase() === 'before' || phase() === 'off') return;
    popupChecked = true;
    const r = await letters();
    if (!r.ok || !r.popup) {
      // The server's clock or landing time can be a moment behind this phone's: look again shortly.
      if (r.ok && r.letters && !r.letters.some(l => l.popup && l.seenAt) && popupTries++ < 10) setTimeout(() => { popupChecked = false; maybePopup(); }, 60e3);
      return;
    }
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
    fetchInfo();
    if (started) return;
    started = true;
    setInterval(tick, 1000);
    // Flight status: the backend checks on its own schedule; open pages look every 5 minutes, and when shown again.
    setInterval(() => { if (!document.hidden) fetchInfo(); }, 5 * 60e3);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) fetchInfo(); });
    document.addEventListener('click', e => {
      const b = e.target.closest('[data-venha-preview]');
      if (b) preview(b);
      if (e.target.closest('[data-venha-toggle]')) toggle();
    });
  }

  window.VeNha = { start, now, phase, letters, openLetter, call };
})();
