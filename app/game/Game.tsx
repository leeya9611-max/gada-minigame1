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
import { logEvent } from "@/lib/analytics";
import {
  addMeters,
  computeStars,
  fetchEduDone,
  loadEduDone,
  postEduDone,
  loadRouteProgress,
  loadTotalMeters,
  saveEduDone,
  saveRouteResult,
  type RouteProgress,
} from "@/lib/progress";
import { playSfx, preloadSfx } from "@/lib/sfx";
import { pauseBgm, startBgm } from "@/lib/bgm";
import { BridgeDebug } from "./BridgeDebug";
import {
  fetchNickname,
  generateNickname,
  loadNickname,
  registerNickname,
  validateNickname,
} from "@/lib/nickname";
import Link from "next/link";
import { tierOf } from "@/app/ranking/tier";
import { Black_Han_Sans } from "next/font/google";

// E3.18-1: 두꺼운 헤드라인용 한글 폰트(결과 타이틀·로비 섹션 타이틀 전용)
const headlineFont = Black_Han_Sans({ weight: "400", subsets: ["latin"], preload: false });

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
    logEvent("ticket_spend", { left }); // E6-3
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
  // E7-1: 서버(users.edu_done) 동기화 — 캐시 우선 표시 후 서버 값으로 갱신.
  // 서버=true → 캐시 저장(기기 변경 복원) / 서버=false·캐시=true → 이관 전 로컬 기록을 서버로 푸시.
  // 조회 실패(null)면 캐시 유지 — 게이트가 막히는 상황 방지.
  useEffect(() => {
    let alive = true;
    void fetchEduDone(user.userId).then((server) => {
      if (!alive || server === null) return;
      if (server) {
        saveEduDone();
        setEduDone(true);
      } else if (loadEduDone()) {
        void postEduDone(user.userId);
      }
    });
    return () => {
      alive = false;
    };
  }, [user.userId]);
  const currentModeRef = useRef<GameMode>("route");

  // E3.10-2: 일시정지 — 버튼/백그라운드 전환 시. 포기는 모드별 분기.
  const [paused, setPaused] = useState(false);
  const pauseGame = useCallback(() => {
    engineRef.current?.pause();
    pauseBgm(); // E7-BGM
    setPaused(true);
  }, []);
  const resumeGame = useCallback(() => {
    engineRef.current?.resume();
    startBgm(); // E7-BGM
    setPaused(false);
  }, []);
  const giveUpGame = useCallback(() => {
    const eng = engineRef.current;
    if (!eng) return;
    startBgm(); // E7-BGM: 일시정지에서 나가도 로비·결과 BGM 유지
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
      // E6-1: 백그라운드 전환 중 pointerup이 유실돼도 슬라이드 홀드가 남지 않게 강제 해제
      if (document.hidden) {
        pointers.current.clear();
        engineRef.current?.endSlide();
      }
    };
    document.addEventListener("visibilitychange", onVis);
    // E6-1: 네이티브 오버레이 등으로 포커스만 잃는 경우(visibilitychange 미발화)도 동일 방어
    const onBlur = () => {
      pointers.current.clear();
      engineRef.current?.endSlide();
    };
    window.addEventListener("blur", onBlur);
    return () => {
      document.removeEventListener("visibilitychange", onVis);
      window.removeEventListener("blur", onBlur);
    };
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
    logEvent("play_end", { mode: r.mode, outcome: r.outcome, playDuration: r.playDuration, score: r.rankScore }); // E6-3
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
        if (!eduDoneRef.current) logEvent("edu_complete"); // E6-3: 최초 이수만
        saveEduDone();
        void postEduDone(r.userId); // E7-1: 서버 기록(실패해도 캐시로 플레이 가능)
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
    // E5: 주차(라운드)별 배경 팔레트 — 시즌 미로드 시 원본(2주차 석양)
    eng.setEndless("map1", season?.round);
    logEvent("play_start", { mode: "endless" }); // E6-3
    currentModeRef.current = "endless";
    setResult(null);
    setFlash(true);
    setScreen("game");
    eng.onTap();
    window.setTimeout(() => setFlash(false), 450);
  }, [spritesLoaded, showCharge, eduDone, consumeTicket, season]);

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
      logEvent("play_start", { mode: "edu" }); // E6-3
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
    logEvent("play_start", { mode: currentModeRef.current, restart: true }); // E6-3
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

  // ── 입력(E8-5, 좌우 대칭): 아무 곳이나 탭=점프 / 아래로 45px 스와이프=슬라이드 ──
  // 스와이프 시 선행된 점프는 slide()의 급강하+착지 버퍼(E6-QA2)가 짧은 홉으로 흡수한다.
  // 손가락별(pointerId) 추적 — 한 손가락 슬라이드 홀드 중 다른 손가락 점프 탭 가능.
  const pointers = useRef(new Map<number, { startY: number; slide: boolean }>());

  // E6-1: iOS 구형 웹킷은 touch-action:none을 부분적으로만 존중 — 게임 영역 터치 스크롤/러버밴드를
  // non-passive touchmove preventDefault로 한 번 더 차단(React 루트 리스너는 passive라 ref로 직접 부착)
  const gameAreaRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const el = gameAreaRef.current;
    if (!el) return;
    const block = (e: TouchEvent) => e.preventDefault();
    el.addEventListener("touchmove", block, { passive: false });
    return () => el.removeEventListener("touchmove", block);
  }, []);

  const onPointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (result || screen !== "game") return;
      const eng = engineRef.current;
      if (!eng) return;
      pointers.current.set(e.pointerId, { startY: e.clientY, slide: false });
      if (hud.phase !== "playing") return;
      eng.onTap(); // 위치 무관 점프 — 슬라이드는 onPointerMove의 아래 스와이프가 담당
    },
    [result, screen, hud.phase]
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (result) return;
      const p = pointers.current.get(e.pointerId);
      if (!p || p.slide) return;
      // 아래로 45px 이상 끌면 슬라이드(전 영역, E8-5)
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

  // E7-3: ?debug=1 → 브리지 디버그 오버레이(웹뷰 QA용)
  const [debugMode, setDebugMode] = useState(false);
  useEffect(() => {
    setDebugMode(new URLSearchParams(window.location.search).has("debug"));
    preloadSfx(); // E8-2: 효과음 버퍼 사전 디코드(첫 재생 지연·iOS 렉 방지)
  }, []);

  // 세로 감지 → 회전 안내
  // E8-4: 일부 모바일 웹뷰에서 matchMedia("(orientation: portrait)")가 false로 고정되는 문제 —
  // 실제 뷰포트 비율(innerHeight > innerWidth)을 1차 기준으로 하고 matchMedia는 OR 보조.
  const [isPortrait, setIsPortrait] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(orientation: portrait)");
    const update = () => setIsPortrait(window.innerHeight > window.innerWidth || mq.matches);
    update();
    mq.addEventListener?.("change", update);
    window.addEventListener("resize", update);
    window.addEventListener("orientationchange", update);
    const so = (window.screen as unknown as Screen2).orientation;
    so?.lock?.("landscape").catch(() => {});
    return () => {
      mq.removeEventListener?.("change", update);
      window.removeEventListener("resize", update);
      window.removeEventListener("orientationchange", update);
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
        ref={gameAreaRef}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onPointerLeave={onPointerUp}
        // E6-1: 롱프레스 컨텍스트 메뉴(Android)·selection 진입 차단
        onContextMenu={(e) => e.preventDefault()}
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
            {/* E6-QA: 대사 말풍선은 엔진이 화자 머리 위에 캔버스로 직접 그림(상단 배너와 겹침 해소) */}
            <ControlHints />
            {/* E3.10-2: 일시정지 — 우상단 모서리 고정, 점프 입력과 분리(stopPropagation) */}
            {!paused && <PauseButton onClick={pauseGame} />}
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
              startBgm(); // E7-BGM: 첫 사용자 제스처에서 루프 시작(로비~게임 내내 유지)
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
            onChargeTicket={() => charge("watchAdForTicket")}
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
      {/* E7-3: 브리지 디버그 오버레이 — ?debug=1 웹뷰 QA 전용, 게임 화면 불변 */}
      {debugMode && <BridgeDebug />}
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
      {/* E8-5: 좌우 대칭 입력 — 구역을 지시하지 않는 문구, 배치만 대칭 유지 */}
      <div style={{ ...pill, left: "12%" }}>아래로 밀면 슬라이드</div>
      <div style={{ ...pill, right: "12%" }}>탭하면 점프</div>
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
            <BtnIcon src="/assets/ui/icon_retry.png" fallback="" size={15} /> 다시 뽑기
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
  onChargeTicket,
  loading,
}: {
  nickname: string | null;
  tickets: number;
  totalM: number;
  eduDone: boolean;
  season: SeasonBoard | null;
  onStartEdu: () => void;
  onStartEndless: () => void;
  onChargeTicket: () => void;
  loading: boolean;
}) {
  return (
    <div
      onPointerDown={(e) => e.stopPropagation()}
      style={{
        position: "absolute",
        inset: 0,
        // E3.18-5/E3.20-6: 배경 이미지(cover) 위 반투명 그라데이션 — 파일 없으면 그라데이션만(자연 폴백)
        backgroundColor: "#141d33",
        backgroundImage:
          "linear-gradient(180deg, rgba(31,42,68,0.55) 0%, rgba(14,21,38,0.78) 100%), url(/assets/ui/lobby_bg.webp)",
        backgroundSize: "cover",
        backgroundPosition: "center",
        color: "#fff",
        display: "flex",
        flexDirection: "column",
        gap: 10,
        padding: "12px 18px 14px",
      }}
    >
      {/* ── 상단바(E3.30-4): 좌 누적 m 캡슐 / 우 티켓 재화 바 유지 ── */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <span
          style={{
            fontSize: 12,
            fontWeight: 700,
            color: "#aebfda",
            background: "rgba(0,0,0,0.32)",
            border: "1px solid rgba(255,255,255,0.14)",
            boxShadow: "inset 0 1px 0 rgba(255,255,255,0.1)",
            padding: "5px 12px",
            borderRadius: 999,
            whiteSpace: "nowrap",
          }}
        >
          🏃 누적 {totalM.toLocaleString()}m
        </span>
        {/* E3.28: 우상단 — 티켓 재화 바 + 나가기 버튼 */}
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <TicketBar tickets={tickets} onCharge={onChargeTicket} />
          <ExitButton />
        </div>
      </div>

      {/* ── 라운드 게이지(E3.30-1): season 있을 때만 ── */}
      {season && <RoundGauge round={season.round} days={daysLeft(season.endsAt)} />}

      {/* ── 메인 2분할(E3.30-2/3): 좌 캐릭터 / 우 모드 카드 세로 스택 ── */}
      <div style={{ flex: 1, minHeight: 0, display: "flex", gap: 16 }}>
        {/* 왼쪽: 캐릭터 크게 + 닉네임·티어 + 내 시즌 성적 */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <LobbyHero nickname={nickname} season={season} />
        </div>

        {/* 오른쪽: 랭킹보기(작게) → 안전교육 → 무한 잔업 세로 스택 */}
        <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 10 }}>
          <Link
            href="/ranking"
            style={{
              alignSelf: "flex-end",
              display: "inline-flex",
              alignItems: "center",
              gap: 7,
              // E3.28-3: 20~30% 확대 — fontSize 13→16, padding 7×16→9×21
              fontSize: 16,
              fontWeight: 800,
              color: "#fff",
              textShadow: "0 1px 2px rgba(0,0,0,0.35)",
              textDecoration: "none",
              // E3.25-1: cta_primary border-image — 파일 없으면 골드 그라데이션 폴백
              background: "linear-gradient(180deg, #ffe58a 0%, #ffd23f 45%, #eab308 100%)",
              boxShadow: "0 3px 0 rgba(10,16,30,0.45), 0 5px 10px rgba(0,0,0,0.35)",
              padding: "9px 21px",
              borderRadius: 21,
              whiteSpace: "nowrap",
              flexShrink: 0,
              ...ctaImg("cta_primary"),
            }}
          >
            🏆 랭킹보기
          </Link>

          <button
            onClick={onStartEdu}
            disabled={loading}
            style={{
              flex: 1,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 14,
              borderRadius: 18,
              // E3.24-3: cta_edu(#135dc3) 톤으로 강조색 통일
              border: "2px solid rgba(94,180,255,0.55)",
              background:
                "linear-gradient(135deg, rgba(255,255,255,0.14) 0%, rgba(19,93,195,0.48) 30%, rgba(14,70,150,0.32) 100%)",
              boxShadow: "inset 0 2px 0 rgba(255,255,255,0.22), inset 0 -6px 12px rgba(0,0,0,0.22), 0 4px 10px rgba(0,0,0,0.3)",
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
                  top: 8,
                  right: 12,
                  fontSize: 11,
                  fontWeight: 800,
                  // E3.26-1: 리본 배경 철회 — 단순 반투명 캡슐
                  color: "#8ee6d0",
                  background: "rgba(0,0,0,0.3)",
                  padding: "2px 8px",
                  borderRadius: 999,
                }}
              >
                이수 완료 ✓
              </span>
            )}
            <LobbyIcon src="/assets/ui/icon_edu.png" fallback="🦺" size={48} />
            <div style={{ textAlign: "left", display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 3 }}>
              <CardWordmark src="/assets/ui/wordmark_edu.png" text="안전교육" />
              <div style={{ fontSize: 12.5, color: "#9fc4e8" }}>조작 연습 · 무료</div>
            </div>
          </button>

          <button
            onClick={onStartEndless}
            disabled={loading || !eduDone}
            style={{
              flex: 1,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 14,
              borderRadius: 18,
              // E3.24-3: cta_endless(#dc4f35) 톤으로 강조색 통일
              border: eduDone ? "2px solid rgba(255,130,95,0.6)" : "2px solid rgba(255,255,255,0.08)",
              background: eduDone
                ? "linear-gradient(135deg, rgba(255,255,255,0.14) 0%, rgba(220,79,53,0.45) 30%, rgba(175,52,32,0.3) 100%)"
                : "rgba(255,255,255,0.04)",
              boxShadow: eduDone
                ? "inset 0 2px 0 rgba(255,255,255,0.22), inset 0 -6px 12px rgba(0,0,0,0.22), 0 4px 10px rgba(0,0,0,0.3)"
                : undefined,
              color: eduDone ? "#fff" : "#5d6b84",
              cursor: loading || !eduDone ? "default" : "pointer",
              opacity: loading ? 0.6 : 1,
            }}
          >
            {eduDone ? (
              <LobbyIcon src="/assets/ui/icon_endless.png" fallback="🔥" size={48} />
            ) : (
              <LobbyIcon src="/assets/ui/icon_lock.png" fallback="🔒" size={44} />
            )}
            <div style={{ textAlign: "left", display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 3 }}>
              {eduDone ? (
                <CardWordmark src="/assets/ui/wordmark_endless.png" text="무한 잔업 모드" />
              ) : (
                // 잠금 상태: 워드마크 컬러가 활성처럼 보이므로 기존 회색 텍스트 유지
                <div className={headlineFont.className} style={{ fontSize: 22 }}>무한 잔업 모드</div>
              )}
              <div style={{ fontSize: 12.5, color: eduDone ? "#f0c58a" : "#5d6b84" }}>
                {eduDone ? "랭킹전 · 티켓 1장" : "안전교육 이수 후 참가 가능"}
              </div>
            </div>
          </button>
        </div>
      </div>
    </div>
  );
}

