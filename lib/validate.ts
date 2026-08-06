// E8-보안2: 공통 입력 검증. 인증(앱 토큰)은 별도지만, 그 전에도 명백한 남용은 막는다.
// userId: 앱 uid(u_123) / 게스트(guest-xxxxxxxx) 형태 — 길이·문자 제한으로 DB·메모리 남용 차단.
export function sanitizeUserId(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const id = raw.trim();
  if (id.length < 1 || id.length > 64) return null;
  // 제어문자·공백 불가. 식별자에 쓰이는 안전 문자만(정상 uid/게스트/JWT sub 커버)
  if (!/^[A-Za-z0-9_.:-]+$/.test(id)) return null;
  return id;
}
