export interface OosValidationWindow {
  trainEndTime: number;
  oosStartTime: number;
  oosEndTime?: number;
}

export interface OosValidationAudit {
  valid: boolean;
  reason: string;
}

export function auditOosValidationWindow(
  candles: Array<{ time: number }>,
  window: OosValidationWindow,
): OosValidationAudit {
  if (!Number.isFinite(window.trainEndTime) || !Number.isFinite(window.oosStartTime)) {
    return { valid: false, reason: "Validation window requires finite trainEndTime and oosStartTime." };
  }
  if (window.oosStartTime <= window.trainEndTime) {
    return { valid: false, reason: "OOS must start strictly after the training period." };
  }
  if (window.oosEndTime !== undefined && window.oosEndTime < window.oosStartTime) {
    return { valid: false, reason: "OOS end must be at or after OOS start." };
  }
  for (let i = 1; i < candles.length; i += 1) {
    if (!(candles[i]!.time > candles[i - 1]!.time)) {
      return { valid: false, reason: "Validation candles must be strictly chronological." };
    }
  }
  const train = candles.filter((c) => c.time <= window.trainEndTime);
  if (!train.length) {
    return { valid: false, reason: "Validation window contains no training candles before the training cutoff." };
  }
  const lastTrain = train.at(-1)!.time;
  if (lastTrain > window.trainEndTime) {
    return { valid: false, reason: "Training candles cross the declared training cutoff." };
  }
  const oos = candles.filter((c) =>
    c.time >= window.oosStartTime &&
    (window.oosEndTime === undefined || c.time <= window.oosEndTime),
  );
  if (!oos.length) {
    return { valid: false, reason: "Validation window contains no OOS candles." };
  }
  return { valid: true, reason: "Chronological OOS window is isolated after the training cutoff." };
}


export interface WalkForwardFoldWindow {
  trainStartTime: number;
  trainEndTime: number;
  oosStartTime: number;
  oosEndTime: number;
}

export interface WalkForwardAudit {
  valid: boolean;
  reason: string;
  validFolds: number;
}

export function auditWalkForwardFolds(folds: WalkForwardFoldWindow[]): WalkForwardAudit {
  if (!folds.length) {
    return { valid: false, reason: "Walk-forward validation requires at least one fold.", validFolds: 0 };
  }

  let previousOosEnd = -Infinity;
  for (let i = 0; i < folds.length; i += 1) {
    const fold = folds[i]!;
    if (![fold.trainStartTime, fold.trainEndTime, fold.oosStartTime, fold.oosEndTime].every(Number.isFinite)) {
      return { valid: false, reason: `Fold ${i + 1} contains a non-finite timestamp.`, validFolds: i };
    }
    if (!(fold.trainStartTime < fold.trainEndTime)) {
      return { valid: false, reason: `Fold ${i + 1} training window is invalid.`, validFolds: i };
    }
    if (!(fold.trainEndTime < fold.oosStartTime)) {
      return { valid: false, reason: `Fold ${i + 1} training and OOS windows overlap.`, validFolds: i };
    }
    if (!(fold.oosStartTime < fold.oosEndTime)) {
      return { valid: false, reason: `Fold ${i + 1} OOS window is invalid.`, validFolds: i };
    }
    if (fold.oosStartTime < previousOosEnd) {
      return { valid: false, reason: `Fold ${i + 1} OOS window overlaps a previous OOS window.`, validFolds: i };
    }
    previousOosEnd = fold.oosEndTime;
  }

  return {
    valid: true,
    reason: "Walk-forward folds are chronological with non-overlapping OOS evaluation windows.",
    validFolds: folds.length,
  };
}


export interface EmbargoedWalkForwardFoldWindow extends WalkForwardFoldWindow {
  embargoMs: number;
}

export interface ParameterFreeOosAudit {
  valid: boolean;
  reason: string;
  parameters: Record<string, string | number | boolean>;
}

export interface BootstrapInterval {
  estimate: number;
  lower95: number;
  upper95: number;
  samples: number;
  resamples: number;
}

export interface MultipleTestingAudit {
  hypotheses: number;
  alpha: number;
  adjustedAlpha: number;
  valid: boolean;
  method: "BONFERRONI";
}

