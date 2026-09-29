import { getLessonDecision, investigateTradeLoss } from "../lib/trading/lossInvestigator";
import type { BacktestTrade } from "../lib/trading/backtest";
import type { Candle } from "../lib/trading/types";
import * as assert from "./assert";

function trade(win: boolean): BacktestTrade {
  return {
    id: "LOSS-1",
    index: 10,
    side: "LONG",
    entryTime: 10 * 300000,
    exitTime: 13 * 300000,
    entryPrice: 2500,
    exitPrice: win ? 2502 : 2499,
    stopLoss: 2499,
    takeProfit: 2502,
    quantity: 1,
    pnl: win ? 2 : -1,
    outcome: win ? "WIN" : "LOSS",
    reason: win ? "TARGET" : "STOP",
    entryReason: "LONDON; LONG opening-range breakout; quality score 8",
    exitReason: win ? "Target" : "Stop",
  };
}

export function runLossInvestigatorTest(): void {
  const candles: Candle[] = Array.from({ length: 30 }, (_, i) => ({
    time: i * 300000,
    open: 2500,
    high: i >= 11 ? 2500.2 : 2500.5,
    low: i >= 11 ? 2499.0 : 2499.8,
    close: i >= 11 ? 2499.1 : 2500.2,
  }));

  const lesson = investigateTradeLoss(trade(false), candles);
  assert.ok(Boolean(lesson), "losing trades must produce an investigation lesson");
  assert.ok(Boolean(lesson?.lesson), "loss lesson must contain an explanation");

  const decision = getLessonDecision("XAUUSD", "opening-range breakout", "LONDON", "LONG");
  assert.equal(typeof decision.blocked, "boolean", "lesson decision must be deterministic");
}
