"use client";

import Link from "next/link";
import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { tierOf } from "./tier";
import { daysLeft, fetchSeason, requestNativeAction } from "@/lib/api";
import type { SeasonBoard } from "@/lib/api";
import { REWARD_SAFE_MODE } from "@/app/game/engine/config";
import { parseToken } from "@/lib/auth";
import { fetchNickname, loadNickname } from "@/lib/nickname";
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

  // E4-7: 닉네임 — 로컬 캐시 즉시 표시 → 서버 조회로 갱신(Game.tsx 패턴)
  const [nickname, setNickname] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    const uid = resolveUserId(token);
    setNickname(loadNickname(uid));
    void fetchNickname(uid).then((n) => {
      if (alive && n) setNickname(n);
    });
    void fetchSeason(uid).then((b) => alive && setBoard(b));
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
        // E4-6: 배경 이미지(cover) + 가독성 오버레이 — 파일 없으면 플랫 컬러 폴백
        backgroundColor: "#0e1526",
        backgroundImage:
          "linear-gradient(180deg, rgba(10,15,30,0.5), rgba(10,15,30,0.78)), url(/assets/ui/ranking_bg.webp)",
        backgroundSize: "cover",
        backgroundPosition: "center",
        color: "#fff",
        overflow: "hidden",
      }}
    >
      <div
        style={{
          width: "100%",
          maxWidth: 960,
          display: "flex",
          gap: 16,
          padding: "14px 16px",
        }}
      >
        {/* ── 좌측: 패널 없이 배경 노출 — 헤더 + 김반장 캐릭터 (E4-8) ── */}
        <div
          style={{
            flex: 0.8,
            minWidth: 0,
            display: "flex",
            flexDirection: "column",
            justifyContent: "space-between",
          }}
        >
          <header style={{ display: "flex", alignItems: "center", gap: 10, textShadow: "0 2px 6px rgba(0,0,0,0.65)" }}>
            <Link href="/game" style={{ color: "#cdd8ec", fontSize: 24, textDecoration: "none" }}>
              ‹
            </Link>
            <div>
              <h1 style={{ fontSize: 19, fontWeight: 800, lineHeight: 1.2 }}>주간 랭킹</h1>
              <div style={{ fontSize: 12.5, color: "#ffd23f", fontWeight: 700 }}>
                {board !== "loading" && board
                  ? `${board.round}라운드 · 종료까지 D-${daysLeft(board.endsAt)}`
                  : " "}
              </div>
            </div>
          </header>
          {/* 하단 캐릭터 — 좁은 화면에선 축소·숨김(E3.11-2 규칙) */}
          {/* E3.30: 트로피 든 김반장(ranking_hero) — 파일 없으면 기존 cheer로 폴백 */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            className="rk-char"
            src="/assets/ui/ranking_hero.webp"
            onError={(e) => {
              if (!e.currentTarget.src.endsWith("cheer.webp"))
                e.currentTarget.src = "/assets/sprites/gimbanjang_custom/cheer.webp";
            }}
            alt=""
            aria-hidden
            draggable={false}
            style={{
              // E4-11: 62vh로 확대(하한 160·상한 360) + 하단 여백 — 발끝이 화면 경계에서 떨어지게
              height: "clamp(160px, 62vh, 360px)",
              width: "auto",
              alignSelf: "center",
              marginLeft: "-8%",
              marginBottom: 14,
              filter: "drop-shadow(0 8px 18px rgba(0,0,0,0.5))",
            }}
          />
          {/* E4-9: 숨김 기준 430→320px — 정말 극단적으로 낮은 화면에서만 숨김 */}
          <style>{`@media (max-height: 320px){ .rk-char{ display: none } }`}</style>
        </div>

        {/* ── 우측: 통합 패널(내 정보 + 티켓 + 순위 리스트) — 프레임은 이쪽에만 ── */}
        <section
          style={{
            ...frameStyle,
            flex: 1.3,
            display: "flex",
            flexDirection: "column",
            background: "rgba(255,255,255,0.04)",
            padding: "10px 12px",
            minWidth: 0,
          }}
        >
          {/* 내 티어 + 닉네임 + 티켓/충전 (구 aside 상단부) */}
          <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "2px 4px 8px" }}>
            <TierBadge tier={myTier} />
            <div style={{ minWidth: 0, flex: 1 }}>
              {nickname && (
                <div
                  style={{
                    fontSize: 15,
                    fontWeight: 800,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  👷 {nickname}
                </div>
              )}
              <div style={{ fontSize: 11.5, color: "#8fa3c4" }}>
                내 티어 · <span style={{ fontWeight: 800, color: myTier.color }}>{myTier.label}</span>
              </div>
            </div>
            <div style={{ textAlign: "right" }}>
              <div style={{ fontSize: 15, fontWeight: 800, color: "#ffd23f", whiteSpace: "nowrap" }}>🎟 {tickets}</div>
              <button onClick={charge("watchAdForTicket")} style={{ ...chargeBtn("cta_primary", "#2E66F6"), flex: "none", padding: "6px 12px", fontSize: 12, marginTop: 4 }}>
                <VideoIcon /> 광고 +1
              </button>
              {/* E4-5 세이프 모드: 포인트 교환 숨김(코드 보관) — 플래그 해제 시 복귀 */}
              {!REWARD_SAFE_MODE && (
                <button onClick={charge("exchangePointsForTicket")} style={{ ...chargeBtn("cta_secondary", "#3c4a63"), flex: "none", padding: "6px 12px", fontSize: 12, marginTop: 4, marginLeft: 6 }}>
                  💰 교환 +1
                </button>
              )}
            </div>
          </div>
          <div style={{ display: "flex", gap: 6, margin: "0 4px 8px" }}>
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
          <div style={{ height: 1, background: "rgba(255,255,255,0.12)", margin: "0 2px 8px" }} />

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

          {/* 내 순위 고정 행(목록 스크롤과 무관하게 하단 고정) — E4-12: 어두운 깔개로 목록과 분리 */}
          {me && (
            <div
              style={{
                borderTop: "1px solid rgba(255,255,255,0.1)",
                background: "rgba(0,0,0,0.15)",
                borderRadius: "0 0 10px 10px",
                padding: "6px 4px 4px",
                margin: "6px -4px 0",
              }}
            >
              <RankRow rank={me.rank} name={nickname ?? "나"} score={me.weekScore} me pinned />
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
  const top3 = rank <= 3;
  return (
    <li
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        padding: "9px 12px",
        borderRadius: 12,
        // E4-6: 은은한 대각선 텍스처(플랫 rgba 대체) + 상위 3위 티어 컬러 글로우
        // E4-12: 하단 고정 행(pinned)은 골드 톤 — 목록 안 내 행(파랑)과 시각 분리
        background: pinned
          ? "linear-gradient(135deg, rgba(255,210,63,0.22), rgba(255,180,40,0.1) 60%, rgba(255,210,63,0.16))"
          : me
            ? "linear-gradient(135deg, rgba(95,139,255,0.3), rgba(46,102,246,0.16) 60%, rgba(46,102,246,0.24))"
            : "linear-gradient(135deg, rgba(255,255,255,0.09), rgba(255,255,255,0.035) 55%, rgba(255,255,255,0.06))",
        border: pinned
          ? "1px solid #ffd23f99"
          : me
            ? "1px solid #2E66F6"
            : top3
              ? `1px solid ${t.color}66`
              : "1px solid transparent",
        boxShadow: pinned
          ? "0 0 10px rgba(255,210,63,0.22), inset 0 1px 0 rgba(255,255,255,0.12)"
          : top3
            ? `0 0 10px ${t.color}40, inset 0 1px 0 rgba(255,255,255,0.1)`
            : "inset 0 1px 0 rgba(255,255,255,0.07)",
        listStyle: "none",
      }}
    >
      <div style={{ width: 36, fontWeight: 800, color: top3 ? "#ffd23f" : "#8fa3c4", display: "flex", justifyContent: "center" }}>
        {top3 ? <MedalIcon rank={rank} /> : rank}
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

// E4-6: 공사장 패널 프레임(9-slice) — 모서리(리벳) 고정·변만 늘어남.
// 파일 없으면 투명 보더 + 기존 배경 박스로 폴백(fill이 없으니 안 깨짐).
const frameStyle: React.CSSProperties = {
  borderStyle: "solid",
  borderWidth: 16,
  borderColor: "transparent",
  borderImage: "url(/assets/ui/panel_frame.webp) 15% fill / 16px stretch",
  borderRadius: 16,
};

const panel: React.CSSProperties = {
  background: "rgba(255,255,255,0.06)",
  borderRadius: 16,
  padding: 14,
};

const statBox: React.CSSProperties = {
  flex: 1,
  background: "rgba(0,0,0,0.25)",
  borderRadius: 10,
  padding: "7px 4px",
  textAlign: "center",
  minWidth: 0,
};
const statLabel: React.CSSProperties = {
  fontSize: "clamp(8px, 2vw, 10.5px)",
  color: "#8fa3c4",
  whiteSpace: "nowrap", // E4-7: "오늘 베스트" 한 줄 보장
};
const statValue: React.CSSProperties = {
  fontSize: 15,
  fontWeight: 800,
  fontVariantNumeric: "tabular-nums",
};

// E4-6 → E3.25-2: CTA 이미지 border-image(좌우 캡 3-slice) — 파일 없으면 기존 글로시 그라데이션(bg) 폴백
function chargeBtn(cta: string, bg: string): React.CSSProperties {
  return {
    flex: 1,
    border: "none",
    // 16px: cta 이미지 캡 곡률과 일치(폴백 그라데이션 모서리 비침 방지)
    borderRadius: 16,
    padding: "10px 0",
    background: `linear-gradient(180deg, rgba(255,255,255,0.28) 0%, ${bg} 45%, ${bg} 100%)`,
    color: "#fff",
    fontSize: 13,
    fontWeight: 700,
    boxShadow: "inset 0 1px 0 rgba(255,255,255,0.3), 0 3px 0 rgba(0,0,0,0.3), 0 5px 10px rgba(0,0,0,0.25)",
    textShadow: "0 1px 2px rgba(0,0,0,0.3)",
    cursor: "pointer",
    borderImage: `url(/assets/ui/${cta}.png) 0 75 fill / 0 16px stretch`,
  };
}

// E4-6: 티어 배지 — 이미지(/assets/ui/tier_{key}.png) 우선, 없으면 기존 원형+이모지 폴백
// E3.24-4: 광고 시청 버튼 아이콘 — 파일 없으면 📺 폴백
function VideoIcon() {
  const [broken, setBroken] = useState(false);
  if (broken) return <span aria-hidden>📺</span>;
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src="/assets/ui/icon_video.png"
      alt=""
      aria-hidden
      draggable={false}
      onError={() => setBroken(true)}
      style={{ width: 14, height: 14, objectFit: "contain", verticalAlign: "-2px" }}
    />
  );
}

function TierBadge({ tier }: { tier: ReturnType<typeof tierOf> }) {
  const [broken, setBroken] = useState(false);
  if (broken) {
    return (
      <div
        style={{
          width: 52,
          height: 52,
          borderRadius: "50%",
          background: tier.color,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: 26,
          flexShrink: 0,
        }}
      >
        {tier.emoji}
      </div>
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={`/assets/ui/tier_${tier.key}.png`}
      alt={tier.label}
      draggable={false}
      onError={() => setBroken(true)}
      style={{ width: 56, height: 56, objectFit: "contain", flexShrink: 0, filter: "drop-shadow(0 3px 6px rgba(0,0,0,0.4))" }}
    />
  );
}

// E4-6: 순위 메달 — 이미지(/assets/ui/medal_{rank}.png) 우선, 없으면 이모지 폴백
function MedalIcon({ rank }: { rank: number }) {
  const [broken, setBroken] = useState(false);
  if (broken) return <span>{["🥇", "🥈", "🥉"][rank - 1]}</span>;
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={`/assets/ui/medal_${rank}.png`}
      alt={`${rank}위`}
      draggable={false}
      onError={() => setBroken(true)}
      style={{ height: 30, width: "auto", filter: "drop-shadow(0 2px 4px rgba(0,0,0,0.4))" }}
    />
  );
}
