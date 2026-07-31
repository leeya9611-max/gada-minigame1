// 사운드 재생 훅 — E7: jsfxr 생성 WAV 12종 반입(public/sfx/*.wav). 파일이 없으면 콘솔 로그 스텁.
// WAV 채택 이유: ffmpeg 없이 반입 가능 + iOS 웹뷰가 OGG 미지원(mp3/aac 변환 도구 확보 시 교체 가능).
// 사용: playSfx("coin") → /sfx/coin.wav

const cache = new Map<string, HTMLAudioElement | null>();

export function playSfx(name: string): void {
  if (typeof window === "undefined") return;
  let audio = cache.get(name);
  if (audio === undefined) {
    audio = new Audio(`/sfx/${name}.wav`);
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
