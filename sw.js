// 本音ルーム Service Worker（修正版）

const CACHE_NAME = 'honneroom-v2';

// ❗HTMLはキャッシュしないので含めない
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
  // ❗skipWaitingは不具合回避のため一旦外す
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

  // ❗API系は絶対キャッシュしない
  const isApi =
    url.hostname.includes('supabase.co') ||
    url.hostname.includes('stripe.com') ||
    url.hostname.includes('googleapis.com') ||
    url.hostname.includes('googletagmanager.com');

  if (isApi || request.method !== 'GET') {
    return;
  }

  // ❗① HTML（document）は必ずネットワーク優先
  if (request.destination === 'document') {
    event.respondWith(
      fetch(request).catch(() => caches.match('/index.html'))
    );
    return;
  }

  // ❗② 画像・静的ファイルのみキャッシュ
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

// プッシュ通知受信
self.addEventListener('push', (event) => {
  const data = event.data ? event.data.json() : {};
  const title = data.title || '本音ルーム';
  const options = {
    body: data.body || '新しい通知があります',
    icon: '/assets/icon.png',
    badge: '/assets/icon.png',
    tag: data.tag || 'honneroom-notif',
    data: { url: data.url || '/app.html' }
  };
  event.waitUntil(
    self.registration.showNotification(title, options)
  );
});

// 通知クリック時
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = event.notification.data?.url || '/app.html';
  event.waitUntil(
    clients.matchAll({ type: 'window' }).then((clientList) => {
      for (const client of clientList) {
        if (client.url.includes('app.honneroom.com') && 'focus' in client) {
          return client.focus();
        }
      }
      return clients.openWindow(url);
    })
  );
});
  // ❗それ以外はネットワーク優先（キャッシュしない）
  event.respondWith(fetch(request));
});
