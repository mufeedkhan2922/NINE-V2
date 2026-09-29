import { analyzeSMC } from "./smc";
import { analyzeTechnicals } from "./technical";
import { NINE_STRATEGIES, type StrategyDefinition } from "./strategyLibrary";
import { getStrategyMemoryWeight } from "./strategyMemory";
import { getStrategyEvolutionAdjustment } from "./strategyEvolution";
import { buildRegimeIntelligence } from "./regimeIntelligence";
import { routeStrategyByRegime } from "./regimeRouter";
import { getStrategyAllocationAdjustment } from "./strategyAllocation";
import { arbitrateStrategies, calculateMetaAdjustment, deduplicateEvidence } from "./metaLearning";
import { getCausalDecision } from "./causalLearning";
import { getCalibrationDecision } from "./adaptiveCalibration";
import type { Candle, MarketSnapshot, TradeDirection } from "./types";

export interface StrategyCandidate {
  strategyId: string;
  strategyName: string;
  family: StrategyDefinition["family"];
  direction: TradeDirection;
  score: number;
  confidence: number;
  matchedConcepts: string[];
  reasons: string[];
  blockers: string[];
}

export interface StrategyConsensus {
  direction: TradeDirection;
  score: number;
  confidence: number;
  candidates: StrategyCandidate[];
  activeStrategies: number;
  alignedStrategies: number;
  regime: "TRENDING_UP" | "TRENDING_DOWN" | "RANGING" | "EXPANDING" | "MIXED";
  generatedAt: number;
}

function ema(values: number[], period: number): number {
  if (!values.length) return 0;
  const alpha = 2 / (period + 1);
  let value = values[0];
  for (let i = 1; i < values.length; i += 1) value = alpha * values[i] + (1 - alpha) * value;
  return value;
}

function rsi(values: number[], period = 14): number {
  if (values.length <= period) return 50;
  let gains = 0;
  let losses = 0;
  for (let i = values.length - period; i < values.length; i += 1) {
    const delta = values[i] - values[i - 1];
    if (delta > 0) gains += delta;
    else losses += Math.abs(delta);
  }
  if (losses === 0) return 100;
  const rs = gains / Math.max(0.0000001, losses);
  return 100 - 100 / (1 + rs);
}

function atr(candles: Candle[], period = 14): number {
  if (candles.length < 2) return 0;
  const values: number[] = [];
  for (let i = 1; i < candles.length; i += 1) {
    const c = candles[i];
    const p = candles[i - 1];
    values.push(Math.max(c.high - c.low, Math.abs(c.high - p.close), Math.abs(c.low - p.close)));
  }
  const sample = values.slice(-period);
  return sample.length ? sample.reduce((a, b) => a + b, 0) / sample.length : 0;
}

function session(candle?: Candle): "ASIA" | "LONDON" | "NEW_YORK" | "OFF" {
  if (!candle) return "OFF";
  const hour = new Date(candle.time).getUTCHours();
  if (hour < 7) return "ASIA";
  if (hour < 12) return "LONDON";
  if (hour < 21) return "NEW_YORK";
  return "OFF";
}

function evaluateRegime(candles: Candle[], techTrend: string): StrategyConsensus["regime"] {
  if (candles.length < 30) return "MIXED";
  const ranges = candles.slice(-20).map((c) => c.high - c.low);
  const meanRange = ranges.reduce((a, b) => a + b, 0) / Math.max(1, ranges.length);
  const priorRanges = candles.slice(-60, -20).map((c) => c.high - c.low);
  const priorMean = priorRanges.reduce((a, b) => a + b, 0) / Math.max(1, priorRanges.length);
  const displacement = candles.at(-1)!.close - candles[Math.max(0, candles.length - 20)].close;
  if (priorMean > 0 && meanRange > priorMean * 1.35) return "EXPANDING";
  if (techTrend === "BULLISH" && displacement > 0) return "TRENDING_UP";
  if (techTrend === "BEARISH" && displacement < 0) return "TRENDING_DOWN";
  if (techTrend === "NEUTRAL") return "RANGING";
  return "MIXED";
}

