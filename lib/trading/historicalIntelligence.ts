import { evaluateStrategyBook, type StrategyCandidate } from "./strategyEngine";
import { NINE_STRATEGIES } from "./strategyLibrary";
import type { Candle, MarketSnapshot, TradeDirection } from "./types";
import { buildResearchRiskProfile, type ResearchRiskProfile } from "./researchRisk";

export interface ExecutionModel {
  spreadPrice: number;
  slippagePrice: number;
  commissionPerTrade: number;
  delayCandles: number;
  rewardRisk: number;
  stopAtrMultiplier: number;
  minimumStopPercent: number;
}

export interface HistoricalTrade {
  strategyId: string;
  strategyName: string;
  direction: TradeDirection;
  signalIndex: number;
  entryIndex: number;
  exitIndex: number;
  entryPrice: number;
  exitPrice: number;
  rMultiple: number;
  pnl: number;
  outcome: "WIN" | "LOSS" | "FLAT";
  session: "ASIA" | "LONDON" | "NEW_YORK" | "OFF";
  regime: "TRENDING_UP" | "TRENDING_DOWN" | "RANGING" | "EXPANDING" | "MIXED";
}

export interface HistoricalStrategyStats {
  strategyId: string;
  strategyName: string;
  trades: number;
  wins: number;
  losses: number;
  winRate: number;
  profitFactor: number;
  expectancyR: number;
  maxDrawdownR: number;
  sessions: Record<string, { trades: number; wins: number; winRate: number; expectancyR: number }>;
  regimes: Record<string, { trades: number; wins: number; winRate: number; expectancyR: number }>;
}

export interface WalkForwardFold {
  fold: number;
  trainStart: number;
  trainEnd: number;
  validationStart: number;
  validationEnd: number;
  selectedStrategyIds: string[];
  validationStats: HistoricalStrategyStats[];
}

export interface MonteCarloResult {
  simulations: number;
  confidence: number;
  medianReturnR: number;
  percentile5ReturnR: number;
  percentile95ReturnR: number;
  medianMaxDrawdownR: number;
  worstMaxDrawdownR: number;
  probabilityOfLoss: number;
  probabilityOfRuin: number;
}

export interface StrategyMemoryRecord {
  strategyId: string;
  strategyName: string;
  symbol: string;
  timeframe: string;
  session: string;
  regime: string;
  trades: number;
  wins: number;
  winRate: number;
  expectancyR: number;
  profitFactor: number;
  maxDrawdownR: number;
  sampleStart: number;
  sampleEnd: number;
  source: string;
  updatedAt: number;
}

export interface ResearchQuality {
  status: "INSUFFICIENT_DATA" | "WATCH" | "QUALIFIED";
  score: number;
  outOfSampleTrades: number;
  foldsEvaluated: number;
  positiveValidationFolds: number;
  foldConsistency: number;
  bestStrategyId: string | null;
  bestStrategyWinRate: number | null;
  bestStrategyWilsonLowerBound: number | null;
  explanation: string[];
}

export interface HistoricalIntelligenceResult {
  symbol: string;
  timeframe: string;
  candles: number;
  source: string;
  executionModel: ExecutionModel;
  strategyStats: HistoricalStrategyStats[];
  walkForward: WalkForwardFold[];
  selectedOutOfSample: HistoricalStrategyStats[];
  monteCarlo: MonteCarloResult | null;
  memoryRecords: StrategyMemoryRecord[];
  targetWinRate: number;
  targetReached: boolean;
  researchQuality: ResearchQuality;
  riskProfile: ResearchRiskProfile;
  generatedAt: number;
  researchIntegrity: {
    memoryExcludedFromHistoricalSignals: boolean;
    nonOverlappingTradesPerStrategy: boolean;
    monteCarloUsesOutOfSampleTrades: boolean;
    memorySource: "OUT_OF_SAMPLE";
  };
}

