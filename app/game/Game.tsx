"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { GameEngine } from "./engine/GameEngine";
import { CHASE, VIEW } from "./engine/config";
import type { GameResult, HudState } from "./engine/types";
import { parseToken } from "@/lib/auth";
import { requestNativeAction, sendResultToNative } from "@/lib/api";
import type { NativeAction } from "@/lib/api";
import { loadTickets, newSessionId, saveTickets } from "@/lib/tickets";
import Link from "next/link";

// 포인트-티켓 교환비 미확정(보류 항목) → 임시 환산율로 표시만
const POINT_RATE = 0.1;

const INITIAL_HUD: HudState = {
  phase: "ready",
  coins: 0,
  score: 0,
  hp: 3,
  boosterActive: false,
  slowActive: false,
  gap: CHASE.START_GAP,
  chaseRatio: CHASE.START_GAP / CHASE.MAX_GAP,
  dialogue: null,
};

export default function Game({ token }: { token?: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const engineRef = useRef<GameEngine | null>(null);
  const [hud, setHud] = useState<HudState>(INITIAL_HUD);
  const [result, setResult] = useState<GameResult | null>(null);

  // WP5: 티켓(표시용)·세션·충전(S5) 화면
  const [tickets, setTickets] = useState(0);
  const [showCharge, setShowCharge] = useState(false);
  const sessionRef = useRef<string>("");
  useEffect(() => setTickets(loadTickets()), []); // 클라이언트에서 로드

  // 1플레이 = 1티켓. 부족하면 S5 노출 후 false.
  const consumeTicket = useCallback((): boolean => {
    if (tickets <= 0) {
      setShowCharge(true);
      return false;
    }
    const left = tickets - 1;
    setTickets(left);
    saveTickets(left);
    sessionRef.current = newSessionId();
    return true;
  }, [tickets]);

  const handleGameOver = useCallback((r: GameResult) => {
    setResult(r);
    // WP5: 결과값 네이티브 전달 (postMessage 우선, 실패 시 콜백 스텁)
    sendResultToNative({ ...r, sessionId: sessionRef.current, ticketUsed: 1 });
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = VIEW.W * dpr;
    canvas.height = VIEW.H * dpr;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.scale(dpr, dpr);

    const user = parseToken(token);
    const engine = new GameEngine(ctx, user.userId, {
      onHud: setHud,
      onGameOver: handleGameOver,
    });
    engineRef.current = engine;
    engine.start();

    return () => engine.stop();
  }, [token, handleGameOver]);

  // 입력: 상단 탭=점프 / 화면 하단 홀드·아래 스와이프=슬라이드
  const gesture = useRef({ startY: 0, slid: false, hold: false });

  const onPointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (result) return; // 게임오버 화면은 버튼 사용
      const eng = engineRef.current;
      if (!eng) return;
      const rect = e.currentTarget.getBoundingClientRect();
      const ry = (e.clientY - rect.top) / rect.height;
      gesture.current = { startY: e.clientY, slid: false, hold: false };

      // 시작 전(ready): 티켓 소모 후 시작(부족하면 S5 충전 화면)
      if (hud.phase !== "playing") {
        if (showCharge) return; // 충전 화면은 자체 버튼 사용
        if (consumeTicket()) eng.onTap();
        return;
      }
      if (ry > 0.6) {
        eng.slide(); // 하단 홀드
        gesture.current.slid = true;
        gesture.current.hold = true;
      } else {
        eng.onTap(); // 상단 탭 = 점프
      }
    },
    [result, hud.phase, showCharge, consumeTicket]
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (result || gesture.current.slid) return;
      if (e.clientY - gesture.current.startY > 45) {
        engineRef.current?.slide(); // 아래 스와이프(자동 기립)
        gesture.current.slid = true;
      }
    },
    [result]
  );

  const onPointerUp = useCallback(() => {
    if (gesture.current.hold) engineRef.current?.endSlide();
    gesture.current.hold = false;
  }, []);

  const restart = useCallback(() => {
    if (!consumeTicket()) return; // 재도전도 1티켓
    setResult(null);
    engineRef.current?.restart();
  }, [consumeTicket]);

  // S5: 충전 요청은 네이티브에 위임(웹은 요청만). 개발 스텁으로 +1 반영.
  const charge = useCallback((action: NativeAction) => {
    requestNativeAction(action);
    setTickets((t) => {
      const next = t + 1;
      saveTickets(next);
      return next;
    });
    setShowCharge(false);
  }, []);

  // 데스크톱 개발용: 스페이스/↑=점프, ↓/S=슬라이드
  useEffect(() => {
    const onDown = (e: KeyboardEvent) => {
      if (result) return;
      if (e.code === "Space" || e.code === "ArrowUp") {
        e.preventDefault();
        engineRef.current?.onTap();
      } else if (e.code === "ArrowDown" || e.code === "KeyS") {
        e.preventDefault();
        if (!e.repeat) engineRef.current?.slide();
      }
    };
    const onUp = (e: KeyboardEvent) => {
      if (e.code === "ArrowDown" || e.code === "KeyS") engineRef.current?.endSlide();
    };
    window.addEventListener("keydown", onDown);
    window.addEventListener("keyup", onUp);
    return () => {
      window.removeEventListener("keydown", onDown);
      window.removeEventListener("keyup", onUp);
    };
  }, [result]);

  // 세로 감지 → 회전 안내. 지원 시 가로 잠금 시도(best-effort).
  const [isPortrait, setIsPortrait] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(orientation: portrait)");
    const update = () => setIsPortrait(mq.matches);
    update();
    mq.addEventListener?.("change", update);
    window.addEventListener("resize", update);
    const so = (window.screen as Screen & { orientation?: { lock?: (o: string) => Promise<void> } }).orientation;
    so?.lock?.("landscape").catch(() => {});
    return () => {
      mq.removeEventListener?.("change", update);
      window.removeEventListener("resize", update);
    };
  }, []);

  return (
    <main
      style={{
        height: "100%",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "#0e1526",
      }}
    >
      <div
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onPointerLeave={onPointerUp}
        style={{
          position: "relative",
          aspectRatio: `${VIEW.W} / ${VIEW.H}`,
          // 가로 contain: 폭을 채우고 넘치면 상하 레터박스
          width: "100%",
          maxHeight: "100%",
          touchAction: "none",
        }}
      >
        <canvas
          ref={canvasRef}
          style={{ width: "100%", height: "100%", display: "block" }}
        />

        {/* HUD */}
        <TopHud hud={hud} />

        {/* 박소장 추격 게이지 (WP2) */}
        {hud.phase === "playing" && <ChaseGauge hud={hud} />}

        {/* 대사 팝업 (5단계) */}
        {hud.dialogue && hud.phase === "playing" && (
          <DialogueBubble text={hud.dialogue} />
        )}

        {/* 시작 오버레이 (인트로 아트) */}
        {hud.phase === "ready" && !showCharge && <ReadyOverlay tickets={tickets} />}

        {/* 게임오버 오버레이 (S4) */}
        {hud.phase === "gameover" && result && !showCharge && (
          <GameOverOverlay result={result} tickets={tickets} onRestart={restart} />
        )}

        {/* 티켓 충전 (S5) */}
        {showCharge && (
          <ChargeOverlay onCharge={charge} onClose={() => setShowCharge(false)} />
        )}
      </div>

      {/* 세로일 때 가로 회전 안내 (WP0) */}
      {isPortrait && <RotateHint />}
    </main>
  );
}

