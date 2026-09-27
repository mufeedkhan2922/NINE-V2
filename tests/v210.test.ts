import assert from "node:assert/strict";
import { runBacktest } from "../lib/trading/backtest";
import { buildDecisionExplanation } from "../lib/trading/v210";
import type { NINEOrchestration, TradingSetup } from "../lib/trading/types";

function setup(): TradingSetup {
  return {
    symbol: "XAUUSD", direction: "LONG", status: "VALID",
    entry: 4200, stopLoss: 4190, takeProfit: 4220, riskReward: 2,
    marketBias: "BULLISH", confidence: 78,
    technical: { trend: "BULLISH", momentum: "BULLISH", structure: "BULLISH", atr: 10, emaFast: 4200, emaSlow: 4190 },
    smc: { liquiditySweep: true, marketStructureShift: true, fairValueGap: true, orderBlock: false, premiumDiscount: "DISCOUNT", sweepDirection: "LONG", structureDirection: "LONG" },
    risk: { allowed: true, riskPercent: 0.5, reason: "Risk budget available", maxRiskPercent: 1 },
    validation: { valid: true, score: 90, blockers: [], warnings: [], checks: { marketData: true, dataQuality: true, crossTimeframe: true, microstructure: true, marketState: true, risk: true, setup: true } },
    generatedAt: Date.now(),
  };
}
function candles(count = 220) {
  return Array.from({ length: count }, (_, i) => {
    const close = 2300 + Math.sin(i / 8) * 5 + i * 0.25;
    return { time: i * 60000, open: close - 0.1, high: close + 1.1, low: close - 1.1, close };
  });
}
export function runV210Test(): void {
  const result = runBacktest(candles(), 10000, 0.5);
  assert.ok(Array.isArray(result.equityCurve), "equity curve must be present");
  assert.ok(Array.isArray(result.distribution.buckets), "distribution must be present");
  assert.equal(result.finalBalance, result.initialBalance + result.netPnl, "balance must reconcile");
  assert.ok(Number.isFinite(result.expectancy), "expectancy must be finite");
  assert.ok(Number.isFinite(result.averageWin), "average win must be finite");
  assert.ok(Number.isFinite(result.averageLoss), "average loss must be finite");
  assert.ok(result.winningStreak >= 0 && result.losingStreak >= 0, "streaks must be non-negative");

  const orchestration: NINEOrchestration = {
    agentReports: [],
    atlas: { headlineCount: 1, bullish: 1, bearish: 0, neutral: 0, headlines: [{ title: "Gold and USD macro update", source: "test", sentiment: "BULLISH" }], macroBias: "BULLISH", summary: "test", generatedAt: Date.now(), macroEvents: [], sourceStatus: "LIVE", freshnessSeconds: 5 },
    setup: setup(),
    sentinel: { approved: false, reason: "Market data feed is blocked.", checks: ["BLOCK: Market data feed is blocked."], blockers: ["BLOCK: Market data feed is blocked."] },
    executionMode: "PAPER", commandSummary: "blocked", generatedAt: Date.now(),
    marketHealth: { feed: { provider: "test", connection: "DEGRADED", hasCredentials: true, lastUpdate: Date.now(), ageSeconds: 30, stale: true, priceSource: "CANDLE", tradingAllowed: false, reason: "stale", diagnostics: ["stale"] }, validated: false, blockers: ["Market data is stale."] },
  };
  const explanation = buildDecisionExplanation(orchestration);
  assert.equal(explanation.decision, "BLOCKED");
  assert.ok(explanation.blockers.length > 0, "blocked decision must expose reasons");
  assert.equal(explanation.atlas.status, "LIVE");
  assert.equal(explanation.paper.allowed, false);
}
