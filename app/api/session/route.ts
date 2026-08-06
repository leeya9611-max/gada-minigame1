import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { sessionStore } from "@/lib/session-store";

// E8-보안: 게임 세션 발급 — 무한 잔업 시작 시 호출. 서버가 시작 시각을 기록하고
// 1회용 세션 ID를 발급한다. 점수 제출(/api/season POST)은 이 세션이 있어야만 통과하며,
// 서버가 (제출 시각 - 시작 시각)으로 플레이 시간을 직접 측정한다(클라이언트 값 미신뢰).
//
// POST { userId } → 200 { sessionId }   (실패 시 sessionId 생략 — 클라는 점수 미제출)
//
// game_sessions 테이블(README SQL): session_id PK, user_id, started_at, consumed_at.
// 환경변수 미설정 시 globalThis 메모리 폴백.

function newId(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
  }
}

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as { userId?: string } | null;
  const userId = body?.userId?.trim();
  if (!userId) return NextResponse.json({ ok: false });
  const sessionId = newId();
  const startedAt = Date.now();

  const db = getDb();
  if (db) {
    await db.from("users").upsert({ user_id: userId }, { onConflict: "user_id", ignoreDuplicates: true });
    const { error } = await db
      .from("game_sessions")
      .insert({ session_id: sessionId, user_id: userId, started_at: new Date(startedAt).toISOString() });
    if (error) return NextResponse.json({ ok: false }); // 테이블 미준비 등 — 클라는 점수 미제출
    return NextResponse.json({ ok: true, sessionId });
  }

  // 메모리 폴백(최근 500개만 유지)
  if (sessionStore.size > 500) {
    const oldest = sessionStore.keys().next().value;
    if (oldest) sessionStore.delete(oldest);
  }
  sessionStore.set(sessionId, { userId, startedAt, consumed: false });
  return NextResponse.json({ ok: true, sessionId });
}
