// 스프라이트 로더 + 캐릭터 클립 재생 (sprites_manifest.json 기반).
// 크기 통일 규칙: 실제 키(run1 알파 bbox 높이) → 동일 목표 화면 높이(TARGET_CHAR_H)로 스케일.
// 발바닥(baseline=bottom)을 지면에, 수평은 anchor.x 정렬.
import manifest from "@/public/assets/sprites/sprites_manifest.json";
import { VIEW } from "./config";

const BASE = "/assets/sprites";

// 두 캐릭터 공통 목표 화면 키 (플레이필드 높이의 28%)
export const TARGET_CHAR_H = Math.round(VIEW.H * 0.28); // 126px

export type CharKey = "gimbanjang" | "parksojang";

interface CharMeta {
  dir: string;
  canvasW: number;
  canvasH: number;
  anchorX: number; // 캔버스 좌표계 수평 앵커
  footY: number; // 캔버스 좌표계 발바닥 y (run1 알파 bbox bottom)
  realH: number; // 실제 키 = run1 알파 bbox 높이
}

// realH/footY는 run1 알파 bbox 실측값 (캔버스 높이로 그리면 안 됨 — 캐릭터별 여백이 달라 크기 틀어짐)
// 2026-07: AI 생성 시트(incoming_ai) 분할본 — 발바닥 기준선 정렬(footY=캔버스 하단 여백 10px)
export const CHARS: Record<CharKey, CharMeta> = {
  gimbanjang: {
    dir: `${BASE}/gimbanjang_custom`,
    canvasW: manifest.gimbanjang.canvas.w,
    canvasH: manifest.gimbanjang.canvas.h,
    anchorX: manifest.gimbanjang.anchor.x,
    footY: 722,
    realH: 520,
  },
  parksojang: {
    dir: `${BASE}/parksojang_custom`,
    canvasW: manifest.parksojang.canvas.w,
    canvasH: manifest.parksojang.canvas.h,
    anchorX: manifest.parksojang.anchor.x,
    footY: 710,
    realH: 453,
  },
};

export function charScale(who: CharKey): number {
  return TARGET_CHAR_H / CHARS[who].realH;
}

// ── 클립 재생: manifest clips의 frames를 fps대로 ──
interface Clip {
  frames: string[];
  fps: number;
  loop: boolean;
}

function clipOf(who: CharKey, name: string): Clip | null {
  const clips = (manifest as any)[who]?.clips as Record<string, Clip> | undefined;
  return clips?.[name] ?? null;
}

// elapsedMs 시점의 클립 프레임 파일명 (loop=false면 마지막 프레임 유지)
export function clipFrame(who: CharKey, name: string, elapsedMs: number): string | null {
  const clip = clipOf(who, name);
  if (!clip || clip.frames.length === 0) return null;
  const idx = Math.floor((elapsedMs / 1000) * clip.fps);
  const i = clip.loop
    ? idx % clip.frames.length
    : Math.min(idx, clip.frames.length - 1);
  return clip.frames[i];
}

// ── 구세트(비균일 캔버스) 프레임: slide/hurt/idle — 이미지 자체가 트림돼 있음 ──
const RAW_FRAMES = new Set(["slide.webp", "hurt.webp", "idle.webp"]);

export function isRawFrame(who: CharKey, file: string): boolean {
  return who === "gimbanjang" && RAW_FRAMES.has(file);
}

// ── 소품/장애물 ──
// 2026-07: AI 생성 에셋(incoming_ai) 반입 — 코인·장애물·투척물·소품.
// booster/cement/crate/hazard/post는 Kenney CC0 잔존분(airbar·폴백에서 계속 사용).
export const SPRITE_PATHS = {
  coin: `${BASE}/items/coin_helmet.png`,
  booster: `${BASE}/items/booster_star.png`,
  cement: `${BASE}/obstacles/cement.png`,
  crate: `${BASE}/obstacles/crate.png`,
  hazard: `${BASE}/obstacles/hazard.png`,
  post: `${BASE}/obstacles/post.png`,
  puddle: `${BASE}/obstacles/puddle.png`,
  stack: `${BASE}/obstacles/stack.png`,
  lowbar: `${BASE}/obstacles/lowbar.png`,
  fall_pipes: `${BASE}/obstacles/fall_pipes.png`,
  barrier: `${BASE}/obstacles/barrier.png`, // 지면 장애물 다양화용 예비(미사용)
  papers: `${BASE}/projectiles/papers.png`,
  tube: `${BASE}/projectiles/tube.png`,
  megaphone: `${BASE}/projectiles/megaphone.png`,
  cone: `${BASE}/props/cone.png`,
  sign_safety: `${BASE}/props/sign_safety.png`,
  fence_panel: `${BASE}/props/fence_panel.png`,
  busstop: `${BASE}/props/busstop.png`,
} as const;

export type SpriteKey = keyof typeof SPRITE_PATHS;

// ── 프리로드 ──
const images = new Map<string, HTMLImageElement>();
let ready = false;
let loading: Promise<void> | null = null;