function RotateHint() {
  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 100,
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
      <div style={{ fontSize: 54, animation: "rotateHint 1.6s ease-in-out infinite" }}>📱</div>
      <div style={{ fontSize: 20, fontWeight: 800 }}>가로로 돌려주세요</div>
      <div style={{ fontSize: 14, color: "#9fb0cc", lineHeight: 1.6 }}>
        야리끼리 대소동은 가로 화면에 최적화되어 있어요.
        <br />
        기기를 가로로 회전하면 게임이 시작됩니다.
      </div>
      <style>{`@keyframes rotateHint{0%,100%{transform:rotate(-12deg)}50%{transform:rotate(78deg)}}`}</style>
    </div>
  );
}

function ChaseGauge({ hud }: { hud: HudState }) {
  const r = hud.chaseRatio;
  // 안전(초록) → 주의(주황) → 위기(빨강)
  const color = r > 0.55 ? "#37c871" : r > 0.3 ? "#ff9500" : "#e63946";
  const danger = r <= 0.3;
  return (
    <div
      style={{
        position: "absolute",
        top: 62,
        left: 14,
        right: 14,
        pointerEvents: "none",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          marginBottom: 3,
          fontSize: 11,
          fontWeight: 700,
          color: danger ? "#ff6b6b" : "#cdd8ec",
          textShadow: "0 1px 2px rgba(0,0,0,.4)",
        }}
      >
        <span>🏃 박소장 추격</span>
        {danger && <span>· 따라잡히기 직전!</span>}
      </div>
      <div
        style={{
          height: 8,
          borderRadius: 999,
          background: "rgba(0,0,0,0.28)",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            height: "100%",
            width: `${Math.round(r * 100)}%`,
            background: color,
            borderRadius: 999,
            transition: "width 0.12s linear, background 0.2s",
            animation: danger ? "chasePulse 0.6s ease-in-out infinite" : "none",
          }}
        />
      </div>
      <style>{`@keyframes chasePulse{0%,100%{opacity:1}50%{opacity:0.5}}`}</style>
    </div>
  );
}

