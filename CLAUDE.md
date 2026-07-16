# 야리끼리 대소동 — 가다(GADA) 웹뷰 러닝 미니게임

> Claude Code 영구 컨텍스트. 새 세션은 이 문서 + `docs/개발_작업지시서_v3_이벤트피벗.md`부터 읽을 것.

## 프로젝트

- 가다 앱 배너 → 웹뷰 러닝 게임. **한 달 챌린지 이벤트로 피벗**(기획: `docs/야리끼리_한달챌린지_피벗기획_v1.md`)
- 흐름: 인트로(S1) → 닉네임(최초 1회) → 로비(안전교육/무한 잔업 2버튼) → 게임 → 결과
- 랭킹 축: **엔들리스 "무한 잔업 모드"** 단일 지표(일일 베스트 합산·주간 리셋 4라운드)

## 진행 상태 (2026-07-14 기준)

- ✅ v2 로드맵 WP0~6.5 전체 (가로 800×450, 룰, 추격 gap, 슬라이드, 커스텀 스프라이트, 티켓/postMessage, 노선 시스템, 로비)
- ✅ 닉네임 등록(S1.2) + 양손 조작(좌 홀드=슬라이드/우 탭=점프)
- ✅ v3 **E1**(엔들리스 mode 복원) · **E2**(로비 2버튼 + 안전교육 게이트)
- ✅ **E3**(route_edu 노선·구간 배너·관용 룰) · **E3.5**(폴리시 11항목: PLAYER.X 300 추격 시각화, 패럴럭스 타일링, 비네트, edu 톤 완화, 스프라이트 가시성, 진행바 노랑, 끝 지형 연속, 추격 게이지 삭제, edu 60초 압축, 투척 반응창 2초 역산, lowbar 상단 차단)
  - 헤드리스 검증 통과(교육 무입력 완주·HP 미감소·배너 5개·투척 L/H 교대·반응창 2000ms·lowbar 점프 충돌·엔들리스 실패 조건 유지)
- ✅ **AI 에셋 반입**(2026-07-16, `assets/incoming_ai` → `public/assets`): 캐릭터 시트 알파 분할(김반장 run **7프레임** — README 표기 8이나 실측 7 / 액션 4포즈 / 서류 idle·cheer, 박소장 run6+투척3), 배경 3레이어(중경 픽셀 필터 캐시 — ctx.filter 미사용), 지면 미러 베이크 타일, 장애물·코인·투척물·소품·정류장 교체(히트박스 무변경·벡터 폴백 보존), PNG 256색 양자화. 반입 스크립트: `tools/asset_intake/`. AI 원본(`assets/incoming_ai/`)은 gitignore — 기기 의존
- ✅ **E3.6-1**(점프 물리: 1단 130px·정점 2단 213px 실측, 하강 중력 1.3배) — E3.7-8 선행 의존으로만 적용. **E3.6의 2·3(잡힘 연출·주스 이펙트)는 미착수**
- ✅ **E3.7 6~9**(HUD 다크 패널 `hudPanel`, obs_air=크레인 매달린 자재(로프·후크+fall_pipes 회전), 코인 도달성 검증(`SPAWN.COIN_MAX_H` 160·route_edu 최고 slot3=111px — 수정 불필요), 투척물 소멸 보강(수명 상한+통과 후 페이드)) — 헤드리스 검증 ALL PASS
- ⚠ **E3.7 1~5는 미착수**(중경 채도·OBSTACLE_RENDER 상수표·slide 롤백·정류장 크기·지면 돌 톤 — 별도 전달본 프롬프트 예정)
- ▶ **다음: E3.7 1~5 → E4**(주간 랭킹) → E5(팔레트) → E6(QA)
- E 단계 프롬프트는 `docs/개발_작업지시서_v3_이벤트피벗.md`의 블록을 그대로 따를 것

## 스택·구조

- Next.js 14 App Router + TypeScript + Canvas 2D 직접 구현(Phaser 없음). pnpm.
- `app/game/engine/` — GameEngine(루프·모드·스폰·충돌), player, obstacle, level(노선 JSON), Background(패럴럭스), sprites(매니페스트 클립), config(밸런스 전부)
- `app/game/Game.tsx` — 화면 상태 머신(title/nickname/lobby/game) + HUD/오버레이
- `lib/` — api(postMessage 결과 전달), tickets, progress(이수·별점), nickname, sfx(스텁)
- `public/levels/route1~5.json` — 맵 에디터(`public/map-editor.html`) 포맷. `public/assets/sprites/` + `sprites_manifest.json`
- 좌표 규약: cell 54px, 지형 단차 30px/단, air slot y=지면−slot·30−21. 캐릭터는 실측 키(run1 알파 bbox) 기준 126px 통일 스케일

## 명령·검증

- dev: `PORT=3210 pnpm dev` (3000 충돌 회피). 단계 게이트: `npx tsc --noEmit`, 최종만 `npm run build`
- **dev 서버 켠 채 `npm run build` 금지** — 같은 `.next` 공유로 청크 깨짐(과거 사고). 빌드 전 dev 종료
- 헤드리스 검증 패턴: `.simtest/*.ts`에 performance/rAF/Image/localStorage 목 + GameEngine 직접 구동 → tsc(commonjs)로 컴파일 후 node 실행. sprites.js의 `@/public/...` manifest 경로는 `../../../../../public/...`으로 sed 치환 필요. 끝나면 `.simtest` 삭제
- 크롬 자동화 확장은 localhost 접속 불가 → 시각 확인은 사용자에게 요청, 로직은 헤드리스로

## 규칙 (v3 지시서)

- **재작업 금지**: 완료 목록(위)을 다시 만들지 말 것
- **삭제 금지·미사용 보관**: route2~5 JSON, 별점 코드(computeStars 등), 월드맵/상점 관련 — 렌더에서만 제거된 상태
- 재화(티켓/포인트) 지급·차감은 네이티브/서버 권위. 웹은 표시·요청·결과 전달만. 토큰에 개인정보 금지
- 상표권: 실제 브랜드명 금지(김반장/박소장 등 창작 명칭)
- 닉네임/시즌 API는 개발 스텁(`app/api/*`, globalThis 메모리) — 운영은 서버 교체, 계약은 파일 주석
- 커밋: 한국어 컨벤셔널(`feat: ...`), 사용자가 요청할 때만 커밋/푸시

## 에셋

- 커스텀 디자인 원본: `/Users/worksmate/Documents/야리끼리 디자인/` (기기 의존 — 새 환경엔 없을 수 있음, repo의 public/assets가 최종본)
- Kenney CC0(assets/raw는 gitignore). 이미지 처리 스크립트는 python3+Pillow 사용해 왔음
