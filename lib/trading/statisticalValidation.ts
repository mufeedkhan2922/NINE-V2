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
  const oos = candles.filter((c) =>
    c.time >= window.oosStartTime &&
    (window.oosEndTime === undefined || c.time <= window.oosEndTime),
  );
  if (!oos.length) {
    return { valid: false, reason: "Validation window contains no OOS candles." };
  }
  return { valid: true, reason: "Chronological OOS window is isolated after the training cutoff." };
}
