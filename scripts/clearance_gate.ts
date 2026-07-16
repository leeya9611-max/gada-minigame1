/**
 * E3.9-3 클리어런스 게이트 — 빌드 전 상시 검증 (package.json prebuild).
 * 기준: SPEED.BASE에서, 장애물 히트박스 높이+10을 넘는 체공 구간의 수평 이동 거리가
 *       히트박스 폭 + 플레이어 폭(52) + 여유 30 이상이어야 한다.
 * 물리 시뮬레이션은 런타임과 동일한 60fps 오일러 적분(하강 중력 1.3배)을 사용.
 * 1단층(puddle/stack/cone/sign)은 1단 점프, 2단층(fence)은 정점 2단 점프 기준.
 */
import {
  LOWBAR_GAP,
  OBSTACLE_RENDER,
  PHYSICS,
  PLAYER,
  SPEED,
} from "../app/game/engine/config";

const FRAME = 1 / 60;
const MARGIN = 30;

// 60fps 오일러 점프 시뮬레이션 — clearH 이상 체공한 시간(초). double=정점 2단.
function airTimeAbove(clearH: number, double: boolean): number {
  let y = 0; // 발 높이(지면 기준, 위가 +)
  let vy: number = PHYSICS.JUMP_V;
  let jumps = 1;
  let above = 0;
  for (let t = 0; t < 5; t += FRAME) {
    const g = PHYSICS.GRAVITY * (vy < 0 ? PHYSICS.FALL_GRAVITY_MULT : 1);
    vy -= g * FRAME;
    y += vy * FRAME;
    if (double && jumps === 1 && vy <= 0) {
      vy = PHYSICS.DOUBLE_JUMP_V; // 정점에서 2단
      jumps = 2;
    }
    if (y >= clearH) above += FRAME;
    if (y <= 0 && vy < 0) break;
  }
  return above;
}

const SINGLE: (keyof typeof OBSTACLE_RENDER)[] = ["puddle", "stack", "cone", "sign"];
let failed = false;
const rows: string[] = [];

for (const kind of [...SINGLE, "fence" as const]) {
  const r = OBSTACLE_RENDER[kind];
  const double = kind === "fence";
  const clearH = r.hitH + 10;
  const dist = airTimeAbove(clearH, double) * SPEED.BASE;
  const need = r.hitW + PLAYER.W + MARGIN;
  const ok = dist >= need;
  if (!ok) failed = true;
  rows.push(
    `${ok ? "PASS" : "FAIL"}  ${kind.padEnd(6)} ${double ? "2단" : "1단"}  체공(${clearH}px+) ${Math.round(dist)}px ≥ 필요 ${need}px`
  );
}

// 슬라이드층: lowbar 틈 > 슬라이드 히트박스(48)
const slideH = 48;
const lowbarOk = LOWBAR_GAP > slideH;
if (!lowbarOk) failed = true;
rows.push(`${lowbarOk ? "PASS" : "FAIL"}  lowbar 슬라이드  틈 ${LOWBAR_GAP} > 슬라이드 ${slideH}`);

console.log("── E3.9 클리어런스 게이트 ──");
for (const r of rows) console.log(r);
if (failed) {
  console.error("클리어런스 위반 — 장애물 기하 또는 점프 물리(config.ts)를 조정하세요.");
  process.exit(1);
}
console.log("클리어런스 OK");
