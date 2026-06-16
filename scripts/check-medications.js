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
  // UTC 시간에 9시간 더해서 KST 계산
  return new Date(Date.now() + 9 * 60 * 60 * 1000);
}
function todayKST() {
  const k = nowKST();
  return `${k.getUTCFullYear()}-${String(k.getUTCMonth()+1).padStart(2,'0')}-${String(k.getUTCDate()).padStart(2,'0')}`;
}
function nowHourKST() {
  const k = nowKST();
  const hour = k.getUTCHours(); // UTC+9 더한 값의 UTC 시간 = KST 시간
  console.log(`[도토리 약사님] UTC: ${new Date().getUTCHours()}시, KST: ${hour}시`);
  return hour;
}

// ── FCM 메시지 빌더 ────────────────────────────────────────────────────────
function buildMessage(token, title, body, tag) {
  const t = String(title || APP_NAME);
  const b = String(body || '약 먹을 시간이에요 💊');
  const tg = String(tag || `dotori-${Date.now()}`);

  return {
    token,
    // ★ notification 블록 필수 — iOS(APNs)는 이게 없으면 백그라운드에서 무시
    notification: { title: t, body: b },
    data: {
      title: t,
      body: b,
      tag: tg,
      url: '/',
    },
    webpush: {
      headers: { Urgency: 'high' },
      // ★ webpush.notification을 넣지 않음 — 브라우저 자동표시 + SW 수동표시
      //    중복(2개) 문제 방지. 안드로이드/크롬은 service-worker.js(통합)의
      //    onBackgroundMessage가 data를 받아 1번만 showNotification 합니다.
      fcmOptions: { link: '/' },
    },
    apns: {
      payload: {
        aps: {
          alert: { title: t, body: b },
          sound: 'default',
          badge: 1,
        },
      },
    },
    android: {
      priority: 'high',
      notification: {
        title: t,
        body: b,
        sound: 'default',
        tag: tg,
      },
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

// ── 한 사람에 대해 발송 전, 트랜잭션으로 "이번에 내가 보낸다"를 먼저 확정 ──
//    같은 워크플로우가 어떤 이유로든(겹친 실행, 재시도 등) 동시에 돌고 있어도
//    Firestore 트랜잭션은 한 번에 하나만 성공하도록 보장하므로, 두 실행이
//    동시에 "아직 안 보냈다"고 읽는 race condition을 막을 수 있습니다.
async function claimAndSend(db, messaging, docRef, token, today, nowHour, label) {
  let toSend = null;

  await db.runTransaction(async (tx) => {
    const snap = await tx.get(docRef);
    const data = snap.data() || {};
    const storedKeys = (data.notifiedKeys && data.notifiedKeys.date === today)
      ? { ...data.notifiedKeys }
      : { date: today };

    // ★ 미발송 period 중 정확히 하나만 골라서 claim합니다.
    //   (이전 버전 버그: for문이 모든 미발송 period의 키를 한꺼번에 true로
    //    찜해버려서, 실제로는 sendFCM이 호출되지 않은 시간대까지 "발송됨"으로
    //    기록되는 문제가 있었습니다. 한 번의 claimAndSend 호출 = 정확히
    //    하나의 period만 처리하도록 고치고, 나머지는 재귀 호출로 이어받습니다.)
    let target = null;
    for (const period of PERIODS) {
      if (nowHour < period.notifyHour) continue;
      const key = `${today}-${String(period.notifyHour).padStart(2,'0')}`;
      if (storedKeys[key]) continue; // 이미 보냈거나, 이미 다른 실행이 claim함
      target = { period, key };
      break; // 딱 하나만
    }

    if (target) {
      storedKeys[target.key] = true; // 이 period만 claim
      tx.update(docRef, { notifiedKeys: storedKeys });
      toSend = target;
    }
  });

  if (!toSend) return; // 보낼 게 없음(이미 다 보냈거나 시간 안 됨)

  const { period, key } = toSend;
  const ok = await sendFCM(messaging, docRef, token,
    APP_NAME, period.message,
    `dotori-${period.id}-${key}`,
    `${period.id} (${String(period.notifyHour).padStart(2,'0')}시)`);

  if (!ok) {
    // 실제 전송이 실패했으면 claim을 되돌려서 다음 실행 때 재시도 가능하게 함
    await db.runTransaction(async (tx) => {
      const snap = await tx.get(docRef);
      const data = snap.data() || {};
      if (data.notifiedKeys && data.notifiedKeys[key]) {
        const reverted = { ...data.notifiedKeys };
        delete reverted[key];
        tx.update(docRef, { notifiedKeys: reverted });
      }
    });
  }

  // 같은 사람에게 같은 실행에서 여러 시간대가 밀려있을 수 있으니 재귀적으로 계속 처리
  await claimAndSend(db, messaging, docRef, token, today, nowHour, label);
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

  // 같은 FCM 토큰이 여러 user 문서에 남아 있어도 한 번만 발송
  const sentTokens = new Set();

  for (const doc of snap.docs) {
    const data = doc.data();
    const token = data.fcmToken;
    if (!token) { console.log(`  - ${doc.id.slice(0,8)}: 토큰 없음 → 스킵`); continue; }
    if (sentTokens.has(token)) {
      console.log(`  - ${doc.id.slice(0,8)}: 중복 토큰 → 스킵`);
      continue;
    }
    sentTokens.add(token);

    // ── 테스트 모드: 즉시 1회 발송 ──
    if (TEST_MODE) {
      await sendFCM(messaging, doc.ref, token, APP_NAME,
        '[테스트] 알림이 이렇게 도착하면 정상이에요 💊',
        `dotori-test-${Date.now()}`, '테스트');
      continue;
    }

    await claimAndSend(db, messaging, doc.ref, token, today, nowHour, doc.id.slice(0,8));
  }

  console.log('[도토리 약사님] 완료');
}

main().catch(err => {
  console.error('[도토리 약사님] 오류:', err);
  process.exit(1);
});
