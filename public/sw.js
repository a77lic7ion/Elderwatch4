const CACHE_NAME = 'elderwatch-v7';
const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/manifest.json',
  '/elderwatch-logo.png',
  '/elderwatch-logo.svg',
  '/apple-touch-icon.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(STATIC_ASSETS);
    }).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
      );
    }).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // For API calls, Firebase, or Server-Sent Events, don't cache with service worker
  if (url.pathname.startsWith('/api/') || url.hostname.includes('googleapis.com') || url.hostname.includes('firebaseio.com') || url.hostname.includes('firestore.googleapis.com')) {
    return;
  }

  // Navigation requests: Network first, fall back to cached index.html for SPA offline support
  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request).catch(() => {
        return caches.match('/index.html') || caches.match('/');
      })
    );
    return;
  }

  // Static assets: Stale-while-revalidate or cache first
  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      if (cachedResponse) {
        return cachedResponse;
      }
      return fetch(event.request).then((networkResponse) => {
        if (!networkResponse || networkResponse.status !== 200 || networkResponse.type !== 'basic') {
          return networkResponse;
        }
        const responseToCache = networkResponse.clone();
        caches.open(CACHE_NAME).then((cache) => {
          cache.put(event.request, responseToCache);
        });
        return networkResponse;
      });
    }).catch(() => {
      // offline fallback
      if (event.request.headers.get('accept')?.includes('text/html')) {
        return caches.match('/index.html');
      }
    })
  );
});

// Push notification event listener
self.addEventListener('push', (event) => {
  let data = { title: 'ElderWatch Wellness Alert', body: 'Daily wellness check-in update' };
  if (event.data) {
    try {
      data = event.data.json();
    } catch {
      data.body = event.data.text();
    }
  }

  const options = {
    body: data.body,
    icon: '/elderwatch-logo.png',
    badge: '/elderwatch-logo.svg',
    vibrate: [200, 100, 200],
    data: {
      url: data.url || '/'
    }
  };

  event.waitUntil(
    self.registration.showNotification(data.title, options)
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const targetUrl = event.notification.data?.url || '/';
  const origin = self.location.origin;
  // Build absolute URL — targetUrl may be relative like /checkin/res-xxx
  const absoluteUrl = targetUrl.startsWith('http') ? targetUrl : origin + targetUrl;

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windowClients) => {
      // If there's already an open window (the TWA), focus it and navigate
      for (const client of windowClients) {
        if ('focus' in client) {
          client.focus();
          // Navigate the existing window to the target URL
          if ('navigate' in client) {
            return client.navigate(absoluteUrl);
          }
          return;
        }
      }
      // No existing window — open a new one (will launch the TWA)
      if (clients.openWindow) {
        return clients.openWindow(absoluteUrl);
      }
    })
  );
});

// Handle messages from clients
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SET_RESIDENT_URL') {
    // Store the resident URL for PWA launch
    const url = event.data.url;
    if (url) {
      // Use IndexedDB or just rely on the client to set localStorage
      // The client-side code will handle this
    }
  }
});
