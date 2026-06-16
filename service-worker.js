/* ==========================================================================
   도토리 약사님 — service-worker.js (v24-unified)
   PWA 캐시 + FCM 백그라운드 알림을 단일 서비스워커로 통합
   ★ 이전에는 service-worker.js와 firebase-messaging-sw.js 두 개를 같은
     scope('./')로 각각 등록했는데, 한 origin/scope에는 활성 서비스워커가
     하나만 존재할 수 있어서 두 워커가 서로의 활성 상태를 갈아치우는
     경쟁이 발생했고, 그 사이 푸시 이벤트가 어느 워커로도 정확히
     라우팅되지 않는 경우가 있었습니다(특히 iOS Safari에서 엄격하게 작용).
     이 문제를 근본적으로 없애기 위해 서비스워커를 하나로 합칩니다.
   ========================================================================== */

importScripts('firebase-config.js');
importScripts('https://www.gstatic.com/firebasejs/10.12.2/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.12.2/firebase-messaging-compat.js');

// ── 캐시 버전 (배포 시 숫자 올리기) ────────────────────────────────────
const CACHE_NAME = 'dotori-pharmacist-v25-unified';

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

// ── 설치: 앱 파일 캐싱 + 즉시 활성화 시도 ──────────────────────────────
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(APP_SHELL))
      .catch(err => console.warn('[SW] 캐시 저장 일부 실패:', err))
  );
});

// ── 활성화: 이전 버전 캐시 삭제 + 클라이언트 즉시 장악 ─────────────────
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
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

/* ── FCM 백그라운드 알림 (이전 firebase-messaging-sw.js 내용 통합) ── */
try {
  firebase.initializeApp(FIREBASE_CONFIG);
  const messaging = firebase.messaging();

  // ★ 중복 방어: FCM이 같은 알림을 짧은 시간 내 두 번 보내는 경우(at-least-once
  //    delivery)를 막기 위해, 최근 처리한 tag를 서비스워커 메모리에 기록합니다.
  const recentTags = new Map(); // tag -> timestamp
  const DEDUPE_WINDOW_MS = 5 * 60 * 1000; // 5분

  function isDuplicate(tag) {
    const now = Date.now();
    for (const [t, ts] of recentTags) {
      if (now - ts > DEDUPE_WINDOW_MS) recentTags.delete(t);
    }
    if (recentTags.has(tag)) return true;
    recentTags.set(tag, now);
    return false;
  }

  messaging.onBackgroundMessage((payload) => {
    const title = (payload.data && payload.data.title)
      || (payload.notification && payload.notification.title)
      || '도토리 약사님';
    const body = (payload.data && payload.data.body)
      || (payload.notification && payload.notification.body)
      || '약 먹을 시간이에요 💊';
    const tag = (payload.data && payload.data.tag) || 'dotori-fcm';
    const url = (payload.data && payload.data.url) || self.location.origin;

    if (isDuplicate(tag)) {
      console.log('[SW] 중복 알림 감지, 표시 스킵:', tag);
      return Promise.resolve();
    }

    return self.registration.showNotification(title, {
      body,
      icon:               'icons/icon-192.png',
      badge:              'icons/icon-192.png',
      tag,
      requireInteraction: true,
      vibrate:            [200, 100, 200],
      data:               { url },
    });
  });

  console.log('[SW] FCM 백그라운드 핸들러 등록 완료 (통합 서비스워커)');
} catch (err) {
  console.warn('[SW] FCM 초기화 실패:', err.message);
}

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

