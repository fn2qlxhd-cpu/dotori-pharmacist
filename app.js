/* ==========================================================================
   도토리 약사님 — app.js (v9)
   심플 버전: 시간/약 이름 설정 없음. 아침약/점심약/저녁약/자기전약 체크 +
   고정 스케줄 알림(09:00 / 13:00 / 19:00 / 21:00, 각 시간 1회) + FCM 연동
   + PWA 자동 업데이트

   ※ 이 파일은 처음 배우는 분도 읽을 수 있도록 한글 주석을 많이 달았습니다.
   ========================================================================== */


/* ────────────────────────────────────────────────────────────────────────
   1. 앱 설정

   - notifyTime : 매일 이 시간에 알림을 보냅니다. (사용자가 바꿀 수 없는 고정값)
   - message    : 그 시간에 보낼 알림 문구 (정확히 이 문구가 사용됩니다)
   ──────────────────────────────────────────────────────────────────────── */
var APP_CONFIG = {
  appName: '도토리 약사님',

  periods: [
    { id: 'morning', label: '아침약',   icon: '🌅', notifyTime: '09:00',
      message: '오전약 잘 챙겨 드셨나요~! 꼭 챙겨드세요~! 💊' },
    { id: 'lunch',   label: '점심약',   icon: '☀️', notifyTime: '13:00',
      message: '오후약 잘 챙겨 드셨나요~! 꼭 챙겨드세요~! 💊' },
    { id: 'dinner',  label: '저녁약',   icon: '🌇', notifyTime: '19:00',
      message: '저녁약 잘 챙겨 드셨나요~! 꼭 챙겨드세요~! 💊' },
    { id: 'night',   label: '자기전약', icon: '🌙', notifyTime: '21:00',
      message: '자기전약 주무시기전에 꼭 챙겨드세요~! 💊' },
  ],
};

// localStorage 키
const STORAGE_KEYS = {
  checks:   'dotori_checks',   // { date, morning:bool, lunch:bool, dinner:bool, night:bool }
  notified: 'dotori_notified', // { date, morning:0|1, ... } 0=안보냄 1=오늘 알림 보냄
};


/* ────────────────────────────────────────────────────────────────────────
   2. 전역 상태(state)
   ──────────────────────────────────────────────────────────────────────── */
var state = {
  checks: {},
  notified: {},
  fcmToken: null,
};

// Firebase 관련 전역 변수 (firebase-config.js 설정 후 initFirebase()에서 채워집니다)
var fcmMessaging = null;
var firestoreDb = null;
var currentUid = null;


/* ────────────────────────────────────────────────────────────────────────
   3. 마스코트 반응 — 응원 메시지 / 표정 / 모션
   ──────────────────────────────────────────────────────────────────────── */

const CHEER_MESSAGES = [
  '잘했어요! 🌱',
  '건강 챙겼어요 😊',
  '최고예요! 💊',
  '아주 잘했어요 🙌',
  '몸이 좋아해요 🍀',
  '꾸준함 최고예요 ✨',
  '오늘도 든든해요 😆',
  '완벽해요! 🤍',
  '이대로 쭉 가봐요 🌰',
  '약사님 칭찬해요 💚',
  '더 건강해졌어요 🌿',
  '잘 챙겼어요 👍',
];

// 하단 전용 응원 메시지 6개 — 상단 말풍선과 별개로 1시간마다 랜덤 변경
const BOTTOM_CHEER_MESSAGES = [
  '도토리약사의 소원은 하나! 오늘도 약 잘 챙겨드시고 오래오래 건강하세요 ✨',
  '매일 약 잘 챙겨드시고, 도토리약사와 함께 건강한 하루 보내세요 ❤️',
  '오늘도 어머님의 건강을 위해 도토리약사가 응원하고 있어요 🌰',
  '꼬박꼬박 약 챙겨드시고, 오늘 하루도 누구보다 행복하세요 ✨',
  '작은 약 한 번이 오늘의 건강을 지켜줘요. 늘 건강하세요 💊',
  '오늘도 잊지 않고 챙겨드시면 참 잘하신 거예요. 화이팅! 🍀'
];

