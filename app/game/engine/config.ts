// 게임 전역 상수 및 밸런스 값. 모바일 세로 고정 논리 해상도 기준.

export const VIEW = {
  W: 450,
  H: 800,
  GROUND_H: 130, // 바닥(현장 지면) 높이
} as const;

export const GROUND_Y = VIEW.H - VIEW.GROUND_H; // 캐릭터가 서는 지면의 y

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
  PROJECTILE_MIN_MS: 4500, // 3단계: 박소장 투척 주기
  PROJECTILE_MAX_MS: 8000,
  ITEM_MIN_MS: 9000, // 특수 아이템 등장 주기
  ITEM_MAX_MS: 16000,
} as const;

export const PROJECTILE = {
  WARNING_MS: 1400, // 경고 마크 선행 표시 시간
  SPEED: 520,
} as const;

export const ITEM_EFFECT = {
  BOOSTER_MS: 5000, // 퇴근길 부스터 무적 지속
  COFFEE_SLOW_MS: 2500, // 다방커피 감속 지속
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
  coffee: ["김반장: 커피 한 잔의 여유... 는 무슨"],
  gameover: [
    "박소장: 내일 아침 일찍 나와.",
    "김반장: ...네, 소장님.",
  ],
} as const;
