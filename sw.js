// Service worker: lets Bountiful be installed on a phone's home screen and
// open fast. It always asks the internet first, so updates show up right away.
// It also shows phone notifications sent by the server (supabase/functions/push), even when the app is closed.
const CACHE = 'bountiful-shell-v4';

self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(caches.open(CACHE));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== self.location.origin) return; // never touch Supabase calls
  event.respondWith(
    fetch(req, { cache: 'no-cache' }) // always check with the server, so new versions show up at once
      .then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(req, copy));
        return res;
      })
      .catch(() => caches.match(req).then((hit) => hit || caches.match('./')))
  );
});

// Phone notifications: when the notification service sends a message, show it; tapping it opens the app.
self.addEventListener('push', (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch (_) { data = { body: event.data && event.data.text() }; }
  event.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
    // Every push MUST show a notification: iPhones count "silent" pushes and cancel the sign-up after a few of them,
    // which is why notifications used to stop appearing now and then. So it is always shown; when the app is open
    // it disappears again after a few seconds, and the app is told to catch up (in case its live connection had dropped).
    const open = list.some((c) => c.visibilityState === 'visible');
    if (open) list.forEach((c) => c.postMessage({ type: 'push' }));
    const tag = data.tag || 'b-' + Date.now();
    return self.registration.showNotification(data.title || 'Bountiful', {
      body: data.body || '', icon: 'assets/logo/icon-192.png', badge: 'assets/logo/icon-192.png',
      data: { url: data.url || './' }, tag, renotify: true, // renotify: a second notification with the same tag still buzzes
    }).then(() => (open ? new Promise((r) => setTimeout(r, 6000)).then(() => self.registration.getNotifications({ tag }).then((ns) => ns.forEach((n) => n.close()))) : null));
  }));
});
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = new URL((event.notification.data && event.notification.data.url) || './', self.registration.scope).href;
  event.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
    for (const c of list) {
      if ('focus' in c) {
        return c.focus().then(() => ('navigate' in c ? c.navigate(url).catch(() => {}) : null));
      }
    }
    return self.clients.openWindow(url);
  }));
});