// 상단 캐릭터 말풍선의 평소 기본 문구
var DEFAULT_MESSAGE = '오늘도 건강하세요 🌱';

// 하단 응원 메시지는 상단 말풍선과 별개로 1시간마다 랜덤 변경됩니다.
function startBottomCheerRotation() {
  const bottom = document.getElementById('bottomMessage');
  if (!bottom) return;

  function rotateBottomCheer() {
    const current = bottom.textContent;
    const candidates = BOTTOM_CHEER_MESSAGES.filter(m => m !== current);
    const next = candidates[Math.floor(Math.random() * candidates.length)] || BOTTOM_CHEER_MESSAGES[0];

    bottom.classList.remove('pulse');
    bottom.textContent = next;
    void bottom.offsetWidth;
    bottom.classList.add('pulse');

    window.clearTimeout(startBottomCheerRotation._pulseTimer);
    startBottomCheerRotation._pulseTimer = window.setTimeout(() => {
      bottom.classList.remove('pulse');
    }, 900);
  }

  rotateBottomCheer();
  setInterval(rotateBottomCheer, 60 * 60 * 1000);
}

// 상단 캐릭터 말풍선만 앱 실행 시 랜덤하게 초기화합니다.
function startCheerRotation() {
  const el = document.getElementById('mascotBubble');
  if (!el) return;
  // 상단 말풍선은 자동 변경하지 않습니다.
  // 복용 완료 버튼을 눌렀을 때만 triggerMascotCheer()에서 랜덤 변경됩니다.
  el.textContent = DEFAULT_MESSAGE;
}

const REACTIONS = ['react-wink', 'react-heart', 'react-star', 'react-blush', 'react-wow'];

const MOTIONS = [
  'motion-bounce', 'motion-wiggle', 'motion-hop', 'motion-spin', 'motion-nod',
  'motion-pulse', 'motion-swing', 'motion-shake', 'motion-float', 'motion-ta-da',
];

function triggerMascotCheer() {
  const mascot = document.getElementById('mascotSvg');
  const cheer = document.getElementById('mascotBubble');
  if (!mascot || !cheer) return;

  const reaction = REACTIONS[Math.floor(Math.random() * REACTIONS.length)];
  const motion = MOTIONS[Math.floor(Math.random() * MOTIONS.length)];
  const message = CHEER_MESSAGES[Math.floor(Math.random() * CHEER_MESSAGES.length)];

  MOTIONS.forEach(cls => mascot.classList.remove(cls));
  REACTIONS.forEach(cls => mascot.classList.remove(cls));
  mascot.classList.remove('reacting');
  cheer.classList.remove('pulse');

  // 상단 말풍선은 복용 완료 버튼을 눌렀을 때만 랜덤 변경
  cheer.textContent = message;

  void mascot.offsetWidth;
  void cheer.offsetWidth;

  mascot.classList.add('reacting', reaction, motion);
  cheer.classList.add('pulse');

  window.clearTimeout(triggerMascotCheer._timer);
  triggerMascotCheer._timer = window.setTimeout(() => {
    mascot.classList.remove('reacting', reaction, motion);
    cheer.classList.remove('pulse');
    // 랜덤 멘트를 잠깐 보여준 뒤 기본 문구로 복귀
    cheer.textContent = DEFAULT_MESSAGE;
  }, 1800);
}


/* ────────────────────────────────────────────────────────────────────────
   4. 날짜 / 시간 / 저장(localStorage) 도우미 함수
   ──────────────────────────────────────────────────────────────────────── */

