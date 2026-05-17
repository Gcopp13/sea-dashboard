// S.E.A. Dashboard Service Worker — Push Notifications

self.addEventListener('install', e => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(clients.claim()));

self.addEventListener('push', e => {
  if (!e.data) return;
  let data;
  try { data = e.data.json(); } catch { data = { title: 'S.E.A. Dashboard', body: e.data.text() }; }

  const title = data.title || 'S.E.A. Dashboard';
  const options = {
    body: data.body || '',
    icon: '/favicon.ico',
    badge: '/favicon.ico',
    tag: data.tag || 'sea-notification',
    renotify: true,
    data: { url: data.url || '/' },
    actions: data.actions || []
  };

  e.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', e => {
  e.notification.close();
  const url = e.notification.data?.url || '/';
  e.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(windowClients => {
      // Focus existing tab if open
      for (const client of windowClients) {
        if (client.url.includes('sea-dashboard.netlify.app') && 'focus' in client) {
          client.focus();
          if (url !== '/') client.navigate(url);
          return;
        }
      }
      // Otherwise open new tab
      if (clients.openWindow) return clients.openWindow(url);
    })
  );
});
