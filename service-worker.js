/* ==========================================================================
   도토리 약사님 — service-worker.js (v13-final)
   PWA 캐시 전용 / 자동 업데이트 토스트 제거
   ★ FCM 백그라운드 알림은 firebase-messaging-sw.js 가 전담합니다.
      이 파일에서는 Firebase를 로드하지 않습니다.
   ========================================================================== */

// ── 캐시 버전 (배포 시 숫자 올리기) ────────────────────────────────────
const CACHE_NAME = 'dotori-pharmacist-v22-final';

const APP_SHELL = [
  './',
  './index.html',
  './style.css',
  './app.js',
  './manifest.json',
  './firebase-config.js',
  './firebase-messaging-sw.js',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-180.png',
];

// ── 설치: 앱 파일 캐싱 ──────────────────────────────────────────────────
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(APP_SHELL))
      .catch(err => console.warn('[SW] 캐시 저장 일부 실패:', err))
  );
});

// ── 활성화: 이전 버전 캐시 삭제 ─────────────────────────────────────────
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// ── 메시지: 앱에서 SKIP_WAITING 받으면 즉시 활성화 ─────────────────────
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

// ── fetch: 캐시 우선, 없으면 네트워크 ──────────────────────────────────
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;
  if (event.request.method !== 'GET') return;

  event.respondWith(
    caches.match(event.request).then(cached => {
      if (cached) return cached;
      return fetch(event.request).catch(() => caches.match('./index.html'));
    })
  );
});

// ── 알림 탭: 앱 창 열기 또는 포커스 ────────────────────────────────────
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const targetUrl = (event.notification.data && event.notification.data.url)
    || self.location.origin;

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clients => {
      for (const client of clients) {
        if ('focus' in client) return client.focus();
      }
      return self.clients.openWindow(targetUrl);
    })
  );
});

