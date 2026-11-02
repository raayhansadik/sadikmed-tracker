// SadikMed Tracker Service Worker (Offline Resilience, Instant Loading & Push Notifications)
const CACHE_NAME = 'sadikmed-v4-prod';
const STATIC_ASSETS = [
  '/',
  '/sadikmed',
  '/sadikmed.html',
  '/index.html',
  '/assets/sadikmed-logo.png',
  '/assets/favicon-48x48.png',
  '/assets/medical-sketches-bg.svg'
];

self.addEventListener('install', event => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      return cache.addAll(STATIC_ASSETS).catch(err => {
        console.warn('Pre-cache warning (non-fatal):', err);
      });
    })
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys => {
      return Promise.all(
        keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))
      );
    }).then(() => self.clients.claim())
  );
});

// FETCH HANDLER: Network-First with Timeout & Cache Fallback
self.addEventListener('fetch', event => {
  const req = event.request;
  const url = new URL(req.url);

  // Bypass non-GET and API / dynamic endpoints
  if (req.method !== 'GET' || url.pathname.startsWith('/api/')) {
    return;
  }

  // Navigation requests (HTML pages)
  if (req.mode === 'navigate' || req.destination === 'document') {
    event.respondWith(
      (async () => {
        // Fast network fetch with 2500ms timeout
        const fetchPromise = fetch(req).then(async networkRes => {
          if (networkRes && networkRes.status === 200) {
            const cache = await caches.open(CACHE_NAME);
            cache.put(req, networkRes.clone());
            cache.put('/', networkRes.clone());
          }
          return networkRes;
        });

        const timeoutPromise = new Promise(resolve => {
          setTimeout(resolve, 2500, null);
        });

        try {
          const res = await Promise.race([fetchPromise, timeoutPromise]);
          if (res) return res;
        } catch (e) {
          // Network error: fall through to cache
        }

        // Network took >2.5s or failed: return cached copy immediately
        const cached = (await caches.match(req)) || (await caches.match('/')) || (await caches.match('/sadikmed.html'));
        if (cached) return cached;

        // If no cache yet, await original network request
        return fetchPromise;
      })()
    );
    return;
  }

  // Static Assets (Images, SVGs, Fonts, Icons)
  if (url.pathname.startsWith('/assets/') || req.destination === 'image' || req.destination === 'style' || req.destination === 'script') {
    event.respondWith(
      caches.match(req).then(cachedRes => {
        const fetchPromise = fetch(req).then(networkRes => {
          if (networkRes && networkRes.status === 200) {
            caches.open(CACHE_NAME).then(cache => cache.put(req, networkRes.clone()));
          }
          return networkRes;
        }).catch(() => null);

        // Stale-While-Revalidate: return cache instantly if available, fetch update in background
        return cachedRes || fetchPromise;
      })
    );
    return;
  }
});

// PUSH NOTIFICATION HANDLER
self.addEventListener('push', event => {
  let data = { title: 'SadikMed Reminder', body: 'Time for your scheduled medication dose!' };
  try {
    if (event.data) data = event.data.json();
  } catch (e) {
    if (event.data) data.body = event.data.text();
  }

  const options = {
    body: data.body || 'Time for your prescribed dose!',
    icon: '/assets/sadikmed-logo.png',
    badge: '/assets/favicon-48x48.png',
    vibrate: [200, 100, 200],
    tag: data.tag || 'sadikmed-dose',
    renotify: true,
    data: data.data || { url: '/' }
  };

  event.waitUntil(self.registration.showNotification(data.title || 'SadikMed Tracker', options));
});

// NOTIFICATION CLICK HANDLER
self.addEventListener('notificationclick', event => {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clientList => {
      for (const client of clientList) {
        if (client.url && 'focus' in client) {
          return client.focus();
        }
      }
      if (self.clients.openWindow) {
        return self.clients.openWindow('/');
      }
    })
  );
});
