// 게임 전역 상수 및 밸런스 값. 모바일 가로 고정 논리 해상도 기준(WP0).

export const VIEW = {
  W: 800,
  H: 450,
  GROUND_H: 110, // 바닥(현장 지면) 높이
} as const;

export const GROUND_Y = VIEW.H - VIEW.GROUND_H; // 캐릭터가 서는 지면의 y (=340)

export const PHYSICS = {
  GRAVITY: 2400, // px/s^2
  // E3.6-1: 점프 상한 재조정 — 60fps 오일러 실측 기준 1단 ≈130px, 정점 2단 누적 ≈213px(HUD 아래).
  // (해석값보다 이산 적분이 ~7px 낮게 나와 실측 기준으로 보정)
  // 회피 검증: stack(68)·airbar(slot2=81 중심)·하단 투척(≤40+18) 모두 1단(130)으로 회피 가능.
  JUMP_V: 810, // 1단 점프 초기 상승 속도
  DOUBLE_JUMP_V: 650, // 2단 점프 초기 상승 속도
  FALL_GRAVITY_MULT: 1.3, // 하강 중력 배율 — 낙하 가속(붕 뜨는 느낌 제거)
  MAX_FALL: 1600,
} as const;

export const SPEED = {
  BASE: 300, // 월드 스크롤 기본 속도 px/s
  MAX: 560, // E6-2: 620→560 — 후반 반응 시간 확보
  ACCEL: 3, // E6-2: 4→3 — 시간당 가속 (px/s per s)
  SLOW_FACTOR: 0.55, // 다방커피/충돌 시 감속 배율
  SLOW_MS: 1500, // 감속 지속 시간
} as const;

export const PLAYER = {
  // E3.5: 추격 시각화 — 박소장(gap 200~280)이 왼쪽 화면 안에 보이도록 우측 배치.
  // 시야 감소분은 WARNING_MS·스폰 간격으로 보정.
  X: 300,
  W: 52, // 화면 키 126px 캐릭터에 맞춘 히트박스(시각 대비 살짝 관대)
  H: 96,
  MAX_HP: 3,
  HIT_INVULN_MS: 1200, // 피격 후 무적(깜빡임) 시간
} as const;

export const SPAWN = {
  // E3.5: 전방 시야 감소(−132px) 보정 — 스폰 간격 확대
  OBSTACLE_MIN_MS: 1400, // E6-2: 1100→1400
  OBSTACLE_MAX_MS: 2400, // E6-2: 2000→2400
  // E3.16-3: 코인 밀도 증가(700~1500 → 500~1100). 상대 순위 게임이라 점수 인플레 무해
  COIN_MIN_MS: 500,
  COIN_MAX_MS: 1100,
  // E3.7-8: 절차 스폰 코인 최대 높이(px, 지면 기준 중심) — 1단 점프 도달권(머리 ~226px) 내
  COIN_MAX_H: 160,
  // E3.9-4: 장애물 최소 스폰 간격(초) — 속도와 무관하게 시간 기준(거리 = 속도×0.7s)
  OBSTACLE_MIN_INTERVAL_S: 0.7,
  // E3.9-5: fence(2단층)는 엔들리스 중반부터
  FENCE_FROM_S: 35,
  // E3.10-5: 코인 줄-장애물 수평 최소 간격(px) — 스폰 시 상호 배제로 보장
  COIN_OBSTACLE_GAP: 140,
  ITEM_MIN_MS: 9000, // 특수 아이템 등장 주기
  ITEM_MAX_MS: 16000,
} as const;

