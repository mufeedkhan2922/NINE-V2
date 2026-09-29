import { Candle } from "./types";
import { analyzeTechnicals } from "./technical";
import { analyzeSMC } from "./smc";
import type { AdaptiveLossFilter } from "./adaptiveLossFilter";
import { getLessonDecision, rememberBacktestLosses } from "./lossInvestigator";
import { policyForRegime, regimeFromCandles } from "./regimePolicy";
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

function aggregateCandles(candles: Candle[], bucketMinutes: number): Candle[] {
  const buckets = new Map<number, Candle>();
  const bucketMs = bucketMinutes * 60 * 1000;
  for (const candle of candles) {
    const bucket = Math.floor(candle.time / bucketMs) * bucketMs;
    const existing = buckets.get(bucket);
    if (!existing) {
      buckets.set(bucket, { time: bucket, open: candle.open, high: candle.high, low: candle.low, close: candle.close, volume: candle.volume });
    } else {
      existing.high = Math.max(existing.high, candle.high);
      existing.low = Math.min(existing.low, candle.low);
      existing.close = candle.close;
      if (candle.volume !== undefined) existing.volume = (existing.volume ?? 0) + candle.volume;
    }
  }
  return [...buckets.values()].sort((a, b) => a.time - b.time);
}

function higherTimeframeAgreement(candles: Candle[], side: "LONG" | "SHORT"): boolean {
  const tf15 = aggregateCandles(candles, 15);
  const tf60 = aggregateCandles(candles, 60);
  if (tf15.length < 60 || tf60.length < 60) return false;
  const a15 = analyzeTechnicals(tf15);
  const a60 = analyzeTechnicals(tf60);
  const bullish15 = a15.trend === "BULLISH" && (a15.momentum === "BULLISH" || (a15.macdHistogram ?? 0) > 0);
  const bearish15 = a15.trend === "BEARISH" && (a15.momentum === "BEARISH" || (a15.macdHistogram ?? 0) < 0);
  const bullish60 = a60.trend === "BULLISH" && (a60.momentum === "BULLISH" || (a60.macdHistogram ?? 0) > 0);
  const bearish60 = a60.trend === "BEARISH" && (a60.momentum === "BEARISH" || (a60.macdHistogram ?? 0) < 0);
  return side === "LONG" ? (bullish15 && bullish60) : (bearish15 && bearish60);
}

function currentSetupSession(candle: Candle): "ASIA" | "LONDON" | "NEW_YORK" | "OFF" {
  const hour = new Date(candle.time).getUTCHours();
  if (hour < 7) return "ASIA";
  if (hour < 12) return "LONDON";
  if (hour < 21) return "NEW_YORK";
  return "OFF";
}

function isTradingDay(timestamp: number): boolean {
  const day = new Date(timestamp).getUTCDay();
  return day !== 0 && day !== 6;
}

type StrategyCandidate = {
  side: "LONG" | "SHORT";
  score: number;
  rewardRisk: number;
  strategy: string;
  reason: string;
};

export interface RejectedSignal {
  index: number;
  entryTime: number;
  side: "LONG" | "SHORT";
  entryPrice: number;
  stopLoss: number;
  takeProfit: number;
  rewardRisk: number;
  entryReason: string;
  rejectionReason: string;
}

export interface BacktestResearch {
  rejectedSignals: RejectedSignal[];
}

export interface BacktestOptions {
  research?: BacktestResearch;
  regimePolicyMode?: "OFF" | "SHADOW" | "BLOCK";
}

function utcDayKey(timestamp: number): string {
  return new Date(timestamp).toISOString().slice(0, 10);
}

function previousDayLevels(candles: Candle[]): { high: number | null; low: number | null; open: number | null; close: number | null } {
  const current = candles.at(-1);
  if (!current) return { high: null, low: null, open: null, close: null };
  const currentDay = utcDayKey(current.time);
  const days = new Map<string, Candle[]>();
  for (const candle of candles) {
    const key = utcDayKey(candle.time);
    if (key >= currentDay) continue;
    const bucket = days.get(key) ?? [];
    bucket.push(candle);
    days.set(key, bucket);
  }
  const priorDay = [...days.keys()].sort().at(-1);
  const prior = priorDay ? days.get(priorDay) ?? [] : [];
  if (!prior.length) return { high: null, low: null, open: null, close: null };
  return {
    high: Math.max(...prior.map((c) => c.high)),
    low: Math.min(...prior.map((c) => c.low)),
    open: prior[0]!.open,
    close: prior.at(-1)!.close,
  };
}

