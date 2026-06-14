/* ==========================================================================
   도토리 약사님 — service-worker.js (v11)
   PWA 캐시 + FCM 백그라운드 알림 + 자동 업데이트
   ========================================================================== */

/* ── FCM 백그라운드 알림 ─────────────────────────────────────────────────
   ★ 중요: firebase-app → firebase-messaging 순서로 로드해야 합니다.
   ★ firebase-config.js가 아직 값이 없으면(플레이스홀더) try/catch로 무시됩니다. */
try {
  importScripts('firebase-config.js');

  // app-compat 먼저, messaging-compat 그 다음 — 순서 바뀌면 동작 안 함
  importScripts('https://www.gstatic.com/firebasejs/10.12.2/firebase-app-compat.js');
  importScripts('https://www.gstatic.com/firebasejs/10.12.2/firebase-messaging-compat.js');

  // 설정값이 플레이스홀더인 경우 초기화를 건너뜁니다
  if (
    FIREBASE_CONFIG &&
    FIREBASE_CONFIG.apiKey &&
    !FIREBASE_CONFIG.apiKey.startsWith('여기에')
  ) {
    firebase.initializeApp(FIREBASE_CONFIG);
    const messaging = firebase.messaging();

    // 앱이 꺼져있거나 백그라운드일 때 FCM 푸시 수신
    messaging.onBackgroundMessage((payload) => {
      const title = (payload.notification && payload.notification.title) || '도토리 약사님';
      const body  = (payload.notification && payload.notification.body)  || '약 먹을 시간이에요 💊';

      return self.registration.showNotification(title, {
        body,
        icon:  'icons/icon-192.png',
        badge: 'icons/icon-192.png',
        tag:   (payload.data && payload.data.tag) || 'dotori-fcm',
        requireInteraction: true,
        renotify: true,
        vibrate: [200, 100, 200],
        data: { url: self.location.origin },
      });
    });

    console.log('[SW] FCM 백그라운드 핸들러 등록 완료');
  } else {
    console.log('[SW] firebase-config.js 미설정 → FCM 스킵');
  }
} catch (err) {
  console.warn('[SW] FCM 초기화 실패:', err.message);
}

// ── 캐시 버전 (배포 시 숫자 올리기) ────────────────────────────────────
const CACHE_NAME = 'dotori-pharmacist-v11';

const APP_SHELL = [
  './',
  './index.html',
  './style.css',
  './app.js',
  './manifest.json',
  './firebase-config.js',
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

