// 노선(스테이지) 데이터 — public/map-editor.html 저장 JSON과 동일 포맷 (WP6).
// 좌표 규약(에디터와 일치): col×cellSize=월드 x, 지형 단차 30px/단(up +1, down -1, h -1~3),
// air 오브젝트 y = 지면 - slot*30 - 21, ground 오브젝트는 지면 위.

export type TerrainCell = "flat" | "up" | "down" | "gap";

export type LevelObjectType =
  | "obs_low" // 시멘트 웅덩이(점프)
  | "obs_high" // 자재 더미(점프)
  | "obs_air" // 공중 장애물(슬라이드/타이밍)
  | "obs_fall" // 낙하물(경고 후 낙하)
  | "coin"
  | "heart" // HP 회복
  | "coffee" // HP 회복(다방커피)
  | "dash" // 퇴근길 부스터
  | "magnet"; // 코인 자석

export interface LevelObject {
  col: number;
  slot: number; // ground형=0, air형=1~3
  type: LevelObjectType;
}

// E3: 구간 안내 마커 — 통과 시 상단 배너(2초) + 신규 요소 직전 일시 감속
export interface LevelMarker {
  col: number;
  text: string;
}

export interface LevelData {
  id: string;
  name: string;
  index: number; // 1~5, 난이도 스케일 (안전교육은 0)
  cols: number;
  cellSize: number;
  baseSpeed: number;
  speedRamp: number; // 초당 가속(px/s²에 준하는 에디터 값)
  terrain: TerrainCell[];
  objects: LevelObject[];
  markers?: LevelMarker[];
}

export const ROUTE_IDS = ["route1", "route2", "route3", "route4", "route5"] as const;
export type RouteId = (typeof ROUTE_IDS)[number];

// E3: 안전교육 전용 노선
export const EDU_ROUTE_ID = "route_edu" as const;
export type LevelId = RouteId | typeof EDU_ROUTE_ID;

export const STEP_PX = 30; // 지형 1단 높이(에디터 HSLOT)
export const SLOT_PX = 30; // air 슬롯 간격
export const SLOT_BASE = 21; // HSLOT*0.7 — slot 오프셋 기저

export async function loadLevel(id: LevelId): Promise<LevelData> {
  const res = await fetch(`/levels/${id}.json`);
  if (!res.ok) throw new Error(`level load failed: ${id}`);
  return (await res.json()) as LevelData;
}

// 에디터 groundInfo()와 동일한 지형 프로파일: col별 단(h)·구멍 여부
export interface GroundCol {
  h: number; // 0=기준, 양수=위(오르막 누적)
  gap: boolean;
}

export function buildGroundProfile(level: LevelData): GroundCol[] {
  let h = 0;
  const out: GroundCol[] = [];
  for (let c = 0; c < level.cols; c++) {
    const t = level.terrain[c] ?? "flat";
    if (t === "up") h = Math.min(3, h + 1);
    else if (t === "down") h = Math.max(-1, h - 1);
    out.push({ h, gap: t === "gap" });
  }
  return out;
}

// 노선 전체 길이(px)
export function levelLength(level: LevelData): number {
  return level.cols * level.cellSize;
}

// 별점용: 노선 내 코인 총 개수
export function countCoins(level: LevelData): number {
  return level.objects.filter((o) => o.type === "coin").length;
}
