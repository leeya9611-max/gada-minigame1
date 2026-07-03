import {
  DIALOGUE,
  GROUND_Y,
  ITEM_EFFECT,
  PLAYER,
  SPAWN,
  SPEED,
  VIEW,
} from "./config";
import { intersects, intersectsPadded } from "./collision";
import { Coin, Item, Obstacle, Projectile } from "./obstacle";
import { Player } from "./player";
import { ScoreKeeper } from "./score";
import type {
  GamePhase,
  GameResult,
  HudState,
  ItemKind,
  ObstacleKind,
  ProjectileKind,
} from "./types";

function rand(min: number, max: number) {
  return min + Math.random() * (max - min);
}
function pick<T>(arr: readonly T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

interface EngineCallbacks {
  onHud: (s: HudState) => void;
  onGameOver: (r: GameResult) => void;
}

export class GameEngine {
  private ctx: CanvasRenderingContext2D;
  private cb: EngineCallbacks;
  private raf = 0;
  private lastTs = 0;
  private running = false;

  private phase: GamePhase = "ready";
  private player = new Player();
  private score = new ScoreKeeper();

  private obstacles: Obstacle[] = [];
  private coins: Coin[] = [];
  private projectiles: Projectile[] = [];
  private items: Item[] = [];

  private worldSpeed: number = SPEED.BASE;
  private bgOffset = 0;
  private groundOffset = 0;
  private elapsed = 0; // 플레이 경과 초
  private startedAt = 0;

  // 스폰 타이머 (ms 남은 시간)
  private tObstacle = 0;
  private tCoin = 0;
  private tProjectile = 0;
  private tItem = 0;

  // 효과 만료 시각(ms, performance.now 기준)
  private boosterUntil = 0;
  private slowUntil = 0;

  private dialogue: string | null = null;
  private dialogueUntil = 0;

  private userId: string;

  constructor(
    ctx: CanvasRenderingContext2D,
    userId: string,
    cb: EngineCallbacks
  ) {
    this.ctx = ctx;
    this.userId = userId;
    this.cb = cb;
  }

  // ── 라이프사이클 ──
  start() {
    this.reset();
    this.phase = "ready";
    this.running = true;
    this.lastTs = performance.now();
    this.pushHud();
    this.loop(this.lastTs);
  }

  stop() {
    this.running = false;
    cancelAnimationFrame(this.raf);
  }

  private reset() {
    this.player.reset();
    this.score.reset();
    this.obstacles = [];
    this.coins = [];
    this.projectiles = [];
    this.items = [];
    this.worldSpeed = SPEED.BASE;
    this.elapsed = 0;
    this.tObstacle = 600;
    this.tCoin = 500;
    this.tProjectile = SPAWN.PROJECTILE_MIN_MS;
    this.tItem = SPAWN.ITEM_MIN_MS;
    this.boosterUntil = 0;
    this.slowUntil = 0;
    this.dialogue = null;
    this.dialogueUntil = 0;
  }

  // 원터치 입력
  onTap() {
    if (this.phase === "ready") {
      this.phase = "playing";
      this.startedAt = performance.now();
      this.pushHud();
      return;
    }
    if (this.phase === "playing") {
      this.player.jump();
    }
  }

  restart() {
    this.reset();
    this.phase = "playing";
    this.startedAt = performance.now();
    this.pushHud();
  }

  // ── 메인 루프 ──
  private loop = (ts: number) => {
    if (!this.running) return;
    const dt = Math.min(0.033, (ts - this.lastTs) / 1000);
    this.lastTs = ts;

    if (this.phase === "playing") this.update(dt, ts);
    this.render(ts);

    this.raf = requestAnimationFrame(this.loop);
  };

  private update(dt: number, now: number) {
    this.elapsed = (now - this.startedAt) / 1000;

    // 속도: 시간에 따라 가속, 감속 디버프 반영
    const slowed = now < this.slowUntil;
    const target = Math.min(SPEED.MAX, SPEED.BASE + this.elapsed * SPEED.ACCEL);
    this.worldSpeed = slowed ? target * SPEED.SLOW_FACTOR : target;

    const scale = this.worldSpeed / SPEED.BASE;
    this.bgOffset = (this.bgOffset + this.worldSpeed * 0.25 * dt) % VIEW.W;
    this.groundOffset = (this.groundOffset + this.worldSpeed * dt) % 40;

    this.player.update(dt, scale);
    this.score.addDistance(this.worldSpeed * dt);

    this.spawn(dt * 1000, now);

    for (const o of this.obstacles) o.update(dt, this.worldSpeed, now);
    for (const c of this.coins) c.update(dt, this.worldSpeed, now);
    for (const p of this.projectiles) p.update(dt, this.worldSpeed, now);
    for (const it of this.items) it.update(dt, this.worldSpeed, now);

    this.handleCollisions(now);

    this.obstacles = this.obstacles.filter((o) => !o.dead);
    this.coins = this.coins.filter((c) => !c.dead);
    this.projectiles = this.projectiles.filter((p) => !p.dead);
    this.items = this.items.filter((i) => !i.dead);

    if (this.dialogue && now > this.dialogueUntil) this.dialogue = null;

    if (this.player.hp <= 0) this.gameOver(now);

    this.pushHud();
  }

  private spawn(dtMs: number, now: number) {
    this.tObstacle -= dtMs;
    if (this.tObstacle <= 0) {
      const kind: ObstacleKind = Math.random() < 0.5 ? "puddle" : "stack";
      this.obstacles.push(new Obstacle(kind));
      // 속도가 빠를수록 간격을 살짝 좁힘
      const f = SPEED.BASE / this.worldSpeed;
      this.tObstacle = rand(
        SPAWN.OBSTACLE_MIN_MS * f,
        SPAWN.OBSTACLE_MAX_MS * f
      );
    }

    this.tCoin -= dtMs;
    if (this.tCoin <= 0) {
      // 점프 궤적 높이에 배치 (지면~점프 정점 사이)
      const y = GROUND_Y - rand(30, 220);
      const streak = Math.floor(rand(1, 4));
      for (let i = 0; i < streak; i++) {
        const c = new Coin(y);
        c.x += i * 34;
        this.coins.push(c);
      }
      this.tCoin = rand(SPAWN.COIN_MIN_MS, SPAWN.COIN_MAX_MS);
    }

    // 3단계: 박소장 투척 (경고 선행)
    this.tProjectile -= dtMs;
    if (this.tProjectile <= 0) {
      const kind: ProjectileKind = pick(["papers", "tube", "megaphone"]);
      const targetY = GROUND_Y - rand(20, 130);
      this.projectiles.push(new Projectile(kind, targetY, now));
      this.say(pick(DIALOGUE.throw), now, 1600);
      this.tProjectile = rand(
        SPAWN.PROJECTILE_MIN_MS,
        SPAWN.PROJECTILE_MAX_MS
      );
    }

    // 특수 아이템
    this.tItem -= dtMs;
    if (this.tItem <= 0) {
      const kind: ItemKind = Math.random() < 0.5 ? "coffee" : "booster";
      const y = GROUND_Y - rand(40, 180);
      this.items.push(new Item(kind, y));
      this.tItem = rand(SPAWN.ITEM_MIN_MS, SPAWN.ITEM_MAX_MS);
    }
  }

  private handleCollisions(now: number) {
    const pbox = this.player.box;
    const invincible = now < this.boosterUntil;

    // 지상 장애물: 충돌 시 감속 + 피격
    for (const o of this.obstacles) {
      if (o.dead) continue;
      if (intersectsPadded(pbox, o.box)) {
        if (!invincible && this.player.hit(now)) {
          this.slowUntil = now + SPEED.SLOW_MS;
          this.say(pick(DIALOGUE.hit), now, 1000);
        }
        o.dead = true;
      }
    }

    // 투척물 피격
    for (const p of this.projectiles) {
      if (p.dead || p.warning) continue;
      if (intersectsPadded(pbox, p.box, 4)) {
        if (!invincible && this.player.hit(now)) {
          this.say(pick(DIALOGUE.hit), now, 1000);
        }
        p.dead = true;
      }
    }

    // 코인 획득
    for (const c of this.coins) {
      if (c.dead) continue;
      if (intersects(pbox, c.box)) {
        this.score.addCoin();
        c.dead = true;
      }
    }

    // 특수 아이템
    for (const it of this.items) {
      if (it.dead) continue;
      if (intersects(pbox, it.box)) {
        if (it.kind === "booster") {
          this.boosterUntil = now + ITEM_EFFECT.BOOSTER_MS;
          this.say(DIALOGUE.booster[0], now, 1400);
        } else {
          this.slowUntil = now + ITEM_EFFECT.COFFEE_SLOW_MS;
          this.say(DIALOGUE.coffee[0], now, 1400);
        }
        it.dead = true;
      }
    }
  }

  private say(text: string, now: number, ms: number) {
    this.dialogue = text;
    this.dialogueUntil = now + ms;
  }

  private gameOver(now: number) {
    this.phase = "gameover";
    const result: GameResult = {
      userId: this.userId,
      coinCount: this.score.coins,
      rankScore: this.score.rankScore,
      playDuration: Math.round((now - this.startedAt) / 100) / 10,
      timestamp: Date.now(),
    };
    this.say(DIALOGUE.gameover.join("  "), now, 999999);
    this.pushHud();
    this.cb.onGameOver(result);
  }

  private pushHud() {
    const now = performance.now();
    this.cb.onHud({
      phase: this.phase,
      coins: this.score.coins,
      score: this.score.rankScore,
      hp: this.player.hp,
      boosterActive: now < this.boosterUntil,
      coffeeActive: now < this.slowUntil,
      dialogue: this.dialogue,
    });
  }

  // ── 렌더링 ──
  private render(now: number) {
    const ctx = this.ctx;
    ctx.clearRect(0, 0, VIEW.W, VIEW.H);
    this.drawBackground(ctx);
    this.drawGround(ctx);

    for (const o of this.obstacles) o.draw(ctx, now);
    for (const c of this.coins) c.draw(ctx, now);
    for (const it of this.items) it.draw(ctx, now);

    // 부스터 무적 오라
    if (now < this.boosterUntil) {
      const b = this.player.box;
      ctx.save();
      ctx.globalAlpha = 0.4 + Math.sin(now / 80) * 0.15;
      ctx.strokeStyle = "#ffd23f";
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.ellipse(b.x + b.w / 2, b.y + b.h / 2, b.w, b.h * 0.8, 0, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }

    this.player.draw(ctx, now);
    for (const p of this.projectiles) p.draw(ctx, now);
  }

  private drawBackground(ctx: CanvasRenderingContext2D) {
    // 하늘 그라디언트
    const g = ctx.createLinearGradient(0, 0, 0, GROUND_Y);
    g.addColorStop(0, "#cfe4ff");
    g.addColorStop(1, "#eef4ff");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, VIEW.W, GROUND_Y);

    // 원경 빌딩 실루엣 (패럴랙스)
    ctx.fillStyle = "#b9cbe8";
    const base = GROUND_Y;
    for (let i = -1; i < 6; i++) {
      const bx = ((i * 90 - this.bgOffset * 0.5) % (VIEW.W + 180)) + 0;
      const bh = 90 + ((i * 37) % 70);
      ctx.fillRect(bx, base - bh, 60, bh);
      // 크레인 느낌 상단 바
      ctx.fillRect(bx + 20, base - bh - 20, 40, 6);
    }
  }

  private drawGround(ctx: CanvasRenderingContext2D) {
    // 지면
    ctx.fillStyle = "#3c4a63";
    ctx.fillRect(0, GROUND_Y, VIEW.W, VIEW.GROUND_H);
    ctx.fillStyle = "#2b3550";
    ctx.fillRect(0, GROUND_Y, VIEW.W, 6);
    // 이동 표시용 점선
    ctx.fillStyle = "#5a6a86";
    for (let x = -40 + (40 - this.groundOffset); x < VIEW.W; x += 40) {
      ctx.fillRect(x, GROUND_Y + 24, 20, 5);
    }
  }
}
