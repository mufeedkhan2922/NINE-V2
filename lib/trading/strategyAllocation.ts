import { db } from "./db";
import type { MarketSnapshot, TradeDirection } from "./types";
import { NINE_STRATEGIES, type StrategyFamily } from "./strategyLibrary";

export interface StrategyAllocationStat {
  strategyId: string;
  family: StrategyFamily;
  trades: number;
  expectancyR: number;
  winRate: number;
  winRateLower95: number;
  allocationWeight: number;
  adjustment: number;
  source: string | null;
}

interface MemoryRow {
  strategy_id: string;
  strategy_name?: string;
  strategy_family?: StrategyFamily;
  trades: number;
  expectancy_r: number;
  win_rate: number;
}

function familyForStrategy(strategyId: string): StrategyFamily | undefined {
  return NINE_STRATEGIES.find((strategy) => strategy.id === strategyId)?.family;
}

function wilsonLower95(wins: number, trades: number): number {
  if (trades <= 0) return 0;
  const z = 1.96;
  const p = wins / trades;
  const denominator = 1 + (z * z) / trades;
  const centre = p + (z * z) / (2 * trades);
  const spread = z * Math.sqrt((p * (1 - p) + (z * z) / (4 * trades)) / trades);
  return Math.max(0, Math.min(1, (centre - spread) / denominator)) * 100;
}

function loadPeerRows(
  market: MarketSnapshot,
  session: string,
  regime: string,
): MemoryRow[] {
  const rows = db.prepare(
    `SELECT strategy_id, strategy_name, trades, expectancy_r, win_rate
     FROM strategy_memory
     WHERE symbol = ?
       AND (session = ? OR session = 'ALL')
       AND (regime = ? OR regime = 'ALL')
     ORDER BY CASE WHEN session = ? AND regime = ? THEN 0 WHEN session = ? THEN 1 WHEN regime = ? THEN 2 ELSE 3 END, updated_at DESC`,
  ).all(market.symbol, session, regime, session, regime, session, regime) as MemoryRow[];

  const latest = new Map<string, MemoryRow>();
  for (const row of rows) {
    if (!latest.has(row.strategy_id) && Number(row.trades) >= 10) {
      latest.set(row.strategy_id, row);
    }
  }
  return [...latest.values()];
}

function conservativeEdge(row: MemoryRow): number {
  const trades = Number(row.trades);
  const expectancy = Number(row.expectancy_r ?? 0);
  const winRate = Number(row.win_rate ?? 0);
  const wins = Math.max(0, Math.min(trades, Math.round((winRate / 100) * trades)));
  const lower = wilsonLower95(wins, trades);
  const sampleConfidence = Math.min(1, trades / 100);
  return (Math.max(-1.5, Math.min(1.5, expectancy)) * 0.7 + (lower - 50) / 100) * sampleConfidence;
}

export function calculateStrategyAllocations(
  rows: Array<{
    strategyId: string;
    family: StrategyFamily;
    trades: number;
    expectancyR: number;
    winRate: number;
  }>,
): StrategyAllocationStat[] {
  if (!rows.length) return [];
  const enriched = rows.map((row) => {
    const wins = Math.max(0, Math.min(row.trades, Math.round((row.winRate / 100) * row.trades)));
    const lower = wilsonLower95(wins, row.trades);
    const edge = conservativeEdge({
      strategy_id: row.strategyId,
      trades: row.trades,
      expectancy_r: row.expectancyR,
      win_rate: row.winRate,
    });
    return { ...row, lower, edge };
  });
  const meanEdge = enriched.reduce((sum, row) => sum + row.edge, 0) / enriched.length;
  const positive = enriched.map((row) => Math.max(0.05, 1 + (row.edge - meanEdge) * 0.55));
  const total = positive.reduce((sum, value) => sum + value, 0);
  return enriched.map((row, index) => {
    const weight = total > 0 ? (positive[index] * enriched.length) / total : 1;
    const adjustment = Math.max(-6, Math.min(6, (weight - 1) * 7));
    return {
      strategyId: row.strategyId,
      family: row.family,
      trades: row.trades,
      expectancyR: row.expectancyR,
      winRate: row.winRate,
      winRateLower95: row.lower,
      allocationWeight: Number(weight.toFixed(3)),
      adjustment: Number(adjustment.toFixed(2)),
      source: "strategy_memory",
    };
  });
}

export function getStrategyAllocationAdjustment(
  market: MarketSnapshot,
  strategyId: string,
  family: StrategyFamily,
  session: string,
  regime: string,
): StrategyAllocationStat {
  try {
    const rows = loadPeerRows(market, session, regime);
    const allocations = calculateStrategyAllocations(rows.map((row) => ({
      strategyId: row.strategy_id,
      family: familyForStrategy(row.strategy_id) ?? family,
      trades: Number(row.trades),
      expectancyR: Number(row.expectancy_r ?? 0),
      winRate: Number(row.win_rate ?? 0),
    })));
    const selected = allocations.find((item) => item.strategyId === strategyId);
    if (selected) return selected;
  } catch {
    // Allocation is advisory; failures must never block the strategy engine.
  }
  return {
    strategyId,
    family,
    trades: 0,
    expectancyR: 0,
    winRate: 0,
    winRateLower95: 0,
    allocationWeight: 1,
    adjustment: 0,
    source: null,
  };
}

export function persistStrategyAllocationSnapshot(
  market: MarketSnapshot,
  session: string,
  regime: string,
  direction: TradeDirection,
  allocations: StrategyAllocationStat[],
): void {
  const now = Date.now();
  for (const item of allocations) {
    db.prepare(
      `INSERT INTO strategy_allocation_memory (
        id,symbol,session,regime,direction,strategy_id,family,trades,
        expectancy_r,win_rate,win_rate_lower_95,allocation_weight,adjustment,source,updated_at
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    ).run(
      `${market.symbol}:${session}:${regime}:${direction}:${item.strategyId}:${now}`,
      market.symbol,
      session,
      regime,
      direction,
      item.strategyId,
      item.family,
      item.trades,
      item.expectancyR,
      item.winRate,
      item.winRateLower95,
      item.allocationWeight,
      item.adjustment,
      item.source ?? "strategy_memory",
      now,
    );
  }
}
