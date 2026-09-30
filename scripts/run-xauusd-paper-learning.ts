import { decisionOutcomeResearchSummary, auditDecisionOutcomes } from "../lib/trading/decisionOutcome";
import { counterfactualReplaySummary } from "../lib/trading/counterfactualReplay";
import { mkdirSync, writeFileSync } from "node:fs";

const symbol = "XAUUSD";
const summary = decisionOutcomeResearchSummary(symbol);
const audit = auditDecisionOutcomes(symbol);
const counterfactual = counterfactualReplaySummary(symbol);

mkdirSync("artifacts", { recursive: true });
writeFileSync(
  "artifacts/xauusd-paper-learning.json",
  JSON.stringify({
    version: "0.5.31",
    symbol,
    generatedAt: new Date().toISOString(),
    decisionOutcomes: summary,
    audit,
    counterfactual,
    safety: {
      researchAndPaperLearningOnly: true,
      noBrokerExecution: true,
      sentinelFinalAuthority: true,
      validatedLearningDoesNotAuthorizeExecution: true,
    },
  }, null, 2),
);

console.log(JSON.stringify({
  version: "0.5.31",
  symbol,
  outcomeGroups: Array.isArray((summary as any).rows) ? (summary as any).rows.length : 0,
  counterfactualContexts: counterfactual.length,
  auditStatus: audit.status,
}, null, 2));
