export type GamePhase = "ready" | "playing" | "gameover";

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

export type ObstacleKind = "puddle" | "stack" | "lowbar"; // 웅덩이 / 자재더미 / 낮은통과형(슬라이드)
export type ProjectileKind = "papers" | "tube" | "megaphone"; // 서류뭉치 / 도면 통 / 확성기
export type ItemKind = "coffee" | "booster"; // 다방커피(감속) / 퇴근길 부스터(무적)

export interface GameResult {
  userId: string;
  coinCount: number;
  rankScore: number;
  playDuration: number; // seconds
  timestamp: number; // epoch ms
}

// 엔진 → UI 로 전달되는 실시간 스냅샷
export interface HudState {
  phase: GamePhase;
  coins: number;
  score: number;
  hp: number;
  boosterActive: boolean;
  slowActive: boolean; // 피격 감속(WP1). 이전 coffeeActive 대체
  gap: number; // 박소장 추격 거리(px, WP2)
  chaseRatio: number; // gap / MAX_GAP (0=붙잡히기 직전, 1=안전)
  dialogue: string | null;
}
