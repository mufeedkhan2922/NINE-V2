import { buildXAUTerminalAnalytics, buildXAUReplayTimeline, lifecycleProgress } from "../lib/trading/xauTerminalAnalytics";
import * as assert from "./assert";

export function runXAUTerminalAnalyticsTest(): void {
  const analytics = buildXAUTerminalAnalytics([
    { id: "1", side: "LONG", entryPrice: 100, exitPrice: 110, quantity: 1, pnl: 10, status: "CLOSED" },
    { id: "2", side: "SHORT", entryPrice: 110, exitPrice: 115, quantity: 1, pnl: -5, status: "CLOSED" },
    { id: "3", side: "LONG", entryPrice: 100, exitPrice: null, quantity: 1, pnl: null, status: "OPEN" },
  ]);
  assert.equal(analytics.closedTrades, 2);
  assert.equal(analytics.openTrades, 1);
  assert.equal(analytics.wins, 1);
  assert.equal(analytics.losses, 1);
  assert.equal(analytics.winRate, 50);
  assert.equal(analytics.netPnl, 5);
  assert.equal(analytics.maxConsecutiveLosses, 1);
  const timeline = buildXAUReplayTimeline(
    [
      { timestamp: 2, fromState: "VALIDATED", toState: "ENTERED", reason: "entered", positionId: "p1" },
      { timestamp: 1, fromState: null, toState: "DETECTED", reason: "detected", positionId: null },
    ],
    [{ timestamp: 3, title: "MSS", detail: "validated" }],
  );
  assert.equal(timeline[0].event, "MSS");
  assert.equal(lifecycleProgress("MANAGING"), 0.8);
  assert.equal(lifecycleProgress("BLOCKED"), 0);
}
