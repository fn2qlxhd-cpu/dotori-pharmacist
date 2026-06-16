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

  // ★ 중복 방어: FCM이 같은 알림을 짧은 시간 내 두 번 보내는 경우(at-least-once
  //    delivery)를 막기 위해, 최근 처리한 tag를 서비스워커 메모리에 기록합니다.
  //    서비스워커가 살아있는 동안에만 유효하지만, 실제 중복은 대부분 수 초~수십초
  //    안에 일어나므로 이걸로 충분히 걸러집니다.
  const recentTags = new Map(); // tag -> timestamp
  const DEDUPE_WINDOW_MS = 5 * 60 * 1000; // 5분

  function isDuplicate(tag) {
    const now = Date.now();
    // 오래된 기록 정리
    for (const [t, ts] of recentTags) {
      if (now - ts > DEDUPE_WINDOW_MS) recentTags.delete(t);
    }
    if (recentTags.has(tag)) return true;
    recentTags.set(tag, now);
    return false;
  }

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

    if (isDuplicate(tag)) {
      console.log('[FCM SW] 중복 알림 감지, 표시 스킵:', tag);
      return Promise.resolve();
    }

    return self.registration.showNotification(title, {
      body,
      icon:               'icons/icon-192.png',
      badge:              'icons/icon-192.png',
      tag,
      // ★ renotify 제거 — true이면 같은 tag라도 OS가 강제로 다시 알려서
      //   중복 표시 원인이 될 수 있음. tag가 같으면 자연스럽게 갱신만 되도록 둠.
      requireInteraction: true,
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
