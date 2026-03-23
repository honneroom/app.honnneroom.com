// 本音ルーム Service Worker
const CACHE_NAME = 'honneroom-v1';

// キャッシュするファイル（オフライン時の最低限の表示用）
const STATIC_ASSETS = [
  '/index.html',
  '/manifest.json',
  '/assets/icon.png'
];

// インストール時：静的ファイルをキャッシュ
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(STATIC_ASSETS).catch((err) => {
        console.warn('Cache addAll failed (some files may not exist yet):', err);
      });
    })
  );
  self.skipWaiting();
});

// アクティベート時：古いキャッシュを削除
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

// フェッチ時の戦略：
// - Supabase / Stripe などのAPIリクエスト → 必ずネットワーク優先
// - 静的アセット → キャッシュ優先、なければネットワーク
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // APIリクエストはキャッシュしない
  const isApi =
    url.hostname.includes('supabase.co') ||
    url.hostname.includes('stripe.com') ||
    url.hostname.includes('googleapis.com') ||
    url.hostname.includes('googletagmanager.com');

  if (isApi || event.request.method !== 'GET') {
    return; // ブラウザデフォルト（ネットワーク直接）
  }

  // 静的アセット：キャッシュ優先
  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached;
      return fetch(event.request).then((response) => {
        // 正常なレスポンスのみキャッシュ
        if (response && response.status === 200 && response.type === 'basic') {
          const toCache = response.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, toCache);
          });
        }
        return response;
      }).catch(() => {
        // オフライン時はindex.htmlにフォールバック
        if (event.request.destination === 'document') {
          return caches.match('/index.html');
        }
      });
    })
  );
});
