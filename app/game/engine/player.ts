import { GROUND_Y, PHYSICS, PLAYER } from "./config";
import type { Box } from "./types";

// 김반장 캐릭터. 원터치 1단/2단 점프 물리와 상태 관리.
export class Player {
  x = PLAYER.X;
  y = GROUND_Y - PLAYER.H;
  vy = 0;
  jumps = 0; // 현재 공중 점프 사용 횟수 (0=지면)
  hp = PLAYER.MAX_HP;
  invulnUntil = 0; // 이 시각(ms)까지 무적
  runFrame = 0; // 달리기 애니메이션 프레임 누적

  get onGround(): boolean {
    return this.y >= GROUND_Y - PLAYER.H - 0.5;
  }

  get box(): Box {
    return { x: this.x, y: this.y, w: PLAYER.W, h: PLAYER.H };
  }

  reset() {
    this.y = GROUND_Y - PLAYER.H;
    this.vy = 0;
    this.jumps = 0;
    this.hp = PLAYER.MAX_HP;
    this.invulnUntil = 0;
    this.runFrame = 0;
  }

  // 원터치 입력: 지면이면 1단, 공중이면 2단 점프 (최대 2단)
  jump() {
    if (this.onGround) {
      this.vy = -PHYSICS.JUMP_V;
      this.jumps = 1;
    } else if (this.jumps < 2) {
      this.vy = -PHYSICS.DOUBLE_JUMP_V;
      this.jumps = 2;
    }
  }

  isInvuln(now: number): boolean {
    return now < this.invulnUntil;
  }

  hit(now: number): boolean {
    if (this.isInvuln(now)) return false;
    this.hp -= 1;
    this.invulnUntil = now + PLAYER.HIT_INVULN_MS;
    return true;
  }

  update(dt: number, speedScale: number) {
    this.vy += PHYSICS.GRAVITY * dt;
    if (this.vy > PHYSICS.MAX_FALL) this.vy = PHYSICS.MAX_FALL;
    this.y += this.vy * dt;

    const floor = GROUND_Y - PLAYER.H;
    if (this.y >= floor) {
      this.y = floor;
      this.vy = 0;
      this.jumps = 0;
    }
    if (this.onGround) {
      this.runFrame += dt * 12 * speedScale;
    }
  }

  draw(ctx: CanvasRenderingContext2D, now: number) {
    const blink = this.isInvuln(now) && Math.floor(now / 100) % 2 === 0;
    ctx.save();
    ctx.globalAlpha = blink ? 0.35 : 1;

    const { x, y } = this;
    const w = PLAYER.W;
    const h = PLAYER.H;

    // 다리 (달리기 흔들림)
    const swing = Math.sin(this.runFrame) * 6;
    ctx.strokeStyle = "#2b3550";
    ctx.lineWidth = 6;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(x + w * 0.4, y + h - 8);
    ctx.lineTo(x + w * 0.4 - swing, y + h + 4);
    ctx.moveTo(x + w * 0.6, y + h - 8);
    ctx.lineTo(x + w * 0.6 + swing, y + h + 4);
    ctx.stroke();

    // 몸통 (작업 조끼 - 가다 블루)
    ctx.fillStyle = "#2E66F6";
    roundRect(ctx, x + 4, y + 20, w - 8, h - 24, 6);
    ctx.fill();

    // 안전 형광 밴드
    ctx.fillStyle = "#ffd23f";
    ctx.fillRect(x + 4, y + 30, w - 8, 5);

    // 얼굴
    ctx.fillStyle = "#ffdcb1";
    roundRect(ctx, x + 8, y + 6, w - 16, 18, 5);
    ctx.fill();

    // 안전모 (노란 헬멧)
    ctx.fillStyle = "#ffb800";
    ctx.beginPath();
    ctx.arc(x + w / 2, y + 8, w / 2 - 5, Math.PI, 0);
    ctx.fill();
    ctx.fillRect(x + 4, y + 7, w - 8, 4);

    ctx.restore();
  }
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
