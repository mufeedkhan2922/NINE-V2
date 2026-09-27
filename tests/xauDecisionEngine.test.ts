import { buildXAUDecisionEngine, createSetupTracking } from "../lib/trading/xauDecisionEngine";
import type { AtlasContext, MarketSnapshot, PaperAccount, SentinelDecision, TradingSetup } from "../lib/trading/types";
import * as assert from "./assert";

export function runXAUDecisionEngineTest(): void {
  const now = Date.parse("2026-09-27T12:30:00Z");
  const setup = {
    symbol: "XAUUSD",
    direction: "LONG",
    status: "VALID",
    entry: 2400,
    stopLoss: 2390,
    takeProfit: 2420,
    riskReward: 2,
    confidence: 84,
    marketBias: "BULLISH",
    technical: { trend: "BULLISH", momentum: "BULLISH", structure: "BOS", atr: 5, emaFast: 2400, emaSlow: 2395 },
    smc: {
      liquiditySweep: true,
      marketStructureShift: true,
      fairValueGap: true,
      orderBlock: true,
      premiumDiscount: "DISCOUNT",
      sweepDirection: "LONG",
      structureDirection: "LONG",
      chartist: {
        liquidityHigh: 2410,
        liquidityLow: 2395,
        fairValueGaps: [{ high: 2402, low: 2399, direction: "LONG", createdAt: now - 60_000 }],
        orderBlocks: [{ high: 2398, low: 2394, direction: "LONG", createdAt: now - 120_000 }],
        mssDirection: "LONG",
        chochDirection: "NONE",
        session: "LONDON",
        sessionHigh: 2410,
        sessionLow: 2390,
        higherTimeframeBias: "LONG",
        confluenceScore: 78,
        confluenceReasons: ["BOS", "Liquidity sweep"],
      },
    },
    risk: { allowed: true, riskPercent: 0.5, reason: "ok", maxRiskPercent: 1 },
    validation: {
      valid: true,
      score: 92,
      blockers: [],
      warnings: [],
      checks: { marketData: true, dataQuality: true, crossTimeframe: true, microstructure: true, marketState: true, risk: true, setup: true },
    },
    generatedAt: now,
  } as unknown as TradingSetup;

  const market = {
    symbol: "XAUUSD",
    price: 2400,
    previousClose: 2395,
    changePercent: 0.2,
    candles: [{ time: now, open: 2398, high: 2402, low: 2397, close: 2400 }],
    timestamp: now,
    tradingAllowed: true,
    priceSource: "QUOTE",
    marketState: { latestCandleAgeSeconds: 1 },
  } as unknown as MarketSnapshot;

  const account = {
    currency: "USD", initialBalance: 10_000, balance: 10_000, equity: 10_000, realizedPnl: 0, unrealizedPnl: 0,
    positions: [], updatedAt: now, peakEquity: 10_000, dailyStartBalance: 10_000, dailyRealizedPnl: 0, tradingDay: "2026-09-27",
  } as PaperAccount;
  const atlas = { macroBias: "BULLISH", summary: "Macro supports gold", sourceStatus: "LIVE", headlines: [], generatedAt: now } as unknown as AtlasContext;
  const sentinel = { approved: true, reason: "Approved", checks: ["risk ok"] } as SentinelDecision;

  const tracking = createSetupTracking(setup, account);
  const result = buildXAUDecisionEngine(market, setup, atlas, sentinel, account, tracking);
  assert.equal(result.lifecycle, "PAPER_READY", "valid approved setup should be paper ready");
  assert.equal(result.events.some((item) => item.type === "LIQUIDITY_SWEEP"), true, "SMC sweep should become an event");
  assert.equal(result.debate.length, 4, "four agents should participate in the decision debate");
  assert.equal(result.evidenceChain.some((item) => item.source === "SENTINEL"), true, "evidence chain should include Sentinel");
  assert.equal(result.session, "NEW_YORK", "12:00 UTC fixture should map to New York session");

  const invalidated = buildXAUDecisionEngine({ ...market, price: 2389 }, setup, atlas, sentinel, account, tracking);
  assert.equal(invalidated.lifecycle, "EXPIRED", "crossed stop should expire the setup");
  assert.equal(invalidated.invalidation.active, true, "invalidated setup should expose active invalidation");
}
