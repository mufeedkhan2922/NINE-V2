import { Candle } from "./types";
import { analyzeTechnicals } from "./technical";
import { analyzeSMC } from "./smc";
import type {
  BacktestAnalytics,
  BacktestDistribution,
  BacktestEquityPoint,
} from "./types";

export interface BacktestTrade {
  id: string;
  index: number;
  side: "LONG" | "SHORT";
  entryTime: number;
  exitTime: number;
  entryPrice: number;
  exitPrice: number;
  stopLoss: number;
  takeProfit: number;
  quantity: number;
  pnl: number;
  outcome: "WIN" | "LOSS";
  reason: "TARGET" | "STOP" | "END";
  entryReason: string;
  exitReason: string;
}

export interface BacktestResult extends BacktestAnalytics {
  initialBalance: number;
  finalBalance: number;
  totalTrades: number;
  wins: number;
  losses: number;
  winRate: number;
  netPnl: number;
  maxDrawdown: number;
  trades: BacktestTrade[];
  config: Record<string, number | string | boolean>;
}

function signal(candles: Candle[]): { side: "LONG" | "SHORT" | null; reason: string } {
  const tech = analyzeTechnicals(candles);
  const smc = analyzeSMC(candles);
  if (tech.trend === "BULLISH" && (smc.structureDirection === "LONG" || smc.sweepDirection === "LONG")) {
    const reasons = [
      "Technical trend bullish",
      smc.structureDirection === "LONG" ? "Market structure supports LONG" : "Liquidity sweep supports LONG",
    ];
    if (smc.fairValueGap) reasons.push("Fair value gap present");
    if (smc.orderBlock) reasons.push("Order block present");
    return { side: "LONG", reason: reasons.join("; ") };
  }
  if (tech.trend === "BEARISH" && (smc.structureDirection === "SHORT" || smc.sweepDirection === "SHORT")) {
    const reasons = [
      "Technical trend bearish",
      smc.structureDirection === "SHORT" ? "Market structure supports SHORT" : "Liquidity sweep supports SHORT",
    ];
    if (smc.fairValueGap) reasons.push("Fair value gap present");
    if (smc.orderBlock) reasons.push("Order block present");
    return { side: "SHORT", reason: reasons.join("; ") };
  }
  return { side: null, reason: "No aligned technical and SMC direction" };
}

function analytics(
  trades: BacktestTrade[],
  equityCurve: BacktestEquityPoint[],
  profitFactor: number,
): BacktestAnalytics {
  const wins = trades.filter((t) => t.pnl > 0);
  const losses = trades.filter((t) => t.pnl < 0);
  const averageWin = wins.length ? wins.reduce((s, t) => s + t.pnl, 0) / wins.length : 0;
  const averageLoss = losses.length ? losses.reduce((s, t) => s + t.pnl, 0) / losses.length : 0;
  const expectancy = trades.length ? trades.reduce((s, t) => s + t.pnl, 0) / trades.length : 0;
  const winLossRatio = averageLoss !== 0 ? Math.abs(averageWin / averageLoss) : wins.length ? Number.POSITIVE_INFINITY : 0;

  let winningStreak = 0, losingStreak = 0, currentWin = 0, currentLoss = 0;
  for (const trade of trades) {
    if (trade.outcome === "WIN") { currentWin += 1; currentLoss = 0; winningStreak = Math.max(winningStreak, currentWin); }
    else { currentLoss += 1; currentWin = 0; losingStreak = Math.max(losingStreak, currentLoss); }
  }
  const last = trades.at(-1);
  const currentStreak = last
    ? { outcome: last.outcome, count: last.outcome === "WIN" ? currentWin : currentLoss }
    : { outcome: "NONE" as const, count: 0 };

  const buckets = [
    { label: "< -2R", count: 0, pnl: 0 },
    { label: "-2R to -1R", count: 0, pnl: 0 },
    { label: "-1R to 0", count: 0, pnl: 0 },
    { label: "0 to +1R", count: 0, pnl: 0 },
    { label: "+1R to +2R", count: 0, pnl: 0 },
    { label: "> +2R", count: 0, pnl: 0 },
  ];
  for (const t of trades) {
    const risk = Math.max(0.000001, Math.abs(t.entryPrice - t.stopLoss) * t.quantity);
    const r = t.pnl / risk;
    const bucket = r < -2 ? buckets[0] : r < -1 ? buckets[1] : r < 0 ? buckets[2] : r <= 1 ? buckets[3] : r <= 2 ? buckets[4] : buckets[5];
    bucket.count += 1;
    bucket.pnl += t.pnl;
  }

  const entryReasonCounts: Record<string, number> = {};
  const exitReasonCounts: Record<string, number> = {};
  for (const t of trades) {
    entryReasonCounts[t.entryReason] = (entryReasonCounts[t.entryReason] ?? 0) + 1;
    exitReasonCounts[t.exitReason] = (exitReasonCounts[t.exitReason] ?? 0) + 1;
  }

  const distribution: BacktestDistribution = {
    buckets: buckets.map((b) => ({ ...b, pnl: Number(b.pnl.toFixed(2)) })),
    largestWin: wins.length ? Math.max(...wins.map((t) => t.pnl)) : 0,
    largestLoss: losses.length ? Math.min(...losses.map((t) => t.pnl)) : 0,
  };

  return {
    averageWin,
    averageLoss,
    expectancy,
    winLossRatio,
    profitFactor,
    winningStreak,
    losingStreak,
    currentStreak,
    equityCurve,
    distribution,
    entryReasonCounts,
    exitReasonCounts,
  };
}

