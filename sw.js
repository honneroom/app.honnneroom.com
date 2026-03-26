// 本音ルーム Service Worker（プッシュ通知対応版）
const CACHE_NAME = 'honneroom-v3';
const STATIC_ASSETS = [
  '/manifest.json',
  '/assets/icon.png'
];

// インストール
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(STATIC_ASSETS).catch(() => {});
    })
  );
});

// アクティベート
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys
          .filter((key) => key !== CACHE_NAME)
          .map((key) => caches.delete(key))
      );
    })
  );
  self.clients.claim();
});

// フェッチ
self.addEventListener('fetch', (event) => {
  const request = event.request;
  const url = new URL(request.url);

  const isApi =
    url.hostname.includes('supabase.co') ||
    url.hostname.includes('stripe.com') ||
    url.hostname.includes('googleapis.com') ||
    url.hostname.includes('googletagmanager.com');

  if (isApi || request.method !== 'GET') {
    return;
  }

  if (request.destination === 'document') {
    event.respondWith(
      fetch(request).catch(() => caches.match('/index.html'))
    );
    return;
  }

  if (
    request.destination === 'image' ||
    request.url.includes('/assets/')
  ) {
    event.respondWith(
      caches.match(request).then((cached) => {
        if (cached) return cached;
        return fetch(request).then((response) => {
          if (response && response.status === 200) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => {
              cache.put(request, clone);
            });
          }
          return response;
        });
      })
    );
    return;
  }

  event.respondWith(fetch(request));
});

// ===== プッシュ通知受信 =====
self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch (e) {
    data = { title: '本音ルーム', body: event.data ? event.data.text() : '新しい通知があります' };
  }

  const title = data.title || '本音ルーム';
  const options = {
    body: data.body || '新しい通知があります',
    icon: '/assets/icon.png',
    badge: '/assets/icon.png',
    tag: data.tag || 'honneroom-notif-' + Date.now(),
    renotify: true,
    data: {
      url: data.url || '/app.html'
    }
  };

  event.waitUntil(
    self.registration.showNotification(title, options).then(() => {
      // アプリが開いていればDBから未読数を再取得させる
      return clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
        for (const client of clientList) {
          if (client.url.includes('app.honneroom.com')) {
            client.postMessage({ type: 'PUSH_RECEIVED' });
          }
        }
      });
    })
  );
});

// ===== 通知クリック時 =====
self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  const url = event.notification.data?.url || '/app.html';
  const fullUrl = new URL(url, self.location.origin).href;

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if (client.url.includes('app.honneroom.com') && 'focus' in client) {
          return client.focus();
        }
      }
      return clients.openWindow(fullUrl);
    })
  );
});
