import { buildAtlasContext } from "./atlas";
import { buildAtlasReport, buildChartistReport } from "./agents";
import { validateTradingEngine } from "./engineValidation";
import { assessAdvancedRisk } from "./risk";
import { analyzeSMC } from "./smc";
import { analyzeTechnicals } from "./technical";
import { marketFeedStatus } from "./runtime";
import { MarketSnapshot, NINEOrchestration, PaperAccount, TradeDirection, TradingSetup } from "./types";
import { sentinelDecision } from "./sentinel";

function buildTradeGeometry(market: MarketSnapshot, direction: TradeDirection, atr: number, premiumDiscount: string) {
  if (direction === "NONE" || atr <= 0 || !Number.isFinite(market.price)) return { entry: null, stopLoss: null, takeProfit: null, riskReward: null };
  const entry = market.price;
  const baseDistance = Math.max(atr * 1.2, entry * 0.0012);
  const stopDistance = premiumDiscount === "DISCOUNT" && direction === "LONG" || premiumDiscount === "PREMIUM" && direction === "SHORT" ? baseDistance * 0.95 : baseDistance;
  const stopLoss = direction === "LONG" ? entry - stopDistance : entry + stopDistance;
  const takeProfit = direction === "LONG" ? entry + stopDistance * 2 : entry - stopDistance * 2;
  return { entry, stopLoss, takeProfit, riskReward: 2 };
}

const fallbackAccount: PaperAccount = {
  currency: "USD", initialBalance: 10000, balance: 10000, equity: 10000, realizedPnl: 0, unrealizedPnl: 0,
  peakEquity: 10000, dailyStartBalance: 10000, dailyRealizedPnl: 0, tradingDay: new Date().toISOString().slice(0, 10), positions: [], updatedAt: Date.now(),
};

function higherTimeframeBias(market: MarketSnapshot): TradeDirection {
  const oneHour = market.timeframes?.["1h"]?.candles ?? [];
  const fourHour = market.timeframes?.["4h"]?.candles ?? [];
  if (oneHour.length < 20 || fourHour.length < 20) return "NONE";
  const oneHourMove = oneHour.at(-1)!.close - oneHour[Math.max(0, oneHour.length - 20)].close;
  const fourHourMove = fourHour.at(-1)!.close - fourHour[Math.max(0, fourHour.length - 20)].close;
  if (oneHourMove > 0 && fourHourMove > 0) return "LONG";
  if (oneHourMove < 0 && fourHourMove < 0) return "SHORT";
  return "NONE";
}

export function analyzeMarket(market: MarketSnapshot, account: PaperAccount = fallbackAccount): TradingSetup {
  const technical = analyzeTechnicals(market.candles);
  const smc = analyzeSMC(market.candles);
  const higherBias = higherTimeframeBias(market);
  if (smc.chartist) {
    const reasons = [...smc.chartist.confluenceReasons];
    if (higherBias !== "NONE") reasons.push(`Higher-timeframe ${higherBias} alignment`);
    if (higherBias !== "NONE" && higherBias === smc.chartist.mssDirection) reasons.push("MSS agrees with higher timeframe");
    smc.chartist = { ...smc.chartist, higherTimeframeBias: higherBias, confluenceScore: Math.min(100, reasons.length * 14), confluenceReasons: reasons };
  }

  let direction: TradeDirection = "NONE";
  if (technical.trend === "BULLISH" && higherBias !== "SHORT" && (smc.structureDirection === "LONG" || smc.sweepDirection === "LONG")) direction = "LONG";
  if (technical.trend === "BEARISH" && higherBias !== "LONG" && (smc.structureDirection === "SHORT" || smc.sweepDirection === "SHORT")) direction = "SHORT";
  if (direction === "NONE" && smc.liquiditySweep && (higherBias === "NONE" || higherBias === smc.sweepDirection)) direction = smc.sweepDirection;

  const geometry = buildTradeGeometry(market, direction, technical.atr, smc.premiumDiscount);
  const projectedLoss = geometry.entry !== null && geometry.stopLoss !== null ? Math.abs(geometry.entry - geometry.stopLoss) * Math.max(0.01, Number(process.env.NINE_DEFAULT_ORDER_QUANTITY ?? 0.01)) : 0;
  const notional = geometry.entry !== null ? Math.min(Number(process.env.NINE_PAPER_MAX_NOTIONAL_USD ?? 25000), account.equity) : 0;
  const risk = assessAdvancedRisk({ direction, riskPercent: 0.5, equity: account.equity, peakEquity: account.peakEquity, dailyRealizedPnl: account.dailyRealizedPnl, dailyStartBalance: account.dailyStartBalance, projectedLossDollars: projectedLoss, notionalDollars: notional });
  const confluence = [smc.liquiditySweep, smc.marketStructureShift, smc.fairValueGap, smc.orderBlock, smc.chartist?.chochDirection !== "NONE", higherBias !== "NONE" && higherBias === direction].filter(Boolean).length;
  const confidence = Math.min(95, (direction === "NONE" ? 30 : 45) + confluence * 8 + (technical.momentum === technical.trend ? 5 : 0) + Math.round((smc.chartist?.confluenceScore ?? 0) * 0.12));

  const draft: TradingSetup = {
    symbol: market.symbol, direction, status: direction === "NONE" ? "WATCHING" : "BLOCKED", ...geometry,
    marketBias: technical.trend, confidence, technical, smc, risk,
    validation: { valid: false, score: 0, blockers: [], warnings: risk.warnings, checks: { marketData: false, dataQuality: false, crossTimeframe: false, microstructure: false, marketState: false, risk: false, setup: false } },
    generatedAt: Date.now(),
  };
  const validation = validateTradingEngine(market, draft);
  return { ...draft, status: direction === "NONE" ? "WATCHING" : validation.valid ? "VALID" : "BLOCKED", validation };
}

