import type { GameResult } from "@/app/game/engine/types";

// 게임 결과를 네이티브 앱으로 전달.
// 재화 지급은 네이티브 앱이 담당하며, 웹앱은 결과값만 계산해 넘긴다(주의사항).
// 1순위: postMessage (RN WebView / iOS WKWebView / 일반 iframe)
// 2순위(대체): 서버 콜백 API — 스펙 미확정(보류 항목), 실패 시 시도만.

interface NativeBridgeWindow extends Window {
  ReactNativeWebView?: { postMessage: (msg: string) => void };
  webkit?: {
    messageHandlers?: { gameResult?: { postMessage: (msg: unknown) => void } };
  };
}

const MESSAGE_TYPE = "GAME_RESULT" as const;

export function sendResult(result: GameResult): "postMessage" | "callback" | "none" {
  const payload = JSON.stringify({ type: MESSAGE_TYPE, payload: result });

  // 명세대로 전달되는지 항상 콘솔로 확인 가능하게 남긴다(4단계 완료 기준).
  console.log("[GAME_RESULT]", payload);

  const w = window as NativeBridgeWindow;

  // React Native WebView
  if (w.ReactNativeWebView?.postMessage) {
    w.ReactNativeWebView.postMessage(payload);
    return "postMessage";
  }

  // iOS WKWebView 메시지 핸들러
  if (w.webkit?.messageHandlers?.gameResult?.postMessage) {
    w.webkit.messageHandlers.gameResult.postMessage(result);
    return "postMessage";
  }

  // 일반 iframe/부모 창
  if (window.parent && window.parent !== window) {
    window.parent.postMessage({ type: MESSAGE_TYPE, payload: result }, "*");
    return "postMessage";
  }

  // 대체: 서버 콜백 (스펙 확정 전까지 best-effort)
  void postToServer(result);
  return "callback";
}

async function postToServer(result: GameResult): Promise<void> {
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
