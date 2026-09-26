import { AgentReport, MarketSnapshot, SentinelDecision, TradingSetup, AtlasContext } from "./types";

export function buildAtlasReport(market: MarketSnapshot, atlas: AtlasContext): AgentReport {
  const signals = atlas.headlines.slice(0, 4).map((h) => `${h.sentiment}: ${h.title}`);
  if (market.previousDayHigh && market.price > market.previousDayHigh) signals.push("Price is above the previous-day high.");
  if (market.previousDayLow && market.price < market.previousDayLow) signals.push("Price is below the previous-day low.");
  if (!signals.length) signals.push("No recent macro/news catalyst detected.");
  return { id: "ATLAS", name: "Atlas", status: "ONLINE", summary: atlas.summary, signals, confidence: Math.min(95, 50 + Math.abs(market.changePercent) * 8 + Math.min(20, atlas.headlineCount * 1.5)), generatedAt: Date.now() };
}

export function buildChartistReport(setup: TradingSetup): AgentReport {
  const signals: string[] = [setup.technical.structure];
  if (setup.smc.liquiditySweep) signals.push(`${setup.smc.sweepDirection} liquidity sweep detected.`);
  if (setup.smc.marketStructureShift) signals.push(`${setup.smc.structureDirection} MSS detected.`);
  if (setup.smc.chartist?.chochDirection && setup.smc.chartist.chochDirection !== "NONE") signals.push(`${setup.smc.chartist.chochDirection} CHoCH detected.`);
  if (setup.smc.fairValueGap) signals.push(`${setup.smc.chartist?.fairValueGaps.length ?? 0} FVG zone(s) detected.`);
  if (setup.smc.orderBlock) signals.push(`${setup.smc.chartist?.orderBlocks.length ?? 0} order-block zone(s) detected.`);
  signals.push(`${setup.smc.premiumDiscount} pricing zone · ${setup.smc.chartist?.session ?? "OFF_SESSION"} session.`);
  return { id: "CHARTIST", name: "Chartist", status: "ONLINE", summary: `${setup.marketBias} technical bias with ${setup.confidence}% setup confidence.`, signals, confidence: setup.confidence, generatedAt: Date.now() };
}

export function buildSentinelDecision(setup: TradingSetup): SentinelDecision {
  const checks = [
    setup.validation.checks.marketData ? "Market data ✓" : "Market data ✕",
    setup.validation.checks.dataQuality ? "Data quality ✓" : "Data quality ✕",
    setup.validation.checks.crossTimeframe ? "Cross-timeframe ✓" : "Cross-timeframe ✕",
    setup.validation.checks.microstructure ? "Microstructure ✓" : "Microstructure ✕",
    setup.validation.checks.marketState ? "Market state ✓" : "Market state ✕",
    setup.validation.checks.risk ? "Risk ✓" : "Risk ✕",
    setup.validation.checks.setup ? "Trade geometry ✓" : "Trade geometry ✕",
  ];
  return { approved: setup.validation.valid && setup.status === "VALID", reason: setup.validation.valid ? "All Sentinel gates passed." : setup.validation.blockers[0] ?? "Trade blocked.", checks };
}
