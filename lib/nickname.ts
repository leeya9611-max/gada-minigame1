// 닉네임: 현장 감성 자동 생성 + 검증 + 저장 (이벤트 피벗 기획 2.5)
// 원칙: 중복의 최종 권위는 서버(/api/nickname). 클라이언트는 생성·표시·등록 요청만.
// localStorage 는 캐시 — 재방문 판정은 userId 기준 서버 조회가 우선.

const KEY_PREFIX = "yarikkiri.nickname.";

// ── 자동 생성 풀 (수식어 × 직함 ≈ 800 조합) ──
const NICK_PREFIX = [
  "불도저", "칼퇴", "번개", "야리끼리", "강철", "새벽", "우직한", "날쌘",
  "베테랑", "전설의", "무적", "황금", "질주", "안전제일", "현장", "타워크레인",
  "철근", "미장", "목수", "용접", "도면", "슬기로운", "성실한", "부지런한",
  "바람같은", "천하제일", "숨은", "진격의", "여유만만", "화끈한", "묵묵한",
  "단단한", "빛나는", "끈질긴", "유쾌한", "씩씩한",
] as const;

const NICK_SUFFIX = [
  "김씨", "반장", "장인", "달인", "십장", "기공", "조공", "에이스",
  "큰형님", "맏형", "일꾼", "해결사", "마스터", "챔피언", "선생", "박사",
  "사나이", "대장", "지킴이", "질주왕", "칼퇴왕", "고수",
] as const;

// 직전 결과와 다른 조합을 뽑는다(주사위 연타 시 같은 이름 방지)
export function generateNickname(prev?: string | null): string {
  for (let i = 0; i < 10; i++) {
    const p = NICK_PREFIX[Math.floor(Math.random() * NICK_PREFIX.length)];
    const s = NICK_SUFFIX[Math.floor(Math.random() * NICK_SUFFIX.length)];
    const name = `${p} ${s}`;
    if (name !== prev) return name;
  }
  return `${NICK_PREFIX[0]} ${NICK_SUFFIX[0]}`;
}

// ── 검증 (직접 입력용) ──
// 2~10자(공백 포함), 한글·영문·숫자·공백만. 금칙어 필터.
const BANNED = ["시발", "씨발", "병신", "개새", "좆", "새끼", "섹스", "運營", "관리자", "운영자"];

export type NicknameValidation =
  | { ok: true; name: string }
  | { ok: false; reason: string };

export function validateNickname(raw: string): NicknameValidation {
  const name = raw.trim().replace(/\s+/g, " ");
  if (name.length < 2) return { ok: false, reason: "2자 이상 입력해 주세요" };
  if (name.length > 10) return { ok: false, reason: "10자 이하로 입력해 주세요" };
  if (!/^[가-힣a-zA-Z0-9 ]+$/.test(name))
    return { ok: false, reason: "한글·영문·숫자만 쓸 수 있어요" };
  const compact = name.replace(/\s/g, "").toLowerCase();
  if (BANNED.some((w) => compact.includes(w.toLowerCase())))
    return { ok: false, reason: "사용할 수 없는 단어가 있어요" };
  return { ok: true, name };
}

// ── 로컬 캐시 ──
export function loadNickname(userId: string): string | null {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem(KEY_PREFIX + userId);
}

export function saveNickname(userId: string, name: string): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(KEY_PREFIX + userId, name);
}

// ── 서버 등록 (중복 확인 포함) ──
// offline=true: 서버 연결 실패 → 로컬만 저장된 상태. 다음 접속에서 재동기화 대상.
export type RegisterResult =
  | { ok: true; name: string; offline?: boolean }
  | { ok: false; reason: "duplicate"; suggestion: string }
  | { ok: false; reason: "invalid" };

export async function registerNickname(
  userId: string,
  name: string
): Promise<RegisterResult> {
  const v = validateNickname(name);
  if (!v.ok) return { ok: false, reason: "invalid" };

  try {
    const res = await fetch("/api/nickname", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId, name: v.name }),
    });
    const data = (await res.json()) as
      | { ok: true; name: string }
      | { ok: false; reason: "duplicate"; suggestion: string }
      | { ok: false; reason: "invalid" };
    if (data.ok) {
      saveNickname(userId, data.name);
      return { ok: true, name: data.name };
    }
    return data;
  } catch {
    // 서버 없음/오프라인 — 로컬 저장으로 진행(개발·데모용). 운영에선 서버 필수.
    saveNickname(userId, v.name);
    return { ok: true, name: v.name, offline: true };
  }
}

// 서버에 저장된 닉네임 조회(재방문·기기 변경 대응). 실패 시 null.
export async function fetchNickname(userId: string): Promise<string | null> {
  try {
    const res = await fetch(`/api/nickname?userId=${encodeURIComponent(userId)}`);
    if (!res.ok) return null;
    const data = (await res.json()) as { name: string | null };
    if (data.name) saveNickname(userId, data.name);
    return data.name;
  } catch {
    return null;
  }
}
