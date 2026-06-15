/* Deprecated: 도토리 약사님은 firebase-messaging-sw.js 하나로 PWA 캐시와 FCM 알림을 통합했습니다. */
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));
