// E3.34: 출석 보상 클라이언트 — 조회/수령 + 로컬 캐시(오늘 수령 여부).
// 네트워크 실패는 조용히 null — 출석 때문에 로비 진입이 막히면 안 된다.

const KEY_LAST = "yarikkiri.attendance.lastClaim"; // "YYYY-MM-DD"(KST)

export interface AttendanceState {
  dayIndex: number;
  claimedToday: boolean;
  rewards: number[];
}

function kstToday(): string {
  return new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10);
}

// 로컬 캐시 기준 오늘 수령 여부(서버 조회 전 팝업 억제용)
export function claimedTodayLocal(): boolean {
  if (typeof window === "undefined") return true;
  try {
    return window.localStorage.getItem(KEY_LAST) === kstToday();
  } catch {
    return true;
  }
}

export function markClaimedToday(): void {
  try {
    window.localStorage.setItem(KEY_LAST, kstToday());
  } catch {
    /* 무시 */
  }
}

export async function fetchAttendance(userId: string): Promise<AttendanceState | null> {
  try {
    const res = await fetch(`/api/attendance?userId=${encodeURIComponent(userId)}`);
    if (!res.ok) return null;
    const d = (await res.json()) as AttendanceState & { degraded?: boolean };
    if (d.degraded) return null; // 서버 테이블 미준비 — 조용히 기능 비활성
    return d;
  } catch {
    return null;
  }
}

export async function postAttendance(
  userId: string
): Promise<{ ok: boolean; dayIndex?: number; reward?: number } | null> {
  try {
    const res = await fetch("/api/attendance", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId }),
    });
    if (!res.ok) return null;
    return (await res.json()) as { ok: boolean; dayIndex?: number; reward?: number };
  } catch {
    return null;
  }
}
