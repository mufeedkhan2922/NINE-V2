import assert from "node:assert/strict";
import { evaluateSentinel } from "../lib/trading/sentinel";
import { MarketSnapshot, PaperAccount, TradingSetup } from "../lib/trading/types";

function account(): PaperAccount {
  return {
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
    positions: [],
    updatedAt: Date.now(),
  };
}

function market(): MarketSnapshot {
  const now = Date.now();
  return {
    symbol: "XAUUSD",
    price: 4300,
    previousClose: 4290,
    changePercent: 0.23,
    candles: [],
    timestamp: now,
    tradingAllowed: true,
    marketState: {
      marketState: "OPEN",
      dataState: "LIVE",
      tradingPermission: "ALLOWED",
      reasons: [],
      warnings: [],
      latestCandleTime: now,
      latestCandleAgeSeconds: 1,
      oneMinuteAgeSeconds: 1,
      fiveMinuteAgeSeconds: 1,
      fifteenMinuteAgeSeconds: 1,
      oneHourAgeSeconds: 1,
      fourHourAgeSeconds: 1,
      feedActivity: true,
      suspiciousFeed: false,
    },
  };
}

function setup(valid = true): TradingSetup {
  return {
    symbol: "XAUUSD",
    direction: "LONG",
    status: valid ? "VALID" : "BLOCKED",
    entry: 4300,
    stopLoss: 4290,
    takeProfit: 4320,
    riskReward: 2,
    marketBias: "BULLISH",
    confidence: 90,
    technical: {
      trend: "BULLISH",
      momentum: "BULLISH",
      structure: "Higher highs / higher lows",
      atr: 10,
      emaFast: 4300,
      emaSlow: 4290,
    },
    smc: {
      liquiditySweep: true,
      marketStructureShift: true,
      fairValueGap: true,
      orderBlock: true,
      premiumDiscount: "DISCOUNT",
      sweepDirection: "LONG",
      structureDirection: "LONG",
    },
    risk: {
      allowed: true,
      riskPercent: 0.5,
      maxRiskPercent: 1,
      reason: "accepted",
    },
    validation: {
      valid,
      score: valid ? 100 : 20,
      blockers: valid ? [] : ["validation failed"],
      warnings: [],
      checks: {
        marketData: true,
        dataQuality: true,
        crossTimeframe: true,
        microstructure: true,
        marketState: true,
        risk: true,
        setup: true,
      },
    },
    generatedAt: Date.now(),
  };
}

export function runSentinelTests(): void {
  const allowed = evaluateSentinel(
    market(),
    setup(true),
    account(),
  );

  assert.equal(allowed.approved, true);
  assert.ok(allowed.checks.length > 0);

  const blocked = evaluateSentinel(
    {
      ...market(),
      tradingAllowed: false,
      marketState: {
        ...market().marketState!,
        dataState: "STALE",
        tradingPermission: "BLOCKED",
      },
    },
    setup(true),
    account(),
  );

  assert.equal(blocked.approved, false);
  assert.match(blocked.reason, /Market data/i);

  const invalid = evaluateSentinel(
    market(),
    setup(false),
    account(),
  );

  assert.equal(invalid.approved, false);
}
