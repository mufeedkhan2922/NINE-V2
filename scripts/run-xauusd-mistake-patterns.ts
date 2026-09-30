import { db } from "../lib/trading/db";
import { mineMistakePatterns, mistakePatternResearchSummary } from "../lib/trading/mistakePatternMining";
import { mkdirSync, writeFileSync } from "node:fs";

const symbol = "XAUUSD";
const patterns = mineMistakePatterns(symbol);
const summary = mistakePatternResearchSummary(symbol);

mkdirSync("artifacts", { recursive: true });
writeFileSync(
  "artifacts/xauusd-mistake-patterns.json",
  JSON.stringify({
    version: "0.5.28",
    symbol,
    generatedAt: new Date().toISOString(),
    patterns,
    summary,
    safety: {
      purpose: "research and conservative decision gating",
      crossStrategyRequirement: "A pattern must recur across at least two strategies before PENALIZE/BLOCK status.",
      minimumBlockObservations: 20,
      sentinelRemainsFinalAuthority: true,
      brokerExecution: false
    }
  }, null, 2)
);

console.log(JSON.stringify({ version:"0.5.28", symbol, patterns:patterns.length, summary }, null, 2));
void db;
