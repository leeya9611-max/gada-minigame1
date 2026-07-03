import { SCORE } from "./config";

// 코인/점수 계산. rankScore = 이동거리 환산 + 코인 보너스.
export class ScoreKeeper {
  coins = 0;
  distance = 0; // 누적 이동 픽셀

  reset() {
    this.coins = 0;
    this.distance = 0;
  }

  addDistance(px: number) {
    this.distance += px;
  }

  addCoin(n = 1) {
    this.coins += n;
  }

  get rankScore(): number {
    return (
      Math.floor(this.distance / SCORE.DISTANCE_DIVISOR) +
      this.coins * SCORE.COIN_VALUE
    );
  }
}