const DEFAULT_EXECUTION: ExecutionModel = {
  spreadPrice: 0.20,
  slippagePrice: 0.10,
  commissionPerTrade: 0,
  delayCandles: 0,
  rewardRisk: 2,
  stopAtrMultiplier: 1.2,
  minimumStopPercent: 0.0012,
};

function sessionOf(time: number): HistoricalTrade["session"] {
  const hour = new Date(time).getUTCHours();
  if (hour < 7) return "ASIA";
  if (hour < 12) return "LONDON";
  if (hour < 21) return "NEW_YORK";
  return "OFF";
}

function atr(candles: Candle[], period = 14): number {
  const values: number[] = [];
  for (let i = 1; i < candles.length; i += 1) {
    const c = candles[i];
    const p = candles[i - 1];
    values.push(Math.max(c.high - c.low, Math.abs(c.high - p.close), Math.abs(c.low - p.close)));
  }
  const sample = values.slice(-period);
  return sample.length ? sample.reduce((a, b) => a + b, 0) / sample.length : 0;
}

function regimeOf(candles: Candle[]): HistoricalTrade["regime"] {
  if (candles.length < 30) return "MIXED";
  const recent = candles.slice(-20);
  const prior = candles.slice(-60, -20);
  const recentRange = recent.reduce((s, c) => s + c.high - c.low, 0) / Math.max(1, recent.length);
  const priorRange = prior.reduce((s, c) => s + c.high - c.low, 0) / Math.max(1, prior.length);
  if (priorRange > 0 && recentRange > priorRange * 1.35) return "EXPANDING";
  const delta = candles.at(-1)!.close - candles[Math.max(0, candles.length - 20)].close;
  const average = candles.slice(-20).reduce((s, c) => s + c.close, 0) / 20;
  const dispersion = candles.slice(-20).reduce((s, c) => s + Math.abs(c.close - average), 0) / 20;
  if (delta > dispersion * 0.5) return "TRENDING_UP";
  if (delta < -dispersion * 0.5) return "TRENDING_DOWN";
  if (recentRange < priorRange * 0.7 && priorRange > 0) return "RANGING";
  return "MIXED";
}

function snapshotAt(candles: Candle[], index: number, base: MarketSnapshot): MarketSnapshot {
  return {
    ...base,
    candles: candles.slice(0, index + 1),
    price: candles[index].close,
    previousClose: candles[Math.max(0, index - 1)].close,
    timestamp: candles[index].time,
  };
}

function effectiveEntry(raw: number, direction: TradeDirection, model: ExecutionModel): number {
  const cost = Math.max(0, model.spreadPrice) / 2 + Math.max(0, model.slippagePrice);
  return direction === "LONG" ? raw + cost : raw - cost;
}

