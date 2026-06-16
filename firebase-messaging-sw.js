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

  /* ── 앱이 백그라운드(꺼진 상태)일 때 FCM 푸시 수신 ── */
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
      icon:               'icons/icon-192.png',
      badge:              'icons/icon-192.png',
      tag,
      requireInteraction: true,
      renotify:           true,
      vibrate:            [200, 100, 200],
      data:               { url },
    });
  });

  console.log('[FCM SW] 백그라운드 핸들러 등록 완료');
} catch (err) {
  console.warn('[FCM SW] 초기화 실패:', err.message);
}

/* ── 알림 클릭 → 앱 창 열기 또는 포커스 ── */
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
