# 🌰 도토리 약사님 — FCM(푸시 알림) 연결 가이드

이 문서를 따라가면, **휴대폰 화면이 꺼져있거나 앱을 완전히 종료한 상태에서도**
정해진 시간에 "OO 약 먹을 시간입니다 💊" 알림이 도착하게 됩니다.

전체 흐름:

```
[1] Firebase 프로젝트 만들기
[2] 웹 앱 등록 → firebaseConfig 값 받기
[3] 익명 로그인(Authentication) 켜기
[4] Firestore 만들기 + 보안 규칙 적용
[5] Cloud Messaging → VAPID 키 발급
[6] firebase-config.js에 값 채우기
[7] 서비스 계정 키 발급 (서버용)
[8] GitHub 저장소 만들고 파일 업로드 + Pages 켜기
[9] GitHub Secret에 서비스 계정 키 등록
[10] 테스트
```

평균 20~30분 정도 걸려요. 천천히 따라오시면 됩니다 🙂

---

## [1] Firebase 프로젝트 만들기

1. https://console.firebase.google.com 접속 (구글 계정으로 로그인)
2. **"프로젝트 추가"** 클릭
3. 프로젝트 이름 입력 (예: `dotori-pharmacist`) → 계속
4. Google Analytics는 **사용 안 함**으로 두고 → **프로젝트 만들기**
5. 생성이 끝나면 **계속** 클릭해서 프로젝트 콘솔로 이동

> 💳 신용카드 등록 필요 없음 (무료 Spark 플랜 그대로 사용해요)

---

## [2] 웹 앱 등록 → firebaseConfig 받기

1. 프로젝트 콘솔 홈 화면에서 **`</>`  (웹)** 아이콘 클릭
2. 앱 닉네임 입력 (예: `dotori-web`) → **Firebase Hosting 설정은 체크 안 해도 됨**
3. **앱 등록** 클릭
4. 화면에 아래와 같은 코드가 나타나요 — **이 값을 메모장에 복사**해두세요

```js
const firebaseConfig = {
  apiKey: "AIza...",
  authDomain: "dotori-pharmacist-xxxx.firebaseapp.com",
  projectId: "dotori-pharmacist-xxxx",
  storageBucket: "dotori-pharmacist-xxxx.appspot.com",
  messagingSenderId: "123456789012",
  appId: "1:123456789012:web:abcdef123456"
};
```

5. **콘솔로 이동** 클릭

---

## [3] 익명 로그인(Authentication) 켜기

1. 왼쪽 메뉴 **빌드 → Authentication** 클릭 → **시작하기**
2. **Sign-in method** 탭 → 추가 제공업체 목록에서 **익명(Anonymous)** 클릭
3. 우측 상단 토글을 **사용**으로 켜기 → **저장**

---

## [4] Firestore 만들기 + 보안 규칙 적용

1. 왼쪽 메뉴 **빌드 → Firestore Database** → **데이터베이스 만들기**
2. 위치: **`asia-northeast3 (Seoul)`** 선택 → 다음
3. 보안 규칙: **테스트 모드로 시작** 선택 → **만들기**
   (잠시 후 4-2 단계에서 안전한 규칙으로 바로 교체할 거예요)

4-2. 생성 완료 후, 상단 **규칙(Rules)** 탭 클릭 → 아래 내용으로 **전체 교체** 후 **게시**:

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /users/{userId} {
      allow read, write: if request.auth != null && request.auth.uid == userId;
    }
  }
}
```

> 같은 내용이 `github-actions-checker/firestore.rules` 파일에도 들어있어요.

---

## [5] Cloud Messaging → VAPID 키 발급

1. 좌측 상단 **⚙️(설정) → 프로젝트 설정** 클릭
2. **Cloud Messaging** 탭 클릭
3. 아래로 스크롤 → **웹 구성 → 웹 푸시 인증서**
4. **키 쌍 생성** 클릭
5. 생성된 긴 문자열을 복사 (예: `Bxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx`)

---

## [6] firebase-config.js에 값 채우기

압축 푼 폴더의 **`firebase-config.js`** 파일을 열어서,
[2]에서 복사한 `firebaseConfig` 값들과 [5]에서 복사한 VAPID 키를 채워주세요.

```js
var FIREBASE_CONFIG = {
  apiKey:            "AIza...",                              // [2]에서 복사
  authDomain:        "dotori-pharmacist-xxxx.firebaseapp.com",
  projectId:         "dotori-pharmacist-xxxx",
  storageBucket:     "dotori-pharmacist-xxxx.appspot.com",
  messagingSenderId: "123456789012",
  appId:             "1:123456789012:web:abcdef123456",
};

