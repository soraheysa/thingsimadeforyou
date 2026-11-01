/*
 * Service worker for the installed app ("Our Story").
 * It caches nothing: every page always comes fresh from GitHub Pages, so updates show up at once.
 * Its only job is a friendly page when the phone is offline.
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

self.addEventListener('fetch', event => {
  if (event.request.mode !== 'navigate') return;
  event.respondWith(
    fetch(event.request).catch(() => new Response(OFFLINE_PAGE, { headers: { 'Content-Type': 'text/html; charset=utf-8' } }))
  );
});
