import { NextRequest, NextResponse } from "next/server";
import { ATTENDANCE } from "@/app/game/engine/config";
import { getDb } from "@/lib/db";

// E3.34: 출석 보상 API — Supabase(attendance 테이블, README 배포 섹션 SQL 참조).
// 환경변수 미설정 시 메모리 스텁 폴백(로컬 개발·헤드리스 검증).
//
// dayIndex는 "지금까지 받은 횟수(행 수) % CYCLE + 1" — 7일차 다음은 1일차로 순환.
// 하루 1회 제한은 PK(user_id, claim_date) 충돌(23505)이 서버에서 보장(클라이언트 검사 비의존).
//
// GET ?userId=...
//   → 200 { dayIndex, claimedToday, rewards }   dayIndex = 오늘 받을(받은) 칸(1~CYCLE)
//   → 200 { ..., degraded: true }               테이블 미준비 등 — 클라이언트는 기능 비활성
// POST { userId }
//   → 200 { ok: true, dayIndex, reward }        오늘 출석 기록 + 보상 수량
//   → 200 { ok: false, reason: "claimed" }      오늘 이미 수령(PK 충돌)
//   → 200 { ok: false, reason: "invalid" }

const g = globalThis as unknown as { __attendanceStore?: Map<string, Set<string>> };
const store: Map<string, Set<string>> = (g.__attendanceStore ??= new Map());

const KST_MS = 9 * 3600_000;
function kstDate(now = Date.now()): string {
  return new Date(now + KST_MS).toISOString().slice(0, 10);
}

// 순환 일차: 받은 횟수 기반(7일차 다음 = 1일차)
function nextDayIndex(claimCount: number): number {
  return (claimCount % ATTENDANCE.CYCLE) + 1;
}

export async function GET(req: NextRequest) {
  const userId = req.nextUrl.searchParams.get("userId")?.trim();
  const rewards = [...ATTENDANCE.REWARDS];
  if (!userId) return NextResponse.json({ dayIndex: 1, claimedToday: false, rewards });

  const db = getDb();
  if (db) {
    const today = kstDate();
    const [cnt, todayRow] = await Promise.all([
      db.from("attendance").select("claim_date", { count: "exact", head: true }).eq("user_id", userId),
      db.from("attendance").select("claim_date").eq("user_id", userId).eq("claim_date", today).maybeSingle(),
    ]);
    if (cnt.error) {
      // 테이블 미생성 등 — 조용히 기능 비활성(클라이언트는 팝업 생략)
      return NextResponse.json({ dayIndex: 1, claimedToday: false, rewards, degraded: true });
    }
    const count = cnt.count ?? 0;
    const claimedToday = !!todayRow.data;
    const dayIndex = claimedToday ? nextDayIndex(count - 1) : nextDayIndex(count);
    return NextResponse.json({ dayIndex, claimedToday, rewards });
  }

  // ── 메모리 스텁 폴백 ──
  const days = store.get(userId) ?? new Set<string>();
  const claimedToday = days.has(kstDate());
  const dayIndex = claimedToday ? nextDayIndex(days.size - 1) : nextDayIndex(days.size);
  return NextResponse.json({ dayIndex, claimedToday, rewards });
}

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as { userId?: string } | null;
  const userId = body?.userId?.trim();
  if (!userId) return NextResponse.json({ ok: false, reason: "invalid" });
  const today = kstDate();

  const db = getDb();
  if (db) {
    // users 행 보장(FK) — 닉네임 불변
    await db.from("users").upsert({ user_id: userId }, { onConflict: "user_id", ignoreDuplicates: true });
    const cnt = await db
      .from("attendance")
      .select("claim_date", { count: "exact", head: true })
      .eq("user_id", userId);
    if (cnt.error) return NextResponse.json({ ok: false, reason: "invalid" });
    const dayIndex = nextDayIndex(cnt.count ?? 0);
    const reward = ATTENDANCE.REWARDS[dayIndex - 1];
    const ins = await db
      .from("attendance")
      .insert({ user_id: userId, claim_date: today, day_index: dayIndex, reward });
    if (ins.error) {
      // 23505: 오늘 이미 수령(동시 요청 포함) — 서버 권위 차단
      if (ins.error.code === "23505") return NextResponse.json({ ok: false, reason: "claimed" });
      return NextResponse.json({ ok: false, reason: "invalid" });
    }
    return NextResponse.json({ ok: true, dayIndex, reward });
  }

  // ── 메모리 스텁 폴백 ──
  const days = store.get(userId) ?? new Set<string>();
  if (days.has(today)) return NextResponse.json({ ok: false, reason: "claimed" });
  const dayIndex = nextDayIndex(days.size);
  days.add(today);
  store.set(userId, days);
  return NextResponse.json({ ok: true, dayIndex, reward: ATTENDANCE.REWARDS[dayIndex - 1] });
}