var VAPID_KEY = "Bxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"; // [5]에서 복사
```

저장하면 클라이언트 쪽 설정은 끝이에요!

---

## [7] 서비스 계정 키 발급 (서버용 — GitHub Actions가 사용)

1. **프로젝트 설정 → 서비스 계정** 탭
2. **새 비공개 키 생성** 클릭 → 확인
3. `xxxx-firebase-adminsdk-xxxx.json` 파일이 다운로드됨

> ⚠️ 이 파일은 우리 앱의 모든 데이터에 접근 가능한 "마스터 키"예요.
> 절대 공개 저장소에 파일 그대로 올리지 마세요. (다음 단계에서 GitHub **Secret**으로만 등록합니다)

---

## [8] GitHub 저장소 만들고 파일 업로드 + Pages 켜기

1. https://github.com → **New repository**
2. 이름 입력 (예: `dotori-pharmacist`) → Public 또는 Private 선택 → **Create repository**
3. 압축 푼 폴더의 **모든 파일/폴더**를 그대로 업로드합니다. (드래그&드롭 또는 git push)
   최종 구조는 아래와 같아야 해요 (압축을 풀면 이미 이 구조입니다):
     ```
     (저장소 루트)
     ├── index.html
     ├── style.css
     ├── app.js
     ├── firebase-config.js
     ├── manifest.json
     ├── service-worker.js
     ├── icons/
     ├── .github/workflows/medication-check.yml
     └── scripts/
         ├── check-medications.js
         └── package.json
     ```
4. **Settings → Pages**
   - Source: **Deploy from a branch**
   - Branch: **main** / 폴더: **/ (root)** → **Save**
5. 몇 분 후 페이지 상단에 주소가 표시됨:
   `https://<내깃허브아이디>.github.io/dotori-pharmacist/`

> 이 https 주소가 바로 어머니 폰에 설치할 주소예요 (이전 가이드의 2~3번 참고)

---

## [9] GitHub Secret에 서비스 계정 키 등록

1. 저장소 → **Settings → Secrets and variables → Actions**
2. **New repository secret** 클릭
3. Name: `FIREBASE_SERVICE_ACCOUNT`
4. Value: [7]에서 다운로드한 `.json` 파일을 **메모장으로 열어서 전체 내용을 그대로 복사 → 붙여넣기**
   (`{` 부터 `}` 까지 전부)
5. **Add secret**

---

## [10] 테스트

### 10-1. 폰에 설치하고 기기 등록 확인

**📱 아이폰(iOS)** — iOS 16.4 이상에서만 알림을 받을 수 있고, **꼭 아래 순서**대로 해야 해요:

1. **Safari**로 위 [8]에서 만든 https 주소 열기
   (크롬 등 다른 브라우저는 iOS에서 "홈 화면에 추가"가 안 보이거나 동작이 달라요)
2. 하단 **공유 버튼(⬆️ 사각형)** 탭 → 아래로 스크롤 → **"홈 화면에 추가"** → 추가
3. **Safari를 완전히 닫고**, 홈 화면에 생긴 도토리 아이콘으로 앱을 엽니다
   (Safari 탭 안에서는 알림 기능 자체가 동작하지 않아요. 반드시 홈 화면 아이콘으로 열어야 "앱처럼" 동작하면서 알림도 가능해져요)
4. 앱 안에서 **"알림 허용하기"** 버튼 탭 → iOS 기본 알림 권한 팝업이 뜨면 **허용**

이후부터는 잠금화면/알림센터에 다른 앱들과 똑같이 알림이 표시돼요.
(참고: EU 지역은 정책상 PWA 알림에 제한이 있지만, 한국은 해당되지 않아요)

**🤖 안드로이드** — Chrome에서 주소를 열고 메뉴 → "홈 화면에 추가"만 하면 되고,
Chrome 탭에서 바로 "알림 허용하기"를 눌러도 동작해요 (iOS보다 제약이 적어요).

**설치 후 토큰 등록 확인:**

5. 홈 화면 아이콘으로 앱을 연 상태에서 **"알림 허용하기"** 탭까지 완료했다면,
   Firebase 콘솔 → Firestore Database → `users` 컬렉션에 문서가 1개 생겼는지 확인
   - 문서를 열어서 `fcmToken` 필드에 긴 문자열이 들어있으면 정상이에요

### 10-2. 알림 받아보기

