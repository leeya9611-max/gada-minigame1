import { GROUND_Y, PHYSICS, PLAYER, SLIDE } from "./config";
import { sprite } from "./sprites";
import type { Box } from "./types";

// 김반장 캐릭터. 원터치 1단/2단 점프 + 슬라이드 물리·상태 관리.
export class Player {
  x = PLAYER.X;
  y = GROUND_Y - PLAYER.H;
  vy = 0;
  jumps = 0; // 현재 공중 점프 사용 횟수 (0=지면)
  hp: number = PLAYER.MAX_HP;
  invulnUntil = 0; // 이 시각(ms)까지 무적
  runFrame = 0; // 달리기 애니메이션 프레임 누적
  sliding = false; // 슬라이드(숙이기) 중
  slideUntil = 0; // 자동 기립 시각(ms)

  get onGround(): boolean {
    return this.y >= GROUND_Y - PLAYER.H - 0.5;
  }

  private get slideH(): number {
    return PLAYER.H * SLIDE.HITBOX_SCALE;
  }

  // 슬라이드 중에는 히트박스를 낮춤(발은 지면, 상단을 내림)
  get box(): Box {
    if (this.sliding) {
      const h = this.slideH;
      return { x: this.x, y: GROUND_Y - h, w: PLAYER.W, h };
    }
    return { x: this.x, y: this.y, w: PLAYER.W, h: PLAYER.H };
  }

  reset() {
    this.y = GROUND_Y - PLAYER.H;
    this.vy = 0;
    this.jumps = 0;
    this.hp = PLAYER.MAX_HP;
    this.invulnUntil = 0;
    this.runFrame = 0;
    this.sliding = false;
    this.slideUntil = 0;
  }

  // 원터치 입력: 지면이면 1단, 공중이면 2단 점프 (최대 2단). 점프는 슬라이드를 취소.
  jump() {
    this.sliding = false;
    if (this.onGround) {
      this.vy = -PHYSICS.JUMP_V;
      this.jumps = 1;
    } else if (this.jumps < 2) {
      this.vy = -PHYSICS.DOUBLE_JUMP_V;
      this.jumps = 2;
    }
  }

  // 아래 입력: 지면이면 슬라이드, 공중이면 빠른 하강
  slide(now: number) {
    if (this.onGround) {
      this.sliding = true;
      this.slideUntil = now + SLIDE.DURATION_MS;
    } else {
      this.vy = PHYSICS.MAX_FALL; // 공중 급강하
    }
  }

  endSlide() {
    this.sliding = false;
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

  // 다방커피 회복. 이미 최대면 false (호출부가 대체 지급 처리).
  heal(amount = 1): boolean {
    if (this.hp >= PLAYER.MAX_HP) return false;
    this.hp = Math.min(PLAYER.MAX_HP, this.hp + amount);
    return true;
  }

  update(dt: number, speedScale: number, now: number) {
    this.vy += PHYSICS.GRAVITY * dt;
    if (this.vy > PHYSICS.MAX_FALL) this.vy = PHYSICS.MAX_FALL;
    this.y += this.vy * dt;

    const floor = GROUND_Y - PLAYER.H;
    if (this.y >= floor) {
      this.y = floor;
      this.vy = 0;
      this.jumps = 0;
    }
    // 슬라이드: 최대 지속 후 자동 기립. 공중이면 슬라이드 해제.
    if (this.sliding && (now > this.slideUntil || !this.onGround)) {
      this.sliding = false;
    }
    if (this.onGround) {
      this.runFrame += dt * 12 * speedScale;
    }
  }

  // 상태 → 스프라이트 프레임 (런 6프레임 사이클, jump/fall/slide/hurt)
  private currentSprite(now: number): HTMLImageElement | null {
    if (this.isInvuln(now)) return sprite("gb_hurt");
    if (this.sliding) return sprite("gb_slide");
    if (!this.onGround) return sprite(this.vy < 0 ? "gb_jump" : "gb_fall");
    const RUN = ["gb_run1", "gb_run2", "gb_run3", "gb_run4", "gb_run5", "gb_run6"] as const;
    return sprite(RUN[Math.floor(this.runFrame) % RUN.length]);
  }

  draw(ctx: CanvasRenderingContext2D, now: number) {
    const blink = this.isInvuln(now) && Math.floor(now / 100) % 2 === 0;
    ctx.save();
    ctx.globalAlpha = blink ? 0.35 : 1;

    // WP4: 스프라이트 렌더(히트박스는 유지, 그림만 얹음). 미로드 시 벡터 폴백.
    const img = this.currentSprite(now);
    if (img) {
      // 발끝을 지면에 정렬, 히트박스보다 약간 크게(시각 보정).
      // 슬라이드는 와이드 포즈라 낮은 히트박스 높이에 맞춰 별도 스케일.
      const dh = this.sliding ? this.slideH * 1.55 : PLAYER.H * 1.12;
      const dw = dh * (img.width / img.height);
      const cx = this.x + PLAYER.W / 2 + (this.sliding ? 12 : 0);
      const bottom = this.sliding ? GROUND_Y : this.y + PLAYER.H;
      if (this.sliding) {
        // 슬라이드 흙먼지
        ctx.fillStyle = "rgba(200,180,150,0.55)";
        for (let i = 0; i < 3; i++) {
          const px = this.x - 6 - i * 7 + Math.sin(now / 60 + i) * 2;
          ctx.beginPath();
          ctx.arc(px, GROUND_Y - 3, 3 + i, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      ctx.drawImage(img, cx - dw / 2, bottom - dh, dw, dh);
      ctx.restore();
      return;
    }

    if (this.sliding) {
      this.drawSliding(ctx, now);
      ctx.restore();
      return;
    }

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

  // 슬라이드(숙이기) 포즈: 히트박스(발은 지면, 상단 내림)에 맞춘 낮은 자세
  private drawSliding(ctx: CanvasRenderingContext2D, now: number) {
    const w = PLAYER.W;
    const sh = this.slideH;
    const topY = GROUND_Y - sh;
    const x = this.x;

    // 흙먼지
    ctx.fillStyle = "rgba(200,180,150,0.55)";
    for (let i = 0; i < 3; i++) {
      const px = x - 6 - i * 7 + Math.sin(now / 60 + i) * 2;
      ctx.beginPath();
      ctx.arc(px, GROUND_Y - 3, 3 + i, 0, Math.PI * 2);
      ctx.fill();
    }

    // 뻗은 다리
    ctx.strokeStyle = "#2b3550";
    ctx.lineWidth = 6;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(x + 6, topY + sh - 4);
    ctx.lineTo(x - 8, GROUND_Y - 2);
    ctx.stroke();

    // 몸통(앞으로 기운 낮은 조끼)
    ctx.fillStyle = "#2E66F6";
    roundRect(ctx, x - 6, topY + 4, w + 12, sh - 4, 6);
    ctx.fill();
    ctx.fillStyle = "#ffd23f";
    ctx.fillRect(x - 6, topY + 10, w + 12, 4);

    // 얼굴(전방)
    ctx.fillStyle = "#ffdcb1";
    roundRect(ctx, x + w - 8, topY + 2, 18, 14, 5);
    ctx.fill();

    // 안전모
    ctx.fillStyle = "#ffb800";
    ctx.beginPath();
    ctx.arc(x + w + 1, topY + 4, 11, Math.PI, 0);
    ctx.fill();
    ctx.fillRect(x + w - 10, topY + 3, 22, 4);
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
