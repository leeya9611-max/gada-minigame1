// E6-3: 기본 이벤트 로깅 — /api/log 스텁으로 전송(운영에서 수집기 교체).
// 게임 흐름에 영향 없도록 완전 비동기·실패 무시. 개인정보 없이 이벤트명+속성만.

export type GameEventName =
  | "play_start" // { mode }
  | "play_end" // { mode, outcome, playDuration, score }
  | "ticket_spend" // { left }
  | "edu_complete"
  | "ranking_view"
  | "attendance_claim"; // { dayIndex, reward }

export function logEvent(name: GameEventName, props: Record<string, unknown> = {}): void {
  if (typeof window === "undefined") return;
  const body = JSON.stringify({ name, ...props, ts: Date.now() });
  try {
    // sendBeacon: 페이지 이탈(웹뷰 종료) 중에도 전송 보장
    if (navigator.sendBeacon?.("/api/log", new Blob([body], { type: "application/json" }))) return;
  } catch {
    /* fall through */
  }
  fetch("/api/log", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
    keepalive: true,
  }).catch(() => {});
}
