"use client";

// E7-3: 네이티브 브리지 디버그 오버레이 — 앱 웹뷰에서 devtools 없이 확인.
// 활성화: URL에 ?debug=1 (딥링크: /game?token=...&debug=1). 게임 화면·기능 불변(QA 도구).
// 표시: 감지된 브리지 채널 / 송신 로그(GAME_RESULT·NATIVE_ACTION) / JS 에러 / 테스트 발사 버튼.

import { useEffect, useState } from "react";
import { requestNativeAction, sendResultToNative, type BridgeLogEntry } from "@/lib/api";
import { setSfxMuted } from "@/lib/sfx";
import { pauseBgm, startBgm } from "@/lib/bgm";

interface ErrLine {
  ts: number;
  msg: string;
}

function detectBridge(): string {
  if (typeof window === "undefined") return "-";
  const w = window as unknown as {
    ReactNativeWebView?: unknown;
    webkit?: { messageHandlers?: Record<string, unknown> };
  };
  const found: string[] = [];
  if (w.ReactNativeWebView) found.push("ReactNativeWebView");
  const mh = w.webkit?.messageHandlers;
  if (mh?.gameResult) found.push("webkit.gameResult");
  if (mh?.nativeAction) found.push("webkit.nativeAction");
  if (window.parent && window.parent !== window) found.push("iframe.parent");
  return found.length ? found.join(" + ") : "없음(브라우저 단독) → 송신 채널 none";
}

