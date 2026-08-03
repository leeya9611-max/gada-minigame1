# B. 야리끼리 대소동 — 네이티브(가다 앱) 연동 명세서 v1 (2026-08-03)

> 대상: 가다 앱 개발팀. 이 문서만으로 웹뷰 연동을 완료할 수 있도록 작성했습니다.
> 웹 구현은 배포 완료 상태이며, 앱 쪽 작업은 ①웹뷰 열기(토큰) ②메시지 수신 ③액션 처리 3가지입니다.

## 0. 원칙

- **재화(티켓·포인트) 지급·차감 권위는 전부 네이티브/가다 서버.** 웹은 표시하고 요청만 보냅니다.
- 토큰에 개인정보를 담지 않습니다(식별자 uid만).
- 웹은 앱 없이도 동작(브라우저 폴백)하지만, 그 경우 게스트 계정·로컬 스텁으로 동작합니다.

## 1. 진입 (딥링크 → 웹뷰)

```
https://gada-minigame1.vercel.app/game?token=<TOKEN>
```

- `TOKEN` = **base64url(JSON)** 또는 **JWT**(payload만 사용). 기대 필드:
  ```json
  { "uid": "u_12345", "exp": 1725000000 }
  ```
  - `uid`(또는 `userId`/`sub`): 가다 유저 식별자 — 랭킹·이수·출석이 이 키로 저장됨
  - `exp`(선택, epoch 초): 만료 검증. 만료·파싱 실패 시 게스트로 폴백
- 화면은 **가로 고정**을 권장(웹이 세로 감지 시 회전 안내를 띄우지만, 웹뷰에서 가로 고정이 최선)
- ⏳ 딥링크 스킴(앱 내 라우팅)은 앱팀 확정 필요
- 랭킹 페이지 직접 진입도 지원: `/ranking?token=<TOKEN>`

## 2. 웹 → 앱 메시지 (수신 구현)

웹은 아래 3채널을 순서대로 시도합니다. **하나만 구현하면 됩니다.**

| 채널 | 플랫폼 | 수신 형태 |
|---|---|---|
| `window.ReactNativeWebView.postMessage(string)` | RN WebView | **JSON 문자열** `{"type","payload"}` |
| `webkit.messageHandlers.gameResult` / `.nativeAction` | iOS WKWebView | **payload 객체**가 타입별 핸들러로 직접 전달 |
| `window.parent.postMessage({type,payload}, "*")` | iframe 임베드 | 객체 |

### 2-1. GAME_RESULT (판 종료마다 1회)

```json
{ "type": "GAME_RESULT", "payload": {
  "userId": "u_12345",
  "sessionId": "s_1722664496_ab12cd",
  "mode": "endless",            // "endless" | "edu" (edu는 랭킹 제외)
  "outcome": "hp",              // "cleared" | "hp" | "caught" | "giveup"
  "rankScore": 4180,
  "coinCount": 12,
  "playDuration": 74.3,
  "timestamp": 1722664571000,
  "ticketUsed": 1,              // edu는 0
  "nickname": "불도저 김씨",
  "routeId": "endless",
  "hits": 3,
  "totalCoins": 0
}}
```

- 앱이 할 일: 필요 시 자체 서버 기록. **랭킹 반영은 웹이 자체 API로 이미 처리**하므로 필수 아님.
- `sessionId`는 판마다 재발급 — 중복 수신 dedup 키로 사용 가능.

### 2-2. NATIVE_ACTION (버튼 요청 — 앱이 반드시 처리)

```json
{ "type": "NATIVE_ACTION", "payload": { "action": "<아래 중 하나>" } }
```

| action | 트리거 | 앱이 해야 할 일 |
|---|---|---|
| `watchAdForTicket` | 티켓 + 버튼 / 충전 화면 / 랭킹 "광고 +1" | 리워드 광고 노출 → 완료 시 티켓 +1 지급 |
| `claimAttendanceReward` | 출석 팝업 "받기" | 출석 티켓 지급(웹이 함께 보내는 GAME 데이터 없음 — 수량은 웹 API가 서버 기록: 1~3장) |
| `inviteFriend` | 충전 화면 "친구 초대" | 초대 플로우 → 조건 충족 시 티켓 +1 |
| `exchangePointsForTicket` | (현재 세이프 모드로 숨김) | 포인트 차감 → 티켓 +1 |
| `shareResult` | 결과 화면 "공유" (Web Share 미지원 시) | 시스템 공유 시트 |
| `exitGame` | 로비 우상단 나가기 | **웹뷰 닫기** |

> ⚠️ **개발용 로컬 스텁 안내**: 앱 미연동 상태에서도 테스트가 되도록, 현재 웹이
> `watchAdForTicket`·`claimAttendanceReward` 요청 직후 **로컬 티켓을 +1(출석은 +reward)** 합니다.
> 앱 연동이 켜지면 이 스텁을 제거해야 이중 지급이 없습니다.
> 위치: `app/game/Game.tsx`의 `charge()`, `claimAttendance()` — `TODO(앱팀 연동)` 주석 참조.

### 2-3. 티켓 잔량 동기화

현재 웹은 티켓 잔량을 로컬로 표시합니다. 앱이 지급 권위를 가지면
**앱 → 웹 잔량 주입 방식 협의 필요**(예: 토큰에 초기 잔량 포함, 또는 webView.evaluateJavascript로
`localStorage.setItem("yarikkiri.tickets", n)` 주입 후 리로드). ⏳ 협의 항목.

## 3. 검증 방법 (QA)

디버그 URL: `.../game?token=<TOKEN>&debug=1` → 좌하단 🐞 패널

- **감지**: 첫 줄에 인식된 브리지 채널 표시. 앱 웹뷰에서 `없음(브라우저 단독)`이 나오면
  앱의 핸들러 주입이 안 된 것
- **테스트 발사 버튼**: exitGame / 광고티켓 / 공유 / 결과 — 플레이 없이 각 메시지를 즉시 송신
- **송신 로그**: 실제 발생한 모든 메시지의 채널·페이로드 실시간 표시
- **성능**: 실시간 fps · render ms 표시(저사양 검증용)
- JS 에러도 패널에 빨간 줄로 표시 — 스크린샷이 곧 버그 리포트

## 4. 웹 자체 서버 API (참고 — 앱이 호출할 일은 없음)

Supabase 저장, 웹이 직접 호출: `/api/season`(주간 랭킹, 점수 상한 검증),
`/api/nickname`(중복 검사), `/api/progress`(교육 이수), `/api/attendance`(출석, 하루 1회 DB 차단),
`/api/log`(행동 로그 스텁). 계약은 각 라우트 파일 상단 주석에 명세.

## 5. 연동 체크리스트 (앱팀)

- [ ] 딥링크 스킴 확정 + 토큰(uid, exp) 발급
- [ ] 웹뷰 가로 고정 + 바운스 스크롤 비활성
- [ ] 메시지 수신 채널 1종 구현(RN 또는 WKWebView)
- [ ] NATIVE_ACTION 6종 처리(최소: watchAdForTicket, claimAttendanceReward, exitGame)
- [ ] 지급 연동 시점에 웹 로컬 스텁 제거 요청(웹팀)
- [ ] 티켓 잔량 동기화 방식 협의
- [ ] `?debug=1`로 실기기 E2E 확인(감지 채널·6종 발사·GAME_RESULT 수신)