이 앱은 알림 시간이 **고정**되어 있어요 (따로 설정할 필요 없음):

| 시간  | 알림 문구 |
|-------|-----------|
| 09:00 | 오전약 잘 챙겨 드셨나요~! 꼭 챙겨드세요~! 💊 |
| 13:00 | 오후약 잘 챙겨 드셨나요~! 꼭 챙겨드세요~! 💊 |
| 19:00 | 저녁약 잘 챙겨 드셨나요~! 꼭 챙겨드세요~! 💊 |
| 21:00 | 자기전약 주무시기전에 꼭 챙겨드세요~! 💊 |

해당 시간에 알림이 1번만 발송됩니다.
복용 완료 여부와 관계없이 30분 후 재알림은 발송하지 않습니다.

**⏱️ 4번 시간을 기다리지 않고 바로 테스트하려면:**

1. 저장소 → **Actions** 탭 → "도토리 약사님 - 복약 알림 체커" 워크플로우 선택
2. 우측 **Run workflow** 버튼 클릭
3. **`test_notification`** 체크박스를 ✅ 체크 → **Run workflow**
4. 등록된 모든 기기로 "[테스트] 알림이 이렇게 도착하면 정상이에요 💊" 알림이
   시간 조건과 무관하게 즉시 1개씩 발송됩니다

5. 로그 확인: 방금 실행한 워크플로우 클릭 → `check-medications.js` 실행 로그에서
   `[테스트] 알림 발송 완료` 메시지가 보이면 성공!

테스트할 때는 **앱을 완전히 종료**하고(최근 앱에서 스와이프) 화면도 꺼둔 채로
확인하면, "앱이 꺼져있어도 알림이 오는지"까지 함께 확인할 수 있어요.

---

## 문제가 생겼을 때

- **Firestore에 문서가 안 생겨요** → firebase-config.js 값이 정확한지, 오타가 없는지 확인
- **fcmToken이 비어있어요** → VAPID_KEY가 올바른지, 알림 권한을 "허용"했는지 확인
- **GitHub Actions 로그에 "FCM 토큰 없음 → 건너뜀"만 보여요** → 위 10-1을 먼저 완료해주세요
- **알림 발송은 됐는데 폰에 안 와요** → 안드로이드는 보통 잘 도착해요. 아이폰은 iOS 16.4+ 및
  PWA를 "홈 화면에 추가"한 상태여야 하고, 첫 알림은 몇 분 정도 지연될 수 있어요
- 위 항목들이 다 정상인데도 평소 알림이 안 온다면, **10-2의 `test_notification`**으로
  발송 자체가 되는지 먼저 확인해보세요. 그게 잘 오면 시간 로직 문제, 안 오면 토큰/권한 문제예요.

---

## [11] 앞으로 업데이트할 때 (자동 업데이트)

이 앱은 새 버전을 배포하면, 어머니가 앱을 열 때 자동으로
**"새 버전으로 업데이트 중..."** 알림이 잠깐 뜨고 자동으로 새로고침되어
항상 최신 버전을 사용하게 됩니다. 어머니가 따로 하실 일은 없어요.

배포 방법:

1. 수정한 파일들을 GitHub 저장소에 업로드(push)
2. **`service-worker.js`** 파일을 열어서 `CACHE_NAME`의 숫자를 **하나 올리기**
   ```js
   const CACHE_NAME = 'dotori-pharmacist-v9';   // → 'dotori-pharmacist-v10'
   ```
   (이 숫자를 바꿔야 기기들이 "새 버전이 있다"고 인식해요. 안 바꾸면 캐시 때문에
   예전 버전이 계속 보일 수 있어요)
3. 이것도 함께 업로드

그 다음부터 어머니 폰에서 앱을 열면(또는 백그라운드에 있다가 다시 열면)
자동으로 업데이트되고 새로고침됩니다.

---



## 참고: 이후에도 동작하는 구조 요약

```
폰 (PWA)                Firestore                GitHub Actions (5분마다)
  │  복용 체크              │                           │
  ├──────────────────────▶│                           │
  │                        │◀──────읽기────────────────┤
  │                        │  09/13/19/21시 + 미체크 확인 │
  │                        │◀──notified 갱신────────────┤
  │◀─────────FCM 푸시───────────────────────────────────┤
```

폰 안의 1분 체커(기존 기능)는 "앱이 켜져있을 때" 더 빠르게 반응하고,
GitHub Actions 체커는 "앱이 꺼져있을 때"를 책임지는 이중 안전망 구조예요.
