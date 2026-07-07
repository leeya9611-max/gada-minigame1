import { GROUND_Y, VIEW } from "./config";

// 맵1(도심 재건축) 배경.
// Gemini 레이어는 투명이 픽셀로 구워져 있어(알파 전부 불투명) 분리 불가 →
// 완결 합성본(scene)을 원경으로 느리게 패럴럭스하고, 러닝 지면 밴드는 별도로
// 빠르게 스크롤해 깊이감을 준다. 이미지 로드 전에는 isReady=false(벡터 폴백).
const SCENE_SRC = "/assets/maps/map1/scene.png";

// scene에서 흙바닥이 시작되는 세로 비율(샘플링값). 이 지점을 GROUND_Y에 맞춘다.
const SCENE_GROUND_FRAC = 0.82;
// 지면선을 GROUND_Y에 맞추고 상단은 0에 닿게 스케일 → 가로(800px) 뷰에서 파노라마 전체가 보임.
const SCENE_H = GROUND_Y / SCENE_GROUND_FRAC;
const SCENE_TOP = GROUND_Y - SCENE_GROUND_FRAC * SCENE_H; // ≈ 0
// scene 상단 하늘색(샘플링 (255,223,183))과 맞춰 이음새 제거
const SKY_TOP = "#ffdfb7";
const SKY_BOTTOM = "#ffe9cf";

const P_SCENE = 0.3; // 원경 패럴럭스(느리게)

// 러닝 지면(scene 흙색과 맞춤)
const DIRT = "#bca184";
const DIRT_EDGE = "#a8895f";
const DIRT_DASH = "#cdb493";

export class Background {
  private scene: HTMLImageElement | null = null;
  private ready = false;

  constructor() {
    if (typeof window === "undefined") return;
    const img = new Image();
    img.onload = () => (this.ready = true);
    img.src = SCENE_SRC;
    this.scene = img;
  }

  get isReady(): boolean {
    return this.ready;
  }

  draw(ctx: CanvasRenderingContext2D, scroll: number) {
    if (!this.scene) return;
    // 하늘(scene 상단과 동색으로 상단 여백 채움)
    const g = ctx.createLinearGradient(0, 0, 0, GROUND_Y);
    g.addColorStop(0, SKY_TOP);
    g.addColorStop(1, SKY_BOTTOM);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, VIEW.W, GROUND_Y);
    // 원경 합성본(가로 타일, 느린 패럴럭스)
    this.tile(ctx, this.scene, SCENE_TOP, SCENE_H, scroll * P_SCENE);
    // 러닝 지면 밴드(빠른 스크롤)
    this.drawGround(ctx, scroll);
  }

  private tile(
    ctx: CanvasRenderingContext2D,
    img: HTMLImageElement,
    dy: number,
    dh: number,
    offset: number
  ) {
    const dw = img.width * (dh / img.height);
    if (dw <= 0) return;
    let start = -(offset % dw);
    if (start > 0) start -= dw;
    for (let x = start; x < VIEW.W; x += dw) {
      ctx.drawImage(img, x, dy, dw, dh);
    }
  }

  private drawGround(ctx: CanvasRenderingContext2D, scroll: number) {
    ctx.fillStyle = DIRT;
    ctx.fillRect(0, GROUND_Y, VIEW.W, VIEW.GROUND_H);
    ctx.fillStyle = DIRT_EDGE;
    ctx.fillRect(0, GROUND_Y, VIEW.W, 5);
    // 이동감 표시용 점선(전경 속도)
    ctx.fillStyle = DIRT_DASH;
    const gap = 40;
    const off = scroll % gap;
    for (let x = -off + (gap - 0); x < VIEW.W; x += gap) {
      ctx.fillRect(x, GROUND_Y + 26, 22, 5);
    }
  }
}
