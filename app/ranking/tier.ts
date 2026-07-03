// 랭킹 점수 → 티어 배지 매핑
export interface Tier {
  key: string;
  label: string;
  color: string;
  emoji: string;
  min: number;
}

export const TIERS: Tier[] = [
  { key: "diamond", label: "다이아 반장", color: "#5ec8ff", emoji: "💎", min: 8000 },
  { key: "platinum", label: "플래티넘 반장", color: "#8ee6d0", emoji: "🛡️", min: 5000 },
  { key: "gold", label: "골드 반장", color: "#ffcc33", emoji: "🥇", min: 3000 },
  { key: "silver", label: "실버 반장", color: "#c8d0dd", emoji: "🥈", min: 1500 },
  { key: "bronze", label: "브론즈 반장", color: "#cd8b5a", emoji: "🥉", min: 0 },
];

export function tierOf(score: number): Tier {
  return TIERS.find((t) => score >= t.min) ?? TIERS[TIERS.length - 1];
}
