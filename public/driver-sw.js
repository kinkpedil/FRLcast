// Minimal service worker, registered for one reason.
//
// Android Chrome refuses `new Notification(...)` outright — the constructor throws and
// tells you to use a service worker registration instead. So one has to exist before a
// driver's phone can show a flag alert at all. It caches nothing and intercepts nothing:
// adding offline caching here would serve a stale flag from disk, which is the one
// failure this page must never have.

self.addEventListener('install', (e) => e.waitUntil(self.skipWaiting()));
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

// Tapping a flag alert brings the driver page back rather than opening a second copy.
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const c of all) {
      if (c.url.includes('/driver') && 'focus' in c) return c.focus();
    }
    if (self.clients.openWindow) return self.clients.openWindow('/driver.html');
    return undefined;
  })());
});