function scoreStrategy(strategy: StrategyDefinition, market: MarketSnapshot, candles: Candle[], useMemory = true): StrategyCandidate {
  const closes = candles.map((c) => c.close);
  const last = candles.at(-1);
  const previous = candles.at(-2);
  const tech = analyzeTechnicals(candles);
  const smc = analyzeSMC(candles);
  const fast = ema(closes.slice(-60), 9);
  const slow = ema(closes.slice(-60), 21);
  const currentRsi = rsi(closes);
  const currentAtr = atr(candles);
  const range20 = candles.slice(-20, -1);
  const rangeHigh = range20.length ? Math.max(...range20.map((c) => c.high)) : null;
  const rangeLow = range20.length ? Math.min(...range20.map((c) => c.low)) : null;
  const trendDirection: TradeDirection = tech.trend === "BULLISH" ? "LONG" : tech.trend === "BEARISH" ? "SHORT" : "NONE";
  const regime = evaluateRegime(candles, tech.trend);
  const regimeIntel = buildRegimeIntelligence(market.symbol, candles);
  const route = routeStrategyByRegime(market, strategy, regimeIntel.features.regime);
  const memory = useMemory ? getStrategyMemoryWeight(market, strategy.id, session(last), regime) : { adjustment: 0, sampleTrades: 0, expectancyR: 0, winRate: 0, source: null };
  const evolution = getStrategyEvolutionAdjustment(market, strategy.id, session(last), regime);
  const allocation = getStrategyAllocationAdjustment(market, strategy.id, strategy.family, session(last), regime);
  let direction: TradeDirection = trendDirection;
  let score = 0;
  const matchedConcepts: string[] = [];
  const reasons: string[] = [];
  const blockers: string[] = [];

  const add = (points: number, concept: string, reason: string) => {
    score += points;
    matchedConcepts.push(concept);
    reasons.push(reason);
  };

  if (strategy.id === "sweep-mss-fvg") {
    if (smc.liquiditySweep) add(30, "liquidity-sweep", smc.sweepDirection + " liquidity sweep");
    if (smc.marketStructureShift && smc.structureDirection === smc.sweepDirection) add(25, "choch", "structure confirms sweep direction");
    if (smc.fairValueGap) add(15, "fvg", "fresh imbalance present");
    if ((smc.premiumDiscount === "DISCOUNT" && direction === "LONG") || (smc.premiumDiscount === "PREMIUM" && direction === "SHORT")) add(15, "premium-discount", "location agrees with direction");
    if (!smc.liquiditySweep) blockers.push("No current liquidity sweep.");
    direction = smc.sweepDirection !== "NONE" ? smc.sweepDirection : direction;
  } else if (strategy.id === "ob-retest") {
    if (smc.orderBlock) add(35, "order-block", "order-block zone detected");
    if (smc.marketStructureShift) add(25, "bos", "structure displacement detected");
    if (direction !== "NONE") add(20, "trend", "trend agrees with order-block context");
    direction = smc.structureDirection !== "NONE" ? smc.structureDirection : direction;
  } else if (strategy.id === "ema-pullback") {
    if (direction !== "NONE") add(35, "ema-cross", "EMA structure is directional");
    if ((direction === "LONG" && last && last.close <= fast && last.close >= slow) || (direction === "SHORT" && last && last.close >= fast && last.close <= slow)) add(25, "trend", "price is testing the EMA structure");
    if (currentAtr > 0) add(15, "atr", "volatility-aware geometry available");
    if (direction === "NONE") blockers.push("No directional EMA regime.");
  } else if (strategy.id === "breakout-retest") {
    if (last && previous && rangeHigh !== null && rangeLow !== null) {
      if (last.close > rangeHigh) { direction = "LONG"; add(35, "range-breakout", "close broke the 20-bar range high"); }
      if (last.close < rangeLow) { direction = "SHORT"; add(35, "range-breakout", "close broke the 20-bar range low"); }
      if (direction !== "NONE" && ((direction === "LONG" && last.low <= rangeHigh) || (direction === "SHORT" && last.high >= rangeLow))) add(25, "breakout-retest", "breakout level was retested");
    }
    if (direction === "NONE") blockers.push("No confirmed range breakout.");
  } else if (strategy.id === "session-sweep") {
    if (smc.liquiditySweep) add(35, "liquidity-sweep", "session-compatible sweep detected");
    if (smc.marketStructureShift) add(25, "choch", "structure confirms rejection");
    if (session(last) === "LONDON" || session(last) === "NEW_YORK") add(20, "session-filter", session(last) + " liquidity window");
    direction = smc.sweepDirection !== "NONE" ? smc.sweepDirection : direction;
  } else if (strategy.id === "previous-day-rejection") {
    const high = market.previousDayHigh;
    const low = market.previousDayLow;
    if (last && high && last.high > high && last.close < high) { direction = "SHORT"; add(40, "previous-day-levels", "rejected previous-day high"); }
    if (last && low && last.low < low && last.close > low) { direction = "LONG"; add(40, "previous-day-levels", "rejected previous-day low"); }
    if (smc.marketStructureShift && smc.structureDirection === direction) add(25, "liquidity-sweep", "structure confirms level rejection");
    if (direction === "NONE") blockers.push("No previous-day rejection.");
  } else if (strategy.id === "momentum-expansion") {
    if (last && currentAtr > 0 && (last.high - last.low) > currentAtr * 1.35) add(35, "momentum-expansion", "current range exceeds recent ATR");
    if (direction !== "NONE") add(30, "trend", "expansion agrees with trend");
    if (session(last) !== "OFF") add(15, "session-filter", "active market session");
  } else if (strategy.id === "rsi-mean-reversion") {
    const balanced = tech.trend === "NEUTRAL";
    if (balanced) add(25, "mean-reversion", "trend filter is neutral");
    if (currentRsi <= 30) { direction = "LONG"; add(35, "rsi-regime", "RSI " + currentRsi.toFixed(1) + " is oversold"); }
    if (currentRsi >= 70) { direction = "SHORT"; add(35, "rsi-regime", "RSI " + currentRsi.toFixed(1) + " is overbought"); }
    if (smc.premiumDiscount !== "EQUILIBRIUM") add(15, "premium-discount", smc.premiumDiscount + " location");
    if (!balanced) blockers.push("Strong trend regime; mean reversion is filtered.");
  } else if (strategy.id === "bos-continuation") {
    if (smc.marketStructureShift) add(40, "bos", smc.structureDirection + " structure break");
    if (smc.structureDirection === trendDirection && trendDirection !== "NONE") add(25, "trend", "structure break agrees with trend");
    if (fast !== slow) add(15, "ema-cross", "EMA regime supports continuation");
    direction = smc.structureDirection !== "NONE" ? smc.structureDirection : direction;
  } else if (strategy.id === "fvg-continuation") {
    if (smc.fairValueGap) add(40, "fvg", "fresh imbalance present");
    if (direction !== "NONE") add(25, "trend", "trend direction available");
    if (smc.marketStructureShift) add(20, "momentum-expansion", "structure displacement confirms continuation");
  } else if (strategy.id === "compression-break") {
    const ranges = candles.slice(-20).map((c) => c.high - c.low);
    const median = [...ranges].sort((a, b) => a - b)[Math.floor(ranges.length / 2)] ?? 0;
    if (currentAtr > 0 && median < currentAtr * 0.85) add(30, "range-breakout", "recent ranges are compressed");
    if (last && rangeHigh !== null && last.close > rangeHigh) { direction = "LONG"; add(35, "momentum-expansion", "compression broke upward"); }
    if (last && rangeLow !== null && last.close < rangeLow) { direction = "SHORT"; add(35, "momentum-expansion", "compression broke downward"); }
    if (direction === "NONE") blockers.push("Compression exists without a confirmed break.");
  } else if (strategy.id === "multi-factor") {
    if (direction !== "NONE") add(20, "confluence", "directional technical regime");
    if (smc.liquiditySweep) add(20, "liquidity-sweep", "liquidity event");
    if (smc.marketStructureShift) add(20, "market-structure", "structure confirmation");
    if (smc.fairValueGap || smc.orderBlock) add(15, "confluence", "location evidence");
    if (smc.premiumDiscount !== "EQUILIBRIUM") add(10, "premium-discount", "location context");
    if (market.timeframes?.["1h"]?.candles?.length) add(10, "regime", "higher timeframe context available");
    if (direction === "NONE") blockers.push("No directional consensus.");
  }

  if (memory.sampleTrades > 0 && memory.adjustment !== 0) {
    score += memory.adjustment;
    reasons.push(`Historical memory adjustment ${memory.adjustment >= 0 ? "+" : ""}${memory.adjustment.toFixed(1)} from ${memory.sampleTrades} trades.`);
  }

  if (evolution.status !== "NONE") {
    score += evolution.scoreBias;
    reasons.push(`Evolution ${evolution.status.toLowerCase()} adjustment ${evolution.scoreBias >= 0 ? "+" : ""}${evolution.scoreBias.toFixed(1)} (${evolution.variantId ?? "—"}).`);
    if (evolution.status === "RETIRED") blockers.push("Evolution engine retired this strategy pending re-validation.");
  }

  if (allocation.trades >= 10 && allocation.adjustment !== 0) {
    score += allocation.adjustment;
    reasons.push(`Adaptive allocation ${allocation.allocationWeight.toFixed(2)}x; conservative context edge from ${allocation.trades} trades.`);
  }

  if (route.blocked) {
    blockers.push(route.reason);
  } else {
    const routeAdjustment = Math.round((route.weight - 1) * 18);
    score += routeAdjustment;
    reasons.push(`Regime routing ${regimeIntel.features.regime}: family weight ${route.weight.toFixed(2)}.`);
  }

  const independentConcepts = deduplicateEvidence(matchedConcepts);
  if (independentConcepts.length < matchedConcepts.length) {
    reasons.push(`Evidence de-duplication: ${matchedConcepts.length - independentConcepts.length} correlated signal(s) discounted.`);
    score -= Math.min(4, matchedConcepts.length - independentConcepts.length);
  }
  const causal = direction === "NONE" ? { blocked: false, adjustment: 0, confidence: 0, observations: 0, reason: "No directional side available for causal gating.", failureModes: [] } : getCausalDecision(market, strategy.name, direction, independentConcepts);
  if (causal.adjustment !== 0) {
    score += causal.adjustment;
    reasons.push(`Causal failure memory adjustment ${causal.adjustment.toFixed(2)} across ${causal.observations} historical observations.`);
  }
  if (causal.blocked) blockers.push(`Causal failure gate: ${causal.reason}`);

  const meta = calculateMetaAdjustment(independentConcepts.map((concept) => ({
    concept,
    observations: memory.sampleTrades,
    wins: Math.round(memory.sampleTrades * memory.winRate / 100),
    losses: Math.max(0, memory.sampleTrades - Math.round(memory.sampleTrades * memory.winRate / 100)),
  })));
  if (meta.adjustment !== 0) {
    score += meta.adjustment;
    reasons.push(`Meta-learning adjustment ${meta.adjustment >= 0 ? "+" : ""}${meta.adjustment.toFixed(2)} across independent evidence.`);
  }
  if (meta.abstain && memory.sampleTrades > 0) blockers.push("Meta-learning uncertainty is too high for confident selection.");

  if (regimeIntel.features.transition) {
    score -= 3;
    reasons.push(`Regime transition detected from ${regimeIntel.features.previousRegime ?? "UNKNOWN"} to ${regimeIntel.features.regime}; selection confidence reduced.`);
  }

  score = Math.max(0, Math.min(100, Math.round(score)));
  const rawConfidence = Math.max(0, Math.min(99, Math.round(score * 0.92 + (blockers.length ? -8 : 0))));
  const calibration = getCalibrationDecision(market, strategy.id, rawConfidence / 100);
  if (calibration.scoreAdjustment !== 0) {
    score = Math.max(0, Math.min(100, Math.round(score + calibration.scoreAdjustment)));
    reasons.push(`Adaptive calibration score adjustment ${calibration.scoreAdjustment >= 0 ? "+" : ""}${calibration.scoreAdjustment.toFixed(2)}.`);
  }
  if (calibration.status === "DRIFT") reasons.push(`Concept drift detected (${calibration.driftScore.toFixed(2)}); confidence is being discounted.`);
  if (calibration.status === "QUARANTINE") blockers.push(`Strategy quarantine: ${calibration.reason}`);
  const adaptiveMinimum = 50 + Math.round(calibration.thresholdAdjustment * 100);
  if (calibration.thresholdAdjustment > 0 && score < adaptiveMinimum) {
    blockers.push(`Adaptive confidence threshold raised to ${adaptiveMinimum}/100 by validated calibration.`);
  }
  if (calibration.riskAdjustment < 0) reasons.push(`Risk calibration suggests a ${Math.abs(calibration.riskAdjustment * 100).toFixed(1)}% risk reduction under current uncertainty.`);
  const confidence = Math.max(0, Math.min(99, Math.round(calibration.calibratedConfidence * 100)));
  return { strategyId: strategy.id, strategyName: strategy.name, family: strategy.family, direction, score, confidence, matchedConcepts: [...new Set(matchedConcepts)], reasons, blockers };
}

