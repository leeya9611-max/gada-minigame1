import { GROUND_Y, PHYSICS, PLAYER, SLIDE } from "./config";
import { clipFrame, drawChar } from "./sprites";
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
  floorY: number = GROUND_Y; // 현재 지면 y — 노선 지형(오르막/내리막) 반영, 엔진이 매 프레임 갱신
  sliding = false; // 슬라이드(숙이기) 중
  slideUntil = 0; // 자동 기립 시각(ms)
  jumpStartAt = 0; // 점프 클립(crouch→jump→apex) 재생 기준 시각
  landedAt = 0; // E3.6-3: 착지 순간(먼지 퍼프 연출)
  // E3.6-3: 부스터 트레일용 — 마지막으로 그린 포즈(엔진이 히스토리로 보관)
  lastPose: { file: string; footX: number; footY: number; hOverride?: number } | null = null;
  visualOffsetX = 0; // E3.6-2 보강: 봐주기 반동 등 시각 전용 x 오프셋(히트박스 불변)

  get onGround(): boolean {
    return this.y >= this.floorY - PLAYER.H - 0.5;
  }

  private get slideH(): number {
    return PLAYER.H * SLIDE.HITBOX_SCALE;
  }

  // 슬라이드 중에는 히트박스를 낮춤(발은 지면, 상단을 내림)
  get box(): Box {
    if (this.sliding) {
      const h = this.slideH;
      return { x: this.x, y: this.floorY - h, w: PLAYER.W, h };
    }
    return { x: this.x, y: this.y, w: PLAYER.W, h: PLAYER.H };
  }

  reset() {
    this.visualOffsetX = 0;
    this.floorY = GROUND_Y;
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
      this.jumpStartAt = performance.now();
    } else if (this.jumps < 2) {
      this.vy = -PHYSICS.DOUBLE_JUMP_V;
      this.jumps = 2;
      this.jumpStartAt = performance.now(); // 2단 점프도 클립 재시작
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

  // E3.10-2: 일시정지 시간만큼 절대 시각 필드 이동(재개 시 연속성)
  shiftClock(delta: number) {
    this.invulnUntil += delta;
    this.jumpStartAt += delta;
    this.slideUntil += delta;
    if (this.landedAt) this.landedAt += delta;
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
    // E3.6-1: 하강 시 중력 1.3배 — 상승 높이는 유지하고 체공만 줄임
    const g = PHYSICS.GRAVITY * (this.vy > 0 ? PHYSICS.FALL_GRAVITY_MULT : 1);
    this.vy += g * dt;
    if (this.vy > PHYSICS.MAX_FALL) this.vy = PHYSICS.MAX_FALL;
    this.y += this.vy * dt;

    const floor = this.floorY - PLAYER.H;
    if (this.y >= floor) {
      if (this.jumps > 0 || this.vy > 300) this.landedAt = now; // 착지 퍼프 트리거
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

  // 상태 → 매니페스트 클립 프레임 파일명
  private currentFrame(now: number): string | null {
    if (this.isInvuln(now)) return "hurt.webp";
    if (this.sliding) return "slide.webp";
    if (!this.onGround) {
      if (this.vy < 0) {
        // 점프 클립(crouch→jump→apex, 14fps, once)
        return clipFrame("gimbanjang", "jump", now - this.jumpStartAt);
      }
      return clipFrame("gimbanjang", "fall", 0);
    }
    // 런 클립: runFrame(속도 스케일 반영 누적)을 프레임 인덱스로
    const clip = clipFrame("gimbanjang", "run", (this.runFrame / 12) * 1000);
    return clip;
  }

  draw(ctx: CanvasRenderingContext2D, now: number) {
    const blink = this.isInvuln(now) && Math.floor(now / 100) % 2 === 0;
    ctx.save();
    ctx.globalAlpha = blink ? 0.35 : 1;

    // 매니페스트 클립 렌더 — 실측 키 기준 통일 스케일, 발바닥 지면 정렬.
    const frame = this.currentFrame(now);
    if (frame) {
      const footX = this.x + this.visualOffsetX + PLAYER.W / 2;
      const footY = this.sliding ? this.floorY : this.y + PLAYER.H;

      // E3.6-3 주스: 착지 먼지 퍼프(300ms) + 달리는 동안 발밑 미세 먼지
      const sinceLand = now - this.landedAt;
      if (this.landedAt && sinceLand < 300) {
        const q = sinceLand / 300;
        ctx.save();
        ctx.globalAlpha = (1 - q) * 0.55;
        ctx.fillStyle = "rgba(210,190,160,1)";
        for (let i = 0; i < 3; i++) {
          const dir = i - 1; // -1, 0, 1
          ctx.beginPath();
          ctx.arc(footX - 6 + dir * (10 + q * 22), this.floorY - 4 - q * 6, 3 + q * 6, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.restore();
      }
      if (this.onGround && !this.sliding) {
        ctx.save();
        ctx.fillStyle = "rgba(200,180,150,0.28)";
        for (let i = 0; i < 2; i++) {
          const ph = ((now / 70 + i * 1.6) % 3) / 3; // 흘러가는 미세 먼지
          ctx.globalAlpha = (1 - ph) * 0.3;
          ctx.beginPath();
          ctx.arc(this.x - 4 - ph * 26, this.floorY - 3, 2 + ph * 2.5, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.restore();
      }
      if (this.sliding) {
        // 슬라이드 흙먼지 — 크고 연속적으로, 스피드라인까지(E3.5: "미끄러짐" 명시)
        ctx.save();
        ctx.fillStyle = "rgba(210,190,160,0.6)";
        for (let i = 0; i < 5; i++) {
          const px = this.x + 2 - i * 11 + Math.sin(now / 50 + i * 1.7) * 3;
          const py = this.floorY - 4 - (i % 2) * 5;
          ctx.beginPath();
          ctx.arc(px, py, 4 + i * 1.6, 0, Math.PI * 2);
          ctx.fill();
        }
        // 스피드 라인
        ctx.strokeStyle = "rgba(255,255,255,0.4)";
        ctx.lineWidth = 2.5;
        for (let i = 0; i < 3; i++) {
          const ly = this.floorY - 14 - i * 12;
          ctx.beginPath();
          ctx.moveTo(this.x - 26 - i * 6, ly);
          ctx.lineTo(this.x - 54 - i * 6, ly);
          ctx.stroke();
        }
        ctx.restore();
      }
      // 슬라이드는 와이드 포즈 → 낮은 히트박스에 맞춘 높이로
      const hOverride = this.sliding ? this.slideH * 1.35 : undefined;
      this.lastPose = { file: frame, footX, footY, hOverride }; // 부스터 트레일용
      const drawn = drawChar(ctx, "gimbanjang", frame, footX, footY, hOverride);
      if (drawn) {
        ctx.restore();
        return;
      }
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
    const topY = this.floorY - sh;
    const x = this.x;

    // 흙먼지
    ctx.fillStyle = "rgba(200,180,150,0.55)";
    for (let i = 0; i < 3; i++) {
      const px = x - 6 - i * 7 + Math.sin(now / 60 + i) * 2;
      ctx.beginPath();
      ctx.arc(px, this.floorY - 3, 3 + i, 0, Math.PI * 2);
      ctx.fill();
    }

    // 뻗은 다리
    ctx.strokeStyle = "#2b3550";
    ctx.lineWidth = 6;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(x + 6, topY + sh - 4);
    ctx.lineTo(x - 8, this.floorY - 2);
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