function simulate(
  candles: Candle[],
  signalIndex: number,
  candidate: StrategyCandidate,
  base: MarketSnapshot,
  model: ExecutionModel,
): HistoricalTrade | null {
  if (candidate.direction === "NONE") return null;
  const entryIndex = signalIndex + 1 + Math.max(0, Math.floor(model.delayCandles));
  const entryBar = candles[entryIndex];
  if (!entryBar) return null;

  const signalCandles = candles.slice(0, signalIndex + 1);
  const currentAtr = atr(signalCandles);
  const entry = effectiveEntry(entryBar.open, candidate.direction, model);
  const stopDistance = Math.max(currentAtr * model.stopAtrMultiplier, entry * model.minimumStopPercent);
  if (!(stopDistance > 0) || !Number.isFinite(entry)) return null;

  const stop = candidate.direction === "LONG" ? entry - stopDistance : entry + stopDistance;
  const target = candidate.direction === "LONG" ? entry + stopDistance * model.rewardRisk : entry - stopDistance * model.rewardRisk;
  let exit = entryBar.close;
  let exitIndex = entryIndex;

  for (let i = entryIndex; i < candles.length; i += 1) {
    const bar = candles[i];
    const stopHit = candidate.direction === "LONG" ? bar.low <= stop : bar.high >= stop;
    const targetHit = candidate.direction === "LONG" ? bar.high >= target : bar.low <= target;
    if (stopHit && targetHit) {
      exit = stop;
      exitIndex = i;
      break;
    }
    if (stopHit) {
      exit = stop;
      exitIndex = i;
      break;
    }
    if (targetHit) {
      exit = target;
      exitIndex = i;
      break;
    }
    exit = bar.close;
    exitIndex = i;
  }

  const gross = candidate.direction === "LONG" ? exit - entry : entry - exit;
  const commission = Math.max(0, model.commissionPerTrade);
  const pnl = gross - commission;
  const rMultiple = pnl / stopDistance;
  return {
    strategyId: candidate.strategyId,
    strategyName: candidate.strategyName,
    direction: candidate.direction,
    signalIndex,
    entryIndex,
    exitIndex,
    entryPrice: entry,
    exitPrice: exit,
    rMultiple,
    pnl,
    outcome: rMultiple > 0 ? "WIN" : rMultiple < 0 ? "LOSS" : "FLAT",
    session: sessionOf(candles[signalIndex].time),
    regime: regimeOf(signalCandles),
  };
}

function emptyBucket() {
  return { trades: 0, wins: 0, winRate: 0, expectancyR: 0 };
}

function aggregateTrades(trades: HistoricalTrade[]): HistoricalStrategyStats[] {
  return NINE_STRATEGIES.map((definition) => {
    const own = trades.filter((t) => t.strategyId === definition.id);
    const wins = own.filter((t) => t.rMultiple > 0);
    const losses = own.filter((t) => t.rMultiple < 0);
    const grossWin = wins.reduce((s, t) => s + t.rMultiple, 0);
    const grossLoss = Math.abs(losses.reduce((s, t) => s + t.rMultiple, 0));
    let equity = 0;
    let peak = 0;
    let drawdown = 0;
    for (const t of own) {
      equity += t.rMultiple;
      peak = Math.max(peak, equity);
      drawdown = Math.max(drawdown, peak - equity);
    }
    const sessions: HistoricalStrategyStats["sessions"] = {};
    const regimes: HistoricalStrategyStats["regimes"] = {};
    for (const key of ["ASIA", "LONDON", "NEW_YORK", "OFF"]) sessions[key] = emptyBucket();
    for (const key of ["TRENDING_UP", "TRENDING_DOWN", "RANGING", "EXPANDING", "MIXED"]) regimes[key] = emptyBucket();

    for (const t of own) {
      const session = sessions[t.session];
      session.trades += 1;
      if (t.rMultiple > 0) session.wins += 1;
      session.expectancyR += t.rMultiple;
      const regime = regimes[t.regime];
      regime.trades += 1;
      if (t.rMultiple > 0) regime.wins += 1;
      regime.expectancyR += t.rMultiple;
    }
    for (const bucket of [...Object.values(sessions), ...Object.values(regimes)]) {
      bucket.winRate = bucket.trades ? Number(((bucket.wins / bucket.trades) * 100).toFixed(2)) : 0;
      bucket.expectancyR = bucket.trades ? Number((bucket.expectancyR / bucket.trades).toFixed(3)) : 0;
    }

    return {
      strategyId: definition.id,
      strategyName: definition.name,
      trades: own.length,
      wins: wins.length,
      losses: losses.length,
      winRate: own.length ? Number(((wins.length / own.length) * 100).toFixed(2)) : 0,
      profitFactor: grossLoss > 0 ? Number((grossWin / grossLoss).toFixed(3)) : wins.length ? Number.POSITIVE_INFINITY : 0,
      expectancyR: own.length ? Number((own.reduce((s, t) => s + t.rMultiple, 0) / own.length).toFixed(3)) : 0,
      maxDrawdownR: Number(drawdown.toFixed(3)),
      sessions,
      regimes,
    };
  });
}

