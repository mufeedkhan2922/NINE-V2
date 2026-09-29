import { db } from "./db";
import type { Candle, MarketSnapshot, TradeDirection } from "./types";
import type { StrategyFamily } from "./strategyLibrary";

export type MarketRegime =
  | "TRENDING_UP"
  | "TRENDING_DOWN"
  | "RANGING"
  | "EXPANDING"
  | "COMPRESSED"
  | "MIXED";

export interface RegimeFeatures {
  regime: MarketRegime;
  confidence: number;
  trendScore: number;
  volatilityRatio: number;
  momentumScore: number;
  compressionScore: number;
  directionalEfficiency: number;
  session: "ASIA" | "LONDON" | "NEW_YORK" | "OFF";
  transition: boolean;
  previousRegime: MarketRegime | null;
  reasons: string[];
}

export interface RegimeRoute {
  family: StrategyFamily;
  weight: number;
  reason: string;
}

export interface RegimeIntelligence {
  symbol: MarketSnapshot["symbol"];
  features: RegimeFeatures;
  routes: RegimeRoute[];
  blockedFamilies: StrategyFamily[];
  generatedAt: number;
}

function sessionOf(time: number): RegimeFeatures["session"] {
  const hour = new Date(time).getUTCHours();
  if (hour < 7) return "ASIA";
  if (hour < 12) return "LONDON";
  if (hour < 21) return "NEW_YORK";
  return "OFF";
}

function mean(values: number[]): number {
  return values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0;
}

function classify(candles: Candle[]): Omit<RegimeFeatures, "transition" | "previousRegime"> {
  if (candles.length < 60) {
    return {
      regime: "MIXED",
      confidence: 0,
      trendScore: 0,
      volatilityRatio: 1,
      momentumScore: 0,
      compressionScore: 0,
      directionalEfficiency: 0,
      session: sessionOf(candles.at(-1)?.time ?? Date.now()),
      reasons: ["Insufficient history for reliable regime classification."],
    };
  }
  const recent = candles.slice(-20);
  const prior = candles.slice(-60, -20);
  const ranges = recent.map((c) => c.high - c.low);
  const priorRanges = prior.map((c) => c.high - c.low);
  const recentRange = Math.max(0.000001, mean(ranges));
  const priorRange = Math.max(0.000001, mean(priorRanges));
  const change = recent.at(-1)!.close - recent[0].open;
  const path = recent.slice(1).reduce((s, c, i) => s + Math.abs(c.close - recent[i].close), 0);
  const efficiency = path > 0 ? Math.abs(change) / path : 0;
  const momentumScore = Math.max(-1, Math.min(1, change / Math.max(0.000001, recentRange * 10)));
  const trendScore = Math.max(-1, Math.min(1, momentumScore * 0.6 + (efficiency - 0.5) * 0.8));
  const volatilityRatio = recentRange / priorRange;
  const compressionScore = Math.max(0, Math.min(1, 1 - volatilityRatio));
  let regime: MarketRegime = "MIXED";
  if (volatilityRatio >= 1.35) regime = "EXPANDING";
  else if (volatilityRatio <= 0.70 && efficiency < 0.45) regime = "COMPRESSED";
  else if (efficiency >= 0.58 && momentumScore > 0.08) regime = "TRENDING_UP";
  else if (efficiency >= 0.58 && momentumScore < -0.08) regime = "TRENDING_DOWN";
  else if (efficiency < 0.45) regime = "RANGING";

  const confidence = Math.round(Math.min(99, Math.max(0, 45 + efficiency * 35 + Math.abs(momentumScore) * 20)));
  return {
    regime,
    confidence,
    trendScore: Number(trendScore.toFixed(3)),
    volatilityRatio: Number(volatilityRatio.toFixed(3)),
    momentumScore: Number(momentumScore.toFixed(3)),
    compressionScore: Number(compressionScore.toFixed(3)),
    directionalEfficiency: Number(efficiency.toFixed(3)),
    session: sessionOf(candles.at(-1)!.time),
    reasons: [
      `volatility ratio=${volatilityRatio.toFixed(2)}`,
      `directional efficiency=${efficiency.toFixed(2)}`,
      `momentum=${momentumScore.toFixed(2)}`,
    ],
  };
}

