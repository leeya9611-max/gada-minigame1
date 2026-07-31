import { NextRequest, NextResponse } from "next/server";
import { SEASON } from "@/app/game/engine/config";
import { getDb } from "@/lib/db";

// 주간 시즌 랭킹 API — E7-1: Supabase(daily_scores + season_board/season_me RPC) 저장.
// 환경변수 미설정 시 기존 메모리 스텁으로 폴백(로컬 개발·헤드리스 검증).
//
// 랭킹 구조(기획 3장): 하루 점수 = 일일 베스트, 주간 점수 = 라운드(월~일, KST) 내 일일 베스트 합,
// 이벤트 시작일(SEASON.EVENT_START, KST 월요일) 기준 매주 월요일 리셋, 총 4라운드.
//
// POST { userId, nickname, score, mode, playDuration, date? }
//   - mode가 "endless"일 때만 반영(edu·route 점수는 랭킹 제외)
//   - E6-4: playDuration(초) 필수 — score ≤ playDuration × MAX_SCORE_PER_SEC + BUFFER 검증(어뷰징 상한)
//   - date(YYYY-MM-DD, KST) 생략 시 서버가 오늘(KST)로 기록
//   → 200 { ok: true, todayBest }          해당 날짜 베스트 갱신(기존보다 낮으면 유지)
//   → 200 { ok: false, reason: "mode" | "invalid" | "score_cap" }
// GET ?userId=...
//   → 200 {
//        round,                    현재 라운드(1..ROUNDS, 시작 전엔 1)
//        endsAt,                   현재 라운드 종료 시각(ISO, KST 일요일 24:00)
//        entries: [{ rank, nickname, weekScore }],   상위 TOP_N
//        me: { rank, weekScore, todayBest } | null   기록 없으면 null
//      }

interface UserRecord {
  nickname: string;
  days: Map<string, number>; // "YYYY-MM-DD"(KST) -> 그날 베스트
}
const g = globalThis as unknown as { __seasonStore?: Map<string, UserRecord> };
const store: Map<string, UserRecord> = (g.__seasonStore ??= new Map());

const DAY_MS = 86400_000;
const KST_MS = 9 * 3600_000;

// KST 날짜 문자열
function kstDate(now = Date.now()): string {
  return new Date(now + KST_MS).toISOString().slice(0, 10);
}

// 현재 라운드와 그 기간(KST 날짜 문자열 범위 + 종료 시각)
function currentRound(now = Date.now()) {
  const start = Date.parse(`${SEASON.EVENT_START}T00:00:00+09:00`);
  const weeks = Math.floor((now - start) / (7 * DAY_MS));
  const round = Math.max(1, Math.min(SEASON.ROUNDS, weeks + 1));
  const roundStart = start + (round - 1) * 7 * DAY_MS;
  const roundEnd = roundStart + 7 * DAY_MS;
  const from = kstDate(roundStart);
  const to = kstDate(roundEnd - DAY_MS);
  return { round, from, to, endsAt: new Date(roundEnd).toISOString() };
}

