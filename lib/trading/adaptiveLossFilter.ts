import type { BacktestTrade } from "./backtest";

export interface AdaptiveLossFilterOptions {
  minimumTrades?: number;
  confidenceZ?: number;
  maxWilsonWinRate?: number;
  requireNegativeExpectancy?: boolean;
}

export interface AdaptiveLossGroup {
  key: string;
  strategy: string;
  side: "LONG" | "SHORT";
  session: string;
  trades: number;
  wins: number;
  losses: number;
  winRate: number;
  wilsonUpperWinRate: number;
  expectancyR: number;
  profitFactor: number;
  breakEvenWinRate: number;
  blocked: boolean;
  reason: string;
}

export interface AdaptiveLossFilter {
  version: "5.10.1";
  minimumTrades: number;
  confidenceZ: number;
  groups: AdaptiveLossGroup[];
  blockedKeys: string[];
  blockedStrategies: string[];
  isBlocked(entryReason: string): { blocked: boolean; key: string; reason: string };
}

function parseEntryReason(entryReason: string): {
  session: string;
  side: "LONG" | "SHORT";
  strategy: string;
} | null {
  const match = entryReason.match(/^([^;]+);\\s*(LONG|SHORT)\\s+([^;]+);/i);
  if (!match) return null;
  return {
    session: match[1]!.trim(),
    side: match[2]!.toUpperCase() as "LONG" | "SHORT",
    strategy: match[3]!.trim(),
  };
}

function keyOf(session: string, side: string, strategy: string): string {
  return [session, side, strategy].map((value) => value.trim().toUpperCase()).join("|");
}

function strategyKey(strategy: string): string {
  return strategy.trim().toUpperCase();
}

function wilsonUpperBound(wins: number, trades: number, z: number): number {
  if (trades <= 0) return 100;
  const p = wins / trades;
  const denominator = 1 + (z * z) / trades;
  const centre = p + (z * z) / (2 * trades);
  const spread = z * Math.sqrt((p * (1 - p) + (z * z) / (4 * trades)) / trades);
  return Math.min(1, (centre + spread) / denominator) * 100;
}

function tradeR(trade: BacktestTrade): number {
  const risk = Math.abs(trade.entryPrice - trade.stopLoss) * trade.quantity;
  return risk > 0 ? trade.pnl / risk : 0;
}

function breakEvenRate(trade: BacktestTrade): number {
  const risk = Math.abs(trade.entryPrice - trade.stopLoss);
  const reward = Math.abs(trade.takeProfit - trade.entryPrice);
  return reward > 0 ? risk / (risk + reward) : 0.5;
}

export function buildAdaptiveLossFilter(
  trades: BacktestTrade[],
  input: AdaptiveLossFilterOptions = {},
): AdaptiveLossFilter {
  const minimumTrades = Math.max(12, Math.floor(input.minimumTrades ?? 20));
  const confidenceZ = Math.max(1.64, input.confidenceZ ?? 1.96);
  const maxWilsonWinRate = Math.max(0, Math.min(100, input.maxWilsonWinRate ?? 100));
  const requireNegativeExpectancy = input.requireNegativeExpectancy ?? true;

  const groups = new Map<string, {
    session: string;
    side: "LONG" | "SHORT";
    strategy: string;
    trades: BacktestTrade[];
  }>();

  for (const trade of trades) {
    const parsed = parseEntryReason(trade.entryReason);
    if (!parsed) continue;
    const key = keyOf(parsed.session, parsed.side, parsed.strategy);
    const group = groups.get(key) ?? { ...parsed, trades: [] };
    group.trades.push(trade);
    groups.set(key, group);
  }

  const finalized: AdaptiveLossGroup[] = [];
  const blockedKeys: string[] = [];

  for (const [key, group] of groups) {
    const wins = group.trades.filter((trade) => trade.pnl > 0).length;
    const losses = group.trades.filter((trade) => trade.pnl < 0).length;
    const rs = group.trades.map(tradeR);
    const expectancyR = rs.length ? rs.reduce((sum, value) => sum + value, 0) / rs.length : 0;
    const grossWin = rs.filter((value) => value > 0).reduce((sum, value) => sum + value, 0);
    const grossLoss = Math.abs(rs.filter((value) => value < 0).reduce((sum, value) => sum + value, 0));
    const profitFactor = grossLoss > 0 ? grossWin / grossLoss : wins > 0 ? Number.POSITIVE_INFINITY : 0;
    const wilsonUpperWinRate = wilsonUpperBound(wins, group.trades.length, confidenceZ);
    const breakEvenWinRate = group.trades.length
      ? group.trades.reduce((sum, trade) => sum + breakEvenRate(trade), 0) / group.trades.length * 100
      : 50;

    const enoughData = group.trades.length >= minimumTrades;
    const statisticallyBad = enoughData &&
      wilsonUpperWinRate < Math.min(maxWilsonWinRate, breakEvenWinRate) &&
      (!requireNegativeExpectancy || expectancyR < 0);

    const blocked = statisticallyBad;
    if (blocked) blockedKeys.push(key);

    finalized.push({
      key,
      strategy: group.strategy,
      side: group.side,
      session: group.session,
      trades: group.trades.length,
      wins,
      losses,
      winRate: Number((wins / Math.max(1, group.trades.length) * 100).toFixed(2)),
      wilsonUpperWinRate: Number(wilsonUpperWinRate.toFixed(2)),
      expectancyR: Number(expectancyR.toFixed(3)),
      profitFactor: Number.isFinite(profitFactor) ? Number(profitFactor.toFixed(3)) : Number.POSITIVE_INFINITY,
      breakEvenWinRate: Number(breakEvenWinRate.toFixed(2)),
      blocked,
      reason: blocked
        ? "95% Wilson upper bound for win rate remains below the setup break-even rate and expectancy is negative."
        : enoughData
          ? "Historical evidence does not justify blocking this setup."
          : "Insufficient historical sample; setup remains neutral rather than being blocked.",
    });
  }

  finalized.sort((a, b) => {
    if (a.blocked !== b.blocked) return a.blocked ? -1 : 1;
    return b.trades - a.trades;
  });

  const blockedStrategies = [...new Set(
    finalized.filter((group) => group.blocked).map((group) => strategyKey(group.strategy)),
  )];

  const blockedSet = new Set(blockedKeys);
  return {
    version: "5.10.1",
    minimumTrades,
    confidenceZ,
    groups: finalized,
    blockedKeys,
    blockedStrategies,
    isBlocked(entryReason: string) {
      const parsed = parseEntryReason(entryReason);
      if (!parsed) return { blocked: false, key: "", reason: "Entry reason could not be parsed." };
      const key = keyOf(parsed.session, parsed.side, parsed.strategy);
      if (blockedSet.has(key)) {
        return { blocked: true, key, reason: "Statistically rejected setup family for this session/direction." };
      }
      return { blocked: false, key, reason: "No statistically significant historical rejection for this setup family." };
    },
  };
}
