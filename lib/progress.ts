// 진행 저장 (WP6.5): 노선별 별점·최고기록 + 누적 주행거리. localStorage.

const KEY_METERS = "yarikkiri.totalMeters";
const KEY_ROUTES = "yarikkiri.routes";

// ── 누적 주행거리(m) ──
export function loadTotalMeters(): number {
  if (typeof window === "undefined") return 0;
  const n = Number(window.localStorage.getItem(KEY_METERS));
  return Number.isFinite(n) && n > 0 ? n : 0;
}

export function addMeters(m: number): number {
  const total = loadTotalMeters() + Math.max(0, Math.round(m));
  if (typeof window !== "undefined") {
    window.localStorage.setItem(KEY_METERS, String(total));
  }
  return total;
}

// ── 안전교육 이수 (E2 → E7-1 서버 이관) ──
// localStorage는 즉시 응답용 캐시, 서버(users.edu_done, userId 권위)가 원본.
// 서버 실패 시 캐시 값 유지 — 게이트가 막혀 플레이 못 하는 상황을 만들지 않는다.
const KEY_EDU = "yarikkiri.eduDone";

export function loadEduDone(): boolean {
  if (typeof window === "undefined") return false;
  return window.localStorage.getItem(KEY_EDU) === "1";
}

export function saveEduDone(): void {
  if (typeof window !== "undefined") {
    window.localStorage.setItem(KEY_EDU, "1");
  }
}

// 서버 조회 — 실패 시 null(호출부는 캐시 유지)
export async function fetchEduDone(userId: string): Promise<boolean | null> {
  try {
    const res = await fetch(`/api/progress?userId=${encodeURIComponent(userId)}`);
    if (!res.ok) return null;
    const data = (await res.json()) as { eduDone?: boolean };
    return data.eduDone === true;
  } catch {
    return null;
  }
}

// 서버 기록 — 실패해도 게임 흐름에 영향 없음(다음 동기화에서 재시도됨)
export async function postEduDone(userId: string): Promise<void> {
  try {
    await fetch("/api/progress", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId }),
      keepalive: true,
    });
  } catch {
    /* 무시 */
  }
}

// ── 노선별 진행(별점·기록) ──
export interface RouteRecord {
  stars: number; // 0~3 최고 별점
  bestTimeSec: number | null; // 최단 클리어 타임
  bestCoins: number;
}

export type RouteProgress = Record<string, RouteRecord>;

export function loadRouteProgress(): RouteProgress {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(KEY_ROUTES);
    return raw ? (JSON.parse(raw) as RouteProgress) : {};
  } catch {
    return {};
  }
}

// 클리어 결과를 최고 기록으로 병합 저장
export function saveRouteResult(
  routeId: string,
  stars: number,
  timeSec: number,
  coins: number
): RouteProgress {
  const all = loadRouteProgress();
  const prev = all[routeId];
  all[routeId] = {
    stars: Math.max(prev?.stars ?? 0, stars),
    bestTimeSec:
      prev?.bestTimeSec != null ? Math.min(prev.bestTimeSec, timeSec) : timeSec,
    bestCoins: Math.max(prev?.bestCoins ?? 0, coins),
  };
  if (typeof window !== "undefined") {
    window.localStorage.setItem(KEY_ROUTES, JSON.stringify(all));
  }
  return all;
}

// 해금: 1노선은 항상, 이후는 이전 노선 ★ 이상 클리어 시 (기획 5.2.1)
export function isRouteUnlocked(index: number, progress: RouteProgress): boolean {
  if (index <= 1) return true;
  return (progress[`route${index - 1}`]?.stars ?? 0) >= 1;
}

// 별점 (기획 5.2.1): ★완주 / ★★무피격 or 코인 70% / ★★★무피격+코인 전부
export function computeStars(
  hits: number,
  coins: number,
  totalCoins: number
): number {
  const coinGoal2 = Math.ceil(totalCoins * 0.7);
  const star3 = hits === 0 && totalCoins > 0 && coins >= totalCoins;
  const star2 = hits === 0 || (totalCoins > 0 && coins >= coinGoal2);
  return star3 ? 3 : star2 ? 2 : 1;
}
