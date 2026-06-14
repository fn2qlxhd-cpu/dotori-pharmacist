/* ==========================================================================
   check-medications.js (v11)
   GitHub Actions 5분 cron으로 실행 — FCM 푸시 발송 담당

   핵심 로직:
   - "정해진 시간이 지났고, 오늘 아직 못 보낸" 시간대만 발송 (>= 비교)
   - 날짜+시간대 키(YYYY-MM-DD-HH)로 중복 발송 방지
   - GitHub Actions cron 지연(최대 수분)에 강건하게 동작
   ========================================================================== */

const admin = require('firebase-admin');

const PERIODS = [
  { id: 'morning', notifyHour: 9,  message: '오전약 잘 챙겨 드셨나요~! 꼭 챙겨드세요~! 💊' },
  { id: 'lunch',   notifyHour: 13, message: '오후약 잘 챙겨 드셨나요~! 꼭 챙겨드세요~! 💊' },
  { id: 'dinner',  notifyHour: 19, message: '저녁약 잘 챙겨 드셨나요~! 꼭 챙겨드세요~! 💊' },
  { id: 'night',   notifyHour: 21, message: '자기전약 주무시기전에 꼭 챙겨드세요~! 💊' },
];

const APP_NAME = '도토리 약사님';
const TEST_MODE = process.env.TEST_NOTIFICATION === 'true';

// ── KST(UTC+9) 기준 시각 계산 ─────────────────────────────────────────────
function nowKST() {
  return new Date(Date.now() + 9 * 60 * 60 * 1000);
}
function todayKST() {
  const k = nowKST();
  return `${k.getUTCFullYear()}-${String(k.getUTCMonth()+1).padStart(2,'0')}-${String(k.getUTCDate()).padStart(2,'0')}`;
}
function nowHourKST() {
  return nowKST().getUTCHours(); // 0~23
}

// ── FCM 메시지 빌더 ────────────────────────────────────────────────────────
function buildMessage(token, title, body, tag) {
  return {
    token,
    notification: { title, body },
    webpush: {
      notification: {
        icon: 'icons/icon-192.png',
        badge: 'icons/icon-192.png',
        tag,
        requireInteraction: true,
        renotify: true,
        vibrate: [200, 100, 200],
      },
      fcmOptions: { link: '/' },
    },
    android: {
      priority: 'high',
      notification: { sound: 'default', defaultVibrateTimings: true },
    },
    apns: {
      payload: { aps: { sound: 'default' } },
    },
  };
}

// ── 발송 + 토큰 오류 자동 정리 ────────────────────────────────────────────
async function sendFCM(messaging, docRef, token, title, body, tag, label) {
  try {
    await messaging.send(buildMessage(token, title, body, tag));
    console.log(`  ✓ [${label}] 발송 완료`);
    return true;
  } catch (err) {
    console.warn(`  ✗ [${label}] 발송 실패: ${err.message}`);
    if (
      err.code === 'messaging/registration-token-not-registered' ||
      err.code === 'messaging/invalid-registration-token'
    ) {
      await docRef.update({ fcmToken: null });
      console.log(`    → 만료된 토큰 정리`);
    }
    return false;
  }
}

// ── 메인 ──────────────────────────────────────────────────────────────────
async function main() {
  const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
  admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });

  const db = admin.firestore();
  const messaging = admin.messaging();

  const today = todayKST();
  const nowHour = nowHourKST();
  console.log(`[도토리 약사님] KST ${today} ${String(nowHour).padStart(2,'0')}:xx${TEST_MODE ? ' (테스트)' : ''}`);

  const snap = await db.collection('users').get();
  console.log(`[도토리 약사님] 등록 기기: ${snap.size}개`);

  for (const doc of snap.docs) {
    const data = doc.data();
    const token = data.fcmToken;
    if (!token) { console.log(`  - ${doc.id.slice(0,8)}: 토큰 없음 → 스킵`); continue; }

    // ── 테스트 모드: 즉시 1회 발송 ──
    if (TEST_MODE) {
      await sendFCM(messaging, doc.ref, token, APP_NAME,
        '[테스트] 알림이 이렇게 도착하면 정상이에요 💊',
        `dotori-test-${Date.now()}`, '테스트');
      continue;
    }

    // ── 중복 방지 키 저장소 (notifiedKeys: { 'YYYY-MM-DD-HH': true }) ──────
    // 날짜가 바뀌었으면 초기화
    const storedKeys = (data.notifiedKeys && data.notifiedKeys.date === today)
      ? { ...data.notifiedKeys }
      : { date: today };

    let changed = false;

    for (const period of PERIODS) {
      // ★ 핵심: 현재 시(hour)가 알림 시(hour) 이상이면 대상
      //   (cron 지연, 서버 지연에 무관하게 안정적으로 동작)
      if (nowHour < period.notifyHour) continue;

      // 이 시간대에 오늘 이미 보냈으면 건너뜀
      const key = `${today}-${String(period.notifyHour).padStart(2,'0')}`;
      if (storedKeys[key]) {
        console.log(`  - ${doc.id.slice(0,8)}: ${key} 이미 발송 → 스킵`);
        continue;
      }

      const ok = await sendFCM(messaging, doc.ref, token,
        APP_NAME, period.message,
        `dotori-${period.id}-${key}`,
        `${period.id} (${String(period.notifyHour).padStart(2,'0')}시)`);

      if (ok) {
        storedKeys[key] = true;
        changed = true;
      }
    }

    if (changed) {
      await doc.ref.update({ notifiedKeys: storedKeys });
    }
  }

  console.log('[도토리 약사님] 완료');
}

main().catch(err => {
  console.error('[도토리 약사님] 오류:', err);
  process.exit(1);
});
