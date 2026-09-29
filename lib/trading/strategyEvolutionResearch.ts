import { evaluateStrategyBook } from "./strategyEngine";
import {
  buildRollingEvolutionEvaluations,
  buildEvolutionSnapshot,
  persistStrategyEvolution,
  type StrategyEvolutionSnapshot,
  type EvolutionWindowResult,
} from "./strategyEvolution";
import type { Candle, MarketSnapshot } from "./types";

export function runStrategyEvolutionResearch(
  candles: Candle[],
  symbol: MarketSnapshot["symbol"] = "XAUUSD",
): StrategyEvolutionSnapshot {
  const baseline = buildRollingEvolutionEvaluations(candles);
  const snapshot = buildEvolutionSnapshot(symbol, candles, baseline);

  // Sanity check: the real strategy book remains the source of executable candidates.
  // Evolution evidence can alter selection preference, never create an executable order.
  if (candles.length >= 40) {
    const market: MarketSnapshot = {
      symbol,
      price: candles.at(-1)!.close,
      previousClose: candles.at(-2)?.close ?? candles.at(-1)!.close,
      changePercent: 0,
      candles: candles.slice(-240),
      timestamp: candles.at(-1)!.time,
    };
    evaluateStrategyBook(market, { useMemory: true });
  }

  persistStrategyEvolution(snapshot);
  return snapshot;
}

export function evolutionSummary(snapshot: StrategyEvolutionSnapshot): string {
  const active = snapshot.records.filter((r) => r.status === "ACTIVE").length;
  const shadow = snapshot.records.filter((r) => r.status === "SHADOW").length;
  const retired = snapshot.records.filter((r) => r.status === "RETIRED").length;
  return `Evolution arena: active=${active}, shadow=${shadow}, retired=${retired}, windows=${snapshot.windows.length}. Sentinel remains the final execution authority.`;
}
