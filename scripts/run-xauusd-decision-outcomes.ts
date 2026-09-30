import { mkdirSync, writeFileSync } from "node:fs";
import { decisionOutcomeResearchSummary } from "../lib/trading/decisionOutcome";

const summary = decisionOutcomeResearchSummary("XAUUSD");
const result = {
  version: "0.5.27",
  generatedAt: new Date().toISOString(),
  ...summary,
  safety: [
    "Decision outcome auditing does not create or execute trades.",
    "Resolved outcomes are observational feedback and do not bypass Sentinel.",
    "Small samples remain INSUFFICIENT rather than being promoted into blocking rules.",
    "DRIFT is an audit signal; it does not automatically change execution risk.",
  ],
};

mkdirSync("artifacts", { recursive: true });
writeFileSync("artifacts/xauusd-decision-outcomes.json", JSON.stringify(result, null, 2));
console.log(JSON.stringify(result, null, 2));
