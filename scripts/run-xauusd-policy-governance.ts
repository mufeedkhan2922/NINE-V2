import fs from "node:fs";
import { policyResearchSummary, sequentialPolicyEvaluation } from "../lib/trading/policyGovernance";
import { db } from "../lib/trading/db";

const rows=db.prepare("SELECT strategy_id AS strategyId, wins, trades, updated_at FROM strategy_memory WHERE symbol='XAUUSD' AND trades>=10 ORDER BY updated_at DESC LIMIT 400").all() as any[];
const baseline=rows.map(r=>(Number(r.wins)/Math.max(1,Number(r.trades))>=0.5?1:0) as 0|1);
const candidate=rows.map(r=>(Number(r.wins)/Math.max(1,Number(r.trades))>=0.55?1:0) as 0|1);
const evaluation=sequentialPolicyEvaluation(baseline,candidate,30);
const result={
 version:"0.5.24",
 symbol:"XAUUSD",
 generatedAt:Date.now(),
 evaluation,
 policySummary:policyResearchSummary(),
 decisionTraceCount:(db.prepare("SELECT COUNT(*) AS count FROM decision_trace WHERE symbol='XAUUSD'").get() as any).count,
 safety:[
  "Policy evaluation is shadow-first and cannot create a setup.",
  "Promotion requires minimum train/OOS samples and an OOS improvement gate.",
  "Quarantined or rejected policies cannot become active.",
  "Rollback is available to a previously validated policy version.",
  "Sentinel remains mandatory for every execution decision."
 ]
};
fs.mkdirSync("artifacts",{recursive:true});
fs.writeFileSync("artifacts/xauusd-policy-governance.json",JSON.stringify(result,null,2));
console.log(JSON.stringify(result,null,2));