// E3.28-4: 티켓 재화 바 — [티켓 아이콘][진한 캡슐 숫자][+ 버튼]. 아이콘·버튼은 이미지 폴백.
function TicketBar({ tickets, onCharge }: { tickets: number; onCharge: () => void }) {
  const [iconBroken, setIconBroken] = useState(false);
  const [plusBroken, setPlusBroken] = useState(false);
  return (
    <div style={{ display: "flex", alignItems: "center" }}>
      {/* 좌: 티켓 아이콘(캡슐에 절반 겹침) */}
      {iconBroken ? (
        <span style={{ fontSize: 22, zIndex: 1, marginRight: -10, filter: "drop-shadow(0 2px 3px rgba(0,0,0,0.5))" }}>
          🎟
        </span>
      ) : (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src="/assets/ui/ticket_icon.png"
          alt=""
          aria-hidden
          draggable={false}
          onError={() => setIconBroken(true)}
          style={{
            height: 26,
            width: "auto",
            zIndex: 1,
            marginRight: -14,
            filter: "drop-shadow(0 2px 3px rgba(0,0,0,0.5))",
          }}
        />
      )}
      {/* 중: 진한 캡슐 바 + 숫자 */}
      <span
        style={{
          background: "rgba(0,0,0,0.55)",
          border: "1px solid rgba(255,255,255,0.18)",
          boxShadow: "inset 0 1px 0 rgba(255,255,255,0.12), inset 0 -2px 4px rgba(0,0,0,0.4)",
          color: "#ffd23f",
          fontSize: 14,
          fontWeight: 800,
          padding: "4px 20px 4px 22px",
          borderRadius: 999,
          textShadow: "0 1px 2px rgba(0,0,0,0.4)",
          whiteSpace: "nowrap",
          minWidth: 64,
          textAlign: "center",
        }}
      >
        {tickets}
      </span>
      {/* 우: 원형 + 버튼 → 광고 시청 요청(랭킹 페이지와 동일 동작) */}
      <button
        onClick={onCharge}
        aria-label="티켓 충전"
        style={{
          border: "none",
          background: "transparent",
          padding: 0,
          marginLeft: -13,
          zIndex: 1,
          cursor: "pointer",
          lineHeight: 0,
        }}
      >
        {plusBroken ? (
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              width: 26,
              height: 26,
              borderRadius: "50%",
              background: "linear-gradient(180deg, #58d685 0%, #2fae5c 100%)",
              border: "1.5px solid rgba(255,255,255,0.45)",
              boxShadow: "0 2px 4px rgba(0,0,0,0.4)",
              color: "#fff",
              fontSize: 17,
              fontWeight: 900,
              lineHeight: 1,
            }}
          >
            +
          </span>
        ) : (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src="/assets/ui/btn_plus.png"
            alt=""
            aria-hidden
            draggable={false}
            onError={() => setPlusBroken(true)}
            style={{ height: 27, width: "auto", filter: "drop-shadow(0 2px 3px rgba(0,0,0,0.45))" }}
          />
        )}
      </button>
    </div>
  );
}

