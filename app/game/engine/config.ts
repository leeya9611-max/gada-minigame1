// 게임 전역 상수 및 밸런스 값. 모바일 가로 고정 논리 해상도 기준(WP0).

export const VIEW = {
  W: 800,
  H: 450,
  GROUND_H: 110, // 바닥(현장 지면) 높이
} as const;

export const GROUND_Y = VIEW.H - VIEW.GROUND_H; // 캐릭터가 서는 지면의 y (=340)

export const PHYSICS = {
  GRAVITY: 2400, // px/s^2
  JUMP_V: 820, // 1단 점프 초기 상승 속도
  DOUBLE_JUMP_V: 720, // 2단 점프 초기 상승 속도
  MAX_FALL: 1600,
} as const;

export const SPEED = {
  BASE: 300, // 월드 스크롤 기본 속도 px/s
  MAX: 620,
  ACCEL: 4, // 시간당 가속 (px/s per s)
  SLOW_FACTOR: 0.55, // 다방커피/충돌 시 감속 배율
  SLOW_MS: 1500, // 감속 지속 시간
} as const;

export const PLAYER = {
  X: 168, // 발중심 ≈ 화면 폭 24% — 러닝 레인 왼쪽
  W: 52, // 화면 키 126px 캐릭터에 맞춘 히트박스(시각 대비 살짝 관대)
  H: 96,
  MAX_HP: 3,
  HIT_INVULN_MS: 1200, // 피격 후 무적(깜빡임) 시간
} as const;

export const SPAWN = {
  OBSTACLE_MIN_MS: 900,
  OBSTACLE_MAX_MS: 1700,
  COIN_MIN_MS: 700,
  COIN_MAX_MS: 1500,
  ITEM_MIN_MS: 9000, // 특수 아이템 등장 주기
  ITEM_MAX_MS: 16000,
} as const;

// 3단계: 박소장 투척 밸런스
export const PROJECTILE = {
  WARNING_MS: 1600, // 경고 마크 선행 표시(1~2초 규격). 반응 창이 넉넉해야 공정.
  SPEED: 470, // 낮출수록 회피 여유. (기존 520)
  GRACE_MS: 4000, // 시작 직후 이 시간 동안은 투척 없음(온보딩)
  GAP_EARLY_MS: 6500, // 초반 평균 투척 간격
  GAP_LATE_MS: 3200, // 후반(램프 최대) 평균 투척 간격
  RAMP_SEC: 60, // 이 시간에 걸쳐 EARLY→LATE 로 간격이 좁아짐
  GAP_JITTER: 0.22, // 평균 간격 대비 ±비율 무작위
  RETRY_MS: 300, // 상단 투척이 장애물과 겹칠 때 미루고 재시도하는 간격
  BLOCK_AHEAD_PX: 200, // 상단 투척 보류를 판단하는 플레이어 앞 거리(점프 존)
  HIGH_CHANCE: 0.3, // 상단(슬라이드로 회피) 투척 비율
  LOW_MIN: 8, // 하단(점프로 피함) 높이 범위. 슬라이드 높이(48) 미만 유지
  LOW_MAX: 40,
  // 상단: 서 있는 상체 높이(히트박스 96 기준). 슬라이드(48) 위로 통과, 서있으면 피격
  HIGH_MIN: 58,
  HIGH_MAX: 84,
} as const;

// WP3 슬라이드. 홀드 동안 히트박스를 낮춰 상단 투척·낮은 통과형(lowbar) 회피.
export const SLIDE = {
  DURATION_MS: 900, // 최대 지속(이후 자동 기립)
  HITBOX_SCALE: 0.5, // 슬라이드 중 히트박스 높이 배율
} as const;

// 5.3 박소장 추격 시스템. gap(px) 0이면 붙잡힘(게임오버).
// 튜닝: 상한을 낮춰 박소장이 항상 화면 안쪽에 붙어 있고, 피격 시 크게 좁혀진다.
export const CHASE = {
  START_GAP: 170, // 시작 추격 거리
  MAX_GAP: 210, // 회복 상한 — 낮춰서 게이지 만땅·화면 밖 이탈 방지
  RECOVER_PER_SEC: 18, // 안 맞고 달릴 때 초당 회복
  HIT_LOSS: 110, // 피격 시 크게 감소 → 즉각적 위협
  SLOW_RECOVER_FACTOR: 0.5, // 감속 중 회복 배율(상대 접근 체감)
  BOOST_RECOVER_FACTOR: 2, // 부스터 중 회복 가속
} as const;

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
