import { GROUND_Y, PROJECTILE, VIEW } from "./config";
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

// ── 지상 장애물: 시멘트 웅덩이(낮음) / 자재 더미(높음) ──
export class Obstacle implements Entity {
  x: number;
  dead = false;
  kind: ObstacleKind;
  w: number;
  h: number;

  constructor(kind: ObstacleKind) {
    this.kind = kind;
    this.x = VIEW.W + 40;
    if (kind === "puddle") {
      this.w = 64;
      this.h = 26;
    } else {
      this.w = 40;
      this.h = 56;
    }
  }

  get box(): Box {
    return { x: this.x, y: GROUND_Y - this.h, w: this.w, h: this.h };
  }

  update(dt: number, worldSpeed: number, _now?: number) {
    this.x -= worldSpeed * dt;
    if (this.x + this.w < -20) this.dead = true;
  }

  draw(ctx: CanvasRenderingContext2D, _now?: number) {
    const b = this.box;
    if (this.kind === "puddle") {
      // 시멘트 웅덩이
      ctx.fillStyle = "#7a8699";
      ctx.beginPath();
      ctx.ellipse(b.x + b.w / 2, GROUND_Y - 2, b.w / 2, b.h / 2, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#5c6675";
      ctx.beginPath();
      ctx.ellipse(b.x + b.w / 2, GROUND_Y - 4, b.w / 2.6, b.h / 3, 0, 0, Math.PI * 2);
      ctx.fill();
    } else {
      // 자재 더미 (벽돌/블록)
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

// ── 박소장 투척물: 경고 마크 선행 표시 후 날아옴 ──
export class Projectile implements Entity {
  kind: ProjectileKind;
  dead = false;
  spawnedAt: number;
  launched = false;
  x = VIEW.W + 30;
  y: number;
  vx = -PROJECTILE.SPEED;
  rot = 0;
  warnY: number; // 경고 마크 표시 y (플레이어 높이 부근)

  constructor(kind: ProjectileKind, targetY: number, now: number) {
    this.kind = kind;
    this.y = targetY;
    this.warnY = targetY;
    this.spawnedAt = now;
  }

  get warning(): boolean {
    return !this.launched;
  }

  get box(): Box {
    // 경고 단계에는 충돌 없음(화면 밖 취급)
    if (!this.launched) return { x: VIEW.W + 999, y: 0, w: 0, h: 0 };
    return { x: this.x - 16, y: this.y - 16, w: 32, h: 32 };
  }

  update(dt: number, worldSpeed: number, now: number) {
    if (!this.launched) {
      if (now - this.spawnedAt >= PROJECTILE.WARNING_MS) this.launched = true;
      return;
    }
    this.x += (this.vx - worldSpeed * 0.15) * dt;
    this.rot += dt * 8;
    if (this.x < -40) this.dead = true;
  }

  draw(ctx: CanvasRenderingContext2D, now: number) {
    if (!this.launched) {
      // 경고 마크 (깜빡이는 삼각 느낌표) — 화면 우측 가장자리
      const blink = Math.floor(now / 150) % 2 === 0;
      ctx.save();
      ctx.globalAlpha = blink ? 1 : 0.35;
      const wx = VIEW.W - 26;
      ctx.fillStyle = "#ff3b30";
      ctx.beginPath();
      ctx.moveTo(wx, this.warnY - 16);
      ctx.lineTo(wx + 16, this.warnY + 12);
      ctx.lineTo(wx - 16, this.warnY + 12);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = "#fff";
      ctx.font = "bold 18px sans-serif";
      ctx.textAlign = "center";
      ctx.fillText("!", wx, this.warnY + 9);
      ctx.restore();
      return;
    }

    ctx.save();
    ctx.translate(this.x, this.y);
    ctx.rotate(this.rot);
    if (this.kind === "papers") {
      ctx.fillStyle = "#fdfdfd";
      ctx.fillRect(-14, -10, 28, 20);
      ctx.strokeStyle = "#c9ccd6";
      ctx.strokeRect(-14, -10, 28, 20);
      ctx.fillStyle = "#c9ccd6";
      for (let i = -6; i <= 6; i += 5) ctx.fillRect(-10, i, 20, 1.5);
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
    ctx.globalAlpha = 0.4;
    ctx.fillStyle = this.kind === "booster" ? "#ffd23f" : "#7b5230";
    ctx.beginPath();
    ctx.arc(0, 0, this.r + 6, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;

    if (this.kind === "coffee") {
      // 종이컵 커피
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
    } else {
      // 부스터 (별/번개)
      ctx.fillStyle = "#ff9500";
      drawStar(ctx, 0, 0, 5, this.r, this.r * 0.5);
      ctx.fill();
    }
    ctx.restore();
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
