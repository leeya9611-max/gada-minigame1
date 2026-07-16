import { GROUND_Y, PLAYER, PROJECTILE, VIEW } from "./config";
import { sprite } from "./sprites";
import type {
  Box,
  ItemKind,
  ObstacleKind,
  ProjectileKind,
} from "./types";

// 화면 왼쪽으로 흘러가는 모든 월드 엔티티의 공통 인터페이스
interface Entity {
  dead: boolean;
  box: Box;
  update(dt: number, worldSpeed: number, now: number): void;
  draw(ctx: CanvasRenderingContext2D, now: number): void;
}

// ── 지상 장애물: 시멘트 웅덩이 / 자재 더미 / 낮은통과형 / 공중(airbar) ──
export class Obstacle implements Entity {
  x: number;
  dead = false;
  kind: ObstacleKind;
  w: number;
  h: number;
  gap: number; // 바닥과 박스 하단 사이 여유(슬라이드 통과용). 지상 장애물은 0.
  baseY: number; // 이 장애물이 서 있는 지면 y (노선 지형 반영)

  constructor(kind: ObstacleKind, baseY: number = GROUND_Y, airY?: number) {
    this.kind = kind;
    this.x = VIEW.W + 40;
    this.baseY = baseY;
    if (kind === "puddle") {
      this.w = 86;
      this.h = 32;
      this.gap = 0;
    } else if (kind === "lowbar") {
      // 낮은 통과형: 상단을 화면 최상단(0)까지 완전 차단 — 1·2단 점프 모두 충돌(E3.5-11).
      // 하단 gap(56)만 슬라이드(48)로 통과.
      this.w = 48;
      this.gap = 56;
      this.h = baseY - this.gap; // top = 0
    } else if (kind === "airbar") {
      // 공중 장애물(노선 obs_air): slot 높이에 고정. 슬라이드/타이밍으로 회피.
      this.w = 48;
      this.h = 34;
      // airY = 박스 중심 y → gap으로 환산
      const centerY = airY ?? baseY - 70;
      this.gap = Math.max(0, baseY - centerY - this.h / 2);
    } else {
      // 자재 더미 — 캐릭터 키(126px) 대비 무릎~허리 높이
      this.w = 52;
      this.h = 68;
      this.gap = 0;
    }
  }

  get box(): Box {
    return {
      x: this.x,
      y: this.baseY - this.gap - this.h,
      w: this.w,
      h: this.h,
    };
  }

  update(dt: number, worldSpeed: number, _now?: number) {
    this.x -= worldSpeed * dt;
    if (this.x + this.w < -20) this.dead = true;
  }