function getTodayString() {
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function getTodayDisplay() {
  const now = new Date();
  const days = ['일', '월', '화', '수', '목', '금', '토'];
  return `${now.getFullYear()}년 ${now.getMonth() + 1}월 ${now.getDate()}일 ${days[now.getDay()]}요일`;
}

function getCurrentTimeString() {
  const now = new Date();
  return `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
}


function loadJSON(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw);
  } catch (e) {
    console.warn('[도토리 약사님] 저장된 데이터를 읽지 못했어요:', key, e);
    return fallback;
  }
}

function saveJSON(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (e) {
    console.warn('[도토리 약사님] 데이터를 저장하지 못했어요:', key, e);
  }
}


/* ────────────────────────────────────────────────────────────────────────
   5. 상태 불러오기 & 자정(00:00) 리셋 처리

   - 매일 자정이 지나면 "체크 상태"와 "알림 단계"만 초기화됩니다.
   - notified: 0=아직 안 보냄 / 1=오늘 정각 알림 보냄
   ──────────────────────────────────────────────────────────────────────── */

function loadState() {
  const today = getTodayString();

  // (1) 체크 상태
  let checks = loadJSON(STORAGE_KEYS.checks, null);
  if (!checks || checks.date !== today) {
    checks = { date: today };
    APP_CONFIG.periods.forEach(p => { checks[p.id] = false; });
    saveJSON(STORAGE_KEYS.checks, checks);
  }
  state.checks = checks;

  // (2) 알림 단계 — 날짜가 바뀌었거나, 예전 버전(boolean) 데이터면 새로 시작
  let notified = loadJSON(STORAGE_KEYS.notified, null);
  const isOldFormat = notified && typeof notified[APP_CONFIG.periods[0].id] !== 'number';
  if (!notified || notified.date !== today || isOldFormat) {
    notified = { date: today };
    APP_CONFIG.periods.forEach(p => { notified[p.id] = 0; });
    saveJSON(STORAGE_KEYS.notified, notified);
  }
  state.notified = notified;
}

function watchForMidnightRollover() {
  setInterval(() => {
    const today = getTodayString();
    if (state.checks.date !== today) {
      state.checks = { date: today };
      state.notified = { date: today };
      APP_CONFIG.periods.forEach(p => {
        state.checks[p.id] = false;
        state.notified[p.id] = 0;
      });
      saveJSON(STORAGE_KEYS.checks, state.checks);
      saveJSON(STORAGE_KEYS.notified, state.notified);
      syncToFirestore();
      render();
    }
  }, 30 * 1000);
}


/* ────────────────────────────────────────────────────────────────────────
   6. 화면 그리기 (렌더링)
   ──────────────────────────────────────────────────────────────────────── */

function render() {
  renderHeader();
  renderCards();
}

function renderHeader() {
  document.getElementById('appTitleText').textContent = APP_CONFIG.appName;
  document.getElementById('dateText').textContent = getTodayDisplay();
  const cheer = document.getElementById('mascotBubble');
  if (cheer && !cheer.classList.contains('pulse')) cheer.textContent = DEFAULT_MESSAGE;
  updateHeaderProgress();
}

// 색깔별 진행 막대 + 퍼센트 + 마스코트 기분을 갱신합니다. (카드는 건드리지 않음)
function updateHeaderProgress() {
  const total = APP_CONFIG.periods.length;
  const done = APP_CONFIG.periods.filter(p => state.checks[p.id]).length;
  const percent = total ? Math.round((done / total) * 100) : 0;

  document.getElementById('doneCount').textContent = done;
  document.getElementById('totalCount').textContent = total;
  document.getElementById('percentText').textContent = `${percent}%`;

  // 시간대별 색깔 막대 — 체크한 시간대만 자기 색으로 채워집니다.
  APP_CONFIG.periods.forEach(p => {
    const seg = document.querySelector(`.seg[data-period="${p.id}"]`);
    if (seg) seg.classList.toggle('filled', !!state.checks[p.id]);
  });

  // 마스코트 "평상시" 기분 (반응 중이 아닐 때만 보이는 표정)
  const mascot = document.getElementById('mascotSvg');
  if (mascot) {
    mascot.classList.remove('mood-sleepy', 'mood-ok', 'mood-great');
    if (done === 0) mascot.classList.add('mood-sleepy');
    else if (done === total) mascot.classList.add('mood-great');
    else mascot.classList.add('mood-ok');
  }
}

// 아침약/점심약/저녁약/자기전약 카드 4개를 그립니다. (아이콘 + 제목 + 복용 버튼만)
function renderCards() {
  const container = document.getElementById('cardsContainer');
  container.innerHTML = '';

  APP_CONFIG.periods.forEach(p => {
    const isDone = !!state.checks[p.id];

    const card = document.createElement('div');
    card.className = `card card--${p.id}${isDone ? ' is-done' : ''}`;
    card.dataset.period = p.id;

    card.innerHTML = `
      <div class="card-title">
        <span class="card-icon">${p.icon}</span>
        <span>${p.label}</span>
      </div>
      <button class="check-btn" type="button">
        <span class="check-icon">${isDone ? '✓' : '○'}</span>
        <span class="check-label">${isDone ? '복용했어요' : '복용 완료'}</span>
      </button>
    `;

    const btn = card.querySelector('.check-btn');

    // ★ touchstart: 모바일에서 손가락 닿는 순간 즉각 반응 (300ms 딜레이 제거)
    btn.addEventListener('touchstart', (e) => {
      e.preventDefault(); // click 이벤트 중복 방지
      toggleCheck(p.id);
    }, { passive: false });

    // 마우스(PC) 환경 fallback
    btn.addEventListener('click', (e) => {
      if (e.detail === 0) return; // touchstart가 이미 처리한 경우 스킵
      toggleCheck(p.id);
    });

    container.appendChild(card);
  });
}

// 카드 1개의 버튼/상태만 즉시 바꿉니다. — toggleCheck()에서 가장 먼저 호출됩니다.
function updateCardUI(periodId, isDone) {
  const card = document.querySelector(`.card[data-period="${periodId}"]`);
  if (!card) return;

  card.classList.toggle('is-done', isDone);

  const icon = card.querySelector('.check-icon');
  const label = card.querySelector('.check-label');
  if (icon) icon.textContent = isDone ? '✓' : '○';
  if (label) label.textContent = isDone ? '복용했어요' : '복용 완료';
}


/* ────────────────────────────────────────────────────────────────────────
   7. 체크 토글 (복용 완료 버튼)

   ★ 순서가 중요합니다 ★
   1) 화면(이 카드)을 먼저 즉시 바꿉니다 → 탭 했을 때 지연 없이 바로 반응
   2) 그 다음 상태 저장 + 헤더 갱신 + (체크 시) 마스코트 반응
   ──────────────────────────────────────────────────────────────────────── */

function toggleCheck(periodId) {
  const willBeChecked = !state.checks[periodId];

  // 1) 즉시 화면 반응
  updateCardUI(periodId, willBeChecked);
  if (willBeChecked && 'vibrate' in navigator) {
    navigator.vibrate(30);
  }

  // 2) 상태 갱신 + 저장
  state.checks[periodId] = willBeChecked;
  saveJSON(STORAGE_KEYS.checks, state.checks);

  // 복용 체크/취소는 알림 발송 여부를 건드리지 않습니다.
  // 알림은 복용 여부와 관계없이 09:00 / 13:00 / 19:00 / 21:00에 각 1회만 발송됩니다.
  syncToFirestore();

  // 3) 헤더(진행률/마스코트 기분) 갱신
  updateHeaderProgress();

  // 4) 체크했을 때만: 마스코트가 랜덤하게 반응
  if (willBeChecked) triggerMascotCheer();
}


/* ────────────────────────────────────────────────────────────────────────
   8. 알림(Notification) 관련 — 정해진 시간에 각 1회
   ──────────────────────────────────────────────────────────────────────── */

function renderNotifBanner() {
  const banner = document.getElementById('notifBanner');
  const text = document.getElementById('notifText');
  const btn = document.getElementById('notifBtn');

  banner.classList.remove('is-denied');
  banner.style.display = '';

  if (!('Notification' in window)) {
    text.textContent = '이 브라우저에서는 알림 기능을 사용할 수 없어요';
    btn.style.display = 'none';
    return;
  }

  const permission = Notification.permission;

  if (permission === 'granted') {
    // 알림이 이미 켜져 있으면 배너를 완전히 숨겨서 화면을 더 심플하게 유지합니다.
    banner.style.display = 'none';
  } else if (permission === 'denied') {
    banner.classList.add('is-denied');
    text.textContent = '브라우저 설정에서 알림을 허용해주세요';
    btn.style.display = 'none';
  } else {
    text.textContent = '알림을 켜면 매일 약 먹을 시간에 알려드려요';
    btn.style.display = '';
  }
}

async function requestNotificationPermission() {
  if (!('Notification' in window)) return;
  try {
    const permission = await Notification.requestPermission();
    if (permission === 'granted') {
      playReminderSound();
      // Firebase 반드시 초기화 후 토큰 요청
      await initFirebase();
      // SW 준비될 때까지 최대 3초 대기
      await Promise.race([
        navigator.serviceWorker.ready,
        new Promise(r => setTimeout(r, 3000))
      ]);
      await getFcmToken();
    }
  } catch (e) {
    console.warn('[도토리] 알림 권한 요청 오류:', e);
  }
  renderNotifBanner();
}

// 알림음 — AudioContext를 한 번만 만들어서 재사용합니다.
let _audioCtx = null;
function getAudioContext() {
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextClass) return null;
  if (!_audioCtx) {
    try { _audioCtx = new AudioContextClass(); } catch (e) { return null; }
  }
  if (_audioCtx.state === 'suspended') {
    _audioCtx.resume().catch(() => {});
  }
  return _audioCtx;
}

function playReminderSound() {
  try {
    const ctx = getAudioContext();
    if (!ctx) return;
    const oscillator = ctx.createOscillator();
    const gain = ctx.createGain();
    oscillator.type = 'sine';
    oscillator.frequency.value = 880;
    gain.gain.setValueAtTime(0.0001, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.18, ctx.currentTime + 0.03);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.35);
    oscillator.connect(gain);
    gain.connect(ctx.destination);
    oscillator.start();
    oscillator.stop(ctx.currentTime + 0.36);
  } catch (e) {
    console.warn('[도토리 약사님] 알림음 재생 실패:', e);
  }
}

// stage: 1 = 정해진 시간 알림
function sendMedicationNotification(period, stage) {
  const title = APP_CONFIG.appName;
  const body = period.message;

  const options = {
    body,
    icon: 'icons/icon-192.png',
    badge: 'icons/icon-192.png',
    tag: `dotori-${period.id}-${getTodayString()}-${period.notifyTime.slice(0, 2)}`,
    requireInteraction: true,
    renotify: true,
    vibrate: [200, 100, 200],
  };

  playReminderSound();
  if ('vibrate' in navigator) navigator.vibrate([200, 100, 200]);

  if ('Notification' in window && Notification.permission === 'granted') {
    if (navigator.serviceWorker) {
      navigator.serviceWorker.ready
        .then((reg) => reg.showNotification(title, options))
        .catch(() => new Notification(title, options));
    } else {
      new Notification(title, options);
    }
  }
}

// 로컬 브라우저 알림 루프 — FCM이 늦거나 실패할 때 탭이 열려있으면 직접 발송
// (tag가 같아서 FCM 알림과 겹쳐도 브라우저가 1개만 표시)
function startNotificationLoop() {
  function checkAndNotify() {
    if (Notification.permission !== 'granted') return;

    const now = new Date();
    const currentMinutes = now.getHours() * 60 + now.getMinutes();

    APP_CONFIG.periods.forEach(period => {
      const [h, m] = period.notifyTime.split(':').map(Number);
      const targetMinutes = h * 60 + m;
      const diff = currentMinutes - targetMinutes;

      // 알림 시간 이후 10분 이내이고, 오늘 아직 발송 안 한 경우
      if (diff >= 0 && diff < 10 && !state.notified[period.id]) {
        state.notified[period.id] = 1;
        saveJSON(STORAGE_KEYS.notified, state.notified);
        sendMedicationNotification(period, 1);
      }
    });
  }

  setInterval(checkAndNotify, 30 * 1000);
  checkAndNotify();
}


/* ────────────────────────────────────────────────────────────────────────
   9. Firebase 연동 — Firestore 동기화 + FCM(푸시 알림) 토큰

   ★ firebase-config.js 설정이 끝나야 동작합니다 ★
   설정 전이거나 오프라인이어도 모든 함수가 조용히 실패하고 넘어가도록
   되어 있어서, 앱의 다른 기능에는 영향이 없습니다.
   ──────────────────────────────────────────────────────────────────────── */

async function initFirebase() {
  if (typeof firebase === 'undefined') return;
  if (typeof FIREBASE_CONFIG === 'undefined') return;
  if (!FIREBASE_CONFIG.apiKey || FIREBASE_CONFIG.apiKey.startsWith('여기에')) return;

  try {
    const app = firebase.apps.length
      ? firebase.app()
      : firebase.initializeApp(FIREBASE_CONFIG);

    const auth = firebase.auth(app);
    const cred = await auth.signInAnonymously();
    currentUid = cred.user.uid;

    firestoreDb = firebase.firestore(app);
    fcmMessaging = firebase.messaging(app);

    fcmMessaging.onMessage((payload) => {
      const title = (payload.data && payload.data.title)
        || (payload.notification && payload.notification.title)
        || APP_CONFIG.appName;
      const body = (payload.data && payload.data.body)
        || (payload.notification && payload.notification.body)
        || '';
      const tag = (payload.data && payload.data.tag) || `dotori-foreground-${Date.now()}`;

      // ★ iOS Safari는 new Notification() 미지원 → 서비스워커 showNotification() 사용
      if (Notification.permission === 'granted' && 'serviceWorker' in navigator) {
        navigator.serviceWorker.ready.then(reg => {
          reg.showNotification(title, {
            body,
            icon: 'icons/icon-192.png',
            badge: 'icons/icon-192.png',
            tag,
            requireInteraction: true,
            renotify: true,
            vibrate: [200, 100, 200],
          });
        });
      }
    });

    syncToFirestore();
    console.log('[도토리] Firebase 초기화 완료, uid:', currentUid);
  } catch (e) {
    console.warn('[도토리] Firebase 초기화 실패:', e);
  }
}

async function getFcmToken() {
  try {
    // 1) 기본 조건 체크
    if (typeof firebase === 'undefined') { console.warn('[도토리] firebase 미로드'); return; }
    if (!fcmMessaging) { console.warn('[도토리] fcmMessaging null → initFirebase 재시도'); await initFirebase(); }
    if (!fcmMessaging) { console.warn('[도토리] initFirebase 후에도 fcmMessaging null'); return; }
    if (!('serviceWorker' in navigator)) { console.warn('[도토리] SW 미지원'); return; }
    if (Notification.permission !== 'granted') { console.warn('[도토리] 알림 권한 없음'); return; }

    // 2) FCM 전용 서비스워커(firebase-messaging-sw.js) 등록 또는 기존 것 재사용
    //    ★ navigator.serviceWorker.ready 는 service-worker.js 를 반환할 수 있어
    //      FCM 토큰 발급이 401로 거부됩니다. 반드시 이름을 명시해야 합니다.
    let messagingSWReg;
    const existingRegs = await navigator.serviceWorker.getRegistrations();
    messagingSWReg = existingRegs.find(
      r => r.active && r.active.scriptURL.includes('firebase-messaging-sw.js')
    );

    if (!messagingSWReg) {
      messagingSWReg = await navigator.serviceWorker.register('firebase-messaging-sw.js', { scope: './' });
      // 활성화될 때까지 최대 5초 대기
      await Promise.race([
        new Promise(resolve => {
          if (messagingSWReg.active) { resolve(); return; }
          messagingSWReg.addEventListener('updatefound', () => {
            const w = messagingSWReg.installing;
            w.addEventListener('statechange', () => { if (w.state === 'activated') resolve(); });
          });
        }),
        new Promise(r => setTimeout(r, 5000)),
      ]);
    }
    console.log('[도토리] FCM SW 준비됨:', messagingSWReg.scope);

    // 3) FCM 토큰 요청
    const token = await fcmMessaging.getToken({
      vapidKey: VAPID_KEY,
      serviceWorkerRegistration: messagingSWReg,
    });

    if (token) {
      state.fcmToken = token;
      console.log('[도토리] FCM 토큰 발급 성공 ✅');
      syncToFirestore();
    } else {
      console.warn('[도토리] 토큰 빈값');
    }
  } catch (e) {
    console.warn('[도토리] getFcmToken 오류:', e.code, e.message);
  }
}

// 현재 state를 Firestore에 저장합니다. (GitHub Actions 체커가 이 데이터를 읽습니다)
// ★ 같은 FCM 토큰을 가진 기존 문서가 있으면 먼저 삭제해서 중복 방지
function syncToFirestore() {
  if (!firestoreDb || !currentUid) return;

  const data = {
    checks: state.checks,
    notified: state.notified,
    fcmToken: state.fcmToken || null,
    userAgent: navigator.userAgent || '',
    updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
  };

  // FCM 토큰이 있으면 같은 토큰을 가진 다른 uid 문서 삭제 후 저장
  if (state.fcmToken) {
    firestoreDb.collection('users')
      .where('fcmToken', '==', state.fcmToken)
      .get()
      .then(snapshot => {
        const deletePromises = snapshot.docs
          .filter(doc => doc.id !== currentUid) // 내 문서 제외
          .map(doc => {
            console.log('[도토리] 중복 토큰 문서 삭제:', doc.id.slice(0, 8));
            return doc.ref.delete();
          });
        return Promise.all(deletePromises);
      })
      .then(() => {
        return firestoreDb.collection('users').doc(currentUid).set(data, { merge: true });
      })
      .catch(e => console.warn('[도토리 약사님] Firestore 동기화 실패:', e));
  } else {
    firestoreDb.collection('users').doc(currentUid).set(data, { merge: true })
      .catch(e => console.warn('[도토리 약사님] Firestore 동기화 실패:', e));
  }
}


/* ────────────────────────────────────────────────────────────────────────
   10. 서비스워커 등록

   최종 고정 버전:
   - 접속할 때마다 service worker 업데이트 체크하지 않음
   - "새 버전으로 업데이트 중..." 토스트 표시하지 않음
   - 자동 새로고침하지 않음
   ──────────────────────────────────────────────────────────────────────── */

function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return Promise.resolve(null);

  return navigator.serviceWorker.register('service-worker.js')
    .then((registration) => {
      console.log('[도토리 약사님] 서비스워커 등록 완료:', registration.scope);
      return registration;
    })
    .catch((err) => {
      console.warn('[도토리 약사님] 서비스워커 등록 실패:', err);
      return null;
    });
}


/* ────────────────────────────────────────────────────────────────────────
   11. 초기화
   ──────────────────────────────────────────────────────────────────────── */

async function init() {
  loadState();
  startCheerRotation(); // 상단 말풍선 초기 문구
  startBottomCheerRotation(); // 하단 응원 메시지 1시간 랜덤 순환
  render();
  renderNotifBanner();

  document.getElementById('notifBtn').addEventListener('click', requestNotificationPermission);

  watchForMidnightRollover();
  startNotificationLoop();

  await registerServiceWorker();
  await initFirebase();

  if ('Notification' in window && Notification.permission === 'granted') {
    await getFcmToken();
  }
}


// iOS Safari 더블탭/제스처 확대 방지
let __dotoriLastTouchEnd = 0;
document.addEventListener('touchend', function(event) {
  const now = Date.now();
  if (now - __dotoriLastTouchEnd <= 320) {
    event.preventDefault();
  }
  __dotoriLastTouchEnd = now;
}, { passive: false });

document.addEventListener('gesturestart', function(event) {
  event.preventDefault();
});


document.addEventListener('DOMContentLoaded', init);