// 3단계: 박소장 투척 밸런스.
// E3.8-1: 직선 투척(상·하 HIGH/LOW) 폐지 → 낙하 지점 방식.
// 포물선으로 화면 위를 넘어가 전방 지면에 낙하 — 마커(그림자+'!')가 1.5~2초 선행.
// 슬라이드 위협은 lowbar·obs_air가 담당.
export const PROJECTILE = {
  GRACE_MS: 4000, // 시작 직후 이 시간 동안은 투척 없음(온보딩)
  GAP_EARLY_MS: 8000, // E6-2: 6500→8000 — 초반 평균 투척 간격
  GAP_LATE_MS: 4500, // E6-2: 3200→4500 — 후반(램프 최대) 평균 투척 간격
  RAMP_SEC: 90, // E6-2: 60→90 — 이 시간에 걸쳐 EARLY→LATE 로 간격이 좁아짐
  GAP_JITTER: 0.22, // 평균 간격 대비 ±비율 무작위
  RETRY_MS: 300, // 착지 지점이 장애물·구멍과 겹칠 때 미루고 재시도하는 간격
  DROP_LEAD_MIN_S: 1.5, // 마커 표시 → 낙하 최소 선행 시간
  DROP_LEAD_MAX_S: 2.0,
  DROP_EDU_LEAD_S: 2.0, // 교육은 항상 최대 여유
  DROP_IMPACT_MS: 120, // 낙하 순간 판정 창(±) — 이때 그 지점에 있으면 피격
  DROP_DEBRIS_MS: 300, // 낙하 후 파편 이펙트 지속(후 소멸)
  DROP_ARC_H: 640, // 포물선 보정 높이 — 정점이 화면 위로 넘어감
  DOUBLE_CHANCE_MAX: 0.35, // 램프 최대에서 2연속 낙하 확률(엔들리스 전용)
  DOUBLE_GAP_PX: 150, // 2연속 낙하 지점 간격
} as const;

// E3.9-2: 장애물 3계층 기하 표(px, cell 54 기준).
// w×h = 렌더 목표 박스(스프라이트는 알파 트림 후 종횡비 유지로 그려짐 — puddle만 폭 기준).
// hitW/hitH = 충돌 박스 — 높이는 박스의 85%(관대), 폭은 실제 그려지는 폭 기준 85%
// (종횡비 유지 시 시각 폭 < 박스 폭인 sign·cone은 시각 기준 — 보이지 않는 가장자리 피격 방지).
// 계층: 1단층(hitH+10을 1단 점프로 클리어) / 2단층(fence, 2단 점프 필요) / 슬라이드층(lowbar).
export const OBSTACLE_RENDER = {
  puddle: { w: 90, h: 14, hitW: 76, hitH: 12 }, // 1단층(평면 해저드 — 지상에서만 피격)
  stack: { w: 60, h: 60, hitW: 48, hitH: 51 }, // 1단층
  cone: { w: 55, h: 58, hitW: 37, hitH: 49 }, // 1단층
  sign: { w: 60, h: 60, hitW: 29, hitH: 51 }, // 1단층(시각 폭 34 — 세로 표지판)
  fence: { w: 50, h: 105, hitW: 42, hitH: 89 }, // 2단층(prop_fence_panel 사용)
} as const;

// E3.9-2 슬라이드층: lowbar 하단 통과 틈(슬라이드 높이 48 + 여유 4)
export const LOWBAR_GAP = 52;

// WP3 슬라이드. 홀드 동안 히트박스를 낮춰 상단 투척·낮은 통과형(lowbar) 회피.
// E6-QA2: 홀드 중 무기한 유지(900ms 자동 기립 폐지 — 지상 장애물은 슬라이드로 회피 불가라 무한 슬라이드가 우위 전략이 아님).
export const SLIDE = {
  MIN_MS: 450, // 최소 유지 — 아래 스와이프(짧은 터치)로도 lowbar 통과 가능한 하한
  HITBOX_SCALE: 0.5, // 슬라이드 중 히트박스 높이 배율
} as const;

// 5.3 박소장 추격 시스템. gap(px) 0이면 붙잡힘(게임오버).
// 튜닝: 상한을 낮춰 박소장이 항상 화면 안쪽에 붙어 있고, 피격 시 크게 좁혀진다.
export const CHASE = {
  // E3.5: PLAYER.X(300)와 함께 재조정 — 안전=화면 왼쪽 멀찍이(발중심 326-280=46),
  // gap이 줄수록 실제로 다가오는 게 보임(클램프는 극단에서만).
  START_GAP: 200, // 시작 추격 거리
  MAX_GAP: 280, // 회복 상한
  RECOVER_PER_SEC: 22, // E6-2: 18→22 — 안 맞고 달릴 때 초당 회복
  // 붙잡힘은 실패 판정 우선순위(gap 우선, GameEngine 실패 체크)로 성립한다 —
  // 마지막 피격에서 hp·gap이 동시 소진되는 케이스가 대부분이라 gap을 먼저 봐야
  // "박소장에게 붙잡혔습니다"가 실제로 뜬다. (135로 올리면 hp 사망이 소멸해 과함)
  HIT_LOSS: 110, // 피격 시 크게 감소 → 즉각적 위협
  SLOW_RECOVER_FACTOR: 0.5, // 감속 중 회복 배율(상대 접근 체감)
  BOOST_RECOVER_FACTOR: 2, // 부스터 중 회복 가속
} as const;

