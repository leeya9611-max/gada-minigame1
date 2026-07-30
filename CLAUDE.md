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
- ✅ **E3.8**(투척 리워크+장애물 정합): 직선 투척(HIGH/LOW) 폐지 → **낙하 지점 방식**(포물선 화면 위 통과, 마커 그림자+'!' 1.5~2초 선행, 낙하 순간만 판정 `DROP_IMPACT_MS`, 파편 0.3초 후 소멸, 램프=간격 단축+2연속). 콘·표지판 정식 장애물 승격(`OBSTACLE_RENDER`, 히트박스 −15%, 엔들리스 풀 9%씩). drawProps 트랙사이드 소품 제거(지면 레인 무충돌 진한 오브젝트 금지, fence 미사용 보관). 중경 채도 0.5로 강하(컨테이너 구분). 헤드리스 ALL PASS(마커 선행 ≥1.5s·회피 봇 피격 0/26·콘 충돌·회귀)
- ✅ **E3.9**(장애물 기하 정합): 로드 시 알파 트리밍(`sprites.ts` drawSprite/spriteAspect), 3계층 기하 표(`OBSTACLE_RENDER` — 1단층 puddle/stack/cone/sign·2단층 **fence 신규**(prop_fence_panel, obs_fence 레벨 타입)·슬라이드층 lowbar 틈 52), **클리어런스 빌드 게이트**(`npm run gate:clearance`, prebuild 자동 — 히트박스 기준 체공 거리 ≥ W+52+30), 스폰 최소 간격 0.7s(+fence 후 0.6s 추가 — 체공 1s 커버), lowbar↔낙하 이중구속 상호 배제(속도×0.75 반경), fence 엔들리스 35s부터·교육 구간2 1회(route_edu 재편·간격 위반 0). 헤드리스 ALL PASS(공정 구간 45s 피격 0)
- ✅ **E3.7-3 slide 롤백**(2026-07-16): AI slide 포즈(앉은 자세)가 65px 렌더에서 인형처럼 축소 → 구 커스텀 slide.png(462×170 가로 포즈) 복원, 렌더 크기·RAW 경로 유지. AI 세트가 구 디자인에 스타일 매칭돼 이질감 없음
- ✅ **중경 v2 교체**(2026-07-16): bg_mid_buildings_v2 반입(WebP q95, 표시 높이 280=화면 62% — E3.7-1 규칙 충족), 하단 SIL_SINK 30px로 지면 뒤 묻힘, 채도 필터 유지(**v2는 필터 보상 선적용 — 필터 변경 금지**, Background.ts 주석)
- ✅ **E3.10**(2026-07-21): ① 프레임 스케일 정규화(구 액션 시트가 v2 러닝보다 8% 큼 — 헬멧 면적 실측, jump/fall ×0.926·`build_chars.py` ACTIONS_NORM) ② 일시정지(⏸ 버튼·visibilitychange 자동, resume 시 절대시각 시프트로 연속성, 포기=엔들리스 `giveUp()`→outcome `"giveup"` 결과 전달/교육·노선 로비 복귀) ③ 장애물 대비(공통 접지 그림자+실루엣 2px 아웃라인 `drawSpriteOutlined`+폭 10%, 히트박스 불변) ④ HP 안전모 26px ⑤ 코인 안전 경로(스폰 상호 배제 `COIN_OBSTACLE_GAP` 140, 헤드리스 코인 추종 무피격·route_edu 정적 검사) ⑥ 지면 돌 얼룩 흙톤 블렌드(웅덩이 혼동 제거 — E3.7-5 겸) ⑦ z순서(캐릭터가 장애물 항상 앞). 헤드리스 ALL PASS·게이트 PASS
- ✅ **캐릭터 v2 시트**(2026-07-21~22): 김반장 러닝 6프레임 + 박소장 러닝 8프레임(그림자 제거·7% 정규화) + HUD 배치(⏸ 우상단 모서리, 점수 패널 왼쪽)
- ✅ **E3.11**(2026-07-22): ① 아이템 첫 등장 라벨(종류별 localStorage 2회 `yarikkiri.itemHint.*`, 캔버스 말풍선 + 획득 시 동일 문구 say 1.4s) ② 결과·클리어 오버레이 반응형(clamp 여백·폰트, cheer 캐릭터 타이틀 옆 배치·430px 이하 숨김, safe-area 인셋, overflowY, 버튼 상시 가시 — 667×375 확인) ③ 점수 내역 분리(랭킹 점수 / 코인→+N점 / 주행→+N점, 교육은 조작 이수 유지). puppeteer-core+시스템 Chrome으로 DOM 스크린샷 검증 패턴 확보(`scratchpad/shots/dom_shot.js`)
- ✅ **E3.12·E3.13**(2026-07-22): 커피 캔·구급상자(heart, 효과·라벨 불변) 아이템 스프라이트 교체(38px, `SPRITE_PATHS.coffee/firstaid` — 아이템·장애물은 매니페스트가 아니라 SPRITE_PATHS 관리), puddle v2(경고 테이프 액센트, 규격·히트박스 불변), 교육 첫 피격 1회 안내 배너(`noteEduHit`, 판당 1회 sim 검증)
- ✅ **E3.14**(2026-07-23): busstop v2(정면형) 교체 + 완주 시 bus.png 슬라이드 인(0.7s ease-out→0.3s 정차, `clearedAt` 기준, 벡터 폴백 동일 타임라인)
- ✅ **E3.15**(2026-07-23): lowbar 시각 폭 68→86(히트박스·틈 불변, 슬라이드 전용이라 체공 공식 비대상), **캐릭터 스케일 재발 근본 수정** — 진짜 원인: 구 시트 프레임이 v2 러닝보다 김반장 29%·박소장 18% 큼(E3.10의 색 면적 지표가 점프 헬멧 스티커에 속아 8%로 과소 보정). **헬멧 돔 폭(머리 밴드 최대 연결 요소)** 강체 지표로 재보정(gim jump/fall ×1/1.196, park throw/idle ×1/1.178 → 전 프레임 0.99~1.0) + `build_chars.py` 빌드 시 `verify_frame_scales()` 자동 게이트(±6% 초과 시 실패 — **시트 교체 시 상시 검증**, 정면 뷰·소지품 가림 프레임은 지표 예외)
- ✅ **E3.16**(2026-07-23): 엔들리스 아이템 4종 가중치 풀(coffee 30/heart 20/booster 30/magnet 20 — 기존엔 coffee·booster만), 자석 스프라이트 반입, 코인 밀도 500~1100ms(안전 경로 재검증 — 동일 시드 대조로 자석 흡인 +61% 확인). 파이프 묶음·투척물·경고 표시 시각 확대(히트박스 불변)
- ✅ **E3.6 완결**(2026-07-23, 잔여 2·3·4번): 잡힘 연출(엔들리스 gap≤0 → 0.6s 동결·줌·박소장 겹침·"붙잡혔다!" 후 caught / 교육 **봐주기 2회**(`EDU.GRAB_MERCY`) — 접촉 비트(슬로우 0.3×0.3s+휘청+플래시)+대사+gap 회복, 소진 후 gap 0 → 동일 잡힘 연출 → **교육 실패 화면**(재교육 유도·티켓 미차감·이수 미저장). 무입력 완주 회귀는 의도적으로 폐기 — 회피 봇 완주가 새 기준), 주스(착지 퍼프·달리기 미세 먼지·코인 세로축 회전+스파클+획득 팝·점수 플로터·피격 셰이크 4px+히트스톱 50ms), **부스터 4겹**(골드 트레일 `drawCharGold`+poseHistory·스피드라인·실루엣 광채·장애물 파괴 파편+펀치인+섬광 — 기존 노란 타원 오라 제거). 교육 아이템 4종 배치(magnet@104·dash@256 테스트용). 헤드리스 ALL PASS·GIF 확인
- ✅ **E3.6-4**(2026-07-23): 잡힘 전용 에셋 — grab_reach(근접·봐주기 팔 뻗기 포즈, 돔 폭 캘리브레이션 반입·manifest grab 클립·게이트 등록·어깨 높이 y+10 보정, 엔들리스 gap<70 임박 신호에도 사용) + caught 합성 컷(`SPRITE_PATHS.caught` — fx/caught.webp, 잡힘 0.6s 동안 개별 캐릭터 숨기고 한 장 페이드인 — 타이밍·줌·텍스트 불변, 미로드 폴백 유지)
- ✅ **E3.17**(2026-07-23): 중경 오프스크린 캐시에 약한 블러(다운→업 샘플 ≈2~3px)+대비 압축(MID_CONTRAST 0.78·PIVOT 168, 명도 +12%) — 전경 선명도 상대 강조. 코인·아이템 radial 발광 halo. cone(170px)·fall_pipes(220px) 고해상 재반입(DPR2 업스케일 블러 해소 — 소형 스프라이트는 "렌더px×2×1.4" 소스 확보 원칙)
- ⚠ **E3.7 잔여**(정류장 크기 — E3.14 busstop v2로 사실상 해소)
- ✅ **E4**(주간 시즌 랭킹): `/api/season` 스텁(globalThis 메모리, 계약 주석 — 일일 베스트만 갱신·edu 제외·KST 월요일 리셋 4라운드), 엔들리스 결과 POST 병행(`postSeasonScore`), 랭킹 페이지 **가로 레이아웃** 개편(좌 패널=티어·주간요약·티켓 / 우 리스트+내 순위 고정 행, 탭 제거, 세로 모드 회전 안내), 로비 "NR·D-x·이번 주 점수·순위" 1줄(실패 시 숨김), **REWARD_SAFE_MODE=true**(예상 포인트→정액 안내, 포인트 교환 숨김 — 플래그 복귀 가능). `SEASON.EVENT_START`는 개발용 이번 주 월요일 — **운영 오픈 시 교체 필수**. 랭킹 페이지 유저 식별: ?token= → localStorage `yk_last_uid` 폴백
- ✅ **잡힘 판정 버그 수정**(2026-07-23): 실패 판정 gap 우선으로 스왑 — 마지막 피격에서 hp·gap 동시 소진 시 hp가 먼저 잡혀 "붙잡혔습니다"가 영영 안 뜨던 버그(무입력 20판 caught 0 → 수정 후 caught/hp 10:10). HIT_LOSS는 110 유지(135는 hp 사망 소멸로 과함)
- ✅ **E3.18**(2026-07-24): Black Han Sans 헤드라인(next/font — 결과·클리어·로비 타이틀), primaryBtn/secondaryBtn 글로시(그라데이션+하이라이트+하단 그림자), resultCard·로비 카드 대각선 하이라이트 텍스처, LobbyIcon 컴포넌트(icon_edu/icon_endless.png 폴백=이모지), 로비 배경 lobby_bg.png cover+그라데이션(없으면 자연 폴백), caught 결과 히어로=합성 컷(430px 이하 숨김). 파일 누락 상태 폴백 확인 — 아이콘·배경 에셋은 추후 반입만 하면 자동 적용
- ✅ **E4-6**(2026-07-24): 랭킹 페이지 비주얼 업그레이드 — ranking_bg.webp cover+오버레이, 티어 배지 4종(tier_{master/banjang/gigong/jogong}.png)·메달 3종(medal_{1~3}.png) 이미지 교체(전부 onError 이모지 폴백), chargeBtn 글로시 통일, RankRow 텍스처+상위 3위 티어 컬러 글로우, panel_frame.webp 9-slice border-image(15% fill/16px stretch — 파일 없으면 투명 보더+기존 박스 폴백). 폴백/에셋 양쪽 스크린샷 검증. 에셋 원본은 assets/incoming_ai/ui/(gitignore). **E4-7**: 랭킹에 닉네임(캐시→서버 갱신, 내 티어 카드+고정 행 — 없으면 "나" 폴백), statLabel nowrap. **E4-8**: 좌측 aside 제거 — 배경 노출(헤더+cheer 캐릭터 42vh·430px 이하 숨김) / 우측 통합 패널(내 정보+티켓+리스트, 프레임은 우측만), 비율 0.8:1.3
- ✅ **E3.19**(2026-07-24): 로비 헤더 개편 — 닉네임 옆 티어 pill(tierOf(season.me.weekScore) 재사용, tier_{key}.png 24px + 티어명, 이모지 폴백), 티켓 재화 캡슐(글로시 CSS), 시즌 pill 톤 정리(금색 그라데이션+테두리). 2버튼 구조 무변경. lobby_bg는 E3.18 폴백 구조 그대로(에셋 미도착)
- ✅ **E3.20**(2026-07-24): 로비 캐릭터 중심 재배치 — LobbyScreen 세로 3단(상단바/중앙 히어로/하단 카드). 중앙 `LobbyHero`: idle_docs.webp clamp(100px,30vh,190px)(폴백 👷) + 발밑 radial 스포트라이트, 머리 위 닉네임 캡슐, 발밑 티어 캡슐(tierOf 재사용, tier_{key}.png 폴백 이모지 — E3.19의 LobbyTierPill은 여기로 흡수·삭제). 히어로는 zIndex 1(+pointerEvents none)로 카드 위에 겹침 허용. 2버튼 카드는 하단 고정 96px 가로형(LobbyIcon size=44, 기능·잠금 조건 무변경). 새 버튼/탭/화면 추가 없음. tsc + 에셋/폴백 양쪽 puppeteer 스크린샷 검증
- ✅ **E3.21**(2026-07-24): 로비 마감 — **lobby_bg.webp 반입**(incoming_ai/ui → public/assets/ui, 배경 참조 .png→.webp, 오버레이 알파 0.86/0.92→0.55/0.78로 낮춰 배경 노출), 좌상단 누적 m을 반투명 캡슐로, 우상단을 세로 그룹(랭킹보기 pill → 티켓 캡슐 → 시즌 요약, 우측 정렬 gap 7)으로 정리. 카드 글로시는 E3.18/E3.20 적용분 확인(재적용 불필요), icon_edu/icon_endless.png는 여전히 미도착 → 이모지 폴백 유지
- ✅ **E3.22**(2026-07-24): 로비 상단 우측(랭킹보기·티켓·시즌 요약)을 반투명 다크 카드 하나로 통합(시즌 텍스트도 카드 안 — 배경 위 맨 텍스트 제거), 하단 2카드 96→74px 축소(텍스트·아이콘 크기 유지), icon_edu/icon_endless.png 반입 → LobbyIcon 이미지 표시(폴백 유지)
- ✅ **E3.24**(2026-07-24): UI 에셋 15종 반입(public/assets/ui) — ① primaryBtn/secondaryBtn을 `ctaImg()` border-image로: `url(cta_*.png) 0 75 fill / 0 24px stretch`(좌우 캡만 슬라이스 — 세로 그라데이션 무손상, 레이아웃 border 0이라 파일 없으면 기존 그라데이션 폴백. borderRadius 999→24로 폴백 실루엣을 이미지 캡 곡률과 일치, primaryBtn 하단 경성 그림자 #16389c→중립 rgba로: 골드 이미지 밖 파란 비침 제거). CTA png는 고알파(>230) bbox 트림해 반입 ② 교육 실패 후 무한잔업 CTA는 cta_endless + 폴백 #dc4f35, 로비 카드 강조색을 cta_edu(#135dc3)/cta_endless(#dc4f35) 톤으로 통일 ③ `BtnIcon`(인라인, 이모지/무표시 폴백): 일시정지 버튼·PauseOverlay 타이틀=icon_pause, 계속하기=icon_play, 포기=icon_exit, 다시 도전·다시 뽑기=icon_retry, 로비 잠금=icon_lock(LobbyIcon), 랭킹 광고 버튼=icon_video(VideoIcon, page.tsx) ④ ribbon_blue=이수 완료 뱃지 배경(center 22% 크롭, 폴백 반투명 검정), ribbon_gold=ClearOverlay 타이틀 배경(폴백 투명) ⑤ trophy.png=ClearOverlay 장식(onError 숨김). 스크린샷: 로비/잠금로비/일시정지/게임오버/닉네임/랭킹 — ClearOverlay(리본·트로피)는 헤드리스로 클리어 도달 불가, 코드 반영만(실플레이 확인 필요)
- ✅ **E3.25**(2026-07-24): CTA 이미지 마감 확장 — ① 로비 "랭킹보기" Link도 ctaImg(cta_primary)(+흰 텍스트, radius 17, 중립 그림자) ② 랭킹 chargeBtn(cta, bg) 시그니처로 변경: 광고=cta_primary·교환=cta_secondary border-image(radius 12→16 캡 곡률 일치), bg는 폴백 그라데이션용 유지 ③ 이수 완료 뱃지 ribbon_blue→ribbon_gold ④ 로비 우상단 통합 카드 배경 불투명도 상향(rgba(8,13,26,0.72) — 세 요소가 한 카드로 읽히게) ⑤ 결과·일시정지 CTA border-image 적용 스크린샷 재확인 ⑥ trophy: 코드 반영+에셋 200 확인(인게임 컷은 실플레이 필요)
- ✅ **E3.26**(2026-07-27): 리본 사용처 정리 — ① 로비 "이수 완료 ✓" 뱃지: ribbon_gold 배경 철회, 반투명 캡슐(민트 텍스트) 복귀 ② ClearOverlay: 타이틀의 ribbon_gold 가로 배경·🦺 이모지 제거 → `RibbonBadge`(세로 자연 비율 380×400, h clamp 64~88px, 안에 "교육/이수" 2줄, 파일 없으면 통째 숨김)를 타이틀 왼쪽 배치 ③ ribbon_blue는 사용처 보류(public에 보관). ClearOverlay 스크린샷은 임시 devshot 라우트(ClearOverlay 임시 export)로 캡처 후 즉시 제거 — 삭제 시 `.next/types/app/devshot` 스테일 잔재로 tsc 실패하므로 같이 삭제할 것
- 📐 **원칙(UI 그루핑)**: 콘텐츠 많은 목록/정보 영역(랭킹 보드 등)은 프레임으로 감싼다. 소수의 상태·액션 요소가 모인 HUD성 클러스터는 큰 박스로 감싸지 않고 각자 개별 pill/아이콘으로 띄운다.
- ✅ **E3.27**(2026-07-28): 위 원칙 반영 — ① 로비 우상단 통합 패널(E3.22/25) 제거: 랭킹보기(cta_primary)·티켓 pill·시즌 텍스트를 gap 8 개별 요소로, 시즌 요약은 박스 대신 진한 text-shadow(0 1px 3px .9 + 0 0 8px .7)로 배경 위 가독성 ② 인게임 일시정지 버튼을 `PauseButton` 컴포넌트로: icon_pause.png가 자체 오렌지 버튼 배경을 가진 완결형이라 hudPanel 회색 박스 철거(이중 박스였음), 아이콘 42×45만 표시. 폴백(⏸ 이모지)일 때만 hudPanel 박스 부착
- ✅ **E3.30**(2026-07-28): 로비 2분할 대개편 + 전용 아트 반입 — ① 상단 `RoundGauge`(maxWidth 470 중앙): gauge_track.webp 금속 프레임 + round_marker_{active,locked}.png 헬멧 배지 4개(도달=골드/이후=그레이, 높이 118%로 트랙 위 겹침) + 채움 오버레이(inset 상하 27%·좌 4.5%, 폭 fillPct×0.91 — 슬롯 정렬) + D-{days} 큰 글씨·`{cur}/4 라운드`. season 없으면 숨김, 트랙 없으면 CSS 바·마커 없으면 🪖ㅤ폴백 ② 메인 flex row: 좌 LobbyHero(캐릭터 maxHeight clamp 140~260 확대, 닉네임 위·티어+시즌 성적 발밑) / 우(랭킹보기 작게 → 안전교육 → 무한잔업 세로 스택) ③ 카드 타이틀을 `CardWordmark`(wordmark_edu/wordmark_endless.png, h clamp 32~40, 폴백=헤드라인 텍스트)로 — 잠금 상태 무한잔업은 컬러 워드마크가 활성처럼 보여 회색 텍스트 유지 ④ 티켓 캡슐 우상단 유지 ⑤ ranking_hero.webp(트로피 김반장)를 랭킹 좌측 히어로로 교체(onError시 cheer.webp 폴백). 카드 배경 일러스트(card_edu/endless)는 보류 — 플랫 배경 유지. ⚠️ "E3.28 나가기 버튼"은 코드에 존재한 적 없음(추가 안 함)
- ✅ **E3.28**(2026-07-29, E3.30 뒤에 도착): 로비 우상단 액션 — ① `NativeAction`에 "exitGame" 추가 + `ExitButton`(icon_exit.png h34, 폴백 "✕ 나가기" pill, requestNativeAction만 호출·웹 결과 처리 없음) ② 티어 배지 25% 확대(fontSize 12→15, 배지 24→30) + 티어 컬러 글로우(0 0 14px {color}59) ③ 랭킹보기 확대(fontSize 13→16, padding 9×21) ④ `TicketBar` 재화 바: ticket_icon.png(좌, 캡슐에 겹침, 폴백 🎟) + 진한 캡슐 숫자 + btn_plus.png(우, 폴백 초록 CSS 원) — + 클릭 = 부모 charge("watchAdForTicket")(네이티브 요청+스텁 +1, 랭킹 페이지와 동일). 클릭 테스트: 5→6·NATIVE_ACTION 로그 확인 ⑤ 항목 5는 E3.30 게이지로 대체되어 스킵
- ✅ **E4-9**(2026-07-29): 랭킹 .rk-char 반응형 — 숨김 기준 max-height 430→320px, 375~430px 구간에서도 계속 표시
- ✅ **E4-10/11**(2026-07-29): .rk-char 확대 — 최종 clamp(160px, 62vh, 360px) + marginBottom 14(발끝 하단 여백 28px). 375px에서 233px·800px에서 360px 확인
- ✅ **E4-12**(2026-07-29): RankRow pinned 분리 — 하단 고정 "내 순위" 행은 골드 톤(그라데이션 rgba(255,210,63,0.22)…, border #ffd23f99, 골드 글로우), 목록 안 내 행은 기존 파랑(#2E66F6) 유지, top3 글로우보다 pinned 분기 우선. 고정 행 wrapper에 rgba(0,0,0,0.15) 깔개+하단 라운드(선택 항목 반영)
- ✅ **E5**(2026-07-29): 라운드별 배경 팔레트 스왑(기획 5.1) — ① config.ts `ROUND_THEMES`/`themeForRound()`: 1주 낮(hue -6·sat .78·bright 1.22) / 2주 석양(원본) / 3주 황혼(hue **-48** 자주 — 양수 회전은 올리브가 되므로 주의) / 4주 야간(hue 160·sat .5·bright .52) ② Background: `themeCache()` 픽셀 연산(표준 hue-rotate 행렬→saturate→brightness)을 sky·ground 로드 시 1회 굽기, silhouette는 기존 filterCache 결과 위에 이어 굽기. groundImage getter는 LayerSource 반환(지형 렌더러 canvas 호환) ③ `setEndless(mapKey, round?)` — Game.tsx에서 season?.round 전달(edu/route는 원본 유지) ④ 검증: /api/season 응답 가로채 round 1~4 강제, 인게임 4테마 스크린샷 + rAF FPS 프로브 전 라운드 ≈60(ctx.filter 미사용, 프레임 비용 0). ⚠️ E3.30 워드마크 이후 로비 버튼 탐색은 textContent "랭킹전"/"조작 연습" 기준(타이틀은 이미지)
- ✅ **E6**(2026-07-30): 오픈 전 QA·밸런싱 패스 — ① 입력 방어: visibilitychange 숨김/blur 시 포인터 맵 초기화+endSlide(슬라이드 홀드 잔류 방지), 게임 영역 contextmenu 차단 + non-passive touchmove preventDefault(iOS 구웹킷 2차 방어), globals에 -webkit-touch-callout:none ② 밸런싱: .simtest/balance.ts 봇 sim(반응 170~300ms·실수 7%·프레임 감시 회피 — **투척물 targetX는 스크롤 이동값이라 착지 시점 위치로 판정해야 함**, 감지 시점 판정은 봇 결함). 40시드: 원본 평균 56.2s → 조정 후 75.7s(중앙 70.9, p25 58.4, p75 93.6). 변경: SPEED.MAX 620→560·ACCEL 4→3, SPAWN.OBSTACLE 1100~2000→1400~2400ms, PROJECTILE EARLY 6.5→8s·LATE 3.2→4.5s·RAMP 60→90s, CHASE.RECOVER 18→22. 클리어런스 게이트 PASS ③ 로깅: lib/analytics.ts logEvent(sendBeacon→fetch keepalive) + /api/log 204 스텁 — play_start(edu/endless/restart)·play_end·ticket_spend·edu_complete(최초만)·ranking_view ④ /api/season POST: playDuration 필수 + score ≤ dur×SEASON.MAX_SCORE_PER_SEC(130)+BUFFER(200) 검증(reason "score_cap", 밸런스 변경 시 상한 재계산 주석). postSeasonScore가 playDuration 전송
- ✅ **E6-QA 후속**(2026-07-30): 대사 말풍선을 화자 머리 위로 — 상단 중앙 고정 DOM(DialogueBubble)이 안내 배너(SectionBanner)와 겹치던 문제. 엔진 `drawDialogue()`가 "박소장:/김반장:" 프리픽스로 화자 판별(프리픽스 떼고 표시), 박소장=bossFootX·지형 반영, 김반장=점프 높이 반영해 캔버스에 직접 렌더(꼬리 포함, 화면 클램프, 페이드 인 120ms/아웃 200ms, 잡힘 연출 중 숨김). say()에 dialogueMs 기록. DOM DialogueBubble 컴포넌트 제거, hud.dialogue 필드는 유지
- ✅ **E6-QA2**(2026-07-30): ① 말풍선 확대(13px/27h→16px/36h, 패딩·꼬리 비례) ② 슬라이드 리워크 — `slideHeld` 도입: 공중에서 슬라이드 입력 시 급강하+**착지 즉시 슬라이드 진입(입력 버퍼)**, 홀드 중 무기한 유지(SLIDE.DURATION_MS 900 자동 기립 폐지 → MIN_MS 450 최소 유지로 대체 — 짧은 아래 스와이프도 lowbar 통과 보장), 점프가 홀드보다 우선(착지 재진입 방지). .simtest/slide.ts 4시나리오 PASS(공중버퍼/홀드유지/최소유지/점프우선), 밸런스 sim 회귀 없음(78.5s)
- ▶ **다음: E3.7 잔여 · 운영 오픈 준비(EVENT_START 교체)
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
- **압축 규칙(2026-07-16 화질 사고 후 확정): PNG 256색 양자화 금지** — 그라데이션 밴딩·그레인으로 체감 화질 급락. 대형 에셋(캐릭터 프레임·배경 레이어)은 **WebP q95**(시각 무손실, `tools/asset_intake/` 스크립트가 자동 적용), 소형 오브젝트는 PNG 원본 유지
- slide.png→slide.webp는 구 커스텀 포즈(가로형) 고정 — AI 앉은 포즈는 축소돼 보여 롤백(E3.7-3). 재반입 시 덮어쓰지 말 것 (`build_chars.py`가 덮어쓰므로 실행 후 `git show`로 복원 필요)
- 김반장 러닝은 v2 시트(2026-07-21, `sheet_gimbanjang_run_v2.png` 6프레임·2배 해상도) — 구 세트와 크기 정합 위해 사전 정규화(V2_PRE) 적용됨
- 박소장 러닝도 v2 시트(`sheet_parksojang_run_v2.png` **8프레임**) — 구 세트(투척·idle) 대비 7% 사전 정규화(PARK_V2_PRE) + **베이크된 접지 그림자 제거**(`strip_ground_shadow`, 발선 정렬 왜곡 방지). 캐릭터 시트 반입 시 그림자 유무 확인할 것
- `build_chars.py`는 main() 가드 있음(import 시 빌드 미실행). 실행하면 slide를 AI 포즈로 덮어쓰므로 직후 `git show HEAD:...slide.webp`로 원복 필수
- 헤드리스 스크린샷 하니스는 webp 미지원(node-canvas) → scratchpad shadow PNG 변환 경유
