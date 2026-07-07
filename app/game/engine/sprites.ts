// 스프라이트 로더 (WP4). Kenney CC0 에셋, 캔버스 drawImage용 프리로드 싱글턴.
// 김반장은 임시 플레이스홀더 — 커스텀(파란 작업복+안전모) 확보 시 아래 경로만 교체.

const BASE = "/assets/sprites";

// 교체 지점: 김반장 스프라이트 경로 상수 (ASSETS.md 참조)
export const GIMBANJANG = {
  idle: `${BASE}/gimbanjang/gimbanjang_idle.png`,
  run1: `${BASE}/gimbanjang/gimbanjang_run1.png`,
  run2: `${BASE}/gimbanjang/gimbanjang_run2.png`,
  jump: `${BASE}/gimbanjang/gimbanjang_jump.png`,
  fall: `${BASE}/gimbanjang/gimbanjang_fall.png`,
  hurt: `${BASE}/gimbanjang/gimbanjang_hurt.png`,
  slide: `${BASE}/gimbanjang/gimbanjang_duck.png`,
} as const;

export const PARKSOJANG = {
  run1: `${BASE}/parksojang/parksojang_run1.png`,
  run2: `${BASE}/parksojang/parksojang_run2.png`,
  throw: `${BASE}/parksojang/parksojang_throw.png`,
} as const;

export const SPRITE_PATHS = {
  gb_idle: GIMBANJANG.idle,
  gb_run1: GIMBANJANG.run1,
  gb_run2: GIMBANJANG.run2,
  gb_jump: GIMBANJANG.jump,
  gb_fall: GIMBANJANG.fall,
  gb_hurt: GIMBANJANG.hurt,
  gb_slide: GIMBANJANG.slide,
  ps_run1: PARKSOJANG.run1,
  ps_run2: PARKSOJANG.run2,
  ps_throw: PARKSOJANG.throw,
  coin: `${BASE}/items/coin_gold.png`,
  booster: `${BASE}/items/booster_star.png`,
  cement: `${BASE}/obstacles/cement.png`, // 시멘트 웅덩이(액체 타일)
  crate: `${BASE}/obstacles/crate.png`, // 자재 더미(크레이트)
  hazard: `${BASE}/obstacles/hazard.png`, // 위험 줄무늬(lowbar 바)
  post: `${BASE}/obstacles/post.png`, // 기둥(lowbar 지지대)
} as const;

export type SpriteKey = keyof typeof SPRITE_PATHS;

const images = new Map<string, HTMLImageElement>();
let ready = false;
let loading: Promise<void> | null = null;

export function loadSprites(): Promise<void> {
  if (typeof window === "undefined") return Promise.resolve();
  if (loading) return loading;
  const entries = Object.entries(SPRITE_PATHS);
  loading = new Promise((resolve) => {
    let done = 0;
    const tick = () => {
      if (++done === entries.length) {
        ready = true;
        resolve();
      }
    };
    for (const [key, src] of entries) {
      const img = new Image();
      img.onload = tick;
      img.onerror = tick; // 실패해도 진행(해당 스프라이트만 벡터 폴백)
      img.src = src;
      images.set(key, img);
    }
  });
  return loading;
}

export function spritesReady(): boolean {
  return ready;
}

// 로드 완료된 이미지만 반환(미완/실패 시 null → 호출부 벡터 폴백)
export function sprite(key: SpriteKey): HTMLImageElement | null {
  const img = images.get(key);
  return img && img.complete && img.naturalWidth > 0 ? img : null;
}
