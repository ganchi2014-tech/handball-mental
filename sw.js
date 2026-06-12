// Service Worker - handball-mental v3 (オフライン起動対応)
// v2の問題: CDN(unpkg/gstatic)のレスポンスは type=cors/opaque のため一切キャッシュされず、
// 圏外では React/Babel が読めずアプリが白画面になっていた。
const CACHE_NAME = 'handball-mental-v3';

// アプリ起動に必要な全資産（CDN含む）を初回インストール時にプリキャッシュ
const ASSETS = [
  './',
  './index.html',
  './manifest.json',
  'https://unpkg.com/react@18/umd/react.production.min.js',
  'https://unpkg.com/react-dom@18/umd/react-dom.production.min.js',
  'https://unpkg.com/@babel/standalone/babel.min.js',
  'https://www.gstatic.com/firebasejs/10.13.2/firebase-app-compat.js',
  'https://www.gstatic.com/firebasejs/10.13.2/firebase-auth-compat.js',
  'https://www.gstatic.com/firebasejs/10.13.2/firebase-database-compat.js'
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
    caches.open(CACHE_NAME).then(cache =>
      Promise.all(ASSETS.map(url =>
        // no-cors で取得（opaqueでも script タグからは利用可能）
        fetch(new Request(url, { mode: url.startsWith('http') ? 'no-cors' : 'same-origin' }))
          .then(resp => cache.put(url, resp))
          .catch(err => console.warn('[SW] precache failed:', url, err))
      ))
    )
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

  // cache-first ＋ バックグラウンド更新（opaque/cors も保存する）
  e.respondWith(
    caches.match(e.request, { ignoreSearch: false }).then(cached => {
      const networkFetch = fetch(e.request).then(resp => {
        if (resp && (resp.status === 200 || resp.type === 'opaque')) {
          const respClone = resp.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(e.request, respClone));
        }
        return resp;
      }).catch(() => {
        if (cached) return cached;
        // 画面遷移のみ index.html へフォールバック（JS等へのHTML誤返却を防ぐ）
        if (e.request.mode === 'navigate') return caches.match('./index.html');
        return Response.error();
      });
      return cached || networkFetch;
    })
  );
});