// E3.28-1: 나가기 버튼 — 네이티브로 exitGame 액션만 전달(웹은 결과 처리 안 함)
function ExitButton() {
  const [broken, setBroken] = useState(false);
  return (
    <button
      onClick={() => requestNativeAction("exitGame")}
      aria-label="나가기"
      style={{
        border: "none",
        background: "transparent",
        padding: 0,
        cursor: "pointer",
        lineHeight: 0,
      }}
    >
      {broken ? (
        <span
          style={{
            display: "inline-block",
            fontSize: 12,
            fontWeight: 800,
            color: "#cdd8ec",
            background: "rgba(0,0,0,0.4)",
            border: "1px solid rgba(255,255,255,0.2)",
            padding: "6px 12px",
            borderRadius: 999,
            lineHeight: 1,
            whiteSpace: "nowrap",
          }}
        >
          ✕ 나가기
        </span>
      ) : (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src="/assets/ui/icon_exit.png"
          alt=""
          aria-hidden
          draggable={false}
          onError={() => setBroken(true)}
          style={{ height: 34, width: "auto", filter: "drop-shadow(0 2px 4px rgba(0,0,0,0.45))" }}
        />
      )}
    </button>
  );
}

// E3.30-1: 한 달 챌린지 라운드 게이지 — gauge_track 금속 프레임 + 헬멧 배지 마커 4개 + 채움 오버레이.
// 트랙/마커 이미지 없으면 CSS 바·🪖 이모지 폴백. 화면 가운데 최대 폭 제한.
function RoundGauge({ round, days }: { round: number; days: number }) {
  const TOTAL = 4; // 한 달 = 4주(라운드)
  const cur = Math.max(1, Math.min(TOTAL, round));
  const fillPct = (cur / TOTAL) * 100;
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 14,
        flexShrink: 0,
        maxWidth: 470,
        width: "100%",
        margin: "0 auto",
      }}
    >
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", lineHeight: 1.05 }}>
        <span
          className={headlineFont.className}
          style={{ fontSize: 26, color: "#ffd23f", textShadow: "0 2px 4px rgba(0,0,0,0.65)" }}
        >
          D-{days}
        </span>
        <span style={{ fontSize: 10.5, fontWeight: 800, color: "#aebfda", whiteSpace: "nowrap" }}>
          {cur}/{TOTAL} 라운드
        </span>
      </div>
      <div style={{ position: "relative", flex: 1, aspectRatio: "1400 / 230", minHeight: 30, maxHeight: 44 }}>
        {/* CSS 폴백 트랙(이미지 로드 시 프레임이 위를 덮음) */}
        <div
          style={{
            position: "absolute",
            inset: "26% 1.5%",
            borderRadius: 999,
            background: "rgba(0,0,0,0.5)",
            border: "1px solid rgba(255,255,255,0.12)",
          }}
        />
        {/* 금속 프레임 트랙 */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/assets/ui/gauge_track.webp"
          alt=""
          aria-hidden
          draggable={false}
          onError={(e) => {
            e.currentTarget.style.display = "none";
          }}
          style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }}
        />
        {/* 채움 오버레이 — 트랙 안쪽 슬롯 inset에 맞춤, 현재 라운드 진행률 */}
        <div
          style={{
            position: "absolute",
            top: "27%",
            bottom: "27%",
            left: "4.5%",
            width: `${fillPct * 0.91}%`,
            borderRadius: 999,
            background: "linear-gradient(90deg, #ffe066 0%, #ff9500 100%)",
            boxShadow: "0 0 10px rgba(255,180,60,0.55)",
          }}
        />
        {/* 헬멧 배지 마커 4개 — 도달 라운드 active, 이후 locked */}
        {Array.from({ length: TOTAL }, (_, i) => {
          const reached = i + 1 <= cur;
          const left = 4.5 + ((i + 0.5) / TOTAL) * 91;
          return <RoundMarker key={i} reached={reached} left={left} />;
        })}
      </div>
    </div>
  );
}

