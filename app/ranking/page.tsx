"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { tierOf } from "./tier";
import { requestNativeAction } from "@/lib/api";
import { loadTickets, saveTickets } from "@/lib/tickets";

type TabKey = "national" | "age" | "region";

const TABS: { key: TabKey; label: string }[] = [
  { key: "national", label: "전국" },
  { key: "age", label: "연령별" },
  { key: "region", label: "지역별" },
];

interface RankRow {
  rank: number;
  name: string;
  score: number;
  me?: boolean;
}

// 목업 랭킹 데이터 (실제 데이터는 네이티브/서버 연동 시 교체).
const MOCK: Record<TabKey, RankRow[]> = {
  national: [
    { rank: 1, name: "무재해_철근왕", score: 9820 },
    { rank: 2, name: "칼퇴의신", score: 8710 },
    { rank: 3, name: "안전제일김씨", score: 7430 },
    { rank: 4, name: "야리끼리마스터", score: 6120 },
    { rank: 5, name: "나(김반장)", score: 4180, me: true },
    { rank: 6, name: "현장의지배자", score: 3990 },
    { rank: 7, name: "도면요정", score: 2870 },
  ],
  age: [
    { rank: 1, name: "30대_반장甲", score: 7650 },
    { rank: 2, name: "나(김반장)", score: 4180, me: true },
    { rank: 3, name: "청년소장", score: 3520 },
    { rank: 4, name: "막내연장정리", score: 2010 },
  ],
  region: [
    { rank: 1, name: "서울_타워크레인", score: 8120 },
    { rank: 2, name: "판교_안전모", score: 5240 },
    { rank: 3, name: "나(김반장)", score: 4180, me: true },
    { rank: 4, name: "인천_레미콘", score: 3110 },
  ],
};

export default function RankingPage() {
  const [tab, setTab] = useState<TabKey>("national");
  const [tickets, setTickets] = useState(0);
  useEffect(() => setTickets(loadTickets()), []); // 게임과 동일 저장소 공유
  const rows = MOCK[tab];
  const me = useMemo(() => rows.find((r) => r.me), [rows]);
  const myTier = tierOf(me?.score ?? 0);

  // 티켓 충전 요청. 실제 지급/차감은 네이티브 앱 API 담당(웹은 요청+표시 스텁).
  const charge = (action: "watchAdForTicket" | "exchangePointsForTicket") => () => {
    requestNativeAction(action);
    setTickets((t) => {
      const next = t + 1;
      saveTickets(next);
      return next;
    });
  };
  const watchAd = charge("watchAdForTicket");
  const exchangePoints = charge("exchangePointsForTicket");

  return (
    <main
      style={{
        height: "100%",
        display: "flex",
        justifyContent: "center",
        background: "#0e1526",
      }}
    >
      {/* 모바일 웹앱 프레임: 넓은 화면에서도 세로 모바일 폭으로 고정 */}
      <div
        style={{
          width: "100%",
          maxWidth: 480,
          height: "100%",
          overflowY: "auto",
          WebkitOverflowScrolling: "touch",
          background: "linear-gradient(180deg, #1F2A44 0%, #0e1526 60%)",
          color: "#fff",
          padding: "20px 16px 32px",
        }}
      >
      <header style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16 }}>
        <Link href="/game" style={{ color: "#8fa3c4", fontSize: 22, textDecoration: "none" }}>
          ‹
        </Link>
        <h1 style={{ fontSize: 22, fontWeight: 800 }}>랭킹 보드</h1>
      </header>

      {/* 내 티어 배지 카드 */}
      <section
        style={{
          background: "rgba(255,255,255,0.06)",
          borderRadius: 18,
          padding: 18,
          display: "flex",
          alignItems: "center",
          gap: 14,
          marginBottom: 18,
        }}
      >
        <div
          style={{
            width: 60,
            height: 60,
            borderRadius: "50%",
            background: myTier.color,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 30,
          }}
        >
          {myTier.emoji}
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 13, color: "#8fa3c4" }}>내 티어</div>
          <div style={{ fontSize: 20, fontWeight: 800, color: myTier.color }}>
            {myTier.label}
          </div>
          <div style={{ fontSize: 13, color: "#cdd8ec" }}>
            {me?.score.toLocaleString()}점
          </div>
        </div>
        <div style={{ textAlign: "right" }}>
          <div style={{ fontSize: 13, color: "#8fa3c4" }}>보유 티켓</div>
          <div style={{ fontSize: 24, fontWeight: 800, color: "#ffd23f" }}>🎟 {tickets}</div>
        </div>
      </section>

      {/* 탭 */}
      <div
        style={{
          display: "flex",
          background: "rgba(255,255,255,0.06)",
          borderRadius: 999,
          padding: 4,
          marginBottom: 14,
        }}
      >
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            style={{
              flex: 1,
              border: "none",
              borderRadius: 999,
              padding: "9px 0",
              fontSize: 14,
              fontWeight: 700,
              background: tab === t.key ? "#2E66F6" : "transparent",
              color: tab === t.key ? "#fff" : "#8fa3c4",
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* 랭킹 리스트 */}
      <ul style={{ listStyle: "none", display: "flex", flexDirection: "column", gap: 8 }}>
        {rows.map((r) => {
          const t = tierOf(r.score);
          return (
            <li
              key={r.rank}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 12,
                padding: "12px 14px",
                borderRadius: 14,
                background: r.me ? "rgba(46,102,246,0.22)" : "rgba(255,255,255,0.05)",
                border: r.me ? "1px solid #2E66F6" : "1px solid transparent",
              }}
            >
              <div style={{ width: 24, fontWeight: 800, color: r.rank <= 3 ? "#ffd23f" : "#8fa3c4" }}>
                {r.rank}
              </div>
              <div style={{ fontSize: 20 }}>{t.emoji}</div>
              <div style={{ flex: 1, fontWeight: r.me ? 800 : 600 }}>{r.name}</div>
              <div style={{ fontWeight: 800, color: "#ffd23f" }}>{r.score.toLocaleString()}</div>
            </li>
          );
        })}
      </ul>

      {/* 티켓 충전 선택 (광고 시청 / 포인트 교환) */}
      <section
        style={{
          marginTop: 22,
          background: "rgba(255,255,255,0.06)",
          borderRadius: 18,
          padding: 18,
        }}
      >
        <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 4 }}>티켓이 부족한가요?</div>
        <div style={{ fontSize: 13, color: "#8fa3c4", marginBottom: 14 }}>
          지급은 앱에서 처리됩니다.
        </div>
        <div style={{ display: "flex", gap: 10 }}>
          <button onClick={watchAd} style={chargeBtn("#2E66F6")}>
            📺 광고 시청
            <span style={{ display: "block", fontSize: 12, opacity: 0.8 }}>+1 티켓</span>
          </button>
          <button onClick={exchangePoints} style={chargeBtn("#3c4a63")}>
            💰 포인트 교환
            <span style={{ display: "block", fontSize: 12, opacity: 0.8 }}>+1 티켓</span>
          </button>
        </div>
      </section>
      </div>
    </main>
  );
}

function chargeBtn(bg: string): React.CSSProperties {
  return {
    flex: 1,
    border: "none",
    borderRadius: 14,
    padding: "14px 0",
    background: bg,
    color: "#fff",
    fontSize: 15,
    fontWeight: 700,
  };
}
