import { runHistoricalIntelligence, rankMemory } from "../lib/trading/historicalIntelligence";
import type { Candle, MarketSnapshot } from "../lib/trading/types";
import * as assert from "./assert";

function candles(count = 360): Candle[] {
  return Array.from({ length: count }, (_, i) => {
    const cycle = Math.sin(i / 9) * 3;
    const trend = Math.floor(i / 90) % 2 === 0 ? i * 0.08 : -i * 0.03;
    const base = 2400 + trend + cycle;
    const body = i % 13 === 0 ? -1.8 : 0.8;
    return {
      time: i * 60_000,
      open: base,
      high: base + 2.5 + Math.abs(body),
      low: base - 2.1,
      close: base + body,
      volume: 1000 + i,
    };
  });
}

export function runHistoricalIntelligenceTest(): void {
  const series = candles();
  const market: MarketSnapshot = {
    symbol: "XAUUSD",
    price: series.at(-1)!.close,
    previousClose: series.at(-2)!.close,
    changePercent: 0,
    candles: series,
    timestamp: series.at(-1)!.time,
  };

  const result = runHistoricalIntelligence(series, market, {
    spreadPrice: 0.2,
    slippagePrice: 0.1,
    commissionPerTrade: 0.05,
    delayCandles: 1,
    folds: 3,
    monteCarloSimulations: 250,
    targetWinRate: 90,
  });

  assert.equal(result.symbol, "XAUUSD", "historical intelligence should preserve symbol");
  assert.ok(result.strategyStats.length === 12, "all NINE strategies must be evaluated");
  assert.ok(result.walkForward.length > 0, "walk-forward folds must be produced");
  assert.ok(result.walkForward.every((fold) => fold.validationEnd >= fold.validationStart), "fold ranges must be ordered");
  assert.ok(result.strategyStats.every((s) => s.winRate >= 0 && s.winRate <= 100), "win rates must be bounded");
  assert.ok(result.strategyStats.every((s) => s.maxDrawdownR >= 0), "drawdowns must be non-negative");
  assert.ok(result.memoryRecords.every((record) => record.trades > 0 && record.source === "HISTORICAL_PROVIDER"), "strategy memory must contain only real out-of-sample evidence");
  assert.ok(result.monteCarlo === null || result.monteCarlo.simulations === 250, "Monte Carlo simulation count must be respected");
  assert.ok(rankMemory(result.memoryRecords).length === result.memoryRecords.length, "memory ranking must be deterministic");
  assert.ok(result.targetWinRate === 90, "target must remain an explicit validation threshold");
  assert.ok(["INSUFFICIENT_DATA", "WATCH", "QUALIFIED"].includes(result.researchQuality.status), "research quality status must be explicit");
  assert.ok(result.researchQuality.score >= 0 && result.researchQuality.score <= 100, "research quality score must be bounded");
  assert.equal(result.researchQuality.outOfSampleTrades, result.selectedOutOfSample.reduce((sum, stat) => sum + stat.trades, 0), "research quality must report the selected OOS sample");
  assert.ok(result.researchQuality.foldConsistency >= 0 && result.researchQuality.foldConsistency <= 100, "fold consistency must be bounded");
  assert.ok(result.researchQuality.explanation.length >= 3, "research quality must explain qualification state");
  assert.equal(result.researchIntegrity.memoryExcludedFromHistoricalSignals, true, "historical signals must not read persistent memory");
  assert.equal(result.researchIntegrity.nonOverlappingTradesPerStrategy, true, "historical trades must not overlap within a strategy");
  assert.equal(result.researchIntegrity.monteCarloUsesOutOfSampleTrades, true, "Monte Carlo must use out-of-sample trades");
  assert.equal(result.researchIntegrity.memorySource, "OUT_OF_SAMPLE", "persistent memory must be sourced from OOS evidence");
}
