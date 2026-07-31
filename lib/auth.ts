// 딥링크 진입 토큰 파싱 및 유저 식별.
// 토큰에는 개인정보를 포함하지 않는다(주의사항). userId 등 식별자만 담긴다.

export interface SessionUser {
  userId: string;
  isGuest: boolean;
}

// E8-6: 게스트를 기기별 고유 ID로 — 토큰 없이 접속한 테스터들이 전부 "guest" 하나로 묶여
// 서버 닉네임·이수·점수를 공유하던 문제. localStorage에 1회 발급·고정(SSR은 임시 "guest").
function guestUser(): SessionUser {
  if (typeof window === "undefined") return { userId: "guest", isGuest: true };
  try {
    let id = window.localStorage.getItem("yk_guest_id");
    if (!id) {
      id = "guest-" + Math.random().toString(36).slice(2, 10);
      window.localStorage.setItem("yk_guest_id", id);
    }
    return { userId: id, isGuest: true };
  } catch {
    return { userId: "guest", isGuest: true };
  }
}

// base64url → 문자열 (브라우저 atob 기반)
function base64UrlDecode(input: string): string {
  const pad = input.length % 4 === 0 ? "" : "=".repeat(4 - (input.length % 4));
  const b64 = input.replace(/-/g, "+").replace(/_/g, "/") + pad;
  try {
    return decodeURIComponent(
      atob(b64)
        .split("")
        .map((c) => "%" + c.charCodeAt(0).toString(16).padStart(2, "0"))
        .join("")
    );
  } catch {
    return "";
  }
}

// 토큰 형식(협의 전 잠정): base64url(JSON) 또는 JWT의 payload.
// { "uid": "u_123", "exp": 1720000000 } 형태를 기대. exp 있으면 만료 검증.
export function parseToken(token: string | null | undefined): SessionUser {
  if (!token) return guestUser();

  // JWT라면 가운데(payload) 조각 사용
  const segment = token.includes(".") ? token.split(".")[1] : token;
  const json = base64UrlDecode(segment);
  if (!json) return guestUser();

  try {
    const payload = JSON.parse(json) as Record<string, unknown>;
    const uid =
      (payload.uid as string) ||
      (payload.userId as string) ||
      (payload.sub as string);
    if (!uid) return guestUser();

    const exp = payload.exp as number | undefined;
    if (typeof exp === "number" && exp * 1000 < Date.now()) {
      return guestUser(); // 만료 토큰 → 게스트 처리
    }
    return { userId: String(uid), isGuest: false };
  } catch {
    return guestUser();
  }
}
