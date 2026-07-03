"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { GameEngine } from "./engine/GameEngine";
import { VIEW } from "./engine/config";
import type { GameResult, HudState } from "./engine/types";
import { parseToken } from "@/lib/auth";
import { sendResult } from "@/lib/api";
import Link from "next/link";

const INITIAL_HUD: HudState = {
  phase: "ready",
  coins: 0,
  score: 0,
  hp: 3,
  boosterActive: false,
  coffeeActive: false,
  dialogue: null,
};

export default function Game({ token }: { token?: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const engineRef = useRef<GameEngine | null>(null);
  const [hud, setHud] = useState<HudState>(INITIAL_HUD);
  const [result, setResult] = useState<GameResult | null>(null);

  const handleGameOver = useCallback((r: GameResult) => {
    setResult(r);
    sendResult(r); // 4단계: 결과값 네이티브 전달 (postMessage 우선)
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

  const tap = useCallback(() => {
    if (result) return; // 게임오버 화면에서는 캔버스 탭 무시(버튼 사용)
    engineRef.current?.onTap();
  }, [result]);

  const restart = useCallback(() => {
    setResult(null);
    engineRef.current?.restart();
  }, []);

  // 데스크톱 개발용: 스페이스/위 방향키 점프
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code === "Space" || e.code === "ArrowUp") {
        e.preventDefault();
        if (!result) engineRef.current?.onTap();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [result]);

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
        onPointerDown={tap}
        style={{
          position: "relative",
          aspectRatio: `${VIEW.W} / ${VIEW.H}`,
          height: "100%",
          maxWidth: "100%",
          touchAction: "none",
        }}
      >
        <canvas
          ref={canvasRef}
          style={{ width: "100%", height: "100%", display: "block" }}
        />

        {/* HUD */}
        <TopHud hud={hud} />

        {/* 대사 팝업 (5단계) */}
        {hud.dialogue && hud.phase === "playing" && (
          <DialogueBubble text={hud.dialogue} />
        )}

        {/* 시작 오버레이 */}
        {hud.phase === "ready" && <ReadyOverlay />}

        {/* 게임오버 오버레이 */}
        {hud.phase === "gameover" && result && (
          <GameOverOverlay result={result} onRestart={restart} />
        )}
      </div>
    </main>
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
          {hud.coffeeActive && <Badge color="#7b5230">☕ 감속</Badge>}
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

function ReadyOverlay() {
  return (
    <div style={overlayStyle}>
      <div style={{ fontSize: 30, fontWeight: 800, marginBottom: 8 }}>야리끼리 대소동</div>
      <p style={{ color: "#cdd8ec", textAlign: "center", lineHeight: 1.6, marginBottom: 20 }}>
        김반장의 퇴근길을 지켜라!
        <br />
        <b>화면 터치</b>로 점프 (공중에서 한 번 더 = 2단 점프)
      </p>
      <div style={{ fontSize: 15, color: "#8fa3c4" }}>탭하여 시작</div>
    </div>
  );
}

function GameOverOverlay({
  result,
  onRestart,
}: {
  result: GameResult;
  onRestart: () => void;
}) {
  return (
    <div style={overlayStyle}>
      <div style={{ fontSize: 26, fontWeight: 800, marginBottom: 4 }}>퇴근 실패!</div>
      <div style={{ color: "#cdd8ec", marginBottom: 18 }}>박소장에게 붙잡혔습니다…</div>

      <div
        style={{
          background: "rgba(255,255,255,0.08)",
          borderRadius: 16,
          padding: "18px 24px",
          textAlign: "center",
          marginBottom: 22,
        }}
      >
        <div style={{ fontSize: 13, color: "#8fa3c4" }}>랭킹 점수</div>
        <div style={{ fontSize: 40, fontWeight: 800, color: "#ffd23f" }}>
          {result.rankScore.toLocaleString()}
        </div>
        <div style={{ marginTop: 8, fontSize: 14, color: "#cdd8ec" }}>
          🟡 코인 {result.coinCount}개 · ⏱ {result.playDuration}초
        </div>
      </div>

      <button onClick={onRestart} style={primaryBtn}>
        다시 도전
      </button>
      <Link href="/ranking" style={{ ...secondaryBtn, textDecoration: "none" }}>
        랭킹 보드 보기
      </Link>
    </div>
  );
}

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