function sessionOpeningRange(
  candles: Candle[],
  session: "LONDON" | "NEW_YORK",
  minutes = 30,
): { high: number | null; low: number | null; complete: boolean } {
  const current = candles.at(-1);
  if (!current) return { high: null, low: null, complete: false };
  const day = utcDayKey(current.time);
  const startHour = session === "LONDON" ? 7 : 12;
  const start = new Date(day + "T00:00:00Z").getTime() + startHour * 60 * 60 * 1000;
  const end = start + minutes * 60 * 1000;
  const eligible = candles.filter((c) => c.time >= start && c.time < end);
  if (!eligible.length) return { high: null, low: null, complete: current.time >= end };
  return {
    high: Math.max(...eligible.map((c) => c.high)),
    low: Math.min(...eligible.map((c) => c.low)),
    complete: current.time >= end,
  };
}

function asiaRange(candles: Candle[]): { high: number | null; low: number | null } {
  const current = candles.at(-1);
  if (!current) return { high: null, low: null };
  const day = utcDayKey(current.time);
  const start = new Date(day + "T00:00:00Z").getTime();
  const end = start + 7 * 60 * 60 * 1000;
  const eligible = candles.filter((c) => c.time >= start && c.time < end);
  if (!eligible.length) return { high: null, low: null };
  return { high: Math.max(...eligible.map((c) => c.high)), low: Math.min(...eligible.map((c) => c.low)) };
}

function averageRange(candles: Candle[], lookback: number): number {
  const sample = candles.slice(-lookback);
  if (!sample.length) return 0;
  return sample.reduce((sum, candle) => sum + (candle.high - candle.low), 0) / sample.length;
}