// E3.30-1: 게이지 마커 — round_marker_{active,locked}.png, 없으면 🪖 이모지 폴백
function RoundMarker({ reached, left }: { reached: boolean; left: number }) {
  const [broken, setBroken] = useState(false);
  const common: React.CSSProperties = {
    position: "absolute",
    top: "50%",
    left: `${left}%`,
    transform: "translate(-50%, -50%)",
  };
  if (broken) {
    return (
      <span
        style={{
          ...common,
          fontSize: 22,
          filter: reached ? "drop-shadow(0 2px 3px rgba(0,0,0,0.55))" : "grayscale(1) opacity(0.4)",
        }}
      >
        🪖
      </span>
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={`/assets/ui/round_marker_${reached ? "active" : "locked"}.png`}
      alt=""
      aria-hidden
      draggable={false}
      onError={() => setBroken(true)}
      style={{
        ...common,
        height: "118%",
        width: "auto",
        filter: reached ? "drop-shadow(0 2px 4px rgba(0,0,0,0.5))" : "opacity(0.75)",
      }}
    />
  );
}

// E3.30-3: 카드 타이틀 워드마크 — 이미지 우선, 없으면 기존 헤드라인 텍스트 폴백
function CardWordmark({ src, text }: { src: string; text: string }) {
  const [broken, setBroken] = useState(false);
  if (broken) {
    return (
      <div className={headlineFont.className} style={{ fontSize: 22 }}>
        {text}
      </div>
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt={text}
      draggable={false}
      onError={() => setBroken(true)}
      style={{
        height: "clamp(32px, 5.5vh, 40px)",
        width: "auto",
        maxWidth: "100%",
        objectFit: "contain",
        filter: "drop-shadow(0 2px 3px rgba(0,0,0,0.35))",
      }}
    />
  );
}

// E3.30-2: 로비 좌측 히어로 — 캐릭터 크게 + 닉네임 캡슐(머리 위) + 티어 배지·시즌 성적(발밑)
function LobbyHero({ nickname, season }: { nickname: string | null; season: SeasonBoard | null }) {
  const tier = tierOf(season?.me?.weekScore ?? 0);
  const [charBroken, setCharBroken] = useState(false);
  const [badgeBroken, setBadgeBroken] = useState(false);
  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 6,
        position: "relative",
        zIndex: 1,
        pointerEvents: "none",
      }}
    >
      {/* 닉네임 말풍선 캡슐 */}
      <div
        style={{
          fontSize: 16,
          fontWeight: 800,
          background: "rgba(0,0,0,0.42)",
          border: "1px solid rgba(255,255,255,0.2)",
          boxShadow: "inset 0 1px 0 rgba(255,255,255,0.14)",
          padding: "6px 18px",
          borderRadius: 999,
          whiteSpace: "nowrap",
          textShadow: "0 1px 2px rgba(0,0,0,0.5)",
        }}
      >
        👷 {nickname ?? "김반장"}
      </div>
      {/* 캐릭터 + 발밑 스포트라이트 — 2분할 좌측 폭을 채우도록 확대 */}
      <div style={{ position: "relative", flex: 1, minHeight: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>
        <div
          style={{
            position: "absolute",
            bottom: 0,
            left: "50%",
            transform: "translateX(-50%)",
            width: 240,
            height: 52,
            background: "radial-gradient(ellipse at center, rgba(255,220,120,0.5) 0%, rgba(255,220,120,0.16) 55%, rgba(0,0,0,0) 75%)",
            pointerEvents: "none",
          }}
        />
        {charBroken ? (
          <div style={{ fontSize: "clamp(96px, 34vh, 150px)", lineHeight: 1.2, position: "relative" }}>👷</div>
        ) : (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src="/assets/sprites/gimbanjang_custom/idle_docs.webp"
            alt=""
            aria-hidden
            draggable={false}
            onError={() => setCharBroken(true)}
            style={{
              height: "100%",
              maxHeight: "clamp(140px, 40vh, 260px)",
              width: "auto",
              maxWidth: "100%",
              objectFit: "contain",
              position: "relative",
              filter: "drop-shadow(0 6px 11px rgba(0,0,0,0.42))",
            }}
          />
        )}
      </div>
      {/* 티어 배지 + 내 시즌 성적 */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", justifyContent: "center" }}>
        {/* E3.28-2: 25% 확대 + 티어 컬러 글로우 */}
        <span
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            fontSize: 15,
            fontWeight: 800,
            color: tier.color,
            background: "rgba(0,0,0,0.42)",
            border: `1px solid ${tier.color}88`,
            boxShadow: `inset 0 1px 0 rgba(255,255,255,0.1), 0 0 14px ${tier.color}59, 0 0 4px ${tier.color}40`,
            padding: "4px 14px 4px 6px",
            borderRadius: 999,
            whiteSpace: "nowrap",
          }}
        >
          {badgeBroken ? (
            <span style={{ fontSize: 18 }}>{tier.emoji}</span>
          ) : (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={`/assets/ui/tier_${tier.key}.png`}
              alt=""
              aria-hidden
              draggable={false}
              onError={() => setBadgeBroken(true)}
              style={{ width: 30, height: 30, objectFit: "contain" }}
            />
          )}
          {tier.label}
        </span>
        {season?.me && (
          <span
            style={{
              fontSize: 11,
              fontWeight: 700,
              color: "#ffd23f",
              textShadow: "0 1px 3px rgba(0,0,0,0.9), 0 0 8px rgba(0,0,0,0.7)",
              whiteSpace: "nowrap",
            }}
          >
            이번 주 {season.me.weekScore.toLocaleString()}점 · {season.me.rank}위
          </span>
        )}
      </div>
    </div>
  );
}

