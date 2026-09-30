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
