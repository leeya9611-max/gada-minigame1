import { GROUND_Y, VIEW, type RoundTheme } from "./config";

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
    sky: "/assets/maps/map1/sky.webp",
    silhouette: "/assets/maps/map1/silhouette.webp",
    ground: "/assets/maps/map1/ground.webp",
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

// 중경 표시 높이 — E3.7-1 규칙: 화면 높이의 55~65% (450×0.62 ≈ 280)
const SIL_H = 280;
// 중경 하단을 지면 상단선보다 아래로 내려, 밑단 컨테이너 줄이 지면 스트립 뒤로 살짝 묻히게
const SIL_SINK = 30;

// 중경 필터: 채도 -50%·명도 +10% — ctx.filter 대신 픽셀 연산(웹뷰 호환·프레임 비용 0).
// E3.8-3: 컨테이너 더미 등 중경 하단 오브젝트가 장애물(자재더미)과 구분되도록 채도 강하.
// bg_mid_buildings_v2는 이 필터를 전제로 채도가 보상 선적용된 이미지 — 필터를 끄거나 바꾸지 말 것.
const MID_SATURATE = 0.5;
const MID_BRIGHTEN = 1.12; // E3.17-2: +12%
const MID_CONTRAST = 0.78; // E3.17-2: 대비 압축(1=원본, 낮을수록 중간값으로)
const MID_PIVOT = 168; // 대비 압축 기준 밝기
const MID_BLUR_SCALE = 3; // E3.17-1: 다운샘플 배율(≈ 가우시안 2~3px 상당)

type LayerSource = HTMLImageElement | HTMLCanvasElement;

// E5: 팔레트 스왑 — hue-rotate + saturate + brightness를 픽셀 연산으로 1회 구워 캐시.
// ctx.filter는 웹뷰 호환·프레임 비용 문제로 미사용(기존 filterCache와 동일 원칙).
function themeCache(src: LayerSource, t: RoundTheme): HTMLCanvasElement | null {
  if (t.hue === 0 && t.saturate === 1 && t.brightness === 1) return null; // 원본 테마
  try {
    const cv = document.createElement("canvas");
    cv.width = src instanceof HTMLImageElement ? src.naturalWidth : src.width;
    cv.height = src instanceof HTMLImageElement ? src.naturalHeight : src.height;
    const c = cv.getContext("2d");
    if (!c) return null;
    c.drawImage(src, 0, 0);
    const data = c.getImageData(0, 0, cv.width, cv.height);
    const px = data.data;
    // 표준 hue-rotate 행렬(SVG/CSS filter 동일 계수)
    const rad = (t.hue * Math.PI) / 180;
    const cos = Math.cos(rad);
    const sin = Math.sin(rad);
    const m = [
      0.213 + cos * 0.787 - sin * 0.213, 0.715 - cos * 0.715 - sin * 0.715, 0.072 - cos * 0.072 + sin * 0.928,
      0.213 - cos * 0.213 + sin * 0.143, 0.715 + cos * 0.285 + sin * 0.14, 0.072 - cos * 0.072 - sin * 0.283,
      0.213 - cos * 0.213 - sin * 0.787, 0.715 - cos * 0.715 + sin * 0.715, 0.072 + cos * 0.928 + sin * 0.072,
    ];
    for (let i = 0; i < px.length; i += 4) {
      if (px[i + 3] === 0) continue;
      const r = px[i];
      const g = px[i + 1];
      const b = px[i + 2];
      let nr = m[0] * r + m[1] * g + m[2] * b;
      let ng = m[3] * r + m[4] * g + m[5] * b;
      let nb = m[6] * r + m[7] * g + m[8] * b;
      // saturate(루마 기준) → brightness
      const luma = 0.2126 * nr + 0.7152 * ng + 0.0722 * nb;
      nr = (luma + (nr - luma) * t.saturate) * t.brightness;
      ng = (luma + (ng - luma) * t.saturate) * t.brightness;
      nb = (luma + (nb - luma) * t.saturate) * t.brightness;
      px[i] = nr < 0 ? 0 : nr > 255 ? 255 : nr;
      px[i + 1] = ng < 0 ? 0 : ng > 255 ? 255 : ng;
      px[i + 2] = nb < 0 ? 0 : nb > 255 ? 255 : nb;
    }
    c.putImageData(data, 0, 0);
    return cv;
  } catch {
    return null; // 실패 시 원본 사용
  }
}

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
      const luma = 0.2126 * px[i] + 0.7152 * px[i + 1] + 0.0722 * px[i + 2];
      for (let ch = 0; ch < 3; ch++) {
        const v = (luma + (px[i + ch] - luma) * saturate) * brighten;
        // E3.17-2: 대비 압축 — 어두운 창문 등이 전경 아웃라인과 경쟁하지 않게
        px[i + ch] = Math.max(0, Math.min(255, MID_PIVOT + (v - MID_PIVOT) * MID_CONTRAST));
      }
    }
    c.putImageData(data, 0, 0);
    // E3.17-1: 약한 블러 — 1/N 다운샘플 후 업샘플(스무딩) ≈ 가우시안 2~3px. 캐시 1회.
    try {
      const small = document.createElement("canvas");
      small.width = Math.max(1, Math.round(cv.width / MID_BLUR_SCALE));
      small.height = Math.max(1, Math.round(cv.height / MID_BLUR_SCALE));
      const sc = small.getContext("2d");
      if (sc) {
        sc.imageSmoothingEnabled = true;
        sc.drawImage(cv, 0, 0, small.width, small.height);
        c.imageSmoothingEnabled = true;
        c.clearRect(0, 0, cv.width, cv.height);
        c.drawImage(small, 0, 0, cv.width, cv.height);
      }
    } catch {
      /* 블러 실패 시 색 보정본만 사용 */
    }
    return cv;
  } catch {
    return null; // CORS 등 실패 시 원본 사용
  }
}

