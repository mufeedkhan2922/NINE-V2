import { decisionOutcomeResearchSummary } from "../lib/trading/decisionOutcome";

const summary = decisionOutcomeResearchSummary("XAUUSD");
const result = {
  version: "0.5.26",
  generatedAt: new Date().toISOString(),
  ...summary,
  safety: [
    "Decision outcome auditing does not create or execute trades.",
    "Resolved outcomes are observational feedback and do not bypass Sentinel.",
    "Small samples remain INSUFFICIENT rather than being promoted into blocking rules.",
    "DRIFT is an audit signal; it does not automatically change execution risk.",
  ],
};

console.log(JSON.stringify(result, null, 2));