function routeFor(regime: MarketRegime, session: RegimeFeatures["session"]): RegimeRoute[] {
  const map: Record<MarketRegime, Array<[StrategyFamily, number, string]>> = {
    TRENDING_UP: [["TREND", 1.3, "Directional trend regime"], ["MOMENTUM", 1.15, "Expansion can support continuation"], ["SMC", 1.05, "Structure/liquidity confirmation"], ["BREAKOUT", 1, "Conditional continuation"], ["SESSION", 0.95, "Session context"], ["REVERSAL", 0.7, "Countertrend risk"], ["MEAN_REVERSION", 0.55, "Trend is unfavorable to fading"]],
    TRENDING_DOWN: [["TREND", 1.3, "Directional trend regime"], ["MOMENTUM", 1.15, "Expansion can support continuation"], ["SMC", 1.05, "Structure/liquidity confirmation"], ["BREAKOUT", 1, "Conditional continuation"], ["SESSION", 0.95, "Session context"], ["REVERSAL", 0.7, "Countertrend risk"], ["MEAN_REVERSION", 0.55, "Trend is unfavorable to fading"]],
    EXPANDING: [["MOMENTUM", 1.25, "Volatility expansion"], ["BREAKOUT", 1.2, "Breakout regime"], ["SMC", 1.1, "Displacement/structure"], ["TREND", 1, "Directional follow-through required"], ["SESSION", 1, "Liquidity window context"], ["REVERSAL", 0.7, "Reversal requires confirmation"], ["MEAN_REVERSION", 0.5, "Avoid fading expansion"]],
    COMPRESSED: [["BREAKOUT", 1.25, "Compression favors confirmed breaks"], ["SESSION", 1.1, "Session transition can resolve compression"], ["SMC", 1, "Liquidity location"], ["TREND", 0.9, "Wait for direction"], ["MOMENTUM", 0.85, "Needs confirmed expansion"], ["REVERSAL", 0.8, "Only at validated extremes"], ["MEAN_REVERSION", 0.8, "Balanced conditions may persist"]],
    RANGING: [["MEAN_REVERSION", 1.2, "Balanced market"], ["REVERSAL", 1.1, "Range extremes can reject"], ["SMC", 1.05, "Liquidity sweeps at extremes"], ["SESSION", 1, "Session range context"], ["BREAKOUT", 0.85, "Require confirmed break"], ["TREND", 0.7, "Trend evidence is weak"], ["MOMENTUM", 0.65, "Expansion not confirmed"]],
    MIXED: [["SMC", 1, "Structure remains conditional"], ["SESSION", 1, "Session context"], ["TREND", 0.9, "Directional evidence mixed"], ["BREAKOUT", 0.9, "Require confirmation"], ["REVERSAL", 0.9, "Require location"], ["MEAN_REVERSION", 0.85, "Require balanced evidence"], ["MOMENTUM", 0.8, "Require expansion"]],
  };
  return map[regime].map(([family, weight, reason]) => ({
    family,
    weight: session === "OFF" ? Number((weight * 0.9).toFixed(2)) : weight,
    reason: session === "OFF" ? reason + "; off-session penalty" : reason,
  }));
}

export function classifyMarketRegime(candles: Candle[]): RegimeFeatures {
  const current = classify(candles);
  const previous = candles.length >= 80 ? classify(candles.slice(0, -20)).regime : null;
  return {
    ...current,
    transition: Boolean(previous && previous !== current.regime),
    previousRegime: previous,
  };
}

export function buildRegimeIntelligence(symbol: MarketSnapshot["symbol"], candles: Candle[]): RegimeIntelligence {
  const features = classifyMarketRegime(candles);
  const routes = routeFor(features.regime, features.session);
  const blockedFamilies: StrategyFamily[] =
    features.regime === "COMPRESSED" ? ["MEAN_REVERSION"] :
    features.regime === "EXPANDING" ? ["MEAN_REVERSION"] : [];
  return { symbol, features, routes, blockedFamilies, generatedAt: Date.now() };
}

export function persistRegimeIntelligence(intel: RegimeIntelligence): void {
  db.prepare(
    `INSERT INTO regime_memory (
      id,symbol,session,regime,confidence,volatility_ratio,momentum_score,
      directional_efficiency,transition,previous_regime,routes_json,updated_at
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
  ).run(
    `${intel.symbol}:${intel.features.session}:${intel.features.regime}:${intel.generatedAt}`,
    intel.symbol,
    intel.features.session,
    intel.features.regime,
    intel.features.confidence,
    intel.features.volatilityRatio,
    intel.features.momentumScore,
    intel.features.directionalEfficiency,
    intel.features.transition ? 1 : 0,
    intel.features.previousRegime,
    JSON.stringify(intel.routes),
    intel.generatedAt,
  );
}

export function getRegimeRouteWeight(
  symbol: MarketSnapshot["symbol"],
  family: StrategyFamily,
  regime: MarketRegime,
): { weight: number; reason: string } {
  try {
    const row = db.prepare(
      `SELECT routes_json FROM regime_memory
       WHERE symbol=? AND regime=? ORDER BY updated_at DESC LIMIT 1`,
    ).get(symbol, regime) as { routes_json?: string } | undefined;
    if (row?.routes_json) {
      const route = (JSON.parse(row.routes_json) as RegimeRoute[]).find((item) => item.family === family);
      if (route) return { weight: route.weight, reason: route.reason };
    }
  } catch {}
  const fallback = routeFor(regime, "OFF").find((item) => item.family === family);
  return fallback ? { weight: fallback.weight, reason: fallback.reason } : { weight: 1, reason: "Neutral regime routing." };
}

export function directionForRegime(regime: MarketRegime): TradeDirection {
  return regime === "TRENDING_UP" ? "LONG" : regime === "TRENDING_DOWN" ? "SHORT" : "NONE";
}