export class Background {
  private imgs: Partial<Record<"sky" | "silhouette" | "ground", HTMLImageElement>> = {};
  private midFiltered: HTMLCanvasElement | null = null;
  // E5: 라운드 테마 캐시 — 레이어별 1회 굽기(null = 원본 그대로)
  private themed: Partial<Record<"sky" | "ground", HTMLCanvasElement>> = {};
  private ready = false;

  constructor(key: MapKey = "map1", theme?: RoundTheme) {
    if (typeof window === "undefined") return;
    const layers = MAP_LAYERS[key];
    const entries = Object.entries(layers) as ["sky" | "silhouette" | "ground", string][];
    let loaded = 0;
    for (const [k, src] of entries) {
      const img = new Image();
      img.onload = () => {
        if (k === "silhouette") {
          this.midFiltered = filterCache(img, MID_SATURATE, MID_BRIGHTEN);
          // 중경: 기존 채도·대비·블러 캐시 위에 테마를 이어서 굽기
          if (theme && this.midFiltered) {
            this.midFiltered = themeCache(this.midFiltered, theme) ?? this.midFiltered;
          }
        } else if (theme) {
          const tc = themeCache(img, theme);
          if (tc) this.themed[k] = tc;
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
  // E5: 테마가 구워졌으면 테마본 반환(캔버스도 drawImage 가능)
  get groundImage(): LayerSource | null {
    if (this.themed.ground) return this.themed.ground;
    const img = this.imgs.ground;
    return img && img.complete && img.naturalWidth > 0 ? img : null;
  }

  // scroll: 누적 스크롤 픽셀. skipGround=노선 지형 렌더러가 지면을 대신 그림.
  draw(ctx: CanvasRenderingContext2D, scroll: number, skipGround = false) {
    const { sky, silhouette, ground } = this.imgs;
    if (!sky || !ground) return;
    // 원경: 밑단을 지면선에 정렬, 화면 위까지 커버. 미러 타일링으로 이음새 제거.
    const skyH = Math.max(GROUND_Y, GROUND_Y * 1.02);
    this.tile(ctx, this.themed.sky ?? sky, GROUND_Y - skyH, skyH, scroll * P_SKY, { mirror: true });
    // 중경(있는 맵만): 하단을 지면선+SIL_SINK에 정렬(컨테이너 줄이 지면 뒤로 묻힘).
    // 필터 캐시본 사용, 미러 타일링.
    if (silhouette) {
      this.tile(
        ctx,
        this.midFiltered ?? silhouette,
        GROUND_Y + SIL_SINK - SIL_H,
        SIL_H,
        scroll * P_SIL,
        { alpha: 0.85, mirror: true }
      );
    }
    // 바닥 스트립: 지면 밴드, 월드 속도로 스크롤 (노선 모드에선 지형 렌더러가 대체)
    if (!skipGround) {
      this.tile(ctx, this.themed.ground ?? ground, GROUND_Y, VIEW.GROUND_H, scroll * P_GROUND);
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
