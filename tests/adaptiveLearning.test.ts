import { buildAdaptiveLearningSnapshot } from "../lib/trading/adaptiveLearning";
import type { Candle, MarketSnapshot } from "../lib/trading/types";
import * as assert from "./assert";

function candles(count = 220): Candle[] {
  return Array.from({ length: count }, (_, i) => {
    const base = 2400 + i * 0.15 + Math.sin(i / 8) * 5;
    const direction = i % 17 === 0 ? -2 : 0.4;
    return {
      time: i * 60_000,
      open: base,
      high: base + 2.2 + direction,
      low: base - 1.8,
      close: base + 0.5 + direction,
    };
  });
}

export function runAdaptiveLearningTest(): void {
  const series = candles();
  const market: MarketSnapshot = {
    symbol: "XAUUSD",
    price: series.at(-1)!.close,
    previousClose: series.at(-2)!.close,
    changePercent: 0.1,
    candles: series,
    timestamp: series.at(-1)!.time,
  };

  const result = buildAdaptiveLearningSnapshot(market, {
    warmupCandles: 80,
    evaluationHorizon: 8,
    minimumTrades: 5,
    minimumScore: 50,
  });

  assert.equal(result.symbol, "XAUUSD", "learning snapshot should preserve symbol");
  assert.equal(result.outOfSample, true, "walk-forward snapshot should be out-of-sample");
  assert.ok(result.evaluatedCandles === series.length, "learning should report evaluated candle count");
  assert.ok(result.strategies.every((item) => item.winRate >= 0 && item.winRate <= 100), "win rates must be bounded");
  assert.ok(result.strategies.every((item) => item.robustnessScore >= 0 && item.robustnessScore <= 100), "robustness scores must be bounded");
}