export interface ResearchProvenance {
  symbol: string;
  timeframe: string;
  dataStartTime: number;
  dataEndTime: number;
  trainStartTime: number;
  trainEndTime: number;
  oosStartTime: number;
  oosEndTime: number;
  candleCount: number;
  dataFingerprint: string;
  trainCandleCount: number;
  oosCandleCount: number;
  rulesetVersion: string;
  codeVersion: string;
  learningState: "DISABLED" | "TRAIN_ONLY";
}

export interface ResearchIntegrityGate {
  valid: boolean;
  reasons: string[];
  foldAudit: WalkForwardAudit;
  parameterAudit: ParameterFreeOosAudit;
  multipleTesting: MultipleTestingAudit;
  reproducibilityHash: string;
}

function seededRandom(seed: number): () => number {
  let state = Math.abs(Math.floor(seed)) || 1;
  return () => {
    state |= 0;
    state = Math.imul(state ^ (state >>> 16), 2246822519);
    state = Math.imul(state ^ (state >>> 13), 3266489917);
    state ^= state >>> 16;
    return (state >>> 0) / 4294967296;
  };
}

export function bootstrapMeanInterval(
  values: number[],
  seed = 1,
  resamples = 2000,
): BootstrapInterval {
  const finite = values.filter(Number.isFinite);
  if (!finite.length) return { estimate: 0, lower95: 0, upper95: 0, samples: 0, resamples: 0 };
  const mean = finite.reduce((sum, value) => sum + value, 0) / finite.length;
  if (finite.length === 1) return { estimate: mean, lower95: mean, upper95: mean, samples: 1, resamples: 1 };
  const random = seededRandom(seed);
  const bootstrap: number[] = [];
  for (let b = 0; b < Math.max(100, resamples); b += 1) {
    let sum = 0;
    for (let i = 0; i < finite.length; i += 1) {
      sum += finite[Math.floor(random() * finite.length)]!;
    }
    bootstrap.push(sum / finite.length);
  }
  bootstrap.sort((a, b) => a - b);
  const lo = bootstrap[Math.floor(bootstrap.length * 0.025)]!;
  const hi = bootstrap[Math.min(bootstrap.length - 1, Math.floor(bootstrap.length * 0.975))]!;
  return {
    estimate: Number(mean.toFixed(6)),
    lower95: Number(lo.toFixed(6)),
    upper95: Number(hi.toFixed(6)),
    samples: finite.length,
    resamples: bootstrap.length,
  };
}

export function auditMultipleTesting(hypotheses: number, alpha = 0.05): MultipleTestingAudit {
  const valid = Number.isInteger(hypotheses) && hypotheses > 0 && Number.isFinite(alpha) && alpha > 0 && alpha < 1;
  if (!valid) return { hypotheses: 0, alpha, adjustedAlpha: 0, valid: false, method: "BONFERRONI" };
  return {
    hypotheses,
    alpha,
    adjustedAlpha: alpha / hypotheses,
    valid: true,
    method: "BONFERRONI",
  };
}

export function auditParameterFreeOosEvaluation(
  parameters: Record<string, unknown>,
): ParameterFreeOosAudit {
  const forbidden = ["oosTuned", "tunedOnOos", "selectedByOos", "optimizeOos", "oosOptimization"];
  const found = forbidden.filter((key) => parameters[key] === true);
  const allowedParameters: Record<string, string | number | boolean> = {};
  for (const [key, value] of Object.entries(parameters)) {
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
      allowedParameters[key] = value;
    }
  }
  return {
    valid: found.length === 0,
    reason: found.length ? `OOS tuning flags detected: ${found.join(", ")}.` : "No OOS-derived tuning flags are enabled.",
    parameters: allowedParameters,
  };
}

