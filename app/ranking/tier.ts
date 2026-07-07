// 랭킹 점수 → 티어 배지 매핑
export interface Tier {
  key: string;
  label: string;
  color: string;
  emoji: string;
  min: number;
}

// 직급 4단계 (기획서 5.9 확정). 배열은 min 내림차순 유지.
export const TIERS: Tier[] = [
  { key: "master", label: "야리끼리 마스터", color: "#ffcc33", emoji: "👑", min: 6000 },
  { key: "banjang", label: "반장", color: "#5ec8ff", emoji: "🦺", min: 3000 },
  { key: "gigong", label: "기공", color: "#8ee6d0", emoji: "🔧", min: 1000 },
  { key: "jogong", label: "초보 조공", color: "#cd8b5a", emoji: "🧱", min: 0 },
];

export function tierOf(score: number): Tier {
  return TIERS.find((t) => score >= t.min) ?? TIERS[TIERS.length - 1];
}
