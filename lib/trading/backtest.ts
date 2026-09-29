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
const MAX_TRADES_PER_SESSION_DAY = 2;

function isTradingDay(timestamp: number): boolean {
  const day = new Date(timestamp).getUTCDay();
  return day !== 0 && day !== 6;
}

function setupSignal(candles: Candle[]): { side: "LONG" | "SHORT" | null; reason: string; rewardRisk: number } {
  const tech = analyzeTechnicals(candles);
  const smc = analyzeSMC(candles);
  const current = candles.at(-1);
  if (!current || !tech.atr || !Number.isFinite(tech.atr)) {
    return { side: null, reason: "Insufficient setup data", rewardRisk: REWARD_RISK };
  }

  if (!isTradingDay(current.time)) {
    return { side: null, reason: "Weekend candle excluded", rewardRisk: REWARD_RISK };
  }

  const session = smc.chartist.session;
  if (session !== "LONDON" && session !== "NEW_YORK") {
    return { side: null, reason: "Outside London/New York trading session", rewardRisk: REWARD_RISK };
  }

  const body = Math.abs(current.close - current.open);
  const bodyAtr = tech.atr > 0 ? body / tech.atr : 0;
  if (bodyAtr < MIN_SETUP_BODY_ATR) {
    return { side: null, reason: "Setup candle body too small", rewardRisk: REWARD_RISK };
  }

  const closes = candles.map(c => c.close);
  const recent = candles.slice(-21, -1);
  const recentHigh = recent.length ? Math.max(...recent.map(c => c.high)) : current.high;
  const recentLow = recent.length ? Math.min(...recent.map(c => c.low)) : current.low;
  const breakoutLong = current.close > recentHigh && bodyAtr >= 0.55;
  const breakoutShort = current.close < recentLow && bodyAtr >= 0.55;

  const rsi = tech.rsi ?? 50;
  const adx = tech.adx ?? 0;
  const macdBull = (tech.macdHistogram ?? 0) > 0 && (tech.macd ?? 0) > (tech.macdSignal ?? 0);
  const macdBear = (tech.macdHistogram ?? 0) < 0 && (tech.macd ?? 0) < (tech.macdSignal ?? 0);
  const trendBull = (tech.trendScore ?? 0) >= 3;
  const trendBear = (tech.trendScore ?? 0) <= -3;
  const momentumBull = (tech.momentumScore ?? 0) >= 2;
  const momentumBear = (tech.momentumScore ?? 0) <= -2;
  const strongTrend = adx >= 18;
  const bullishCandle = current.close > current.open;
  const bearishCandle = current.close < current.open;
  const pullbackLong = trendBull && current.close >= (tech.emaFast ?? current.close) - tech.atr * 0.4;
  const pullbackShort = trendBear && current.close <= (tech.emaFast ?? current.close) + tech.atr * 0.4;
  const meanReversionLong = adx < 18 && rsi < 35 && current.close <= (tech.bollingerLower ?? current.close) && smc.sweepDirection === "LONG";
  const meanReversionShort = adx < 18 && rsi > 65 && current.close >= (tech.bollingerUpper ?? current.close) && smc.sweepDirection === "SHORT";

  const longScore =
    (trendBull ? 2 : 0) +
    (momentumBull ? 2 : 0) +
    (macdBull ? 1 : 0) +
    (rsi >= 52 && rsi <= 72 ? 1 : 0) +
    (strongTrend ? 1 : 0) +
    (breakoutLong ? 2 : 0) +
    (pullbackLong ? 1 : 0) +
    (smc.sweepDirection === "LONG" ? 2 : 0) +
    (smc.structureDirection === "LONG" ? 2 : 0) +
    (smc.premiumDiscount === "DISCOUNT" ? 1 : 0);

  const shortScore =
    (trendBear ? 2 : 0) +
    (momentumBear ? 2 : 0) +
    (macdBear ? 1 : 0) +
    (rsi >= 28 && rsi <= 48 ? 1 : 0) +
    (strongTrend ? 1 : 0) +
    (breakoutShort ? 2 : 0) +
    (pullbackShort ? 1 : 0) +
    (smc.sweepDirection === "SHORT" ? 2 : 0) +
    (smc.structureDirection === "SHORT" ? 2 : 0) +
    (smc.premiumDiscount === "PREMIUM" ? 1 : 0);

  const longTrendSetup = bullishCandle && longScore >= 7 && (trendBull || breakoutLong || smc.structureDirection === "LONG");
  const shortTrendSetup = bearishCandle && shortScore >= 7 && (trendBear || breakoutShort || smc.structureDirection === "SHORT");

  if (longTrendSetup || meanReversionLong) {
    const strategy = meanReversionLong ? "mean-reversion sweep" : breakoutLong ? "breakout continuation" : pullbackLong ? "EMA pullback continuation" : "multi-factor trend continuation";
    const rr = meanReversionLong ? 1.7 : breakoutLong && strongTrend ? 2.5 : 2.2;
    return {
      side: "LONG",
      rewardRisk: rr,
      reason: `London/NY; LONG ${strategy}; score ${longScore}; EMA9/21/50/200 + RSI + MACD + ADX + BB + Stochastic + SMC confluence`,
    };
  }

  if (shortTrendSetup || meanReversionShort) {
    const strategy = meanReversionShort ? "mean-reversion sweep" : breakoutShort ? "breakout continuation" : pullbackShort ? "EMA pullback continuation" : "multi-factor trend continuation";
    const rr = meanReversionShort ? 1.7 : breakoutShort && strongTrend ? 2.5 : 2.2;
    return {
      side: "SHORT",
      rewardRisk: rr,
      reason: `London/NY; SHORT ${strategy}; score ${shortScore}; EMA9/21/50/200 + RSI + MACD + ADX + BB + Stochastic + SMC confluence`,
    };
  }

  return { side: null, reason: "No multi-strategy confluence threshold", rewardRisk: REWARD_RISK };
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
    "Multi-strategy setup engine combines trend continuation, EMA pullback, breakout continuation, SMC sweep/MSS, and mean-reversion sweep logic.",
    "Technical confluence includes EMA 9/21/50/200, RSI(14), MACD(12/26/9), ADX(14), Bollinger Bands(20,2), Stochastic(14), ATR and SMC.",
    "At most two trades are allowed per London or New York session per UTC calendar day to reduce repeated entries from the same directional move.",
    "A six-candle cooldown is applied after each completed trade to reduce repeated entries from the same market move.",
    "When stop and target are both touched inside the same candle, the stop is assumed to trigger first (conservative intrabar ordering).",
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
  let lastSessionKey = "";
  const sessionTradeCounts = new Map<string, number>();

  for (let i = WARMUP_CANDLES; i < candles.length - 1; i += 1) {
    if (i - lastEntryIndex < COOLDOWN_CANDLES) continue;

    const setupCandles = candles.slice(0, i + 1);
    const signalResult = setupSignal(setupCandles);
    const side = signalResult.side;
    if (!side) continue;

    const currentSetup = setupCandles.at(-1)!;
    const currentSession = analyzeSMC(setupCandles).chartist.session;
    const sessionKey = `${new Date(currentSetup.time).toISOString().slice(0, 10)}-${currentSession}`;
    if (sessionKey === lastSessionKey) continue;
    if ((sessionTradeCounts.get(sessionKey) ?? 0) >= MAX_TRADES_PER_SESSION_DAY) continue;

    const tech = analyzeTechnicals(setupCandles);
    if (!tech.atr || !Number.isFinite(tech.atr)) continue;

    const entry = candles[i + 1].open;
    const stopDistance = Math.max(tech.atr * STOP_ATR_MULTIPLIER, entry * (MIN_STOP_PERCENT / 100));
    const stop = side === "LONG" ? entry - stopDistance : entry + stopDistance;
    const rewardRisk = signalResult.rewardRisk;
    const target = side === "LONG" ? entry + stopDistance * rewardRisk : entry - stopDistance * rewardRisk;
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
    lastSessionKey = sessionKey;
    sessionTradeCounts.set(sessionKey, (sessionTradeCounts.get(sessionKey) ?? 0) + 1);

    const exitReason =
      reason === "TARGET"
        ? `Take-profit target reached at ${rewardRisk}R.`
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
      maxTradesPerSessionDay: MAX_TRADES_PER_SESSION_DAY,
      minimumWarmupCandles: WARMUP_CANDLES,
      stopAtrMultiplier: STOP_ATR_MULTIPLIER,
      minimumStopPercent: MIN_STOP_PERCENT,
      sessionFilter: "LONDON_NEW_YORK",
      requireLiquiditySweep: false,
      requireMarketStructureShift: false,
      requireFreshFvgOrOrderBlock: false,
      requirePremiumDiscountAlignment: false,
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