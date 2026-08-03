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
  SCORE,
  SPAWN,
  SPEED,
  VIEW,
  themeForRound,
} from "./config";
import { Background, type MapKey } from "./Background";
import { intersects, intersectsPadded } from "./collision";
import { CHARS, TARGET_CHAR_H, charScale, clipFrame, drawChar, drawCharGold, drawSprite, sprite, spriteAspect } from "./sprites";
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
import { playSfx } from "../../../lib/sfx"; // E7: 효과음(상대 경로 — .simtest 컴파일 호환)
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
// E3.33: 게이지용 라운드 사각형 패스
function roundRectPath(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
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
  private clearedAt = 0; // E3.14: 완주 시각 — 버스 도착 연출 타임라인 기준
  // E3.6-2/3 게임필
  private caughtAt = 0; // 엔들리스 잡힘 연출 시작(0.6s 후 게임오버)
  private eduGrabCount = 0; // 교육 봐주기 횟수(GRAB_MERCY 소진 후엔 진짜 잡힘)
  private eduBeatUntil = 0; // 봐주기 반응 비트(슬로우·휘청·플래시)
  private bossSwipeUntil = 0; // 박소장 팔 뻗기(헛손질) 모션
  private hitStopUntil = 0; // 히트스톱(50ms 월드 정지)
  private shakeUntil = 0; // 피격 화면 셰이크(200ms)
  private punchInUntil = 0; // 부스터 파괴 펀치인(100ms)
  private flashUntil = 0; // 섬광(파괴·봐주기 공용)
  private flashAlpha = 0.35; // 섬광 강도 — 파괴 0.35 / 봐주기 0.15
  private floaters: { x: number; y: number; born: number; text: string }[] = [];
  private debris: { x: number; y: number; vx: number; vy: number; rot: number; vr: number; color: string; born: number }[] = [];
  private poseHistory: { file: string; footX: number; footY: number; hOverride?: number; t: number }[] = [];

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
    this.clearedAt = 0;
    this.caughtAt = 0;
    this.eduGrabCount = 0;
    this.eduBeatUntil = 0;
    this.bossSwipeUntil = 0;
    this.hitStopUntil = 0;
    this.shakeUntil = 0;
    this.punchInUntil = 0;
    this.flashUntil = 0;
    this.floaters = [];
    this.debris = [];
    this.poseHistory = [];
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
    // E8-8: reset()은 phase를 건드리지 않는다 — cleared/gameover 화면에서 바로 진입 시
    // 이전 phase가 남아 onTap()이 무시되던 버그(이수 직후 "무한 잔업 모드 가기" 멈춤)
    this.phase = "ready";
    this.pushHud();
  }

  // E1: 엔들리스 "무한 잔업 모드" — 레벨 없이 절차 스폰으로 무한 진행(랭킹 본선).
  // 완주·피날레 없음, 속도는 BASE→ACCEL 램프(MAX 상한), gap·HP 실패는 동일.
  // E5: round(1~4) 전달 시 주차별 배경 팔레트 적용(로드 시 1회 굽기 — 프레임 비용 없음).
  setEndless(mapKey: MapKey = "map1", round?: number) {
    this.mode = "endless";
    this.level = null;
    this.profile = [];
    this.lengthPx = 0;
    this.bg = new Background(mapKey, round ? themeForRound(round) : undefined);
    this.reset();
    this.phase = "ready"; // E8-8: setLevel과 동일 — 직전 화면 phase 잔존 방지
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
      // E8-1: 렌더 시간 계측 — __ykPerf 플래그 켜졌을 때만(평시 boolean 체크 1회)
      const perf = typeof window !== "undefined" && (window as unknown as { __ykPerf?: boolean }).__ykPerf;
      if (perf) {
        const t0 = performance.now();
        this.render(ts);
        const w = window as unknown as { __ykRender?: { ms: number; frames: number } };
        const acc = (w.__ykRender ??= { ms: 0, frames: 0 });
        acc.ms += performance.now() - t0;
        acc.frames++;
      } else {
        this.render(ts);
      }
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
    // E3.6 게임필 타임스탬프들
    if (this.caughtAt) this.caughtAt += delta;
    if (this.clearedAt) this.clearedAt += delta;
    this.hitStopUntil += delta;
    this.shakeUntil += delta;
    this.punchInUntil += delta;
    this.flashUntil += delta;
    this.bossSwipeUntil += delta;
    this.eduBeatUntil += delta;
    for (const f of this.floaters) f.born += delta;
    for (const d of this.debris) d.born += delta;
    for (const h of this.poseHistory) h.t += delta;
    this.lastTs = performance.now();
  }

  // 포기: 엔들리스는 현재 기록으로 정상 종료(결과 전달). 교육·노선은 호출부가 로비 복귀 처리.
  giveUp() {
    if (this.phase !== "playing") return;
    this.pausedAt = 0;
    this.gameOver(performance.now(), "giveup");
  }

  private update(dt: number, now: number) {
    // E3.6-3: 히트스톱 — 50ms 월드 정지(피격 임팩트)
    if (now < this.hitStopUntil) return;
    // E3.6-2: 잡힘 연출 — 0.6s 동결·줌 + 0.35s 홀드(가독 시간) 후 게임오버
    if (this.caughtAt) {
      if (now - this.caughtAt >= 950) this.gameOver(now, "caught");
      return;
    }
    this.elapsed = (now - this.startedAt) / 1000;

    // 속도: 노선 baseSpeed + 시간 램프(speedRamp), 감속 디버프 반영
    const slowed = now < this.slowUntil;
    const base = this.level?.baseSpeed ?? SPEED.BASE;
    const ramp = this.level?.speedRamp ?? SPEED.ACCEL;
    let target = Math.min(SPEED.MAX, base + this.elapsed * ramp);
    if (now < this.eduSlowUntil) target *= EDU.SLOW_FACTOR; // E3: 신규 요소 안내 감속
    if (now < this.eduBeatUntil) {
      // E3.6-2 보강: 접촉 순간 거의 정지 → 제곱 곡선으로 재가속("붙잡힐 뻔" 강조 + 튕겨나가는 체감)
      const q = 1 - (this.eduBeatUntil - now) / EDU.GRAB_BEAT_MS; // 0(접촉)→1(복귀)
      target *= EDU.GRAB_BEAT_FLOOR + (1 - EDU.GRAB_BEAT_FLOOR) * q * q;
    }
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

    // E3.6-3: 파편 물리·플로터 수명
    for (const d of this.debris) {
      d.vy += 1900 * dt;
      d.x += (d.vx - this.worldSpeed) * dt;
      d.y += d.vy * dt;
      d.rot += d.vr * dt;
    }
    this.debris = this.debris.filter((d) => now - d.born < 600);
    this.floaters = this.floaters.filter((f) => now - f.born < 650);

    // E3.6-2 보강: 봐주기 비트 중 김반장 반동(시각 오프셋 — 히트박스 불변)
    if (now < this.eduBeatUntil) {
      const q = 1 - (this.eduBeatUntil - now) / EDU.GRAB_BEAT_MS;
      this.player.visualOffsetX = -14 * (1 - q); // 어깨 잡힌 반동 → 복귀가 "앞으로 튕겨나감"
    } else {
      this.player.visualOffsetX = 0;
    }

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

    // E3.6-2 수정: 교육은 "봐주되 계속 부딪히면 진짜 잡힘".
    // 최소치 도달 시 GRAB_MERCY(2)회까지 봐주기 — 짧은 비트(슬로우모션+휘청+플래시)
    // + 팔 뻗기 + 대사 + gap 회복. 봐주기 소진 후엔 클램프를 풀어 gap 0 → 잡힘 연출 → 교육 실패.
    if (this.mode === "edu") {
      if (this.gap <= EDU.MIN_GAP && this.eduGrabCount < EDU.GRAB_MERCY) {
        this.eduGrabCount++;
        this.bossSwipeUntil = now + 380; // 손을 빨리 거둬 "헛침"으로 읽히게
        this.eduBeatUntil = now + EDU.GRAB_BEAT_MS;
        this.flashUntil = now + 90; // 옅은 흰 플래시 1회(실패 연출보다 약하게)
        this.flashAlpha = 0.15;
        this.player.invulnUntil = Math.max(this.player.invulnUntil, now + 600); // 휘청(hurt 포즈)
        this.say(
          this.eduGrabCount === 1
            ? "박소장: 교육 중이니 봐준다... 본게임엔 어림없어!"
            : "박소장: 다음엔 진짜 잡는다!!",
          now,
          2600
        );
        this.gap = EDU.MIN_GAP + EDU.GRAB_RECOVER;
      }
      if (this.eduGrabCount < EDU.GRAB_MERCY) {
        this.gap = Math.max(this.gap, EDU.MIN_GAP);
      }
    }

    // 완주: 정류장(노선 끝) 도착 = 퇴근 성공
    if (this.level && this.playerWorldX >= this.lengthPx - 10) {
      this.finish(now);
      return;
    }

    // 실패 조건 병존: gap 0(붙잡힘) 우선, HP 0 차선.
    // 마지막 피격에서 hp와 gap이 같은 프레임에 동시 소진되는 경우가 흔한데,
    // hp를 먼저 보면 잡힘 연출이 영영 묻힌다(실측: 유저 플레이 대부분이 이 케이스).
    if (this.gap <= 0) {
      this.caughtAt = now;
      playSfx("caught"); // E7
      this.say("박소장: 잡았다!!", now, 999999);
    } else if (this.player.hp <= 0) {
      this.gameOver(now, "hp");
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
      // E3.16-1: 4종 가중치 풀 — coffee 30 / heart 20 / booster 30 / magnet 20
      const ir = Math.random();
      const kind: ItemKind =
        ir < 0.3 ? "coffee" : ir < 0.5 ? "heart" : ir < 0.8 ? "booster" : "magnet";
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
    playSfx("throw_warn"); // E7: 낙하 마커 표시와 동시 경고음
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
      playSfx("hit"); // E7
      this.slowUntil = now + SPEED.SLOW_MS;
      this.gap -= CHASE.HIT_LOSS; // 피격 시 박소장이 확 접근
      this.shakeUntil = now + 200; // E3.6-3: 화면 셰이크 4px·0.2s
      this.hitStopUntil = now + 50; // E3.6-3: 히트스톱 0.05s
      this.say(this.pickLine(DIALOGUE.hit), now);
      return true;
    };

    // 지상/공중 장애물. 슬라이드 중이면 낮은 통과형(lowbar) 통과.
    for (const o of this.obstacles) {
      if (o.dead) continue;
      if (o.kind === "lowbar" && this.player.sliding) continue;
      if (intersectsPadded(pbox, o.box)) {
        // E3.6-3d: 부스터 무적 중엔 조용한 통과 대신 "박살" — 파편·펀치인·섬광
        if (invincible) this.smashObstacle(o, now);
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

    // 코인 획득 — E3.6-3: 위로 튀며 페이드 + 점수 플로터
    for (const c of this.coins) {
      if (c.dead || c.collected) continue;
      if (intersects(pbox, c.box)) {
        this.score.addCoin();
        playSfx("coin"); // E7
        c.pop(now);
        this.floaters.push({ x: c.x, y: c.y - 18, born: now, text: `+${SCORE.COIN_VALUE}` });
      }
    }

    // 특수 아이템
    for (const it of this.items) {
      if (it.dead) continue;
      if (intersects(pbox, it.box)) {
        if (it.kind === "booster") {
          playSfx("booster"); // E7
          this.boosterUntil = now + ITEM_EFFECT.BOOSTER_MS;
          this.say(`⚡ ${ITEM_LABEL.booster}`, now, 1400); // E3.11-1: 획득 플로팅(안내 문구 공용)
        } else if (it.kind === "magnet") {
          playSfx("item_get"); // E7
          this.magnetUntil = now + ITEM_EFFECT.MAGNET_MS;
          this.say(`🧲 ${ITEM_LABEL.magnet}`, now, 1400);
        } else {
          // 커피/하트: 감속 없이 HP 회복. 최대면 코인으로 대체(기획 5.6).
          playSfx("item_get"); // E7
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

  private dialogueMs = DIALOGUE_MS; // E6-QA: 말풍선 페이드 계산용(표시 지속시간)

  private say(text: string, now: number, ms: number = DIALOGUE_MS) {
    this.dialogue = text;
    this.lastDialogue = text;
    this.dialogueUntil = now + ms;
    this.dialogueMs = ms;
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
    playSfx("clear"); // E7
    this.clearedAt = now; // E3.14: 버스 슬라이드 인 시작점
    this.say("김반장: 퇴근이다아아!! 🚌", now, 999999);
    this.pushHud();
    this.cb.onGameOver(this.buildResult(now, "cleared"));
  }

  private gameOver(now: number, outcome: Outcome) {
    this.phase = "gameover";
    if (outcome !== "caught") playSfx("gameover"); // E7: 잡힘은 caught 사운드가 이미 재생됨
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

    // E3.6-3: 화면 셰이크(피격) + 펀치인(부스터 파괴) + 잡힘 줌 — 월드 전체 트랜스폼
    ctx.save();
    if (now < this.shakeUntil) {
      ctx.translate(Math.sin(now / 13) * 4, Math.cos(now / 17) * 4);
    }
    if (now < this.punchInUntil) {
      const q = 1 - (this.punchInUntil - now) / 100; // 0→1
      const z = 1.02 - 0.02 * q;
      ctx.translate(VIEW.W / 2, VIEW.H / 2);
      ctx.scale(z, z);
      ctx.translate(-VIEW.W / 2, -VIEW.H / 2);
    }
    if (this.caughtAt) {
      const q = Math.min(1, (now - this.caughtAt) / 200);
      const z = 1 + 0.16 * q;
      const px = PLAYER.X + PLAYER.W / 2;
      const py = GROUND_Y - PLAYER.H / 2;
      ctx.translate(px, py);
      ctx.scale(z, z);
      ctx.translate(-px, -py);
    }
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

    const caughtComposite = !!this.caughtAt && !!sprite("caught"); // E3.6-4: 합성 컷 사용 시 개별 캐릭터 숨김
    if (!caughtComposite) this.drawBoss(ctx, now); // 플레이어 뒤에서 추격하는 박소장

    // E3.6-3 부스터 연출 a) 골드 모션 트레일(잔상 3장, 40~60ms 간격) — 기존 오라 대체
    const boosting = now < this.boosterUntil && this.phase === "playing";
    // E3.33-5: 종료 1초 전부터 트레일·스피드라인·광채가 잦아들며 게이지와 이중 신호
    const boostFade = boosting ? Math.min(1, (this.boosterUntil - now) / 1000) : 0;
    if (boosting) {
      const offs = [144, 96, 48]; // ms 과거
      const alphas = [0.08, 0.15, 0.25];
      for (let i = 0; i < offs.length; i++) {
        const snap = this.poseHistory.find((h) => now - h.t >= offs[i]);
        if (!snap) continue;
        ctx.save();
        ctx.globalAlpha = alphas[i] * boostFade;
        drawCharGold(ctx, "gimbanjang", snap.file, snap.footX - (offs[i] / 1000) * this.worldSpeed * 0.4, snap.footY, snap.hOverride);
        ctx.restore();
      }
      // b) 스피드 라인 — 캐릭터 뒤로 스쳐 지나가는 수평선
      ctx.save();
      ctx.strokeStyle = "#ffe9a8";
      ctx.lineWidth = 2.5;
      for (let i = 0; i < 5; i++) {
        const ph = ((now / 110 + i * 0.73) % 1 + 1) % 1;
        const y = this.player.y + 8 + ((i * 37) % Math.max(20, PLAYER.H - 10));
        ctx.globalAlpha = (1 - ph) * 0.55 * boostFade;
        const x = this.player.x - 6 - ph * 150;
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x - (26 + 14 * ((i * 53) % 3)), y);
        ctx.stroke();
      }
      ctx.restore();
    }

    if (!caughtComposite) this.player.draw(ctx, now);

    // c) 캐릭터 금색 광채 — 실루엣 위 골드 오버레이 펄스
    if (boosting && this.player.lastPose) {
      const lp = this.player.lastPose;
      ctx.save();
      ctx.globalAlpha = (0.22 + Math.sin(now / 110) * 0.08) * boostFade;
      drawCharGold(ctx, "gimbanjang", lp.file, lp.footX, lp.footY, lp.hOverride);
      ctx.restore();
    }

    // d) 파괴 파편 + 코인 점수 플로터
    for (const d of this.debris) {
      const q = Math.min(1, (now - d.born) / 600);
      ctx.save();
      ctx.globalAlpha = 1 - q;
      ctx.translate(d.x, d.y);
      ctx.rotate(d.rot);
      ctx.fillStyle = d.color;
      ctx.fillRect(-7, -5, 14, 10);
      ctx.strokeStyle = "rgba(31,42,68,0.6)";
      ctx.lineWidth = 1.5;
      ctx.strokeRect(-7, -5, 14, 10);
      ctx.restore();
    }
    for (const f of this.floaters) {
      const q = Math.min(1, (now - f.born) / 650);
      ctx.save();
      ctx.globalAlpha = 1 - q;
      ctx.fillStyle = "#ffd23f";
      ctx.font = "bold 15px sans-serif";
      ctx.textAlign = "center";
      ctx.strokeStyle = "rgba(31,42,68,0.7)";
      ctx.lineWidth = 3;
      ctx.strokeText(f.text, f.x, f.y - q * 30);
      ctx.fillText(f.text, f.x, f.y - q * 30);
      ctx.restore();
    }

    for (const p of this.projectiles) p.draw(ctx, now);

    // E6-QA: 대사 말풍선 — 상단 안내 배너(DOM)와 겹치던 중앙 고정 표시를 화자 머리 위로 이동
    this.drawDialogue(ctx, now);

    // E3.33: 부스터·자석 남은 시간 게이지(좌상단 HP 아래) — DOM 배지(⚡/🧲) 대체
    this.drawEffectGauges(ctx, now);

    this.drawDangerVignette(ctx, now); // E3.5: 위기 비네트(가장자리)

    // E3.6-2/4: 잡힘 연출 — 전용 합성 컷(박소장이 김반장을 붙잡은 한 장) + "붙잡혔다!" 텍스트.
    // 타이밍·줌·텍스트 로직은 기존 그대로, 렌더만 교체(미로드 시 기존 개별 겹침 폴백).
    if (this.caughtAt) {
      const comp = sprite("caught");
      if (comp) {
        const q = Math.min(1, (now - this.caughtAt) / 150); // 과도한 튐 없이 페이드인
        const dh = TARGET_CHAR_H * 1.3;
        const dw = dh * spriteAspect("caught");
        // 정지 시점 두 캐릭터(박소장·김반장) 좌표 중심
        const cx = (this.bossFootX + PLAYER.X + PLAYER.W / 2) / 2;
        const gy = this.player.floorY;
        ctx.save();
        ctx.globalAlpha = q;
        drawSprite(ctx, "caught", cx - dw / 2, gy - dh, dw, dh);
        ctx.restore();
      } else {
        const grabFrame = clipFrame("parksojang", "grab", 0) ?? clipFrame("parksojang", "throw", 160);
        if (grabFrame) {
          drawChar(ctx, "parksojang", grabFrame, PLAYER.X + PLAYER.W / 2 - 34, GROUND_Y);
        }
      }
      // 딤은 줌 안에서(장면 어둡게), 홀드 구간(600ms~)엔 결과 전환 쿠션으로 더 어둡게
      const held = Math.max(0, now - this.caughtAt - 600) / 350;
      ctx.save();
      ctx.fillStyle = `rgba(14,21,38,${0.35 + 0.25 * Math.min(1, held)})`;
      ctx.fillRect(0, 0, VIEW.W, VIEW.H);
      ctx.restore();
    }

    ctx.restore(); // 셰이크·펀치인·잡힘 줌 트랜스폼 종료

    // E3.6-4 수정: "붙잡혔다!" 텍스트는 줌 트랜스폼 밖(스크린 공간) — 펀치인 후 즉시 선명 고정.
    // (줌 안에서 그리면 스케일 보간으로 블러·잔상이 낌)
    if (this.caughtAt) {
      const t = now - this.caughtAt;
      const appear = Math.min(1, t / 150);
      const punch = 1.35 - 0.35 * (1 - Math.pow(1 - appear, 3)); // 1.35 → 1.0 펀치인
      ctx.save();
      ctx.globalAlpha = Math.min(1, t / 100);
      ctx.translate(VIEW.W / 2, VIEW.H / 2 - 60);
      ctx.scale(punch, punch);
      ctx.fillStyle = "#ff5147";
      ctx.font = "bold 46px sans-serif";
      ctx.textAlign = "center";
      ctx.strokeStyle = "#fff";
      ctx.lineWidth = 8;
      ctx.strokeText("붙잡혔다!", 0, 0);
      ctx.fillText("붙잡혔다!", 0, 0);
      ctx.restore();
    }

    // E3.6-3d: 파괴 섬광(트랜스폼 밖 — 전체 화면)
    if (now < this.flashUntil) {
      ctx.save();
      ctx.globalAlpha = Math.min(1, (this.flashUntil - now) / 60) * this.flashAlpha;
      ctx.fillStyle = "#fff";
      ctx.fillRect(0, 0, VIEW.W, VIEW.H);
      ctx.restore();
    }

    // 부스터 트레일용 포즈 히스토리(최근 200ms)
    if (this.player.lastPose && this.phase === "playing") {
      this.poseHistory.unshift({ ...this.player.lastPose, t: now });
      if (this.poseHistory.length > 16) this.poseHistory.pop();
    }
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

  // E3.6-3d: 부스터 파괴 — 장애물을 파편 5조각으로 튕겨 날림 + 펀치인 + 섬광
  private smashObstacle(o: Obstacle, now: number) {
    const COLORS: Record<string, string> = {
      puddle: "#9aa3ad", stack: "#b06a3f", cone: "#f07c2e",
      sign: "#ffd23f", fence: "#e0862e", lowbar: "#c98736", airbar: "#8894a6",
    };
    const color = COLORS[o.kind] ?? "#8894a6";
    const b = o.box;
    const cx = b.x + b.w / 2;
    const cy = Math.min(b.y + b.h / 2, o.baseY - 30);
    const n = 5;
    for (let i = 0; i < n; i++) {
      const ang = -Math.PI * 0.15 - (Math.PI * 0.7 * i) / (n - 1); // 위쪽 부채꼴
      const sp = 260 + Math.random() * 220;
      this.debris.push({
        x: cx, y: cy,
        vx: Math.cos(ang) * sp + 120, // 진행 방향으로 밀려남
        vy: Math.sin(ang) * sp,
        rot: Math.random() * Math.PI, vr: (Math.random() - 0.5) * 14,
        color, born: now,
      });
    }
    this.punchInUntil = now + 100;
    this.flashUntil = now + 60;
    this.flashAlpha = 0.35;
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

  // E3.14: 완주 버스 도착 연출 — 화면 오른쪽 밖에서 ease-out 슬라이드 인(0.7s) 후
  // 정류장 옆(오른쪽)에 정차, 0.3s 정지 유지(문 열림 타이밍) → 클리어 오버레이와 겹쳐 재생.
  private drawStationBus(
    ctx: CanvasRenderingContext2D,
    now: number,
    sx: number,
    baseY: number,
    shW: number
  ) {
    if (this.phase !== "cleared") return;
    const t = Math.min(1, (now - this.clearedAt) / 700);
    const ease = 1 - Math.pow(1 - t, 3); // ease-out cubic
    const busImg = sprite("bus");
    const bh = 118;
    const bw = busImg ? bh * spriteAspect("bus") : 190;
    const targetCx = sx + shW / 2 + bw / 2 + 36; // 정류장 오른쪽 옆
    const startCx = VIEW.W + bw / 2 + 40;
    const cx = startCx + (targetCx - startCx) * ease;

    if (busImg) {
      // 정차 후 미세 서스펜션 바운스(문 열림 여백 0.3s)
      const settle = t >= 1 ? Math.sin(Math.min(300, now - this.clearedAt - 700) / 48) * 1.5 : 0;
      drawSprite(ctx, "bus", cx - bw / 2, baseY - bh + settle, bw, bh);
      return;
    }

    // 벡터 폴백(구 디자인) — 동일 타임라인으로 슬라이드 인
    const bx = cx + bw / 2; // 버스 앞머리 x
    const bh2 = 86;
    const by = baseY - bh2 - 6;
    ctx.save();
    ctx.fillStyle = "#2E66F6";
    this.roundRectPath(ctx, bx - bw, by, bw, bh2, 12);
    ctx.fill();
    ctx.fillStyle = "#1f2a44";
    ctx.fillRect(bx - bw, by + bh2 - 18, bw, 12);
    ctx.fillStyle = "#ffd23f";
    ctx.fillRect(bx - bw, by + 26, bw, 10);
    ctx.fillStyle = "rgba(190, 225, 250, 0.9)";
    for (let i = 0; i < 3; i++) ctx.fillRect(bx - bw + 14 + i * 44, by + 8, 34, 16);
    ctx.fillStyle = "#cdd8ec";
    ctx.fillRect(bx - 44, by + 8, 30, bh2 - 28);
    ctx.strokeStyle = "#1f2a44";
    ctx.lineWidth = 2;
    ctx.strokeRect(bx - 44, by + 8, 30, bh2 - 28);
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
  // E3.33: 효과 지속시간 게이지 — 좌상단 HP 행 아래, 세로 스택. 남은 1.5s부터 경고색+깜빡임
  // (마지막 0.5s는 더 빠르게). hud로 흘리지 않고 draw에서 직접 계산(프레임 비용 최소).
  private drawEffectGauges(ctx: CanvasRenderingContext2D, now: number) {
    if (this.caughtAt || this.phase !== "playing") return;
    const items: { icon: string; until: number; total: number; color: string }[] = [];
    if (now < this.boosterUntil)
      items.push({ icon: "⚡", until: this.boosterUntil, total: ITEM_EFFECT.BOOSTER_MS, color: "#ff9500" });
    if (now < this.magnetUntil)
      items.push({ icon: "🧲", until: this.magnetUntil, total: ITEM_EFFECT.MAGNET_MS, color: "#5ec8ff" });
    if (!items.length) return;

    // 좌상단 HP 패널(≈12~56) + 감속 배지 행 아래 — 배너(top 13%≈58, 중앙)·말풍선(y≥168)과 비겹침
    let y = 92;
    for (const it of items) {
      const remain = it.until - now;
      const frac = Math.max(0, Math.min(1, remain / it.total));
      const warning = remain <= 1500;
      const blinkPeriod = remain <= 500 ? 120 : 250;
      const blink = warning ? (Math.floor(now / blinkPeriod) % 2 === 0 ? 1 : 0.35) : 1;
      const barX = 36;
      const barW = 96;
      const barH = 10;

      ctx.save();
      // 아이콘
      ctx.font = "14px sans-serif";
      ctx.textAlign = "left";
      ctx.textBaseline = "middle";
      ctx.globalAlpha = 0.95;
      ctx.fillText(it.icon, 14, y + barH / 2 + 1);
      // 트랙
      ctx.fillStyle = "rgba(0,0,0,0.45)";
      roundRectPath(ctx, barX, y, barW, barH, 5);
      ctx.fill();
      // 채움(경고 시 색 전환 + 깜빡임)
      ctx.globalAlpha = 0.95 * blink;
      ctx.fillStyle = warning ? "#ff5a3c" : it.color;
      if (frac > 0) {
        roundRectPath(ctx, barX, y, Math.max(barH, barW * frac), barH, 5);
        ctx.fill();
      }
      // 남은 초(보조)
      ctx.globalAlpha = 0.95;
      ctx.font = "bold 11px sans-serif";
      ctx.fillStyle = warning ? "#ffb3a0" : "#fff";
      ctx.strokeStyle = "rgba(31,42,68,0.8)";
      ctx.lineWidth = 2.5;
      const label = (remain / 1000).toFixed(1);
      ctx.strokeText(label, barX + barW + 7, y + barH / 2 + 1);
      ctx.fillText(label, barX + barW + 7, y + barH / 2 + 1);
      ctx.restore();
      y += 18;
    }
  }

  // E6-QA: 화자(박소장/김반장) 머리 위 말풍선 — "이름:" 프리픽스로 화자 판별, 프리픽스는 떼고 표시.
  // 잡힘 연출 중엔 숨김(합성 컷·펀치인과 충돌 방지).
  private drawDialogue(ctx: CanvasRenderingContext2D, now: number) {
    if (!this.dialogue || this.caughtAt) return;
    const m = this.dialogue.match(/^(박소장|김반장):\s*/);
    const speaker = m?.[1] ?? "김반장";
    const text = m ? this.dialogue.slice(m[0].length) : this.dialogue;

    // 앵커: 화자 머리 위 (박소장은 지형·grab 오프셋 반영된 발 기준, 김반장은 점프 높이 반영)
    let ax: number;
    let bottom: number;
    if (speaker === "박소장") {
      ax = this.bossFootX;
      const rawGy = this.groundYAt(ax);
      const gy = rawGy > VIEW.H ? GROUND_Y : rawGy;
      bottom = gy - TARGET_CHAR_H - 10;
    } else {
      ax = PLAYER.X + PLAYER.W / 2;
      // 시각 키(126px)가 히트박스(96px)보다 커서 머리 위 여유 30px 추가
      bottom = this.player.y - (TARGET_CHAR_H - PLAYER.H) - 10;
    }

    // 페이드 인(120ms 팝) / 아웃(마지막 200ms)
    const remain = this.dialogueUntil - now;
    const born = this.dialogueUntil - (this.dialogueMs || DIALOGUE_MS);
    const fadeIn = Math.min(1, (now - born) / 120);
    const alpha = Math.min(fadeIn, Math.max(0, Math.min(1, remain / 200)));
    if (alpha <= 0) return;

    ctx.save();
    ctx.globalAlpha = alpha;
    // E6-QA2: 확대 — 13px/27h가 눌려 보인다는 피드백 반영
    ctx.font = "bold 16px sans-serif";
    const tw = ctx.measureText(text).width;
    const w = tw + 32;
    const h = 36;
    const r = 17;
    // 말풍선이 화면 밖으로 안 나가게 클램프(꼬리는 화자 위치 유지)
    const cx = Math.max(6 + w / 2, Math.min(VIEW.W - 6 - w / 2, ax));
    const x = cx - w / 2;
    const y = Math.max(6, bottom - h);

    ctx.fillStyle = "rgba(31,42,68,0.92)";
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
    ctx.fill();
    // 꼬리(화자 방향)
    const tx = Math.max(x + 18, Math.min(x + w - 18, ax));
    ctx.beginPath();
    ctx.moveTo(tx - 9, y + h - 1);
    ctx.lineTo(tx + 9, y + h - 1);
    ctx.lineTo(tx, y + h + 10);
    ctx.closePath();
    ctx.fill();

    ctx.fillStyle = "#fff";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(text, cx, y + h / 2 + 1);
    ctx.restore();
  }

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
    // E3.6-4: 근접·위험 신호 — 전용 팔 뻗기 포즈(grab_reach). 교육 봐주기 + 엔들리스 gap 임박 공용.
    const reaching =
      now < this.bossSwipeUntil ||
      (this.mode !== "edu" && this.phase === "playing" && this.gap < 70);
    const frame = throwing
      ? clipFrame("parksojang", "throw", now - throwing.spawnedAt)
      : reaching
        ? clipFrame("parksojang", "grab", 0)
        : clipFrame("parksojang", "run", now);
    // grab_reach는 손이 얼굴 높이로 그려짐 → 김반장 어깨 높이(히트박스 상단 부근) 정렬 보정.
    // E3.6-4 수정: 근접 회피는 "닿기 직전" — 손끝과 어깨 사이 간격을 남기고(x -26)
    // 실제 잡힘(caught 합성 컷)만 완전 밀착으로 차별화.
    const grabYOff = frame === "grab_reach.webp" ? 10 : 0;
    const grabXOff = frame === "grab_reach.webp" ? -26 : 0;
    const drawn = frame
      ? drawChar(ctx, "parksojang", frame, footX + shake + grabXOff, bossGy + grabYOff)
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