// E3.27-2: 인게임 일시정지 버튼 — icon_pause.png가 자체 배경(오렌지 버튼)을 가진 완결형 그래픽이라
// hudPanel 회색 박스 없이 아이콘만 띄운다(이중 박스 방지). 폴백(⏸ 이모지)일 때만 박스를 붙인다.
function PauseButton({ onClick }: { onClick: () => void }) {
  const [broken, setBroken] = useState(false);
  return (
    <button
      onPointerDown={(e) => e.stopPropagation()}
      onClick={onClick}
      aria-label="일시정지"
      style={{
        position: "absolute",
        top: 12,
        right: 14,
        border: "none",
        cursor: "pointer",
        lineHeight: 0,
        ...(broken
          ? { ...hudPanel, color: "#fff", fontSize: 20, padding: "12px 11px" }
          : { background: "transparent", padding: 0 }),
      }}
    >
      {broken ? (
        <span aria-hidden>⏸</span>
      ) : (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src="/assets/ui/icon_pause.png"
          alt=""
          aria-hidden
          draggable={false}
          onError={() => setBroken(true)}
          style={{ width: 42, height: 45, objectFit: "contain", filter: "drop-shadow(0 2px 4px rgba(0,0,0,0.4))" }}
        />
      )}
    </button>
  );
}

