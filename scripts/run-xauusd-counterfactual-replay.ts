import { counterfactualReplaySummary } from "../lib/trading/counterfactualReplay";
import { mkdirSync, writeFileSync } from "node:fs";

const symbol = "XAUUSD";
const summary = counterfactualReplaySummary(symbol);
mkdirSync("artifacts",{recursive:true});
writeFileSync("artifacts/xauusd-counterfactual-replay.json", JSON.stringify({
  version:"0.5.32",
  symbol,
  generatedAt:new Date().toISOString(),
  summary,
  safety:{researchOnly:true,noBrokerExecution:true,sentinelFinalAuthority:true,unresolvedOutcomesDoNotPenalize:true}
},null,2));
console.log(JSON.stringify({version:"0.5.32",symbol,contexts:summary.length},null,2));
