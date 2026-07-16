import { GROUND_Y, VIEW } from "./config";

// 맵 배경: 최대 3단 패럴럭스 (하늘·원경 / 중경 / 바닥 스트립).
// 2026-07: map1을 AI 생성 에셋(bg_far_sunset/bg_mid_buildings/ground_strip)으로 교체.
// 로드 전에는 isReady=false → 벡터 폴백.
export interface MapLayers {
  sky: string; // 원경(하늘 포함, 밑단이 지면선에 정렬됨)
  silhouette?: string; // 중경(진짜 알파) — 채도·명도 필터 캐시 적용
  ground: string; // 바닥 스트립(월드 속도). 좌우 밝기 구배 → 에셋에 미러 타일 베이크됨
}

export type MapKey = "map1" | "map2";

export const MAP_LAYERS: Record<MapKey, MapLayers> = {
  // 도심 재건축(석양): 원경 스카이라인 + 공사중 건물 중경 + 연석·흙 바닥 (3단)
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

const SIL_H = 330; // 중경 표시 높이(바닥을 GROUND_Y에 정렬)

// 중경 필터: 채도 -40%·명도 +10% — ctx.filter 대신 픽셀 연산(웹뷰 호환·프레임 비용 0)
const MID_SATURATE = 0.6;
const MID_BRIGHTEN = 1.1;

type LayerSource = HTMLImageElement | HTMLCanvasElement;

// 오프스크린 캔버스에 채도·명도 필터를 1회 적용해 캐시
function filterCache(img: HTMLImageElement, saturate: number, brighten: number): HTMLCanvasElement | null {
  try {
    const cv = document.createElement("canvas");
    cv.width = img.naturalWidth;
    cv.height = img.naturalHeight;
    const c = cv.getContext("2d");
    if (!c) return null;
    c.drawImage(img, 0, 0);
    const data = c.getImageData(0, 0, cv.width, cv.height);
    const px = data.data;
    for (let i = 0; i < px.length; i += 4) {
      if (px[i + 3] === 0) continue;
      const r = px[i], g = px[i + 1], b = px[i + 2];
      const luma = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      px[i] = Math.min(255, (luma + (r - luma) * saturate) * brighten);
      px[i + 1] = Math.min(255, (luma + (g - luma) * saturate) * brighten);
      px[i + 2] = Math.min(255, (luma + (b - luma) * saturate) * brighten);
    }
    c.putImageData(data, 0, 0);
    return cv;
  } catch {
    return null; // CORS 등 실패 시 원본 사용
  }
}

export class Background {
  private imgs: Partial<Record<"sky" | "silhouette" | "ground", HTMLImageElement>> = {};
  private midFiltered: HTMLCanvasElement | null = null;
  private ready = false;

  constructor(key: MapKey = "map1") {
    if (typeof window === "undefined") return;
    const layers = MAP_LAYERS[key];
    const entries = Object.entries(layers) as ["sky" | "silhouette" | "ground", string][];
    let loaded = 0;
    for (const [k, src] of entries) {
      const img = new Image();
      img.onload = () => {
        if (k === "silhouette") {
          this.midFiltered = filterCache(img, MID_SATURATE, MID_BRIGHTEN);
        }
        if (++loaded === entries.length) this.ready = true;
      };
      img.src = src;
      this.imgs[k] = img;
    }
  }

  get isReady(): boolean {
    return this.ready;
  }

  // 노선 지형 렌더러가 표면 텍스처로 쓰는 바닥 이미지(미러 타일 베이크 — 모듈로 랩 이음새 없음)
  get groundImage(): HTMLImageElement | null {
    const img = this.imgs.ground;
    return img && img.complete && img.naturalWidth > 0 ? img : null;
  }

  // scroll: 누적 스크롤 픽셀. skipGround=노선 지형 렌더러가 지면을 대신 그림.
  draw(ctx: CanvasRenderingContext2D, scroll: number, skipGround = false) {
    const { sky, silhouette, ground } = this.imgs;
    if (!sky || !ground) return;
    // 원경: 밑단을 지면선에 정렬, 화면 위까지 커버. 미러 타일링으로 이음새 제거.
    const skyH = Math.max(GROUND_Y, GROUND_Y * 1.02);
    this.tile(ctx, sky, GROUND_Y - skyH, skyH, scroll * P_SKY, { mirror: true });
    // 중경(있는 맵만): 바닥을 지면선에 정렬. 필터 캐시본 사용, 미러 타일링.
    if (silhouette) {
      this.tile(ctx, this.midFiltered ?? silhouette, GROUND_Y - SIL_H, SIL_H, scroll * P_SIL, {
        alpha: 0.85,
        mirror: true,
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
  // mirror: 정방향↔좌우반전 교대(타일 인덱스 기준 결정적) — 밝기 구배·패턴 이음새 제거.
  private tile(
    ctx: CanvasRenderingContext2D,
    img: LayerSource,
    dy: number,
    dh: number,
    offset: number,
    opts?: { alpha?: number; mirror?: boolean }
  ) {
    const iw = img.width;
    const ih = img.height;
    if (iw <= 0 || ih <= 0) return;
    const dw = iw * (dh / ih);
    if (dw <= 0) return;
    ctx.save();
    if (opts?.alpha !== undefined) ctx.globalAlpha = opts.alpha;
    let start = -(offset % dw);
    if (start > 0) start -= dw;
    // 몇 번째 타일인지 — offset 기준 절대 인덱스(미러 교대의 시드)
    let idx = Math.floor(offset / dw);
    for (let x = start; x < VIEW.W + 1; x += dw - 1) {
      if (opts?.mirror && idx % 2 === 1) {
        ctx.save();
        ctx.translate(x + dw / 2, 0);
        ctx.scale(-1, 1);
        ctx.drawImage(img, -dw / 2, dy, dw, dh);
        ctx.restore();
      } else {
        // 1px 오버랩으로 타일 이음새 미세줄 방지
        ctx.drawImage(img, x, dy, dw, dh);
      }
      idx++;
    }
    ctx.restore();
  }
}
