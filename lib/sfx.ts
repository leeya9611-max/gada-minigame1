// 사운드 재생 훅 — E8-2: WebAudio 버퍼 재생으로 교체(iOS 웹뷰 Audio() 엘리먼트 재트리거 렉 해결).
// 디코드는 preloadSfx()에서 1회, 재생은 BufferSource(비용 ~0). WebAudio 불가 환경은 구 Audio 폴백.
// 사용: playSfx("coin") → /sfx/coin.wav

const NAMES = [
  "button_click",
  "jump",
  "double_jump",
  "slide",
  "coin",
  "item_get",
  "booster",
  "throw_warn",
  "hit",
  "caught",
  "clear",
  "gameover",
] as const;

let actx: AudioContext | null | undefined;
const buffers = new Map<string, AudioBuffer>();
const elCache = new Map<string, HTMLAudioElement | null>(); // 폴백 경로
const lastAt = new Map<string, number>(); // 같은 소리 연타 스로틀
let muted = false;

function ctx(): AudioContext | null {
  if (typeof window === "undefined") return null;
  if (actx !== undefined) return actx;
  const AC =
    window.AudioContext ??
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  actx = AC ? new AC() : null;
  return actx;
}

// 게임 마운트 시 1회 호출 — 전 효과음 디코드(실패한 파일은 폴백 경로가 처리)
export function preloadSfx(): void {
  const c = ctx();
  if (!c) return;
  for (const name of NAMES) {
    if (buffers.has(name)) continue;
    fetch(`/sfx/${name}.wav`)
      .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject()))
      .then((ab) => c.decodeAudioData(ab))
      .then((buf) => buffers.set(name, buf))
      .catch(() => {
        /* 파일 없음 등 — playSfx가 폴백/스텁 처리 */
      });
  }
}

// E7-3 디버그 패널용 음소거 토글(렉 원인 분리)
export function setSfxMuted(m: boolean): void {
  muted = m;
}

export function playSfx(name: string): void {
  if (typeof window === "undefined" || muted) return;
  // 코인 줄 획득 등 같은 소리 연타 스로틀(45ms) — 재생 폭주 방지
  const now = performance.now();
  if (now - (lastAt.get(name) ?? -999) < 45) return;
  lastAt.set(name, now);

  const c = ctx();
  const buf = c ? buffers.get(name) : undefined;
  if (c && buf) {
    // iOS: 제스처 밖 재생으로 suspended 상태면 재개 시도(다음 제스처에서 풀림)
    if (c.state === "suspended") void c.resume();
    const src = c.createBufferSource();
    src.buffer = buf;
    src.connect(c.destination);
    src.start(0);
    return;
  }

  // ── 폴백: WebAudio 불가·디코드 전 — 구 Audio 엘리먼트 경로 ──
  let audio = elCache.get(name);
  if (audio === undefined) {
    audio = new Audio(`/sfx/${name}.wav`);
    audio.addEventListener("error", () => elCache.set(name, null));
    elCache.set(name, audio);
  }
  if (audio) {
    audio.currentTime = 0;
    audio.play().catch(() => console.log(`[SFX stub] ${name}`));
  } else {
    console.log(`[SFX stub] ${name}`);
  }
}
