/*
 * "Our Story": the installed-app layer shared by every page in this repo.
 *
 * Load it in <head>, before the page draws:
 *   <script src="../shared/pwa.js"></script>      (or "shared/pwa.js" on the home page)
 *
 * It does four things:
 *  1. registers the service worker (sw.js at the repo root),
 *  2. shows an "add to home screen" banner to the sides listed in SHARED_CONFIG.APP.INSTALL_SIDES,
 *  3. in the installed app, offers to unlock with the fingerprint instead of the email step,
 *  4. in the installed app, asks for that fingerprint each time the app is opened.
 *
 * The fingerprint is checked by the phone itself (passkey / WebAuthn). Nothing is sent anywhere,
 * so it is a lock on the device, like an app lock. Sign-in on the server still uses the email token.
 */
(function () {
  'use strict';

  const ROOT = new URL('../', document.currentScript.src);
  const wrap = area => ({
    get: k => { try { return area.getItem('tim_' + k); } catch (e) { return null; } },
    set: (k, v) => { try { area.setItem('tim_' + k, v); } catch (e) { /* private mode */ } },
    del: k => { try { area.removeItem('tim_' + k); } catch (e) { /* private mode */ } },
  });
  const ls = wrap(window.localStorage);
  const ss = wrap(window.sessionStorage);

  const standalone = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
  const ua = navigator.userAgent;
  const isIOS = /iPhone|iPad|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const isAndroid = /Android/.test(ua);
  const signedIn = () => !!(ls.get('email') && ls.get('token'));
  const hasPasskey = () => !!ls.get('passkey');
  const cfg = () => (window.SHARED_CONFIG && window.SHARED_CONFIG.APP) || {};
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  /* ── 1. Hide the page right away when the fingerprint lock will be shown ── */
  const needsUnlock = standalone && hasPasskey() && signedIn() && ss.get('unlocked') !== '1';
  if (needsUnlock) document.documentElement.classList.add('tim-locked');
  const early = document.createElement('style');
  early.textContent = 'html.tim-locked body > *:not(.tim-lock){visibility:hidden!important}';
  document.head.appendChild(early);
  const css = document.createElement('link');
  css.rel = 'stylesheet';
  css.href = new URL('shared/pwa.css', ROOT).href;
  document.head.appendChild(css);

  /* ── 2. Service worker ── */
  if ('serviceWorker' in navigator && location.protocol === 'https:') {
    navigator.serviceWorker.register(new URL('sw.js', ROOT).href, { scope: ROOT.pathname }).catch(() => {});
  }

  /* ── Small UI helpers (toast + bottom sheet) ── */
  let toastTimer;
  function toast(msg) {
    let t = document.querySelector('.tim-toast');
    if (!t) { t = document.createElement('div'); t.className = 'tim-toast'; t.setAttribute('role', 'status'); document.body.appendChild(t); }
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('show'), 3200);
  }

  function sheet(o) {
    const el = document.createElement('div');
    el.className = 'tim-sheet-wrap';
    el.innerHTML = `
      <section class="tim-sheet" role="dialog" aria-modal="true" aria-labelledby="tim-sheet-title">
        <img class="tim-sheet-icon" src="${new URL('icons/icon-192.png', ROOT).href}" alt="">
        <h2 id="tim-sheet-title">${esc(o.title)}</h2>
        <p>${esc(o.text)}</p>
        <div class="tim-sheet-actions">
          <button type="button" class="tim-btn tim-btn-ghost" data-a="2">${esc(o.secondary)}</button>
          <button type="button" class="tim-btn" data-a="1">${esc(o.primary)}</button>
        </div>
      </section>`;
    document.body.appendChild(el);
    el.querySelector('[data-a="1"]').addEventListener('click', () => { el.remove(); o.onPrimary && o.onPrimary(); });
    el.querySelector('[data-a="2"]').addEventListener('click', () => { el.remove(); o.onSecondary && o.onSecondary(); });
    setTimeout(() => el.querySelector('[data-a="1"]').focus(), 50);
  }

  /* ── 3 & 4. Fingerprint (passkey on this device) ── */
  const b64u = buf => btoa(String.fromCharCode.apply(null, new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  function unb64u(s) {
    s = s.replace(/-/g, '+').replace(/_/g, '/');
    while (s.length % 4) s += '=';
    const bin = atob(s);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }
  const rand = n => crypto.getRandomValues(new Uint8Array(n));

  async function fingerprintAvailable() {
    try {
      return !!(window.PublicKeyCredential && await window.PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable());
    } catch (e) { return false; }
  }

  async function enroll() {
    const email = ls.get('email') || 'our-story';
    const cred = await navigator.credentials.create({ publicKey: {
      challenge: rand(32),
      rp: { name: 'Our Story', id: location.hostname },
      user: { id: rand(16), name: email, displayName: ls.get('name') || email },
      pubKeyCredParams: [{ type: 'public-key', alg: -7 }, { type: 'public-key', alg: -257 }],
      authenticatorSelection: { authenticatorAttachment: 'platform', userVerification: 'required', residentKey: 'discouraged' },
      attestation: 'none',
      timeout: 60000,
    } });
    ls.set('passkey', b64u(cred.rawId));
    ls.del('passkey_later');
    ss.set('unlocked', '1');
  }

  async function verify() {
    await navigator.credentials.get({ publicKey: {
      challenge: rand(32),
      rpId: location.hostname,
      allowCredentials: [{ type: 'public-key', id: unb64u(ls.get('passkey')) }],
      userVerification: 'required',
      timeout: 60000,
    } });
    ss.set('unlocked', '1');
  }

  const FINGERPRINT = '<svg width="52" height="52" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 10a2 2 0 0 0-2 2c0 1.02-.1 2.51-.26 4"/><path d="M14 13.12c0 2.38 0 6.38-1 8.88"/><path d="M17.29 21.02c.12-.6.43-2.3.5-3.02"/><path d="M2 12a10 10 0 0 1 18-6"/><path d="M2 16h.01"/><path d="M21.8 16c.2-2 .131-5.354 0-6"/><path d="M5 19.5C5.5 18 6 15 6 12a6 6 0 0 1 .34-2"/><path d="M8.65 22c.21-.66.45-1.32.57-2"/><path d="M9 6.8a6 6 0 0 1 9 5.2v2"/></svg>';

  function showLock() {
    const c = cfg();
    const side = ls.get('side') || '';
    const el = document.createElement('div');
    el.className = 'tim-lock';
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-modal', 'true');
    el.setAttribute('aria-label', 'Mở khoá Our Story');
    el.innerHTML = `
      <img class="tim-lock-icon" src="${new URL('icons/icon-192.png', ROOT).href}" alt="Biểu tượng Our Story">
      <h1 class="tim-lock-title">Our Story</h1>
      <p class="tim-lock-sub">${esc(c.SUBTITLE || 'Những thứ anh làm cho mình')}</p>
      <div class="tim-lock-gap"></div>
      <p class="tim-lock-msg">${esc((c.UNLOCK_TEXT || {})[side] || 'Chạm vân tay để vào nhé')}</p>
      <button type="button" class="tim-lock-btn" aria-label="Mở bằng vân tay">${FINGERPRINT}</button>
      <p class="tim-lock-err" role="alert"></p>
      <div class="tim-lock-gap"></div>
      <button type="button" class="tim-lock-link">Dùng email để đăng nhập</button>
      <p class="tim-lock-note">Vân tay chỉ được kiểm tra trên điện thoại này,<br>không gửi đi đâu cả.</p>`;
    document.body.appendChild(el);

    const btn = el.querySelector('.tim-lock-btn');
    const err = el.querySelector('.tim-lock-err');
    let busy = false;
    async function unlock() {
      if (busy) return;
      busy = true;
      err.textContent = '';
      try {
        await verify();
        el.remove();
        document.documentElement.classList.remove('tim-locked');
      } catch (e) {
        err.textContent = 'Chưa mở được. Chạm vào vân tay để thử lại nhé.';
      }
      busy = false;
    }
    btn.addEventListener('click', unlock);
    el.querySelector('.tim-lock-link').addEventListener('click', () => {
      // Fall back to the normal email sign-in on the home page.
      ls.del('token');
      ss.del('confirmed');
      ss.set('unlocked', '1');
      location.href = ROOT.href;
    });
    setTimeout(unlock, 350);   // try straight away; the button stays for retries
  }

  async function offerFingerprint() {
    if (!standalone || !signedIn() || hasPasskey()) return;
    const later = Number(ls.get('passkey_later') || 0);
    if (later && Date.now() - later < 14 * 864e5) return;
    if (!(await fingerprintAvailable())) return;
    sheet({
      title: 'Lần sau mở bằng vân tay nhé?',
      text: 'Mỗi lần mở Our Story, chỉ cần chạm vân tay là vào được, không phải xác nhận email nữa.',
      primary: 'Bật',
      secondary: 'Để sau',
      onPrimary: async () => {
        try { await enroll(); toast('Đã bật mở bằng vân tay.'); }
        catch (e) { toast('Chưa bật được. Thử lại sau nhé.'); }
      },
      onSecondary: () => ls.set('passkey_later', String(Date.now())),
    });
  }

  /** Home page footer: a way to turn the fingerprint lock off again. */
  function addFingerprintToggle() {
    const foot = document.querySelector('.home-foot');
    if (!foot || !standalone || foot.querySelector('.tim-fp-off')) return;
    if (!hasPasskey()) return;
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'link tim-fp-off';
    b.textContent = 'Tắt mở bằng vân tay';
    b.addEventListener('click', () => { ls.del('passkey'); ls.set('passkey_later', String(Date.now())); b.remove(); toast('Đã tắt mở bằng vân tay.'); });
    foot.insertBefore(b, foot.firstChild);
    foot.style.justifyContent = 'space-between';
  }

  /* ── 2. "Add to home screen" banner ── */
  let deferredPrompt = null;
  window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); deferredPrompt = e; maybeBanner(); });
  window.addEventListener('appinstalled', () => { const b = document.querySelector('.tim-install'); if (b) b.remove(); });

  function bannerAllowed() {
    if (standalone || !signedIn()) return false;
    const sides = cfg().INSTALL_SIDES || ['right'];
    if (sides.indexOf(ls.get('side')) < 0) return false;
    const off = Number(ls.get('install_later') || 0);
    return !(off && Date.now() - off < 7 * 864e5);
  }

  function maybeBanner() {
    if (!document.body || !bannerAllowed() || document.querySelector('.tim-install')) return;
    let help = '';
    let action = '';
    if (deferredPrompt) action = 'Thêm';
    else if (isIOS) help = 'Trong Safari: chạm ••• hoặc nút Chia sẻ, chọn “Thêm vào MH chính”, rồi bật “Mở như ứng dụng web”.';
    else if (isAndroid) help = 'Mở menu ⋮ của trình duyệt, chọn “Thêm vào màn hình chính” hoặc “Cài đặt ứng dụng”.';
    else return;

    const el = document.createElement('aside');
    el.className = 'tim-install';
    el.innerHTML = `
      <img src="${new URL('icons/icon-192.png', ROOT).href}" alt="">
      <div class="tim-install-text">
        <strong>Thêm “Our Story” vào màn hình chính</strong>
        <span>${esc(help || 'Mở tất cả các trò anh làm như một app')}</span>
      </div>
      ${action ? `<button type="button" class="tim-btn" data-a="add">${action}</button>` : ''}
      <button type="button" class="tim-install-x" aria-label="Đóng"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M18 6L6 18M6 6l12 12"/></svg></button>`;
    document.body.appendChild(el);
    el.querySelector('.tim-install-x').addEventListener('click', () => { ls.set('install_later', String(Date.now())); el.remove(); });
    const add = el.querySelector('[data-a="add"]');
    if (add) add.addEventListener('click', async () => {
      const p = deferredPrompt;
      deferredPrompt = null;
      el.remove();
      if (!p) return;
      p.prompt();
      try { await p.userChoice; } catch (e) { /* closed */ }
    });
  }

  function onReady() {
    if (needsUnlock) showLock();
    else {
      offerFingerprint();
      setTimeout(maybeBanner, 2500);   // gives Chrome time to offer its install prompt first
    }
    addFingerprintToggle();
    // The home page re-draws its footer after sign-in; look again a moment later.
    setTimeout(addFingerprintToggle, 1500);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', onReady);
  else onReady();

  window.Pwa = { standalone, isIOS, isAndroid, toast, hasPasskey };
})();
