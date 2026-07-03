import type { Box } from "./types";

// 축 정렬 경계 상자(AABB) 충돌 판정
export function intersects(a: Box, b: Box): boolean {
  return (
    a.x < b.x + b.w &&
    a.x + a.w > b.x &&
    a.y < b.y + b.h &&
    a.y + a.h > b.y
  );
}

// 판정 관용도(hitbox 축소)를 적용한 충돌. 러너 게임 체감상 살짝 관대하게.
export function intersectsPadded(a: Box, b: Box, pad = 6): boolean {
  return intersects(a, {
    x: b.x + pad,
    y: b.y + pad,
    w: b.w - pad * 2,
    h: b.h - pad * 2,
  });
}
