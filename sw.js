// Service Worker - handball-mental v2 (Firebase RTDB対応)
const CACHE_NAME = 'handball-mental-v2';
const ASSETS = [
  './',
  './index.html',
  './manifest.json'
];

// キャッシュしないドメイン（リアルタイム/認証のため常にネット直で取得）
const NO_CACHE_HOSTS = [
  'firebaseio.com',
  'firebasedatabase.app',
  'googleapis.com',
  'identitytoolkit',
  'securetoken'
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys => Promise.all(
      keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))
    ))
  );
  self.clients.claim();
});

self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  const url = new URL(e.request.url);

  // Firebase / Google認証系は常にネット直
  if (NO_CACHE_HOSTS.some(host => url.hostname.includes(host))) {
    return; // SW がハンドリングしない = ブラウザ標準の fetch
  }

  // Firebase SDK 本体（gstatic）はキャッシュ可、ただし stale-while-revalidate
  e.respondWith(
    caches.match(e.request).then(cached => {
      const networkFetch = fetch(e.request).then(resp => {
        if (resp && resp.status === 200 && resp.type === 'basic') {
          const respClone = resp.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(e.request, respClone));
        }
        return resp;
      }).catch(() => cached || caches.match('./'));
      return cached || networkFetch;
    })
  );
});
