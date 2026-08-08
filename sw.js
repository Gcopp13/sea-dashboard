// S.E.A. Dashboard Service Worker — Push Notifications + Update Management
//
// SW_VERSION: bump this whenever you ship a user-facing change so returning
// users pick up the new HTML on their next visit. Format: YYYY-MM-DD-N.
// Any change to this file (including this string) triggers a byte-diff on
// /sw.js, which the browser detects and installs as a new worker.
const SW_VERSION = '2026-07-30-6';
const CACHE_NAME = `sea-dashboard-${SW_VERSION}`;

// Precache the app shell so we have something to fall back to offline,
// and — more importantly — so browser update detection has a real payload
// to install/activate against. Runtime strategy is network-first for HTML,
// so the cache is only used as an offline fallback, not as the primary source.
const APP_SHELL = ['/', '/index.html'];

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    try {
      await cache.addAll(APP_SHELL);
    } catch (err) {
      // Non-fatal — offline fallback just won't be primed on this install.
      console.warn('[sw] precache failed:', err);
    }
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    // Drop every cache that isn't the current version.
    const names = await caches.keys();
    await Promise.all(
      names
        .filter(n => n.startsWith('sea-dashboard-') && n !== CACHE_NAME)
        .map(n => caches.delete(n))
    );
    await self.clients.claim();
    // Tell every open tab that a new version is live so it can prompt reload.
    const clientsList = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const client of clientsList) {
      client.postMessage({ type: 'SW_UPDATED', version: SW_VERSION });
    }
  })());
});

// Network-first for HTML navigations — always try the network so users get
// the latest deploy. Fall back to cache only when offline.
// Everything else (JS, images, etc.) passes through to the network normally;
// Netlify already sends `must-revalidate` so the HTTP cache stays honest.
self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const isNavigation =
    req.mode === 'navigate' ||
    (req.destination === 'document') ||
    (req.headers.get('accept') || '').includes('text/html');

  if (!isNavigation) return; // let the browser handle non-navigation requests

  event.respondWith((async () => {
    try {
      const fresh = await fetch(req);
      // Update the offline fallback opportunistically.
      if (fresh && fresh.ok) {
        const cache = await caches.open(CACHE_NAME);
        cache.put('/index.html', fresh.clone()).catch(() => {});
      }
      return fresh;
    } catch (err) {
      const cache = await caches.open(CACHE_NAME);
      const cached = (await cache.match(req)) || (await cache.match('/index.html')) || (await cache.match('/'));
      if (cached) return cached;
      throw err;
    }
  })());
});

// Allow the page to trigger an immediate activation of a waiting SW.
self.addEventListener('message', event => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

// ── Push notifications ─────────────────────────────────────────────────────
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
      // Focus existing window and send a postMessage to handle routing
      // (client.navigate() is not supported on iOS Safari/PWA)
      for (const client of windowClients) {
        if ((client.url.includes('sea-dashboard.gettingresultsinc.com') || client.url.includes('sea-dashboard.netlify.app')) && 'focus' in client) {
          client.focus();
          if (url !== '/') client.postMessage({ type: 'DEEP_LINK', url });
          return;
        }
      }
      // No existing window — open a new one (URL params handled on load)
      if (clients.openWindow) return clients.openWindow(url);
    })
  );
});
