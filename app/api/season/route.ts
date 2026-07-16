import { NextRequest, NextResponse } from "next/server";
import { SEASON } from "@/app/game/engine/config";

// 주간 시즌 랭킹 API — 개발 스텁 (E4).
// 운영에서는 가다 서버/DB(userId 권위)로 교체한다. 이 스텁은 프로세스 메모리라
// 서버 재시작 시 초기화됨. 계약(요청/응답 형태)만 운영과 동일하게 유지할 것.
//
// 랭킹 구조(기획 3장): 하루 점수 = 일일 베스트, 주간 점수 = 라운드(월~일, KST) 내 일일 베스트 합,
// 이벤트 시작일(SEASON.EVENT_START, KST 월요일) 기준 매주 월요일 리셋, 총 4라운드.
//
// POST { userId, nickname, score, mode, date? }
//   - mode가 "endless"일 때만 반영(edu·route 점수는 랭킹 제외)
//   - date(YYYY-MM-DD, KST) 생략 시 서버가 오늘(KST)로 기록
//   → 200 { ok: true, todayBest }          해당 날짜 베스트 갱신(기존보다 낮으면 유지)
//   → 200 { ok: false, reason: "mode" | "invalid" }
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
  const date = /^\d{4}-\d{2}-\d{2}$/.test(body?.date ?? "") ? body!.date! : kstDate();
  const rec = store.get(userId) ?? { nickname: "", days: new Map() };
  if (body?.nickname) rec.nickname = body.nickname;
  rec.days.set(date, Math.max(rec.days.get(date) ?? 0, score)); // 그날 베스트만 갱신
  store.set(userId, rec);
  return NextResponse.json({ ok: true, todayBest: rec.days.get(date) });
}

export async function GET(req: NextRequest) {
  const userId = req.nextUrl.searchParams.get("userId")?.trim() ?? "";
  const { round, from, to, endsAt } = currentRound();

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
