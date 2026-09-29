import { getRegimeRouteWeight, type MarketRegime } from "./regimeIntelligence";
import type { MarketSnapshot } from "./types";
import type { StrategyDefinition } from "./strategyLibrary";

export interface RegimeRouteDecision {
  weight: number;
  blocked: boolean;
  reason: string;
}

export function routeStrategyByRegime(
  market: MarketSnapshot,
  strategy: StrategyDefinition,
  regime: MarketRegime,
): RegimeRouteDecision {
  const route = getRegimeRouteWeight(market.symbol, strategy.family, regime);
  const blocked = (regime === "EXPANDING" || regime === "COMPRESSED") && strategy.family === "MEAN_REVERSION";
  return {
    weight: route.weight,
    blocked,
    reason: blocked ? "Mean-reversion is blocked during volatility expansion/compression routing." : route.reason,
  };
}