export async function orchestrateNINE(market: MarketSnapshot, account: PaperAccount = fallbackAccount): Promise<NINEOrchestration> {
  const atlas = await buildAtlasContext(market);
  const setup = analyzeMarket(market, account);
  const atlasReport = buildAtlasReport(market, atlas);
  const chartist = buildChartistReport(setup);
  const sentinel = sentinelDecision(market, setup, account);
  const sentinelAgent = {
    id: "SENTINEL" as const,
    name: "Sentinel",
    status: sentinel.approved ? ("ONLINE" as const) : ("BLOCKED" as const),
    summary: sentinel.reason,
    signals: sentinel.checks,
    confidence: setup.validation.score,
    generatedAt: Date.now(),
  };
  const feed = marketFeedStatus(market);
  const marketBlockers = [
    ...(market.marketState?.reasons ?? []),
    ...(market.crossTimeframeValidation?.issues ?? []),
    ...(market.microstructureValidation?.issues ?? []),
  ].slice(0, 8);
  const blockers = [...(sentinel.blockers ?? []), ...(setup.validation.blockers ?? []), ...(market.marketState?.reasons ?? [])].map((item) => item.replace(/^BLOCK:\\s*/, ""));
  const warnings = [...(setup.validation.warnings ?? []), ...(market.marketState?.warnings ?? [])];
  const evidence = [
    `Market state: ${market.marketState?.marketState ?? "UNKNOWN"} / data: ${market.marketState?.dataState ?? "UNKNOWN"}`,
    `Engine validation: ${setup.validation.score}%`,
    `Chartist confluence: ${setup.smc.chartist?.confluenceScore ?? 0}%`,
    `Atlas: ${atlas.instrumentImpact}`,
  ];
  const decision = sentinel.approved && setup.status === "VALID"
    ? { decision: "TRADE" as const, title: "Trade candidate passed the current gates", summary: `${setup.direction} setup passed engine validation and Sentinel.`, blockers: [], warnings, evidence, confidence: setup.confidence }
    : setup.direction === "NONE"
      ? { decision: "WATCH" as const, title: "NINE is watching", summary: "No confirmed executable direction is present yet.", blockers, warnings, evidence, confidence: setup.confidence }
      : { decision: "BLOCKED" as const, title: "NINE is blocked", summary: sentinel.reason, blockers, warnings, evidence, confidence: setup.confidence };
  const commandSummary = decision.summary;
  return {
    agentReports: [atlasReport, chartist, sentinelAgent],
    atlas, setup, sentinel, executionMode: "PAPER", commandSummary, generatedAt: Date.now(),
    marketHealth: { feed, validated: feed.tradingAllowed && setup.validation.checks.marketData, blockers: marketBlockers }, decision,
  };
}