// E3.26-2: 완주 화면 세로 리본 배지 — ribbon_gold 자연 비율(380×400), 안에 짧은 2줄 텍스트.
// 파일 없으면 통째로 숨김(타이틀 텍스트가 정보를 전달하므로 장식만 빠짐).
function RibbonBadge({ lines }: { lines: [string, string] }) {
  const [broken, setBroken] = useState(false);
  if (broken) return null;
  return (
    <div
      style={{
        position: "relative",
        height: "clamp(64px, 19vh, 88px)",
        aspectRatio: "380 / 400",
        flexShrink: 0,
        filter: "drop-shadow(0 3px 8px rgba(0,0,0,0.4))",
      }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src="/assets/ui/ribbon_gold.png"
        alt=""
        aria-hidden
        draggable={false}
        onError={() => setBroken(true)}
        style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }}
      />
      {/* 리본 밴드(포크 제외 상단 ~60%) 안에 2줄 텍스트 */}
      <div
        style={{
          position: "absolute",
          inset: "10% 8% 34%",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          color: "#6b3f0c",
          fontWeight: 900,
          fontSize: "clamp(13px, 3.8vh, 17px)",
          lineHeight: 1.3,
          textShadow: "0 1px 0 rgba(255,255,255,0.35)",
        }}
      >
        <span>{lines[0]}</span>
        <span>{lines[1]}</span>
      </div>
    </div>
  );
}

