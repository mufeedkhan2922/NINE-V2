import { evaluateStrategyBook } from "../lib/trading/strategyEngine";
import { NINE_CONCEPTS, NINE_STRATEGIES } from "../lib/trading/strategyLibrary";
import type { Candle, MarketSnapshot } from "../lib/trading/types";
import * as assert from "./assert";

function candles(count = 180): Candle[] {
  return Array.from({ length: count }, (_, i) => {
    const base = 2400 + i * 0.35 + Math.sin(i / 6) * 4;
    return {
      time: i * 60_000,
      open: base - 0.4,
      high: base + 1.2,
      low: base - 1.1,
      close: base + 0.3,
    };
  });
}

export function runStrategyIntelligenceTest(): void {
  assert.ok(NINE_CONCEPTS.length >= 25, "NINE should contain a broad concept library");
  assert.ok(NINE_STRATEGIES.length >= 10, "NINE should contain multiple strategy families");
  const market: MarketSnapshot = {
    symbol: "XAUUSD",
    price: candles().at(-1)!.close,
    previousClose: candles().at(-2)!.close,
    changePercent: 0.1,
    candles: candles(),
    timestamp: Date.now(),
    previousDayHigh: 2410,
    previousDayLow: 2380,
  };
  const result = evaluateStrategyBook(market);
  assert.equal(result.candidates.length, 5, "strategy book should expose the top five candidates");
  assert.ok(result.candidates.every((candidate) => candidate.score >= 0 && candidate.score <= 100), "strategy scores should stay bounded");
  assert.ok(["TRENDING_UP", "TRENDING_DOWN", "RANGING", "EXPANDING", "MIXED"].includes(result.regime), "regime should be explicit");
}
