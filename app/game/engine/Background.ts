import { GROUND_Y, VIEW } from "./config";

// 맵 배경: 최대 3단 패럴럭스 (하늘·원경 / 실루엣(옵션) / 바닥 스트립).
// 야리끼리 디자인 레이어 기반. 로드 전에는 isReady=false → 벡터 폴백.
export interface MapLayers {
  sky: string; // 원경(밑단이 지면선에 정렬됨)
  silhouette?: string; // 중경 실루엣(진짜 알파)
  ground: string; // 바닥 스트립(월드 속도)
}

export type MapKey = "map1" | "map2";

export const MAP_LAYERS: Record<MapKey, MapLayers> = {
  // 도심 재건축: 하늘 + 크레인 실루엣 + 흙바닥 (3단)
  map1: {
    sky: "/assets/maps/map1/sky.png",
    silhouette: "/assets/maps/map1/silhouette.png",
    ground: "/assets/maps/map1/ground.png",
  },
  // 아파트 골조(황혼): 합성 원경 + 바닥 스트립 (2단)
  map2: {
    sky: "/assets/maps/map2/back.png",
    ground: "/assets/maps/map2/ground.png",
  },
};

// 레이어별 패럴럭스 계수(멀수록 느리게)
const P_SKY = 0.06;
const P_SIL = 0.3;
const P_GROUND = 1;

const SIL_H = 330; // 실루엣 표시 높이(바닥을 GROUND_Y에 정렬)

export class Background {
  private imgs: Partial<Record<"sky" | "silhouette" | "ground", HTMLImageElement>> = {};
  private ready = false;

  constructor(key: MapKey = "map1") {
    if (typeof window === "undefined") return;
    const layers = MAP_LAYERS[key];
    const entries = Object.entries(layers) as ["sky" | "silhouette" | "ground", string][];
    let loaded = 0;
    for (const [k, src] of entries) {
      const img = new Image();
      img.onload = () => {
        if (++loaded === entries.length) this.ready = true;
      };
      img.src = src;
      this.imgs[k] = img;
    }
  }

  get isReady(): boolean {
    return this.ready;
  }

  // scroll: 누적 스크롤 픽셀
  draw(ctx: CanvasRenderingContext2D, scroll: number) {
    const { sky, silhouette, ground } = this.imgs;
    if (!sky || !ground) return;
    // 원경: 밑단을 지면선에 정렬, 화면 위까지 커버
    const skyH = Math.max(GROUND_Y, GROUND_Y * 1.02);
    this.tile(ctx, sky, GROUND_Y - skyH, skyH, scroll * P_SKY);
    // 실루엣(있는 맵만): 바닥을 지면선에 정렬
    if (silhouette) {
      this.tile(ctx, silhouette, GROUND_Y - SIL_H, SIL_H, scroll * P_SIL);
    }
    // 바닥 스트립: 지면 밴드, 월드 속도로 스크롤
    this.tile(ctx, ground, GROUND_Y, VIEW.GROUND_H, scroll * P_GROUND);
  }

  // 지정 높이로 스케일해 가로로 이어붙여 화면 폭을 채운다.
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
    for (let x = start; x < VIEW.W + 1; x += dw - 1) {
      // 1px 오버랩으로 타일 이음새 미세줄 방지
      ctx.drawImage(img, x, dy, dw, dh);
    }
  }
}
