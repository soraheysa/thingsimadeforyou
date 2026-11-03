/*
 * Service worker for the installed app ("Our Story").
 * It caches nothing: every page always comes fresh from GitHub Pages, so updates show up at once.
 * It shows a friendly page when the phone is offline, and draws the "Nhớ" notifications (below).
 */
const OFFLINE_PAGE = `<!doctype html><html lang="vi"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Our Story</title>
<style>
  html,body{margin:0;height:100%}
  body{display:flex;align-items:center;justify-content:center;padding:32px;box-sizing:border-box;
    font-family:system-ui,-apple-system,'Segoe UI',sans-serif;color:#fff;text-align:center;
    background:linear-gradient(180deg,#971AC1 0%,#5200B0 100%)}
  h1{font-size:22px;margin:0 0 8px} p{margin:0 0 20px;color:#E4D9F7}
  button{min-height:44px;padding:0 22px;border:0;border-radius:999px;background:#fff;color:#5200B0;font:600 15px system-ui,sans-serif}
</style></head><body><main>
<h1>Mất kết nối mạng rồi</h1>
<p>Kiểm tra Wi-Fi hoặc dữ liệu di động, rồi thử lại nhé.</p>
<button type="button" onclick="location.reload()">Thử lại</button>
</main></body></html>`;

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', event => event.waitUntil(self.clients.claim()));

/*
 * Notifications from the "Nhớ" heart (nho/backend/Code.gs sends them through Firebase Cloud Messaging).
 * They arrive as data-only messages, so this worker draws them itself: our icon, one notification
 * that updates in place (tag) and still buzzes again (renotify), and a tap that opens Our Story.
 */
self.addEventListener('push', event => {
  let d = {};
  try {
    const j = event.data ? event.data.json() : {};
    d = Object.assign({}, j.notification || {}, j.data || j);
  } catch (e) {
    d = { body: event.data ? event.data.text() : '' };
  }
  const scope = self.registration.scope;
  const show = self.registration.showNotification(d.title || 'Our Story', {
    body: d.body || '',
    icon: new URL('icons/icon-192.png', scope).href,
    tag: d.tag || 'our-story',
    renotify: true,
    vibrate: [90, 60, 90],
    data: { url: d.url || scope },
  });
  // Open pages refresh their counters straight away.
  const tell = self.clients.matchAll({ type: 'window', includeUncontrolled: true })
    .then(list => list.forEach(c => c.postMessage({ type: 'nho' })));
  event.waitUntil(Promise.all([show, tell]));
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  const scope = self.registration.scope;
  const url = (event.notification.data && event.notification.data.url) || scope;
  event.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
    const open = list.find(c => c.url.startsWith(scope) && 'focus' in c);
    return open ? open.focus() : self.clients.openWindow(url);
  }));
});

self.addEventListener('fetch', event => {
  if (event.request.mode !== 'navigate') return;
  event.respondWith(
    fetch(event.request).catch(() => new Response(OFFLINE_PAGE, { headers: { 'Content-Type': 'text/html; charset=utf-8' } }))
  );
});