export function evaluateStrategyBook(market: MarketSnapshot, options: { useMemory?: boolean } = {}): StrategyConsensus {
  if (market.candles.length < 40) return { direction: "NONE", score: 0, confidence: 0, candidates: [], activeStrategies: 0, alignedStrategies: 0, regime: "MIXED", generatedAt: Date.now() };
  const candidates = NINE_STRATEGIES.map((strategy) => scoreStrategy(strategy, market, market.candles, options.useMemory !== false)).sort((a, b) => b.score - a.score);
  const active = candidates.filter((candidate) => candidate.score >= 50 && candidate.direction !== "NONE");
  const long = active.filter((candidate) => candidate.direction === "LONG");
  const short = active.filter((candidate) => candidate.direction === "SHORT");
  const arbitrated = arbitrateStrategies(candidates.map((candidate) => ({
    strategyId: candidate.strategyId,
    family: candidate.family,
    direction: candidate.direction,
    score: candidate.score,
    confidence: candidate.confidence,
    blockers: candidate.blockers,
  })));
  const direction: TradeDirection = arbitrated.abstain ? "NONE" : arbitrated.direction;
  const aligned = direction === "LONG" ? long.length : direction === "SHORT" ? short.length : 0;
  const top = candidates.slice(0, 5);
  const score = arbitrated.abstain ? 0 : (top.length ? Math.round(top.reduce((sum, candidate) => sum + candidate.score, 0) / top.length) : 0);
  const confidence = arbitrated.abstain ? 0 : arbitrated.confidence;
  const regime = evaluateRegime(market.candles, analyzeTechnicals(market.candles).trend);
  return { direction, score, confidence, candidates: top, activeStrategies: active.length, alignedStrategies: aligned, regime, generatedAt: Date.now() };
}
