import type { GameResult } from "@/app/game/engine/types";

// 게임 결과·네이티브 액션 요청 전달.
// 재화(티켓/포인트) 지급·차감은 네이티브 앱 권위. 웹은 표시·요청·결과전달만(개발명세서 2·5장).
// 1순위: postMessage (RN WebView / iOS WKWebView / 일반 iframe)
// 2순위(대체): 서버 콜백 API — 스펙 미확정(보류 항목), 실패 시 시도만.

// WP5: 네이티브 전달 결과값 = 엔진 결과 + 세션/티켓 메타
export interface NativeGameResult extends GameResult {
  sessionId: string;
  ticketUsed: number;
}

// 티켓 충전 등 네이티브에 위임하는 액션
export type NativeAction =
  | "watchAdForTicket"
  | "exchangePointsForTicket"
  | "inviteFriend"
  | "shareResult";

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

function post(type: string, payload: unknown): "postMessage" | "none" {
  const msg = JSON.stringify({ type, payload });
  const w = window as NativeBridgeWindow;

  if (w.ReactNativeWebView?.postMessage) {
    w.ReactNativeWebView.postMessage(msg);
    return "postMessage";
  }
  const handlers = w.webkit?.messageHandlers;
  const handler = type === RESULT_TYPE ? handlers?.gameResult : handlers?.nativeAction;
  if (handler?.postMessage) {
    handler.postMessage(payload);
    return "postMessage";
  }
  if (window.parent && window.parent !== window) {
    window.parent.postMessage({ type, payload }, "*");
    return "postMessage";
  }
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
