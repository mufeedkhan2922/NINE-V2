import { db } from "../lib/trading/db";
import { recordDecisionOutcome, auditDecisionOutcomes } from "../lib/trading/decisionOutcome";

import {
  calculateDecisionOutcomeAudit,
  classifyDecisionOutcome,
} from "../lib/trading/decisionOutcome";

export function runDecisionOutcomeTest(): void {
  const symbol = "TEST-XAUUSD";
  db.prepare("DELETE FROM causal_failure_memory WHERE symbol=?").run(symbol);
  db.prepare("DELETE FROM decision_outcome_memory WHERE symbol=?").run(symbol);

  if (classifyDecisionOutcome(0.8) !== "WIN") throw new Error("positive R was not classified as WIN");
  if (classifyDecisionOutcome(-0.8) !== "LOSS") throw new Error("negative R was not classified as LOSS");
  if (classifyDecisionOutcome(0.01) !== "BREAKEVEN") throw new Error("near-zero R was not classified as BREAKEVEN");

  const insufficient = calculateDecisionOutcomeAudit([
    { outcome: "WIN", pnlR: 1 },
  ], 2);
  if (insufficient.status !== "INSUFFICIENT") throw new Error("small outcome sample was not marked insufficient");

  const healthy = calculateDecisionOutcomeAudit(
    [
      { outcome: "WIN", pnlR: 1, maxFavorableR: 1.2, maxAdverseR: 0.2 },
      { outcome: "WIN", pnlR: 0.7, maxFavorableR: 1.0, maxAdverseR: 0.1 },
      { outcome: "LOSS", pnlR: -0.4, maxFavorableR: 0.3, maxAdverseR: 0.6 },
      { outcome: "WIN", pnlR: 0.5, maxFavorableR: 0.8, maxAdverseR: 0.2 },
    ],
    4,
  );
  if (healthy.status !== "HEALTHY") throw new Error("healthy resolved cohort was marked as drift");
  if (healthy.expectancyR <= 0) throw new Error("positive resolved expectancy was lost");

  const drift = calculateDecisionOutcomeAudit(
    Array.from({ length: 20 }, () => ({
      outcome: "LOSS" as const,
      pnlR: -0.4,
      maxFavorableR: 2,
      maxAdverseR: 0.8,
    })),
  );
  if (drift.status !== "DRIFT") throw new Error("negative/poorly realized cohort was not detected as drift");

  for (let i = 0; i < 20; i += 1) {
    recordDecisionOutcome({
      symbol,
      strategyId: "test-strategy",
      session: "NEW_YORK",
      regime: "TRENDING_UP",
      direction: "LONG",
      decisionStatus: "TRADE",
      outcome: "LOSS",
      pnlR: -0.4,
      traceId: `test-trace-${i}`,
    });
  }
  const learned = db.prepare(
    "SELECT status,observations,failure_rate_lower_95 FROM causal_failure_memory WHERE symbol=? AND strategy=? AND failure_mode='DECISION_OUTCOME'",
  ).get(symbol, "test-strategy") as any;
  if (!learned || learned.observations !== 20 || learned.status !== "BLOCK") {
    throw new Error("repeated decision losses did not become a statistically gated causal blocker");
  }
  const audit = auditDecisionOutcomes(symbol, "test-strategy");
  if (audit.status !== "DRIFT") throw new Error("causal feedback cohort did not remain visible to outcome auditing");

  db.prepare("DELETE FROM causal_failure_memory WHERE symbol=?").run(symbol);
  db.prepare("DELETE FROM decision_outcome_memory WHERE symbol=?").run(symbol);
}
