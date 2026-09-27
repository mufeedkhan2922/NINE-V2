import assert from "node:assert/strict";
import { NINE_VERSION } from "../lib/trading/runtime";
import { providerHealth, providerSymbol } from "../lib/trading/provider";
import { runBacktest } from "../lib/trading/backtest";
import { assessMarketAndDataState } from "../lib/trading/marketState";
import { classifyCommand } from "../lib/trading/commands";
import type { Candle, CrossTimeframeResult, DataQualityResult, MicrostructureResult, Timeframe, TimeframeData } from "../lib/trading/types";

function candles(count = 500): Candle[] {
  return Array.from({ length: count }, (_, i) => {
    const wave = Math.sin(i / 7) * 2;
    const close = 4200 + i * 0.12 + wave;
    return { time: 1_700_000_000_000 + i * 60_000, open: close - 0.2, high: close + 1.1, low: close - 1.1, close, volume: 1000 + i };
  });
}

function quality(): DataQualityResult { return { valid: true, score: 100, issues: [], warnings: [], stats: { candleCount: 100, duplicateTimestamps: 0, invalidOHLC: 0, abnormalRanges: 0, timestampGaps: 0, medianRange: 1 } }; }
function micro(): MicrostructureResult { return { valid: true, score: 100, issues: [], warnings: [], sampleSize: 100, uniqueCloseRatio: 1, uniqueHighRatio: 1, uniqueLowRatio: 1, closeMovementDiversity: 1, rangeDiversity: 1, repeatedRangeRatio: 0, repeatedLowRatio: 0, repeatedHighRatio: 0, directionalAlternationRatio: 0.5, closeRangeRatio: 1, suspiciousSignals: [] }; }
function tf(timeframe: Timeframe): TimeframeData { const data = candles(100); return { timeframe, candles: data, latestPrice: data.at(-1)!.close, previousClose: data.at(-2)!.close, changePercent: 0, updatedAt: Date.now() }; }

export function runV29Test(): void {
  assert.equal(NINE_VERSION, "3.7.0");
  const provider = providerHealth();
  assert.ok(provider.requestBudgetPerMinute >= 2, "provider request budget must be bounded");
  assert.equal(provider.rateLimited, false, "provider should not start in cooldown");
  assert.equal(providerSymbol("XAUUSD"), process.env.NINE_TWELVE_XAUUSD_SYMBOL ?? "XAU/USD");
  assert.equal(providerSymbol("NIFTY"), process.env.NINE_TWELVE_NIFTY_SYMBOL ?? "NIFTY:NSE");
  assert.equal(providerSymbol("BANKNIFTY"), process.env.NINE_TWELVE_BANKNIFTY_SYMBOL ?? "NIFTY BANK:NSE");

  const result = runBacktest(candles(), 10000, 0.5);
  assert.equal(result.finalBalance, result.initialBalance + result.netPnl, "backtest balance must reconcile");
  assert.equal(result.totalTrades, result.trades.length, "backtest trade count must match trade ledger");
  assert.ok(Array.isArray(result.trades), "backtest must return a trade ledger");

  assert.equal(classifyCommand("Paper trade XAUUSD"), "OPEN_PAPER");
  assert.equal(classifyCommand("analyze current setup"), "ANALYZE");
  assert.equal(classifyCommand("close all positions"), "CLOSE_ALL");

  const timeframes: Partial<Record<Timeframe, TimeframeData>> = {
    "1min": tf("1min"), "5min": tf("5min"), "15min": tf("15min"), "1h": tf("1h"), "4h": tf("4h"), "1day": tf("1day"),
  };
  const cross: CrossTimeframeResult = { valid: true, score: 100, issues: [], warnings: [], repeatedPriceRatio: 0, compressionRatio: 1, latestPriceDeviationPercent: 0, aggregationChecks: { oneMinuteToFiveMinute: true, fiveMinuteToFifteenMinute: true, oneHourToFourHour: true }, staleFeed: false, providerAnomaly: false };
  const assessment = assessMarketAndDataState("XAUUSD", timeframes, { "1min": quality(), "5min": quality(), "15min": quality(), "1h": quality(), "4h": quality(), "1day": quality() }, cross, micro(), Date.parse("2026-09-27T12:00:00Z"));
  assert.equal(assessment.marketState, "CLOSED", "weekend XAUUSD must be reported closed");
  assert.equal(assessment.tradingPermission, "BLOCKED", "closed market must block execution");
}
