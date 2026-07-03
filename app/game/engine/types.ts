export type GamePhase = "ready" | "playing" | "gameover";

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

export type ObstacleKind = "puddle" | "stack"; // 시멘트 웅덩이 / 자재 더미
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
  coffeeActive: boolean;
  dialogue: string | null;
}
