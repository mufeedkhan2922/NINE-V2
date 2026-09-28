import { buildV55RegimeEngine } from "../lib/trading/regimeEngine";
import type { Candle, MarketSnapshot } from "../lib/trading/types";
import type { StrategyConsensus } from "../lib/trading/strategyEngine";

function candles(count: number, mode: "trend" | "range" = "trend"): Candle[] {
  const result: Candle[] = [];
  let price = 2500;
  for (let i = 0; i < count; i += 1) {
    const drift = mode === "trend" ? 0.9 : Math.sin(i / 2) * 0.25;
    const open = price;
    const close = price + drift;
    const high = Math.max(open, close) + 0.8;
    const low = Math.min(open, close) - 0.8;
    result.push({ time: 1_700_000_000_000 + i * 60_000, open, high, low, close, volume: 100 });
    price = close;
  }
  return result;
}

function consensus(candlesInput: Candle[]): StrategyConsensus {
  return {
    direction: "LONG",
    score: 72,
    confidence: 74,
    activeStrategies: 4,
    alignedStrategies: 2,
    regime: "TRENDING_UP",
    generatedAt: Date.now(),
    candidates: [
      { strategyId: "ema-pullback", strategyName: "EMA 9/21 Pullback", family: "TREND", direction: "LONG", score: 62, confidence: 70, matchedConcepts: ["trend", "ema-cross"], reasons: [], blockers: [] },
      { strategyId: "breakout-retest", strategyName: "Range Breakout + Retest", family: "BREAKOUT", direction: "LONG", score: 58, confidence: 65, matchedConcepts: ["range-breakout"], reasons: [], blockers: [] },
      { strategyId: "rsi-mean-reversion", strategyName: "RSI Mean Reversion", family: "MEAN_REVERSION", direction: "SHORT", score: 45, confidence: 50, matchedConcepts: ["mean-reversion"], reasons: [], blockers: [] },
    ],
  };
}

export function runRegimeEngineTest(): void {
  const trendCandles = candles(90, "trend");
  const market: MarketSnapshot = {
    symbol: "XAUUSD",
    price: trendCandles.at(-1)!.close,
    previousClose: trendCandles.at(-2)!.close,
    changePercent: 0,
    candles: trendCandles,
    timestamp: Date.now(),
    tradingAllowed: true,
  };

  const engine = buildV55RegimeEngine(market, consensus(trendCandles));
  if (engine.version !== "5.5.0") throw new Error("V5.5 version mismatch.");
  if (!engine.rankedSetups.length) throw new Error("V5.5 should rank strategy candidates.");
  if (engine.rankedSetups[0].rank !== 1) throw new Error("Top setup rank must be one.");
  if (engine.rankedSetups[0].finalScore < engine.rankedSetups.at(-1)!.finalScore) throw new Error("Setup ranking order is invalid.");
  if (engine.preferredFamilies.length === 0) throw new Error("Trend regime should expose preferred strategy families.");

  const rangeMarket: MarketSnapshot = {
    ...market,
    candles: candles(90, "range"),
    price: 2500,
  };
  const rangeEngine = buildV55RegimeEngine(rangeMarket, { ...consensus(rangeMarket.candles), regime: "RANGING" });
  if (rangeEngine.regime !== "RANGE" && rangeEngine.regime !== "TRANSITION") {
    throw new Error(`Expected balanced market classification, got ${rangeEngine.regime}.`);
  }
}