function evaluateRange(candles: Candle[], start: number, end: number, base: MarketSnapshot, model: ExecutionModel): HistoricalTrade[] {
  const trades: HistoricalTrade[] = [];
  const nextAvailable = new Map<string, number>();
  for (let i = Math.max(60, start); i < Math.min(end - 1, candles.length - 1); i += 1) {
    const consensus = evaluateStrategyBook(snapshotAt(candles, i, base), { useMemory: false });
    for (const candidate of consensus.candidates) {
      if (candidate.direction === "NONE" || candidate.score < 50) continue;
      if (i < (nextAvailable.get(candidate.strategyId) ?? start)) continue;
      const trade = simulate(candles, i, candidate, base, model);
      if (trade && trade.exitIndex < end) {
        trades.push(trade);
        nextAvailable.set(candidate.strategyId, trade.exitIndex + 1);
      }
    }
  }
  return trades;
}

function percentile(values: number[], p: number): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = (sorted.length - 1) * p;
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  if (lower === upper) return sorted[lower];
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (index - lower);
}

function wilsonLowerBound(wins: number, trades: number, z = 1.96): number {
  if (trades <= 0) return 0;
  const p = wins / trades;
  const denominator = 1 + (z * z) / trades;
  const centre = p + (z * z) / (2 * trades);
  const spread = z * Math.sqrt((p * (1 - p) + (z * z) / (4 * trades)) / trades);
  return Math.max(0, (centre - spread) / denominator) * 100;
}

function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

function monteCarlo(trades: HistoricalTrade[], simulations = 1000, riskRuinR = -20): MonteCarloResult | null {
  const rs = trades.map((t) => t.rMultiple).filter(Number.isFinite);
  if (rs.length < 10) return null;
  const random = seededRandom(rs.length * 7919 + Math.round(rs.reduce((s, r) => s + r, 0) * 100));
  const returns: number[] = [];
  const drawdowns: number[] = [];
  let ruinCount = 0;
  let lossCount = 0;
  for (let s = 0; s < simulations; s += 1) {
    let equity = 0;
    let peak = 0;
    let maxDd = 0;
    for (let i = 0; i < rs.length; i += 1) {
      equity += rs[Math.floor(random() * rs.length)];
      peak = Math.max(peak, equity);
      maxDd = Math.max(maxDd, peak - equity);
    }
    returns.push(equity);
    drawdowns.push(maxDd);
    if (equity < 0) lossCount += 1;
    if (equity <= riskRuinR) ruinCount += 1;
  }
  return {
    simulations,
    confidence: 95,
    medianReturnR: Number(percentile(returns, 0.5).toFixed(3)),
    percentile5ReturnR: Number(percentile(returns, 0.05).toFixed(3)),
    percentile95ReturnR: Number(percentile(returns, 0.95).toFixed(3)),
    medianMaxDrawdownR: Number(percentile(drawdowns, 0.5).toFixed(3)),
    worstMaxDrawdownR: Number(percentile(drawdowns, 0.95).toFixed(3)),
    probabilityOfLoss: Number(((lossCount / simulations) * 100).toFixed(2)),
    probabilityOfRuin: Number(((ruinCount / simulations) * 100).toFixed(2)),
  };
}

