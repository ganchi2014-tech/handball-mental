// Service Worker - handball-mental v4 (オフライン起動 + HTML自動更新)
// v2の問題: CDN(unpkg/gstatic)のレスポンスは type=cors/opaque のため一切キャッシュされず、
// 圏外では React/Babel が読めずアプリが白画面になっていた → v3でCDNもプリキャッシュ。
// v3の問題: index.html もキャッシュ優先だったため、デプロイしても各端末が古い版を表示し続け、
// 新機能（例: フィジカル入力ボタン）が出なかった → v4でHTMLは network-first（オンライン時は常に最新）。
// v4の問題: ASSETS の @babel/standalone がバージョン無指定(=latest=v8)で index.html(@7.26.4固定)と不一致。
// 圏外では固定版(@7.26.4)がプリキャッシュされず白画面になり得た → v5で @7.26.4 に統一（白画面固定の貫徹）。
const CACHE_NAME = 'handball-mental-v5';

// アプリ起動に必要な全資産（CDN含む）を初回インストール時にプリキャッシュ
const ASSETS = [
  './',
  './index.html',
  './manifest.json',
  'https://unpkg.com/react@18/umd/react.production.min.js',
  'https://unpkg.com/react-dom@18/umd/react-dom.production.min.js',
  'https://unpkg.com/@babel/standalone@7.26.4/babel.min.js',
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

  const isSameOrigin = url.origin === self.location.origin;
  const isHtml = e.request.mode === 'navigate' ||
    (isSameOrigin && (url.pathname === '/' || url.pathname.endsWith('/') || url.pathname.endsWith('index.html')));

  // ── HTML（画面遷移・index.html・ルート）は network-first ──
  // オンライン時は常に最新を表示し、デプロイ後の古い版残留を防ぐ（新機能が出ない問題の根治）。
  // lie-fi（つながっているが極端に遅い）対策で 2.5秒で応答が無ければキャッシュ起動し、
  // ネット応答は次回用にバックグラウンド更新する。
  if (isHtml) {
    e.respondWith(new Promise(resolve => {
      let settled = false;
      const done = r => { if (!settled && r) { settled = true; resolve(r); } };
      const fallback = () => caches.match(e.request)
        .then(c => c || caches.match('./index.html'))
        .then(c => done(c || Response.error()));
      const timer = setTimeout(fallback, 2500);
      fetch(e.request).then(resp => {
        clearTimeout(timer);
        if (resp && resp.status === 200) {
          const respClone = resp.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(e.request, respClone));
        }
        done(resp);
      }).catch(() => { clearTimeout(timer); fallback(); });
    }));
    return;
  }

  // ── CDN・静的資産は cache-first ＋ バックグラウンド更新（opaque/cors も保存する）──
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
        return Response.error();
      });
      return cached || networkFetch;
    })
  );
});
