import { GROUND_Y, PROJECTILE, VIEW } from "./config";
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
      // 낮은 통과형: 상단이 높게 막힌 배리어(점프로 못 넘음). 하단만 슬라이드 통과.
      this.w = 48;
      this.gap = 56; // 슬라이드(48) 통과, 서있는 키(96) 충돌
      this.h = baseY - this.gap - 30; // 상단을 화면 위(y≈30)까지
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
      // 시멘트 웅덩이 — 액체 타일 스프라이트(WP4), 미로드 시 벡터
      const img = sprite("cement");
      if (img) {
        ctx.save();
        ctx.beginPath();
        ctx.ellipse(b.x + b.w / 2, this.baseY - 3, b.w / 2, b.h / 2, 0, 0, Math.PI * 2);
        ctx.clip();
        ctx.drawImage(img, b.x - 4, this.baseY - b.h - 2, b.w + 8, b.h + 8);
        ctx.restore();
        // 외곽선 + 표면 리플로 배경과 분리(가독성)
        ctx.save();
        ctx.strokeStyle = "rgba(31,42,68,0.85)";
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.ellipse(b.x + b.w / 2, this.baseY - 3, b.w / 2, b.h / 2, 0, 0, Math.PI * 2);
        ctx.stroke();
        ctx.strokeStyle = "rgba(255,255,255,0.5)";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.ellipse(b.x + b.w / 2, this.baseY - 8, b.w / 3.2, b.h / 5, 0, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
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
      // 낮은 통과형: 상단은 비계 네팅(점프로 못 넘음), 하단 통과 공간은 열림.
      // 하단 위험 줄무늬 바가 "슬라이드로 지나가는 지점"을 강조.
      const barH = 60;
      const barY = b.y + b.h - barH; // 바 본체(하단)
      ctx.save();
      // 측면 지지 기둥
      const postImg = sprite("post");
      if (postImg) {
        ctx.drawImage(postImg, b.x - 1, b.y, 9, b.h);
        ctx.drawImage(postImg, b.x + b.w - 8, b.y, 9, b.h);
      } else {
        ctx.fillStyle = "#5b6472";
        ctx.fillRect(b.x + 1, b.y, 5, b.h);
        ctx.fillRect(b.x + b.w - 6, b.y, 5, b.h);
      }
      // 상단 비계 네팅(반투명 격자)
      ctx.globalAlpha = 0.5;
      ctx.strokeStyle = "#8894a6";
      ctx.lineWidth = 1.5;
      for (let yy = b.y; yy < barY; yy += 12) {
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
      // 공중 장애물 — 위험 줄무늬 바(hazard), 살짝 부유
      const bobA = Math.sin((_now ?? 0) / 260 + this.x / 90) * 2;
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
      // 자재 더미 — 크레이트 스프라이트 2단 적재(WP4), 미로드 시 벡터
      const crate = sprite("crate");
      if (crate) {
        // 발밑 그림자
        ctx.save();
        ctx.fillStyle = "rgba(31,42,68,0.3)";
        ctx.beginPath();
        ctx.ellipse(b.x + b.w / 2, this.baseY - 1, b.w * 0.62, 7, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
        const half = b.h / 2;
        ctx.drawImage(crate, b.x, b.y + half, b.w, half);
        ctx.drawImage(crate, b.x + 2, b.y, b.w - 4, half);
        // 외곽선으로 배경과 분리
        ctx.save();
        ctx.strokeStyle = "rgba(31,42,68,0.55)";
        ctx.lineWidth = 2.5;
        ctx.strokeRect(b.x + 1, b.y + 1, b.w - 2, b.h - 2);
        ctx.restore();
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
  high: boolean; // 상단 투척(슬라이드로 회피) 여부

  constructor(kind: ProjectileKind, targetY: number, now: number, high = false) {
    this.kind = kind;
    this.y = targetY;
    this.warnY = targetY;
    this.spawnedAt = now;
    this.high = high;
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
      // 경고 텔레그래프: 비행 높이(warnY)에 점선 가이드 + 깜빡이는 느낌표.
      // 발사가 가까워질수록 깜빡임이 빨라지고 진해진다.
      const progress = Math.min(
        1,
        (now - this.spawnedAt) / PROJECTILE.WARNING_MS
      );
      const period = 260 - progress * 160; // 260ms → 100ms 로 가속
      const blink = Math.floor(now / period) % 2 === 0;
      const wx = VIEW.W - 26;

      ctx.save();

      // 경고 삼각 느낌표 (비행 높이에 표시 — 점선 가이드는 디버그처럼 보여 제거)
      ctx.globalAlpha = blink ? 1 : 0.4;
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
      // 하트(HP 회복)
      ctx.fillStyle = "#ff4d6d";
      ctx.beginPath();
      ctx.moveTo(0, 12);
      ctx.bezierCurveTo(-16, 0, -12, -14, 0, -6);
      ctx.bezierCurveTo(12, -14, 16, 0, 0, 12);
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
    if (!this.armed && this.x < 168 + 300) this.armed = true;
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

    // 낙하체(자재 기둥) — 확대 + 외곽선으로 대비
    ctx.save();
    ctx.translate(this.x, this.y);
    ctx.rotate(this.armed && !landed ? now / 260 : 0);
    const img = sprite("post");
    if (img) {
      ctx.drawImage(img, -17, -25, 34, 50);
      ctx.strokeStyle = "rgba(31,42,68,0.7)";
      ctx.lineWidth = 2.5;
      ctx.strokeRect(-17, -25, 34, 50);
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
