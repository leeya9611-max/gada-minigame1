import type { GameResult } from "@/app/game/engine/types";

// 게임 결과·네이티브 액션 요청 전달.
// 재화(티켓/포인트) 지급·차감은 네이티브 앱 권위. 웹은 표시·요청·결과전달만(개발명세서 2·5장).
// 1순위: postMessage (RN WebView / iOS WKWebView / 일반 iframe)
// 2순위(대체): 서버 콜백 API — 스펙 미확정(보류 항목), 실패 시 시도만.

// WP5: 네이티브 전달 결과값 = 엔진 결과 + 세션/티켓 메타
export interface NativeGameResult extends GameResult {
  sessionId: string;
  ticketUsed: number;
  nickname: string; // 랭킹 표시명 (서버는 userId 권위, 닉네임은 표시용)
}

// 티켓 충전 등 네이티브에 위임하는 액션
export type NativeAction =
  | "watchAdForTicket"
  | "exchangePointsForTicket"
  | "inviteFriend"
  | "shareResult"
  | "exitGame"; // E3.28: 로비 나가기 — 네이티브가 웹뷰 닫기 처리(웹은 요청만)

interface NativeBridgeWindow extends Window {
  ReactNativeWebView?: { postMessage: (msg: string) => void };
  webkit?: {
    messageHandlers?: {
      gameResult?: { postMessage: (msg: unknown) => void };
      nativeAction?: { postMessage: (msg: unknown) => void };
    };
  };
}

const RESULT_TYPE = "GAME_RESULT" as const;
const ACTION_TYPE = "NATIVE_ACTION" as const;

// E7-3: 브리지 송신 관측 — 디버그 오버레이(?debug=1)가 구독. 오버레이 마운트 전 이벤트도
// 버퍼(__ykBridgeLog)에 남겨 앱 웹뷰에서 devtools 없이 송신 내역을 확인할 수 있게 한다.
export interface BridgeLogEntry {
  ts: number;
  type: string;
  channel: "ReactNativeWebView" | "webkit" | "parent" | "none";
  payload: unknown;
}
function traceBridge(entry: BridgeLogEntry): void {
  try {
    const w = window as unknown as { __ykBridgeLog?: BridgeLogEntry[] };
    (w.__ykBridgeLog ??= []).push(entry);
    if (w.__ykBridgeLog.length > 50) w.__ykBridgeLog.shift();
    window.dispatchEvent(new CustomEvent("yk-bridge", { detail: entry }));
  } catch {
    /* 관측 실패는 무시 */
  }
}

function post(type: string, payload: unknown): "postMessage" | "none" {
  const msg = JSON.stringify({ type, payload });
  const w = window as NativeBridgeWindow;

  if (w.ReactNativeWebView?.postMessage) {
    w.ReactNativeWebView.postMessage(msg);
    traceBridge({ ts: Date.now(), type, channel: "ReactNativeWebView", payload });
    return "postMessage";
  }
  const handlers = w.webkit?.messageHandlers;
  const handler = type === RESULT_TYPE ? handlers?.gameResult : handlers?.nativeAction;
  if (handler?.postMessage) {
    handler.postMessage(payload);
    traceBridge({ ts: Date.now(), type, channel: "webkit", payload });
    return "postMessage";
  }
  if (window.parent && window.parent !== window) {
    window.parent.postMessage({ type, payload }, "*");
    traceBridge({ ts: Date.now(), type, channel: "parent", payload });
    return "postMessage";
  }
  traceBridge({ ts: Date.now(), type, channel: "none", payload });
  return "none";
}

export function sendResultToNative(
  result: NativeGameResult
): "postMessage" | "callback" {
  // 명세대로 전달되는지 항상 콘솔로 확인(완료 기준).
  console.log("[GAME_RESULT]", JSON.stringify({ type: RESULT_TYPE, payload: result }));

  if (post(RESULT_TYPE, result) === "postMessage") return "postMessage";

  // 대체: 서버 콜백 (스펙 확정 전까지 best-effort 스텁)
  void postToServer(result);
  return "callback";
}

// 광고 시청/포인트 교환/초대/공유 — 실행은 네이티브가 담당, 웹은 요청만.
export function requestNativeAction(action: NativeAction): void {
  console.log("[NATIVE_ACTION]", action);
  post(ACTION_TYPE, { action });
}

async function postToServer(result: NativeGameResult): Promise<void> {
  try {
    await fetch("/api/result", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(result),
      keepalive: true,
    });
  } catch (e) {
    console.warn("[GAME_RESULT] 서버 콜백 실패(스펙 미확정)", e);
  }
}

// ── E4 주간 시즌 랭킹 (app/api/season 스텁 — 운영 서버 교체 시 경로만 유지) ──

export interface SeasonEntry {
  rank: number;
  nickname: string;
  weekScore: number;
}
export interface SeasonMe {
  rank: number;
  weekScore: number;
  todayBest: number;
}
export interface SeasonBoard {
  round: number;
  endsAt: string; // ISO — 현재 라운드 종료 시각
  entries: SeasonEntry[];
  me: SeasonMe | null;
}

// 엔들리스 결과를 시즌 베스트 후보로 전달(sendResultToNative와 병행, 실패 무시)
export async function postSeasonScore(result: NativeGameResult): Promise<void> {
  if (result.mode !== "endless") return; // edu 점수는 랭킹 제외
  try {
    await fetch("/api/season", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        userId: result.userId,
        nickname: result.nickname,
        score: result.rankScore,
        mode: result.mode,
        playDuration: result.playDuration, // E6-4: 서버 점수 상한 검증용
      }),
      keepalive: true,
    });
  } catch {
    /* 랭킹 반영 실패는 게임 흐름에 영향 없음 */
  }
}

// E3.31: 직전 시즌 값 캐시 — 로비 게이지가 서버 응답 전에 즉시 그려지게(닉네임 캐시 패턴).
// round/endsAt만 저장(성적은 실시간성 우선이라 미캐시).
const SEASON_CACHE_KEY = "yarikkiri.season.last";

export function loadCachedSeason(): SeasonBoard | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(SEASON_CACHE_KEY);
    if (!raw) return null;
    const { round, endsAt } = JSON.parse(raw) as { round?: number; endsAt?: string };
    if (typeof round !== "number" || typeof endsAt !== "string") return null;
    return { round, endsAt, entries: [], me: null };
  } catch {
    return null;
  }
}

export function saveCachedSeason(b: SeasonBoard): void {
  try {
    window.localStorage.setItem(SEASON_CACHE_KEY, JSON.stringify({ round: b.round, endsAt: b.endsAt }));
  } catch {
    /* 무시 */
  }
}

// 주간 랭킹 조회 — 실패 시 null(호출부는 조용히 숨김)
export async function fetchSeason(userId: string): Promise<SeasonBoard | null> {
  try {
    const res = await fetch(`/api/season?userId=${encodeURIComponent(userId)}`);
    if (!res.ok) return null;
    return (await res.json()) as SeasonBoard;
  } catch {
    return null;
  }
}

// 라운드 종료까지 남은 일수(D-day 표기용, 최소 1)
export function daysLeft(endsAt: string): number {
  return Math.max(1, Math.ceil((Date.parse(endsAt) - Date.now()) / 86400_000));
}
