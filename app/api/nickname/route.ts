import { NextRequest, NextResponse } from "next/server";
import { validateNickname } from "@/lib/nickname";
import { getDb } from "@/lib/db";

// 닉네임 등록·중복 확인 API — E7-1: Supabase(users 테이블) 저장.
// 환경변수 미설정 시 기존 메모리 스텁으로 폴백(로컬 개발·헤드리스 검증).
//
// POST { userId, name }
//   → 200 { ok: true, name }                              등록 성공(같은 유저 재등록 포함)
//   → 200 { ok: false, reason: "duplicate", suggestion }  타 유저 사용 중 + 대안 제시
//   → 200 { ok: false, reason: "invalid" }                형식 위반
// GET ?userId=...
//   → 200 { name: string | null }                         재방문·기기 변경 시 조회

interface Store {
  byName: Map<string, string>; // normalized name -> userId
  byUser: Map<string, string>; // userId -> display name
}

// HMR·모듈 재평가에도 유지되도록 globalThis에 보관 (DB 미연결 폴백 전용)
const g = globalThis as unknown as { __nicknameStore?: Store };
const store: Store = (g.__nicknameStore ??= {
  byName: new Map(),
  byUser: new Map(),
});

// 중복 판정 기준: 공백 제거 + 소문자 (표시명은 원형 유지)
function normalize(name: string): string {
  return name.replace(/\s/g, "").toLowerCase();
}

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as
    | { userId?: string; name?: string }
    | null;
  const userId = body?.userId?.trim();
  const raw = body?.name ?? "";
  if (!userId) return NextResponse.json({ ok: false, reason: "invalid" });

  const v = validateNickname(raw);
  if (!v.ok) return NextResponse.json({ ok: false, reason: "invalid" });

  const key = normalize(v.name);
  const db = getDb();

  if (db) {
    // 선점 확인 — 같은 key를 다른 user_id가 쓰고 있으면 duplicate
    const { data: owner, error: selErr } = await db
      .from("users")
      .select("user_id")
      .eq("nickname_key", key)
      .maybeSingle();
    if (selErr) return NextResponse.json({ ok: false, reason: "invalid" });

    if (owner && owner.user_id !== userId) {
      return NextResponse.json({
        ok: false,
        reason: "duplicate",
        suggestion: await suggestDb(db, v.name),
      });
    }

    const { error } = await db
      .from("users")
      .upsert(
        { user_id: userId, nickname: v.name, nickname_key: key },
        { onConflict: "user_id" }
      );
    if (error) {
      // 23505: nickname_key unique 경합(동시 등록 레이스) → duplicate 처리
      if (error.code === "23505") {
        return NextResponse.json({
          ok: false,
          reason: "duplicate",
          suggestion: await suggestDb(db, v.name),
        });
      }
      return NextResponse.json({ ok: false, reason: "invalid" });
    }
    return NextResponse.json({ ok: true, name: v.name });
  }

  // ── 메모리 스텁 폴백 (DB 미연결) ──
  const owner = store.byName.get(key);
  if (owner && owner !== userId) {
    let suggestion = v.name;
    for (let n = 2; n < 100; n++) {
      const cand = `${v.name}${n}`;
      if (!store.byName.has(normalize(cand))) {
        suggestion = cand;
        break;
      }
    }
    return NextResponse.json({ ok: false, reason: "duplicate", suggestion });
  }
  const prev = store.byUser.get(userId);
  if (prev) store.byName.delete(normalize(prev));
  store.byName.set(key, userId);
  store.byUser.set(userId, v.name);
  return NextResponse.json({ ok: true, name: v.name });
}

// 빈 번호를 붙여 대안 제시("불도저 김씨2" 식) — like 프리픽스 1회 조회로 후보 일괄 확인
async function suggestDb(
  db: NonNullable<ReturnType<typeof getDb>>,
  name: string
): Promise<string> {
  const base = normalize(name);
  const { data } = await db
    .from("users")
    .select("nickname_key")
    .like("nickname_key", `${base}%`);
  const taken = new Set((data ?? []).map((r) => r.nickname_key as string));
  for (let n = 2; n < 100; n++) {
    if (!taken.has(`${base}${n}`)) return `${name}${n}`;
  }
  return name;
}

export async function GET(req: NextRequest) {
  const userId = req.nextUrl.searchParams.get("userId")?.trim();
  if (!userId) return NextResponse.json({ name: null });

  const db = getDb();
  if (db) {
    const { data } = await db
      .from("users")
      .select("nickname")
      .eq("user_id", userId)
      .maybeSingle();
    return NextResponse.json({ name: data?.nickname ?? null });
  }
  return NextResponse.json({ name: store.byUser.get(userId) ?? null });
}
