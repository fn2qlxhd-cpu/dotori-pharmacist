/* ========================================================================== 
   check-medications.js (v14-data-only-exact-hour-device-dedupe)
   GitHub Actions / cron-job.org workflow_dispatch로 실행 — FCM 푸시 발송 담당

   핵심 로직:
   - 현재 KST 시각과 정확히 일치하는 알림 1종만 발송합니다.
     예: 21시에 실행되면 night만 발송, morning/lunch/dinner 누락분 발송 금지.
   - 같은 실행 안에서 같은 FCM 토큰은 1회만 발송합니다.
   - 같은 기기처럼 보이는 문서(userAgent 동일)가 여러 개 있으면 updatedAt이 가장 최신인 문서만 발송합니다.
   - Firestore 트랜잭션으로 날짜+시간대 키를 먼저 claim해서 겹친 실행 중복을 막습니다.
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

function nowKST() {
  return new Date(Date.now() + 9 * 60 * 60 * 1000);
}

function todayKST() {
  const k = nowKST();
  return `${k.getUTCFullYear()}-${String(k.getUTCMonth() + 1).padStart(2, '0')}-${String(k.getUTCDate()).padStart(2, '0')}`;
}

function nowHourKST() {
  const k = nowKST();
  const hour = k.getUTCHours();
  console.log(`[도토리 약사님] 코드버전: v14-data-only-exact-hour-device-dedupe`);
  console.log(`[도토리 약사님] UTC: ${new Date().getUTCHours()}시, KST: ${hour}시`);
  return hour;
}

function timestampMs(value) {
  if (!value) return 0;
  if (typeof value.toMillis === 'function') return value.toMillis();
  if (value instanceof Date) return value.getTime();
  return 0;
}

function normalizeToken(token) {
  return String(token || '').trim();
}

// ★ 이전 버전에서는 userAgent로 "같은 기기"를 추정해서 문서를 묶었는데,
//   userAgent 정규화를 어떻게 하든 (1) 같은 모델의 서로 다른 두 대를
//   같은 기기로 잘못 합치거나, (2) OS/브라우저 패치 버전이 바뀌면 같은
//   기기를 다른 기기로 잘못 나누는 문제를 동시에 해결할 수 없었습니다.
//   userAgent는 기기를 식별하는 신뢰할 수 있는 키가 아닙니다.
//   그래서 이 방식은 완전히 폐기하고, 중복 제어는 오직 FCM 토큰 값
//   자체로만 합니다. 같은 기기에서 토큰이 갱신되어 옛 토큰이 남아있는
//   문제는 app.js의 syncToFirestore()가 같은 토큰을 가진 옛 문서를
//   이미 정리하고 있으므로, 서버 스크립트는 Firestore에 남아있는
//   문서들을 있는 그대로 신뢰하고 토큰당 1회만 보냅니다.

function buildMessage(token, title, body, tag) {
  const t = String(title || APP_NAME);
  const b = String(body || '약 먹을 시간이에요 💊');
  const tg = String(tag || `dotori-${Date.now()}`);

  // ★ 중요: Web FCM에서는 top-level notification을 넣으면
  // 브라우저/FCM이 백그라운드에서 자동으로 1번 표시하고,
  // service-worker.js의 onBackgroundMessage가 또 showNotification을 호출해
  // 같은 알림이 2번 뜰 수 있습니다.
  // 그래서 웹앱은 data-only 메시지로 보내고, 표시 책임은
  // service-worker.js / app.js 한 곳에서만 처리합니다.
  return {
    token,
    data: {
      title: t,
      body: b,
      tag: tg,
      url: '/',
      source: 'github-actions',
    },
    webpush: {
      headers: { Urgency: 'high' },
      fcmOptions: { link: '/' },
    },
  };
}

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
      // ★ fcmToken만 null로 지우면 죽은 문서가 Firestore에 계속 쌓이고,
      //   나중에 사람이 직접 들어가서 일일이 지워야 했습니다.
      //   토큰이 무효하다고 FCM이 확인해준 경우이므로 문서 자체를 삭제합니다.
      await docRef.delete();
      console.log(`    → 무효 토큰 문서 삭제`);
    }
    return false;
  }
}

async function claimAndSend(db, messaging, docRef, token, today, nowHour, label) {
  const period = PERIODS.find((p) => p.notifyHour === nowHour);

  // ★ 가장 중요: 현재 시간과 정확히 같은 알림만 보냅니다.
  // 21시에 morning/lunch/dinner를 몰아서 보내는 기존 문제를 여기서 원천 차단합니다.
  if (!period) {
    console.log(`  - [${label}] 현재 시간(${nowHour}시)에 보낼 알림 없음`);
    return;
  }

  const key = `${today}-${String(period.notifyHour).padStart(2, '0')}`;
  let claimed = false;

  await db.runTransaction(async (tx) => {
    const snap = await tx.get(docRef);
    const data = snap.data() || {};
    const storedKeys = (data.notifiedKeys && data.notifiedKeys.date === today)
      ? { ...data.notifiedKeys }
      : { date: today };

    if (storedKeys[key]) return;

    storedKeys[key] = true;
    tx.update(docRef, { notifiedKeys: storedKeys });
    claimed = true;
  });

  if (!claimed) {
    console.log(`  - [${label}] ${period.id} ${nowHour}시 알림 이미 처리됨 → 스킵`);
    return;
  }

  const ok = await sendFCM(
    messaging,
    docRef,
    token,
    APP_NAME,
    period.message,
    `dotori-${period.id}-${key}`,
    `${period.id} (${String(period.notifyHour).padStart(2, '0')}시)`
  );

  if (!ok) {
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
}

function pickLatestDocsPerToken(docs) {
  // ★ 같은 FCM 토큰 값을 가진 문서가 여러 개 있을 경우(이론상 거의 없지만
  //   대비 차원에서)만 가장 최신 updatedAt 문서 1개로 좁힙니다.
  //   기기 식별은 토큰 자체가 사실상 유일한 신뢰 가능한 키입니다.
  const byToken = new Map();
  let noTokenCount = 0;

  for (const doc of docs) {
    const data = doc.data() || {};
    const token = normalizeToken(data.fcmToken);

    if (!token) {
      noTokenCount += 1;
      continue;
    }

    const current = byToken.get(token);
    const item = {
      doc,
      data,
      token,
      updatedMs: timestampMs(data.updatedAt),
    };

    if (!current || item.updatedMs >= current.updatedMs) {
      byToken.set(token, item);
    }
  }

  return { selected: Array.from(byToken.values()), noTokenCount };
}

async function main() {
  const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
  admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });

  const db = admin.firestore();
  const messaging = admin.messaging();

  const today = todayKST();
  const nowHour = nowHourKST();
  console.log(`[도토리 약사님] KST ${today} ${String(nowHour).padStart(2, '0')}:xx${TEST_MODE ? ' (테스트)' : ''}`);

  const snap = await db.collection('users').get();
  console.log(`[도토리 약사님] 등록 문서: ${snap.size}개`);

  const { selected, noTokenCount } = pickLatestDocsPerToken(snap.docs);
  console.log(`[도토리 약사님] 토큰 없음: ${noTokenCount}개`);
  console.log(`[도토리 약사님] 실제 발송 대상(기기 중복 제거 후): ${selected.length}개`);

  const sentTokens = new Set();

  for (const item of selected) {
    const { doc, token } = item;
    const label = doc.id.slice(0, 8);

    if (sentTokens.has(token)) {
      console.log(`  - ${label}: 중복 토큰 → 스킵`);
      continue;
    }
    sentTokens.add(token);

    if (TEST_MODE) {
      await sendFCM(
        messaging,
        doc.ref,
        token,
        APP_NAME,
        '[테스트] 알림이 이렇게 도착하면 정상이에요 💊',
        `dotori-test-${Date.now()}`,
        '테스트'
      );
      continue;
    }

    await claimAndSend(db, messaging, doc.ref, token, today, nowHour, label);
  }

  console.log('[도토리 약사님] 완료');
}

main().catch((err) => {
  console.error('[도토리 약사님] 오류:', err);
  process.exit(1);
});
