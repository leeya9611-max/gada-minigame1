// 사운드 재생 훅 (WP8에서 파일 채움). 파일이 없으면 콘솔 로그 스텁으로 동작.
// 사용: playSfx("button_click") → /sfx/button_click.mp3 시도 → 실패 시 [SFX stub] 로그.

const cache = new Map<string, HTMLAudioElement | null>();

export function playSfx(name: string): void {
  if (typeof window === "undefined") return;
  let audio = cache.get(name);
  if (audio === undefined) {
    audio = new Audio(`/sfx/${name}.mp3`);
    audio.addEventListener("error", () => cache.set(name, null));
    cache.set(name, audio);
  }
  if (audio) {
    audio.currentTime = 0;
    audio.play().catch(() => console.log(`[SFX stub] ${name}`));
  } else {
    console.log(`[SFX stub] ${name}`);
  }
}