// E3 안전교육(edu) 관용 룰 — 실패 없이 완주 유도
export const EDU = {
  MIN_GAP: 14, // gap 실패 비활성: 잡히기 직전에서 클램프(압박 체험만)
  THROW_FROM: 0.49, // 투척은 구간4(진행도, col 161/330)부터
  SLOW_FACTOR: 0.7, // 신규 요소 직전 일시 감속 배율
  SLOW_MS: 2000, // 감속 지속
  BANNER_MS: 2000, // 구간 안내 배너 표시 시간
  GRAB_RECOVER: 60, // E3.6-2: 헛손질(봐주기) 후 gap 소폭 회복(px)
  GRAB_MERCY: 2, // E3.6-2 수정: 봐주기 횟수 — 소진 후 gap 0 도달 시 진짜 잡힘(교육 실패)
  GRAB_BEAT_MS: 320, // 봐주기 반응 비트(정지→재가속·휘청·플래시) 지속
  GRAB_BEAT_FLOOR: 0.06, // 비트 시작 속도 배율(거의 정지) — 제곱 곡선으로 1.0까지 재가속
} as const;

// E4 주간 시즌 — 이벤트 시작일(KST 월요일) 기준 7일 단위 4라운드. 운영 일정 확정 시 교체.
export const SEASON = {
  // KST 시작일 — 라운드는 이 날짜부터 7일 단위(요일 무관 동작하지만 기획은 월~일 주간).
  // 2026-07-31(금) 오픈 지시로 금요일 시작 — 라운드가 금~목 주기가 됨. 정식 리런칭 시 월요일로 재설정 권장.
  EVENT_START: "2026-07-31",
  ROUNDS: 4,
  TOP_N: 50, // 랭킹 조회 상위 노출 수
  // E6-4: 어뷰징 상한 — 초당 이론 최대 획득 점수.
  // 거리 SPEED.MAX(560)/DISTANCE_DIVISOR(10) = 56/s + 코인 최악(줄 3개·최소 간격 0.5s, 자석) 6개/s×10 = 60/s
  // → 이론 116/s, 마진 포함 130/s. SPEED·SPAWN.COIN·COIN_VALUE 밸런스 변경 시 재계산할 것.
  MAX_SCORE_PER_SEC: 130,
  SCORE_CAP_BUFFER: 200, // 시작 직후 커피 대체 코인 등 고정 오차 허용
} as const;

// E3.34: 출석 보상 — 7일 주기, 7일차는 3장(리텐션 스파이크). 지급 권위는 네이티브(웹은 요청+표시).
export const ATTENDANCE = {
  CYCLE: 7,
  REWARDS: [1, 1, 1, 1, 1, 1, 3], // 일차별 티켓 수(index = dayIndex - 1)
} as const;

// E4-5 보상 정책 세이프 모드(법적 검토 반영): true면 성적 연동 포인트 표시·포인트 교환을 숨긴다.
// 법무 결론에 따라 false로 되돌리면 기존 동작(예상 포인트 표시·포인트 교환 버튼) 복귀.
export const REWARD_SAFE_MODE = true;

