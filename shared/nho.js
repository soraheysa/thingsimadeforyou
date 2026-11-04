/*
 * "Nhớ": the "Anh nhớ em / Em nhớ anh" heart, shared by every page in Our Story.
 *
 * In a page, after shared/config.js, shared/mock.js and shared/auth.js:
 *   <link rel="stylesheet" href="../shared/nho.css">
 *   <div data-nho="panel"></div>     the full card: heart, day/night counters, notification switch (home page)
 *   <div data-nho="fab"></div>       a floating heart with today's count (other pages)
 *   <script src="../shared/nho.js"></script>
 *
 * The heart sends a phone notification to the other person through the backend (nho/backend/Code.gs),
 * except while they sleep: then it only counts, on the night counter.
 */
(function () {
  'use strict';

  const A = window.Auth;
  if (!A) return;
  const CFG = (window.SHARED_CONFIG && window.SHARED_CONFIG.NHO) || {};
  const ENABLED = A.DEMO || !!CFG.API_URL;
  const FB = CFG.FIREBASE || {};
  const PUSH_CONFIGURED = !!(FB.apiKey && FB.projectId && FB.messagingSenderId && FB.appId && CFG.VAPID_KEY);
  const FB_SDK = 'https://www.gstatic.com/firebasejs/10.12.2/';
  const COOLDOWN = Math.max(1, CFG.COOLDOWN_SECONDS || 3) * 1000;
  const POLL = Math.max(20, CFG.POLL_SECONDS || 60) * 1000;
  // Launch date (NHO.OPENS_AT): hidden until then, except for EARLY_SIDES (and preview mode).
  const OPENS = Date.parse(CFG.OPENS_AT || '') || 0;
  const isOpen = () => A.DEMO || !OPENS || Date.now() >= OPENS || (CFG.EARLY_SIDES || []).indexOf(A.ls.get('side')) >= 0;
  let openTimer = null;

  const tz = (() => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone; } catch (e) { return ''; } })();
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const cap = s => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);
  const PRONOUN = { left: 'anh', right: 'em' };
  const EMOJI = { left: '🩷', right: '🧡' };
  // How the other person is called on your screen (same idea as CALL_NAMES in hai-nua/config.js).
  const CALL = Object.assign({ left: 'gà con' }, CFG.CALL_NAMES || {});
  const callName = p => (p && CALL[p.side]) || (p && p.name) || 'người ấy';
  const otherSide = s => (s === 'left' ? 'right' : 'left');
  const mySide = () => A.ls.get('side') || 'right';
  /** "Anh nhớ em" for a tap sent by `side`. */
  const phrase = side => `${cap(PRONOUN[side])} nhớ ${PRONOUN[otherSide(side)]}`;

  const standalone = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
  const isIOS = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const pushSupported = () => 'Notification' in window && 'serviceWorker' in navigator && 'PushManager' in window;

  const call = (action, payload) => A.post(CFG.API_URL, Object.assign({ action, tz }, A.credentials(), payload || {}));
  const toast = msg => { if (window.Pwa && window.Pwa.toast) window.Pwa.toast(msg); };

  const HEART = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 21s-7.5-4.6-9.6-9.3C.9 8.3 2.9 4.5 6.6 4.1c2.1-.2 3.9.9 5.4 2.8 1.5-1.9 3.3-3 5.4-2.8 3.7.4 5.7 4.2 4.2 7.6C19.5 16.4 12 21 12 21z"/></svg>';

  let state = null;
  let started = false;
  let restUntil = 0;
  let pollTimer = null;
  let lastNote = '';          // the line under the heart after a tap
  let wakeShown = false;
  let pushError = '';         // last reason turning notifications on failed      // the "while you slept" line stays for this visit once shown

  /* ───────── Drawing ───────── */

  function skeleton(el) {
    const kind = el.dataset.nho;
    const side = mySide();
    if (kind === 'fab') {
      el.innerHTML = `
        <button type="button" class="nho-fab" data-nho-send aria-label="Gửi: ${esc(phrase(side))}">
          ${HEART}<span class="nho-fab-badge" hidden></span>
        </button>`;
      return;
    }
    el.innerHTML = `
      <section class="nho" aria-label="${esc(phrase(side))}">
        <p class="nho-wake" hidden></p>
        <div class="nho-send">
          <button type="button" class="nho-heart" data-nho-send aria-describedby="nho-sub">${HEART}</button>
          <div class="nho-send-text">
            <p class="nho-title">${esc(phrase(side))}</p>
            <p class="nho-sub" id="nho-sub" role="status" aria-live="polite">Chạm vào trái tim</p>
          </div>
        </div>
        <div class="nho-tiles"></div>
        <p class="nho-total"></p>
        <div class="nho-push" hidden></div>
      </section>`;
  }

  function tileHTML(side) {
    const c = state[state.me.side === side ? 'me' : 'other'].sent;
    const asleepWord = PRONOUN[otherSide(side)];
    return `
      <div class="nho-tile" data-side="${side}">
        <p class="nho-tile-title">${esc(phrase(side))} ${EMOJI[side]}</p>
        <div class="nho-stats">
          <p><b>${c.day}</b><span>☀️ Ban ngày</span></p>
          <p><b>${c.night}</b><span>🌙 Lúc ${esc(asleepWord)} ngủ</span></p>
        </div>
      </div>`;
  }

  function subText() {
    if (lastNote) return lastNote;
    const o = state.other;
    const call = callName(o);
    if (o.asleep) return `Giờ này là giờ ${call} ngủ (${o.sleep.replace('–', '\u2060–\u2060')}). Tim vẫn sẽ đến bên người ${call} nhưng thông báo sẽ không kêu đâu.`;
    if (!o.pushOn && state.pushReady) return `${cap(call)} chưa bật thông báo, nhưng sẽ thấy số đếm ở đây.`;
    return `Chạm để ${call} nhận được ngay.`;
  }

  function pushHTML() {
    const o = state.other;
    if (!state.pushReady || !PUSH_CONFIGURED) return '';
    if (!pushSupported()) {
      return isIOS && !standalone
        ? `<p class="nho-push-note">Trên iPhone: thêm Our Story vào màn hình chính rồi mở từ đó để bật thông báo.</p>`
        : `<p class="nho-push-note">Trình duyệt này chưa hỗ trợ thông báo.</p>`;
    }
    const perm = Notification.permission;
    if (perm === 'denied') {
      return `<p class="nho-push-note">🔕 Thông báo đang bị chặn trên máy này. Mở cài đặt trang (biểu tượng bên trái thanh địa chỉ) → Thông báo → Cho phép, rồi tải lại trang.</p>`;
    }
    if (perm === 'granted' && A.ls.get('push_token')) {
      return `
        <p class="nho-push-note">🔔 Thông báo đang bật trên máy này.</p>
        <div class="nho-push-links">
          <button type="button" class="nho-link" data-nho-test>Gửi thử</button>
          <button type="button" class="nho-link" data-nho-off>Tắt trên máy này</button>
        </div>`;
    }
    return `
      <button type="button" class="nho-push-btn" data-nho-on>🔔 Bật thông báo trên máy này</button>
      <p class="nho-push-note">Để biết ngay khi ${esc(callName(o))} nhớ ${esc(state.me.pronoun)}.</p>
      ${pushError ? `<p class="nho-push-err" role="alert">Lỗi ${esc(pushError)}</p>` : ''}`;
  }

  function render() {
    if (!state) return;
    const me = state.me, o = state.other;
    const received = o.sent;   // other → me, counted on my calendar day

    document.querySelectorAll('[data-nho="panel"]').forEach(el => {
      el.querySelector('.nho-sub').textContent = subText();
      // Only the other person's taps: what they sent you, not a score between two.
      el.querySelector('.nho-tiles').innerHTML = tileHTML(o.side);
      const got = o.sent.day + o.sent.night;
      const total = el.querySelector('.nho-total');
      total.hidden = !got;
      total.textContent = `Hôm nay ${phrase(o.side).toLowerCase()} ${got} lần.`;
      const push = el.querySelector('.nho-push');
      const html = pushHTML();
      push.hidden = !html;
      push.innerHTML = html;

      // Morning line: taps that arrived silently while I slept.
      const wake = el.querySelector('.nho-wake');
      const seenKey = 'nho_seen_night_' + state.dayKey;
      const seen = Number(A.ls.get(seenKey) || 0);
      if (received.night > seen || (wakeShown && received.night)) {
        wakeShown = true;
        A.ls.set(seenKey, String(received.night));
        wake.textContent = `🌙 Trong lúc ${me.pronoun} ngủ, ${phrase(o.side).toLowerCase()} ${received.night} lần.`;
        wake.hidden = false;
      } else {
        wake.hidden = true;
      }
    });

    document.querySelectorAll('[data-nho="fab"] .nho-fab-badge').forEach(b => {
      const n = received.day + received.night;
      b.hidden = !n;
      b.textContent = n > 99 ? '99+' : String(n);
      b.closest('.nho-fab').setAttribute('aria-label',
        `Gửi: ${phrase(me.side)}. Hôm nay ${phrase(o.side).toLowerCase()} ${n} lần.`);
    });
  }

  /* ───────── Actions ───────── */

  async function refresh() {
    if (!started || document.hidden) return;
    const r = await call('nhoState');
    if (r.ok) { state = r.state; render(); }
    else if (r.error === 'auth') A.expired();
  }

  function burst(btn) {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const box = btn.getBoundingClientRect();
    for (let i = 0; i < 6; i++) {
      const h = document.createElement('span');
      h.className = 'nho-fly';
      h.innerHTML = HEART;
      h.style.left = (box.left + box.width / 2 - 9) + 'px';
      h.style.top = (box.top + box.height / 2 - 9) + 'px';
      h.style.setProperty('--dx', (Math.random() * 90 - 45).toFixed(0) + 'px');
      h.style.setProperty('--delay', (i * 70) + 'ms');
      h.style.setProperty('--hue', mySide() === 'left' ? '#FF9DD1' : '#F09A47');
      document.body.appendChild(h);
      setTimeout(() => h.remove(), 1400 + i * 70);
    }
  }

  async function send(btn) {
    if (Date.now() < restUntil) return;
    restUntil = Date.now() + COOLDOWN;
    document.querySelectorAll('[data-nho-send]').forEach(b => b.classList.add('is-resting'));
    setTimeout(() => document.querySelectorAll('[data-nho-send]').forEach(b => b.classList.remove('is-resting')), COOLDOWN);
    btn.classList.remove('is-beat');
    void btn.offsetWidth;
    btn.classList.add('is-beat');
    burst(btn);

    const r = await call('nhoSend');
    if (!r.ok) {
      if (r.error === 'auth') { A.expired(); return; }
      toast(r.message || 'Chưa gửi được. Kiểm tra mạng rồi thử lại.');
      return;
    }
    state = r.state;
    const o = state.other;
    lastNote = r.silenced
      ? `Tim đã đến bên người ${callName(o)} 🌙 Đang giờ ngủ nên thông báo không kêu đâu.`
      : `Đã gửi tới ${callName(o)} ${EMOJI[state.me.side]}`;
    render();
    if (!document.querySelector('[data-nho="panel"]')) toast(lastNote);
    clearTimeout(send.t);
    send.t = setTimeout(() => { lastNote = ''; render(); }, 6000);
  }

  /* ───────── Notifications on this device ───────── */

  /** Each step names itself, so a failure says where it stopped (shown under the button). */
  async function step(name, fn) {
    try { return await fn(); }
    catch (e) {
      const why = [e && e.code, e && e.name !== 'Error' && e.name, e && e.message || String(e)].filter(Boolean).join(' · ');
      const err = new Error(`[${name}] ${why}`);
      err.step = name;
      throw err;
    }
  }

  async function deviceToken() {
    const reg = await step('service worker', async () => {
      await navigator.serviceWorker.register(new URL('sw.js', A.ROOT).href, { scope: A.ROOT.pathname });
      return navigator.serviceWorker.ready;
    });
    const [{ initializeApp, getApps }, { getMessaging, getToken }] = await step('tải Firebase', () => Promise.all([
      import(FB_SDK + 'firebase-app.js'),
      import(FB_SDK + 'firebase-messaging.js'),
    ]));
    const app = getApps().length ? getApps()[0] : initializeApp(FB);
    const get = () => getToken(getMessaging(app), { vapidKey: CFG.VAPID_KEY, serviceWorkerRegistration: reg });
    // The very first subscription on a phone sometimes fails once and works on the second try.
    return step('Firebase token', () => get().catch(() => new Promise(r => setTimeout(r, 1500)).then(get)));
  }

  function deviceName() {
    const ua = navigator.userAgent;
    const os = /Android/.test(ua) ? 'Android' : isIOS ? 'iPhone/iPad' : /Mac/.test(ua) ? 'Mac' : /Windows/.test(ua) ? 'Windows' : 'Khác';
    return `${os}${standalone ? ' · app' : ' · trình duyệt'} · ${ua.slice(0, 90)}`;
  }

  async function savePush(quiet) {
    const token = await deviceToken();
    if (!token) throw new Error('[Firebase token] không nhận được mã');
    // "pushToken", not "token": "token" is the sign-in token that call() already sends.
    const r = await call('pushSave', { pushToken: token, device: deviceName() });
    if (!r.ok) throw new Error(`[lưu vào backend] ${r.error || ''} ${r.message || ''}`.trim());
    pushError = '';
    A.ls.set('push_token', token);
    A.ls.set('push_saved_at', String(Date.now()));
    state = r.state;
    render();
    if (!quiet) toast(`Đã bật. Khi ${callName(state.other)} nhớ ${state.me.pronoun}, máy này sẽ báo.`);
  }

  async function turnOn(btn) {
    btn.disabled = true;
    try {
      const perm = await Notification.requestPermission();
      if (perm !== 'granted') { render(); return; }
      await savePush(false);
    } catch (e) {
      console.warn(e);
      pushError = (e && e.message) || String(e);
      toast('Chưa bật được thông báo. Lý do ở ngay dưới nút nhé.');
      render();
    }
  }

  async function turnOff() {
    const token = A.ls.get('push_token');
    A.ls.del('push_token');
    A.ls.del('push_saved_at');
    const r = await call('pushRemove', { pushToken: token });
    if (r.ok) state = r.state;
    render();
    toast('Đã tắt thông báo trên máy này.');
  }

  async function test() {
    const r = await call('pushTest');
    toast(r.ok ? 'Đã gửi. Thông báo sẽ tới trong vài giây.' : (r.message || 'Chưa gửi được.'));
  }

  /** Phones sometimes renew their notification address; re-save it every few days. */
  function keepPushFresh() {
    if (!PUSH_CONFIGURED || !pushSupported() || Notification.permission !== 'granted' || !A.ls.get('push_token')) return;
    const last = Number(A.ls.get('push_saved_at') || 0);
    if (Date.now() - last < 3 * 864e5) return;
    savePush(true).catch(e => console.warn(e));
  }

  /* ───────── Start ───────── */

  function start() {
    if (!ENABLED || !A.hasSession() || !A.confirmed()) return;
    if (!isOpen()) {
      // Still before launch: appear by itself at the moment it opens if the page is left open.
      clearTimeout(openTimer);
      openTimer = setTimeout(start, Math.min(OPENS - Date.now() + 500, 2147483000));
      return;
    }
    if (started) { refresh(); return; }
    started = true;
    document.querySelectorAll('[data-nho]').forEach(skeleton);

    document.addEventListener('click', e => {
      const s = e.target.closest('[data-nho-send]');
      if (s) { send(s); return; }
      const on = e.target.closest('[data-nho-on]');
      if (on) { turnOn(on); return; }
      if (e.target.closest('[data-nho-off]')) { turnOff(); return; }
      if (e.target.closest('[data-nho-test]')) test();
    });
    document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh(); });
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.addEventListener('message', e => { if (e.data && e.data.type === 'nho') refresh(); });
    }
    pollTimer = setInterval(refresh, POLL);
    refresh().then(keepPushFresh);
  }

  const autoStart = () => { if (!started) start(); };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', autoStart);
  else autoStart();

  window.Nho = { start, refresh };
})();
