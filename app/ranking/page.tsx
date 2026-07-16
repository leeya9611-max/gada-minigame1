"use client";

import Link from "next/link";
import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { tierOf } from "./tier";
import { daysLeft, fetchSeason, requestNativeAction } from "@/lib/api";
import type { SeasonBoard } from "@/lib/api";
import { REWARD_SAFE_MODE } from "@/app/game/engine/config";
import { parseToken } from "@/lib/auth";
import { loadTickets, saveTickets } from "@/lib/tickets";

// E4: 주간 시즌 랭킹 보드 — 게임과 동일한 가로(landscape) 화면.
// 데이터는 /api/season 스텁(운영 서버 교체 예정). 전국/연령/지역 탭 제거 → 주간 단일 보드.

// 유저 식별: 딥링크 토큰(?token=) 우선, 없으면 게임이 저장한 마지막 userId
function resolveUserId(token: string | null): string {
  const fromToken = parseToken(token);
  if (!fromToken.isGuest) return fromToken.userId;
  try {
    return localStorage.getItem("yk_last_uid") ?? fromToken.userId;
  } catch {
    return fromToken.userId;
  }
}

export default function RankingPage() {
  return (
    <Suspense>
      <RankingBoard />
    </Suspense>
  );
}

function RankingBoard() {
  const token = useSearchParams().get("token");
  const [board, setBoard] = useState<SeasonBoard | null | "loading">("loading");
  const [tickets, setTickets] = useState(0);
  const [portrait, setPortrait] = useState(false);

  useEffect(() => setTickets(loadTickets()), []); // 게임과 동일 저장소 공유

  useEffect(() => {
    let alive = true;
    void fetchSeason(resolveUserId(token)).then((b) => alive && setBoard(b));
    return () => {
      alive = false;
    };
  }, [token]);

  // 가로 화면 안내(게임과 동일 규칙)
  useEffect(() => {
    const mq = window.matchMedia("(orientation: portrait)");
    const update = () => setPortrait(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);

  // 티켓 충전 요청. 실제 지급/차감은 네이티브 앱 API 담당(웹은 요청+표시 스텁).
  const charge = (action: "watchAdForTicket" | "exchangePointsForTicket") => () => {
    requestNativeAction(action);
    setTickets((t) => {
      const next = t + 1;
      saveTickets(next);
      return next;
    });
  };

  const me = board !== "loading" && board ? board.me : null;
  const myTier = tierOf(me?.weekScore ?? 0);

  if (portrait) return <RotateHint />;

  return (
    <main
      style={{
        height: "100dvh",
        display: "flex",
        justifyContent: "center",
        alignItems: "stretch",
        background: "#0e1526",
        color: "#fff",
        overflow: "hidden",
      }}
    >
      <div
        style={{
          width: "100%",
          maxWidth: 900,
          display: "flex",
          gap: 14,
          padding: "14px 16px",
        }}
      >
        {/* ── 좌측 패널: 헤더 · 내 티어/주간 요약 · 티켓/충전 ── */}
        <aside
          style={{
            width: 264,
            flexShrink: 0,
            display: "flex",
            flexDirection: "column",
            gap: 10,
          }}
        >
          <header style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <Link href="/game" style={{ color: "#8fa3c4", fontSize: 24, textDecoration: "none" }}>
              ‹
            </Link>
            <div>
              <h1 style={{ fontSize: 17, fontWeight: 800, lineHeight: 1.2 }}>주간 랭킹</h1>
              <div style={{ fontSize: 12, color: "#ffd23f", fontWeight: 700 }}>
                {board !== "loading" && board
                  ? `${board.round}라운드 · 종료까지 D-${daysLeft(board.endsAt)}`
                  : " "}
              </div>
            </div>
          </header>

          {/* 내 티어 배지 카드(유지) + 주간 요약 */}
          <section style={panel}>
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <div
                style={{
                  width: 52,
                  height: 52,
                  borderRadius: "50%",
                  background: myTier.color,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: 26,
                  flexShrink: 0,
                }}
              >
                {myTier.emoji}
              </div>
              <div>
                <div style={{ fontSize: 12, color: "#8fa3c4" }}>내 티어</div>
                <div style={{ fontSize: 16, fontWeight: 800, color: myTier.color }}>
                  {myTier.label}
                </div>
              </div>
            </div>
            <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
              <div style={statBox}>
                <div style={statLabel}>이번 주</div>
                <div style={statValue}>{me ? me.weekScore.toLocaleString() : "–"}</div>
              </div>
              <div style={statBox}>
                <div style={statLabel}>오늘 베스트</div>
                <div style={statValue}>{me ? me.todayBest.toLocaleString() : "–"}</div>
              </div>
              <div style={statBox}>
                <div style={statLabel}>순위</div>
                <div style={{ ...statValue, color: "#ffd23f" }}>{me ? `${me.rank}위` : "–"}</div>
              </div>
            </div>
          </section>

          {/* 티켓 · 충전 */}
          <section style={{ ...panel, marginTop: "auto" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <div style={{ fontSize: 13, fontWeight: 700 }}>보유 티켓</div>
              <div style={{ fontSize: 18, fontWeight: 800, color: "#ffd23f" }}>🎟 {tickets}</div>
            </div>
            <div style={{ fontSize: 11, color: "#8fa3c4", margin: "4px 0 8px" }}>
              지급은 앱에서 처리됩니다.
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <button onClick={charge("watchAdForTicket")} style={chargeBtn("#2E66F6")}>
                📺 광고 시청 <span style={{ fontSize: 11, opacity: 0.8 }}>+1</span>
              </button>
              {/* E4-5 세이프 모드: 포인트 교환 숨김(코드 보관) — 플래그 해제 시 복귀 */}
              {!REWARD_SAFE_MODE && (
                <button onClick={charge("exchangePointsForTicket")} style={chargeBtn("#3c4a63")}>
                  💰 포인트 교환 <span style={{ fontSize: 11, opacity: 0.8 }}>+1</span>
                </button>
              )}
            </div>
          </section>
        </aside>

        {/* ── 우측: 주간 순위 리스트(스크롤) + 내 순위 고정 행 ── */}
        <section
          style={{
            flex: 1,
            display: "flex",
            flexDirection: "column",
            background: "rgba(255,255,255,0.04)",
            borderRadius: 16,
            padding: "10px 12px",
            minWidth: 0,
          }}
        >
          <div style={{ display: "flex", fontSize: 11, color: "#8fa3c4", padding: "2px 10px 8px" }}>
            <span style={{ width: 46 }}>순위</span>
            <span style={{ flex: 1 }}>닉네임 · 주간 점수 = 일일 베스트 합산</span>
            <span>주간 점수</span>
          </div>

          <ul
            style={{
              listStyle: "none",
              margin: 0,
              padding: 0,
              display: "flex",
              flexDirection: "column",
              gap: 6,
              overflowY: "auto",
              WebkitOverflowScrolling: "touch",
              flex: 1,
            }}
          >
            {board === "loading" && (
              <li style={{ color: "#8fa3c4", padding: 16, textAlign: "center" }}>불러오는 중…</li>
            )}
            {board !== "loading" && !board && (
              <li style={{ color: "#8fa3c4", padding: 16, textAlign: "center" }}>
                랭킹을 불러오지 못했습니다. 잠시 후 다시 열어주세요.
              </li>
            )}
            {board !== "loading" && board && board.entries.length === 0 && (
              <li style={{ color: "#8fa3c4", padding: 16, textAlign: "center", lineHeight: 1.7 }}>
                이번 라운드 기록이 아직 없어요.
                <br />
                무한 잔업 모드에서 첫 기록을 남겨보세요! 🔥
              </li>
            )}
            {board !== "loading" &&
              board?.entries.map((r) => (
                <RankRow
                  key={r.rank}
                  rank={r.rank}
                  name={r.nickname}
                  score={r.weekScore}
                  me={me !== null && r.rank === me.rank}
                />
              ))}
          </ul>

          {/* 내 순위 고정 행(목록 스크롤과 무관하게 하단 고정) */}
          {me && (
            <div style={{ borderTop: "1px solid rgba(255,255,255,0.1)", paddingTop: 6, marginTop: 6 }}>
              <RankRow rank={me.rank} name="나" score={me.weekScore} me pinned />
            </div>
          )}
        </section>
      </div>
    </main>
  );
}

function RankRow({
  rank,
  name,
  score,
  me,
  pinned,
}: {
  rank: number;
  name: string;
  score: number;
  me?: boolean;
  pinned?: boolean;
}) {
  const t = tierOf(score);
  return (
    <li
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        padding: "9px 12px",
        borderRadius: 12,
        background: me ? "rgba(46,102,246,0.22)" : "rgba(255,255,255,0.05)",
        border: me ? "1px solid #2E66F6" : "1px solid transparent",
        listStyle: "none",
      }}
    >
      <div style={{ width: 36, fontWeight: 800, color: rank <= 3 ? "#ffd23f" : "#8fa3c4" }}>
        {rank <= 3 ? ["🥇", "🥈", "🥉"][rank - 1] : rank}
      </div>
      <div style={{ fontSize: 17 }}>{t.emoji}</div>
      <div
        style={{
          flex: 1,
          fontWeight: me ? 800 : 600,
          fontSize: 14,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
      >
        {name}
        {pinned && <span style={{ fontSize: 11, color: "#8fa3c4", marginLeft: 6 }}>내 순위</span>}
      </div>
      <div style={{ fontWeight: 800, color: "#ffd23f", fontVariantNumeric: "tabular-nums" }}>
        {score.toLocaleString()}
      </div>
    </li>
  );
}

// 게임과 동일한 가로 화면 안내
function RotateHint() {
  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "#0e1526",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 18,
        color: "#fff",
        textAlign: "center",
        padding: 24,
      }}
    >
      <div style={{ fontSize: 54, animation: "rotateHintR 1.6s ease-in-out infinite" }}>📱</div>
      <div style={{ fontSize: 20, fontWeight: 800 }}>가로로 돌려주세요</div>
      <div style={{ fontSize: 14, color: "#9fb0cc", lineHeight: 1.6 }}>
        주간 랭킹은 가로 화면에 최적화되어 있어요.
      </div>
      <style>{`@keyframes rotateHintR{0%,100%{transform:rotate(-12deg)}50%{transform:rotate(78deg)}}`}</style>
    </div>
  );
}

const panel: React.CSSProperties = {
  background: "rgba(255,255,255,0.06)",
  borderRadius: 16,
  padding: 14,
};

const statBox: React.CSSProperties = {
  flex: 1,
  background: "rgba(0,0,0,0.25)",
  borderRadius: 10,
  padding: "7px 8px",
  textAlign: "center",
};
const statLabel: React.CSSProperties = { fontSize: 10.5, color: "#8fa3c4" };
const statValue: React.CSSProperties = {
  fontSize: 15,
  fontWeight: 800,
  fontVariantNumeric: "tabular-nums",
};

function chargeBtn(bg: string): React.CSSProperties {
  return {
    flex: 1,
    border: "none",
    borderRadius: 12,
    padding: "10px 0",
    background: bg,
    color: "#fff",
    fontSize: 13,
    fontWeight: 700,
  };
}
