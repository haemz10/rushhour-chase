/* 오프라인 플레이를 위한 캐시-우선 서비스워커
 * 게임 코드(game.js/i18n.js)를 수정할 때마다 아래 버전 번호를 올릴 것 —
 * 설치된 PWA가 새 버전을 받아가는 신호다. */
const CACHE = 'rushhour-chase-v5';
const ASSETS = ['./', './index.html', './game.js', './i18n.js', './manifest.json', './icon.svg'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)));
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (e) => {
  e.respondWith(
    caches.match(e.request).then((hit) => hit || fetch(e.request))
  );
});
