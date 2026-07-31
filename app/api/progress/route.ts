import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";

// 안전교육 이수 API — E7-1: 서버 이관(users.edu_done). 기기 변경에도 이수 유지.
// 환경변수 미설정 시 메모리 스텁 폴백(로컬 개발·헤드리스 검증).
//
// GET ?userId=...        → 200 { eduDone: boolean }
// POST { userId }        → 200 { ok: true } (이수 처리 — 해제는 없음)

const g = globalThis as unknown as { __eduStore?: Set<string> };
const store: Set<string> = (g.__eduStore ??= new Set());

export async function GET(req: NextRequest) {
  const userId = req.nextUrl.searchParams.get("userId")?.trim();
  if (!userId) return NextResponse.json({ eduDone: false });

  const db = getDb();
  if (db) {
    const { data } = await db
      .from("users")
      .select("edu_done")
      .eq("user_id", userId)
      .maybeSingle();
    return NextResponse.json({ eduDone: data?.edu_done === true });
  }
  return NextResponse.json({ eduDone: store.has(userId) });
}

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as { userId?: string } | null;
  const userId = body?.userId?.trim();
  if (!userId) return NextResponse.json({ ok: false });

  const db = getDb();
  if (db) {
    // upsert: 행이 없으면 생성, 있으면 edu_done만 갱신(닉네임 등 다른 컬럼 불변)
    const { error } = await db
      .from("users")
      .upsert({ user_id: userId, edu_done: true }, { onConflict: "user_id" });
    if (error) return NextResponse.json({ ok: false });
    return NextResponse.json({ ok: true });
  }
  store.add(userId);
  return NextResponse.json({ ok: true });
}
