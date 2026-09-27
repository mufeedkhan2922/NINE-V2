import { evaluateStrategyBook, type StrategyCandidate } from "./strategyEngine";
import type { Candle, MarketSnapshot, TradeDirection } from "./types";

export interface LearningOptions {
  warmupCandles?: number;
  evaluationHorizon?: number;
  rewardRisk?: number;
  minimumScore?: number;
  spreadPrice?: number;
  slippagePrice?: number;
  minimumTrades?: number;
  targetWinRate?: number;
}

export interface StrategyLearningStats {
  strategyId: string;
  strategyName: string;
  trades: number;
  wins: number;
  losses: number;
  winRate: number;
  profitFactor: number;
  expectancyR: number;
  averageR: number;
  maxDrawdownR: number;
  qualification: "QUALIFIED" | "WATCH" | "INSUFFICIENT_DATA";
  robustnessScore: number;
  lastUpdated: number;
}

export interface AdaptiveLearningSnapshot {
  symbol: MarketSnapshot["symbol"];
  evaluatedCandles: number;
  outOfSample: boolean;
  targetWinRate: number;
  targetReached: boolean;
  robust: boolean;
  bestStrategyId: string | null;
  bestStrategyName: string | null;
  bestWinRate: number | null;
  bestRobustnessScore: number | null;
  totalEvaluatedSignals: number;
  strategies: StrategyLearningStats[];
  methodology: string[];
  generatedAt: number;
}

type MutableStats = {
  strategyId: string;
  strategyName: string;
  trades: number;
  wins: number;
  losses: number;
  rs: number[];
  equityR: number;
  peakR: number;
  maxDrawdownR: number;
};

const globalLearning = globalThis as typeof globalThis & {
  __nineAdaptiveLearningCache?: Map<string, AdaptiveLearningSnapshot>;
};

const learningCache =
  globalLearning.__nineAdaptiveLearningCache ??
  new Map<string, AdaptiveLearningSnapshot>();

globalLearning.__nineAdaptiveLearningCache = learningCache;

const DEFAULTS: Required<LearningOptions> = {
  warmupCandles: 100,
  evaluationHorizon: 12,
  rewardRisk: 2,
  minimumScore: 65,
  spreadPrice: 0,
  slippagePrice: 0,
  minimumTrades: 20,
  targetWinRate: 90,
};

