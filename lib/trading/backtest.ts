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
  warnings: string[];
}

const WARMUP_CANDLES = 60;
const REWARD_RISK = 2;
const STOP_ATR_MULTIPLIER = 1.2;
const MIN_STOP_PERCENT = 0.12;
const MIN_SETUP_BODY_ATR = 0.35;
const MAX_ZONE_AGE_CANDLES = 12;
const ZONE_PROXIMITY_ATR = 0.2;
const COOLDOWN_CANDLES = 6;

function setupSignal(candles: Candle[]): { side: "LONG" | "SHORT" | null; reason: string } {
  const tech = analyzeTechnicals(candles);
  const smc = analyzeSMC(candles);
  const current = candles.at(-1);
  if (!current || !tech.atr || !Number.isFinite(tech.atr)) return { side: null, reason: "Insufficient setup data" };
  const session = smc.chartist.session;
  if (session !== "LONDON" && session !== "NEW_YORK") return { side: null, reason: "Outside London/New York trading session" };
  const body = Math.abs(current.close - current.open);
  if (body < tech.atr * MIN_SETUP_BODY_ATR) return { side: null, reason: "Setup candle body too small" };
  const longTrigger = smc.sweepDirection === "LONG" || smc.structureDirection === "LONG";
  const shortTrigger = smc.sweepDirection === "SHORT" || smc.structureDirection === "SHORT";
  const recentCutoff = current.time - MAX_ZONE_AGE_CANDLES * 5 * 60 * 1000;
  const nearZone = (side: "LONG" | "SHORT") => {
    const zones = [...smc.chartist.fairValueGaps, ...smc.chartist.orderBlocks].filter((zone) => zone.direction === side && zone.createdAt >= recentCutoff);
    return zones.some((zone) => {
      const inside = current.close >= zone.low && current.close <= zone.high;
      const distance = current.close < zone.low ? zone.low - current.close : current.close > zone.high ? current.close - zone.high : 0;
      return inside || distance <= tech.atr * ZONE_PROXIMITY_ATR;
    });
  };
  if (tech.trend === "BULLISH" && tech.momentum === "BULLISH" && current.close > current.open && longTrigger) {
    const confirmations = [
      smc.sweepDirection === "LONG" ? "liquidity sweep" : "MSS/CHoCH",
      nearZone("LONG") ? "fresh FVG/OB retest" : null,
      smc.premiumDiscount === "DISCOUNT" ? "discount" : null,
    ].filter(Boolean);
    return { side: "LONG", reason: `London/NY session; bullish trend + momentum; ${confirmations.join("; ") || "directional structure trigger"}` };
  }
  if (tech.trend === "BEARISH" && tech.momentum === "BEARISH" && current.close < current.open && shortTrigger) {
    const confirmations = [
      smc.sweepDirection === "SHORT" ? "liquidity sweep" : "MSS/CHoCH",
      nearZone("SHORT") ? "fresh FVG/OB retest" : null,
      smc.premiumDiscount === "PREMIUM" ? "premium" : null,
    ].filter(Boolean);
    return { side: "SHORT", reason: `London/NY session; bearish trend + momentum; ${confirmations.join("; ") || "directional structure trigger"}` };
  }
  return { side: null, reason: "No session-aligned directional setup" };
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
  if (!Number.isFinite(initialBalance) || initialBalance <= 0) {
    throw new Error("Backtest initialBalance must be greater than zero.");
  }
  if (!Number.isFinite(riskPercent) || riskPercent <= 0 || riskPercent > 2) {
    throw new Error("Backtest riskPercent must be greater than zero and no more than 2.");
  }
  if (candles.length < WARMUP_CANDLES + 1) {
    throw new Error(`Backtest requires at least ${WARMUP_CANDLES + 1} candles.`);
  }
  for (let i = 1; i < candles.length; i += 1) {
    if (!(candles[i].time > candles[i - 1].time)) {
      throw new Error("Backtest candles must be strictly chronological.");
    }
  }

  const trades: BacktestTrade[] = [];
  const warnings = [
    "Setup filter requires London/New York session, aligned trend and momentum, liquidity sweep, MSS, premium/discount alignment, and a fresh nearby FVG/OB zone.",
    "A six-candle cooldown is applied after each completed trade to reduce repeated entries from the same market move.",
    "When stop and target are both touched inside the same candle, the stop is assumed to trigger first (conservative intrabar ordering).",
    "Setup filter requires London/New York session, aligned trend and momentum, a directional sweep or MSS/CHoCH trigger, and a decisive setup candle; fresh FVG/OB and premium/discount are recorded as confirmations.",
    "A six-candle cooldown is applied after each completed trade to reduce repeated entries from the same market move.",
    "This backtest models price movement but does not include broker commissions, financing, or spread unless already represented in the candle prices.",
    "Results are historical simulation outputs and do not establish future trading performance.",
  ];
  const equityCurve: BacktestEquityPoint[] = [{
    trade: 0,
    timestamp: candles[0]?.time ?? Date.now(),
    balance: initialBalance,
    drawdownPercent: 0,
  }];
  let balance = initialBalance;
  let peak = initialBalance;
  let maxDrawdown = 0;
  let lastEntryIndex = -Infinity;

  for (let i = WARMUP_CANDLES; i < candles.length - 1; i += 1) {
    if (i - lastEntryIndex < COOLDOWN_CANDLES) continue;

    const setupCandles = candles.slice(0, i + 1);
    const signalResult = setupSignal(setupCandles);
    const side = signalResult.side;
    if (!side) continue;

    const tech = analyzeTechnicals(setupCandles);
    if (!tech.atr || !Number.isFinite(tech.atr)) continue;

    const entry = candles[i + 1].open;
    const stopDistance = Math.max(tech.atr * STOP_ATR_MULTIPLIER, entry * (MIN_STOP_PERCENT / 100));
    const stop = side === "LONG" ? entry - stopDistance : entry + stopDistance;
    const target = side === "LONG" ? entry + stopDistance * REWARD_RISK : entry - stopDistance * REWARD_RISK;
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
        reason = stopHit ? "STOP" : "TARGET";
        exit = stopHit ? stop : target;
        exitIndex = j;
        break;
      }
      exit = bar.close;
      exitIndex = j;
    }

    const pnl = side === "LONG" ? (exit - entry) * quantity : (entry - exit) * quantity;
    balance += pnl;
    lastEntryIndex = i;
    peak = Math.max(peak, balance);
    maxDrawdown = Math.max(maxDrawdown, peak > 0 ? ((peak - balance) / peak) * 100 : 0);
    lastEntryIndex = i;

    const exitReason =
      reason === "TARGET"
        ? `Take-profit target reached at ${REWARD_RISK}R.`
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
    trades,
    config: {
      riskPercent,
      rewardRisk: REWARD_RISK,
      minimumWarmupCandles: WARMUP_CANDLES,
      stopAtrMultiplier: STOP_ATR_MULTIPLIER,
      minimumStopPercent: MIN_STOP_PERCENT,
      sessionFilter: "LONDON_NEW_YORK",
      requireLiquiditySweep: true,
      requireMarketStructureShift: true,
      requireFreshFvgOrOrderBlock: true,
      requirePremiumDiscountAlignment: true,
      requireMomentumAlignment: true,
      minimumSetupBodyAtr: MIN_SETUP_BODY_ATR,
      maxZoneAgeCandles: MAX_ZONE_AGE_CANDLES,
      zoneProximityAtr: ZONE_PROXIMITY_ATR,
      cooldownCandles: COOLDOWN_CANDLES,
      dataDriven: true,
    },
    ...analytics(trades, equityCurve, profitFactor),
    warnings,
  };
}