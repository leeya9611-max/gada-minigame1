import {
  CHASE,
  DIALOGUE,
  DIALOGUE_MS,
  GROUND_Y,
  ITEM_EFFECT,
  PLAYER,
  PROJECTILE,
  ROUTE,
  SPAWN,
  SPEED,
  VIEW,
} from "./config";
import { Background, type MapKey } from "./Background";
import { intersects, intersectsPadded } from "./collision";
import { CHARS, TARGET_CHAR_H, charScale, clipFrame, drawChar } from "./sprites";
import { Coin, FallingObject, Item, Obstacle, Projectile } from "./obstacle";
import {
  SLOT_BASE,
  SLOT_PX,
  STEP_PX,
  buildGroundProfile,
  countCoins,
  levelLength,
  type GroundCol,
  type LevelData,
} from "./level";
import { Player } from "./player";
import { ScoreKeeper } from "./score";
import type {
  GameMode,
  GamePhase,
  GameResult,
  HudState,
  ItemKind,
  ObstacleKind,
  Outcome,
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
  private fallers: FallingObject[] = [];

  private worldSpeed: number = SPEED.BASE;
  private bg = new Background();
  private bgScroll = 0; // 누적 스크롤 = 월드 x (노선 진행 기준)
  private bgOffset = 0;
  private groundOffset = 0;
  private elapsed = 0; // 플레이 경과 초
  private startedAt = 0;

  // 플레이 모드 (E1): route=노선 재생 / endless=무한 잔업(절차 스폰) / edu=안전교육(E3)
  private mode: GameMode = "route";

  // WP6 노선(스테이지)
  private level: LevelData | null = null;
  private profile: GroundCol[] = [];
  private lengthPx = 0;
  private spawnIdx = 0; // 다음에 배치할 objects 인덱스(col 오름차순 정렬됨)
  private hits = 0; // 피격 횟수(별점: 무피격)
  private finaleOn = false;

  // 투척 타이머 (ms 남은 시간)
  private tProjectile = 0;
  // 엔들리스 절차 스폰 타이머 (E1)
  private tObstacle = 0;
  private tCoin = 0;
  private tItem = 0;

  // 효과 만료 시각(ms, performance.now 기준)
  private boosterUntil = 0;
  private slowUntil = 0;
  private magnetUntil = 0;

  // 박소장 추격 거리(px). 0이면 붙잡힘.
  private gap: number = CHASE.START_GAP;

  private dialogue: string | null = null;
  private dialogueUntil = 0;
  private lastDialogue = ""; // 연속 중복 방지

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
    this.fallers = [];
    this.worldSpeed = this.level?.baseSpeed ?? SPEED.BASE;
    this.bgScroll = 0;
    this.elapsed = 0;
    this.spawnIdx = 0;
    this.hits = 0;
    this.finaleOn = false;
    this.tProjectile = PROJECTILE.GRACE_MS;
    this.tObstacle = 600;
    this.tCoin = 500;
    this.tItem = SPAWN.ITEM_MIN_MS;
    this.boosterUntil = 0;
    this.slowUntil = 0;
    this.magnetUntil = 0;
    this.gap = CHASE.START_GAP;
    this.dialogue = null;
    this.dialogueUntil = 0;
  }

  // WP6: 노선 데이터 로드(맵 배경 포함). ready 상태에서 호출.
  // mode 기본 "route" — E3 안전교육은 "edu"로 전달(관용 룰).
  setLevel(level: LevelData, mapKey: MapKey, mode: GameMode = "route") {
    this.mode = mode;
    this.level = {
      ...level,
      objects: [...level.objects].sort((a, b) => a.col - b.col),
    };
    this.profile = buildGroundProfile(this.level);
    this.lengthPx = levelLength(this.level);
    this.bg = new Background(mapKey);
    this.reset();
    this.pushHud();
  }

  // E1: 엔들리스 "무한 잔업 모드" — 레벨 없이 절차 스폰으로 무한 진행(랭킹 본선).
  // 완주·피날레 없음, 속도는 BASE→ACCEL 램프(MAX 상한), gap·HP 실패는 동일.
  setEndless(mapKey: MapKey = "map1") {
    this.mode = "endless";
    this.level = null;
    this.profile = [];
    this.lengthPx = 0;
    this.bg = new Background(mapKey);
    this.reset();
    this.pushHud();
  }

  // 김반장의 현재 월드 x (에디터 좌표계)
  private get playerWorldX(): number {
    return this.bgScroll + PLAYER.X + PLAYER.W / 2;
  }

  // 노선 진행도 0~1
  private get progress(): number {
    if (!this.lengthPx) return 0;
    return Math.max(0, Math.min(1, this.playerWorldX / this.lengthPx));
  }

  // 화면 x 위치의 지면 y (노선 지형 반영). gap(구멍)이면 화면 아래.
  private groundYAt(screenX: number): number {
    if (!this.level) return GROUND_Y;
    const col = Math.floor((this.bgScroll + screenX) / this.level.cellSize);
    const g = this.profile[Math.max(0, Math.min(this.profile.length - 1, col))];
    if (!g) return GROUND_Y;
    if (g.gap) return VIEW.H + 200; // 구멍: 지면 없음
    return GROUND_Y - g.h * STEP_PX;
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

  // 맵 테마 전환(WP6). ready 화면에서 선택.
  setMap(key: MapKey) {
    this.bg = new Background(key);
  }

  // 이번 플레이 주행거리(m) — 누적 해금용
  get distanceM(): number {
    return Math.floor(this.score.distance / 10);
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

  // 로비 복귀(WP6.5): 루프 유지한 채 대기 상태로
  backToReady() {
    this.reset();
    this.phase = "ready";
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

    // 속도: 노선 baseSpeed + 시간 램프(speedRamp), 감속 디버프 반영
    const slowed = now < this.slowUntil;
    const base = this.level?.baseSpeed ?? SPEED.BASE;
    const ramp = this.level?.speedRamp ?? SPEED.ACCEL;
    const target = Math.min(SPEED.MAX, base + this.elapsed * ramp);
    this.worldSpeed = slowed ? target * SPEED.SLOW_FACTOR : target;

    const scale = this.worldSpeed / SPEED.BASE;
    this.bgScroll += this.worldSpeed * dt;
    this.bgOffset = (this.bgOffset + this.worldSpeed * 0.25 * dt) % VIEW.W;
    this.groundOffset = (this.groundOffset + this.worldSpeed * dt) % 40;

    // 지형: 플레이어 위치의 지면 높이 반영(오르막/내리막/구멍)
    this.player.floorY = this.groundYAt(PLAYER.X + PLAYER.W / 2);
    this.player.update(dt, scale, now);
    // 구멍 낙사: 화면 아래로 떨어지면 페널티 후 구조
    if (this.player.y > VIEW.H + 40) this.rescueFromPit(now);

    this.score.addDistance(this.worldSpeed * dt);

    if (this.mode === "endless") this.spawnEndless(dt * 1000);
    else this.spawnFromLevel();
    this.spawnThrows(dt * 1000, now);

    for (const o of this.obstacles) o.update(dt, this.worldSpeed, now);
    for (const c of this.coins) c.update(dt, this.worldSpeed, now);
    for (const p of this.projectiles) p.update(dt, this.worldSpeed, now);
    for (const it of this.items) it.update(dt, this.worldSpeed, now);
    for (const f of this.fallers) f.update(dt, this.worldSpeed, now);

    // 자석: 반경 내 코인 흡인
    if (now < this.magnetUntil) this.attractCoins(dt);

    this.handleCollisions(now); // 피격 시 gap -= HIT_LOSS 반영

    // 추격 거리 회복: 안전 주행 시 벌어짐. 감속 중 절반, 부스터 중 가속.
    const boosted = now < this.boosterUntil;
    let rec = CHASE.RECOVER_PER_SEC;
    if (slowed) rec *= CHASE.SLOW_RECOVER_FACTOR;
    if (boosted) rec *= CHASE.BOOST_RECOVER_FACTOR;
    this.gap = Math.min(CHASE.MAX_GAP, this.gap + rec * dt);

    // 피날레 돌진(노선 75~95%): 박소장 급접근 — 회복을 상쇄하는 드레인
    const prog = this.progress;
    this.finaleOn = prog >= ROUTE.FINALE_START && prog < ROUTE.FINALE_END;
    if (this.finaleOn) {
      const idx = this.level?.index ?? 1;
      this.gap -= (ROUTE.FINALE_DRAIN + idx * 2) * dt;
      if (prog < ROUTE.FINALE_START + 0.02 && this.dialogue === null) {
        this.say("박소장: 거기 서!! 야리끼리 금지야!!", now);
      }
    }

    this.obstacles = this.obstacles.filter((o) => !o.dead);
    this.coins = this.coins.filter((c) => !c.dead);
    this.projectiles = this.projectiles.filter((p) => !p.dead);
    this.items = this.items.filter((i) => !i.dead);
    this.fallers = this.fallers.filter((f) => !f.dead);

    if (this.dialogue && now > this.dialogueUntil) this.dialogue = null;

    // 완주: 정류장(노선 끝) 도착 = 퇴근 성공
    if (this.level && this.playerWorldX >= this.lengthPx - 10) {
      this.finish(now);
      return;
    }

    // 실패 조건 병존: HP 0 또는 gap 0(붙잡힘)
    if (this.player.hp <= 0) {
      this.gameOver(now, "hp");
    } else if (this.gap <= 0) {
      this.gameOver(now, "caught");
    }

    this.pushHud();
  }

  // 구멍에 빠짐: HP·gap 페널티 후 지면으로 구조(러너 관례)
  private rescueFromPit(now: number) {
    this.player.hit(now);
    this.hits++;
    this.gap -= CHASE.HIT_LOSS;
    this.slowUntil = now + SPEED.SLOW_MS;
    this.say("김반장: 으아악 구덩이!!", now);
    // 앞쪽 첫 비-구멍 지면으로 복귀
    let fy = this.groundYAt(PLAYER.X + PLAYER.W / 2);
    for (let d = 0; fy > VIEW.H && d < 600; d += 30) {
      fy = this.groundYAt(PLAYER.X + PLAYER.W / 2 + d);
    }
    this.player.floorY = Math.min(fy, GROUND_Y + STEP_PX);
    this.player.y = this.player.floorY - PLAYER.H;
    this.player.vy = 0;
  }

  // 자석: 반경 내 코인을 플레이어 쪽으로 끌어당김
  private attractCoins(dt: number) {
    const pb = this.player.box;
    const cx = pb.x + pb.w / 2;
    const cy = pb.y + pb.h / 2;
    for (const c of this.coins) {
      const dx = cx - c.x;
      const dy = cy - c.y;
      const dist = Math.hypot(dx, dy);
      if (dist < ITEM_EFFECT.MAGNET_RADIUS && dist > 1) {
        const pull = 900 * dt;
        c.x += (dx / dist) * pull;
        c.y += (dy / dist) * pull;
      }
    }
  }

  // E1 엔들리스: 절차(랜덤) 스폰 — 장애물/코인/아이템. 투척은 spawnThrows 공용.
  private spawnEndless(dtMs: number) {
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
      // 점프 궤적 높이에 배치(지면~점프 정점 사이)
      const y = GROUND_Y - rand(24, 160);
      const streak = Math.floor(rand(1, 4));
      for (let i = 0; i < streak; i++) {
        const c = new Coin(y);
        c.x += i * 34;
        this.coins.push(c);
      }
      this.tCoin = rand(SPAWN.COIN_MIN_MS, SPAWN.COIN_MAX_MS);
    }

    this.tItem -= dtMs;
    if (this.tItem <= 0) {
      const kind: ItemKind = Math.random() < 0.5 ? "coffee" : "booster";
      this.items.push(new Item(kind, GROUND_Y - rand(30, 140)));
      this.tItem = rand(SPAWN.ITEM_MIN_MS, SPAWN.ITEM_MAX_MS);
    }
  }

  // WP6: 노선 데이터의 오브젝트를 화면 오른쪽 진입 시점에 인스턴스화
  private spawnFromLevel() {
    const lv = this.level;
    if (!lv) return;
    const horizon = this.bgScroll + VIEW.W + 80; // 이 월드 x까지 미리 배치
    while (
      this.spawnIdx < lv.objects.length &&
      lv.objects[this.spawnIdx].col * lv.cellSize <= horizon
    ) {
      const o = lv.objects[this.spawnIdx++];
      const worldX = o.col * lv.cellSize + lv.cellSize / 2;
      const screenX = worldX - this.bgScroll;
      // 오브젝트가 서 있는 col의 지면(에디터와 동일 규칙)
      const g = this.profile[Math.min(this.profile.length - 1, o.col)];
      const groundY = g && !g.gap ? GROUND_Y - g.h * STEP_PX : GROUND_Y;
      // air형 y = 지면 - slot*30 - 21 (에디터 공식)
      const airY = groundY - o.slot * SLOT_PX - SLOT_BASE;

      switch (o.type) {
        case "obs_low": {
          const ob = new Obstacle("puddle", groundY);
          ob.x = screenX - ob.w / 2;
          this.obstacles.push(ob);
          break;
        }
        case "obs_high": {
          const ob = new Obstacle("stack", groundY);
          ob.x = screenX - ob.w / 2;
          this.obstacles.push(ob);
          break;
        }
        case "obs_air": {
          const ob = new Obstacle("airbar", groundY, airY);
          ob.x = screenX - ob.w / 2;
          this.obstacles.push(ob);
          break;
        }
        case "obs_fall": {
          const f = new FallingObject(groundY);
          f.x = screenX;
          this.fallers.push(f);
          break;
        }
        case "coin": {
          const c = new Coin(airY);
          c.x = screenX;
          this.coins.push(c);
          break;
        }
        case "heart":
        case "coffee":
        case "dash":
        case "magnet": {
          const kind =
            o.type === "dash" ? "booster" : o.type === "heart" ? "heart" : o.type;
          const it = new Item(kind, airY);
          it.x = screenX;
          this.items.push(it);
          break;
        }
      }
    }
  }

  // 박소장 투척 (경고 선행). 노선 index가 높을수록 간격이 짧아짐.
  private spawnThrows(dtMs: number, now: number) {
    this.tProjectile -= dtMs;
    if (this.tProjectile > 0) return;
    // 하단(점프로 회피) 위주, 가끔 상단(슬라이드 회피)로 리듬 변화
    const high = Math.random() < PROJECTILE.HIGH_CHANCE;
    // 상단 투척은 점프를 강제하는 장애물과 겹치면 회피 불가 → 임박 시에만 보류.
    if (high && this.obstacleAhead()) {
      this.tProjectile = PROJECTILE.RETRY_MS;
      return;
    }
    const kind: ProjectileKind = pick(["papers", "tube", "megaphone"]);
    const off = high
      ? rand(PROJECTILE.HIGH_MIN, PROJECTILE.HIGH_MAX)
      : rand(PROJECTILE.LOW_MIN, PROJECTILE.LOW_MAX);
    const baseY = this.groundYAt(PLAYER.X + PLAYER.W / 2);
    const y = (baseY > VIEW.H ? GROUND_Y : baseY) - off;
    this.projectiles.push(new Projectile(kind, y, now, high));
    this.say(this.pickLine(DIALOGUE.throw), now);
    const idxScale = 1 / (1 + ((this.level?.index ?? 1) - 1) * ROUTE.INDEX_SPEED_STEP);
    this.tProjectile = this.nextThrowDelay() * idxScale;
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

    // 공통 피격 처리: HP−1 + 감속 + gap 감소 + hits(별점 무피격 판정)
    const applyHit = (): boolean => {
      if (invincible || !this.player.hit(now)) return false;
      this.hits++;
      this.slowUntil = now + SPEED.SLOW_MS;
      this.gap -= CHASE.HIT_LOSS; // 피격 시 박소장이 확 접근
      this.say(this.pickLine(DIALOGUE.hit), now);
      return true;
    };

    // 지상/공중 장애물. 슬라이드 중이면 낮은 통과형(lowbar) 통과.
    for (const o of this.obstacles) {
      if (o.dead) continue;
      if (o.kind === "lowbar" && this.player.sliding) continue;
      if (intersectsPadded(pbox, o.box)) {
        applyHit();
        o.dead = true;
      }
    }

    // 투척물 피격. 슬라이드 중이면 상단 투척(high)을 숙여서 통과.
    for (const p of this.projectiles) {
      if (p.dead || p.warning) continue;
      if (p.high && this.player.sliding) continue;
      if (intersectsPadded(pbox, p.box, 4)) {
        applyHit();
        p.dead = true;
      }
    }

    // 낙하물(노선 obs_fall)
    for (const f of this.fallers) {
      if (f.dead) continue;
      if (intersectsPadded(pbox, f.box, 4)) {
        applyHit();
        f.dead = true;
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
          this.say(this.pickLine(DIALOGUE.booster), now);
        } else if (it.kind === "magnet") {
          this.magnetUntil = now + ITEM_EFFECT.MAGNET_MS;
          this.say("김반장: 코인이 달라붙는다!", now);
        } else {
          // 커피/하트: 감속 없이 HP 회복. 최대면 코인으로 대체(기획 5.6).
          if (this.player.heal(ITEM_EFFECT.COFFEE_HEAL)) {
            this.say(
              it.kind === "heart"
                ? "김반장: 안전모 회복!"
                : this.pickLine(DIALOGUE.coffee),
              now
            );
          } else {
            this.score.addCoin(ITEM_EFFECT.COFFEE_FULL_COINS);
            this.say("김반장: 안전모 꽉 찼다! (+코인)", now);
          }
        }
        it.dead = true;
      }
    }
  }

  private say(text: string, now: number, ms: number = DIALOGUE_MS) {
    this.dialogue = text;
    this.lastDialogue = text;
    this.dialogueUntil = now + ms;
  }

  // 풀에서 직전 대사를 제외하고 랜덤 선택(연속 중복 금지)
  private pickLine(pool: readonly string[]): string {
    if (pool.length <= 1) return pool[0];
    let line = pick(pool);
    for (let i = 0; i < 4 && line === this.lastDialogue; i++) line = pick(pool);
    return line;
  }

  private buildResult(now: number, outcome: Outcome): GameResult {
    return {
      userId: this.userId,
      coinCount: this.score.coins,
      rankScore: this.score.rankScore,
      playDuration: Math.round((now - this.startedAt) / 100) / 10,
      timestamp: Date.now(),
      outcome,
      mode: this.mode,
      routeId: this.mode === "endless" ? "endless" : this.level?.id ?? "unknown",
      hits: this.hits,
      totalCoins: this.level ? countCoins(this.level) : 0,
    };
  }

  // 완주(정류장 도착) = 퇴근 성공 (WP6)
  private finish(now: number) {
    this.phase = "cleared";
    this.say("김반장: 퇴근이다아아!! 🚌", now, 999999);
    this.pushHud();
    this.cb.onGameOver(this.buildResult(now, "cleared"));
  }

  private gameOver(now: number, outcome: Outcome) {
    this.phase = "gameover";
    this.say(DIALOGUE.gameover.join("  "), now, 999999);
    this.pushHud();
    this.cb.onGameOver(this.buildResult(now, outcome));
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
      magnetActive: now < this.magnetUntil,
      gap: Math.max(0, Math.round(this.gap)),
      chaseRatio: Math.max(0, Math.min(1, this.gap / CHASE.MAX_GAP)),
      progress: this.progress,
      finale: this.finaleOn,
      dialogue: this.dialogue,
    });
  }

  // ── 렌더링 ──
  private render(now: number) {
    const ctx = this.ctx;
    ctx.clearRect(0, 0, VIEW.W, VIEW.H);
    // 원경(하늘·실루엣)은 이미지 배경, 지면은 노선 지형 렌더러가 담당
    if (this.bg.isReady) {
      this.bg.draw(ctx, this.bgScroll, this.level !== null);
    } else {
      this.drawBackground(ctx);
      if (!this.level) this.drawGround(ctx);
    }
    if (this.level) this.drawTerrain(ctx);
    this.drawStation(ctx, now); // 정류장(노선 끝)
    this.drawBoss(ctx, now); // 플레이어 뒤에서 추격하는 박소장

    for (const o of this.obstacles) o.draw(ctx, now);
    for (const c of this.coins) c.draw(ctx, now);
    for (const it of this.items) it.draw(ctx, now);
    for (const f of this.fallers) f.draw(ctx, now);

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

  // 노선 지형 렌더: 프로파일 폴리곤(흙) + 표면 스트립. 에디터와 동일 규칙.
  private drawTerrain(ctx: CanvasRenderingContext2D) {
    const lv = this.level;
    if (!lv) return;
    const cell = lv.cellSize;
    const sc = Math.max(0, Math.floor(this.bgScroll / cell));
    const ec = Math.min(lv.cols, sc + Math.ceil(VIEW.W / cell) + 2);

    // 흙 채우기(지형 프로파일, 구멍은 끊김)
    ctx.save();
    ctx.beginPath();
    let started = false;
    for (let c = sc; c <= ec; c++) {
      const x = c * cell - this.bgScroll;
      const g = this.profile[Math.min(lv.cols - 1, c)];
      if (!g) break;
      if (g.gap) {
        if (started) {
          ctx.lineTo(x, VIEW.H);
          started = false;
        }
        continue;
      }
      const y = GROUND_Y - g.h * STEP_PX;
      if (!started) {
        ctx.moveTo(x, VIEW.H);
        ctx.lineTo(x, y);
        started = true;
      } else {
        ctx.lineTo(x, y);
      }
    }
    if (started) ctx.lineTo(ec * cell - this.bgScroll, VIEW.H);
    ctx.fillStyle = "#a9835a";
    ctx.fill();

    // 표면 스트립(배경 바닥 이미지를 칸별로 얹음)
    const g0 = this.bg.groundImage;
    for (let c = sc; c < ec; c++) {
      const g = this.profile[Math.min(lv.cols - 1, c)];
      if (!g || g.gap) continue;
      const x = c * cell - this.bgScroll;
      const y = GROUND_Y - g.h * STEP_PX;
      if (g0) {
        const srcX = (c * cell) % Math.max(1, g0.width - cell);
        ctx.drawImage(g0, srcX, 0, cell, g0.height, x - 1, y - 4, cell + 2, 40);
      } else {
        ctx.fillStyle = "#8a6a45";
        ctx.fillRect(x - 1, y, cell + 2, 6);
      }
    }
    ctx.restore();
  }

  // 정류장(노선 끝): 도착 = 완주. 쉼터(지붕·유리·벤치·표지판) + 완주 시 버스 정차 연출.
  private drawStation(ctx: CanvasRenderingContext2D, now: number) {
    if (!this.level) return;
    const sx = this.lengthPx - this.bgScroll - 40; // 정류장 화면 x
    if (sx > VIEW.W + 200 || sx < -260) return;
    const gy = this.groundYAt(Math.max(0, Math.min(VIEW.W - 1, sx)));
    const baseY = gy > VIEW.H ? GROUND_Y : gy;

    ctx.save();

    // ── 쉼터 구조물 ──
    const shW = 128; // 쉼터 폭
    const shH = 128; // 기둥 높이
    // 뒷벽 유리 패널
    ctx.fillStyle = "rgba(160, 200, 230, 0.35)";
    ctx.fillRect(sx - shW / 2 + 6, baseY - shH + 14, shW - 12, shH - 44);
    ctx.strokeStyle = "#5b6a84";
    ctx.lineWidth = 3;
    ctx.strokeRect(sx - shW / 2 + 6, baseY - shH + 14, shW - 12, shH - 44);
    // 유리 반사광
    ctx.strokeStyle = "rgba(255,255,255,0.5)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(sx - shW / 2 + 16, baseY - shH + 60);
    ctx.lineTo(sx - shW / 2 + 40, baseY - shH + 22);
    ctx.stroke();
    // 양측 기둥
    ctx.fillStyle = "#3c4a63";
    ctx.fillRect(sx - shW / 2, baseY - shH, 8, shH);
    ctx.fillRect(sx + shW / 2 - 8, baseY - shH, 8, shH);
    // 지붕(살짝 둥근 처마)
    ctx.fillStyle = "#2E66F6";
    ctx.beginPath();
    ctx.moveTo(sx - shW / 2 - 12, baseY - shH);
    ctx.lineTo(sx + shW / 2 + 12, baseY - shH);
    ctx.lineTo(sx + shW / 2 + 6, baseY - shH - 14);
    ctx.lineTo(sx - shW / 2 - 6, baseY - shH - 14);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = "#ffd23f";
    ctx.fillRect(sx - shW / 2 - 12, baseY - shH - 2, shW + 24, 4);
    // 벤치
    ctx.fillStyle = "#8a6a45";
    ctx.fillRect(sx - 42, baseY - 34, 84, 8);
    ctx.fillRect(sx - 38, baseY - 26, 6, 26);
    ctx.fillRect(sx + 32, baseY - 26, 6, 26);

    // 표지판 기둥(쉼터 앞)
    const signX = sx - shW / 2 - 34;
    ctx.fillStyle = "#5b6a84";
    ctx.fillRect(signX - 3, baseY - 120, 6, 120);
    ctx.fillStyle = "#ffd23f";
    ctx.beginPath();
    ctx.arc(signX, baseY - 136, 20, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "#1f2a44";
    ctx.lineWidth = 3;
    ctx.stroke();
    ctx.fillStyle = "#1f2a44";
    ctx.font = "bold 15px sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("🚌", signX, baseY - 130);

    // ── 완주 연출: 버스 정차 + 헤드라이트 + 문 열림 ──
    if (this.phase === "cleared") {
      const bx = sx + shW / 2 + 40; // 버스 앞머리 x
      const bw = 190;
      const bh = 86;
      const by = baseY - bh - 6;
      // 차체
      ctx.fillStyle = "#2E66F6";
      this.roundRectPath(ctx, bx - bw, by, bw, bh, 12);
      ctx.fill();
      // 하부 밴드
      ctx.fillStyle = "#1f2a44";
      ctx.fillRect(bx - bw, by + bh - 18, bw, 12);
      // 노선 밴드
      ctx.fillStyle = "#ffd23f";
      ctx.fillRect(bx - bw, by + 26, bw, 10);
      // 창문들
      ctx.fillStyle = "rgba(190, 225, 250, 0.9)";
      for (let i = 0; i < 3; i++) {
        ctx.fillRect(bx - bw + 14 + i * 44, by + 8, 34, 16);
      }
      // 문(열림 — 완주 환영)
      ctx.fillStyle = "#cdd8ec";
      ctx.fillRect(bx - 44, by + 8, 30, bh - 28);
      ctx.strokeStyle = "#1f2a44";
      ctx.lineWidth = 2;
      ctx.strokeRect(bx - 44, by + 8, 30, bh - 28);
      // 바퀴
      ctx.fillStyle = "#1f2a44";
      for (const wx of [bx - bw + 34, bx - 34]) {
        ctx.beginPath();
        ctx.arc(wx, baseY - 8, 13, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = "#8894a6";
        ctx.beginPath();
        ctx.arc(wx, baseY - 8, 6, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = "#1f2a44";
      }
      // 행선지 표시(깜빡)
      ctx.globalAlpha = 0.6 + Math.sin(now / 250) * 0.4;
      ctx.fillStyle = "#ffd23f";
      ctx.font = "bold 12px sans-serif";
      ctx.fillText("우리집行", bx - bw / 2, by + 20);
      ctx.globalAlpha = 1;
    } else {
      // 진행 중: 표지판 반짝임(목표 인지)
      ctx.globalAlpha = 0.5 + Math.sin(now / 200) * 0.3;
      ctx.fillStyle = "#fff";
      ctx.beginPath();
      ctx.arc(signX + 12, baseY - 148, 3, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.restore();
  }

  private roundRectPath(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    w: number,
    h: number,
    r: number
  ) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  // 박소장: 플레이어 뒤 gap 거리. 좌측 가장자리 안쪽으로 클램프해 항상 보이게.
  // 김반장과 동일한 목표 화면 키(TARGET_CHAR_H)로 그린다. gap 작을수록 위기 연출.
  private drawBoss(ctx: CanvasRenderingContext2D, now: number) {
    const ratio = Math.max(0, Math.min(1, this.gap / CHASE.MAX_GAP));
    const danger = 1 - ratio; // 0(안전)~1(위기)
    const s = charScale("parksojang");
    const halfW = (CHARS.parksojang.canvasW * s) / 2;
    // 발 중심 x: 플레이어 발 중심 - gap, 왼쪽 가장자리 안쪽 클램프
    const footX = Math.max(halfW * 0.55, PLAYER.X + PLAYER.W / 2 - this.gap);
    const shake = danger > 0.5 ? Math.sin(now / 40) * danger * 3 : 0;
    // 보스 발밑 지형(구멍 위면 기준 지면 유지)
    const rawGy = this.groundYAt(footX);
    const bossGy = rawGy > VIEW.H ? GROUND_Y : rawGy;

    ctx.save();

    // 위기 경고 오라 (발밑 타원)
    if (danger > 0.4) {
      ctx.globalAlpha = 0.18 + Math.sin(now / 100) * 0.12 * danger;
      ctx.fillStyle = "#ff3b30";
      ctx.beginPath();
      ctx.ellipse(
        footX + shake,
        bossGy - TARGET_CHAR_H / 2,
        halfW * 0.9,
        TARGET_CHAR_H * 0.55,
        0,
        0,
        Math.PI * 2
      );
      ctx.fill();
      ctx.globalAlpha = 1;
    }

    // 클립: 경고(투척 준비) 중엔 throw(3프레임), 평시 run(6프레임 루프)
    const warning = this.projectiles.find((p) => p.warning);
    const frame = warning
      ? clipFrame("parksojang", "throw", now - warning.spawnedAt)
      : clipFrame("parksojang", "run", now);
    const drawn = frame
      ? drawChar(ctx, "parksojang", frame, footX + shake, bossGy)
      : false;

    if (!drawn) {
      // 폴백: 미로드 시 간단 실루엣
      ctx.fillStyle = danger > 0.5 ? "#c0392b" : "#e07a3c";
      ctx.fillRect(footX - 20, bossGy - TARGET_CHAR_H * 0.8, 40, TARGET_CHAR_H * 0.8);
    }

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
