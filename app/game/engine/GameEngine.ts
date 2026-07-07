import {
  CHASE,
  DIALOGUE,
  GROUND_Y,
  ITEM_EFFECT,
  PLAYER,
  PROJECTILE,
  SPAWN,
  SPEED,
  VIEW,
} from "./config";
import { Background } from "./Background";
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
  private bg = new Background();
  private bgScroll = 0; // 배경 이미지 누적 스크롤
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

  // 박소장 추격 거리(px). 0이면 붙잡힘.
  private gap: number = CHASE.START_GAP;

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
    this.bgScroll = 0;
    this.elapsed = 0;
    this.tObstacle = 600;
    this.tCoin = 500;
    this.tProjectile = PROJECTILE.GRACE_MS;
    this.tItem = SPAWN.ITEM_MIN_MS;
    this.boosterUntil = 0;
    this.slowUntil = 0;
    this.gap = CHASE.START_GAP;
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

  // 아래 입력(하단 홀드/아래 스와이프): 슬라이드
  slide() {
    if (this.phase === "playing") this.player.slide(performance.now());
  }

  endSlide() {
    this.player.endSlide();
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
    this.bgScroll += this.worldSpeed * dt;
    this.bgOffset = (this.bgOffset + this.worldSpeed * 0.25 * dt) % VIEW.W;
    this.groundOffset = (this.groundOffset + this.worldSpeed * dt) % 40;

    this.player.update(dt, scale, now);
    this.score.addDistance(this.worldSpeed * dt);

    this.spawn(dt * 1000, now);

    for (const o of this.obstacles) o.update(dt, this.worldSpeed, now);
    for (const c of this.coins) c.update(dt, this.worldSpeed, now);
    for (const p of this.projectiles) p.update(dt, this.worldSpeed, now);
    for (const it of this.items) it.update(dt, this.worldSpeed, now);

    this.handleCollisions(now); // 피격 시 gap -= HIT_LOSS 반영

    // 추격 거리 회복: 안전 주행 시 벌어짐. 감속 중 절반, 부스터 중 가속.
    const boosted = now < this.boosterUntil;
    let rec = CHASE.RECOVER_PER_SEC;
    if (slowed) rec *= CHASE.SLOW_RECOVER_FACTOR;
    if (boosted) rec *= CHASE.BOOST_RECOVER_FACTOR;
    this.gap = Math.min(CHASE.MAX_GAP, this.gap + rec * dt);

    this.obstacles = this.obstacles.filter((o) => !o.dead);
    this.coins = this.coins.filter((c) => !c.dead);
    this.projectiles = this.projectiles.filter((p) => !p.dead);
    this.items = this.items.filter((i) => !i.dead);

    if (this.dialogue && now > this.dialogueUntil) this.dialogue = null;

    // 실패 조건 병존: HP 0 또는 gap 0(붙잡힘)
    if (this.player.hp <= 0 || this.gap <= 0) this.gameOver(now);

    this.pushHud();
  }

  private spawn(dtMs: number, now: number) {
    this.tObstacle -= dtMs;
    if (this.tObstacle <= 0) {
      // 점프형(puddle/stack) 위주 + 슬라이드형(lowbar) 30%
      const r = Math.random();
      const kind: ObstacleKind =
        r < 0.3 ? "lowbar" : r < 0.65 ? "puddle" : "stack";
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
      // 점프 궤적 높이에 배치 (지면~점프 정점 사이, 가로 화면 높이에 맞춤)
      const y = GROUND_Y - rand(24, 160);
      const streak = Math.floor(rand(1, 4));
      for (let i = 0; i < streak; i++) {
        const c = new Coin(y);
        c.x += i * 34;
        this.coins.push(c);
      }
      this.tCoin = rand(SPAWN.COIN_MIN_MS, SPAWN.COIN_MAX_MS);
    }

    // 3단계: 박소장 투척 (경고 선행, 시간에 따라 잦아짐)
    this.tProjectile -= dtMs;
    if (this.tProjectile <= 0) {
      // 하단(점프로 회피) 위주, 가끔 상단(점프 금지)로 리듬 변화
      const high = Math.random() < PROJECTILE.HIGH_CHANCE;
      // 상단 투척은 점프를 강제하는 장애물과 겹치면 회피 불가 → 임박 시에만 보류.
      // 하단 투척은 점프 하나로 장애물과 함께 넘어가므로 가드 불필요.
      if (high && this.obstacleAhead()) {
        this.tProjectile = PROJECTILE.RETRY_MS;
      } else {
        const kind: ProjectileKind = pick(["papers", "tube", "megaphone"]);
        const off = high
          ? rand(PROJECTILE.HIGH_MIN, PROJECTILE.HIGH_MAX)
          : rand(PROJECTILE.LOW_MIN, PROJECTILE.LOW_MAX);
        this.projectiles.push(new Projectile(kind, GROUND_Y - off, now, high));
        this.say(pick(DIALOGUE.throw), now, 1600);
        this.tProjectile = this.nextThrowDelay();
      }
    }

    // 특수 아이템
    this.tItem -= dtMs;
    if (this.tItem <= 0) {
      const kind: ItemKind = Math.random() < 0.5 ? "coffee" : "booster";
      const y = GROUND_Y - rand(30, 140);
      this.items.push(new Item(kind, y));
      this.tItem = rand(SPAWN.ITEM_MIN_MS, SPAWN.ITEM_MAX_MS);
    }
  }

  // 플레이어 바로 앞 구간에 장애물이 임박했는지 (투척 보류 판단용)
  private obstacleAhead(): boolean {
    const from = PLAYER.X;
    const to = PLAYER.X + PROJECTILE.BLOCK_AHEAD_PX;
    return this.obstacles.some((o) => {
      const right = o.box.x + o.box.w;
      return right > from && o.box.x < to;
    });
  }

  // 경과 시간에 따라 투척 간격을 EARLY→LATE 로 좁힌다(±지터).
  private nextThrowDelay(): number {
    const t = Math.min(1, this.elapsed / PROJECTILE.RAMP_SEC);
    const base =
      PROJECTILE.GAP_EARLY_MS +
      (PROJECTILE.GAP_LATE_MS - PROJECTILE.GAP_EARLY_MS) * t;
    const j = PROJECTILE.GAP_JITTER;
    return base * (1 - j + Math.random() * 2 * j);
  }

  private handleCollisions(now: number) {
    const pbox = this.player.box;
    const invincible = now < this.boosterUntil;

    // 지상 장애물: 충돌 시 감속 + 피격. 슬라이드 중이면 낮은 통과형(lowbar) 통과.
    for (const o of this.obstacles) {
      if (o.dead) continue;
      if (o.kind === "lowbar" && this.player.sliding) continue;
      if (intersectsPadded(pbox, o.box)) {
        if (!invincible && this.player.hit(now)) {
          this.slowUntil = now + SPEED.SLOW_MS;
          this.gap -= CHASE.HIT_LOSS; // 피격 시 박소장이 확 접근
          this.say(pick(DIALOGUE.hit), now, 1000);
        }
        o.dead = true;
      }
    }

    // 투척물 피격 (지면 장애물과 동일하게 감속 패널티 통일 — 기획 5.1)
    // 슬라이드 중이면 상단 투척(high)을 숙여서 통과.
    for (const p of this.projectiles) {
      if (p.dead || p.warning) continue;
      if (p.high && this.player.sliding) continue;
      if (intersectsPadded(pbox, p.box, 4)) {
        if (!invincible && this.player.hit(now)) {
          this.slowUntil = now + SPEED.SLOW_MS;
          this.gap -= CHASE.HIT_LOSS;
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
          // 다방커피: 감속 없이 HP 회복. 최대면 코인으로 대체(기획 5.6).
          if (this.player.heal(ITEM_EFFECT.COFFEE_HEAL)) {
            this.say(DIALOGUE.coffee[0], now, 1400);
          } else {
            this.score.addCoin(ITEM_EFFECT.COFFEE_FULL_COINS);
            this.say("김반장: 안전모 꽉 찼다! (+코인)", now, 1400);
          }
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
      slowActive: now < this.slowUntil, // 피격 감속 표시(WP1: 커피 슬로우 제거)
      gap: Math.max(0, Math.round(this.gap)),
      chaseRatio: Math.max(0, Math.min(1, this.gap / CHASE.MAX_GAP)),
      dialogue: this.dialogue,
    });
  }

  // ── 렌더링 ──
  private render(now: number) {
    const ctx = this.ctx;
    ctx.clearRect(0, 0, VIEW.W, VIEW.H);
    // 맵1 이미지 배경(로드 완료 시) 또는 벡터 폴백
    if (this.bg.isReady) {
      this.bg.draw(ctx, this.bgScroll);
    } else {
      this.drawBackground(ctx);
      this.drawGround(ctx);
    }
    this.drawBoss(ctx, now); // 플레이어 뒤에서 추격하는 박소장

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

  // 박소장: 플레이어 뒤 PLAYER.X - gap 위치. 화면 밖이면 좌측 가장자리 클램프.
  // gap 이 작을수록 붉은 위기 톤 + 흔들림.
  private drawBoss(ctx: CanvasRenderingContext2D, now: number) {
    const ratio = Math.max(0, Math.min(1, this.gap / CHASE.MAX_GAP));
    const danger = 1 - ratio; // 0(안전)~1(위기)
    const w = 46;
    const h = 62;
    const x = Math.max(6, PLAYER.X - this.gap);
    const y = GROUND_Y - h;
    const shake = danger > 0.5 ? Math.sin(now / 40) * danger * 3 : 0;

    ctx.save();
    ctx.translate(x + shake, y);

    // 위기 경고 오라
    if (danger > 0.4) {
      ctx.globalAlpha = 0.2 + Math.sin(now / 100) * 0.15 * danger;
      ctx.fillStyle = "#ff3b30";
      ctx.beginPath();
      ctx.ellipse(w / 2, h / 2, w * 0.95, h * 0.7, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
    }

    // 다리 (성큼성큼)
    const stride = Math.sin(now / 90) * 7;
    ctx.strokeStyle = "#3a2b2b";
    ctx.lineWidth = 7;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(w * 0.4, h - 8);
    ctx.lineTo(w * 0.4 - stride, h + 4);
    ctx.moveTo(w * 0.6, h - 8);
    ctx.lineTo(w * 0.6 + stride, h + 4);
    ctx.stroke();

    // 몸통 (성난 소장 조끼 — 위기일수록 진한 빨강)
    ctx.fillStyle = danger > 0.5 ? "#c0392b" : "#e07a3c";
    ctx.fillRect(4, 20, w - 8, h - 24);

    // 재촉하는 팔
    const arm = Math.sin(now / 90) * 8;
    ctx.strokeStyle = "#ffdcb1";
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.moveTo(w - 6, 30);
    ctx.lineTo(w + 6, 24 - arm);
    ctx.stroke();

    // 얼굴 + 흰색 소장 안전모
    ctx.fillStyle = "#ffdcb1";
    ctx.fillRect(9, 8, w - 18, 16);
    ctx.fillStyle = "#f2f2f2";
    ctx.beginPath();
    ctx.arc(w / 2, 10, w / 2 - 6, Math.PI, 0);
    ctx.fill();
    ctx.fillRect(5, 9, w - 10, 4);

    // 화난 눈썹
    ctx.strokeStyle = "#333";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(13, 15);
    ctx.lineTo(20, 18);
    ctx.moveTo(w - 13, 15);
    ctx.lineTo(w - 20, 18);
    ctx.stroke();

    ctx.restore();
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
