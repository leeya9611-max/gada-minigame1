# 야리끼리 대소동 🪖

가다(GADA) 앱 배너 → 웹뷰로 연결되는 현장 러닝 미니게임. 원터치 2단 점프 기반 자동 러닝, 안전모 코인 획득과 랭킹 점수 기록이 핵심.

## 실행

```bash
pnpm install
pnpm dev
# http://localhost:3000/game 접속
# 딥링크 예시: /game?token=<base64url(JSON)>
```

- `Space` / `↑` 또는 화면 터치로 점프 (공중에서 한 번 더 = 2단 점프)

## 배포 (Vercel + Supabase)

1. **환경변수 2개** — Vercel 프로젝트 설정 → Environment Variables에 등록 (로컬은 `.env.local`, 키 이름은 `.env.example` 참고):
   - `SUPABASE_URL` — 프로젝트 **기본 URL**(`https://xxxx.supabase.co`, `/rest/v1` 붙이지 말 것)
   - `SUPABASE_SERVICE_ROLE_KEY` — 서버 전용. **`NEXT_PUBLIC_` 접두사 절대 금지**
   - 미설정 시 API는 메모리 스텁으로 폴백(개발용) — 운영에선 반드시 설정
2. **빌드** — `npm run build` (prebuild로 점프 클리어런스 게이트 자동 실행). dev 서버 켠 채 빌드 금지.
3. DB 스키마·RPC는 작업지시서 E7-0의 SQL을 Supabase SQL Editor에서 1회 실행.
   E3.34 출석 보상 테이블도 함께 실행:

   ```sql
   -- 출석 보상(E3.34): 하루 1회는 PK가 보장, day_index는 행 수 기반 7일 순환
   create table if not exists attendance (
     user_id    text not null references users(user_id) on delete cascade,
     claim_date date not null,           -- KST
     day_index  int  not null,           -- 1~7
     reward     int  not null,           -- 지급 티켓 수
     created_at timestamptz not null default now(),
     primary key (user_id, claim_date)
   );
   alter table attendance enable row level security;
   grant all on table attendance to service_role;

   -- 게임 세션(E8-보안): 점수 위조 방어 — 서버가 시작 시각 기록·1회용 소비. 만료 청소는 운영 크론(선택)
   create table if not exists game_sessions (
     session_id  text primary key,
     user_id     text not null references users(user_id) on delete cascade,
     started_at  timestamptz not null default now(),
     consumed_at timestamptz
   );
   create index if not exists idx_game_sessions_user on game_sessions (user_id);
   alter table game_sessions enable row level security;
   grant all on table game_sessions to service_role;
   ```
4. supabase-js가 Node 20 지원 중단 예고 — Vercel 프로젝트 설정에서 Node.js 22.x 권장.

## 기술 선택

- **Next.js 14 (App Router)** + **Canvas 2D** 직접 구현.
  단순 러너라 Phaser.js 없이 Canvas로 충분하다고 판단(의존성/학습비용 절감).
- 모바일 세로 고정(논리 해상도 450×800), 반응형 불필요 — 화면에 맞춰 레터박스 스케일.
- 게임 진행 중 서버 통신 없음. 클라이언트 상태만 유지, 종료 시 결과값만 전달.

## 폴더 구조

```
app/
  page.tsx                 개발용 랜딩
  game/
    page.tsx               게임 진입 (토큰 파싱 → Game)
    Game.tsx               캔버스 + HUD + 오버레이 (client)
    engine/
      config.ts            상수·밸런스·대사
      types.ts             공용 타입
      player.ts            김반장 물리/렌더
      obstacle.ts          장애물/코인/투척물/아이템 엔티티
      collision.ts         AABB 충돌 판정
      score.ts             코인/랭킹 점수 계산
      GameEngine.ts        루프·스폰·충돌·효과·대사 오케스트레이션
  ranking/
    page.tsx               랭킹 보드 (전국/연령/지역 탭, 티어, 티켓)
    tier.ts                점수 → 티어 매핑
lib/
  auth.ts                  딥링크 토큰 파싱/유저 식별
  api.ts                   결과값 네이티브 전달 (postMessage → 서버콜백)
assets/                    커스텀 스프라이트 보관(현재는 캔버스 벡터 렌더)
```

## 구현 단계 (작업지시서 대응)

1. ✅ 기본 러닝 골격 — 배경 스크롤, 자동 이동, 1/2단 점프, 장애물 랜덤 생성 + 충돌 감속
2. ✅ 코인/점수 — 안전모 코인, 실시간 점수 카운터, 종료 시 최종 집계
3. ✅ 투척 기믹/아이템 — 박소장 투척(서류뭉치/도면통/확성기) 경고 선행, 다방커피(감속)/부스터(무적)
4. ✅ 인증/데이터 — 토큰 파싱, 결과값 JSON(`userId, coinCount, rankScore, playDuration, timestamp`) postMessage 전달
5. ✅ 코믹 대사/게임오버 연출 — 투척·피격·게임오버 대사 팝업
6. ✅ UI 마감 — 랭킹 보드(탭/티어 배지), 티켓 잔여, 광고 시청/포인트 교환 선택

## 결과값 전달 스펙 (4단계)

게임오버 시 아래 JSON을 네이티브로 전달 (`lib/api.ts`). 콘솔에 `[GAME_RESULT]` 로그로도 확인 가능.

```json
{ "type": "GAME_RESULT", "payload": {
  "userId": "u_123", "coinCount": 12, "rankScore": 4180,
  "playDuration": 37.4, "timestamp": 1720000000000
}}
```

- 1순위 `window.ReactNativeWebView.postMessage` → iOS `webkit.messageHandlers.gameResult` → `parent.postMessage`
- 실패 시 `POST /api/result` 서버 콜백(스펙 미확정 — 보류 항목).

## 주의사항 준수

- 실제 브랜드명 미사용 — 김반장/박소장 등 가상 현장 인물, 아이템도 일반 명칭.
- 재화 지급 로직 클라이언트 미포함 — 웹앱은 결과값 계산만, 지급은 네이티브.
- 토큰에 개인정보 미포함 — 식별자(uid)만.
- 에셋: 현재 캔버스 벡터 렌더링. Kenney(CC0) 등 도입 시 `assets/raw`에 원본, 편집본은 `assets/characters` 등에 분리 보관.

## 보류(협의 필요)

- 포인트–티켓 교환비 수치
- 딥링크 스킴 확정
- 서버 콜백 API 스펙(postMessage 실패 대체안)
