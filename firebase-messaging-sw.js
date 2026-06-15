/* ==========================================================================
   도토리 약사님 — firebase-messaging-sw.js (v24-ios-android-alarm-final)
   PWA 캐시 + FCM 백그라운드 알림 통합 서비스워커

   핵심 수정:
   - 같은 scope에 service-worker.js / firebase-messaging-sw.js 두 개를 번갈아 등록하지 않음
   - FCM 백그라운드 알림을 항상 이 파일이 담당
   - 앱 캐시도 이 파일이 같이 담당
   ========================================================================== */

importScripts('firebase-config.js');
importScripts('https://www.gstatic.com/firebasejs/10.12.2/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.12.2/firebase-messaging-compat.js');

const CACHE_NAME = 'dotori-pharmacist-v24-ios-android-alarm-final';
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

self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(APP_SHELL))
      .catch(err => console.warn('[SW] 캐시 저장 일부 실패:', err))
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

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

try {
  firebase.initializeApp(FIREBASE_CONFIG);
  const messaging = firebase.messaging();

  messaging.onBackgroundMessage((payload) => {
    const title = (payload.data && payload.data.title)
      || (payload.notification && payload.notification.title)
      || '도토리 약사님';
    const body = (payload.data && payload.data.body)
      || (payload.notification && payload.notification.body)
      || '약 먹을 시간이에요 💊';
    const tag = (payload.data && payload.data.tag) || 'dotori-fcm';
    const url = (payload.data && payload.data.url) || self.location.origin;

    return self.registration.showNotification(title, {
      body,
      icon: 'icons/icon-192.png',
      badge: 'icons/icon-192.png',
      tag,
      requireInteraction: true,
      renotify: true,
      vibrate: [200, 100, 200],
      data: { url },
    });
  });

  console.log('[FCM SW] 통합 서비스워커 준비 완료');
} catch (err) {
  console.warn('[FCM SW] 초기화 실패:', err.message);
}

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