function walkForward(candles: Candle[], base: MarketSnapshot, model: ExecutionModel, folds = 4): { folds: WalkForwardFold[]; selected: HistoricalStrategyStats[]; oosTrades: HistoricalTrade[] } {
  const results: WalkForwardFold[] = [];
  const selectedOutOfSample: HistoricalStrategyStats[] = [];
  const oosTrades: HistoricalTrade[] = [];
  const warmup = 60;
  const segment = Math.floor((candles.length - warmup) / (folds + 1));

  for (let fold = 0; fold < folds; fold += 1) {
    const trainStart = warmup;
    const trainEnd = warmup + segment * (fold + 1);
    const validationStart = trainEnd;
    const validationEnd = Math.min(candles.length, validationStart + segment);
    if (validationEnd - validationStart < 20) continue;

    const trainTrades = evaluateRange(candles, trainStart, trainEnd, base, model);
    const trainStats = aggregateTrades(trainTrades);
    const selected = trainStats
      .filter((s) => s.trades >= 5 && s.expectancyR > 0)
      .sort((a, b) => (b.expectancyR * Math.log1p(b.trades)) - (a.expectancyR * Math.log1p(a.trades)))
      .slice(0, 3);
    const ids = new Set(selected.map((s) => s.strategyId));
    const validationTrades = evaluateRange(candles, validationStart, validationEnd, base, model)
      .filter((t) => ids.has(t.strategyId));
    oosTrades.push(...validationTrades);
    const validationStats = aggregateTrades(validationTrades);
    results.push({
      fold: fold + 1,
      trainStart: candles[trainStart]?.time ?? 0,
      trainEnd: candles[trainEnd - 1]?.time ?? 0,
      validationStart: candles[validationStart]?.time ?? 0,
      validationEnd: candles[validationEnd - 1]?.time ?? 0,
      selectedStrategyIds: [...ids],
      validationStats: validationStats.filter((s) => ids.has(s.strategyId)),
    });
    selectedOutOfSample.push(...validationStats.filter((s) => ids.has(s.strategyId) && s.trades > 0));
  }
  return { folds: results, selected: selectedOutOfSample, oosTrades };
}

