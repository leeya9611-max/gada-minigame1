// 스프라이트 로더 (WP4). 캔버스 drawImage용 프리로드 싱글턴.
// 김반장 = 커스텀(야리끼리 디자인), 소품·장애물 = Kenney CC0.

const BASE = "/assets/sprites";

// 김반장 커스텀 스프라이트 (야리끼리 디자인 액션 시트에서 슬라이스, 런 6프레임)
export const GIMBANJANG = {
  idle: `${BASE}/gimbanjang_custom/idle.png`,
  run1: `${BASE}/gimbanjang_custom/run1.png`,
  run2: `${BASE}/gimbanjang_custom/run2.png`,
  run3: `${BASE}/gimbanjang_custom/run3.png`,
  run4: `${BASE}/gimbanjang_custom/run4.png`,
  run5: `${BASE}/gimbanjang_custom/run5.png`,
  run6: `${BASE}/gimbanjang_custom/run6.png`,
  jump: `${BASE}/gimbanjang_custom/jump.png`,
  fall: `${BASE}/gimbanjang_custom/fall.png`,
  hurt: `${BASE}/gimbanjang_custom/hurt.png`,
  slide: `${BASE}/gimbanjang_custom/slide.png`,
} as const;

// 박소장 커스텀 (야리끼리 디자인 시트: 지시런/주먹대시/호루라기)
export const PARKSOJANG = {
  run1: `${BASE}/parksojang_custom/run1.png`,
  run2: `${BASE}/parksojang_custom/run2.png`,
  throw: `${BASE}/parksojang_custom/throw.png`,
} as const;

export const SPRITE_PATHS = {
  gb_idle: GIMBANJANG.idle,
  gb_run1: GIMBANJANG.run1,
  gb_run2: GIMBANJANG.run2,
  gb_run3: GIMBANJANG.run3,
  gb_run4: GIMBANJANG.run4,
  gb_run5: GIMBANJANG.run5,
  gb_run6: GIMBANJANG.run6,
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
