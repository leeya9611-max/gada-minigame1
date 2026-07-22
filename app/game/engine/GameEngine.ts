import {
  CHASE,
  DIALOGUE,
  DIALOGUE_MS,
  EDU,
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
import { CHARS, TARGET_CHAR_H, charScale, clipFrame, drawChar, sprite } from "./sprites";
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

// E3.11-1: 아이템 안내 문구(첫 등장 라벨 + 획득 플로팅 공용)
const ITEM_LABEL: Record<ItemKind, string> = {
  coffee: "안전모 +1",
  heart: "안전모 +1",
  booster: `${Math.round(ITEM_EFFECT.BOOSTER_MS / 1000)}초 무적 질주!`,
  magnet: `${Math.round(ITEM_EFFECT.MAGNET_MS / 1000)}초 코인 자석`,
};
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

  // E3 안전교육: 구간 안내 마커
  private markerIdx = 0;
  private eduThrowSeq = 0; // 교육 투척 확정 순서: 하단 → 상단 교대(E3.5-9)
  private banner: string | null = null;
  private bannerUntil = 0;
  private eduSlowUntil = 0; // 신규 요소 직전 일시 감속(0.7배)
  private eduHitNoted = false; // E3.13-2: 교육 첫 피격 안내 배너(판당 1회)

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
    this.pausedAt = 0;
    this.dialogue = null;
    this.dialogueUntil = 0;
    this.markerIdx = 0;
    this.eduThrowSeq = 0;
    this.banner = null;
    this.bannerUntil = 0;
    this.eduSlowUntil = 0;
    this.eduHitNoted = false;
  }

  // E3.13-2: 교육 첫 피격 시 1회 안내 — HP 관용은 의도된 동작임을 알려줌(로직 불변)
  private noteEduHit(now: number) {
    if (this.mode !== "edu" || this.eduHitNoted) return;
    this.eduHitNoted = true;
    this.banner = "교육 중엔 안전모가 닳지 않아요 — 본게임에선 조심!";
    this.bannerUntil = now + EDU.BANNER_MS;
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

  // 박소장 발중심 화면 x — 플레이어 뒤 gap 거리, 왼쪽 가장자리 안쪽 클램프
  private get bossFootX(): number {
    const s = charScale("parksojang");
    const halfW = (CHARS.parksojang.canvasW * s) / 2;
    return Math.max(halfW * 0.55, PLAYER.X + PLAYER.W / 2 - this.gap);
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
    if (this.pausedAt) return; // 일시정지 중 입력 무시(E3.10-2)
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
    if (this.pausedAt) return; // 일시정지 중 입력 무시(E3.10-2)
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

    // E3.10-2: 일시정지 — 업데이트·렌더 모두 중단(마지막 프레임 유지, UI가 오버레이 표시)
    if (!this.pausedAt) {
      if (this.phase === "playing") this.update(dt, ts);
      this.render(ts);
    }

    this.raf = requestAnimationFrame(this.loop);
  };

  // ── E3.10-2: 일시정지/재개/포기 ──
  private pausedAt = 0; // >0이면 일시정지 중(그 시각)

  get paused(): boolean {
    return this.pausedAt > 0;
  }

  pause() {
    if (this.phase !== "playing" || this.pausedAt) return;
    this.pausedAt = performance.now();
  }

  // 정지 시간만큼 모든 절대 시각 필드를 밀어 물리·타이머 연속성 유지
  resume() {
    if (!this.pausedAt) return;
    const delta = performance.now() - this.pausedAt;
    this.pausedAt = 0;
    this.startedAt += delta;
    this.slowUntil += delta;
    this.boosterUntil += delta;
    this.magnetUntil += delta;
    this.dialogueUntil += delta;
    this.bannerUntil += delta;
    this.eduSlowUntil += delta;
    this.player.shiftClock(delta);
    for (const p of this.projectiles) p.shiftClock(delta);
    for (const f of this.fallers) f.shiftClock(delta);
    this.lastTs = performance.now();
  }

  // 포기: 엔들리스는 현재 기록으로 정상 종료(결과 전달). 교육·노선은 호출부가 로비 복귀 처리.
  giveUp() {
    if (this.phase !== "playing") return;
    this.pausedAt = 0;
    this.gameOver(performance.now(), "giveup");
  }

  private update(dt: number, now: number) {
    this.elapsed = (now - this.startedAt) / 1000;

    // 속도: 노선 baseSpeed + 시간 램프(speedRamp), 감속 디버프 반영
    const slowed = now < this.slowUntil;
    const base = this.level?.baseSpeed ?? SPEED.BASE;
    const ramp = this.level?.speedRamp ?? SPEED.ACCEL;
    let target = Math.min(SPEED.MAX, base + this.elapsed * ramp);
    if (now < this.eduSlowUntil) target *= EDU.SLOW_FACTOR; // E3: 신규 요소 안내 감속
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
    if (this.banner && now > this.bannerUntil) this.banner = null;

    // E3: 구간 안내 마커 — 통과 시 배너 2초 + (교육) 일시 감속 1회
    const markers = this.level?.markers;
    if (markers && this.markerIdx < markers.length) {
      const m = markers[this.markerIdx];
      if (this.playerWorldX >= m.col * (this.level?.cellSize ?? 54)) {
        this.banner = m.text;
        this.bannerUntil = now + EDU.BANNER_MS;
        if (this.mode === "edu") this.eduSlowUntil = now + EDU.SLOW_MS;
        this.markerIdx++;
      }
    }

    // E3: 교육 모드는 gap 실패 비활성 — 잡히기 직전에서 클램프(압박만 체험)
    if (this.mode === "edu") this.gap = Math.max(this.gap, EDU.MIN_GAP);

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
    // E3: 교육 모드는 낙하도 HP 미감소(연출·페널티는 유지) — 실패 없이 완주
    const hpBefore = this.player.hp;
    this.player.hit(now);
    if (this.mode === "edu") {
      this.player.hp = hpBefore;
      this.noteEduHit(now);
    }
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
      // E3.10-5: 스폰 지점 근처에 코인 줄이 있으면 장애물 스폰 보류(수평 간격 보장).
      // 두 엔티티는 같은 속도로 스크롤하므로 스폰 시 간격이 이후에도 유지된다.
      const spawnZoneX = VIEW.W + 40;
      if (
        this.coins.some(
          (c) => !c.dead && c.x > spawnZoneX - SPAWN.COIN_OBSTACLE_GAP - 20
        )
      ) {
        this.tObstacle = 120;
        return;
      }
      // 점프형(puddle/stack) 위주 + 슬라이드형(lowbar) + 콘·표지판 낮은 빈도(E3.8-2)
      // E3.9-5: 2단층 fence는 중반(FENCE_FROM_S)부터 풀에 합류
      const r = Math.random();
      const fenceOk = this.elapsed >= SPAWN.FENCE_FROM_S;
      let kind: ObstacleKind = fenceOk
        ? r < 0.26 ? "lowbar" : r < 0.52 ? "puddle" : r < 0.76 ? "stack" : r < 0.85 ? "cone" : r < 0.93 ? "sign" : "fence"
        : r < 0.28 ? "lowbar" : r < 0.56 ? "puddle" : r < 0.82 ? "stack" : r < 0.91 ? "cone" : "sign";
      // lowbar가 대기 중인 낙하 지점과 겹치면 이중구속(점프↔슬라이드) → 점프형으로 대체
      if (kind === "lowbar") {
        const spawnX = VIEW.W + 40;
        const clash = this.projectiles.some(
          (p) => !p.dead && !p.landed && Math.abs(p.targetX - spawnX) < this.worldSpeed * 0.75
        );
        if (clash) kind = "puddle";
      }
      this.obstacles.push(new Obstacle(kind));
      // 속도가 빠를수록 간격을 살짝 좁히되, E3.9-4: 최소 간격 ≥ 0.7초(시간 기준) 보장.
      // fence(2단 점프)는 체공이 ~1초라 후속 장애물 회피가 물리적으로 불가 → 추가 여유 0.6초.
      const f = SPEED.BASE / this.worldSpeed;
      const fenceExtra = kind === "fence" ? 600 : 0;
      this.tObstacle =
        Math.max(
          SPAWN.OBSTACLE_MIN_INTERVAL_S * 1000,
          rand(SPAWN.OBSTACLE_MIN_MS * f, SPAWN.OBSTACLE_MAX_MS * f)
        ) + fenceExtra;
    }

    this.tCoin -= dtMs;
    if (this.tCoin <= 0) {
      // E3.10-5: 코인 줄이 장애물과 수평으로 겹치지 않게 스폰 보류(안전 경로 보장)
      const streak = Math.floor(rand(1, 4));
      const spanFrom = VIEW.W + 30 - SPAWN.COIN_OBSTACLE_GAP;
      const spanTo = VIEW.W + 30 + (streak - 1) * 34 + SPAWN.COIN_OBSTACLE_GAP;
      const clash = this.obstacles.some(
        (o) => !o.dead && o.box.x + o.box.w > spanFrom && o.box.x < spanTo
      );
      if (clash) {
        this.tCoin = 150;
      } else {
        // 점프 궤적 높이에 배치(지면~점프 정점 사이).
        // E3.7-8 도달성: E3.6 물리(1단 발 130px·머리 ~226px) 기준 상한 160px — 1단 점프로 전부 획득 가능.
        const y = GROUND_Y - rand(24, SPAWN.COIN_MAX_H);
        for (let i = 0; i < streak; i++) {
          const c = new Coin(y);
          c.x += i * 34;
          this.coins.push(c);
        }
        this.tCoin = rand(SPAWN.COIN_MIN_MS, SPAWN.COIN_MAX_MS);
      }
    }

    this.tItem -= dtMs;
    if (this.tItem <= 0) {
      const kind: ItemKind = Math.random() < 0.5 ? "coffee" : "booster";
      this.items.push(new Item(kind, GROUND_Y - rand(30, 140), this.itemHintLabel(kind)));
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
        case "obs_fence": {
          // E3.9: 2단층 안전 펜스(2단 점프 학습·중반 위협)
          const ob = new Obstacle("fence", groundY);
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
          const it = new Item(kind, airY, this.itemHintLabel(kind));
          it.x = screenX;
          this.items.push(it);
          break;
        }
      }
    }
  }

  // 박소장 투척(E3.8: 낙하 지점 방식). 노선 index가 높을수록 간격이 짧아짐.
  private spawnThrows(dtMs: number, now: number) {
    // E3: 안전교육은 투척 학습 구간(진행도 THROW_FROM)부터만
    if (this.mode === "edu" && this.progress < EDU.THROW_FROM) return;
    this.tProjectile -= dtMs;
    if (this.tProjectile > 0) return;
    // 착지 지점 = 현재 속도 기준 1.5~2초 도달 거리(교육은 최대 여유 고정)
    const leadS =
      this.mode === "edu"
        ? PROJECTILE.DROP_EDU_LEAD_S
        : rand(PROJECTILE.DROP_LEAD_MIN_S, PROJECTILE.DROP_LEAD_MAX_S);
    const targetX = PLAYER.X + PLAYER.W / 2 + this.worldSpeed * leadS;
    // 장애물·구멍·정류장과 겹치면 보류(회피 불가 이중구속 방지)
    if (this.landingBlocked(targetX)) {
      this.tProjectile = PROJECTILE.RETRY_MS;
      return;
    }
    this.spawnDrop(targetX, leadS * 1000, now);
    // E3.5-4: 교육 톤 완화 — 박소장 잔소리는 둘에 하나만(혼나는 경험 방지)
    this.eduThrowSeq++;
    if (this.mode !== "edu" || this.eduThrowSeq % 2 === 1) {
      this.say(this.pickLine(DIALOGUE.throw), now);
    }
    // E3.8-1 난이도 램프: 엔들리스는 램프에 따라 2연속 낙하(두 번째는 한 걸음 뒤)
    const ramp = Math.min(1, this.elapsed / PROJECTILE.RAMP_SEC);
    if (this.mode !== "edu" && Math.random() < PROJECTILE.DOUBLE_CHANCE_MAX * ramp) {
      const x2 = targetX + PROJECTILE.DOUBLE_GAP_PX;
      const lead2 = leadS * 1000 + (PROJECTILE.DOUBLE_GAP_PX / this.worldSpeed) * 1000;
      if (!this.landingBlocked(x2)) this.spawnDrop(x2, lead2, now);
    }
    const idxScale = 1 / (1 + ((this.level?.index ?? 1) - 1) * ROUTE.INDEX_SPEED_STEP);
    this.tProjectile = this.nextThrowDelay() * idxScale;
  }

  // E3.11-1: 아이템 첫 등장 안내 — 종류별 노출 횟수를 기기(localStorage)에 저장, 2회까지만
  private itemHintLabel(kind: ItemKind): string | null {
    const text = ITEM_LABEL[kind];
    try {
      const key = `yarikkiri.itemHint.${kind}`;
      const n = Number(window.localStorage.getItem(key) ?? 0);
      if (n >= 2) return null;
      window.localStorage.setItem(key, String(n + 1));
      return text;
    } catch {
      return text; // 저장 불가 환경(시뮬·프라이빗 모드)은 항상 표시
    }
  }

  // 낙하 투척물 1개 생성 — 박소장 손에서 포물선으로 targetX 지면에 낙하
  private spawnDrop(targetX: number, leadMs: number, now: number) {
    const kind: ProjectileKind = pick(["papers", "tube", "megaphone"]);
    const bossX = this.bossFootX;
    const rawGy = this.groundYAt(Math.max(0, Math.min(VIEW.W - 1, bossX)));
    const bossGy = rawGy > VIEW.H ? GROUND_Y : rawGy;
    const handX = bossX + 44;
    const handY = bossGy - TARGET_CHAR_H * 0.78; // 손 높이 근사
    this.projectiles.push(
      new Projectile(kind, now, targetX, this.dropGroundY(targetX), handX, handY, leadMs)
    );
  }

  // 착지 지점(화면 x)이 낙하에 부적합한지 — 장애물 인접·구멍 위·정류장 직전.
  // lowbar는 슬라이드 강제라 낙하 회피 점프와 이중구속 → 점프 체공 거리(속도×0.75s)만큼 배제.
  private landingBlocked(targetX: number): boolean {
    if (
      this.obstacles.some((o) => {
        const r = o.kind === "lowbar" ? this.worldSpeed * 0.75 : 110;
        return Math.abs(o.box.x + o.box.w / 2 - targetX) < r;
      })
    ) {
      return true;
    }
    if (this.level) {
      const wx = this.bgScroll + targetX;
      if (wx > this.lengthPx - 220) return true; // 정류장 구간 금지
      const col = Math.floor(wx / (this.level.cellSize ?? 54));
      const g = this.profile[Math.min(this.profile.length - 1, col)];
      if (!g || g.gap) return true; // 구멍 위 낙하 금지
    }
    return false;
  }

  // 착지 지점의 지면 y (화면 밖 오른쪽도 월드 프로파일로 계산)
  private dropGroundY(targetX: number): number {
    if (!this.level) return GROUND_Y;
    const col = Math.floor((this.bgScroll + targetX) / (this.level.cellSize ?? 54));
    const g = this.profile[Math.min(this.profile.length - 1, col)];
    return g && !g.gap ? GROUND_Y - g.h * STEP_PX : GROUND_Y;
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
    // E3: 교육 모드는 HP 미감소(피격 연출·감속·추격 압박은 유지) → 실패 없이 학습
    const applyHit = (): boolean => {
      const hpBefore = this.player.hp;
      if (invincible || !this.player.hit(now)) return false;
      if (this.mode === "edu") {
        this.player.hp = hpBefore;
        this.noteEduHit(now);
      }
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

    // 투척물 피격(E3.8): 낙하 순간 그 지점에 있으면 피격 — 판정 창은 Projectile.box가 관리
    for (const p of this.projectiles) {
      if (p.dead) continue;
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
          this.say(`⚡ ${ITEM_LABEL.booster}`, now, 1400); // E3.11-1: 획득 플로팅(안내 문구 공용)
        } else if (it.kind === "magnet") {
          this.magnetUntil = now + ITEM_EFFECT.MAGNET_MS;
          this.say(`🧲 ${ITEM_LABEL.magnet}`, now, 1400);
        } else {
          // 커피/하트: 감속 없이 HP 회복. 최대면 코인으로 대체(기획 5.6).
          if (this.player.heal(ITEM_EFFECT.COFFEE_HEAL)) {
            this.say(`🪖 ${ITEM_LABEL[it.kind]}`, now, 1400);
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
      mode: this.mode,
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
      banner: this.banner,
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
    // E3.8-2: 트랙사이드 소품(drawProps) 제거 — 지면 레인의 진한 오브젝트는 전부
    // 충돌 있는 장애물이어야 함(콘·표지판은 정식 장애물로 승격, 펜스는 미사용 보관)
    this.drawStation(ctx, now); // 정류장(노선 끝)

    // E3.10-7: z순서 — 장애물·코인·아이템·낙하물은 캐릭터(박소장·김반장)보다 항상 뒤
    for (const o of this.obstacles) o.draw(ctx, now);
    for (const c of this.coins) c.draw(ctx, now);
    for (const it of this.items) it.draw(ctx, now);
    for (const f of this.fallers) f.draw(ctx, now);

    this.drawBoss(ctx, now); // 플레이어 뒤에서 추격하는 박소장

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

    this.drawDangerVignette(ctx, now); // E3.5: 위기 비네트(가장자리)
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
    ctx.fillStyle = "#a1714a" /* ground_strip 흙색 실측 */;
    ctx.fill();

    // E3.5: 노선 끝(정류장) 이후에도 지면을 이어 그림 — 검은 절벽 방지
    const endX = lv.cols * cell - this.bgScroll;
    if (endX < VIEW.W) {
      const lastG = this.profile[lv.cols - 1];
      const lastY = lastG && !lastG.gap ? GROUND_Y - lastG.h * STEP_PX : GROUND_Y;
      ctx.fillStyle = "#a1714a" /* ground_strip 흙색 실측 */;
      ctx.fillRect(endX - 1, lastY, VIEW.W - endX + 2, VIEW.H - lastY);
    }

    // 표면 스트립 — 텍스처 x를 이미지 폭으로 연속 wrap(색 밴드 이음새 제거, E3.5)
    const g0 = this.bg.groundImage;
    const drawSurface = (worldX: number, x: number, y: number) => {
      if (g0) {
        const srcX = ((worldX % g0.width) + g0.width) % g0.width;
        const remain = g0.width - srcX;
        if (remain >= cell) {
          ctx.drawImage(g0, srcX, 0, cell, g0.height, x - 1, y - 4, cell + 2, 40);
        } else {
          // 이미지 경계에 걸치면 두 조각으로 이어 그림
          const w1 = remain;
          const w2 = cell - remain;
          const dw1 = (w1 / cell) * (cell + 2);
          ctx.drawImage(g0, srcX, 0, w1, g0.height, x - 1, y - 4, dw1, 40);
          ctx.drawImage(g0, 0, 0, w2, g0.height, x - 1 + dw1, y - 4, cell + 2 - dw1, 40);
        }
      } else {
        ctx.fillStyle = "#8a6a45";
        ctx.fillRect(x - 1, y, cell + 2, 6);
      }
    };
    for (let c = sc; c < ec; c++) {
      const g = this.profile[Math.min(lv.cols - 1, c)];
      if (!g || g.gap) continue;
      drawSurface(c * cell, c * cell - this.bgScroll, GROUND_Y - g.h * STEP_PX);
    }
    // 노선 끝 이후 표면도 연속
    if (endX < VIEW.W) {
      const lastG = this.profile[lv.cols - 1];
      const lastY = lastG && !lastG.gap ? GROUND_Y - lastG.h * STEP_PX : GROUND_Y;
      for (let c = lv.cols; c * cell - this.bgScroll < VIEW.W; c++) {
        drawSurface(c * cell, c * cell - this.bgScroll, lastY);
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

    const shW = 128; // 쉼터 폭(완주 버스 연출 기준점)

    // ── 쉼터: AI 에셋(주황 B안) 우선, 미로드 시 기존 벡터 ──
    const stopImg = sprite("busstop");
    if (stopImg) {
      const dh = 195;
      const dw = dh * (stopImg.width / stopImg.height);
      ctx.drawImage(stopImg, sx - dw / 2, baseY - dh + 2, dw, dh);
      if (this.phase !== "cleared") {
        // 진행 중: 반짝임(목표 인지)
        ctx.globalAlpha = 0.5 + Math.sin(now / 200) * 0.3;
        ctx.fillStyle = "#fff";
        ctx.beginPath();
        ctx.arc(sx + dw / 2 - 14, baseY - dh + 34, 3, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 1;
      }
      this.drawStationBus(ctx, now, sx, baseY, shW);
      ctx.restore();
      return;
    }

    // ── 쉼터 구조물(벡터 폴백) ──
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
    this.drawStationBus(ctx, now, sx, baseY, shW);
    if (this.phase !== "cleared") {
      // 진행 중: 표지판 반짝임(목표 인지)
      ctx.globalAlpha = 0.5 + Math.sin(now / 200) * 0.3;
      ctx.fillStyle = "#fff";
      ctx.beginPath();
      ctx.arc(signX + 12, baseY - 148, 3, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.restore();
  }

  // 완주 시 버스 정차 연출 (쉼터 스프라이트/벡터 공용)
  private drawStationBus(
    ctx: CanvasRenderingContext2D,
    now: number,
    sx: number,
    baseY: number,
    shW: number
  ) {
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
      ctx.textAlign = "center";
      ctx.fillText("우리집行", bx - bw / 2, by + 20);
      ctx.globalAlpha = 1;
    }
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
    const footX = this.bossFootX;
    const shake = danger > 0.5 ? Math.sin(now / 40) * danger * 3 : 0;
    // 보스 발밑 지형(구멍 위면 기준 지면 유지). +3px 접지 보정(E3.5: 부유감 제거)
    const rawGy = this.groundYAt(footX);
    const bossGy = (rawGy > VIEW.H ? GROUND_Y : rawGy) + 3;

    ctx.save();

    // 클립: 투척 직후 0.6초는 throw(3프레임), 평시 run(6프레임 루프) — 투척 모션 유지(E3.8)
    const throwing = this.projectiles.find((p) => now - p.spawnedAt < 600);
    const frame = throwing
      ? clipFrame("parksojang", "throw", now - throwing.spawnedAt)
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

  // E3.5: 위기 연출 — 화면 가장자리 붉은 비네트(gap 비율 기반). 교육 모드에선 끔.
  private drawDangerVignette(ctx: CanvasRenderingContext2D, now: number) {
    if (this.mode === "edu" || this.phase !== "playing") return;
    const ratio = Math.max(0, Math.min(1, this.gap / CHASE.MAX_GAP));
    const danger = 1 - ratio;
    if (danger < 0.55) return;
    const t = (danger - 0.55) / 0.45; // 0~1
    const alpha = t * (0.28 + Math.sin(now / 160) * 0.08);
    const g = ctx.createRadialGradient(
      VIEW.W / 2,
      VIEW.H / 2,
      VIEW.H * 0.42,
      VIEW.W / 2,
      VIEW.H / 2,
      VIEW.W * 0.72
    );
    g.addColorStop(0, "rgba(255,40,30,0)");
    g.addColorStop(1, `rgba(255,40,30,${Math.max(0, alpha).toFixed(3)})`);
    ctx.save();
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, VIEW.W, VIEW.H);
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