function collectCharSources(): [string, string][] {
  const out: [string, string][] = [];
  for (const who of Object.keys(CHARS) as CharKey[]) {
    const meta = CHARS[who];
    const seen = new Set<string>();
    const clips = (manifest as any)[who]?.clips as Record<string, Clip>;
    for (const clip of Object.values(clips ?? {})) {
      for (const f of clip.frames) seen.add(f);
    }
    // 클립 외 개별 프레임(slide/hurt/idle 등)
    for (const extra of ["slide.webp", "hurt.webp", "idle.webp", "fall.webp"]) seen.add(extra);
    for (const f of seen) out.push([`${who}/${f}`, `${meta.dir}/${f}`]);
  }
  return out;
}

export function loadSprites(): Promise<void> {
  if (typeof window === "undefined") return Promise.resolve();
  if (loading) return loading;
  const entries: [string, string][] = [
    ...Object.entries(SPRITE_PATHS),
    ...collectCharSources(),
  ];
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
      img.onload = () => {
        computeTrim(key, img); // E3.9-1: 알파 트리밍(1회)
        tick();
      };
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

function get(key: string): HTMLImageElement | null {
  const img = images.get(key);
  return img && img.complete && img.naturalWidth > 0 ? img : null;
}

// 소품
export function sprite(key: SpriteKey): HTMLImageElement | null {
  return get(key);
}

// ── E3.9-1: 로드 시 알파 트리밍 ──
// 투명 여백이 남은 PNG가 반입돼도 OBSTACLE_RENDER 크기가 실물(알파 bbox) 기준이 되도록,
// 로드 시 bbox를 1회 계산해 소스 크롭으로 사용한다. 계산 실패 시 원본 전체 사용.
interface TrimBox {
  sx: number;
  sy: number;
  sw: number;
  sh: number;
}
const trimBoxes = new Map<string, TrimBox>();

function computeTrim(key: string, img: HTMLImageElement) {
  try {
    const cv = document.createElement("canvas");
    cv.width = img.naturalWidth;
    cv.height = img.naturalHeight;
    const c = cv.getContext("2d");
    if (!c) return;
    c.drawImage(img, 0, 0);
    const a = c.getImageData(0, 0, cv.width, cv.height).data;
    let x0 = cv.width, y0 = cv.height, x1 = -1, y1 = -1;
    for (let y = 0; y < cv.height; y++) {
      for (let x = 0; x < cv.width; x++) {
        if (a[(y * cv.width + x) * 4 + 3] > 16) {
          if (x < x0) x0 = x;
          if (x > x1) x1 = x;
          if (y < y0) y0 = y;
          if (y > y1) y1 = y;
        }
      }
    }
    if (x1 < 0) return; // 전부 투명
    trimBoxes.set(key, { sx: x0, sy: y0, sw: x1 - x0 + 1, sh: y1 - y0 + 1 });
  } catch {
    /* CORS·미지원 환경 → 트림 없이 원본 사용 */
  }
}

// 트림된 실물 종횡비(w/h). 미로드·미계산 시 natural 비율, 그것도 없으면 1.
export function spriteAspect(key: SpriteKey): number {
  const t = trimBoxes.get(key);
  if (t) return t.sw / t.sh;
  const img = get(key);
  return img && img.naturalHeight > 0 ? img.naturalWidth / img.naturalHeight : 1;
}

// 트림 영역을 소스로 대상 사각형에 그린다. 미로드 시 false(호출부 벡터 폴백).
export function drawSprite(
  ctx: CanvasRenderingContext2D,
  key: SpriteKey,
  dx: number,
  dy: number,
  dw: number,
  dh: number
): boolean {
  const img = get(key);
  if (!img) return false;
  const t = trimBoxes.get(key);
  if (t) ctx.drawImage(img, t.sx, t.sy, t.sw, t.sh, dx, dy, dw, dh);
  else ctx.drawImage(img, dx, dy, dw, dh);
  return true;
}

// 캐릭터 프레임
export function charSprite(who: CharKey, file: string): HTMLImageElement | null {
  return get(`${who}/${file}`);
}

// 캐릭터를 발 기준으로 그린다. footX = 발 중심 화면 x, footYPx = 발바닥 화면 y.
// 균일 캔버스 프레임: 매니페스트 canvas·anchor·실측 footY 사용.
// raw 프레임(구세트): 트림 이미지라 bbox 기준(하단=발, 수평 중앙).
export function drawChar(
  ctx: CanvasRenderingContext2D,
  who: CharKey,
  file: string,
  footX: number,
  footYPx: number,
  heightOverride?: number
): boolean {
  const img = charSprite(who, file);
  if (!img) return false;
  const meta = CHARS[who];
  if (isRawFrame(who, file)) {
    const dh = heightOverride ?? TARGET_CHAR_H;
    const dw = dh * (img.width / img.height);
    ctx.drawImage(img, footX - dw / 2, footYPx - dh, dw, dh);
    return true;
  }
  const s = (heightOverride ?? TARGET_CHAR_H) / meta.realH;
  const dw = meta.canvasW * s;
  const dh = meta.canvasH * s;
  const dx = footX - meta.anchorX * s;
  const dy = footYPx - meta.footY * s;
  ctx.drawImage(img, dx, dy, dw, dh);
  return true;
}