  draw(ctx: CanvasRenderingContext2D, _now?: number) {
    const b = this.box;
    if (this.kind === "puddle") {
      // 시멘트 웅덩이 — AI 에셋(완성 아트라 클립·외곽선 불필요), 미로드 시 벡터
      const img = sprite("puddle");
      if (img) {
        const dw = b.w + 10;
        const dh = dw * (img.height / img.width);
        ctx.drawImage(img, b.x - 5, this.baseY - dh + 3, dw, dh);
        return;
      }
      ctx.fillStyle = "#7a8699";
      ctx.beginPath();
      ctx.ellipse(b.x + b.w / 2, this.baseY - 2, b.w / 2, b.h / 2, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#5c6675";
      ctx.beginPath();
      ctx.ellipse(b.x + b.w / 2, this.baseY - 4, b.w / 2.6, b.h / 3, 0, 0, Math.PI * 2);
      ctx.fill();
    } else if (this.kind === "lowbar") {
      // 낮은 통과형(E3.5-11): 화면 상단까지 이어진 비계/파이프 골조 —
      // "밑으로 지나가야 함"이 읽히도록. 하단 위험 줄무늬 바가 통과 지점 강조.
      // AI 에셋: 세로 게이트(위 잘림) — 하단을 통과 지점에 맞추고 상단 슬라이스를
      // 화면 꼭대기까지 반복해 기둥 연장(E3.5-11 유지). 미로드 시 기존 벡터 골조.
      const gateImg = sprite("lowbar");
      if (gateImg) {
        const dw = 68; // 히트박스(48)보다 살짝 넓은 시각 폭
        const dx = b.x + b.w / 2 - dw / 2;
        const dh = dw * (gateImg.height / gateImg.width);
        const bottom = b.y + b.h; // 통과 gap 상단
        ctx.drawImage(gateImg, dx, bottom - dh, dw, dh);
        // 상단 연장: 이미지 위쪽 슬라이스(잘린 단면)를 y=0까지 타일
        const srcSliceH = Math.round(gateImg.height * 0.2);
        const dSliceH = dh * 0.2;
        for (let ty = bottom - dh; ty > 0; ty -= dSliceH) {
          ctx.drawImage(gateImg, 0, 0, gateImg.width, srcSliceH, dx, ty - dSliceH, dw, dSliceH);
        }
        return;
      }
      const barH = 60;
      const barY = b.y + b.h - barH; // 바 본체(하단)
      ctx.save();
      // 측면 지지 기둥(화면 꼭대기까지)
      const postImg = sprite("post");
      if (postImg) {
        ctx.drawImage(postImg, b.x - 1, b.y, 9, b.h);
        ctx.drawImage(postImg, b.x + b.w - 8, b.y, 9, b.h);
      } else {
        ctx.fillStyle = "#5b6472";
        ctx.fillRect(b.x + 1, b.y, 5, b.h);
        ctx.fillRect(b.x + b.w - 6, b.y, 5, b.h);
      }
      // 수평 파이프(골조가 위로 이어짐을 강조)
      ctx.fillStyle = "#6b7688";
      for (let py = b.y + 18; py < barY - 10; py += 46) {
        ctx.fillRect(b.x - 4, py, b.w + 8, 7);
      }
      // 비계 네팅(반투명 격자)
      ctx.globalAlpha = 0.45;
      ctx.strokeStyle = "#8894a6";
      ctx.lineWidth = 1.5;
      for (let yy = b.y + 4; yy < barY; yy += 12) {
        ctx.beginPath();
        ctx.moveTo(b.x + 4, yy);
        ctx.lineTo(b.x + b.w - 4, yy);
        ctx.stroke();
      }
      for (let xx = b.x + 6; xx < b.x + b.w - 4; xx += 12) {
        ctx.beginPath();
        ctx.moveTo(xx, b.y);
        ctx.lineTo(xx, barY);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
      // 하단 위험 줄무늬 바 — 스프라이트 우선(WP4)
      const hazImg = sprite("hazard");
      if (hazImg) {
        ctx.drawImage(hazImg, b.x - 2, barY, b.w + 4, barH);
      } else {
        ctx.fillStyle = "#ffb800";
        roundRect(ctx, b.x, barY, b.w, barH, 4);
        ctx.fill();
        ctx.beginPath();
        roundRect(ctx, b.x, barY, b.w, barH, 4);
        ctx.clip();
        ctx.strokeStyle = "#1f2a44";
        ctx.lineWidth = 6;
        for (let s = -barH; s < b.w; s += 14) {
          ctx.beginPath();
          ctx.moveTo(b.x + s, barY + barH);
          ctx.lineTo(b.x + s + barH, barY);
          ctx.stroke();
        }
      }
      ctx.restore();
    } else if (this.kind === "airbar") {
      // 공중 장애물(E3.7-7): "크레인에 매달린 자재" — 로프·후크를 화면 상단까지 렌더해
      // 허공에 뜬 물체가 아니라 매달린 물체로 읽히게. 히트박스(b)는 불변.
      const bobA = Math.sin((_now ?? 0) / 260 + this.x / 90) * 2;
      const sway = Math.sin((_now ?? 0) / 700 + this.x / 200) * 3; // 로프 흔들림
      const cx = b.x + b.w / 2;
      const topY = b.y + bobA;
      ctx.save();
      // 로프: 화면 상단(크레인 방향) → 자재 상단. 미세 사선 스웨이.
      ctx.strokeStyle = "#4a5163";
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(cx + sway, 0);
      ctx.lineTo(cx, topY - 8);
      ctx.stroke();
      // 후크
      ctx.fillStyle = "#8894a6";
      ctx.beginPath();
      ctx.arc(cx, topY - 6, 5, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = "#5b6472";
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.arc(cx, topY - 1, 5, Math.PI * 1.1, Math.PI * 0.4);
      ctx.stroke();
      // 매달린 자재: 파이프 묶음(가로로 눕혀 히트박스 폭에 맞춤), 미로드 시 hazard/벡터
      const pipesImg = sprite("fall_pipes");
      if (pipesImg) {
        const dw = b.w + 6;
        const dh = dw * (pipesImg.width / pipesImg.height); // 90° 회전 → 종횡 교환
        ctx.translate(cx, topY + b.h / 2);
        ctx.rotate(Math.PI / 2);
        ctx.drawImage(pipesImg, -dh / 2, -dw / 2, dh, dw);
        ctx.restore();
        return;
      }
      ctx.restore();
      const hazAir = sprite("hazard");
      if (hazAir) {
        ctx.drawImage(hazAir, b.x, b.y + bobA, b.w, b.h);
      } else {
        ctx.fillStyle = "#ffb800";
        roundRect(ctx, b.x, b.y + bobA, b.w, b.h, 4);
        ctx.fill();
        ctx.strokeStyle = "#1f2a44";
        ctx.lineWidth = 4;
        for (let s = -b.h; s < b.w; s += 12) {
          ctx.beginPath();
          ctx.moveTo(b.x + s, b.y + bobA + b.h);
          ctx.lineTo(b.x + s + b.h, b.y + bobA);
          ctx.stroke();
        }
      }
    } else {
      // 자재 더미 — AI 에셋(벽돌·시멘트 팔레트), 미로드 시 벡터
      const stackImg = sprite("stack");
      if (stackImg) {
        // 발밑 그림자
        ctx.save();
        ctx.fillStyle = "rgba(31,42,68,0.3)";
        ctx.beginPath();
        ctx.ellipse(b.x + b.w / 2, this.baseY - 1, b.w * 0.62, 7, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
        // 히트박스 높이에 맞추고 폭은 비율 유지(시각이 살짝 넓음 — 관대 방향)
        const dh = b.h + 6;
        const dw = dh * (stackImg.width / stackImg.height);
        ctx.drawImage(stackImg, b.x + b.w / 2 - dw / 2, this.baseY - dh, dw, dh);
        return;
      }
      ctx.fillStyle = "#c0703c";
      roundRect(ctx, b.x, b.y, b.w, b.h, 4);
      ctx.fill();
      ctx.strokeStyle = "#8a4f27";
      ctx.lineWidth = 2;
      for (let i = 1; i < 4; i++) {
        ctx.beginPath();
        ctx.moveTo(b.x, b.y + (b.h / 4) * i);
        ctx.lineTo(b.x + b.w, b.y + (b.h / 4) * i);
        ctx.stroke();
      }
    }
  }
}

// ── 안전모 코인 ──
export class Coin implements Entity {
  x: number;
  y: number;
  dead = false;
  collected = false;
  r = 14;

  constructor(y: number) {
    this.x = VIEW.W + 30;
    this.y = y;
  }

  get box(): Box {
    return { x: this.x - this.r, y: this.y - this.r, w: this.r * 2, h: this.r * 2 };
  }

  update(dt: number, worldSpeed: number, _now?: number) {
    this.x -= worldSpeed * dt;
    if (this.x + this.r < -20) this.dead = true;
  }

  draw(ctx: CanvasRenderingContext2D, now: number) {
    const bob = Math.sin(now / 200 + this.x / 40) * 3;
    ctx.save();
    ctx.translate(this.x, this.y + bob);
    // WP4: 코인 스프라이트(안전모 코인 커스텀 확보 전 임시), 미로드 시 벡터
    const img = sprite("coin");
    if (img) {
      const s = this.r * 2.3;
      ctx.drawImage(img, -s / 2, -s / 2, s, s);
      ctx.restore();
      return;
    }
    ctx.fillStyle = "#ffb800";
    ctx.beginPath();
    ctx.arc(0, 0, this.r, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "#e09b00";
    ctx.lineWidth = 2;
    ctx.stroke();
    // 안전모 심볼
    ctx.fillStyle = "#fff";
    ctx.beginPath();
    ctx.arc(0, 1, this.r * 0.5, Math.PI, 0);
    ctx.fill();
    ctx.fillRect(-this.r * 0.6, 0, this.r * 1.2, 3);
    ctx.restore();
  }
}

// ── 박소장 투척물: 경고 '!' 선행 → 박소장 손 앞에서 발사(뒤→앞, E3.5) ──
export class Projectile implements Entity {
  kind: ProjectileKind;
  dead = false;
  spawnedAt: number;
  launched = false;
  x: number;
  y: number;
  vx = PROJECTILE.SPEED; // 왼쪽(박소장) → 오른쪽(전방)으로 추월 비행
  rot = 0;
  warnY: number; // 경고 마크·비행 높이
  high: boolean; // 상단 투척(슬라이드로 회피) 여부
  originX: number; // 발사 원점(박소장 손 앞)
  warnMs: number; // 경고 노출 시간 — REACT_MS에서 비행 시간을 역산(E3.5-10)

  constructor(
    kind: ProjectileKind,
    targetY: number,
    now: number,
    high = false,
    originX = 90
  ) {
    this.kind = kind;
    this.y = targetY;
    this.warnY = targetY;
    this.spawnedAt = now;
    this.high = high;
    this.originX = originX;
    this.x = originX;
    // 경고 시작 → 명중 최소 REACT_MS 보장: warn + flight >= REACT_MS
    const flightMs =
      (Math.max(60, PLAYER.X + PLAYER.W / 2 - originX) / PROJECTILE.SPEED) * 1000;
    this.warnMs = Math.min(
      PROJECTILE.WARNING_MS,
      Math.max(PROJECTILE.MIN_WARN_MS, PROJECTILE.REACT_MS - flightMs)
    );
  }

  get warning(): boolean {
    return !this.launched;
  }

  get box(): Box {
    // 경고 단계에는 충돌 없음(화면 밖 취급)
    if (!this.launched) return { x: VIEW.W + 999, y: 0, w: 0, h: 0 };
    return { x: this.x - 18, y: this.y - 18, w: 36, h: 36 };
  }

  update(dt: number, worldSpeed: number, now: number) {
    if (!this.launched) {
      if (now - this.spawnedAt >= this.warnMs) {
        this.launched = true;
        this.x = this.originX;
      }
      return;
    }
    this.x += this.vx * dt; // 화면 기준 전방 비행(플레이어 추월)
    this.rot += dt * 9;
    if (this.x > VIEW.W + 60) this.dead = true;
    // E3.7-9: 소멸 안전망 — 어떤 경로로든 발사 후 6초를 넘긴 투척물은 강제 소멸
    if (now - this.spawnedAt > this.warnMs + 6000) this.dead = true;
  }

  draw(ctx: CanvasRenderingContext2D, now: number) {
    if (!this.launched) {
      // 경고 텔레그래프(E3.5): 박소장 앞·비행 높이에 큰 '!' — 등장 펄스 + 가속 깜빡임
      const progress = Math.min(1, (now - this.spawnedAt) / this.warnMs);
      const period = 260 - progress * 160; // 260ms → 100ms 로 가속
      const blink = Math.floor(now / period) % 2 === 0;
      const wx = this.originX + 46; // 박소장 손 앞
      // 등장 0.3초 팝(1.5→1) + 이후 은은한 펄스
      const appear = Math.min(1, (now - this.spawnedAt) / 300);
      const pulse = 1 + Math.sin(now / 130) * 0.08;
      const sc = (1.5 - 0.5 * appear) * pulse;

      ctx.save();
      ctx.translate(wx, this.warnY);
      ctx.scale(sc, sc);
      ctx.globalAlpha = blink ? 1 : 0.45;
      ctx.fillStyle = "#ff3b30";
      ctx.beginPath();
      ctx.moveTo(0, -24);
      ctx.lineTo(22, 17);
      ctx.lineTo(-22, 17);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = "#fff";
      ctx.lineWidth = 3;
      ctx.stroke();
      ctx.fillStyle = "#fff";
      ctx.font = "bold 26px sans-serif";
      ctx.textAlign = "center";
      ctx.fillText("!", 0, 12);
      // E3.5-10: 상단/하단 위치 표시 — 상단 투척=▼(숙여!), 하단 투척=▲(뛰어!)
      ctx.fillStyle = "#ffd23f";
      ctx.font = "bold 17px sans-serif";
      ctx.fillText(this.high ? "▼" : "▲", 0, this.high ? 38 : -32);
      ctx.restore();
      return;
    }

    ctx.save();
    // E3.7-9: 플레이어를 지나친 투척물은 페이드 아웃(통과 후 잔존감 제거)
    const passed = this.x - (PLAYER.X + PLAYER.W + 40);
    if (passed > 0) ctx.globalAlpha = Math.max(0.15, 1 - passed / 260);
    ctx.translate(this.x, this.y);
    ctx.rotate(this.rot);
    // AI 에셋 투척물(자체 외곽선 포함) — 미로드 시 기존 벡터
    const projImg = sprite(this.kind);
    if (projImg) {
      // 기존 벡터 풋프린트 유지: papers 44w / tube 36h / megaphone 30w
      const dw = this.kind === "papers" ? 44 : this.kind === "tube" ? 36 * (projImg.width / projImg.height) : 30;
      const dh = dw * (projImg.height / projImg.width);
      ctx.drawImage(projImg, -dw / 2, -dh / 2, dw, dh);
      ctx.restore();
      return;
    }
    if (this.kind === "papers") {
      // E3.5: 크게 + 진한 외곽선(하늘 배경 가시성)
      ctx.fillStyle = "#fdfdfd";
      ctx.fillRect(-20, -14, 40, 28);
      ctx.strokeStyle = "#1f2a44";
      ctx.lineWidth = 2.5;
      ctx.strokeRect(-20, -14, 40, 28);
      ctx.fillStyle = "#8a94a8";
      for (let i = -8; i <= 8; i += 5) ctx.fillRect(-14, i, 28, 2);
    } else if (this.kind === "tube") {
      // 도면 통
      ctx.fillStyle = "#3b7dd8";
      roundRect(ctx, -8, -18, 16, 36, 5);
      ctx.fill();
      ctx.fillStyle = "#2a5da8";
      ctx.fillRect(-8, -18, 16, 5);
      ctx.fillRect(-8, 13, 16, 5);
    } else {
      // 확성기
      ctx.fillStyle = "#e63946";
      ctx.beginPath();
      ctx.moveTo(-14, -12);
      ctx.lineTo(4, -6);
      ctx.lineTo(4, 6);
      ctx.lineTo(-14, 12);
      ctx.closePath();
      ctx.fill();
      ctx.fillRect(4, -5, 10, 10);
    }
    ctx.restore();
  }
}

// ── 특수 아이템: 다방커피(감속) / 퇴근길 부스터(무적) ──
export class Item implements Entity {
  kind: ItemKind;
  x = VIEW.W + 30;
  y: number;
  dead = false;
  collected = false;
  r = 16;

  constructor(kind: ItemKind, y: number) {
    this.kind = kind;
    this.y = y;
  }

  get box(): Box {
    return { x: this.x - this.r, y: this.y - this.r, w: this.r * 2, h: this.r * 2 };
  }

  update(dt: number, worldSpeed: number, _now?: number) {
    this.x -= worldSpeed * dt;
    if (this.x + this.r < -20) this.dead = true;
  }

  draw(ctx: CanvasRenderingContext2D, now: number) {
    const bob = Math.sin(now / 180 + this.x / 30) * 3;
    ctx.save();
    ctx.translate(this.x, this.y + bob);
    // 후광
    const HALO: Record<string, string> = {
      booster: "#ffd23f",
      coffee: "#7b5230",
      heart: "#ff6b8a",
      magnet: "#5ec8ff",
    };
    ctx.globalAlpha = 0.4;
    ctx.fillStyle = HALO[this.kind] ?? "#ffd23f";
    ctx.beginPath();
    ctx.arc(0, 0, this.r + 6, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;

    if (this.kind === "coffee") {
      // 종이컵 커피 (창작 디자인 — 커스텀 에셋 확보 전까지 벡터 유지)
      ctx.fillStyle = "#fff";
      ctx.beginPath();
      ctx.moveTo(-11, -12);
      ctx.lineTo(11, -12);
      ctx.lineTo(8, 14);
      ctx.lineTo(-8, 14);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = "#6f4a2f";
      ctx.fillRect(-11, -12, 22, 5);
    } else if (this.kind === "heart") {
      // 하트(HP 회복) — 코인 스타일 원형 배지로 톤 통일(E3.5)
      ctx.fillStyle = "#fff";
      ctx.beginPath();
      ctx.arc(0, 0, this.r + 1, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = "#e05a72";
      ctx.lineWidth = 3;
      ctx.stroke();
      ctx.fillStyle = "#ff4d6d";
      ctx.beginPath();
      ctx.moveTo(0, 9);
      ctx.bezierCurveTo(-12, 0, -9, -11, 0, -4);
      ctx.bezierCurveTo(9, -11, 12, 0, 0, 9);
      ctx.fill();
    } else if (this.kind === "magnet") {
      // 자석(코인 흡인)
      ctx.strokeStyle = "#e63946";
      ctx.lineWidth = 8;
      ctx.beginPath();
      ctx.arc(0, 2, 10, Math.PI, 0);
      ctx.stroke();
      ctx.fillStyle = "#e63946";
      ctx.fillRect(-14, 2, 8, 10);
      ctx.fillRect(6, 2, 8, 10);
      ctx.fillStyle = "#f2f2f2";
      ctx.fillRect(-14, 8, 8, 5);
      ctx.fillRect(6, 8, 8, 5);
    } else {
      // 부스터 — 별 스프라이트(WP4), 미로드 시 벡터
      const img = sprite("booster");
      if (img) {
        const s = this.r * 2.6;
        ctx.drawImage(img, -s / 2, -s / 2, s, s);
      } else {
        ctx.fillStyle = "#ff9500";
        drawStar(ctx, 0, 0, 5, this.r, this.r * 0.5);
        ctx.fill();
      }
    }
    ctx.restore();
  }
}

// ── 낙하물(노선 obs_fall): 접근 시 경고 후 위에서 낙하 ──
export class FallingObject implements Entity {
  x = VIEW.W + 40;
  y = -60;
  dead = false;
  baseY: number;
  armed = false; // 낙하 시작됨
  vy = 0;
  private landedAt = 0;

  constructor(baseY: number = GROUND_Y) {
    this.baseY = baseY;
  }

  get box(): Box {
    // 낙하 중·착지 직후에만 충돌
    if (!this.armed || this.dead) return { x: VIEW.W + 999, y: 0, w: 0, h: 0 };
    return { x: this.x - 18, y: this.y - 18, w: 36, h: 36 };
  }

  update(dt: number, worldSpeed: number, now: number) {
    this.x -= worldSpeed * dt;
    // 플레이어 진입 타이밍에 낙하 시작(선행 경고는 draw에서)
    if (!this.armed && this.x < PLAYER.X + 300) this.armed = true;
    if (this.armed) {
      this.vy += 2600 * dt;
      this.y += this.vy * dt;
      const floor = this.baseY - 15;
      if (this.y >= floor) {
        this.y = floor;
        if (!this.landedAt) this.landedAt = now;
        if (now - this.landedAt > 350) this.dead = true;
      }
    }
    if (this.x < -40) this.dead = true;
  }

  draw(ctx: CanvasRenderingContext2D, now: number) {
    const blink = Math.floor(now / 140) % 2 === 0;
    const landed = this.y >= this.baseY - 20;

    // 착지 지점 마커: 낙하 완료 전까지 바닥에 경고 타원(어디로 떨어질지 명확)
    if (!landed) {
      ctx.save();
      ctx.globalAlpha = blink ? 0.75 : 0.35;
      ctx.strokeStyle = "#ff3b30";
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.ellipse(this.x, this.baseY - 3, 26, 8, 0, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([5, 5]);
      ctx.strokeStyle = "rgba(255,59,48,0.45)";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(this.x, Math.max(this.y + 20, 40));
      ctx.lineTo(this.x, this.baseY - 12);
      ctx.stroke();
      ctx.restore();
    }

    // 낙하 전: 상공 경고 '!' 깜빡임
    if (!this.armed || this.y < 0) {
      ctx.save();
      ctx.globalAlpha = blink ? 0.95 : 0.4;
      ctx.fillStyle = "#ff3b30";
      ctx.beginPath();
      ctx.moveTo(this.x, 12);
      ctx.lineTo(this.x + 13, 36);
      ctx.lineTo(this.x - 13, 36);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = "#fff";
      ctx.font = "bold 16px sans-serif";
      ctx.textAlign = "center";
      ctx.fillText("!", this.x, 33);
      ctx.restore();
      if (!this.armed) return;
    }

    // 낙하 모션 트레일(잔상)
    if (this.armed && !landed && this.vy > 200) {
      ctx.save();
      for (let i = 1; i <= 3; i++) {
        ctx.globalAlpha = 0.16 * (4 - i);
        ctx.fillStyle = "#aab2c2";
        ctx.beginPath();
        ctx.ellipse(this.x, this.y - i * 22, 12 - i * 2, 16, 0, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }

    // 낙하체(파이프 묶음) — AI 에셋(자체 외곽선), 미로드 시 벡터
    ctx.save();
    ctx.translate(this.x, this.y);
    ctx.rotate(this.armed && !landed ? now / 260 : 0);
    const img = sprite("fall_pipes");
    if (img) {
      const dh = 54;
      const dw = dh * (img.width / img.height);
      ctx.drawImage(img, -dw / 2, -dh / 2, dw, dh);
    } else {
      ctx.fillStyle = "#8a8f9c";
      ctx.fillRect(-15, -22, 30, 44);
      ctx.strokeStyle = "#1f2a44";
      ctx.lineWidth = 3;
      ctx.strokeRect(-15, -22, 30, 44);
    }
    ctx.restore();

    // 착지 먼지
    if (landed) {
      ctx.save();
      ctx.fillStyle = "rgba(200,180,150,0.5)";
      for (let i = 0; i < 3; i++) {
        ctx.beginPath();
        ctx.arc(this.x - 18 + i * 18, this.baseY - 5, 4 + i, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }
  }
}

function drawStar(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  spikes: number,
  outer: number,
  inner: number
) {
  let rot = (Math.PI / 2) * 3;
  const step = Math.PI / spikes;
  ctx.beginPath();
  ctx.moveTo(cx, cy - outer);
  for (let i = 0; i < spikes; i++) {
    ctx.lineTo(cx + Math.cos(rot) * outer, cy + Math.sin(rot) * outer);
    rot += step;
    ctx.lineTo(cx + Math.cos(rot) * inner, cy + Math.sin(rot) * inner);
    rot += step;
  }
  ctx.lineTo(cx, cy - outer);
  ctx.closePath();
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number
) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}