function weekScoreOf(rec: UserRecord, from: string, to: string): number {
  let sum = 0;
  for (const [d, best] of rec.days) if (d >= from && d <= to) sum += best;
  return sum;
}

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as {
    userId?: string;
    nickname?: string;
    score?: number;
    mode?: string;
    playDuration?: number;
    date?: string;
  } | null;
  const userId = body?.userId?.trim();
  const score = Math.floor(Number(body?.score));
  if (!userId || !Number.isFinite(score) || score < 0) {
    return NextResponse.json({ ok: false, reason: "invalid" });
  }
  if (body?.mode !== "endless") {
    // edu 등 비랭킹 모드 점수는 랭킹 제외(기획 3장)
    return NextResponse.json({ ok: false, reason: "mode" });
  }
  // E6-4: playDuration 대비 점수 상한 — 조작된 고점수 차단
  const dur = Number(body?.playDuration);
  if (!Number.isFinite(dur) || dur <= 0 || dur > 7200) {
    return NextResponse.json({ ok: false, reason: "invalid" });
  }
  if (score > dur * SEASON.MAX_SCORE_PER_SEC + SEASON.SCORE_CAP_BUFFER) {
    console.warn("[SEASON] score_cap 차단:", { userId, score, dur });
    return NextResponse.json({ ok: false, reason: "score_cap" });
  }
  const date = /^\d{4}-\d{2}-\d{2}$/.test(body?.date ?? "") ? body!.date! : kstDate();

  const db = getDb();
  if (db) {
    // users 행 보장(닉네임은 건드리지 않음 — 없을 때만 생성)
    const { error: userErr } = await db
      .from("users")
      .upsert({ user_id: userId }, { onConflict: "user_id", ignoreDuplicates: true });
    if (userErr) return NextResponse.json({ ok: false, reason: "invalid" });

    // 그날 베스트만 유지: ① 없으면 생성(경합 무시) ② 기존보다 클 때만 조건부 갱신(원자적)
    await db
      .from("daily_scores")
      .upsert(
        { user_id: userId, play_date: date, best_score: score },
        { onConflict: "user_id,play_date", ignoreDuplicates: true }
      );
    await db
      .from("daily_scores")
      .update({ best_score: score, updated_at: new Date().toISOString() })
      .eq("user_id", userId)
      .eq("play_date", date)
      .lt("best_score", score);

    const { data } = await db
      .from("daily_scores")
      .select("best_score")
      .eq("user_id", userId)
      .eq("play_date", date)
      .maybeSingle();
    return NextResponse.json({ ok: true, todayBest: data?.best_score ?? score });
  }

  // ── 메모리 스텁 폴백 ──
  const rec = store.get(userId) ?? { nickname: "", days: new Map() };
  if (body?.nickname) rec.nickname = body.nickname;
  rec.days.set(date, Math.max(rec.days.get(date) ?? 0, score)); // 그날 베스트만 갱신
  store.set(userId, rec);
  return NextResponse.json({ ok: true, todayBest: rec.days.get(date) });
}

export async function GET(req: NextRequest) {
  const userId = req.nextUrl.searchParams.get("userId")?.trim() ?? "";
  const { round, from, to, endsAt } = currentRound();

  const db = getDb();
  if (db) {
    const [board, mine] = await Promise.all([
      db.rpc("season_board", { p_from: from, p_to: to, p_top: SEASON.TOP_N }),
      userId
        ? db.rpc("season_me", { p_from: from, p_to: to, p_user: userId, p_today: kstDate() })
        : Promise.resolve({ data: null, error: null }),
    ]);
    if (board.error) {
      console.warn("[SEASON] season_board RPC 실패:", board.error.message);
      return NextResponse.json({ round, endsAt, entries: [], me: null });
    }
    const entries = (board.data ?? []).map(
      (r: { rank: number | string; nickname: string; week_score: number | string }) => ({
        rank: Number(r.rank),
        nickname: r.nickname,
        weekScore: Number(r.week_score),
      })
    );
    const meRow = Array.isArray(mine.data) ? mine.data[0] : null;
    const me = meRow
      ? {
          rank: Number(meRow.rank),
          weekScore: Number(meRow.week_score),
          todayBest: Number(meRow.today_best),
        }
      : null;
    return NextResponse.json({ round, endsAt, entries, me });
  }

  // ── 메모리 스텁 폴백 ──
  const scored = [...store.entries()]
    .map(([uid, rec]) => ({
      uid,
      nickname: rec.nickname || "이름없는 노동자",
      weekScore: weekScoreOf(rec, from, to),
    }))
    .filter((r) => r.weekScore > 0)
    .sort((a, b) => b.weekScore - a.weekScore);

  const entries = scored.slice(0, SEASON.TOP_N).map((r, i) => ({
    rank: i + 1,
    nickname: r.nickname,
    weekScore: r.weekScore,
  }));

  const myIdx = scored.findIndex((r) => r.uid === userId);
  const myRec = store.get(userId);
  const me =
    myIdx >= 0 && myRec
      ? {
          rank: myIdx + 1,
          weekScore: scored[myIdx].weekScore,
          todayBest: myRec.days.get(kstDate()) ?? 0,
        }
      : null;

  return NextResponse.json({ round, endsAt, entries, me });
}