function setupSignal(candles: Candle[]): { side: "LONG" | "SHORT" | null; reason: string; rewardRisk: number } {
  const tech = analyzeTechnicals(candles);
  const smc = analyzeSMC(candles);
  const chartist = smc.chartist;
  const current = candles.at(-1);
  if (!chartist) {
    return { side: null, reason: "Chartist analysis unavailable", rewardRisk: REWARD_RISK };
  }
  if (!current || !tech.atr || !Number.isFinite(tech.atr)) {
    return { side: null, reason: "Insufficient setup data", rewardRisk: REWARD_RISK };
  }

  if (!isTradingDay(current.time)) {
    return { side: null, reason: "Weekend candle excluded", rewardRisk: REWARD_RISK };
  }

  const session = chartist.session;
  if (session !== "LONDON" && session !== "NEW_YORK") {
    return { side: null, reason: "Outside London/New York trading session", rewardRisk: REWARD_RISK };
  }

  const body = Math.abs(current.close - current.open);
  const range = Math.max(0.000001, current.high - current.low);
  const bodyAtr = body / tech.atr;
  const closeLocation = (current.close - current.low) / range;
  const avgRange20 = averageRange(candles.slice(0, -1), 20);
  const expansion = avgRange20 > 0 ? range / avgRange20 : 1;
  if (bodyAtr < MIN_SETUP_BODY_ATR && expansion < 1.15) {
    return { side: null, reason: "Setup candle lacks displacement", rewardRisk: REWARD_RISK };
  }

  const closes = candles.map((c) => c.close);
  const recent = candles.slice(-21, -1);
  const recentHigh = recent.length ? Math.max(...recent.map((c) => c.high)) : current.high;
  const recentLow = recent.length ? Math.min(...recent.map((c) => c.low)) : current.low;
  const breakoutLong = current.close > recentHigh && bodyAtr >= 0.55;
  const breakoutShort = current.close < recentLow && bodyAtr >= 0.55;

  const prior = candles.at(-2);
  const prior20 = candles.slice(-22, -2);
  const prior20High = prior20.length ? Math.max(...prior20.map((c) => c.high)) : recentHigh;
  const prior20Low = prior20.length ? Math.min(...prior20.map((c) => c.low)) : recentLow;
  const breakoutRetestLong = Boolean(
    prior && prior.close > prior20High && current.low <= prior20High && current.close > prior20High && closeLocation >= 0.55,
  );
  const breakoutRetestShort = Boolean(
    prior && prior.close < prior20Low && current.high >= prior20Low && current.close < prior20Low && closeLocation <= 0.45,
  );

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

  const previousDay = previousDayLevels(candles);
  const pdhSweepShort = previousDay.high !== null && current.high > previousDay.high && current.close < previousDay.high;
  const pdlSweepLong = previousDay.low !== null && current.low < previousDay.low && current.close > previousDay.low;
  const previousDayBearish = previousDay.open !== null && previousDay.close !== null && previousDay.close < previousDay.open;
  const previousDayBullish = previousDay.open !== null && previousDay.close !== null && previousDay.close > previousDay.open;

  const asia = asiaRange(candles);
  const asiaSweepShort = asia.high !== null && current.high > asia.high && current.close < asia.high;
  const asiaSweepLong = asia.low !== null && current.low < asia.low && current.close > asia.low;

  const opening = sessionOpeningRange(candles, session, 30);
  const orbLong = opening.complete && opening.high !== null && current.close > opening.high && bodyAtr >= 0.55;
  const orbShort = opening.complete && opening.low !== null && current.close < opening.low && bodyAtr >= 0.55;

  const latestFvg = chartist.fairValueGaps.at(-1);
  const fvgLong = Boolean(
    latestFvg?.direction === "LONG" &&
    current.low <= latestFvg.high &&
    current.close > latestFvg.high &&
    current.close > current.open,
  );
  const fvgShort = Boolean(
    latestFvg?.direction === "SHORT" &&
    current.high >= latestFvg.low &&
    current.close < latestFvg.low &&
    current.close < current.open,
  );

  const latestOb = chartist.orderBlocks.at(-1);
  const obLong = Boolean(
    latestOb?.direction === "LONG" &&
    current.low <= latestOb.high &&
    current.close >= latestOb.low &&
    current.close > current.open,
  );
  const obShort = Boolean(
    latestOb?.direction === "SHORT" &&
    current.high >= latestOb.low &&
    current.close <= latestOb.high &&
    current.close < current.open,
  );

  const meanReversionLong =
    adx < 18 &&
    rsi < 35 &&
    current.close <= (tech.bollingerLower ?? current.close) &&
    (smc.sweepDirection === "LONG" || pdlSweepLong || asiaSweepLong);
  const meanReversionShort =
    adx < 18 &&
    rsi > 65 &&
    current.close >= (tech.bollingerUpper ?? current.close) &&
    (smc.sweepDirection === "SHORT" || pdhSweepShort || asiaSweepShort);

  const htfLong = higherTimeframeAgreement(candles, "LONG");
  const htfShort = higherTimeframeAgreement(candles, "SHORT");

  const candidates: StrategyCandidate[] = [];

  const push = (candidate: StrategyCandidate) => {
    if (candidate.score >= 7) candidates.push(candidate);
  };

  if (pdlSweepLong) {
    push({
      side: "LONG",
      score: 7 + (previousDayBullish ? 1 : 0) + (smc.structureDirection === "LONG" ? 1 : 0) +
        (smc.premiumDiscount === "DISCOUNT" ? 1 : 0) + (htfLong ? 1 : 0),
      rewardRisk: 1.8,
      strategy: "previous-day-low sweep reversal",
      reason: "PDL sweep + close back above PDL + structural/liquidity confirmation",
    });
  }
  if (pdhSweepShort) {
    push({
      side: "SHORT",
      score: 7 + (previousDayBearish ? 1 : 0) + (smc.structureDirection === "SHORT" ? 1 : 0) +
        (smc.premiumDiscount === "PREMIUM" ? 1 : 0) + (htfShort ? 1 : 0),
      rewardRisk: 1.8,
      strategy: "previous-day-high sweep reversal",
      reason: "PDH sweep + close back below PDH + structural/liquidity confirmation",
    });
  }

  if (asiaSweepLong && session === "LONDON") {
    push({
      side: "LONG",
      score: 7 + (smc.structureDirection === "LONG" ? 1 : 0) + (htfLong ? 1 : 0) +
        (smc.premiumDiscount === "DISCOUNT" ? 1 : 0),
      rewardRisk: 1.9,
      strategy: "Asia-range sweep reversal",
      reason: "Asia low sweep + London rejection + structure confirmation",
    });
  }
  if (asiaSweepShort && session === "LONDON") {
    push({
      side: "SHORT",
      score: 7 + (smc.structureDirection === "SHORT" ? 1 : 0) + (htfShort ? 1 : 0) +
        (smc.premiumDiscount === "PREMIUM" ? 1 : 0),
      rewardRisk: 1.9,
      strategy: "Asia-range sweep reversal",
      reason: "Asia high sweep + London rejection + structure confirmation",
    });
  }

  if (orbLong && bullishCandle && (trendBull || htfLong)) {
    push({
      side: "LONG",
      score: 7 + (trendBull ? 1 : 0) + (momentumBull ? 1 : 0) + (macdBull ? 1 : 0) + (htfLong ? 1 : 0),
      rewardRisk: 2.1,
      strategy: "opening-range breakout",
      reason: `${session} 30m opening-range breakout + trend/momentum confirmation`,
    });
  }
  if (orbShort && bearishCandle && (trendBear || htfShort)) {
    push({
      side: "SHORT",
      score: 7 + (trendBear ? 1 : 0) + (momentumBear ? 1 : 0) + (macdBear ? 1 : 0) + (htfShort ? 1 : 0),
      rewardRisk: 2.1,
      strategy: "opening-range breakout",
      reason: `${session} 30m opening-range breakdown + trend/momentum confirmation`,
    });
  }

  if (breakoutRetestLong && (trendBull || htfLong) && momentumBull) {
    push({
      side: "LONG",
      score: 8 + (trendBull ? 1 : 0) + (htfLong ? 1 : 0) + (smc.structureDirection === "LONG" ? 1 : 0),
      rewardRisk: 2.4,
      strategy: "breakout-retest continuation",
      reason: "20-bar breakout + same-level retest + bullish close + HTF alignment",
    });
  }
  if (breakoutRetestShort && (trendBear || htfShort) && momentumBear) {
    push({
      side: "SHORT",
      score: 8 + (trendBear ? 1 : 0) + (htfShort ? 1 : 0) + (smc.structureDirection === "SHORT" ? 1 : 0),
      rewardRisk: 2.4,
      strategy: "breakout-retest continuation",
      reason: "20-bar breakdown + same-level retest + bearish close + HTF alignment",
    });
  }

  if (fvgLong && bullishCandle && (trendBull || htfLong)) {
    push({
      side: "LONG",
      score: 7 + (trendBull ? 1 : 0) + (momentumBull ? 1 : 0) + (htfLong ? 1 : 0) +
        (smc.sweepDirection === "LONG" ? 1 : 0),
      rewardRisk: 2.2,
      strategy: "FVG continuation",
      reason: "Bullish FVG retest + displacement close + directional confirmation",
    });
  }
  if (fvgShort && bearishCandle && (trendBear || htfShort)) {
    push({
      side: "SHORT",
      score: 7 + (trendBear ? 1 : 0) + (momentumBear ? 1 : 0) + (htfShort ? 1 : 0) +
        (smc.sweepDirection === "SHORT" ? 1 : 0),
      rewardRisk: 2.2,
      strategy: "FVG continuation",
      reason: "Bearish FVG retest + displacement close + directional confirmation",
    });
  }

  if (obLong && (trendBull || htfLong) && (smc.structureDirection === "LONG" || momentumBull)) {
    push({
      side: "LONG",
      score: 7 + (trendBull ? 1 : 0) + (htfLong ? 1 : 0) + (smc.structureDirection === "LONG" ? 1 : 0),
      rewardRisk: 2.1,
      strategy: "order-block retest",
      reason: "Bullish order-block retest + trend/structure confirmation",
    });
  }
  if (obShort && (trendBear || htfShort) && (smc.structureDirection === "SHORT" || momentumBear)) {
    push({
      side: "SHORT",
      score: 7 + (trendBear ? 1 : 0) + (htfShort ? 1 : 0) + (smc.structureDirection === "SHORT" ? 1 : 0),
      rewardRisk: 2.1,
      strategy: "order-block retest",
      reason: "Bearish order-block retest + trend/structure confirmation",
    });
  }

  if (bodyAtr >= 0.9 && expansion >= 1.25 && trendBull && momentumBull && htfLong && bullishCandle) {
    push({
      side: "LONG",
      score: 9 + (macdBull ? 1 : 0) + (smc.structureDirection === "LONG" ? 1 : 0),
      rewardRisk: 2.5,
      strategy: "volatility expansion momentum",
      reason: "ATR-normalized expansion + EMA trend + momentum + 15m/1h alignment",
    });
  }
  if (bodyAtr >= 0.9 && expansion >= 1.25 && trendBear && momentumBear && htfShort && bearishCandle) {
    push({
      side: "SHORT",
      score: 9 + (macdBear ? 1 : 0) + (smc.structureDirection === "SHORT" ? 1 : 0),
      rewardRisk: 2.5,
      strategy: "volatility expansion momentum",
      reason: "ATR-normalized expansion + EMA trend + momentum + 15m/1h alignment",
    });
  }

  if (bullishCandle && trendBull && (momentumBull || macdBull) && (pullbackLong || obLong || fvgLong) && htfLong) {
    push({
      side: "LONG",
      score: 8 + (strongTrend ? 1 : 0) + (smc.premiumDiscount === "DISCOUNT" ? 1 : 0),
      rewardRisk: strongTrend ? 2.3 : 2.1,
      strategy: "EMA pullback continuation",
      reason: "EMA9/21/50/200 trend + momentum + pullback zone + HTF alignment",
    });
  }
  if (bearishCandle && trendBear && (momentumBear || macdBear) && (pullbackShort || obShort || fvgShort) && htfShort) {
    push({
      side: "SHORT",
      score: 8 + (strongTrend ? 1 : 0) + (smc.premiumDiscount === "PREMIUM" ? 1 : 0),
      rewardRisk: strongTrend ? 2.3 : 2.1,
      strategy: "EMA pullback continuation",
      reason: "EMA9/21/50/200 trend + momentum + pullback zone + HTF alignment",
    });
  }

  if (meanReversionLong) {
    push({
      side: "LONG",
      score: 8 + (pdlSweepLong ? 1 : 0) + (asiaSweepLong ? 1 : 0),
      rewardRisk: 1.6,
      strategy: "mean-reversion sweep",
      reason: "Low-ADX Bollinger exhaustion + liquidity sweep + reversal confirmation",
    });
  }
  if (meanReversionShort) {
    push({
      side: "SHORT",
      score: 8 + (pdhSweepShort ? 1 : 0) + (asiaSweepShort ? 1 : 0),
      rewardRisk: 1.6,
      strategy: "mean-reversion sweep",
      reason: "Low-ADX Bollinger exhaustion + liquidity sweep + reversal confirmation",
    });
  }

  if (breakoutLong && bullishCandle && trendBull && momentumBull && htfLong) {
    push({
      side: "LONG",
      score: 8 + (strongTrend ? 1 : 0) + (macdBull ? 1 : 0),
      rewardRisk: strongTrend ? 2.5 : 2.2,
      strategy: "breakout continuation",
      reason: "20-bar breakout + trend/momentum + 15m/1h confirmation",
    });
  }
  if (breakoutShort && bearishCandle && trendBear && momentumBear && htfShort) {
    push({
      side: "SHORT",
      score: 8 + (strongTrend ? 1 : 0) + (macdBear ? 1 : 0),
      rewardRisk: strongTrend ? 2.5 : 2.2,
      strategy: "breakout continuation",
      reason: "20-bar breakdown + trend/momentum + 15m/1h confirmation",
    });
  }

  if (!candidates.length) {
    return { side: null, reason: "No advanced multi-strategy confluence threshold", rewardRisk: REWARD_RISK };
  }

  candidates.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    if (b.rewardRisk !== a.rewardRisk) return b.rewardRisk - a.rewardRisk;
    return a.strategy.localeCompare(b.strategy);
  });

  const best = candidates[0]!;
  return {
    side: best.side,
    rewardRisk: best.rewardRisk,
    reason: `${session}; ${best.side} ${best.strategy}; quality score ${best.score}; ${best.reason}; technicals EMA9/21/50/200 + RSI + MACD + ADX + BB + Stochastic + ATR + SMC + 15m/1h`,
  };
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
  adaptiveLossFilter?: AdaptiveLossFilter,
  usePersistentLessons = true,
  options: BacktestOptions = {},
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
  const research = options.research;
  const regimePolicyMode = options.regimePolicyMode ?? "OFF";
  const warnings = [
    "Advanced ensemble setup engine evaluates previous-day liquidity sweeps, Asia-range sweeps, opening-range breakouts, breakout-retests, FVG/OB retests, volatility expansion, EMA pullbacks, breakouts, and mean-reversion.",
    "Technical confluence includes EMA 9/21/50/200, RSI(14), MACD(12/26/9), ADX(14), Bollinger Bands(20,2), Stochastic(14), ATR and SMC.",
    "Directional continuation setups use causal 15-minute and 1-hour confirmation; reversal setups require explicit liquidity rejection and remain separately gated.",
    "At most two trades are allowed per London or New York session per UTC calendar day, with a six-candle cooldown between completed trades.",
    "A six-candle cooldown is applied after each completed trade to reduce repeated entries from the same market move.",
    "Sweep-reversal stops are anchored beyond the confirmed sweep wick with a small ATR buffer; other setups use ATR/minimum-distance stops.",
    "When stop and target are both touched inside the same candle, the stop is assumed to trigger first (conservative intrabar ordering).",
    "This backtest models price movement but does not include broker commissions, financing, or spread unless already represented in the candle prices.",
    "Results are historical simulation outputs and do not establish future trading performance.",
    regimePolicyMode !== "OFF"
      ? "Regime policy " + regimePolicyMode + " is active; policy decisions remain separate from the validated baseline strategy."
      : "Regime policy is OFF; baseline strategy selection is unchanged.",
    adaptiveLossFilter
      ? `Adaptive loss filter ${adaptiveLossFilter.version} is active: only statistically rejected setup families are blocked; insufficient samples remain neutral.`
      : "No adaptive loss filter is active; this run is the unfiltered baseline.",
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
  const sessionTradeCounts = new Map<string, number>();

  for (let i = WARMUP_CANDLES; i < candles.length - 1; i += 1) {
    if (i - lastEntryIndex < COOLDOWN_CANDLES) continue;

    const setupCandles = candles.slice(0, i + 1);
    const signalResult = setupSignal(setupCandles);
    const side = signalResult.side;
    if (!side) continue;

    const currentSetup = setupCandles.at(-1)!;
    const nextCandle = candles[i + 1];
    if (!nextCandle) continue;

    const tech = analyzeTechnicals(setupCandles);
    if (!tech.atr || !Number.isFinite(tech.atr)) continue;

    const entry = nextCandle.open;
    const sweepSetup = /sweep reversal/i.test(signalResult.reason);
    const structuralStop = sweepSetup
      ? side === "LONG"
        ? currentSetup.low - tech.atr * 0.1
        : currentSetup.high + tech.atr * 0.1
      : null;
    const atrStopDistance = Math.max(tech.atr * STOP_ATR_MULTIPLIER, entry * (MIN_STOP_PERCENT / 100));
    const structuralStopDistance = structuralStop === null ? 0 : Math.abs(entry - structuralStop);
    const stopDistance = Math.max(atrStopDistance, structuralStopDistance);
    const stop = side === "LONG" ? entry - stopDistance : entry + stopDistance;
    const target = side === "LONG"
      ? entry + stopDistance * signalResult.rewardRisk
      : entry - stopDistance * signalResult.rewardRisk;

    const recordRejected = (rejectionReason: string) => {
      research?.rejectedSignals.push({
        index: i,
        entryTime: nextCandle.time,
        side,
        entryPrice: entry,
        stopLoss: stop,
        takeProfit: target,
        rewardRisk: signalResult.rewardRisk,
        entryReason: signalResult.reason,
        rejectionReason,
      });
    };

    const regime = regimeFromCandles(setupCandles);
    const regimePolicy = policyForRegime(regime);
    const strategyName = signalResult.reason
      .split(";")[1]
      ?.trim()
      .replace(/^(LONG|SHORT)\s+/i, "")
      .split(";")[0]
      ?.trim() ?? "UNKNOWN_SETUP";
    const scoreMatch = signalResult.reason.match(/quality score (\d+)/i);
    const setupScore = scoreMatch ? Number(scoreMatch[1]) : 0;
    const regimeAllows = regimePolicy.allowedFamilies.includes(strategyName) && setupScore >= regimePolicy.minimumScore;
    if (regimePolicyMode === "BLOCK" && !regimeAllows) {
      recordRejected("REGIME_POLICY: " + regimePolicy.reason);
      continue;
    }

    const adaptiveDecision = adaptiveLossFilter?.isBlocked(signalResult.reason);
    if (adaptiveDecision?.blocked) {
      recordRejected("ADAPTIVE_LOSS_FILTER: " + adaptiveDecision.reason);
      continue;
    }

    const persistentParts = signalResult.reason.split(";");
    const persistentStrategy = persistentParts[1]?.trim().replace(/^(LONG|SHORT)\s+/i, "").trim() || "UNKNOWN_SETUP";
    if (usePersistentLessons) {
      const persistentLesson = getLessonDecision("XAUUSD", persistentStrategy, currentSetupSession(currentSetup), side);
      if (persistentLesson.blocked) {
        recordRejected("PERSISTENT_LESSON: " + persistentLesson.reason);
        continue;
      }
    }
    const currentChartist = analyzeSMC(setupCandles).chartist;
    const currentSession = currentChartist?.session;
    if (currentSession !== "LONDON" && currentSession !== "NEW_YORK") continue;
    const sessionKey = `${new Date(currentSetup.time).toISOString().slice(0, 10)}-${currentSession}`;
    if ((sessionTradeCounts.get(sessionKey) ?? 0) >= MAX_TRADES_PER_SESSION_DAY) continue;

    const rewardRisk = signalResult.rewardRisk;
    const riskDollars = balance * (riskPercent / 100);
    const quantity = Number((riskDollars / stopDistance).toFixed(4));
    if (!(quantity > 0)) continue;

    let exit = nextCandle.close;
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
    peak = Math.max(peak, balance);
    maxDrawdown = Math.max(maxDrawdown, peak > 0 ? ((peak - balance) / peak) * 100 : 0);
    lastEntryIndex = i;
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
      entryTime: nextCandle.time,
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

  if (usePersistentLessons) {
    try {
      rememberBacktestLosses(trades, candles, "XAUUSD");
    } catch {
      // Persistent research memory must never break a backtest.
    }
  }

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
      rewardRisk: "DYNAMIC_BY_STRATEGY",
      maxTradesPerSessionDay: MAX_TRADES_PER_SESSION_DAY,
      minimumWarmupCandles: WARMUP_CANDLES,
      stopAtrMultiplier: STOP_ATR_MULTIPLIER,
      sweepStopMode: "SWEEP_WICK_PLUS_0.1_ATR",
      minimumStopPercent: MIN_STOP_PERCENT,
      sessionFilter: "LONDON_NEW_YORK",
      requireLiquiditySweep: false,
      requireMarketStructureShift: false,
      requireFreshFvgOrOrderBlock: false,
      requirePremiumDiscountAlignment: false,
      requireMomentumAlignment: true,
      strategyEnsemble: "LIQUIDITY_SWEEP_ASIA_SWEEP_ORB_BREAKOUT_RETEST_FVG_OB_EXPANSION_PULLBACK_BREAKOUT_MEAN_REVERSION",
      higherTimeframes: "15m+1h",
      minimumSetupBodyAtr: MIN_SETUP_BODY_ATR,
      maxZoneAgeCandles: MAX_ZONE_AGE_CANDLES,
      zoneProximityAtr: ZONE_PROXIMITY_ATR,
      cooldownCandles: COOLDOWN_CANDLES,
      dataDriven: true,
      adaptiveLossFilter: adaptiveLossFilter ? "STATISTICAL_PRIOR_LOSS_FILTER" : "OFF",\n      adaptiveLossFilterVersion: adaptiveLossFilter?.version ?? "—",\n      adaptiveMinimumTrades: adaptiveLossFilter?.minimumTrades ?? 0,\n      adaptiveBlockedSetupFamilies: adaptiveLossFilter?.blockedKeys.length ?? 0,
      regimePolicyMode,
    },
    ...analytics(trades, equityCurve, profitFactor),
    warnings,
  };
}