function TopHud({ hud }: { hud: HudState }) {
  return (
    <div
      style={{
        position: "absolute",
        top: 0,
        left: 0,
        right: 0,
        padding: "12px 14px",
        display: "flex",
        justifyContent: "space-between",
        alignItems: "flex-start",
        color: "#fff",
        pointerEvents: "none",
      }}
    >
      <div>
        <div style={{ display: "flex", gap: 4, marginBottom: 6 }}>
          {[0, 1, 2].map((i) => (
            <span key={i} style={{ fontSize: 18, filter: i < hud.hp ? "none" : "grayscale(1) opacity(0.35)" }}>
              🪖
            </span>
          ))}
        </div>
        <div style={{ display: "flex", gap: 6 }}>
          {hud.boosterActive && <Badge color="#ff9500">⚡ 무적</Badge>}
          {hud.slowActive && <Badge color="#e63946">🐢 피격 감속</Badge>}
        </div>
      </div>
      <div style={{ textAlign: "right", textShadow: "0 1px 3px rgba(0,0,0,.4)" }}>
        <div style={{ fontSize: 26, fontWeight: 800, lineHeight: 1 }}>
          {hud.score.toLocaleString()}
        </div>
        <div style={{ fontSize: 15, fontWeight: 700, color: "#ffd23f" }}>
          🟡 {hud.coins}
        </div>
      </div>
    </div>
  );
}

function Badge({ color, children }: { color: string; children: React.ReactNode }) {
  return (
    <span
      style={{
        background: color,
        color: "#fff",
        fontSize: 12,
        fontWeight: 700,
        padding: "3px 8px",
        borderRadius: 999,
      }}
    >
      {children}
    </span>
  );
}

function DialogueBubble({ text }: { text: string }) {
  return (
    <div
      style={{
        position: "absolute",
        top: "18%",
        left: "50%",
        transform: "translateX(-50%)",
        background: "rgba(31,42,68,0.92)",
        color: "#fff",
        padding: "10px 16px",
        borderRadius: 14,
        fontSize: 15,
        fontWeight: 600,
        maxWidth: "80%",
        textAlign: "center",
        pointerEvents: "none",
        boxShadow: "0 6px 20px rgba(0,0,0,.3)",
      }}
    >
      {text}
    </div>
  );
}

function ReadyOverlay({ tickets }: { tickets: number }) {
  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        // 인트로 아트(타이틀·퇴근 시작 버튼 포함). 탭하면 시작.
        backgroundImage: "url(/assets/intro.png)",
        backgroundSize: "cover",
        backgroundPosition: "center",
      }}
    >
      {/* 티켓 잔여 (WP5) */}
      <div
        style={{
          position: "absolute",
          top: 10,
          right: 12,
          background: "rgba(14,21,38,0.72)",
          color: "#ffd23f",
          fontSize: 15,
          fontWeight: 800,
          padding: "6px 14px",
          borderRadius: 999,
        }}
      >
        🎟 {tickets}
      </div>
      {/* 조작 안내 */}
      <div
        style={{
          position: "absolute",
          bottom: 8,
          left: 0,
          right: 0,
          textAlign: "center",
          fontSize: 12,
          fontWeight: 600,
          color: "#fff",
          textShadow: "0 1px 3px rgba(0,0,0,.7)",
        }}
      >
        상단 탭 = 점프(2단) · 하단 홀드/아래로 = 슬라이드
      </div>
    </div>
  );
}

