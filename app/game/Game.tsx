"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { GameEngine } from "./engine/GameEngine";
import { loadSprites } from "./engine/sprites";
import type { MapKey } from "./engine/Background";
import { CHASE, REWARD_SAFE_MODE, ROUTES, SCORE, VIEW } from "./engine/config";
import { EDU_ROUTE_ID, loadLevel, type LevelData, type RouteId } from "./engine/level";
import type { GameMode, GameResult, HudState } from "./engine/types";
import { parseToken } from "@/lib/auth";
import { daysLeft, fetchSeason, postSeasonScore, requestNativeAction, sendResultToNative } from "@/lib/api";
import type { NativeAction, SeasonBoard } from "@/lib/api";
import { loadTickets, newSessionId, saveTickets } from "@/lib/tickets";
import {
  addMeters,
  computeStars,
  loadEduDone,
  loadRouteProgress,
  loadTotalMeters,
  saveEduDone,
  saveRouteResult,
  type RouteProgress,
} from "@/lib/progress";
import { playSfx } from "@/lib/sfx";
import {
  fetchNickname,
  generateNickname,
  loadNickname,
  registerNickname,
  validateNickname,
} from "@/lib/nickname";
import Link from "next/link";

const APP_VERSION = "v0.2.0";
// 포인트-티켓 교환비 미확정(보류 항목) → 임시 환산율로 표시만
const POINT_RATE = 0.1;

const INITIAL_HUD: HudState = {
  phase: "ready",
  mode: "route",
  coins: 0,
  score: 0,
  hp: 3,
  boosterActive: false,
  slowActive: false,
  magnetActive: false,
  gap: CHASE.START_GAP,
  chaseRatio: CHASE.START_GAP / CHASE.MAX_GAP,
  progress: 0,
  finale: false,
  banner: null,
  dialogue: null,
};

type Screen = "title" | "nickname" | "lobby" | "game";

