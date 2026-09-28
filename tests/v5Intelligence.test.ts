import { buildV5Intelligence } from "../lib/trading/v5Intelligence";
import type { MarketSnapshot, NINEOrchestration, PaperAccount } from "../lib/trading/types";
import { createSetupTracking } from "../lib/trading/xauDecisionEngine";
import * as assert from "./assert";

function candles(count = 110) {
  return Array.from({ length: count }, (_, i) => {
    const base = 2300 + i * 0.25 + Math.sin(i / 4) * 2;
    return {
      time: 1_700_000_000_000 + i * 60_000,
      open: base,
      high: base + 2,
      low: base - 2,
      close: base + 0.8,
      volume: 1000,
    };
  });
}

export function runV5IntelligenceTest(): void {
  const market: MarketSnapshot = {
    symbol: "XAUUSD",
    price: 2327.8,
    previousClose: 2325,
    changePercent: 0.12,
    candles: candles(),
    timestamp: Date.now(),
    tradingAllowed: true,
    marketState: {
      marketState: "OPEN",
      dataState: "LIVE",
      tradingPermission: "ALLOWED",
      reasons: [],
      warnings: [],
      latestCandleTime: Date.now(),
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

  const setup = {
    symbol: "XAUUSD" as const,
    direction: "NONE" as const,
    status: "WATCHING" as const,
    entry: null,
    stopLoss: null,
    takeProfit: null,
    riskReward: null,
    marketBias: "NEUTRAL" as const,
    confidence: 30,
    technical: { trend: "NEUTRAL" as const, momentum: "NEUTRAL" as const, structure: "Range", atr: 2, emaFast: 1, emaSlow: 1 },
    smc: {
      liquiditySweep: false,
      marketStructureShift: false,
      fairValueGap: false,
      orderBlock: false,
      premiumDiscount: "EQUILIBRIUM" as const,
      sweepDirection: "NONE" as const,
      structureDirection: "NONE" as const,
    },
    risk: { allowed: true, riskPercent: 0, reason: "No risk", maxRiskPercent: 0.5 },
    validation: {
      valid: false,
      score: 50,
      blockers: [],
      warnings: [],
      checks: { marketData: true, dataQuality: true, crossTimeframe: true, microstructure: true, marketState: true, risk: true, setup: false },
    },
    generatedAt: Date.now(),
  };

  const orchestration: NINEOrchestration = {
    agentReports: [],
    setup,
    sentinel: { approved: false, reason: "No directional setup.", checks: ["BLOCK: No trade direction is confirmed."] },
    executionMode: "PAPER",
    commandSummary: "Watching",
    generatedAt: Date.now(),
  };

  const account: PaperAccount = {
    currency: "USD",
    initialBalance: 10000,
    balance: 10000,
    equity: 10000,
    realizedPnl: 0,
    unrealizedPnl: 0,
    positions: [],
    updatedAt: Date.now(),
    peakEquity: 10000,
    dailyStartBalance: 10000,
    dailyRealizedPnl: 0,
    tradingDay: new Date().toISOString().slice(0, 10),
  };

  const tracking = createSetupTracking(setup, account);
  const result = buildV5Intelligence(market, orchestration, account, tracking);

  assert.equal(result.version, "5.5.0", "V5.5 version");
  assert.ok(result.regimeEngine !== undefined, "regime engine exists");
  assert.ok(result.recommendedStrategyId !== undefined, "setup ranking exists");
  assert.equal(result.symbol, "XAUUSD", "V5 symbol");
  assert.equal(result.executionMode, "PAPER", "V5 execution mode");
  assert.equal(result.executionAuthority, "SENTINEL_ONLY", "Sentinel remains execution authority");
  assert.equal(result.action, "WATCHING", "no directional setup must remain watching");
  assert.ok(result.strategyConsensus !== undefined, "strategy consensus exists");
  assert.ok(result.learning !== undefined, "learning snapshot exists");
  assert.ok(result.evidence.length >= 5, "evidence chain exists");
}
