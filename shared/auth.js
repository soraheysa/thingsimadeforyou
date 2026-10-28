/*
 * Shared sign-in for every page in this repo.
 *
 * All pages live on the same address (soraheysa.github.io), so they share browser storage:
 * signing in once on the home page signs you in everywhere.
 *
 * In an app page:
 *   <script src="../shared/config.js"></script>
 *   <script src="../shared/mock.js"></script>      (only needed for preview mode)
 *   <script src="../shared/auth.js"></script>
 *   ...
 *   await Auth.require();                          // sends to the home page if not signed in
 *   const r = await Auth.call('someAction', {...}); // calls the shared backend with email + token
 *   fetch(otherBackend, { method: 'POST', body: JSON.stringify(Object.assign({ action }, Auth.credentials(), payload)) })
 */
(function () {
  'use strict';

  const CFG = window.SHARED_CONFIG || {};
  const ROOT = new URL('../', document.currentScript.src);   // the repo root, e.g. …/thingsimadeforyou/

  const wrap = area => ({
    get: k => { try { return area.getItem('tim_' + k); } catch (e) { return null; } },
    set: (k, v) => { try { area.setItem('tim_' + k, v); } catch (e) { /* private mode */ } },
    del: k => { try { area.removeItem('tim_' + k); } catch (e) { /* private mode */ } },
  });
  const ls = wrap(window.localStorage);
  const ss = wrap(window.sessionStorage);

  if (new URLSearchParams(location.search).has('demo')) ss.set('demo', '1');
  const DEMO = !CFG.AUTH_API_URL || ss.get('demo') === '1';

  const tz = (() => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone; } catch (e) { return ''; } })();

  function credentials() {
    return { email: ls.get('email') || '', token: ls.get('token') || '' };
  }

  /** POST to a backend. No Content-Type header, so Apps Script needs no CORS preflight. */
  async function post(url, body) {
    try {
      if (DEMO) return await window.MockBackend.handle(body);
      const res = await fetch(url, { method: 'POST', body: JSON.stringify(body), redirect: 'follow' });
      if (!res.ok) return { ok: false, error: 'network' };
      return await res.json();
    } catch (e) {
      return { ok: false, error: 'network' };
    }
  }

  /** Call the shared backend with the signed-in person's email, token and timezone attached. */
  function call(action, payload) {
    return post(CFG.AUTH_API_URL, Object.assign({ action, tz }, credentials(), payload || {}));
  }

  function hubUrl(next) {
    const u = new URL(ROOT.href);
    if (next) u.searchParams.set('next', next);
    if (ss.get('demo') === '1') u.searchParams.set('demo', '1');
    return u.href;
  }

  /** Only allow returning to pages inside this repo. */
  function safeNext(next) {
    if (!next) return null;
    try {
      const u = new URL(next, location.href);
      if (u.origin === location.origin && u.pathname.startsWith(ROOT.pathname) && u.pathname !== ROOT.pathname) {
        return u.pathname + u.search + u.hash;
      }
    } catch (e) { /* invalid */ }
    return null;
  }

  const hasSession = () => { const c = credentials(); return !!(c.email && c.token); };
  const confirmed = () => CFG.CONFIRM_EMAIL === 'device' || ss.get('confirmed') === '1';

  function goHub() {
    location.replace(hubUrl(location.pathname + location.search + location.hash));
    return new Promise(() => {});   // the page is leaving; never resolve
  }

  /** For app pages: continue only when signed in (and email confirmed this visit). */
  function require() {
    return hasSession() && confirmed() ? Promise.resolve(credentials()) : goHub();
  }

  /** The backend said the token is no longer valid. */
  function expired() {
    ls.del('token');
    ss.del('confirmed');
    return goHub();
  }

  async function signOut() {
    await call('signOut');
    ls.del('token');
    ss.del('confirmed');
    location.href = hubUrl();
  }

  /** Used by the home page after a successful sign-in. */
  function saveSession(email, token, me) {
    ls.set('email', email);
    if (token) ls.set('token', token);
    if (me && me.name) ls.set('name', me.name);
    if (me && me.side) ls.set('side', me.side);
    ss.set('confirmed', '1');
  }


  /* ───────── Release dates (THINGS[].opensAt in shared/config.js) ───────── */

  const thing = path => (CFG.THINGS || []).find(t => t.path === path) || null;

  /** Milliseconds until a thing opens; 0 when it is open (or has no date). */
  function opensIn(t) {
    if (!t || !t.opensAt) return 0;
    const ms = Date.parse(t.opensAt) - Date.now();
    return ms > 0 ? ms : 0;
  }

  function splitMs(ms) {
    const s = Math.floor(ms / 1000);
    return { d: Math.floor(s / 86400), h: Math.floor(s % 86400 / 3600), m: Math.floor(s % 3600 / 60), s: s % 60 };
  }
  const pad = n => String(n).padStart(2, '0');
  function countdownText(ms) {
    const p = splitMs(ms);
    return (p.d ? p.d + ' ngày ' : '') + pad(p.h) + ':' + pad(p.m) + ':' + pad(p.s);
  }

  /** "00:00, Thứ Hai, 2 tháng 11 theo giờ Đức (06:00 giờ Việt Nam)" */
  function openTimeText(t) {
    const d = new Date(t.opensAt);
    const time = zone => new Intl.DateTimeFormat('vi-VN', { timeZone: zone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(d);
    const day = zone => new Intl.DateTimeFormat('vi-VN', { timeZone: zone, weekday: 'long', day: 'numeric', month: 'long' }).format(d);
    const de = day('Europe/Berlin'), vn = day('Asia/Ho_Chi_Minh');
    return `${time('Europe/Berlin')}, ${de} theo giờ Đức (${time('Asia/Ho_Chi_Minh')}${vn === de ? '' : ', ' + vn} giờ Việt Nam)`;
  }

  /**
   * For an app page: if its release date is still ahead, cover the page with a
   * "Trò này chưa ra mắt" screen and a live countdown, and reload the page when it opens.
   */
  function waitForRelease(path) {
    const t = thing(path);
    if (!opensIn(t)) return Promise.resolve();

    const css = document.createElement('link');
    css.rel = 'stylesheet';
    css.href = new URL('shared/lock.css', ROOT).href;
    document.head.appendChild(css);

    const el = document.createElement('div');
    el.className = 'tl-root';
    el.innerHTML = `
      <div class="tl-half tl-left" aria-hidden="true"></div>
      <div class="tl-half tl-right" aria-hidden="true"></div>
      <div class="tl-thread" aria-hidden="true"></div>
      <div class="tl-wrap">
        <section class="tl-card">
          <h1 class="tl-title">Trò này chưa ra mắt</h1>
          <p class="tl-lede"></p>
          <div class="tl-count" role="timer" aria-live="off">
            <div><b data-u="d">0</b><span>ngày</span></div>
            <div><b data-u="h">00</b><span>giờ</span></div>
            <div><b data-u="m">00</b><span>phút</span></div>
            <div><b data-u="s">00</b><span>giây</span></div>
          </div>
          <a class="tl-btn" href="${new URL('', ROOT).href}">Về trang chính</a>
        </section>
      </div>`;
    el.querySelector('.tl-lede').textContent = `${t.title} sẽ mở lúc ${openTimeText(t)}.`;
    document.body.appendChild(el);
    document.documentElement.style.overflow = 'hidden';

    const tick = () => {
      const ms = opensIn(t);
      if (!ms) { location.reload(); return; }
      const p = splitMs(ms);
      el.querySelector('[data-u=d]').textContent = p.d;
      el.querySelector('[data-u=h]').textContent = pad(p.h);
      el.querySelector('[data-u=m]').textContent = pad(p.m);
      el.querySelector('[data-u=s]').textContent = pad(p.s);
    };
    tick();
    setInterval(tick, 1000);
    return new Promise(() => {});   // the app stays paused until the reload
  }

  window.Auth = {
    DEMO, ROOT, ls, ss,
    credentials, post, call, require, expired, signOut,
    saveSession, hubUrl, safeNext, hasSession, confirmed,
    thing, opensIn, countdownText, openTimeText, waitForRelease,
  };
})();
