import { rejectionGovernanceSummary } from "../lib/trading/rejectionGovernance";
import { mkdirSync, writeFileSync } from "node:fs";

const symbol = "XAUUSD";
const summary = rejectionGovernanceSummary(symbol);

mkdirSync("artifacts", { recursive: true });
writeFileSync(
  "artifacts/xauusd-rejection-governance.json",
  JSON.stringify({
    version: "0.5.35",
    symbol,
    generatedAt: new Date().toISOString(),
    summary,
    safety: {
      researchOnly: true,
      shadowReviewOnly: true,
      noBrokerExecution: true,
      noAutomaticBlockerWeakening: true,
      sentinelFinalAuthority: true,
    },
  }, null, 2),
);

console.log(JSON.stringify({
  version: "0.5.35",
  symbol,
  contexts: summary.length,
  shadowReviews: summary.filter((row) => row.governanceStatus === "SHADOW_REVIEW").length,
}, null, 2));
