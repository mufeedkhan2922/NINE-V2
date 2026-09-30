import { replayRejectedTrades, replayRejectedSetup, counterfactualReplaySummary, getCounterfactualPreventionDecision, getRejectionQualityDecision } from "../lib/trading/counterfactualReplay";
import type { BacktestTrade } from "../lib/trading/backtest";
import type { Candle } from "../lib/trading/types";

export function runCounterfactualReplayTest(): void {
  const candles: Candle[] = [];
  for (let i = 0; i < 50; i += 1) {
    const base = 100 + i * 0.02;
    candles.push({ time: 1700000000000 + i * 60000, open: base, high: base + 0.1, low: base - 0.1, close: base + 0.02, volume: 1000 });
  }
  const trade: BacktestTrade = {
    id: "test-replay-1",
    index: 40,
    entryTime: candles[40].time,
    exitTime: candles[45].time,
    side: "LONG",
    entryPrice: candles[40].close,
    stopLoss: candles[40].close - 0.2,
    takeProfit: candles[40].close + 0.2,
    exitPrice: candles[45].close,
    pnl: -1,
    quantity: 1,
    outcome: "LOSS",
    reason: "STOP",
    entryReason: "test",
    exitReason: "stop",
  };
  const insights = replayRejectedTrades([trade], candles, "TEST-REPLAY-XAUUSD");
  if (insights.length !== 1) throw new Error("counterfactual replay did not return an insight");
  const summary = counterfactualReplaySummary("TEST-REPLAY-XAUUSD");
  if (!summary.length) throw new Error("counterfactual replay memory was not persisted");

  const rejected = {
    id: "rejected-context-1",
    entryTime: candles[40].time,
    side: "LONG" as const,
    entryPrice: candles[40].close,
    stopLoss: candles[40].close - 0.05,
    takeProfit: candles[40].close + 0.2,
    rejectionReason: "MISTAKE_PREVENTION",
  };
  for (let i = 0; i < 20; i += 1) replayRejectedSetup(rejected, candles, 6, "TEST-REPLAY-VALIDATED");
  const prevention = getCounterfactualPreventionDecision("TEST-REPLAY-VALIDATED", "OFF", "RANGING", "LONG");
  if (prevention.status !== "WATCH" || prevention.adjustment >= 0 || prevention.observations < 20) {
    throw new Error("validated counterfactual rejection did not reach prevention");
  }
  const quality = getRejectionQualityDecision("TEST-REPLAY-VALIDATED", "MISTAKE_PREVENTION", "OFF", "RANGING", "LONG");
  if (quality.status !== "VALIDATED" || quality.observations < 20) {
    throw new Error("rejection quality audit did not validate a historically good blocker");
  }

}
