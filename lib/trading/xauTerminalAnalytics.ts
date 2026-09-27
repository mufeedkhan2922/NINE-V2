export type TerminalTrade = {
  id: string;
  side: "LONG" | "SHORT";
  entryPrice: number;
  exitPrice: number | null;
  quantity: number;
  pnl: number | null;
  status: "OPEN" | "CLOSED";
  openedAt?: number;
  closedAt?: number;
  reason?: string;
};

export type TerminalReplayPoint = {
  timestamp: number;
  state: string;
  event: string;
  price: number | null;
  positionId: string | null;
  reason: string;
};

export type TerminalAnalytics = {
  closedTrades: number;
  openTrades: number;
  wins: number;
  losses: number;
  winRate: number | null;
  netPnl: number;
  averageWin: number | null;
  averageLoss: number | null;
  expectancy: number | null;
  profitFactor: number | null;
  bestTrade: number | null;
  worstTrade: number | null;
  maxConsecutiveLosses: number;
  totalR: number | null;
};

function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

export function buildXAUTerminalAnalytics(positions: TerminalTrade[] = []): TerminalAnalytics {
  const closed = positions.filter((position) => position.status === "CLOSED" && finite(position.pnl));
  const open = positions.filter((position) => position.status === "OPEN");
  const wins = closed.filter((position) => (position.pnl ?? 0) > 0);
  const losses = closed.filter((position) => (position.pnl ?? 0) < 0);
  const pnl = closed.map((position) => position.pnl ?? 0);
  const grossWin = wins.reduce((sum, position) => sum + (position.pnl ?? 0), 0);
  const grossLoss = Math.abs(losses.reduce((sum, position) => sum + (position.pnl ?? 0), 0));
  let streak = 0;
  let maxStreak = 0;
  for (const position of closed) {
    if ((position.pnl ?? 0) < 0) {
      streak += 1;
      maxStreak = Math.max(maxStreak, streak);
    } else {
      streak = 0;
    }
  }
  return {
    closedTrades: closed.length,
    openTrades: open.length,
    wins: wins.length,
    losses: losses.length,
    winRate: closed.length ? (wins.length / closed.length) * 100 : null,
    netPnl: pnl.reduce((sum, value) => sum + value, 0),
    averageWin: wins.length ? grossWin / wins.length : null,
    averageLoss: losses.length ? grossLoss / losses.length : null,
    expectancy: closed.length ? pnl.reduce((sum, value) => sum + value, 0) / closed.length : null,
    profitFactor: grossLoss > 0 ? grossWin / grossLoss : wins.length ? Infinity : null,
    bestTrade: pnl.length ? Math.max(...pnl) : null,
    worstTrade: pnl.length ? Math.min(...pnl) : null,
    maxConsecutiveLosses: maxStreak,
    totalR: null,
  };
}

export function buildXAUReplayTimeline(
  history: Array<{ timestamp: number; fromState?: string | null; toState: string; reason: string; positionId?: string | null }> = [],
  events: Array<{ timestamp?: number; title?: string; detail?: string; price?: number; id?: string }> = [],
): TerminalReplayPoint[] {
  const transitions: TerminalReplayPoint[] = history.map((item) => ({
    timestamp: item.timestamp,
    state: item.toState,
    event: "STATE " + (item.fromState ?? "INIT") + " → " + item.toState,
    price: null,
    positionId: item.positionId ?? null,
    reason: item.reason,
  }));
  const decisionEvents: TerminalReplayPoint[] = events
    .filter((item) => finite(item.timestamp))
    .map((item) => ({
      timestamp: Number(item.timestamp),
      state: "MARKET EVENT",
      event: item.title ?? "MARKET EVENT",
      price: finite(item.price) ? item.price : null,
      positionId: null,
      reason: item.detail ?? "Validated decision-engine event.",
    }));
  return [...transitions, ...decisionEvents].sort((a, b) => b.timestamp - a.timestamp).slice(0, 40);
}

export function lifecycleProgress(state: string | undefined): number {
  const order = ["DETECTED", "VALIDATED", "TRACKING", "ENTERED", "MANAGING", "CLOSED"];
  const normalized = state ?? "DETECTED";
  if (normalized === "BLOCKED" || normalized === "EXPIRED") return 0;
  const index = order.indexOf(normalized);
  return index < 0 ? 0 : index / (order.length - 1);
}