export function BridgeDebug() {
  const [open, setOpen] = useState(true);
  const [logs, setLogs] = useState<BridgeLogEntry[]>([]);
  const [errs, setErrs] = useState<ErrLine[]>([]);
  const [env, setEnv] = useState("-");
  const [perf, setPerf] = useState("측정 중…");
  const [sfxOff, setSfxOff] = useState(false);
  const [bgmOff, setBgmOff] = useState(false);

  // E8-2: 실시간 렌더 계측 — 엔진 __ykPerf 훅 활성화, 1초 창 평균 표시
  useEffect(() => {
    const w = window as unknown as { __ykPerf?: boolean; __ykRender?: { ms: number; frames: number } };
    w.__ykPerf = true;
    let prev = { ms: 0, frames: 0 };
    const id = window.setInterval(() => {
      const a = w.__ykRender;
      if (!a) return;
      const df = a.frames - prev.frames;
      const dms = a.ms - prev.ms;
      prev = { ms: a.ms, frames: a.frames };
      if (df > 0) setPerf(`${df} fps · render ${(dms / df).toFixed(2)}ms/f`);
    }, 1000);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    setEnv(detectBridge());
    // 마운트 전 송신분(초기 GAME_RESULT 등)은 버퍼에서 복원
    const w = window as unknown as { __ykBridgeLog?: BridgeLogEntry[] };
    setLogs([...(w.__ykBridgeLog ?? [])]);
    const onBridge = (e: Event) => {
      const d = (e as CustomEvent<BridgeLogEntry>).detail;
      setLogs((prev) => [...prev.slice(-11), d]);
    };
    const onErr = (e: ErrorEvent) => {
      setErrs((prev) => [...prev.slice(-4), { ts: Date.now(), msg: e.message }]);
    };
    const onRej = (e: PromiseRejectionEvent) => {
      setErrs((prev) => [...prev.slice(-4), { ts: Date.now(), msg: `unhandled: ${String(e.reason).slice(0, 120)}` }]);
    };
    window.addEventListener("yk-bridge", onBridge);
    window.addEventListener("error", onErr);
    window.addEventListener("unhandledrejection", onRej);
    return () => {
      window.removeEventListener("yk-bridge", onBridge);
      window.removeEventListener("error", onErr);
      window.removeEventListener("unhandledrejection", onRej);
    };
  }, []);

  const t = (ts: number) => new Date(ts).toTimeString().slice(0, 8);

  if (!open) {
    return (
      <button onPointerDown={(e) => e.stopPropagation()} onClick={() => setOpen(true)} style={{ ...btn, position: "fixed", left: 6, bottom: 6, zIndex: 999 }}>
        🐞
      </button>
    );
  }

  return (
    <div
      onPointerDown={(e) => e.stopPropagation()}
      style={{
        position: "fixed",
        left: 6,
        bottom: 6,
        zIndex: 999,
        width: 320,
        maxHeight: "62vh",
        overflowY: "auto",
        background: "rgba(0,0,0,0.82)",
        color: "#9fe8a0",
        fontFamily: "Menlo, monospace",
        fontSize: 10,
        lineHeight: 1.5,
        padding: 8,
        borderRadius: 8,
        border: "1px solid rgba(255,255,255,0.25)",
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
        <b style={{ color: "#ffd23f" }}>🐞 브리지 디버그</b>
        <button onClick={() => setOpen(false)} style={btn}>
          접기
        </button>
      </div>
      <div style={{ color: "#8fd0ff" }}>감지: {env}</div>
      <div style={{ color: "#ffd97a" }}>성능: {perf}</div>
      <div style={{ color: "#8fa3c4", wordBreak: "break-all" }}>UA: {typeof navigator !== "undefined" ? navigator.userAgent.slice(0, 90) : "-"}</div>

      <div style={{ display: "flex", gap: 4, flexWrap: "wrap", margin: "6px 0" }}>
        <button style={btn} onClick={() => requestNativeAction("exitGame")}>exitGame</button>
        <button style={btn} onClick={() => requestNativeAction("watchAdForTicket")}>광고티켓</button>
        <button style={btn} onClick={() => requestNativeAction("shareResult")}>공유</button>
        <button
          style={{ ...btn, background: sfxOff ? "#888" : "#2E66F6" }}
          onClick={() => {
            const next = !sfxOff;
            setSfxOff(next);
            setSfxMuted(next);
          }}
        >
          SFX {sfxOff ? "켜기" : "끄기"}
        </button>
        <button
          style={{ ...btn, background: bgmOff ? "#888" : "#2E66F6" }}
          onClick={() => {
            const next = !bgmOff;
            setBgmOff(next);
            if (next) pauseBgm();
            else startBgm();
          }}
        >
          BGM {bgmOff ? "켜기" : "끄기"}
        </button>
        <button
          style={btn}
          onClick={() =>
            sendResultToNative({
              userId: "debug",
              coinCount: 1,
              rankScore: 123,
              playDuration: 5,
              timestamp: Date.now(),
              mode: "endless",
              outcome: "giveup",
              routeId: "endless",
              hits: 0,
              totalCoins: 1,
              sessionId: "debug-session",
              ticketUsed: 0,
              nickname: "디버그",
            })
          }
        >
          결과 테스트
        </button>
      </div>

      {errs.map((e, i) => (
        <div key={`e${i}`} style={{ color: "#ff8a8a" }}>
          {t(e.ts)} ⛔ {e.msg}
        </div>
      ))}
      {logs.length === 0 && <div style={{ color: "#8fa3c4" }}>아직 송신 없음 — 위 버튼으로 테스트</div>}
      {logs.map((l, i) => (
        <div key={i} style={{ borderTop: "1px solid rgba(255,255,255,0.08)", paddingTop: 2 }}>
          {t(l.ts)} <b style={{ color: l.channel === "none" ? "#ff8a8a" : "#ffd23f" }}>{l.channel}</b> {l.type}
          <div style={{ color: "#cdd8ec", wordBreak: "break-all" }}>{JSON.stringify(l.payload).slice(0, 160)}</div>
        </div>
      ))}
    </div>
  );
}

const btn: React.CSSProperties = {
  background: "#2E66F6",
  color: "#fff",
  border: "none",
  borderRadius: 6,
  fontSize: 10,
  fontFamily: "inherit",
  padding: "3px 8px",
  cursor: "pointer",
};
