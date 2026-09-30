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
    if (fold.oosStartTime <= previousOosEnd) {
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
