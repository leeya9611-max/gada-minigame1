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

  // 노선 지형 렌더러가 표면 텍스처로 쓰는 바닥 이미지
  get groundImage(): HTMLImageElement | null {
    const img = this.imgs.ground;
    return img && img.complete && img.naturalWidth > 0 ? img : null;
  }

  // scroll: 누적 스크롤 픽셀. skipGround=노선 지형 렌더러가 지면을 대신 그림.
  draw(ctx: CanvasRenderingContext2D, scroll: number, skipGround = false) {
    const { sky, silhouette, ground } = this.imgs;
    if (!sky || !ground) return;
    // 원경: 밑단을 지면선에 정렬, 화면 위까지 커버. 원경답게 채도·대비 낮춤.
    const skyH = Math.max(GROUND_Y, GROUND_Y * 1.02);
    this.tile(ctx, sky, GROUND_Y - skyH, skyH, scroll * P_SKY, {
      filter: "saturate(0.9)",
    });
    // 실루엣(있는 맵만): 바닥을 지면선에 정렬.
    // 반복 티 안 나게 타일별 스킵/스케일/반전 변주 + 채도·대비 낮춰 캐릭터가 튀게.
    if (silhouette) {
      this.tile(ctx, silhouette, GROUND_Y - SIL_H, SIL_H, scroll * P_SIL, {
        filter: "saturate(0.55) contrast(0.85) brightness(1.06)",
        alpha: 0.8,
        vary: true,
      });
    }
    // 바닥 스트립: 지면 밴드, 월드 속도로 스크롤 (노선 모드에선 지형 렌더러가 대체)
    if (!skipGround) {
      this.tile(ctx, ground, GROUND_Y, VIEW.GROUND_H, scroll * P_GROUND);
    }
    // 근경(전경) 레이어: 지면 하단을 빠르게 지나가는 어두운 안전펜스 실루엣 — 깊이감
    this.drawForeground(ctx, scroll);
  }

  // 얇은 전경: 반투명 펜스 기둥·바 실루엣이 월드보다 빠르게(1.3x) 흐름
  private drawForeground(ctx: CanvasRenderingContext2D, scroll: number) {
    const off = scroll * 1.3;
    const spacing = 260;
    ctx.save();
    ctx.fillStyle = "rgba(30, 36, 52, 0.28)";
    const barY = VIEW.H - 26;
    // 가로 바
    ctx.fillRect(0, barY, VIEW.W, 7);
    // 기둥(간격 변주)
    let start = -(off % spacing);
    if (start > 0) start -= spacing;
    for (let x = start, i = Math.floor(off / spacing); x < VIEW.W; x += spacing, i++) {
      const jitter = ((i * 53) % 40) - 20; // 결정적 간격 변주
      ctx.fillRect(x + jitter, barY - 14, 9, 40);
    }
    ctx.restore();
  }

  // 지정 높이로 스케일해 가로로 이어붙여 화면 폭을 채운다.
  // vary: 타일별 결정적 변주(간헐 스킵·스케일·좌우반전)로 반복 패턴 제거.
  private tile(
    ctx: CanvasRenderingContext2D,
    img: HTMLImageElement,
    dy: number,
    dh: number,
    offset: number,
    opts?: { filter?: string; alpha?: number; vary?: boolean }
  ) {
    const dw = img.width * (dh / img.height);
    if (dw <= 0) return;
    ctx.save();
    if (opts?.filter && "filter" in ctx) ctx.filter = opts.filter;
    if (opts?.alpha !== undefined) ctx.globalAlpha = opts.alpha;
    let start = -(offset % dw);
    if (start > 0) start -= dw;
    // 몇 번째 타일인지 — offset 기준 절대 인덱스(결정적 변주의 시드)
    let idx = Math.floor(offset / dw);
    for (let x = start; x < VIEW.W + 1; x += dw - 1) {
      if (opts?.vary) {
        // 4타일마다 1개 스킵 → 크레인 밀도·반복감 감소(하늘이 보임)
        if (idx % 4 === 2) {
          idx++;
          continue;
        }
        const s = 0.82 + ((idx * 37) % 10) / 50; // 0.82~1.0 스케일 변주
        const vdh = dh * s;
        const vdw = dw * s;
        const vdy = dy + (dh - vdh); // 바닥 정렬 유지
        if (idx % 2 === 1) {
          ctx.save();
          ctx.translate(x + dw / 2, 0);
          ctx.scale(-1, 1);
          ctx.drawImage(img, -vdw / 2, vdy, vdw, vdh);
          ctx.restore();
        } else {
          ctx.drawImage(img, x + (dw - vdw) / 2, vdy, vdw, vdh);
        }
      } else {
        // 1px 오버랩으로 타일 이음새 미세줄 방지
        ctx.drawImage(img, x, dy, dw, dh);
      }
      idx++;
    }
    ctx.restore();
  }
}
