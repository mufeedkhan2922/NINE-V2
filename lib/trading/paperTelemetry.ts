import type { PaperAccount, PaperPosition } from "./types";

export interface PaperTelemetry {
  closedTrades: number;
  wins: number;
  losses: number;
  winRate: number;
  netPnl: number;
  averageWin: number;
  averageLoss: number;
  expectancy: number;
  profitFactor: number;
  maxDrawdown: number;
  maxDrawdownPercent: number;
  openRiskUsd: number;
  openExposureUsd: number;
  dailyPnl: number;
  dailyPnlPercent: number;
  totalRiskPercent: number;
  lastClosedAt: number | null;
  lastOpenedAt: number | null;
}

function finite(value: number, fallback = 0): number {
  return Number.isFinite(value) ? value : fallback;
}

function closed(account: PaperAccount): PaperPosition[] {
  return account.positions.filter((position) => position.status === "CLOSED" && Number.isFinite(position.realizedPnl));
}

export function buildPaperTelemetry(account: PaperAccount): PaperTelemetry {
  const trades = closed(account);
  const wins = trades.filter((position) => (position.realizedPnl ?? 0) > 0);
  const losses = trades.filter((position) => (position.realizedPnl ?? 0) < 0);
  const netPnl = trades.reduce((sum, position) => sum + finite(position.realizedPnl ?? 0), 0);
  const grossProfit = wins.reduce((sum, position) => sum + finite(position.realizedPnl ?? 0), 0);
  const grossLoss = Math.abs(losses.reduce((sum, position) => sum + finite(position.realizedPnl ?? 0), 0));
  const averageWin = wins.length ? grossProfit / wins.length : 0;
  const averageLoss = losses.length ? grossLoss / losses.length : 0;
  const winRate = trades.length ? (wins.length / trades.length) * 100 : 0;
  const expectancy = trades.length ? netPnl / trades.length : 0;
  const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? Number.POSITIVE_INFINITY : 0;

  let runningEquity = account.initialBalance;
  let peak = account.initialBalance;
  let maxDrawdown = 0;
  for (const position of [...trades].sort((a, b) => (a.closedAt ?? 0) - (b.closedAt ?? 0))) {
    runningEquity += finite(position.realizedPnl ?? 0);
    peak = Math.max(peak, runningEquity);
    maxDrawdown = Math.max(maxDrawdown, peak - runningEquity);
  }

  const open = account.positions.filter((position) => position.status === "OPEN");
  const openRiskUsd = open.reduce(
    (sum, position) => sum + Math.abs(position.entryPrice - position.stopLoss) * position.quantity,
    0,
  );
  const openExposureUsd = open.reduce((sum, position) => sum + Math.abs(position.entryPrice * position.quantity), 0);
  const dailyLimitPercent = Math.max(0.1, Number(process.env.NINE_PAPER_MAX_DAILY_LOSS_PERCENT ?? 2));
  const dailyPnl = finite(account.dailyRealizedPnl);
  const dailyPnlPercent = account.dailyStartBalance > 0 ? (dailyPnl / account.dailyStartBalance) * 100 : 0;
  const lastClosedAt = trades.reduce<number | null>((latest, position) => {
    const value = position.closedAt ?? null;
    return value !== null && (latest === null || value > latest) ? value : latest;
  }, null);
  const lastOpenedAt = account.positions.reduce<number | null>((latest, position) => {
    const value = position.openedAt;
    return value > 0 && (latest === null || value > latest) ? value : latest;
  }, null);

  return {
    closedTrades: trades.length,
    wins: wins.length,
    losses: losses.length,
    winRate,
    netPnl,
    averageWin,
    averageLoss,
    expectancy,
    profitFactor,
    maxDrawdown,
    maxDrawdownPercent: account.initialBalance > 0 ? (maxDrawdown / account.initialBalance) * 100 : 0,
    openRiskUsd,
    openExposureUsd,
    dailyPnl,
    dailyPnlPercent,
    totalRiskPercent: account.equity > 0 ? (openRiskUsd / account.equity) * 100 : 0,
    lastClosedAt,
    lastOpenedAt,
  };
}

export function paperTelemetryHealth(
  state: string,
  updatedAt: number,
  now = Date.now(),
): {
  state: string;
  heartbeatAt: number;
  ageSeconds: number;
  healthy: boolean;
  label: "RUNNING" | "STALE" | "WAITING";
} {
  const ageSeconds = Math.max(0, (now - updatedAt) / 1000);
  const healthy = state !== "BLOCKED" && state !== "EXPIRED" && ageSeconds <= 15;
  return {
    state,
    heartbeatAt: updatedAt,
    ageSeconds,
    healthy,
    label: state === "WATCH" || state === "DETECTED" ? "WAITING" : healthy ? "RUNNING" : "STALE",
  };
}
