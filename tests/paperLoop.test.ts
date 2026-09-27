import { runXAUAutonomousPaperLoop } from "../lib/trading/paperLoop";
import { getPaperAccount } from "../lib/trading/paperTrading";
import type { MarketSnapshot, NINEOrchestration, TradingSetup } from "../lib/trading/types";
import * as assert from "./assert";

export function runPaperLoopTest(): void {
  const now = Date.parse("2026-09-27T12:00:00Z");
  const setup = {
    symbol: "XAUUSD",
    direction: "LONG",
    status: "VALID",
    entry: 10000,
    stopLoss: 9990,
    takeProfit: 10020,
    riskReward: 2,
    marketBias: "BULLISH",
    confidence: 90,
    technical: { trend: "BULLISH", momentum: "BULLISH", structure: "BOS", atr: 10, emaFast: 10000, emaSlow: 9990 },
    smc: {
      liquiditySweep: true, marketStructureShift: true, fairValueGap: true, orderBlock: true,
      premiumDiscount: "DISCOUNT", sweepDirection: "LONG", structureDirection: "LONG",
      chartist: { liquidityHigh: 10010, liquidityLow: 9990, fairValueGaps: [], orderBlocks: [], mssDirection: "LONG", chochDirection: "NONE", session: "NEW_YORK", sessionHigh: 10010, sessionLow: 9990, higherTimeframeBias: "LONG", confluenceScore: 90, confluenceReasons: ["MSS"] },
    },
    risk: { allowed: true, riskPercent: 0.25, reason: "ok", maxRiskPercent: 1 },
    validation: { valid: true, score: 95, blockers: [], warnings: [], checks: { marketData: true, dataQuality: true, crossTimeframe: true, microstructure: true, marketState: true, risk: true, setup: true } },
    generatedAt: now,
  } as unknown as TradingSetup;

  const orchestration = {
    setup,
    sentinel: { approved: true, reason: "Approved", checks: ["risk ok"] },
    atlas: { macroBias: "BULLISH", summary: "Macro supports", sourceStatus: "LIVE", headlines: [], generatedAt: now },
    executionMode: "PAPER",
    commandSummary: "Autonomous XAUUSD paper loop test",
    agentReports: [],
    generatedAt: now,
  } as unknown as NINEOrchestration;

  const market = (price: number) => ({
    symbol: "XAUUSD", price, previousClose: 9995, changePercent: 0.1,
    candles: [{ time: now, open: 9998, high: Math.max(price, 10002), low: Math.min(price, 9996), close: price }],
    timestamp: now, tradingAllowed: true, priceSource: "TEST",
    marketState: { latestCandleAgeSeconds: 1 },
    timeframes: { "1min": { candles: [{ time: now, open: 9998, high: Math.max(price, 10002), low: Math.min(price, 9996), close: price }] } },
  }) as unknown as MarketSnapshot;

  const first = runXAUAutonomousPaperLoop(market(10000), orchestration);
  assert.equal(first.state, "ENTERED", "validated Sentinel-approved setup should enter paper mode");
  assert.equal(first.entry.opened, true, "paper loop should open a paper position");

  const second = runXAUAutonomousPaperLoop(market(10005), orchestration);
  assert.equal(second.state, "MANAGING", "open paper setup should enter managing state");

  const third = runXAUAutonomousPaperLoop(market(10020), orchestration);
  assert.equal(third.state, "CLOSED", "target hit should close and record the paper setup");
  assert.equal(third.lifecycle, "PAPER_CLOSED", "closed setup should remain recorded as paper closed");
  assert.equal(third.account.positions.some((position) => position.status === "CLOSED"), true, "paper account should contain a closed position");

  void getPaperAccount();
}
