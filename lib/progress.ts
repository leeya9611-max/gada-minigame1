// 누적 주행거리(m) — 맵 해금 조건(WP6). 클라이언트 표시·해금용 로컬 저장.

const KEY = "yarikkiri.totalMeters";

export function loadTotalMeters(): number {
  if (typeof window === "undefined") return 0;
  const n = Number(window.localStorage.getItem(KEY));
  return Number.isFinite(n) && n > 0 ? n : 0;
}

export function addMeters(m: number): number {
  const total = loadTotalMeters() + Math.max(0, Math.round(m));
  if (typeof window !== "undefined") {
    window.localStorage.setItem(KEY, String(total));
  }
  return total;
}
