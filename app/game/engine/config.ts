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
  X: 84,
  W: 42,
  H: 58,
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
  LOW_MIN: 8, // 하단(점프로 피함) 높이 범위
  LOW_MAX: 42,
  // 상단: 서 있는 상체 높이. 서있거나 점프하면 피격, 슬라이드로만 숙여 회피(기획 5.7)
  HIGH_MIN: 52,
  HIGH_MAX: 72,
} as const;

// WP3 슬라이드. 홀드 동안 히트박스를 낮춰 상단 투척·낮은 통과형(lowbar) 회피.
export const SLIDE = {
  DURATION_MS: 900, // 최대 지속(이후 자동 기립)
  HITBOX_SCALE: 0.5, // 슬라이드 중 히트박스 높이 배율
} as const;

// 5.3 박소장 추격 시스템. gap(px) 0이면 붙잡힘(게임오버).
export const CHASE = {
  START_GAP: 180, // 시작 추격 거리
  MAX_GAP: 260, // 안전 주행으로 회복 가능한 상한
  RECOVER_PER_SEC: 25, // 안 맞고 달릴 때 초당 회복
  HIT_LOSS: 70, // 피격 시 감소
  SLOW_RECOVER_FACTOR: 0.5, // 감속 중 회복 배율(상대 접근 체감)
  BOOST_RECOVER_FACTOR: 2, // 부스터 중 회복 가속
} as const;

export const ITEM_EFFECT = {
  BOOSTER_MS: 5000, // 퇴근길 부스터 무적 지속
  COFFEE_HEAL: 1, // 다방커피: 안전모(HP) 회복량 (기획 5.6)
  COFFEE_FULL_COINS: 3, // HP 최대일 때 커피 대체 지급 코인
} as const;

export const SCORE = {
  COIN_VALUE: 10, // 코인 1개당 랭킹 점수
  DISTANCE_DIVISOR: 10, // 이동거리 → 점수 환산
} as const;

// 코믹 대사 (5단계). 실제 브랜드명 미사용, 가상의 현장 인물.
export const DIALOGUE = {
  throw: [
    "박소장: 김반장!! 서류 어딨어!!",
    "박소장: 야리끼리 아직도야?!",
    "박소장: 도면 다시 그려와!",
    "박소장: 퇴근은 무슨 퇴근!",
  ],
  hit: [
    "김반장: 으악, 내 안전모!",
    "김반장: 아이고 허리야...",
    "김반장: 이게 다 야리끼리 때문이여...",
  ],
  booster: ["김반장: 정시 퇴근 가즈아!!"],
  coffee: ["김반장: 각성! 다시 뛰자!"],
  gameover: [
    "박소장: 내일 아침 일찍 나와.",
    "김반장: ...네, 소장님.",
  ],
} as const;
