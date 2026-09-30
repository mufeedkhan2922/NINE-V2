import { createHash } from "node:crypto";
import { db, transaction } from "./db";

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

function learnOutcomeIntoCausalMemory(observation: DecisionOutcomeObservation, outcome: DecisionOutcome): void {
  const failureMode = outcome === "LOSS"
    ? "DECISION_OUTCOME"
    : outcome === "INVALIDATED"
      ? "STRUCTURE_INVALIDATION"
      : outcome === "MISSED"
        ? "NO_FOLLOW_THROUGH"
        : "DECISION_OUTCOME";
  const id = createHash("sha256")
    .update([
      observation.symbol,
      observation.strategyId,
      observation.session,
      observation.regime,
      observation.direction,
      failureMode,
    ].join("|"))
    .digest("hex")
    .slice(0, 24);
  const isFailure = outcome === "LOSS" || outcome === "INVALIDATED";
  const r = Number.isFinite(observation.pnlR) ? observation.pnlR : 0;
  transaction(() => {
    const old = db.prepare(
      "SELECT observations,failures,wins,expectancy_r,severity FROM causal_failure_memory WHERE id=?",
    ).get(id) as any;
    if (old) {
      const observations = Number(old.observations) + 1;
      const failures = Number(old.failures) + (isFailure ? 1 : 0);
      const wins = Number(old.wins) + (isFailure ? 0 : 1);
      const expectancyR = (Number(old.expectancy_r) * Number(old.observations) + r) / observations;
      const failureRate = failures / observations;
      const lower = causalWilsonLower(failures, observations);
      const status =
        observations >= 20 && lower >= 0.55 && expectancyR < -0.05
          ? "BLOCK"
          : observations >= 5 && lower >= 0.45
            ? "PENALIZE"
            : "OBSERVE";
      db.prepare(
        "UPDATE causal_failure_memory SET observations=?,failures=?,wins=?,failure_rate=?,failure_rate_lower_95=?,expectancy_r=?,severity=?,confidence=?,status=?,last_seen=?,source=? WHERE id=?",
      ).run(
        observations,
        failures,
        wins,
        failureRate,
        lower,
        expectancyR,
        (Number(old.severity) * Number(old.observations) + (isFailure ? 1 : 0.25)) / observations,
        Math.min(1, observations / 100),
        status,
        Date.now(),
        "DECISION_OUTCOME_FEEDBACK",
        id,
      );
    } else {
      db.prepare(
        "INSERT INTO causal_failure_memory (id,symbol,strategy,session,regime,side,failure_mode,observations,failures,wins,failure_rate,failure_rate_lower_95,expectancy_r,severity,confidence,status,last_seen,source) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
      ).run(
        id,
        observation.symbol,
        observation.strategyId,
        observation.session,
        observation.regime,
        observation.direction,
        failureMode,
        1,
        isFailure ? 1 : 0,
        isFailure ? 0 : 1,
        isFailure ? 1 : 0,
        causalWilsonLower(isFailure ? 1 : 0, 1),
        r,
        isFailure ? 1 : 0.25,
        0.01,
        "OBSERVE",
        Date.now(),
        "DECISION_OUTCOME_FEEDBACK",
      );
    }
  });
}

function causalWilsonLower(wins: number, n: number): number {
  if (n <= 0) return 0;
  const z = 1.96;
  const p = wins / n;
  const denominator = 1 + z * z / n;
  return (
    p +
    z * z / (2 * n) -
    z * Math.sqrt((p * (1 - p) + z * z / (4 * n)) / n)
  ) / denominator;
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

  learnOutcomeIntoCausalMemory(observation, outcome);

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
