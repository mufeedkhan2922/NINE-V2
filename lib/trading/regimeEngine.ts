import type { Candle, MarketSnapshot, TradeDirection } from "./types";
import type { StrategyCandidate, StrategyConsensus } from "./strategyEngine";

export type V55Regime =
  | "TREND"
  | "RANGE"
  | "EXPANSION"
  | "MANIPULATION"
  | "REVERSAL"
  | "TRANSITION"
  | "UNKNOWN";

export interface RegimeFeatures {
  trendScore: number;
  directionalEfficiency: number;
  volatilityRatio: number;
  compressionRatio: number;
  displacementScore: number;
  rangePosition: number;
  sweepDetected: boolean;
  structureShiftDetected: boolean;
}

export interface SetupRanking {
  strategyId: string;
  strategyName: string;
  direction: TradeDirection;
  baseScore: number;
  regimeAdjustment: number;
  finalScore: number;
  rank: number;
  fit: "PRIMARY" | "SECONDARY" | "DISCOURAGED";
  reason: string;
}

export interface V55RegimeEngine {
  version: "5.5.0";
  regime: V55Regime;
  confidence: number;
  features: RegimeFeatures;
  preferredFamilies: string[];
  rankedSetups: SetupRanking[];
  topSetup: SetupRanking | null;
  warnings: string[];
  generatedAt: number;
}

function clamp(value: number, min = 0, max = 100): number {
  return Math.max(min, Math.min(max, Math.round(value)));
}

