import { buildStrategyLabSnapshot } from "../lib/trading/strategyLab";
import type { Candle, MarketSnapshot } from "../lib/trading/types";
import * as assert from "./assert";

function makeCandles(count = 120): Candle[] {
  return Array.from({ length: count }, (_, i) => {
    const base = 2400 + Math.sin(i / 6) * 4 + i * 0.05;
    return {
      time: i * 60_000,
      open: base,
      high: base + 2,
      low: base - 2,
      close: base + (i % 3 === 0 ? 0.8 : 0.2),
    };
  });
}

export function runStrategyLabTest(): void {
  const candles = makeCandles();
  const market: MarketSnapshot = {
    symbol: "XAUUSD",
    price: candles.at(-1)!.close,
    previousClose: candles.at(-2)!.close,
    changePercent: 0,
    candles,
    timestamp: candles.at(-1)!.time,
  };

  const result = buildStrategyLabSnapshot(market);

  assert.equal(result.symbol, "XAUUSD", "lab should preserve symbol");
  assert.ok(result.events.length >= 1, "lab should identify at least one market concept");
  assert.ok(result.setups.length > 0, "lab should evaluate the strategy book");
  assert.ok(result.lessons.length >= 10, "lab should expose the advanced curriculum");
  assert.ok(result.conceptCoverage >= 0 && result.conceptCoverage <= 100, "coverage must be bounded");
  assert.ok(result.setups.every((setup) => setup.score >= 0 && setup.score <= 100), "setup scores must be bounded");
}
