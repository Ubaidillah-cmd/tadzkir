// Service worker: cache app shell agar bisa dibuka offline + menampilkan notifikasi.
const CACHE = 'tadzkir-v4';
const FILES = ['./', 'index.html', 'style.css', 'script.js', 'manifest.json', 'assets/logo.png', 'assets/icon.png', 'favicon.svg'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(FILES)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
// Network-first: selalu coba ambil file terbaru; cache hanya dipakai saat offline.
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  e.respondWith(fetch(e.request).then(res => {
    if (res.ok && new URL(e.request.url).origin === location.origin) {
      const copy = res.clone(); caches.open(CACHE).then(c => c.put(e.request, copy));
    }
    return res;
  }).catch(() => caches.match(e.request).then(hit => hit || caches.match('index.html'))));
});
// Klik notifikasi: tombol "Tunda" mengirim pesan ke aplikasi; selain itu fokus/buka aplikasi.
self.addEventListener('notificationclick', e => {
  e.notification.close();
  const id = e.notification.data && e.notification.data.id;
  const snooze = e.action === 'snooze' && id;
  e.waitUntil(self.clients.matchAll({ type: 'window' }).then(list => {
    if (list.length) { if (snooze) list[0].postMessage({ snooze: id }); return list[0].focus(); }
    return self.clients.openWindow('./index.html' + (snooze ? '?snooze=' + id : ''));
  }));
});