// E3.24-4: 버튼 인라인 아이콘 — 텍스트 앞에 작게, 파일 없으면 이모지(또는 무표시) 폴백
function BtnIcon({ src, fallback, size = 18 }: { src: string; fallback: string; size?: number }) {
  const [broken, setBroken] = useState(false);
  if (broken) return fallback ? <span aria-hidden>{fallback}</span> : null;
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt=""
      aria-hidden
      draggable={false}
      onError={() => setBroken(true)}
      style={{ width: size, height: size, objectFit: "contain", verticalAlign: "-0.18em" }}
    />
  );
}

// E3.18-4: 로비 카드 아이콘 — 이미지 경로 우선, 파일 없으면 이모지 폴백
function LobbyIcon({ src, fallback, size = 56 }: { src: string; fallback: string; size?: number }) {
  const [broken, setBroken] = useState(false);
  if (broken) return <div style={{ fontSize: size * 0.75 }}>{fallback}</div>;
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt=""
      aria-hidden
      draggable={false}
      onError={() => setBroken(true)}
      style={{ height: size, width: "auto", filter: "drop-shadow(0 3px 6px rgba(0,0,0,0.35))" }}
    />
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

// (E6-QA: DialogueBubble DOM 컴포넌트 제거 — 엔진 drawDialogue가 화자 머리 위 캔버스 렌더로 대체)

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
        {/* E3.26-2: ribbon_gold 세로 배지(자연 비율) — 조끼 이모지 역할 대체, 파일 없으면 숨김 */}
        <RibbonBadge lines={["교육", "이수"]} />
        <div style={{ textAlign: "left" }}>
          <div className={headlineFont.className} style={{ fontSize: "clamp(20px, 5.5vh, 28px)", color: "#ffd23f" }}>
            안전교육 이수!
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
        {/* E3.24-6: 완주 장식 트로피 — 파일 없으면 숨김 */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          className="ovl-char"
          src="/assets/ui/trophy.png"
          alt=""
          aria-hidden
          draggable={false}
          onError={(e) => {
            e.currentTarget.style.display = "none";
          }}
          style={{
            height: "clamp(44px, 13vh, 80px)",
            width: "auto",
            animation: "starPop 0.5s 0.15s cubic-bezier(.34,1.56,.64,1) both",
            filter: "drop-shadow(0 4px 10px rgba(0,0,0,0.4))",
          }}
        />
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
        <button
          onClick={onGoEndless}
          style={{ ...primaryBtn, flex: 1.4, marginBottom: 0, background: "#dc4f35", ...ctaImg("cta_endless") }}
        >
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
      {/* E3.18-6: outcome별 히어로 삽화 — caught는 합성 컷 재사용(E3.11-2 반응형 규칙) */}
      <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
        {result.outcome === "caught" && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            className="ovl-char"
            src="/assets/sprites/fx/caught.webp"
            alt=""
            aria-hidden
            draggable={false}
            style={{
              height: "clamp(56px, 15vh, 92px)",
              width: "auto",
              filter: "drop-shadow(0 4px 10px rgba(0,0,0,0.4))",
            }}
          />
        )}
      <div className={headlineFont.className} style={{ fontSize: "clamp(20px, 5.6vh, 27px)" }}>
        {result.outcome === "caught"
          ? "덜미 잡힘!"
          : result.outcome === "giveup"
            ? "오늘은 여기까지!"
            : "퇴근 실패!"}
      </div>
      </div>
      <style>{`@media (max-height: 430px){ .ovl-char{ display: none } }`}</style>
      <div style={{ color: "#cdd8ec", fontSize: 13, marginBottom: 12 }}>
        {/* E3.6-2 수정: 교육 실패(반복 부딪힘) 전용 문구 — 재교육 유도 */}
        {result.mode === "edu"
          ? "박소장에게 붙잡혔습니다 — 안전교육을 다시 받아야 합니다"
          : result.outcome === "caught"
            ? "박소장에게 붙잡혔습니다… 잔업 확정"
            : result.outcome === "giveup"
              ? "현재 기록으로 마감했습니다"
              : "안전모가 다 벗겨졌습니다…"}{" "}
        · 🎟 {tickets}
      </div>

      {/* E3.11-3: 점수 내역 분리 표기 — 코인 가치 가시화 (교육 실패는 점수 대신 기록만) */}
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
        {result.mode === "edu" ? (
          <>
            <div style={resultCard}>
              <div style={resultLabel}>기록</div>
              <div style={{ fontSize: "clamp(20px, 5.4vh, 30px)", fontWeight: 800, color: "#8ee6d0" }}>
                {result.playDuration}s
              </div>
            </div>
            <div style={resultCard}>
              <div style={resultLabel}>코인</div>
              <div style={{ fontSize: "clamp(20px, 5.4vh, 30px)", fontWeight: 800 }}>🟡 {result.coinCount}</div>
            </div>
          </>
        ) : (
          <>
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
          </>
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
          <BtnIcon src="/assets/ui/icon_retry.png" fallback="" size={16} />{" "}
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
      <div style={{ fontSize: 26, fontWeight: 800, marginBottom: 4 }}>
        <BtnIcon src="/assets/ui/icon_pause.png" fallback="⏸" size={26} /> 일시정지
      </div>
      <div style={{ color: "#8fa3c4", fontSize: 13, marginBottom: 18 }}>
        {mode === "endless"
          ? "포기하면 현재 기록으로 마감돼요"
          : "포기하면 저장 없이 로비로 돌아가요"}
      </div>
      <div style={{ display: "flex", gap: 10, width: "100%", maxWidth: 420 }}>
        <button onClick={onResume} style={{ ...primaryBtn, flex: 1.4, marginBottom: 0 }}>
          <BtnIcon src="/assets/ui/icon_play.png" fallback="▶" size={17} /> 계속하기
        </button>
        <button onClick={onGiveUp} style={{ ...secondaryBtn, flex: 1 }}>
          <BtnIcon src="/assets/ui/icon_exit.png" fallback="" size={15} />{" "}
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

// E3.18-2: 글로시 톤(그라데이션+상단 하이라이트+진한 하단 그림자) — 타이틀 버튼과 통일
// E3.24-1/2: CTA 배경을 pill 이미지 3-slice border-image로 — 좌우 캡(75px)만 자르고 세로는 통짜라
// 세로 그라데이션이 안 찌그러진다. 레이아웃 border는 0이라 파일이 없으면 기존 그라데이션 그대로 폴백.
const ctaImg = (name: string): React.CSSProperties => ({
  borderImage: `url(/assets/ui/${name}.png) 0 75 fill / 0 24px stretch`,
});

const primaryBtn: React.CSSProperties = {
  background: "linear-gradient(180deg, #5f8bff 0%, #2E66F6 48%, #2050d8 100%)",
  color: "#fff",
  border: "none",
  padding: "14px 24px",
  // 24px: cta 이미지 캡 곡률과 일치 — 999면 폴백 그라데이션이 이미지 모서리 밖으로 비침
  borderRadius: 24,
  fontSize: 17,
  fontWeight: 700,
  marginBottom: 12,
  cursor: "pointer",
  boxShadow:
    "inset 0 2px 0 rgba(255,255,255,0.35), inset 0 -2px 0 rgba(0,0,0,0.18), 0 4px 0 rgba(10,16,30,0.5), 0 6px 14px rgba(0,0,0,0.35)",
  textShadow: "0 1px 2px rgba(0,0,0,0.3)",
  ...ctaImg("cta_primary"),
};

const secondaryBtn: React.CSSProperties = {
  background: "linear-gradient(180deg, rgba(255,255,255,0.16), rgba(255,255,255,0.05) 55%, rgba(255,255,255,0.09))",
  color: "#cdd8ec",
  border: "1px solid rgba(255,255,255,0.3)",
  padding: "12px 16px",
  borderRadius: 22,
  fontSize: 15,
  fontWeight: 600,
  textAlign: "center",
  cursor: "pointer",
  boxShadow: "inset 0 1px 0 rgba(255,255,255,0.22), 0 3px 0 rgba(0,0,0,0.28), 0 5px 10px rgba(0,0,0,0.25)",
  ...ctaImg("cta_secondary"),
};

// E3.11-2: 좁은 화면에서 축소되되 3개 가로 배열 유지
const resultCard: React.CSSProperties = {
  // E3.18-3: 대각선 하이라이트 + 미세 내부 그림자(플랫 rgba 대체)
  background:
    "linear-gradient(135deg, rgba(255,255,255,0.14) 0%, rgba(255,255,255,0.05) 55%, rgba(255,255,255,0.09) 100%)",
  borderRadius: 14,
  padding: "clamp(6px, 2vh, 12px) clamp(8px, 2.2vw, 18px)",
  textAlign: "center",
  minWidth: 0,
  flex: 1,
  maxWidth: 170,
  boxShadow: "inset 0 1px 0 rgba(255,255,255,0.14), inset 0 -8px 14px rgba(0,0,0,0.16)",
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
