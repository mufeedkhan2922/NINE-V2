import { buildAtlasContext } from "./atlas";
import { buildAtlasReport, buildChartistReport, buildSentinelDecision } from "./agents";
import { validateTradingEngine } from "./engineValidation";
import { assessAdvancedRisk } from "./risk";
import { analyzeSMC } from "./smc";
import { analyzeTechnicals } from "./technical";
import { MarketSnapshot, NINEOrchestration, PaperAccount, TradeDirection, TradingSetup } from "./types";

function buildTradeGeometry(market: MarketSnapshot, direction: TradeDirection, atr: number, premiumDiscount: string) {
  if (direction === "NONE" || atr <= 0 || !Number.isFinite(market.price)) return { entry: null, stopLoss: null, takeProfit: null, riskReward: null };
  const entry = market.price;
  const baseDistance = Math.max(atr * 1.2, entry * 0.0012);
  const stopDistance = premiumDiscount === "DISCOUNT" && direction === "LONG" ? baseDistance * 0.95 : premiumDiscount === "PREMIUM" && direction === "SHORT" ? baseDistance * 0.95 : baseDistance;
  const stopLoss = direction === "LONG" ? entry - stopDistance : entry + stopDistance;
  const takeProfit = direction === "LONG" ? entry + stopDistance * 2 : entry - stopDistance * 2;
  return { entry, stopLoss, takeProfit, riskReward: 2 };
}

const fallbackAccount: PaperAccount = { currency: "USD", initialBalance: 10000, balance: 10000, equity: 10000, realizedPnl: 0, unrealizedPnl: 0, peakEquity: 10000, dailyStartBalance: 10000, dailyRealizedPnl: 0, tradingDay: new Date().toISOString().slice(0,10), positions: [], updatedAt: Date.now() };

export function analyzeMarket(market: MarketSnapshot, account: PaperAccount = fallbackAccount): TradingSetup {
  const technical = analyzeTechnicals(market.candles);
  const smc = analyzeSMC(market.candles);
  let direction: TradeDirection = "NONE";
  if (technical.trend === "BULLISH" && (smc.structureDirection === "LONG" || smc.sweepDirection === "LONG")) direction = "LONG";
  if (technical.trend === "BEARISH" && (smc.structureDirection === "SHORT" || smc.sweepDirection === "SHORT")) direction = "SHORT";
  if (direction === "NONE" && smc.liquiditySweep) direction = smc.sweepDirection;

  const geometry = buildTradeGeometry(market, direction, technical.atr, smc.premiumDiscount);
  const projectedLoss = geometry.entry !== null && geometry.stopLoss !== null ? Math.abs(geometry.entry - geometry.stopLoss) * Math.max(0.0001, account.equity * 0.005 / Math.max(Math.abs(geometry.entry - geometry.stopLoss), 0.000001)) : 0;
  const notional = geometry.entry !== null ? Math.min(Number(process.env.NINE_PAPER_MAX_NOTIONAL_USD ?? 25000), account.equity) : 0;
  const risk = assessAdvancedRisk({ direction, riskPercent: 0.5, equity: account.equity, peakEquity: account.peakEquity, dailyRealizedPnl: account.dailyRealizedPnl, dailyStartBalance: account.dailyStartBalance, projectedLossDollars: projectedLoss, notionalDollars: notional });
  const confidenceBase = direction === "NONE" ? 35 : 48;
  const confluence = [smc.liquiditySweep, smc.marketStructureShift, smc.fairValueGap, smc.orderBlock, smc.chartist?.chochDirection !== "NONE"].filter(Boolean).length;
  const confidence = Math.min(95, confidenceBase + confluence * 9 + (technical.momentum === technical.trend ? 5 : 0));

  const draft: TradingSetup = {
    symbol: market.symbol, direction, status: direction === "NONE" ? "WATCHING" : "BLOCKED", ...geometry,
    marketBias: technical.trend, confidence, technical, smc, risk,
    validation: { valid: false, score: 0, blockers: [], warnings: risk.warnings, checks: { marketData: false, dataQuality: false, crossTimeframe: false, microstructure: false, marketState: false, risk: false, setup: false } },
    generatedAt: Date.now(),
  };
  const validation = validateTradingEngine(market, draft);
  const status = direction === "NONE" ? "WATCHING" : validation.valid ? "VALID" : "BLOCKED";
  return { ...draft, status, validation };
}

export async function orchestrateNINE(market: MarketSnapshot, account: PaperAccount = fallbackAccount): Promise<NINEOrchestration> {
  const atlas = await buildAtlasContext(market);
  const setup = analyzeMarket(market, account);
  const atlasReport = buildAtlasReport(market, atlas);
  const chartist = buildChartistReport(setup);
  const sentinel = buildSentinelDecision(setup);
  const sentinelAgent = { id: "SENTINEL" as const, name: "Sentinel", status: sentinel.approved ? "ONLINE" as const : "BLOCKED" as const, summary: sentinel.reason, signals: sentinel.checks, confidence: setup.validation.score, generatedAt: Date.now() };
  return { agentReports: [atlasReport, chartist, sentinelAgent], atlas, setup, sentinel, executionMode: "PAPER", commandSummary: sentinel.approved ? `${setup.direction} setup validated for paper execution.` : setup.direction === "NONE" ? "No executable setup. NINE is watching." : `Trade blocked: ${sentinel.reason}`, generatedAt: Date.now() };
}