export function buildReproducibilityHash(
  provenance: ResearchProvenance,
  configuration: Record<string, unknown>,
): string {
  const stable = (value: unknown): string => {
    if (value === null || typeof value !== "object") return JSON.stringify(value);
    if (Array.isArray(value)) return "[" + value.map(stable).join(",") + "]";
    return "{" + Object.keys(value as Record<string, unknown>).sort().map((key) => JSON.stringify(key) + ":" + stable((value as Record<string, unknown>)[key])).join(",") + "}";
  };
  // FNV-1a keeps this module dependency-free while producing a deterministic run identifier.
  const input = stable({ provenance, configuration });
  let hash = 2166136261;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

export function auditResearchIntegrity(
  folds: EmbargoedWalkForwardFoldWindow[],
  parameterAudit: ParameterFreeOosAudit,
  multipleTesting: MultipleTestingAudit,
  reproducibilityHash: string,
): ResearchIntegrityGate {
  const base = auditWalkForwardFolds(folds);
  const reasons = [...(base.valid ? [] : [base.reason])];
  for (let i = 1; i < folds.length; i += 1) {
    const previous = folds[i - 1]!;
    const current = folds[i]!;
    if (current.trainStartTime < previous.oosEndTime + Math.max(0, previous.embargoMs)) {
      reasons.push(`Fold ${i + 1} training starts before the previous OOS embargo expires.`);
    }
    if (current.trainEndTime + Math.max(0, current.embargoMs) >= current.oosStartTime) {
      reasons.push(`Fold ${i + 1} training window is not purged before OOS.`);
    }
  }
  if (!parameterAudit.valid) reasons.push(parameterAudit.reason);
  if (!multipleTesting.valid) reasons.push("Multiple-testing audit is invalid.");
  if (!reproducibilityHash) reasons.push("Reproducibility hash is missing.");
  return {
    valid: reasons.length === 0,
    reasons,
    foldAudit: base,
    parameterAudit,
    multipleTesting,
    reproducibilityHash,
  };
}


export function fingerprintCandles(
  candles: Array<{ time: number; open: number; high: number; low: number; close: number }>,
): string {
  const input = candles.map((c) => [c.time, c.open, c.high, c.low, c.close].join(":")).join("|");
  let hash = 2166136261;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}


export interface WilsonInterval {
  estimate: number;
  lower95: number;
  upper95: number;
  successes: number;
  trials: number;
}

export interface FoldStabilityAudit {
  valid: boolean;
  folds: number;
  positiveFolds: number;
  positiveFoldRate: number;
  meanExpectancy: number;
  standardDeviation: number;
  coefficientOfVariation: number | null;
  reason: string;
}

export interface RegimeStabilityAudit {
  valid: boolean;
  regimes: number;
  evaluatedRegimes: number;
  positiveRegimes: number;
  minimumTradesPerRegime: number;
  reason: string;
}

export interface ParameterPerturbationAudit {
  valid: boolean;
  baseline: number;
  variants: number;
  minimumRetainedEdge: number;
  worstRetention: number;
  reason: string;
}

export interface OosDegradationAudit {
  valid: boolean;
  trainMetric: number;
  oosMetric: number;
  retention: number;
  degradation: number;
  minimumRetention: number;
  reason: string;
}

export interface EffectSizeAudit {
  valid: boolean;
  mean: number;
  standardDeviation: number;
  cohensD: number;
  minimumEffectSize: number;
  reason: string;
}

export interface NestedWalkForwardAudit {
  valid: boolean;
  outerFolds: number;
  invalidFolds: number;
  reason: string;
}

export interface ResearchRobustnessGate {
  valid: boolean;
  reasons: string[];
  foldStability: FoldStabilityAudit;
  regimeStability: RegimeStabilityAudit;
  parameterPerturbation: ParameterPerturbationAudit;
  degradation: OosDegradationAudit;
  effectSize: EffectSizeAudit;
  nestedWalkForward: NestedWalkForwardAudit;
}

export function wilsonWinRateInterval(successes: number, trials: number, z = 1.96): WilsonInterval {
  if (!Number.isInteger(successes) || !Number.isInteger(trials) || trials <= 0 || successes < 0 || successes > trials || !(z > 0)) {
    return { estimate: 0, lower95: 0, upper95: 0, successes: 0, trials: 0 };
  }
  const p = successes / trials;
  const denominator = 1 + (z * z) / trials;
  const center = (p + (z * z) / (2 * trials)) / denominator;
  const margin = (z / denominator) * Math.sqrt((p * (1 - p)) / trials + (z * z) / (4 * trials * trials));
  return {
    estimate: Number(p.toFixed(6)),
    lower95: Number(Math.max(0, center - margin).toFixed(6)),
    upper95: Number(Math.min(1, center + margin).toFixed(6)),
    successes,
    trials,
  };
}

function finiteMean(values: number[]): number {
  const finite = values.filter(Number.isFinite);
  return finite.length ? finite.reduce((sum, value) => sum + value, 0) / finite.length : 0;
}

function finiteStd(values: number[]): number {
  const finite = values.filter(Number.isFinite);
  if (finite.length < 2) return 0;
  const mean = finiteMean(finite);
  return Math.sqrt(finite.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (finite.length - 1));
}

export function auditFoldStability(
  foldExpectancies: number[],
  minimumPositiveFoldRate = 0.5,
): FoldStabilityAudit {
  const values = foldExpectancies.filter(Number.isFinite);
  const mean = finiteMean(values);
  const standardDeviation = finiteStd(values);
  const positiveFolds = values.filter((value) => value > 0).length;
  const positiveFoldRate = values.length ? positiveFolds / values.length : 0;
  const coefficientOfVariation = mean !== 0 ? Math.abs(standardDeviation / mean) : null;
  const valid = values.length >= 2 && positiveFoldRate >= minimumPositiveFoldRate && mean > 0;
  return {
    valid,
    folds: values.length,
    positiveFolds,
    positiveFoldRate: Number(positiveFoldRate.toFixed(6)),
    meanExpectancy: Number(mean.toFixed(6)),
    standardDeviation: Number(standardDeviation.toFixed(6)),
    coefficientOfVariation: coefficientOfVariation === null ? null : Number(coefficientOfVariation.toFixed(6)),
    reason: valid
      ? "OOS expectancy is positive across the required proportion of folds."
      : "Fold stability is insufficient: require at least two folds, positive mean expectancy, and the minimum positive-fold rate.",
  };
}

export function auditRegimeStability(
  regimes: Array<{ regime: string; trades: number; expectancy: number }>,
  minimumTradesPerRegime = 20,
): RegimeStabilityAudit {
  const eligible = regimes.filter((item) =>
    item.regime.length > 0 &&
    Number.isFinite(item.trades) &&
    item.trades >= minimumTradesPerRegime &&
    Number.isFinite(item.expectancy),
  );
  const positiveRegimes = eligible.filter((item) => item.expectancy > 0).length;
  const valid = eligible.length >= 2 && positiveRegimes >= Math.ceil(eligible.length / 2);
  return {
    valid,
    regimes: regimes.length,
    evaluatedRegimes: eligible.length,
    positiveRegimes,
    minimumTradesPerRegime,
    reason: valid
      ? "The edge remains positive across at least half of sufficiently sampled regimes."
      : "Regime stability is insufficient or too few regimes have enough observations.",
  };
}

export function auditParameterPerturbation(
  baseline: number,
  variants: number[],
  minimumRetainedEdge = 0.7,
): ParameterPerturbationAudit {
  const finiteVariants = variants.filter(Number.isFinite);
  const edge = Math.abs(baseline);
  if (!(edge > 0) || !finiteVariants.length || !(minimumRetainedEdge > 0 && minimumRetainedEdge <= 1)) {
    return {
      valid: false,
      baseline,
      variants: finiteVariants.length,
      minimumRetainedEdge,
      worstRetention: 0,
      reason: "Parameter perturbation requires a non-zero baseline, finite variants, and a retention threshold in (0, 1].",
    };
  }
  const worstRetention = Math.min(...finiteVariants.map((value) => value / baseline));
  const valid = finiteVariants.every((value) => value > 0) && worstRetention >= minimumRetainedEdge;
  return {
    valid,
    baseline: Number(baseline.toFixed(6)),
    variants: finiteVariants.length,
    minimumRetainedEdge,
    worstRetention: Number(worstRetention.toFixed(6)),
    reason: valid
      ? "Perturbed parameter configurations retain the required fraction of the baseline edge."
      : "Edge is too sensitive to parameter perturbation.",
  };
}

export function auditOosDegradation(
  trainMetric: number,
  oosMetric: number,
  minimumRetention = 0.5,
): OosDegradationAudit {
  const retention = trainMetric > 0 ? oosMetric / trainMetric : 0;
  const degradation = trainMetric > 0 ? 1 - retention : 1;
  const valid = trainMetric > 0 && oosMetric > 0 && retention >= minimumRetention;
  return {
    valid,
    trainMetric: Number(trainMetric.toFixed(6)),
    oosMetric: Number(oosMetric.toFixed(6)),
    retention: Number(retention.toFixed(6)),
    degradation: Number(degradation.toFixed(6)),
    minimumRetention,
    reason: valid
      ? "OOS retains the required fraction of the training edge."
      : "OOS edge degradation exceeds the configured tolerance.",
  };
}

export function auditEffectSize(
  values: number[],
  minimumEffectSize = 0.2,
): EffectSizeAudit {
  const finite = values.filter(Number.isFinite);
  const mean = finiteMean(finite);
  const standardDeviation = finiteStd(finite);
  const cohensD = standardDeviation > 0 ? mean / standardDeviation : 0;
  const valid = finite.length >= 2 && cohensD >= minimumEffectSize && mean > 0;
  return {
    valid,
    mean: Number(mean.toFixed(6)),
    standardDeviation: Number(standardDeviation.toFixed(6)),
    cohensD: Number(cohensD.toFixed(6)),
    minimumEffectSize,
    reason: valid
      ? "The observed edge has the minimum required standardized effect size."
      : "Effect size is too small or the sample is insufficient.",
  };
}

export function auditNestedWalkForward(
  outerFolds: WalkForwardFoldWindow[],
  innerFoldsByOuterFold: WalkForwardFoldWindow[][],
): NestedWalkForwardAudit {
  if (outerFolds.length === 0 || innerFoldsByOuterFold.length !== outerFolds.length) {
    return { valid: false, outerFolds: outerFolds.length, invalidFolds: outerFolds.length, reason: "Nested validation requires one inner-fold set per outer fold." };
  }
  let invalidFolds = 0;
  outerFolds.forEach((outer, index) => {
    const inner = innerFoldsByOuterFold[index] ?? [];
    const audit = auditWalkForwardFolds(inner);
    const contained = inner.every((fold) =>
      fold.trainStartTime >= outer.trainStartTime &&
      fold.oosEndTime < outer.oosStartTime &&
      fold.trainEndTime < fold.oosStartTime,
    );
    if (!audit.valid || !contained) invalidFolds += 1;
  });
  return {
    valid: invalidFolds === 0,
    outerFolds: outerFolds.length,
    invalidFolds,
    reason: invalidFolds === 0
      ? "All inner folds are chronological and fully contained inside the corresponding outer training window."
      : "Nested walk-forward validation contains an invalid or outer-OOS-contaminating inner fold.",
  };
}

export function auditResearchRobustness(
  foldExpectancies: number[],
  regimeResults: Array<{ regime: string; trades: number; expectancy: number }>,
  baselineParameterMetric: number,
  perturbedParameterMetrics: number[],
  trainMetric: number,
  oosMetric: number,
  oosTradePnls: number[],
  outerFolds: WalkForwardFoldWindow[],
  innerFoldsByOuterFold: WalkForwardFoldWindow[][],
): ResearchRobustnessGate {
  const foldStability = auditFoldStability(foldExpectancies);
  const regimeStability = auditRegimeStability(regimeResults);
  const parameterPerturbation = auditParameterPerturbation(baselineParameterMetric, perturbedParameterMetrics);
  const degradation = auditOosDegradation(trainMetric, oosMetric);
  const effectSize = auditEffectSize(oosTradePnls);
  const nestedWalkForward = auditNestedWalkForward(outerFolds, innerFoldsByOuterFold);
  const audits = [foldStability, regimeStability, parameterPerturbation, degradation, effectSize, nestedWalkForward];
  return {
    valid: audits.every((audit) => audit.valid),
    reasons: audits.filter((audit) => !audit.valid).map((audit) => audit.reason),
    foldStability,
    regimeStability,
    parameterPerturbation,
    degradation,
    effectSize,
    nestedWalkForward,
  };
}