function finitePositive(value: number, fallback: number): number {
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function averageTrueRange(candles: Candle[], period = 14): number {
  if (candles.length < 2) return 0;
  const ranges: number[] = [];
  for (let i = 1; i < candles.length; i += 1) {
    const current = candles[i];
    const previous = candles[i - 1];
    ranges.push(Math.max(
      current.high - current.low,
      Math.abs(current.high - previous.close),
      Math.abs(current.low - previous.close),
    ));
  }
  const sample = ranges.slice(-period);
  return sample.length ? sample.reduce((sum, value) => sum + value, 0) / sample.length : 0;
}

function effectiveEntry(rawEntry: number, direction: TradeDirection, spread: number, slippage: number): number {
  const cost = Math.max(0, spread) / 2 + Math.max(0, slippage);
  return direction === "LONG" ? rawEntry + cost : rawEntry - cost;
}

function simulateForward(
  candles: Candle[],
  signalIndex: number,
  candidate: StrategyCandidate,
  options: Required<LearningOptions>,
): number | null {
  if (candidate.direction === "NONE") return null;
  const entryBar = candles[signalIndex + 1];
  if (!entryBar) return null;

  const atr = averageTrueRange(candles.slice(0, signalIndex + 1));
  const entry = effectiveEntry(entryBar.open, candidate.direction, options.spreadPrice, options.slippagePrice);
  const stopDistance = Math.max(atr * 1.2, entry * 0.0012);
  if (!(stopDistance > 0) || !Number.isFinite(entry)) return null;

  const stop = candidate.direction === "LONG" ? entry - stopDistance : entry + stopDistance;
  const target = candidate.direction === "LONG"
    ? entry + stopDistance * options.rewardRisk
    : entry - stopDistance * options.rewardRisk;

  const end = Math.min(candles.length, signalIndex + 1 + options.evaluationHorizon);
  let lastClose = entryBar.close;

  for (let i = signalIndex + 1; i < end; i += 1) {
    const bar = candles[i];
    lastClose = bar.close;
    const stopHit = candidate.direction === "LONG" ? bar.low <= stop : bar.high >= stop;
    const targetHit = candidate.direction === "LONG" ? bar.high >= target : bar.low <= target;

    if (stopHit && targetHit) return -1;
    if (stopHit) return -1;
    if (targetHit) return options.rewardRisk;
  }

  const mark = effectiveEntry(
    lastClose,
    candidate.direction === "LONG" ? "SHORT" : "LONG",
    options.spreadPrice,
    options.slippagePrice,
  );
  return candidate.direction === "LONG"
    ? (mark - entry) / stopDistance
    : (entry - mark) / stopDistance;
}

function wilsonLowerBound(wins: number, trades: number, z = 1.96): number {
  if (trades <= 0) return 0;
  const p = wins / trades;
  const denominator = 1 + (z * z) / trades;
  const centre = p + (z * z) / (2 * trades);
  const spread = z * Math.sqrt((p * (1 - p) + (z * z) / (4 * trades)) / trades);
  return Math.max(0, (centre - spread) / denominator) * 100;
}

function finalize(stats: MutableStats, options: Required<LearningOptions>): StrategyLearningStats {
  const grossWin = stats.rs.filter((r) => r > 0).reduce((sum, r) => sum + r, 0);
  const grossLoss = Math.abs(stats.rs.filter((r) => r < 0).reduce((sum, r) => sum + r, 0));
  const averageR = stats.trades ? stats.rs.reduce((sum, r) => sum + r, 0) / stats.trades : 0;
  const winRate = stats.trades ? (stats.wins / stats.trades) * 100 : 0;
  const profitFactor = grossLoss > 0 ? grossWin / grossLoss : stats.wins > 0 ? Number.POSITIVE_INFINITY : 0;
  const lowerBound = wilsonLowerBound(stats.wins, stats.trades);

  const sampleScore = Math.min(25, (stats.trades / options.minimumTrades) * 25);
  const winScore = Math.min(45, Math.max(0, (winRate / 100) * 45));
  const pfScore = Math.min(20, Number.isFinite(profitFactor) ? Math.max(0, profitFactor) * 10 : 20);
  const drawdownPenalty = Math.min(20, stats.maxDrawdownR * 2);
  const robustnessScore = Math.max(0, Math.min(100, Math.round(sampleScore + winScore + pfScore - drawdownPenalty)));

  const qualification =
    stats.trades < options.minimumTrades
      ? "INSUFFICIENT_DATA"
      : lowerBound >= options.targetWinRate && profitFactor > 1
        ? "QUALIFIED"
        : "WATCH";

  return {
    strategyId: stats.strategyId,
    strategyName: stats.strategyName,
    trades: stats.trades,
    wins: stats.wins,
    losses: stats.losses,
    winRate: Number(winRate.toFixed(2)),
    profitFactor: Number.isFinite(profitFactor) ? Number(profitFactor.toFixed(3)) : Number.POSITIVE_INFINITY,
    expectancyR: Number(averageR.toFixed(3)),
    averageR: Number(averageR.toFixed(3)),
    maxDrawdownR: Number(stats.maxDrawdownR.toFixed(3)),
    qualification,
    robustnessScore,
    lastUpdated: Date.now(),
  };
}

export function buildAdaptiveLearningSnapshot(
  market: MarketSnapshot,
  inputOptions: LearningOptions = {},
): AdaptiveLearningSnapshot {
  const options: Required<LearningOptions> = {
    ...DEFAULTS,
    ...inputOptions,
    warmupCandles: Math.max(60, Math.floor(inputOptions.warmupCandles ?? DEFAULTS.warmupCandles)),
    evaluationHorizon: Math.max(2, Math.floor(inputOptions.evaluationHorizon ?? DEFAULTS.evaluationHorizon)),
    rewardRisk: finitePositive(inputOptions.rewardRisk ?? DEFAULTS.rewardRisk, DEFAULTS.rewardRisk),
    minimumScore: Math.max(0, Math.min(100, inputOptions.minimumScore ?? DEFAULTS.minimumScore)),
    spreadPrice: Math.max(0, inputOptions.spreadPrice ?? DEFAULTS.spreadPrice),
    slippagePrice: Math.max(0, inputOptions.slippagePrice ?? DEFAULTS.slippagePrice),
    minimumTrades: Math.max(5, Math.floor(inputOptions.minimumTrades ?? DEFAULTS.minimumTrades)),
    targetWinRate: Math.max(50, Math.min(99.9, inputOptions.targetWinRate ?? DEFAULTS.targetWinRate)),
  };

  const candles = market.candles;
  const cacheKey = [
    market.symbol,
    candles.length,
    candles.at(-1)?.time ?? 0,
    options.warmupCandles,
    options.evaluationHorizon,
    options.rewardRisk,
    options.minimumScore,
    options.spreadPrice,
    options.slippagePrice,
    options.minimumTrades,
    options.targetWinRate,
  ].join(":");

  const cached = learningCache.get(cacheKey);
  if (cached) return cached;

  const stats = new Map<string, MutableStats>();
  let totalEvaluatedSignals = 0;

  if (candles.length <= options.warmupCandles + 2) {
    const insufficient: AdaptiveLearningSnapshot = {
      symbol: market.symbol,
      evaluatedCandles: candles.length,
      outOfSample: false,
      targetWinRate: options.targetWinRate,
      targetReached: false,
      robust: false,
      bestStrategyId: null,
      bestStrategyName: null,
      bestWinRate: null,
      bestRobustnessScore: null,
      totalEvaluatedSignals: 0,
      strategies: [],
      methodology: [
        "Insufficient candles for walk-forward evaluation.",
        "No live or paper execution decision is changed by this snapshot.",
      ],
      generatedAt: Date.now(),
    };
    learningCache.set(cacheKey, insufficient);
    return insufficient;
  }

  for (let i = options.warmupCandles; i < candles.length - 1; i += 1) {
    const prefix = candles.slice(0, i + 1);
    const marketAtSignal: MarketSnapshot = {
      ...market,
      candles: prefix,
      timeframes: undefined,
      timestamp: candles[i].time,
      price: candles[i].close,
    };

    const consensus = evaluateStrategyBook(marketAtSignal);

    for (const candidate of consensus.candidates) {
      if (candidate.score < options.minimumScore || candidate.direction === "NONE") continue;

      let state = stats.get(candidate.strategyId);
      if (!state) {
        state = {
          strategyId: candidate.strategyId,
          strategyName: candidate.strategyName,
          trades: 0,
          wins: 0,
          losses: 0,
          rs: [],
          equityR: 0,
          peakR: 0,
          maxDrawdownR: 0,
        };
        stats.set(candidate.strategyId, state);
      }

      const resultR = simulateForward(candles, i, candidate, options);
      if (resultR === null || !Number.isFinite(resultR)) continue;

      totalEvaluatedSignals += 1;
      state.trades += 1;
      state.rs.push(resultR);
      state.equityR += resultR;
      state.peakR = Math.max(state.peakR, state.equityR);
      state.maxDrawdownR = Math.max(state.maxDrawdownR, state.peakR - state.equityR);

      if (resultR > 0) state.wins += 1;
      else state.losses += 1;
    }
  }

  const finalized = [...stats.values()]
    .map((state) => finalize(state, options))
    .sort((a, b) => b.robustnessScore - a.robustnessScore);

  const best = finalized[0] ?? null;
  const targetReached = Boolean(best && best.trades >= options.minimumTrades && best.winRate >= options.targetWinRate);
  const robust = Boolean(best && best.trades >= options.minimumTrades && best.profitFactor > 1 && best.expectancyR > 0);

  const snapshot: AdaptiveLearningSnapshot = {
    symbol: market.symbol,
    evaluatedCandles: candles.length,
    outOfSample: true,
    targetWinRate: options.targetWinRate,
    targetReached,
    robust,
    bestStrategyId: best?.strategyId ?? null,
    bestStrategyName: best?.strategyName ?? null,
    bestWinRate: best?.winRate ?? null,
    bestRobustnessScore: best?.robustnessScore ?? null,
    totalEvaluatedSignals,
    strategies: finalized,
    methodology: [
      "Expanding walk-forward evaluation with a fixed warm-up window.",
      "Signals are generated only from candles available at the signal timestamp.",
      "Entry occurs on the next candle open.",
      "Same-bar stop/target conflicts resolve conservatively to STOP.",
      "Optional spread and slippage are applied to entry/exit marks.",
      "Strategies are never declared proven from in-sample performance alone.",
      "The " + options.targetWinRate + "% target is a measured target, not a guaranteed win rate.",
    ],
    generatedAt: Date.now(),
  };

  learningCache.set(cacheKey, snapshot);
  if (learningCache.size > 8) {
    const oldest = learningCache.keys().next().value;
    if (oldest) learningCache.delete(oldest);
  }

  return snapshot;
}