export default function Game({ token }: { token?: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const engineRef = useRef<GameEngine | null>(null);
  const [hud, setHud] = useState<HudState>(INITIAL_HUD);
  const [result, setResult] = useState<GameResult | null>(null);
  const [screen, setScreen] = useState<Screen>("title");

  // 유저 식별 (토큰 → userId). 닉네임은 userId에 귀속.
  const user = useMemo(() => parseToken(token), [token]);
  // E4: 랭킹 페이지(토큰 없이 진입)가 같은 유저로 조회하도록 마지막 userId 보관
  useEffect(() => {
    try {
      localStorage.setItem("yk_last_uid", user.userId);
    } catch {
      /* 프라이빗 모드 등 저장 불가 시 무시 */
    }
  }, [user.userId]);

  // 닉네임: 로컬 캐시 즉시 반영 → 서버 조회로 보정(기기 변경·캐시 삭제 대응)
  const [nickname, setNickname] = useState<string | null>(null);
  useEffect(() => {
    setNickname(loadNickname(user.userId));
    let alive = true;
    void fetchNickname(user.userId).then((n) => {
      if (alive && n) setNickname(n);
    });
    return () => {
      alive = false;
    };
  }, [user.userId]);

  // WP5: 티켓(표시용)·세션·충전(S5) 화면
  const [tickets, setTickets] = useState(0);
  const [showCharge, setShowCharge] = useState(false);
  const sessionRef = useRef<string>("");
  useEffect(() => setTickets(loadTickets()), []);

  // WP4: 스프라이트 프리로드
  const [spritesLoaded, setSpritesLoaded] = useState(false);
  useEffect(() => {
    let alive = true;
    loadSprites().then(() => alive && setSpritesLoaded(true));
    return () => {
      alive = false;
    };
  }, []);

  // WP6.5: 노선 진행(별점)·선택·레벨 캐시
  const [routeProgress, setRouteProgress] = useState<RouteProgress>({});
  const [selectedRoute, setSelectedRoute] = useState<RouteId>("route1");
  const [totalM, setTotalM] = useState(0);
  const [lastStars, setLastStars] = useState(0);
  const levelCache = useRef<Map<string, LevelData>>(new Map());
  useEffect(() => {
    setRouteProgress(loadRouteProgress());
    setTotalM(loadTotalMeters());
  }, []);

  // 1플레이 = 1티켓
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

  const currentRouteRef = useRef<RouteId>("route1");

  // E4: 주간 시즌 요약(로비 1줄 + D-day). 조회 실패 시 null → 조용히 숨김.
  const [season, setSeason] = useState<SeasonBoard | null>(null);
  useEffect(() => {
    if (screen !== "lobby") return;
    let alive = true;
    void fetchSeason(user.userId).then((s) => alive && setSeason(s));
    return () => {
      alive = false;
    };
  }, [screen, user.userId]);

  // E2: 안전교육 이수 게이트 + 현재 플레이 모드(재도전 티켓 분기용)
  const [eduDone, setEduDone] = useState(false);
  useEffect(() => setEduDone(loadEduDone()), []);
  const currentModeRef = useRef<GameMode>("route");

  // E3.10-2: 일시정지 — 버튼/백그라운드 전환 시. 포기는 모드별 분기.
  const [paused, setPaused] = useState(false);
  const pauseGame = useCallback(() => {
    engineRef.current?.pause();
    setPaused(true);
  }, []);
  const resumeGame = useCallback(() => {
    engineRef.current?.resume();
    setPaused(false);
  }, []);
  const giveUpGame = useCallback(() => {
    const eng = engineRef.current;
    if (!eng) return;
    setPaused(false);
    if (currentModeRef.current === "endless") {
      // 엔들리스: 현재 기록으로 정상 종료 → 결과 전달(handleGameOver 경유)
      eng.giveUp();
    } else {
      // 안전교육·노선: 저장 없이 로비 복귀
      eng.backToReady();
      setResult(null);
      setScreen("lobby");
    }
  }, []);
  // 탭 전환·백그라운드 진입 시 자동 일시정지
  const pausedRef = useRef(false);
  useEffect(() => {
    pausedRef.current = paused;
  }, [paused]);
  const hudPhaseRef = useRef(hud.phase);
  useEffect(() => {
    hudPhaseRef.current = hud.phase;
  }, [hud.phase]);
  useEffect(() => {
    const onVis = () => {
      if (document.hidden && hudPhaseRef.current === "playing" && !pausedRef.current) {
        engineRef.current?.pause();
        setPaused(true);
      }
    };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, []);
  // 방금 이수 완료(첫 이수 연출용)
  const [justUnlocked, setJustUnlocked] = useState(false);

  // 결과 전달 시 최신 닉네임 참조(콜백 stale 방지)
  const nicknameRef = useRef<string | null>(null);
  useEffect(() => {
    nicknameRef.current = nickname;
  }, [nickname]);

  const eduDoneRef = useRef(false);
  useEffect(() => {
    eduDoneRef.current = eduDone;
  }, [eduDone]);

  const handleGameOver = useCallback((r: GameResult) => {
    setResult(r);
    const nativeResult = {
      ...r,
      sessionId: sessionRef.current,
      ticketUsed: r.mode === "edu" ? 0 : 1, // 안전교육은 티켓 미차감
      nickname: nicknameRef.current ?? "",
    };
    sendResultToNative(nativeResult);
    void postSeasonScore(nativeResult); // E4: 엔들리스 결과를 주간 시즌 베스트 후보로 전달
    setTotalM(addMeters(engineRef.current?.distanceM ?? 0));
    if (r.outcome === "cleared") {
      if (r.mode === "edu") {
        // E2: 안전교육 이수 → 본선 즉시 해금. TODO(서버 이관): userId 기준 서버 저장.
        setJustUnlocked(!eduDoneRef.current);
        saveEduDone();
        setEduDone(true);
      } else {
        // 별점 계산·저장 (WP6.5 — UI 미노출, 데이터는 보관)
        const stars = computeStars(r.hits, r.coinCount, r.totalCoins);
        setLastStars(stars);
        setRouteProgress(saveRouteResult(r.routeId, stars, r.playDuration, r.coinCount));
      }
    }
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
    const engine = new GameEngine(ctx, user.userId, {
      onHud: setHud,
      onGameOver: handleGameOver,
    });
    engineRef.current = engine;
    engine.start();
    return () => engine.stop();
  }, [user.userId, handleGameOver]);

  // 노선 시작 — E2에서 월드맵 제거로 미사용. 보너스 미션 재활용 대비 보관(v3 지시).
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [flash, setFlash] = useState(false);
  const startRoute = useCallback(
    async (routeId: RouteId) => {
      const eng = engineRef.current;
      if (!eng || !spritesLoaded || showCharge) return;
      if (!consumeTicket()) return;
      playSfx("button_click");
      try {
        let level = levelCache.current.get(routeId);
        if (!level) {
          level = await loadLevel(routeId);
          levelCache.current.set(routeId, level);
        }
        const meta = ROUTES.find((r) => r.id === routeId);
        eng.setLevel(level, (meta?.mapKey ?? "map1") as MapKey);
        currentRouteRef.current = routeId;
        currentModeRef.current = "route";
        setResult(null);
        setFlash(true);
        setScreen("game");
        eng.onTap();
        window.setTimeout(() => setFlash(false), 450);
      } catch (e) {
        console.error("노선 로드 실패:", routeId, e);
      }
    },
    [spritesLoaded, showCharge, consumeTicket]
  );

  // E2: 무한 잔업 모드(랭킹 본선) — 안전교육 이수 필수, 티켓 1장 차감
  const startEndless = useCallback(() => {
    const eng = engineRef.current;
    if (!eng || !spritesLoaded || showCharge || !eduDone) return;
    if (!consumeTicket()) return;
    playSfx("button_click");
    eng.setEndless("map1");
    currentModeRef.current = "endless";
    setResult(null);
    setFlash(true);
    setScreen("game");
    eng.onTap();
    window.setTimeout(() => setFlash(false), 450);
  }, [spritesLoaded, showCharge, eduDone, consumeTicket]);

  // E2/E3: 안전교육 — 티켓 미차감, 언제든 재입장. 전용 노선 route_edu 재생.
  const startEdu = useCallback(async () => {
    const eng = engineRef.current;
    if (!eng || !spritesLoaded || showCharge) return;
    playSfx("button_click");
    try {
      const routeId = EDU_ROUTE_ID;
      let level = levelCache.current.get(routeId);
      if (!level) {
        level = await loadLevel(routeId);
        levelCache.current.set(routeId, level);
      }
      sessionRef.current = newSessionId(); // 티켓 없이 세션만 발급
      eng.setLevel(level, "map1", "edu");
      currentModeRef.current = "edu";
      setResult(null);
      setFlash(true);
      setScreen("game");
      eng.onTap();
      window.setTimeout(() => setFlash(false), 450);
    } catch (e) {
      console.error("안전교육 노선 로드 실패:", e);
    }
  }, [spritesLoaded, showCharge]);

  const restart = useCallback(() => {
    // 안전교육은 무료 재연습, 본선·노선은 티켓 1장
    if (currentModeRef.current !== "edu" && !consumeTicket()) return;
    playSfx("button_click");
    setResult(null);
    engineRef.current?.restart();
  }, [consumeTicket]);

  const goLobby = useCallback(() => {
    playSfx("button_click");
    setResult(null);
    engineRef.current?.backToReady();
    setScreen("lobby");
  }, []);


  // S5: 충전 요청(네이티브 위임) + 개발 스텁 +1
  const charge = useCallback((action: NativeAction) => {
    requestNativeAction(action);
    setTickets((t) => {
      const next = t + 1;
      saveTickets(next);
      return next;
    });
    setShowCharge(false);
  }, []);

  // ── 입력(양손, 쿠키런식): 왼쪽 절반 홀드=슬라이드 / 오른쪽 절반 탭=점프 ──
  // 아래 스와이프 슬라이드는 보조 입력으로 유지.
  // 손가락별(pointerId) 추적 — 왼손 슬라이드 홀드 중 오른손 점프 탭 가능.
  const pointers = useRef(new Map<number, { startY: number; slide: boolean }>());

  const onPointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (result || screen !== "game") return;
      const eng = engineRef.current;
      if (!eng) return;
      const rect = e.currentTarget.getBoundingClientRect();
      const rx = (e.clientX - rect.left) / rect.width;
      pointers.current.set(e.pointerId, { startY: e.clientY, slide: false });
      if (hud.phase !== "playing") return;
      if (rx < 0.5) {
        eng.slide();
        const p = pointers.current.get(e.pointerId);
        if (p) p.slide = true;
      } else {
        eng.onTap();
      }
    },
    [result, screen, hud.phase]
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (result) return;
      const p = pointers.current.get(e.pointerId);
      if (!p || p.slide) return;
      // 오른쪽 구역에서도 아래로 45px 이상 끌면 슬라이드
      if (e.clientY - p.startY > 45) {
        engineRef.current?.slide();
        p.slide = true;
      }
    },
    [result]
  );

  const onPointerUp = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    const p = pointers.current.get(e.pointerId);
    pointers.current.delete(e.pointerId);
    if (!p?.slide) return;
    // 다른 손가락이 아직 슬라이드 홀드 중이면 유지
    const stillSliding = Array.from(pointers.current.values()).some((v) => v.slide);
    if (!stillSliding) engineRef.current?.endSlide();
  }, []);

  // 데스크톱: 스페이스/↑=점프, ↓/S=슬라이드
  useEffect(() => {
    const onDown = (e: KeyboardEvent) => {
      if (result || screen !== "game") return;
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
  }, [result, screen]);

  // 세로 감지 → 회전 안내
  const [isPortrait, setIsPortrait] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(orientation: portrait)");
    const update = () => setIsPortrait(mq.matches);
    update();
    mq.addEventListener?.("change", update);
    window.addEventListener("resize", update);
    const so = (window.screen as unknown as Screen2).orientation;
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
          width: "100%",
          maxHeight: "100%",
          touchAction: "none",
        }}
      >
        <canvas
          ref={canvasRef}
          style={{ width: "100%", height: "100%", display: "block" }}
        />

        {/* 게임 HUD (S2) */}
        {screen === "game" && hud.phase === "playing" && (
          <>
            <TopHud hud={hud} />
            {/* E3.5-8: 추격 게이지 제거 — 위험 신호는 박소장 실거리 + 가장자리 비네트가 담당 */}
            <ProgressBar hud={hud} />
            {hud.banner && <SectionBanner text={hud.banner} />}
            {hud.dialogue && <DialogueBubble text={hud.dialogue} />}
            <ControlHints />
            {/* E3.10-2: 일시정지 — 우상단 모서리 고정, 점프 입력과 분리(stopPropagation) */}
            {!paused && (
              <button
                onPointerDown={(e) => e.stopPropagation()}
                onClick={pauseGame}
                aria-label="일시정지"
                style={{
                  ...hudPanel,
                  position: "absolute",
                  top: 12,
                  right: 14,
                  border: "none",
                  color: "#fff",
                  fontSize: 20,
                  lineHeight: 1,
                  padding: "14px 13px",
                  cursor: "pointer",
                }}
              >
                ⏸
              </button>
            )}
            {paused && (
              <PauseOverlay
                mode={currentModeRef.current}
                onResume={resumeGame}
                onGiveUp={giveUpGame}
              />
            )}
          </>
        )}

        {/* S1 타이틀: 로고·버전·[퇴근 시작] */}
        {screen === "title" && (
          <TitleScreen
            loading={!spritesLoaded}
            onStart={() => {
              playSfx("button_click");
              // 최초 1회만 닉네임 등록, 이후엔 로비 직행 (기획 2.5)
              setScreen(nickname ? "lobby" : "nickname");
            }}
          />
        )}

        {/* S1.2 닉네임 등록 (최초 1회) */}
        {screen === "nickname" && (
          <NicknameScreen
            userId={user.userId}
            onDone={(name) => {
              setNickname(name);
              setScreen("lobby");
            }}
          />
        )}

        {/* S1.5 로비 — 2버튼 (E2: 안전교육 / 무한 잔업 모드) */}
        {screen === "lobby" && !showCharge && (
          <LobbyScreen
            nickname={nickname}
            tickets={tickets}
            totalM={totalM}
            eduDone={eduDone}
            season={season}
            onStartEdu={startEdu}
            onStartEndless={startEndless}
            loading={!spritesLoaded}
          />
        )}

        {/* S3a 완주 성공 — 안전교육 전용 (E2) */}
        {screen === "game" && hud.phase === "cleared" && result && !showCharge && (
          <ClearOverlay
            result={result}
            tickets={tickets}
            justUnlocked={justUnlocked}
            onGoEndless={startEndless}
            onRetryEdu={restart}
            onLobby={goLobby}
          />
        )}

        {/* S3b 실패(게임오버) */}
        {screen === "game" && hud.phase === "gameover" && result && !showCharge && (
          <GameOverOverlay
            result={result}
            tickets={tickets}
            onRestart={restart}
            onLobby={goLobby}
          />
        )}

        {/* S5 티켓 충전 */}
        {showCharge && (
          <ChargeOverlay onCharge={charge} onClose={() => setShowCharge(false)} />
        )}

        {/* 시작 화이트 플래시 */}
        {flash && (
          <div
            style={{
              position: "absolute",
              inset: 0,
              background: "#fff",
              zIndex: 60,
              pointerEvents: "none",
              animation: "flashOut 0.45s ease-out forwards",
            }}
          />
        )}
        <style>{`@keyframes flashOut{from{opacity:1}to{opacity:0}}`}</style>
      </div>

      {isPortrait && <RotateHint />}
    </main>
  );
}

