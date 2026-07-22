export type GamePhase = "ready" | "playing" | "cleared" | "gameover";

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

// cone/sign: E3.8-2에서 소품 → 정식 장애물 승격(낮은 빈도 스폰)
// fence: E3.9-2 신규 2단층(2단 점프 필요, prop_fence_panel)
export type ObstacleKind = "puddle" | "stack" | "lowbar" | "airbar" | "cone" | "sign" | "fence";
// 웅덩이 / 자재더미 / 낮은통과형(슬라이드) / 공중 장애물(노선 데이터 obs_air)
export type ProjectileKind = "papers" | "tube" | "megaphone"; // 서류뭉치 / 도면 통 / 확성기
export type ItemKind = "coffee" | "heart" | "booster" | "magnet";
// 커피(HP회복) / 하트(HP회복) / 부스터(무적) / 자석(코인 흡인)

// 플레이 종료 사유: 완주 / 붙잡힘 / 안전모 소진
// giveup: 일시정지 → 포기(E3.10-2). 엔들리스는 현재 기록으로 정상 종료·결과 전달.
export type Outcome = "cleared" | "caught" | "hp" | "giveup";

// 플레이 모드 (E1): 노선 재생 / 엔들리스 무한 잔업(랭킹 본선) / 안전교육(E3)
export type GameMode = "route" | "endless" | "edu";

export interface GameResult {
  userId: string;
  coinCount: number;
  rankScore: number;
  playDuration: number; // seconds
  timestamp: number; // epoch ms
  mode: GameMode; // E1: 랭킹은 endless만 집계
  // WP6 노선 결과
  outcome: Outcome;
  routeId: string; // 엔들리스는 "endless"
  hits: number; // 피격 횟수 (별점: 무피격 판정)
  totalCoins: number; // 노선 내 코인 총수 (별점: 목표)
}

// 엔진 → UI 로 전달되는 실시간 스냅샷
export interface HudState {
  phase: GamePhase;
  mode: GameMode; // E3.5: edu에선 위기 연출·위험 표시를 끔
  coins: number;
  score: number;
  hp: number;
  boosterActive: boolean;
  slowActive: boolean; // 피격 감속(WP1). 이전 coffeeActive 대체
  magnetActive: boolean; // 자석(WP6)
  gap: number; // 박소장 추격 거리(px, WP2)
  chaseRatio: number; // gap / MAX_GAP (0=붙잡히기 직전, 1=안전)
  progress: number; // 정류장까지 진행도 0~1 (WP6)
  finale: boolean; // 피날레 돌진 구간(75~95%)
  banner: string | null; // 안전교육 구간 안내 배너 (E3)
  dialogue: string | null;
}
