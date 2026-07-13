import { NextRequest, NextResponse } from "next/server";
import { validateNickname } from "@/lib/nickname";

// 닉네임 등록·중복 확인 API — 개발 스텁.
// 운영에서는 가다 서버/DB(userId 권위)로 교체한다. 이 스텁은 프로세스 메모리라
// 서버 재시작 시 초기화됨. 계약(요청/응답 형태)만 운영과 동일하게 유지할 것.
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

// HMR·모듈 재평가에도 유지되도록 globalThis에 보관
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
  const owner = store.byName.get(key);

  if (owner && owner !== userId) {
    // 타 유저가 선점 → 빈 번호를 붙여 대안 제시 ("불도저 김씨2" 식)
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

  // 같은 유저의 이전 닉네임은 해제(변경 허용 — 횟수 제한은 운영 서버에서)
  const prev = store.byUser.get(userId);
  if (prev) store.byName.delete(normalize(prev));

  store.byName.set(key, userId);
  store.byUser.set(userId, v.name);
  return NextResponse.json({ ok: true, name: v.name });
}

export async function GET(req: NextRequest) {
  const userId = req.nextUrl.searchParams.get("userId")?.trim();
  const name = userId ? store.byUser.get(userId) ?? null : null;
  return NextResponse.json({ name });
}
