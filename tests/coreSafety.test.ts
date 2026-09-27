import assert from "node:assert/strict";
import {
  validateExecutionRequest,
  validateMarketSnapshotCore,
  validatePaperAccountCore,
  validateSetupCore,
} from "../lib/trading/coreSafety";

export function runCoreSafetyTests(): void {
  const approvedPaper = validateExecutionRequest({
    symbol: "XAUUSD",
    side: "BUY",
    quantity: 0.01,
    entryPrice: 4300,
    stopLoss: 4290,
    takeProfit: 4320,
    mode: "PAPER",
    sentinelApproved: true,
  });
  assert.equal(approvedPaper.valid, true);

  const live = validateExecutionRequest({
    symbol: "XAUUSD",
    side: "BUY",
    quantity: 0.01,
    entryPrice: 4300,
    stopLoss: 4290,
    takeProfit: 4320,
    mode: "LIVE",
    sentinelApproved: true,
  });
  assert.equal(live.valid, false);
  assert.match(live.blockers.join(" "), /Live execution is hard-locked/);

  const badGeometry = validateExecutionRequest({
    symbol: "XAUUSD",
    side: "BUY",
    quantity: 0.01,
    entryPrice: 4300,
    stopLoss: 4310,
    takeProfit: 4320,
    mode: "PAPER",
    sentinelApproved: true,
  });
  assert.equal(badGeometry.valid, false);

  const setup = {
    symbol: "XAUUSD" as const,
    direction: "LONG" as const,
    status: "VALID" as const,
    entry: 4300,
    stopLoss: 4290,
    takeProfit: 4320,
    riskReward: 2,
    marketBias: "BULLISH" as const,
    confidence: 85,
    technical: { trend: "BULLISH" as const, momentum: "BULLISH" as const, structure: "BULLISH", atr: 10, emaFast: 4300, emaSlow: 4290 },
    smc: {
      liquiditySweep: true, marketStructureShift: true, fairValueGap: true,
      orderBlock: true, premiumDiscount: "DISCOUNT" as const,
      sweepDirection: "LONG" as const, structureDirection: "LONG" as const,
    },
    risk: { allowed: true, riskPercent: 0.5, reason: "ok", maxRiskPercent: 1 },
    validation: {} as never,
    generatedAt: Date.now(),
  };
  assert.equal(validateSetupCore(setup).valid, true);

  const invalidMarket = validateMarketSnapshotCore({
    symbol: "XAUUSD",
    price: 4300,
    previousClose: 4290,
    changePercent: 0,
    candles: [],
    timestamp: Date.now(),
  });
  assert.equal(invalidMarket.valid, false);

  const invalidAccount = validatePaperAccountCore({
    currency: "USD",
    initialBalance: 10000,
    balance: 10000,
    equity: 10000,
    realizedPnl: 0,
    unrealizedPnl: 0,
    peakEquity: 10000,
    dailyStartBalance: 10000,
    dailyRealizedPnl: 0,
    tradingDay: new Date().toISOString().slice(0, 10),
    updatedAt: Date.now(),
    positions: [{
      id: "P1",
      orderId: "O1",
      symbol: "XAUUSD",
      side: "BUY",
      quantity: 0,
      entryPrice: 4300,
      stopLoss: 4290,
      takeProfit: 4320,
      openedAt: Date.now(),
      status: "OPEN",
    }],
  });
  assert.equal(invalidAccount.valid, false);
}
