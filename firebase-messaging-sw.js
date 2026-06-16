/* ==========================================================================
   도토리 약사님 — firebase-messaging-sw.js
   ★ 이 파일 이름은 절대 바꾸면 안 됩니다. FCM이 이 이름으로만 인식합니다.
   ★ service-worker.js 와 별개로 반드시 루트(/)에 있어야 합니다.
   ========================================================================== */

importScripts('firebase-config.js');
importScripts('https://www.gstatic.com/firebasejs/10.12.2/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.12.2/firebase-messaging-compat.js');

try {
  firebase.initializeApp(FIREBASE_CONFIG);
  const messaging = firebase.messaging();

  const recentTags = new Map();
  const DEDUPE_WINDOW_MS = 5 * 60 * 1000;

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
    const title =
      (payload.data && payload.data.title) ||
      (payload.notification && payload.notification.title) ||
      '도토리 약사님';

    const body =
      (payload.data && payload.data.body) ||
      (payload.notification && payload.notification.body) ||
      '약 먹을 시간이에요 💊';

    const tag =
      (payload.data && payload.data.tag) ||
      `dotori-fcm-${Date.now()}`;

    const url =
      (payload.data && payload.data.url) ||
      self.location.origin;

    if (isDuplicate(tag)) {
      console.log('[FCM SW] 중복 알림 감지, 표시 스킵:', tag);
      return Promise.resolve();
    }

    return self.registration.showNotification(title, {
      body,
      icon: 'icons/icon-192.png',
      badge: 'icons/icon-192.png',
      tag,
      requireInteraction: true,
      vibrate: [200, 100, 200],
      data: { url },
    });
  });

  console.log('[FCM SW] 백그라운드 핸들러 등록 완료');
} catch (err) {
  console.warn('[FCM SW] 초기화 실패:', err.message);
}

self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  const targetUrl =
    (event.notification.data && event.notification.data.url) ||
    self.location.origin;

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        if ('focus' in client) return client.focus();
      }

      return self.clients.openWindow(targetUrl);
    })
  );
});
