import { mineMistakePatterns, mistakePatternResearchSummary } from "../lib/trading/mistakePatternMining";
import { evaluateMistakePrevention } from "../lib/trading/mistakePrevention";
import { mkdirSync, writeFileSync } from "node:fs";

const symbol = "XAUUSD";
const patterns = mineMistakePatterns(symbol);
const contexts = ["ASIA","LONDON","NEW_YORK","OFF"];
const regimes = ["TRENDING_UP","TRENDING_DOWN","RANGING","EXPANDING","MIXED"];
const decisions = [];
for (const session of contexts) {
  for (const regime of regimes) {
    for (const side of ["LONG","SHORT"] as const) {
      decisions.push(evaluateMistakePrevention({
        symbol, session, regime, side, strategyId:"RESEARCH",
        score:70, confidence:70, concepts:[]
      }));
    }
  }
}
const summary = mistakePatternResearchSummary(symbol);
mkdirSync("artifacts",{recursive:true});
writeFileSync("artifacts/xauusd-mistake-prevention.json",JSON.stringify({
  version:"0.5.29",
  symbol,
  generatedAt:new Date().toISOString(),
  patterns,
  summary,
  preventionDecisions:decisions,
  safety:{
    noBrokerExecution:true,
    sentinelFinalAuthority:true,
    validatedCrossStrategyPatternsOnly:true,
    abstentionPreferredUnderUncertainty:true
  }
},null,2));
console.log(JSON.stringify({version:"0.5.29",symbol,patterns:patterns.length,decisions:decisions.length},null,2));