interface Screen2 {
  orientation?: { lock?: (o: string) => Promise<void> };
}

// ── S1 타이틀: 로고·버전·[퇴근 시작]만 ──
function TitleScreen({
  loading,
  onStart,
}: {
  loading: boolean;
  onStart: () => void;
}) {
  return (
    <div style={{ position: "absolute", inset: 0, overflow: "hidden" }}>
      <div
        style={{
          position: "absolute",
          inset: 0,
          backgroundImage: "url(/assets/ui/title/bg.jpg)",
          backgroundSize: "cover",
          backgroundPosition: "center",
          animation: "titleZoom 26s ease-in-out infinite alternate",
        }}
      />
      {Array.from({ length: 6 }, (_, i) => (
        <div
          key={i}
          style={{
            position: "absolute",
            left: `${8 + i * 15}%`,
            bottom: "14%",
            width: 4 + (i % 3) * 3,
            height: 4 + (i % 3) * 3,
            borderRadius: "50%",
            background: "rgba(255,236,200,0.55)",
            animation: `dustFloat ${6 + i * 1.6}s linear ${i * 1.2}s infinite`,
            pointerEvents: "none",
          }}
        />
      ))}
      <div
        style={{
          position: "absolute",
          top: "5%",
          left: 0,
          right: 0,
          display: "flex",
          justifyContent: "center",
          animation: "logoPop 0.6s cubic-bezier(.34,1.56,.64,1) both",
          pointerEvents: "none",
        }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/assets/ui/title/logo.png"
          alt="야리끼리 대소동 — 퇴근길 런런런!"
          draggable={false}
          style={{ width: "38%", animation: "logoBob 3.2s ease-in-out 0.6s infinite" }}
        />
      </div>
      <div
        onPointerDown={(e) => e.stopPropagation()}
        style={{ position: "absolute", bottom: "6%", left: "50%", transform: "translateX(-50%)" }}
      >
        <button
          onClick={onStart}
          disabled={loading}
          className="titleStartBtn"
          aria-label="퇴근 시작"
          style={{
            background: "none",
            border: "none",
            padding: 0,
            cursor: loading ? "default" : "pointer",
            animation: loading ? "none" : "btnPulse 1.8s ease-in-out infinite",
          }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/assets/ui/title/btn_start.png"
            alt=""
            draggable={false}
            style={{
              width: "min(270px, 36vw)",
              display: "block",
              transition: "transform 0.12s ease",
              filter: loading ? "grayscale(0.6) opacity(0.7)" : "none",
            }}
          />
        </button>
      </div>
      {/* 버전 */}
      <div
        style={{
          position: "absolute",
          bottom: 8,
          right: 12,
          fontSize: 11,
          fontWeight: 600,
          color: "rgba(255,255,255,0.75)",
          textShadow: "0 1px 2px rgba(0,0,0,.6)",
        }}
      >
        {APP_VERSION}
      </div>
      {loading && (
        <div
          style={{
            position: "absolute",
            bottom: 8,
            left: 12,
            fontSize: 12,
            fontWeight: 600,
            color: "#fff",
            textShadow: "0 1px 3px rgba(0,0,0,.7)",
          }}
        >
          ⏳ 현장 준비 중…
        </div>
      )}
      <style>{`
        @keyframes titleZoom { from { transform: scale(1); } to { transform: scale(1.07); } }
        @keyframes logoPop { 0% { transform: scale(0.8); opacity: 0; } 60% { transform: scale(1.06); opacity: 1; } 100% { transform: scale(1); } }
        @keyframes logoBob { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-9px); } }
        @keyframes btnPulse { 0%, 100% { transform: scale(1); } 50% { transform: scale(1.045); } }
        @keyframes dustFloat { 0% { transform: translate(0, 0); opacity: 0; } 15% { opacity: 0.6; } 100% { transform: translate(70px, -150px); opacity: 0; } }
        .titleStartBtn:hover img { transform: scale(1.06); }
        .titleStartBtn:active img { transform: scale(0.94); }
      `}</style>
    </div>
  );
}

// ── 조작 힌트: 왼손 슬라이드 / 오른손 점프 (양손 조작 안내) ──
// 시작 후 4초간 보였다가 서서히 사라진다. 매 판 노출(학습 비용 낮은 타깃 배려).
function ControlHints() {
  const pill: React.CSSProperties = {
    position: "absolute",
    bottom: 14,
    padding: "6px 14px",
    borderRadius: 999,
    background: "rgba(0,0,0,0.35)",
    color: "#fff",
    fontSize: 12,
    fontWeight: 800,
    pointerEvents: "none",
    animation: "hintFade 4s ease-out forwards",
  };
  return (
    <>
      <div style={{ ...pill, left: "12%" }}>왼쪽 누르면 슬라이드</div>
      <div style={{ ...pill, right: "12%" }}>오른쪽 탭하면 점프</div>
      <style>{`@keyframes hintFade{0%,70%{opacity:1}100%{opacity:0}}`}</style>
    </>
  );
}

// ── S1.2 닉네임 등록 (최초 1회, 기획 2.5) ──
// 자동 생성 기본 + 다시 뽑기(주사위) + 직접 입력 전환. 타이핑 0으로 등록 가능.
// 중복은 서버(/api/nickname)가 판정하고 대안("불도저 김씨2")을 제시한다.
function NicknameScreen({
  userId,
  onDone,
}: {
  userId: string;
  onDone: (name: string) => void;
}) {
  const [candidate, setCandidate] = useState(() => generateNickname());
  const [manual, setManual] = useState(false);
  const [input, setInput] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const reroll = () => {
    playSfx("button_click");
    setError(null);
    setCandidate(generateNickname(candidate));
  };

  const confirm = async () => {
    if (busy) return;
    const raw = manual ? input : candidate;
    const v = validateNickname(raw);
    if (!v.ok) {
      setError(v.reason);
      return;
    }
    setBusy(true);
    setError(null);
    const res = await registerNickname(userId, v.name);
    setBusy(false);
    if (res.ok) {
      playSfx("button_click");
      onDone(res.name);
      return;
    }
    if (res.reason === "duplicate") {
      // 서버 대안을 후보로 올려 원탭 재확정 가능하게
      setError(`이미 사용 중인 이름이에요. "${res.suggestion}"은 어때요?`);
      setManual(false);
      setCandidate(res.suggestion);
      return;
    }
    setError("사용할 수 없는 이름이에요");
  };

  return (
    <div
      onPointerDown={(e) => e.stopPropagation()}
      style={{
        position: "absolute",
        inset: 0,
        background: "linear-gradient(180deg, #1F2A44 0%, #0e1526 100%)",
        color: "#fff",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 14,
        padding: "16px 24px",
        zIndex: 40,
      }}
    >
      <div style={{ fontSize: 13, fontWeight: 700, color: "#8fa3c4", letterSpacing: 2 }}>
        현장 등록
      </div>
      <div style={{ fontSize: 20, fontWeight: 800 }}>랭킹판에 올릴 이름을 정해주세요</div>

      {!manual ? (
        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          <div
            style={{
              minWidth: 260,
              textAlign: "center",
              fontSize: 28,
              fontWeight: 900,
              color: "#ffd23f",
              background: "rgba(255,255,255,0.06)",
              border: "2px solid rgba(255,210,63,0.4)",
              borderRadius: 14,
              padding: "14px 20px",
            }}
          >
            {candidate}
          </div>
          <button
            onClick={reroll}
            aria-label="다른 이름 뽑기"
            style={{
              background: "rgba(255,255,255,0.1)",
              border: "none",
              color: "#fff",
              fontSize: 14,
              fontWeight: 800,
              padding: "14px 16px",
              borderRadius: 14,
              cursor: "pointer",
            }}
          >
            다시 뽑기
          </button>
        </div>
      ) : (
        <input
          value={input}
          onChange={(e) => {
            setInput(e.target.value);
            setError(null);
          }}
          onKeyDown={(e) => e.key === "Enter" && void confirm()}
          placeholder="2~10자, 한글·영문·숫자"
          maxLength={10}
          autoFocus
          style={{
            width: 300,
            textAlign: "center",
            fontSize: 24,
            fontWeight: 800,
            color: "#ffd23f",
            background: "rgba(255,255,255,0.06)",
            border: "2px solid rgba(255,210,63,0.4)",
            borderRadius: 14,
            padding: "14px 20px",
            outline: "none",
          }}
        />
      )}

      <div style={{ minHeight: 20, fontSize: 13, fontWeight: 700, color: "#ff7a6b" }}>
        {error}
      </div>

      <button
        onClick={() => void confirm()}
        disabled={busy || (manual && input.trim().length < 2)}
        style={{
          background: busy ? "#5d6b84" : "#ffd23f",
          color: "#1F2A44",
          border: "none",
          fontSize: 18,
          fontWeight: 900,
          padding: "14px 44px",
          borderRadius: 999,
          cursor: busy ? "default" : "pointer",
        }}
      >
        {busy ? "등록 중..." : "이 이름으로 참가"}
      </button>

      <button
        onClick={() => {
          playSfx("button_click");
          setError(null);
          if (!manual) setInput("");
          setManual(!manual);
        }}
        style={{
          background: "none",
          border: "none",
          color: "#8fa3c4",
          fontSize: 13,
          fontWeight: 700,
          textDecoration: "underline",
          cursor: "pointer",
        }}
      >
        {manual ? "자동으로 뽑을래요" : "직접 입력할래요"}
      </button>

      <div style={{ fontSize: 11, color: "#5d6b84" }}>
        닉네임은 랭킹판·명예의 전당에 표시됩니다
      </div>
    </div>
  );
}

// ── S1.5 로비 (E2): [안전교육] [무한 잔업 모드] 2버튼 ──
function LobbyScreen({
  nickname,
  tickets,
  totalM,
  eduDone,
  season,
  onStartEdu,
  onStartEndless,
  loading,
}: {
  nickname: string | null;
  tickets: number;
  totalM: number;
  eduDone: boolean;
  season: SeasonBoard | null;
  onStartEdu: () => void;
  onStartEndless: () => void;
  loading: boolean;
}) {
  return (
    <div
      onPointerDown={(e) => e.stopPropagation()}
      style={{
        position: "absolute",
        inset: 0,
        background: "linear-gradient(180deg, #1F2A44 0%, #0e1526 100%)",
        color: "#fff",
        display: "flex",
        flexDirection: "column",
        padding: "14px 18px",
      }}
    >
      {/* 헤더: 닉네임 + 티켓 (상점 버튼 제거 — WP7 취소) */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{ fontSize: 18, fontWeight: 800 }}>👷 {nickname ?? "김반장"}</div>
          <span style={{ fontSize: 12, color: "#8fa3c4" }}>누적 {totalM.toLocaleString()}m</span>
          {/* E4: 이번 주 내 점수·순위 + D-day (조회 실패·기록 없음 시 숨김) */}
          {season && (
            <Link
              href="/ranking"
              style={{
                fontSize: 12,
                color: "#ffd23f",
                textDecoration: "none",
                background: "rgba(255,210,63,0.12)",
                padding: "3px 10px",
                borderRadius: 999,
              }}
            >
              🏆 {season.round}R · D-{daysLeft(season.endsAt)}
              {season.me &&
                ` · 이번 주 ${season.me.weekScore.toLocaleString()}점 ${season.me.rank}위`}
            </Link>
          )}
        </div>
        <span
          style={{
            background: "rgba(255,255,255,0.1)",
            color: "#ffd23f",
            fontSize: 14,
            fontWeight: 800,
            padding: "4px 12px",
            borderRadius: 999,
          }}
        >
          🎟 {tickets}
        </span>
      </div>

      {/* 2버튼: 안전교육 / 무한 잔업 모드 */}
      <div style={{ display: "flex", gap: 14, flex: 1, alignItems: "stretch", margin: "14px 0 8px" }}>
        {/* 안전교육 */}
        <button
          onClick={onStartEdu}
          disabled={loading}
          style={{
            flex: 1,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            gap: 8,
            borderRadius: 20,
            border: "3px solid rgba(94,200,255,0.5)",
            background: "linear-gradient(180deg, rgba(46,102,246,0.3), rgba(46,102,246,0.12))",
            color: "#fff",
            cursor: loading ? "default" : "pointer",
            opacity: loading ? 0.6 : 1,
            position: "relative",
          }}
        >
          {eduDone && (
            <span
              style={{
                position: "absolute",
                top: 10,
                right: 12,
                fontSize: 12,
                fontWeight: 800,
                color: "#8ee6d0",
                background: "rgba(0,0,0,0.3)",
                padding: "3px 10px",
                borderRadius: 999,
              }}
            >
              이수 완료 ✓
            </span>
          )}
          <div style={{ fontSize: 42 }}>🦺</div>
          <div style={{ fontSize: 22, fontWeight: 800 }}>안전교육</div>
          <div style={{ fontSize: 13, color: "#9fc4e8" }}>조작 연습 · 무료</div>
        </button>

        {/* 로비 대기 연출: 서류 든 김반장 (AI 시트 mixed) */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/assets/sprites/gimbanjang_custom/idle_docs.webp"
          alt=""
          aria-hidden
          draggable={false}
          style={{
            position: "absolute",
            left: 16,
            bottom: 10,
            height: 118,
            width: "auto",
            pointerEvents: "none",
            filter: "drop-shadow(0 4px 8px rgba(0,0,0,0.45))",
          }}
        />

        {/* 무한 잔업 모드 — 이수 전 잠금 */}
        <button
          onClick={onStartEndless}
          disabled={loading || !eduDone}
          style={{
            flex: 1,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            gap: 8,
            borderRadius: 20,
            border: eduDone ? "3px solid rgba(255,180,60,0.6)" : "3px solid rgba(255,255,255,0.08)",
            background: eduDone
              ? "linear-gradient(180deg, rgba(224,138,30,0.35), rgba(224,138,30,0.12))"
              : "rgba(255,255,255,0.04)",
            color: eduDone ? "#fff" : "#5d6b84",
            cursor: loading || !eduDone ? "default" : "pointer",
            opacity: loading ? 0.6 : 1,
          }}
        >
          <div style={{ fontSize: 42 }}>{eduDone ? "🔥" : "🔒"}</div>
          <div style={{ fontSize: 22, fontWeight: 800 }}>무한 잔업 모드</div>
          <div style={{ fontSize: 13, color: eduDone ? "#f0c58a" : "#5d6b84" }}>
            {eduDone ? "랭킹전 · 티켓 1장" : "안전교육 이수 후 참가 가능"}
          </div>
        </button>
      </div>
    </div>
  );
}
// ── S2 HUD ──
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
      {/* E3.7-6: HUD 가독성 — 반투명 다크 패널로 배경과 분리 */}
      <div>
        {/* E3.10-4: HP 표시 확대 — 코인 카운터(우측 패널)와 동급의 시각 크기 */}
        <div style={{ ...hudPanel, display: "flex", gap: 6, marginBottom: 6, padding: "6px 12px" }}>
          {[0, 1, 2].map((i) => (
            <span
              key={i}
              style={{
                fontSize: 26,
                lineHeight: 1,
                filter: i < hud.hp ? "none" : "grayscale(1) opacity(0.35)",
              }}
            >
              🪖
            </span>
          ))}
        </div>
        <div style={{ display: "flex", gap: 6 }}>
          {hud.boosterActive && <Badge color="#ff9500">⚡ 무적</Badge>}
          {hud.magnetActive && <Badge color="#5ec8ff">🧲 자석</Badge>}
          {hud.slowActive && <Badge color="#e63946">🐢 피격 감속</Badge>}
        </div>
      </div>
      {/* E3.10: 점수·코인 패널 — 우상단 모서리의 일시정지 버튼 왼쪽에 배치 */}
      <div
        style={{
          ...hudPanel,
          textAlign: "right",
          textShadow: "0 1px 3px rgba(0,0,0,.4)",
          marginRight: 52,
        }}
      >
        <div style={{ fontSize: 26, fontWeight: 800, lineHeight: 1 }}>
          {hud.score.toLocaleString()}
        </div>
        <div style={{ fontSize: 15, fontWeight: 700, color: "#ffd23f" }}>🟡 {hud.coins}</div>
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

// 컴팩트 추격 게이지(좌상단) — E3.5-8에서 HUD 단순화로 미사용 보관(렌더 제거)
// eslint-disable-next-line @typescript-eslint/no-unused-vars
function ChaseGauge({ hud }: { hud: HudState }) {
  const r = hud.chaseRatio;
  const color = r > 0.55 ? "#37c871" : r > 0.3 ? "#ff9500" : "#e63946";
  // E3.5: 안전교육에선 위기 연출(펄스·"위험!") 끔 — 게이지는 정보로만
  const danger = r <= 0.3 && hud.mode !== "edu";
  return (
    <div
      style={{
        position: "absolute",
        top: 64,
        left: 14,
        display: "flex",
        alignItems: "center",
        gap: 6,
        background: "rgba(14,21,38,0.55)",
        borderRadius: 999,
        padding: "4px 10px 4px 5px",
        pointerEvents: "none",
        animation: danger ? "chasePulse 0.6s ease-in-out infinite" : "none",
      }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src="/assets/sprites/parksojang_custom/idle.webp"
        alt="박소장"
        style={{ height: 22, width: "auto" }}
        draggable={false}
      />
      <div
        style={{
          width: 96,
          height: 7,
          borderRadius: 999,
          background: "rgba(0,0,0,0.35)",
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
          }}
        />
      </div>
      {danger && <span style={{ fontSize: 10, fontWeight: 800, color: "#ff6b6b" }}>위험!</span>}
      <style>{`@keyframes chasePulse{0%,100%{opacity:1}50%{opacity:0.55}}`}</style>
    </div>
  );
}

// 정류장까지 진행도 바(상단 중앙) — 피날레 구간 붉은 펄스
function ProgressBar({ hud }: { hud: HudState }) {
  return (
    <div
      style={{
        ...hudPanel, // E3.7-6: 배경과 무관하게 읽히는 다크 패널
        position: "absolute",
        top: 12,
        left: "50%",
        transform: "translateX(-50%)",
        width: "38%",
        display: "flex",
        alignItems: "center",
        gap: 6,
        pointerEvents: "none",
      }}
    >
      <span style={{ fontSize: 13 }}>🏃</span>
      <div
        style={{
          flex: 1,
          height: 8,
          borderRadius: 999,
          background: "rgba(0,0,0,0.35)",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            height: "100%",
            width: `${Math.round(hud.progress * 100)}%`,
            background: "#ffd23f", // E3.5: 노랑 고정(빨강 금지)
            borderRadius: 999,
            transition: "width 0.15s linear",
          }}
        />
      </div>
      {/* 피날레: 바 색 대신 정류장 아이콘 깜빡임으로 표현 */}
      <span
        style={{
          fontSize: hud.finale ? 17 : 14,
          animation: hud.finale ? "chasePulse 0.45s ease-in-out infinite" : "none",
        }}
      >
        🚌
      </span>
    </div>
  );
}

// E3: 안전교육 구간 안내 배너 — 상단 중앙, 팝인 후 2초
function SectionBanner({ text }: { text: string }) {
  return (
    <div
      key={text}
      style={{
        position: "absolute",
        top: "13%",
        left: "50%",
        transform: "translateX(-50%)",
        background: "linear-gradient(180deg, #ffd23f, #ffb800)",
        color: "#1f2a44",
        padding: "10px 26px",
        borderRadius: 999,
        fontSize: 19,
        fontWeight: 800,
        whiteSpace: "nowrap",
        boxShadow: "0 6px 22px rgba(0,0,0,.35)",
        pointerEvents: "none",
        animation: "bannerPop 0.4s cubic-bezier(.34,1.56,.64,1) both",
        zIndex: 5,
      }}
    >
      {text}
      <style>{`@keyframes bannerPop{0%{transform:translateX(-50%) scale(0.7);opacity:0}100%{transform:translateX(-50%) scale(1);opacity:1}}`}</style>
    </div>
  );
}

function DialogueBubble({ text }: { text: string }) {
  return (
    <div
      style={{
        position: "absolute",
        top: "20%",
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

// ── S3a 완주 성공 — 안전교육 전용 (E2): 이수 → 무한 잔업 모드 개방 ──
function ClearOverlay({
  result,
  tickets,
  justUnlocked,
  onGoEndless,
  onRetryEdu,
  onLobby,
}: {
  result: GameResult;
  tickets: number;
  justUnlocked: boolean;
  onGoEndless: () => void;
  onRetryEdu: () => void;
  onLobby: () => void;
}) {
  return (
    <div style={overlayStyle} onPointerDown={(e) => e.stopPropagation()}>
      {/* E3.11-2: 캐릭터는 타이틀 옆 배치, 낮은 뷰포트(≤430px)에선 숨김 */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 14,
          marginBottom: "clamp(6px, 1.6vh, 14px)",
        }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          className="ovl-char"
          src="/assets/sprites/gimbanjang_custom/cheer.webp"
          alt=""
          aria-hidden
          draggable={false}
          style={{
            height: "clamp(56px, 16vh, 96px)",
            width: "auto",
            animation: "starPop 0.5s cubic-bezier(.34,1.56,.64,1) both",
            filter: "drop-shadow(0 4px 10px rgba(0,0,0,0.4))",
          }}
        />
        <div style={{ textAlign: "left" }}>
          <div style={{ fontSize: "clamp(20px, 5.5vh, 28px)", fontWeight: 800, color: "#ffd23f" }}>
            🦺 안전교육 이수!
          </div>
          <div
            style={{
              fontSize: justUnlocked ? "clamp(15px, 4vh, 20px)" : 14,
              fontWeight: 800,
              color: justUnlocked ? "#8ee6d0" : "#cdd8ec",
              marginTop: 4,
              animation: justUnlocked ? "starPop 0.6s 0.3s cubic-bezier(.34,1.56,.64,1) both" : "none",
            }}
          >
            {justUnlocked ? "🔓 무한 잔업 모드 개방!" : "박소장을 따돌리고 무사 퇴근했습니다"}
          </div>
        </div>
      </div>
      <style>{`@media (max-height: 430px){ .ovl-char{ display: none } }`}</style>

      <div style={{ display: "flex", gap: "clamp(6px, 1.5vw, 10px)", marginBottom: "clamp(6px, 1.6vh, 14px)", width: "100%", maxWidth: 520, justifyContent: "center" }}>
        <div style={resultCard}>
          <div style={resultLabel}>기록</div>
          <div style={{ fontSize: "clamp(18px, 4.8vh, 26px)", fontWeight: 800, color: "#8ee6d0" }}>
            {result.playDuration}s
          </div>
        </div>
        <div style={resultCard}>
          <div style={resultLabel}>코인</div>
          <div style={{ fontSize: "clamp(18px, 4.8vh, 26px)", fontWeight: 800 }}>
            🟡 {result.coinCount}
          </div>
        </div>
        {/* 교육 클리어는 점수 내역 대신 조작 이수 표기 유지(E3.11-3) */}
        <div style={resultCard}>
          <div style={resultLabel}>조작 이수</div>
          <div style={{ fontSize: "clamp(13px, 3.6vh, 20px)", fontWeight: 800, color: "#8ee6d0", lineHeight: 1.5 }}>
            점프 ✓<br />슬라이드 ✓<br />회피 ✓
          </div>
        </div>
      </div>
      <div style={{ fontSize: 12, color: "#8fa3c4", marginBottom: "clamp(6px, 1.6vh, 14px)", textAlign: "center" }}>
        점프·슬라이드·회피 — 3가지 조작 이수! 이제 랭킹전에서 오래 버텨보세요 · 🎟 {tickets}
      </div>

      <div style={{ display: "flex", gap: 10, width: "100%", maxWidth: 500 }}>
        <button onClick={onGoEndless} style={{ ...primaryBtn, flex: 1.4, marginBottom: 0, background: "#e08a1e" }}>
          🔥 무한 잔업 모드 가기 (🎟 1)
        </button>
        <button onClick={onRetryEdu} style={{ ...secondaryBtn, flex: 1 }}>
          다시 연습 (무료)
        </button>
        <button onClick={onLobby} style={{ ...secondaryBtn, flex: 0.8 }}>
          로비
        </button>
      </div>
      <style>{`@keyframes starPop{0%{transform:scale(0);opacity:0}70%{transform:scale(1.25)}100%{transform:scale(1);opacity:1}}`}</style>
    </div>
  );
}

// ── S3b 실패 ──
function GameOverOverlay({
  result,
  tickets,
  onRestart,
  onLobby,
}: {
  result: GameResult;
  tickets: number;
  onRestart: () => void;
  onLobby: () => void;
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
    <div style={overlayStyle} onPointerDown={(e) => e.stopPropagation()}>
      <div style={{ fontSize: "clamp(18px, 5vh, 24px)", fontWeight: 800 }}>
        {result.outcome === "caught"
          ? "덜미 잡힘!"
          : result.outcome === "giveup"
            ? "오늘은 여기까지!"
            : "퇴근 실패!"}
      </div>
      <div style={{ color: "#cdd8ec", fontSize: 13, marginBottom: 12 }}>
        {result.outcome === "caught"
          ? "박소장에게 붙잡혔습니다… 잔업 확정"
          : result.outcome === "giveup"
            ? "현재 기록으로 마감했습니다"
            : "안전모가 다 벗겨졌습니다…"}{" "}
        · 🎟 {tickets}
      </div>

      {/* E3.11-3: 점수 내역 분리 표기 — 코인 가치 가시화 */}
      <div
        style={{
          display: "flex",
          gap: "clamp(6px, 1.5vw, 10px)",
          alignItems: "stretch",
          marginBottom: "clamp(6px, 1.6vh, 14px)",
          width: "100%",
          maxWidth: 520,
          justifyContent: "center",
        }}
      >
        <div style={resultCard}>
          <div style={resultLabel}>랭킹 점수</div>
          <div style={{ fontSize: "clamp(20px, 5.4vh, 30px)", fontWeight: 800, color: "#ffd23f" }}>
            {result.rankScore.toLocaleString()}
          </div>
        </div>
        <div style={resultCard}>
          <div style={resultLabel}>코인 → 점수</div>
          <div style={{ fontSize: "clamp(14px, 3.8vh, 20px)", fontWeight: 800 }}>
            🟡 {result.coinCount}개
            <div style={{ color: "#ffd23f" }}>+{(result.coinCount * SCORE.COIN_VALUE).toLocaleString()}점</div>
          </div>
        </div>
        {/* E4-5 세이프 모드: 성적 연동 "예상 포인트" 대신 주행 내역 표기 */}
        {REWARD_SAFE_MODE ? (
          <div style={resultCard}>
            <div style={resultLabel}>주행 거리 → 점수</div>
            <div style={{ fontSize: "clamp(14px, 3.8vh, 20px)", fontWeight: 800 }}>
              🏃 {result.playDuration}s
              <div style={{ color: "#8ee6d0" }}>
                +{Math.max(0, result.rankScore - result.coinCount * SCORE.COIN_VALUE).toLocaleString()}점
              </div>
            </div>
          </div>
        ) : (
          <div style={resultCard}>
            <div style={resultLabel}>예상 포인트*</div>
            <div style={{ fontSize: "clamp(20px, 5.4vh, 30px)", fontWeight: 800, color: "#8ee6d0" }}>
              {expectedPoints.toLocaleString()}P
            </div>
          </div>
        )}
      </div>
      <div style={{ fontSize: 11, color: "#8fa3c4", marginBottom: "clamp(6px, 1.6vh, 14px)", textAlign: "center" }}>
        ⏱ {result.playDuration}초 ·{" "}
        {REWARD_SAFE_MODE
          ? "참여 보상은 성적과 무관하게 앱에서 지급됩니다"
          : "*교환비 확정 전 임시 환산, 지급은 앱에서 처리"}
      </div>

      <div style={{ display: "flex", gap: 10, width: "100%", maxWidth: 500 }}>
        <button onClick={onRestart} style={{ ...primaryBtn, flex: 1.2, marginBottom: 0 }}>
          {result.mode === "edu" ? "다시 연습 (무료)" : "다시 도전 (🎟 1)"}
        </button>
        <button onClick={onLobby} style={{ ...secondaryBtn, flex: 1 }}>
          노선도
        </button>
        <button onClick={share} style={{ ...secondaryBtn, flex: 1 }}>
          공유
        </button>
        <Link href="/ranking" style={{ ...secondaryBtn, flex: 1, textDecoration: "none" }}>
          랭킹
        </Link>
      </div>
    </div>
  );
}

// ── E3.10-2: 일시정지 오버레이 ──
function PauseOverlay({
  mode,
  onResume,
  onGiveUp,
}: {
  mode: GameMode;
  onResume: () => void;
  onGiveUp: () => void;
}) {
  return (
    <div
      style={{ ...overlayStyle, background: "rgba(14,21,38,0.82)", zIndex: 40 }}
      onPointerDown={(e) => e.stopPropagation()}
    >
      <div style={{ fontSize: 26, fontWeight: 800, marginBottom: 4 }}>⏸ 일시정지</div>
      <div style={{ color: "#8fa3c4", fontSize: 13, marginBottom: 18 }}>
        {mode === "endless"
          ? "포기하면 현재 기록으로 마감돼요"
          : "포기하면 저장 없이 로비로 돌아가요"}
      </div>
      <div style={{ display: "flex", gap: 10, width: "100%", maxWidth: 420 }}>
        <button onClick={onResume} style={{ ...primaryBtn, flex: 1.4, marginBottom: 0 }}>
          ▶ 계속하기
        </button>
        <button onClick={onGiveUp} style={{ ...secondaryBtn, flex: 1 }}>
          {mode === "endless" ? "포기 (기록 저장)" : "포기"}
        </button>
      </div>
    </div>
  );
}

// ── S5 티켓 충전 ──
function ChargeOverlay({
  onCharge,
  onClose,
}: {
  onCharge: (a: NativeAction) => void;
  onClose: () => void;
}) {
  return (
    <div style={overlayStyle} onPointerDown={(e) => e.stopPropagation()}>
      <div style={{ fontSize: 22, fontWeight: 800 }}>티켓이 다 떨어졌어요!</div>
      <div style={{ color: "#8fa3c4", fontSize: 13, marginBottom: 18 }}>
        충전 방법을 고르면 앱에서 처리돼요.
      </div>
      <div style={{ display: "flex", gap: 10, width: "100%", maxWidth: 520 }}>
        <button onClick={() => onCharge("watchAdForTicket")} style={chargeCard("#2E66F6")}>
          📺 광고 시청
          <span style={chargeSub}>+1 티켓</span>
        </button>
        {/* E4-5 세이프 모드: 포인트 교환 숨김(코드 보관) — 플래그 해제 시 복귀 */}
        {!REWARD_SAFE_MODE && (
          <button onClick={() => onCharge("exchangePointsForTicket")} style={chargeCard("#3c4a63")}>
            💰 포인트 교환
            <span style={chargeSub}>+1 티켓</span>
          </button>
        )}
        <button onClick={() => onCharge("inviteFriend")} style={chargeCard("#37c871")}>
          👷 친구 초대
          <span style={chargeSub}>+1 티켓</span>
        </button>
      </div>
      <button onClick={onClose} style={{ ...secondaryBtn, marginTop: 14, maxWidth: 200 }}>
        닫기
      </button>
    </div>
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
      </div>
      <style>{`@keyframes rotateHint{0%,100%{transform:rotate(-12deg)}50%{transform:rotate(78deg)}}`}</style>
    </div>
  );
}

// E3.7-6: HUD 클러스터 공용 반투명 다크 패널
const hudPanel: React.CSSProperties = {
  background: "rgba(0,0,0,0.35)",
  borderRadius: 12,
  padding: "5px 10px",
};

// E3.11-2: 반응형 — 작은 뷰포트(모바일 가로)에서도 버튼이 잘리지 않게
// clamp 기반 여백 + 세로 스크롤 허용 + iOS safe-area 인셋 반영
const overlayStyle: React.CSSProperties = {
  position: "absolute",
  inset: 0,
  background: "linear-gradient(180deg, rgba(14,21,38,0.72), rgba(14,21,38,0.9))",
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  justifyContent: "center",
  color: "#fff",
  padding:
    "max(clamp(8px, 2.5vh, 28px), env(safe-area-inset-top)) max(clamp(10px, 3vw, 28px), env(safe-area-inset-right)) max(clamp(8px, 2.5vh, 28px), env(safe-area-inset-bottom)) max(clamp(10px, 3vw, 28px), env(safe-area-inset-left))",
  overflowY: "auto",
  WebkitOverflowScrolling: "touch",
};

const primaryBtn: React.CSSProperties = {
  background: "#2E66F6",
  color: "#fff",
  border: "none",
  padding: "14px 24px",
  borderRadius: 999,
  fontSize: 17,
  fontWeight: 700,
  marginBottom: 12,
  cursor: "pointer",
};

const secondaryBtn: React.CSSProperties = {
  background: "transparent",
  color: "#cdd8ec",
  border: "1px solid rgba(255,255,255,0.3)",
  padding: "12px 16px",
  borderRadius: 999,
  fontSize: 15,
  fontWeight: 600,
  textAlign: "center",
  cursor: "pointer",
};

// E3.11-2: 좁은 화면에서 축소되되 3개 가로 배열 유지
const resultCard: React.CSSProperties = {
  background: "rgba(255,255,255,0.08)",
  borderRadius: 14,
  padding: "clamp(6px, 2vh, 12px) clamp(8px, 2.2vw, 18px)",
  textAlign: "center",
  minWidth: 0,
  flex: 1,
  maxWidth: 170,
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
    cursor: "pointer",
  };
}

const chargeSub: React.CSSProperties = {
  display: "block",
  fontSize: 12,
  opacity: 0.85,
  marginTop: 2,
};
