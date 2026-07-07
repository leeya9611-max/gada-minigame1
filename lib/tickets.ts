// 티켓(입장권) 클라이언트 표시 상태 (기획 5.5, WP5).
// 실제 지급·차감 권위는 네이티브 앱. 여기는 표시 + 개발 스텁용 로컬 유지만.

const KEY = "yarikkiri.tickets";
export const INITIAL_TICKETS = 2;

export function loadTickets(): number {
  if (typeof window === "undefined") return INITIAL_TICKETS;
  const raw = window.localStorage.getItem(KEY);
  const n = raw === null ? NaN : Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : INITIAL_TICKETS;
}

export function saveTickets(n: number): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(KEY, String(Math.max(0, n)));
}

// 플레이 세션 식별자 (결과값 전달용)
export function newSessionId(): string {
  return `s_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}