export function runBacktest(
  candles: Candle[],
  initialBalance = 10000,
  riskPercent = 0.5,
): BacktestResult {
  const trades: BacktestTrade[] = [];
  const equityCurve: BacktestEquityPoint[] = [{
    trade: 0,
    timestamp: candles[0]?.time ?? Date.now(),
    balance: initialBalance,
    drawdownPercent: 0,
  }];
  let balance = initialBalance;
  let peak = initialBalance;
  let maxDrawdown = 0;

  for (let i = 60; i < candles.length - 1; i += 1) {
    const setupCandles = candles.slice(0, i + 1);
    const signalResult = signal(setupCandles);
    const side = signalResult.side;
    if (!side) continue;

    const tech = analyzeTechnicals(setupCandles);
    if (!tech.atr || !Number.isFinite(tech.atr)) continue;

    const entry = candles[i + 1].open;
    const stopDistance = Math.max(tech.atr * 1.2, entry * 0.0012);
    const stop = side === "LONG" ? entry - stopDistance : entry + stopDistance;
    const target = side === "LONG" ? entry + stopDistance * 2 : entry - stopDistance * 2;
    const riskDollars = balance * (riskPercent / 100);
    const quantity = Number((riskDollars / stopDistance).toFixed(4));
    if (!(quantity > 0)) continue;

    let exit = candles[i + 1].close;
    let reason: BacktestTrade["reason"] = "END";
    let exitIndex = i + 1;
    for (let j = i + 1; j < candles.length; j += 1) {
      const bar = candles[j];
      const stopHit = side === "LONG" ? bar.low <= stop : bar.high >= stop;
      const targetHit = side === "LONG" ? bar.high >= target : bar.low <= target;
      if (stopHit || targetHit) {
        reason = stopHit && targetHit ? "STOP" : stopHit ? "STOP" : "TARGET";
        exit = stopHit ? stop : target;
        exitIndex = j;
        break;
      }
      exit = bar.close;
      exitIndex = j;
    }

    const pnl = side === "LONG" ? (exit - entry) * quantity : (entry - exit) * quantity;
    balance += pnl;
    peak = Math.max(peak, balance);
    maxDrawdown = Math.max(maxDrawdown, peak > 0 ? ((peak - balance) / peak) * 100 : 0);

    const exitReason =
      reason === "TARGET"
        ? "Take-profit target reached at 2R."
        : reason === "STOP"
          ? "Stop-loss level reached before target."
          : "Historical data ended before target or stop was reached.";

    trades.push({
      id: `BT-${i}-${exitIndex}`,
      index: i,
      side,
      entryTime: candles[i + 1].time,
      exitTime: candles[exitIndex].time,
      entryPrice: entry,
      exitPrice: exit,
      stopLoss: stop,
      takeProfit: target,
      quantity,
      pnl,
      outcome: pnl >= 0 ? "WIN" : "LOSS",
      reason,
      entryReason: signalResult.reason,
      exitReason,
    });

    equityCurve.push({
      trade: trades.length,
      timestamp: candles[exitIndex].time,
      balance,
      drawdownPercent: peak > 0 ? ((peak - balance) / peak) * 100 : 0,
    });

    i = exitIndex;
  }

  const wins = trades.filter((t) => t.pnl > 0);
  const losses = trades.filter((t) => t.pnl < 0);
  const grossWin = wins.reduce((s, t) => s + t.pnl, 0);
  const grossLoss = Math.abs(losses.reduce((s, t) => s + t.pnl, 0));
  const profitFactor = grossLoss ? grossWin / grossLoss : wins.length ? Number.POSITIVE_INFINITY : 0;

  return {
    initialBalance,
    finalBalance: balance,
    totalTrades: trades.length,
    wins: wins.length,
    losses: losses.length,
    winRate: trades.length ? (wins.length / trades.length) * 100 : 0,
    netPnl: balance - initialBalance,
    maxDrawdown,
    profitFactor,
    trades,
    config: {
      riskPercent,
      rewardRisk: 2,
      minimumWarmupCandles: 60,
      stopAtrMultiplier: 1.2,
      minimumStopPercent: 0.12,
      dataDriven: true,
    },
    ...analytics(trades, equityCurve, profitFactor),
  };
}
