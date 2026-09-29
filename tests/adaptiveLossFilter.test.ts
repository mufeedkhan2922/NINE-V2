import { buildAdaptiveLossFilter } from "../lib/trading/adaptiveLossFilter";
import type { BacktestTrade } from "../lib/trading/backtest";
import * as assert from "./assert";

function trade(index: number, win: boolean): BacktestTrade {
  const entry = 2500;
  const stop = 2499;
  const target = 2502;
  return {
    id: `T-${index}`,
    index,
    side: "LONG",
    entryTime: index * 300000,
    exitTime: index * 300000 + 60000,
    entryPrice: entry,
    exitPrice: win ? target : stop,
    stopLoss: stop,
    takeProfit: target,
    quantity: 1,
    pnl: win ? 2 : -1,
    outcome: win ? "WIN" : "LOSS",
    reason: win ? "TARGET" : "STOP",
    entryReason: "LONDON; LONG opening-range breakout; quality score 8; test",
    exitReason: win ? "Take-profit target reached at 2.1R." : "Stop-loss level reached before target.",
  };
}

export function runAdaptiveLossFilterTest(): void {
  const losingSample = Array.from({ length: 18 }, (_, index) => trade(index, false))
    .concat([trade(18, true), trade(19, true)]);
  const filter = buildAdaptiveLossFilter(losingSample, { minimumTrades: 20 });
  assert.ok(filter.blockedKeys.length === 1, "statistically bad setup should be blocked");
  const decision = filter.isBlocked("LONDON; LONG opening-range breakout; quality score 9; new signal");
  assert.equal(decision.blocked, true, "blocked setup must not be accepted");

  const smallSample = buildAdaptiveLossFilter(losingSample.slice(0, 8), { minimumTrades: 20 });
  assert.equal(smallSample.blockedKeys.length, 0, "small samples must remain neutral");
}
