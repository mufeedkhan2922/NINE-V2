import { buildXAUTerminalAnalytics, buildXAUReplayTimeline, lifecycleProgress } from "../lib/trading/xauTerminalAnalytics";
import * as assert from "./assert";

export function runXAUTerminalAnalyticsTest(): void {
  const analytics = buildXAUTerminalAnalytics([
    { id: "1", side: "LONG", entryPrice: 100, exitPrice: 110, quantity: 1, pnl: 10, status: "CLOSED" },
    { id: "2", side: "SHORT", entryPrice: 110, exitPrice: 115, quantity: 1, pnl: -5, status: "CLOSED" },
    { id: "3", side: "LONG", entryPrice: 100, exitPrice: null, quantity: 1, pnl: null, status: "OPEN" },
  ]);
  assert.equal(analytics.closedTrades, 2, "closed trade count");
  assert.equal(analytics.openTrades, 1, "open trade count");
  assert.equal(analytics.wins, 1, "win count");
  assert.equal(analytics.losses, 1, "loss count");
  assert.equal(analytics.winRate, 50, "win rate");
  assert.equal(analytics.netPnl, 5, "net PnL");
  assert.equal(analytics.maxConsecutiveLosses, 1, "loss streak");
  const timeline = buildXAUReplayTimeline(
    [
      { timestamp: 2, fromState: "VALIDATED", toState: "ENTERED", reason: "entered", positionId: "p1" },
      { timestamp: 1, fromState: null, toState: "DETECTED", reason: "detected", positionId: null },
    ],
    [{ timestamp: 3, title: "MSS", detail: "validated" }],
  );
  assert.equal(timeline[0].event, "MSS", "replay order");
  assert.equal(lifecycleProgress("MANAGING"), 0.8, "lifecycle progress");
  assert.equal(lifecycleProgress("BLOCKED"), 0, "blocked progress");
}
