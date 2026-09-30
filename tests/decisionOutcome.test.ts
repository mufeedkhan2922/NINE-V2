import {
  calculateDecisionOutcomeAudit,
  classifyDecisionOutcome,
} from "../lib/trading/decisionOutcome";

export function runDecisionOutcomeTest(): void {
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
}