export function runHistoricalIntelligence(
  candles: Candle[],
  base: MarketSnapshot,
  options: Partial<ExecutionModel> & { targetWinRate?: number; source?: string; folds?: number; monteCarloSimulations?: number } = {},
): HistoricalIntelligenceResult {
  const model: ExecutionModel = { ...DEFAULT_EXECUTION, ...options };
  const source = options.source ?? "HISTORICAL_PROVIDER";
  const stats = aggregateTrades(evaluateRange(candles, 60, candles.length, base, model));
  const wf = walkForward(candles, base, model, Math.max(2, Math.min(8, options.folds ?? 4)));
  const selectedOutOfSample = aggregateTrades(wf.oosTrades).filter((s) => s.trades > 0);
  const best = [...selectedOutOfSample].sort((a, b) => (b.expectancyR - a.expectancyR) || (b.winRate - a.winRate))[0] ?? null;
  const targetWinRate = Math.max(50, Math.min(99.9, options.targetWinRate ?? 90));
  const bestWilson = best ? wilsonLowerBound(best.wins, best.trades) : 0;
  const positiveValidationFolds = wf.folds.filter((fold) =>
    fold.validationStats.some((stat) => stat.expectancyR > 0 && stat.trades > 0),
  ).length;
  const foldConsistency = wf.folds.length ? (positiveValidationFolds / wf.folds.length) * 100 : 0;
  const oosTrades = wf.oosTrades.length;
  const sampleScore = Math.min(30, (oosTrades / 100) * 30);
  const consistencyScore = foldConsistency * 0.35;
  const confidenceScore = Math.min(25, bestWilson * 0.25);
  const expectancyScore = best && best.expectancyR > 0 ? Math.min(10, best.expectancyR * 10) : 0;
  const researchScore = Math.max(0, Math.min(100, Math.round(sampleScore + consistencyScore + confidenceScore + expectancyScore)));
  const researchStatus: ResearchQuality["status"] =
    oosTrades < 20 || wf.folds.length < 2
      ? "INSUFFICIENT_DATA"
      : researchScore >= 70 && foldConsistency >= 50
        ? "QUALIFIED"
        : "WATCH";
  const researchExplanation = [
    `OOS sample: ${oosTrades} trades across ${wf.folds.length} validation folds.`,
    `Positive validation folds: ${positiveValidationFolds}/${wf.folds.length} (${foldConsistency.toFixed(1)}%).`,
    best ? `${best.strategyName} OOS win rate is ${best.winRate.toFixed(1)}%; Wilson 95% lower bound is ${bestWilson.toFixed(1)}%.` : "No strategy produced qualifying OOS evidence.",
    researchStatus === "QUALIFIED"
      ? "Evidence meets the research qualification threshold."
      : researchStatus === "WATCH"
        ? "Evidence is usable for monitoring but is not strong enough for qualification."
        : "More out-of-sample data is required before research conclusions are considered reliable.",
  ];

  const targetReached = Boolean(
    best &&
    best.trades >= 20 &&
    best.winRate >= targetWinRate &&
    bestWilson >= Math.min(targetWinRate, 70) &&
    researchStatus === "QUALIFIED",
  );

  const memoryRecords: StrategyMemoryRecord[] = [];
  const memoryStats = aggregateTrades(wf.oosTrades);
  for (const s of memoryStats) {
    if (!s.trades) continue;
    for (const session of Object.keys(s.sessions)) {
      const bucket = s.sessions[session];
      if (bucket.trades) memoryRecords.push({
        strategyId: s.strategyId, strategyName: s.strategyName, symbol: base.symbol, timeframe: "HISTORICAL",
        session, regime: "ALL", trades: bucket.trades, wins: bucket.wins, winRate: bucket.winRate,
        expectancyR: bucket.expectancyR, profitFactor: s.profitFactor, maxDrawdownR: s.maxDrawdownR,
        sampleStart: candles[0]?.time ?? 0, sampleEnd: candles.at(-1)?.time ?? 0, source, updatedAt: Date.now(),
      });
    }
    for (const regime of Object.keys(s.regimes)) {
      const bucket = s.regimes[regime];
      if (bucket.trades) memoryRecords.push({
        strategyId: s.strategyId, strategyName: s.strategyName, symbol: base.symbol, timeframe: "HISTORICAL",
        session: "ALL", regime, trades: bucket.trades, wins: bucket.wins, winRate: bucket.winRate,
        expectancyR: bucket.expectancyR, profitFactor: s.profitFactor, maxDrawdownR: s.maxDrawdownR,
        sampleStart: candles[0]?.time ?? 0, sampleEnd: candles.at(-1)?.time ?? 0, source, updatedAt: Date.now(),
      });
    }
  }

  return {
    symbol: base.symbol,
    timeframe: "HISTORICAL",
    candles: candles.length,
    source,
    executionModel: model,
    strategyStats: stats,
    walkForward: wf.folds,
    selectedOutOfSample,
    monteCarlo: monteCarlo(wf.oosTrades, options.monteCarloSimulations ?? 1000),
    memoryRecords,
    targetWinRate,
    targetReached,
    researchQuality: {
      status: researchStatus,
      score: researchScore,
      outOfSampleTrades: oosTrades,
      foldsEvaluated: wf.folds.length,
      positiveValidationFolds,
      foldConsistency: Number(foldConsistency.toFixed(2)),
      bestStrategyId: best?.strategyId ?? null,
      bestStrategyWinRate: best?.winRate ?? null,
      bestStrategyWilsonLowerBound: best ? Number(bestWilson.toFixed(2)) : null,
      explanation: researchExplanation,
    },
    riskProfile: buildResearchRiskProfile(wf.oosTrades),
    generatedAt: Date.now(),
    researchIntegrity: {
      memoryExcludedFromHistoricalSignals: true,
      nonOverlappingTradesPerStrategy: true,
      monteCarloUsesOutOfSampleTrades: true,
      memorySource: "OUT_OF_SAMPLE",
    },
  };
}

export function rankMemory(records: StrategyMemoryRecord[]): StrategyMemoryRecord[] {
  return [...records].sort((a, b) => (b.expectancyR * Math.log1p(b.trades)) - (a.expectancyR * Math.log1p(a.trades)));
}
