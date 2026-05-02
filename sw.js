const CACHE_NAME = 'huberhorti-v3';


const ASSETS = [
  '/dashboard.html',
  '/supabase.js',
  '/utils.js'
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', e => {
  e.respondWith(
    fetch(e.request).catch(() => caches.match(e.request))
  );
});

self.addEventListener('push', e => {
  console.log('PUSH RECEBIDO', e.data ? e.data.text() : 'sem dados');
  const data = e.data ? e.data.json() : {};

  e.waitUntil(
    self.registration.showNotification(data.title || 'HuberHorti', {
      body: data.body || 'Pedido atualizado',
      icon: '/icon-192.png',
      badge: '/icon-192.png',
      tag: 'huberhorti-update',
      renotify: true
    })
  );
});

self.addEventListener('notificationclick', e => {
  e.notification.close();
  e.waitUntil(
    clients.matchAll({ type: 'window' }).then(list => {
      for (const client of list) {
        if (client.url.includes('pedidos_entregas') && 'focus' in client)
          return client.focus();
      }
      if (clients.openWindow)
        return clients.openWindow('/pedidos_entregas.html');
    })
  );
});