function average(values: number[]): number {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

function median(values: number[]): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function atr(candles: Candle[], period: number): number {
  if (candles.length < 2) return 0;
  const values = candles.slice(1).map((candle, index) => {
    const previous = candles[index];
    return Math.max(
      candle.high - candle.low,
      Math.abs(candle.high - previous.close),
      Math.abs(candle.low - previous.close),
    );
  });
  return average(values.slice(-period));
}

function detectFeatures(candles: Candle[]): RegimeFeatures {
  if (candles.length < 20) {
    return {
      trendScore: 0,
      directionalEfficiency: 0,
      volatilityRatio: 1,
      compressionRatio: 1,
      displacementScore: 0,
      rangePosition: 50,
      sweepDetected: false,
      structureShiftDetected: false,
    };
  }

  const recent = candles.slice(-20);
  const prior = candles.slice(-60, -20);
  const recentRanges = recent.map((candle) => candle.high - candle.low);
  const priorRanges = prior.map((candle) => candle.high - candle.low);
  const recentAtr = Math.max(atr(candles, 14), 0.000001);
  const priorAtr = Math.max(average(priorRanges.slice(-14)), 0.000001);
  const path = recent.slice(1).reduce((sum, candle, index) => sum + Math.abs(candle.close - recent[index].close), 0);
  const net = Math.abs(recent.at(-1)!.close - recent[0].close);
  const directionalEfficiency = path > 0 ? net / path : 0;
  const displacement = recent.at(-1)!.close - recent[0].close;
  const displacementScore = clamp((Math.abs(displacement) / recentAtr) * 18);
  const trendScore = clamp(directionalEfficiency * 100 * 0.65 + displacementScore * 0.35);
  const volatilityRatio = recentAtr / priorAtr;
  const compressionBase = Math.max(median(priorRanges), 0.000001);
  const compressionRatio = median(recentRanges) / compressionBase;
  const lookbackHigh = Math.max(...recent.map((candle) => candle.high));
  const lookbackLow = Math.min(...recent.map((candle) => candle.low));
  const span = Math.max(lookbackHigh - lookbackLow, 0.000001);
  const rangePosition = ((recent.at(-1)!.close - lookbackLow) / span) * 100;
  const previousWindow = candles.slice(-30, -5);
  const previousHigh = previousWindow.length ? Math.max(...previousWindow.map((candle) => candle.high)) : lookbackHigh;
  const previousLow = previousWindow.length ? Math.min(...previousWindow.map((candle) => candle.low)) : lookbackLow;
  const last = candles.at(-1)!;
  const sweepDetected = (last.high > previousHigh && last.close < previousHigh) || (last.low < previousLow && last.close > previousLow);
  const mid = candles.slice(-6, -1);
  const midHigh = mid.length ? Math.max(...mid.map((candle) => candle.high)) : last.high;
  const midLow = mid.length ? Math.min(...mid.map((candle) => candle.low)) : last.low;
  const structureShiftDetected = last.close > midHigh || last.close < midLow;

  return {
    trendScore,
    directionalEfficiency,
    volatilityRatio,
    compressionRatio,
    displacementScore,
    rangePosition,
    sweepDetected,
    structureShiftDetected,
  };
}

function classify(features: RegimeFeatures, consensus: StrategyConsensus): { regime: V55Regime; confidence: number } {
  if (features.sweepDetected && features.structureShiftDetected) {
    return { regime: "REVERSAL", confidence: clamp(70 + features.trendScore * 0.2) };
  }
  if (features.volatilityRatio >= 1.35 || features.displacementScore >= 65) {
    return { regime: "EXPANSION", confidence: clamp(62 + features.volatilityRatio * 15) };
  }
  if (features.trendScore >= 58 && features.directionalEfficiency >= 0.48) {
    return { regime: "TREND", confidence: clamp(60 + features.trendScore * 0.35) };
  }
  if (features.sweepDetected && features.trendScore < 58) {
    return { regime: "MANIPULATION", confidence: clamp(62 + (58 - features.trendScore) * 0.4) };
  }
  if (features.compressionRatio <= 0.78 || features.volatilityRatio <= 0.72) {
    return { regime: "TRANSITION", confidence: clamp(58 + (1 - features.compressionRatio) * 35) };
  }
  if (consensus.regime === "RANGING" || (features.trendScore < 42 && features.volatilityRatio < 1.2)) {
    return { regime: "RANGE", confidence: clamp(58 + (42 - features.trendScore) * 0.5) };
  }
  return { regime: "UNKNOWN", confidence: 45 };
}

const FAMILY_FIT: Record<V55Regime, Partial<Record<string, number>>> = {
  TREND: { TREND: 16, SMC: 10, MOMENTUM: 12, BREAKOUT: 8, SESSION: 3, REVERSAL: -10, MEAN_REVERSION: -18 },
  RANGE: { MEAN_REVERSION: 18, REVERSAL: 14, SESSION: 10, SMC: 7, TREND: -10, BREAKOUT: -16, MOMENTUM: -12 },
  EXPANSION: { BREAKOUT: 18, MOMENTUM: 16, SMC: 10, TREND: 8, SESSION: 6, REVERSAL: -8, MEAN_REVERSION: -20 },
  MANIPULATION: { SESSION: 18, SMC: 17, REVERSAL: 15, BREAKOUT: -12, TREND: -8, MOMENTUM: -10, MEAN_REVERSION: 3 },
  REVERSAL: { SMC: 18, REVERSAL: 17, SESSION: 12, MEAN_REVERSION: 9, TREND: -8, BREAKOUT: -12, MOMENTUM: -9 },
  TRANSITION: { SMC: 12, SESSION: 10, BREAKOUT: 8, TREND: 5, REVERSAL: 5, MEAN_REVERSION: 4, MOMENTUM: 2 },
  UNKNOWN: {},
};

function conceptBonus(candidate: StrategyCandidate, regime: V55Regime): number {
  const concepts = new Set(candidate.matchedConcepts);
  let bonus = 0;
  if (regime === "TREND" && (concepts.has("trend") || concepts.has("ema-cross") || concepts.has("bos"))) bonus += 5;
  if (regime === "RANGE" && (concepts.has("premium-discount") || concepts.has("mean-reversion"))) bonus += 5;
  if (regime === "EXPANSION" && (concepts.has("range-breakout") || concepts.has("atr"))) bonus += 5;
  if ((regime === "MANIPULATION" || regime === "REVERSAL") && (concepts.has("liquidity-sweep") || concepts.has("choch"))) bonus += 6;
  return bonus;
}

function rankCandidates(candidates: StrategyCandidate[], regime: V55Regime): SetupRanking[] {
  return candidates
    .map((candidate) => {
      const familyAdjustment = FAMILY_FIT[regime][candidate.family] ?? 0;
      const bonus = conceptBonus(candidate, regime);
      const blockerPenalty = candidate.blockers.length ? Math.min(15, candidate.blockers.length * 5) : 0;
      const regimeAdjustment = familyAdjustment + bonus - blockerPenalty;
      const finalScore = clamp(candidate.score + regimeAdjustment, 0, 100);
      return {
        strategyId: candidate.strategyId,
        strategyName: candidate.strategyName,
        direction: candidate.direction,
        baseScore: clamp(candidate.score),
        regimeAdjustment,
        finalScore,
        rank: 0,
        fit: (finalScore >= 70 ? "PRIMARY" : finalScore >= 50 ? "SECONDARY" : "DISCOURAGED") as SetupRanking["fit"],
        reason: regimeAdjustment >= 10
          ? `Regime fit: ${regime} favors this strategy family.`
          : regimeAdjustment <= -8
            ? `Regime fit: ${regime} reduces this strategy's priority.`
            : `Regime fit: ${regime} is broadly compatible.`,
      };
    })
    .sort((a, b) => b.finalScore - a.finalScore)
    .map((item, index) => ({ ...item, rank: index + 1 }));
}

export function buildV55RegimeEngine(
  market: MarketSnapshot,
  consensus: StrategyConsensus,
): V55RegimeEngine {
  const features = detectFeatures(market.candles);
  const classified = classify(features, consensus);
  const rankedSetups = rankCandidates(consensus.candidates, classified.regime);
  const topSetup = rankedSetups[0] ?? null;
  const warnings: string[] = [];

  if (market.candles.length < 60) warnings.push("Regime confidence is reduced because fewer than 60 candles are available.");
  if (classified.regime === "UNKNOWN") warnings.push("Regime is unresolved; setup ranking remains informational.");
  if (rankedSetups.length && rankedSetups[0].finalScore < 50) warnings.push("No strategy currently clears the V5.5 ranking quality threshold.");
  if (features.volatilityRatio >= 1.8) warnings.push("Volatility expansion is unusually high; execution geometry may change rapidly.");
  if (features.sweepDetected && !features.structureShiftDetected) warnings.push("Liquidity sweep detected without confirmed structure shift; treat as manipulation/watch context.");

  const preferredFamilies = Object.entries(FAMILY_FIT[classified.regime])
    .filter(([, adjustment]) => (adjustment ?? 0) >= 10)
    .sort((a, b) => (b[1] ?? 0) - (a[1] ?? 0))
    .map(([family]) => family);

  return {
    version: "5.5.0",
    regime: classified.regime,
    confidence: classified.confidence,
    features,
    preferredFamilies,
    rankedSetups,
    topSetup,
    warnings,
    generatedAt: Date.now(),
  };
}
