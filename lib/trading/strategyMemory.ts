import { db } from "./db";
import type { MarketSnapshot } from "./types";

export interface StrategyMemoryWeight {
  adjustment: number;
  sampleTrades: number;
  expectancyR: number;
  winRate: number;
  source: string | null;
}

export function getStrategyMemoryWeight(
  market: MarketSnapshot,
  strategyId: string,
  sessionName: string,
  regime: string,
): StrategyMemoryWeight {
  try {
    const exact = db.prepare(
      "SELECT trades, win_rate AS winRate, expectancy_r AS expectancyR, source FROM strategy_memory WHERE strategy_id = ? AND symbol = ? AND (session = ? OR session = 'ALL') AND (regime = ? OR regime = 'ALL') ORDER BY CASE WHEN session = ? AND regime = ? THEN 0 WHEN session = ? THEN 1 WHEN regime = ? THEN 2 ELSE 3 END, updated_at DESC LIMIT 1",
    ).get(strategyId, market.symbol, sessionName, regime, sessionName, regime, sessionName, regime) as {
      trades?: number; winRate?: number; expectancyR?: number; source?: string;
    } | undefined;

    if (!exact || !Number.isFinite(Number(exact.trades)) || Number(exact.trades) < 10) {
      return { adjustment: 0, sampleTrades: 0, expectancyR: 0, winRate: 0, source: null };
    }

    const trades = Number(exact.trades);
    const expectancy = Number(exact.expectancyR ?? 0);
    const winRate = Number(exact.winRate ?? 0);
    const sampleConfidence = Math.min(1, trades / 100);
    const expectancyComponent = Math.max(-8, Math.min(8, expectancy * 6));
    const winComponent = Math.max(-4, Math.min(4, (winRate - 50) / 12.5));
    const adjustment = Number(((expectancyComponent + winComponent) * sampleConfidence).toFixed(2));

    return { adjustment, sampleTrades: trades, expectancyR: expectancy, winRate, source: exact.source ?? null };
  } catch {
    return { adjustment: 0, sampleTrades: 0, expectancyR: 0, winRate: 0, source: null };
  }
}
