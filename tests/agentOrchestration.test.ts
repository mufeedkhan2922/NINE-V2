import { buildAgentOrchestration, buildSpokenResponse, routeVoiceIntent } from "../lib/trading/agentOrchestrator";
import type { AtlasContext, MarketSnapshot, SentinelDecision, TradingSetup } from "../lib/trading/types";
import * as assert from "./assert";

export function runAgentOrchestrationTest(): void {
  const market = { symbol: "XAUUSD", price: 2400, previousClose: 2399, changePercent: 0.1, candles: [], timestamp: Date.now() } as MarketSnapshot;
  const setup = { direction: "LONG", status: "VALID", confidence: 80, marketBias: "BULLISH", validation: { valid: true }, technical: { structure: "BOS", trend: "BULLISH", momentum: "BULLISH", atr: 5, emaFast: 2400, emaSlow: 2395 }, smc: { liquiditySweep: true, marketStructureShift: true, fairValueGap: true, orderBlock: false, premiumDiscount: "DISCOUNT", sweepDirection: "LONG", structureDirection: "LONG" } } as TradingSetup;
  const atlas = { summary: "Macro neutral", headlines: [], sourceStatus: "LIVE" } as unknown as AtlasContext;
  const sentinel = { approved: true, reason: "Approved", checks: ["risk ok"] } as SentinelDecision;
  const result = buildAgentOrchestration(market, setup, atlas, sentinel);
  assert.equal(result.executionAuthority, "SENTINEL_ONLY", "Sentinel must remain execution authority");
  assert.equal(result.decision, "PAPER_READY", "valid paper setup should be paper ready");
  assert.equal(result.messages.length, 3, "core agent trio must be present");
  assert.equal(routeVoiceIntent("Nine, analyze gold"), { intent: "ANALYZE_GOLD", requiresSentinel: false }, "gold voice intent should route");
  assert.equal(routeVoiceIntent("what is the risk status"), { intent: "RISK", requiresSentinel: true }, "risk voice intent should route to Sentinel");
  assert.ok(buildSpokenResponse("ANALYZE_GOLD", result).length > 0, "spoken response should be generated");
}