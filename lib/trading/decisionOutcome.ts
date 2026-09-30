import { db } from "./db";

export type DecisionOutcome = "WIN" | "LOSS" | "BREAKEVEN" | "MISSED" | "INVALIDATED";

export interface DecisionOutcomeObservation {
  symbol: string;
  strategyId: string;
  session: string;
  regime: string;
  direction: "LONG" | "SHORT" | "NONE";
  decisionStatus: "TRADE" | "WATCH" | "BLOCK";
  outcome: DecisionOutcome;
  pnlR: number;
  maxFavorableR?: number;
  maxAdverseR?: number;
  exitReason?: string;
  traceId?: string;
  timestamp?: number;
}

export interface DecisionOutcomeAudit {
  observations: number;
  wins: number;
  losses: number;
  winRate: number;
  expectancyR: number;
  averageMfeR: number;
  averageMaeR: number;
  calibrationBiasR: number;
  status: "INSUFFICIENT" | "HEALTHY" | "DRIFT";
  reason: string;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function classifyDecisionOutcome(pnlR: number): DecisionOutcome {
  if (pnlR > 0.05) return "WIN";
  if (pnlR < -0.05) return "LOSS";
  return "BREAKEVEN";
}

export function calculateDecisionOutcomeAudit(
  observations: Array<Pick<DecisionOutcomeObservation, "outcome" | "pnlR" | "maxFavorableR" | "maxAdverseR">>,
  minObservations = 20,
): DecisionOutcomeAudit {
  const rows = observations.filter((row) => Number.isFinite(row.pnlR));
  const n = rows.length;
  if (n < minObservations) {
    return {
      observations: n,
      wins: rows.filter((row) => row.outcome === "WIN").length,
      losses: rows.filter((row) => row.outcome === "LOSS").length,
      winRate: 0,
      expectancyR: 0,
      averageMfeR: 0,
      averageMaeR: 0,
      calibrationBiasR: 0,
      status: "INSUFFICIENT",
      reason: `Only ${n} resolved observations; minimum ${minObservations} required.`,
    };
  }

  const wins = rows.filter((row) => row.outcome === "WIN").length;
  const losses = rows.filter((row) => row.outcome === "LOSS").length;
  const expectancyR = rows.reduce((sum, row) => sum + row.pnlR, 0) / n;
  const averageMfeR = rows.reduce((sum, row) => sum + (row.maxFavorableR ?? 0), 0) / n;
  const averageMaeR = rows.reduce((sum, row) => sum + (row.maxAdverseR ?? 0), 0) / n;

  // Positive bias means realized outcomes are materially below the favorable excursion
  // available in the same decision cohort.
  const calibrationBiasR = averageMfeR - Math.max(0, expectancyR);
  const status = expectancyR <= -0.15 || calibrationBiasR > 1.5 ? "DRIFT" : "HEALTHY";

  return {
    observations: n,
    wins,
    losses,
    winRate: Number((wins / n).toFixed(4)),
    expectancyR: Number(expectancyR.toFixed(4)),
    averageMfeR: Number(averageMfeR.toFixed(4)),
    averageMaeR: Number(averageMaeR.toFixed(4)),
    calibrationBiasR: Number(clamp(calibrationBiasR, -10, 10).toFixed(4)),
    status,
    reason:
      status === "DRIFT"
        ? "Resolved decision outcomes show negative expectancy or a large gap between favorable excursion and realized result."
        : "Resolved decision outcomes remain within the current audit thresholds.",
  };
}

export function recordDecisionOutcome(observation: DecisionOutcomeObservation): void {
  const now = observation.timestamp ?? Date.now();
  const pnlR = Number.isFinite(observation.pnlR) ? observation.pnlR : 0;
  const outcome = observation.outcome ?? classifyDecisionOutcome(pnlR);
  const id = observation.traceId
    ? `outcome-${observation.traceId}`
    : `outcome-${observation.symbol}-${observation.strategyId}-${now}-${Math.random().toString(36).slice(2, 8)}`;

  db.prepare(
    `INSERT OR REPLACE INTO decision_outcome_memory
      (id,symbol,strategy_id,session,regime,direction,decision_status,outcome,pnl_r,max_favorable_r,max_adverse_r,exit_reason,trace_id,created_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
  ).run(
    id,
    observation.symbol,
    observation.strategyId,
    observation.session,
    observation.regime,
    observation.direction,
    observation.decisionStatus,
    outcome,
    pnlR,
    observation.maxFavorableR ?? 0,
    observation.maxAdverseR ?? 0,
    observation.exitReason ?? null,
    observation.traceId ?? null,
    now,
  );

  if (observation.traceId) {
    db.prepare("UPDATE decision_trace SET outcome=? WHERE id=?").run(outcome, observation.traceId);
  }
}

export function auditDecisionOutcomes(
  symbol: string,
  strategyId?: string,
  session?: string,
  regime?: string,
  direction?: "LONG" | "SHORT" | "NONE",
  limit = 200,
): DecisionOutcomeAudit {
  const rows = db.prepare(
    `SELECT outcome,pnl_r AS pnlR,max_favorable_r AS maxFavorableR,max_adverse_r AS maxAdverseR
     FROM decision_outcome_memory
     WHERE symbol=?
       AND (? IS NULL OR strategy_id=?)
       AND (? IS NULL OR session=?)
       AND (? IS NULL OR regime=?)
       AND (? IS NULL OR direction=?)
     ORDER BY created_at DESC LIMIT ?`,
  ).all(symbol, strategyId ?? null, strategyId ?? null, session ?? null, session ?? null, regime ?? null, regime ?? null, direction ?? null, direction ?? null, limit) as Array<any>;

  return calculateDecisionOutcomeAudit(rows);
}

export function decisionOutcomeResearchSummary(symbol = "XAUUSD"): Record<string, unknown> {
  const rows = db.prepare(
    `SELECT decision_status AS decisionStatus, outcome, COUNT(*) AS observations,
            ROUND(AVG(pnl_r),4) AS expectancyR
     FROM decision_outcome_memory
     WHERE symbol=?
     GROUP BY decision_status,outcome
     ORDER BY decision_status,outcome`,
  ).all(symbol) as Array<Record<string, unknown>>;

  return { symbol, rows, generatedAt: Date.now() };
}