// E5: 라운드(주차)별 엔들리스 배경 팔레트 스왑(기획 5.1) — 에셋 추가 없이 매주 배경 변주.
// 원본 아트가 석양 톤이라 2주차가 원본. hue: 색상 회전(deg), 이후 saturate → brightness 순 적용.
// 렌더는 로드 시 오프스크린 캔버스에 1회 굽는 캐시 방식 — 프레임 비용 0(ctx.filter 미사용).
export interface RoundTheme {
  name: string;
  hue: number; // hue-rotate (deg)
  saturate: number; // 1 = 원본
  brightness: number; // 1 = 원본
}
export const ROUND_THEMES: RoundTheme[] = [
  { name: "day", hue: -6, saturate: 0.78, brightness: 1.22 }, // 1주차: 낮(볕에 바랜 톤)
  { name: "sunset", hue: 0, saturate: 1, brightness: 1 }, // 2주차: 석양(원본)
  { name: "dusk", hue: -48, saturate: 1.02, brightness: 0.78 }, // 3주차: 황혼(자주 기움 — 양수는 올리브가 됨)
  { name: "night", hue: 160, saturate: 0.5, brightness: 0.52 }, // 4주차: 야간(청색)
];
export function themeForRound(round: number): RoundTheme {
  return ROUND_THEMES[Math.max(0, Math.min(ROUND_THEMES.length - 1, round - 1))];
}

// WP6 노선(스테이지) 진행
export const ROUTE = {
  FINALE_START: 0.75, // 피날레 돌진 시작(진행도)
  FINALE_END: 0.95, // 돌진 해제 — 정류장 진입
  FINALE_DRAIN: 22, // 돌진 중 gap 초당 감소(회복 상쇄+압박)
  INDEX_SPEED_STEP: 0.06, // 노선 index당 투척 간격 단축 비율
} as const;

export const ITEM_EFFECT = {
  BOOSTER_MS: 5000, // 퇴근길 부스터 무적 지속
  MAGNET_MS: 5000, // 자석: 코인 흡인 지속
  MAGNET_RADIUS: 150, // 자석 흡인 반경(px)
  COFFEE_HEAL: 1, // 다방커피: 안전모(HP) 회복량 (기획 5.6)
  COFFEE_FULL_COINS: 3, // HP 최대일 때 커피 대체 지급 코인
} as const;

export const SCORE = {
  COIN_VALUE: 10, // 코인 1개당 랭킹 점수
  DISTANCE_DIVISOR: 10, // 이동거리 → 점수 환산 (px → m 환산에도 사용)
} as const;

// WP6.5 노선 메타(로비 표시·배경 매핑). 데이터는 public/levels/<id>.json.
// 맵 배경 아트가 2종뿐이라 3~5노선은 재사용(전용 아트 확보 시 교체).
export const ROUTES = [
  { id: "route1", index: 1, name: "도심 재건축", mapKey: "map1" },
  { id: "route2", index: 2, name: "아파트 골조", mapKey: "map2" },
  { id: "route3", index: 3, name: "지방 산업단지", mapKey: "map1" },
  { id: "route4", index: 4, name: "야간 현장", mapKey: "map2" },
  { id: "route5", index: 5, name: "지하 터널", mapKey: "map2" },
] as const;

// 코믹 대사 (5단계). 실제 브랜드명 미사용, 가상의 현장 인물.
// 표시 ~2초 후 자동 소멸, 랜덤 노출(연속 중복 금지)
export const DIALOGUE_MS = 2000;
export const DIALOGUE = {
  throw: [
    "박소장: 김반장!! 서류 어딨어!!",
    "박소장: 야리끼리 아직도야?!",
    "박소장: 도면 다시 그려와!",
    "박소장: 퇴근은 무슨 퇴근!",
    "박소장: 안전교육 다시 받아!!",
    "박소장: 일지 안 쓰고 어딜 가!",
    "박소장: 내일 조출이야!!",
  ],
  hit: [
    "김반장: 으악, 내 안전모!",
    "김반장: 아이고 허리야...",
    "김반장: 이게 다 야리끼리 때문이여...",
    "김반장: 어이쿠야!!",
    "김반장: 무릎이야 무릎!!",
  ],
  booster: ["김반장: 정시 퇴근 가즈아!!", "김반장: 못 잡는다 못 잡아~!"],
  coffee: ["김반장: 각성! 다시 뛰자!", "김반장: 커피 한 방에 기력 회복!"],
  gameover: [
    "박소장: 내일 아침 일찍 나와.",
    "김반장: ...네, 소장님.",
  ],
} as const;