// S4 결과 화면: 코인·랭크점수·예상 포인트·공유·랭킹·재도전 (WP5)
function GameOverOverlay({
  result,
  tickets,
  onRestart,
}: {
  result: GameResult;
  tickets: number;
  onRestart: () => void;
}) {
  const expectedPoints = Math.floor(result.rankScore * POINT_RATE);

  const share = () => {
    const text = `야리끼리 대소동 ${result.rankScore.toLocaleString()}점! 김반장의 퇴근을 도와줘 🏃`;
    if (typeof navigator !== "undefined" && navigator.share) {
      navigator.share({ title: "야리끼리 대소동", text }).catch(() => {});
    } else {
      requestNativeAction("shareResult");
    }
  };

  return (
    <div style={overlayStyle}>
      <div style={{ fontSize: 24, fontWeight: 800 }}>퇴근 실패!</div>
      <div style={{ color: "#cdd8ec", fontSize: 13, marginBottom: 12 }}>
        박소장에게 붙잡혔습니다… · 🎟 {tickets}
      </div>

      <div
        style={{
          display: "flex",
          gap: 10,
          alignItems: "stretch",
          marginBottom: 14,
        }}
      >
        <div style={resultCard}>
          <div style={resultLabel}>랭킹 점수</div>
          <div style={{ fontSize: 30, fontWeight: 800, color: "#ffd23f" }}>
            {result.rankScore.toLocaleString()}
          </div>
        </div>
        <div style={resultCard}>
          <div style={resultLabel}>획득 코인</div>
          <div style={{ fontSize: 30, fontWeight: 800 }}>🟡 {result.coinCount}</div>
        </div>
        <div style={resultCard}>
          <div style={resultLabel}>예상 포인트*</div>
          <div style={{ fontSize: 30, fontWeight: 800, color: "#8ee6d0" }}>
            {expectedPoints.toLocaleString()}P
          </div>
        </div>
      </div>
      <div style={{ fontSize: 11, color: "#8fa3c4", marginBottom: 14 }}>
        ⏱ {result.playDuration}초 · *교환비 확정 전 임시 환산, 지급은 앱에서 처리
      </div>

      <div style={{ display: "flex", gap: 10, width: "100%", maxWidth: 460 }}>
        <button onClick={onRestart} style={{ ...primaryBtn, flex: 1.2, marginBottom: 0 }}>
          다시 도전
        </button>
        <button onClick={share} style={{ ...secondaryBtn, flex: 1 }}>
          공유
        </button>
        <Link
          href="/ranking"
          style={{ ...secondaryBtn, flex: 1, textDecoration: "none" }}
        >
          랭킹 보기
        </Link>
      </div>
    </div>
  );
}

// S5 티켓 충전: 광고 시청 / 포인트 교환 / 친구 초대 — 요청 이벤트만(WP5)
function ChargeOverlay({
  onCharge,
  onClose,
}: {
  onCharge: (a: NativeAction) => void;
  onClose: () => void;
}) {
  return (
    <div style={overlayStyle}>
      <div style={{ fontSize: 22, fontWeight: 800 }}>티켓이 다 떨어졌어요!</div>
      <div style={{ color: "#8fa3c4", fontSize: 13, marginBottom: 18 }}>
        충전 방법을 고르면 앱에서 처리돼요.
      </div>
      <div style={{ display: "flex", gap: 10, width: "100%", maxWidth: 520 }}>
        <button onClick={() => onCharge("watchAdForTicket")} style={chargeCard("#2E66F6")}>
          📺 광고 시청
          <span style={chargeSub}>+1 티켓</span>
        </button>
        <button onClick={() => onCharge("exchangePointsForTicket")} style={chargeCard("#3c4a63")}>
          💰 포인트 교환
          <span style={chargeSub}>+1 티켓</span>
        </button>
        <button onClick={() => onCharge("inviteFriend")} style={chargeCard("#37c871")}>
          👷 친구 초대
          <span style={chargeSub}>+1 티켓</span>
        </button>
      </div>
      <button
        onClick={onClose}
        style={{ ...secondaryBtn, marginTop: 14, maxWidth: 200 }}
      >
        닫기
      </button>
    </div>
  );
}

const resultCard: React.CSSProperties = {
  background: "rgba(255,255,255,0.08)",
  borderRadius: 14,
  padding: "12px 18px",
  textAlign: "center",
  minWidth: 110,
};

const resultLabel: React.CSSProperties = {
  fontSize: 12,
  color: "#8fa3c4",
  marginBottom: 2,
};

function chargeCard(bg: string): React.CSSProperties {
  return {
    flex: 1,
    border: "none",
    borderRadius: 14,
    padding: "16px 0",
    background: bg,
    color: "#fff",
    fontSize: 15,
    fontWeight: 700,
  };
}

const chargeSub: React.CSSProperties = {
  display: "block",
  fontSize: 12,
  opacity: 0.85,
  marginTop: 2,
};

const overlayStyle: React.CSSProperties = {
  position: "absolute",
  inset: 0,
  background: "linear-gradient(180deg, rgba(14,21,38,0.72), rgba(14,21,38,0.9))",
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  justifyContent: "center",
  color: "#fff",
  padding: 28,
};

const primaryBtn: React.CSSProperties = {
  background: "#2E66F6",
  color: "#fff",
  border: "none",
  padding: "14px 40px",
  borderRadius: 999,
  fontSize: 17,
  fontWeight: 700,
  marginBottom: 12,
  width: "100%",
  maxWidth: 280,
};

const secondaryBtn: React.CSSProperties = {
  background: "transparent",
  color: "#cdd8ec",
  border: "1px solid rgba(255,255,255,0.3)",
  padding: "12px 40px",
  borderRadius: 999,
  fontSize: 15,
  fontWeight: 600,
  width: "100%",
  maxWidth: 280,
  textAlign: "center",
};
