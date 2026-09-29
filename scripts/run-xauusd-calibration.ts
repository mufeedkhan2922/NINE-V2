import fs from "node:fs";
import { calibrationResearchSummary, rollingCalibration, detectConceptDrift, proposeSelfCorrection } from "../lib/trading/adaptiveCalibration";
import { db } from "../lib/trading/db";

function observationsFor(strategyId:string){
  const rows=db.prepare("SELECT trades,wins,win_rate,expectancy_r,updated_at FROM strategy_memory WHERE symbol='XAUUSD' AND strategy_id=? AND trades>=10 ORDER BY updated_at DESC LIMIT 200").all(strategyId) as any[];
  return rows.map(row=>({predictedConfidence:Math.max(0.5,Math.min(0.95,0.5+Number(row.expectancy_r)*0.12)),outcome:(Number(row.win_rate)>=50?1:0) as 0|1,timestamp:Number(row.updated_at)}));
}
const strategies=(db.prepare("SELECT DISTINCT strategy_id AS strategyId FROM strategy_memory WHERE symbol='XAUUSD' AND trades>=10").all() as any[]).map(x=>String(x.strategyId));
const report=strategies.map(strategyId=>{
  const obs=observationsFor(strategyId);
  const windows=[20,50,100,200].map(n=>rollingCalibration(obs,n));
  const recent=obs.slice(-Math.min(50,obs.length)), baseline=obs.slice(-Math.min(100,obs.length),-Math.min(50,obs.length));
  const drift=detectConceptDrift(recent,baseline);
  const correction=proposeSelfCorrection(obs.slice(0,Math.floor(obs.length/2)),obs.slice(Math.floor(obs.length/2)),0.7);
  return {strategyId,observations:obs.length,windows,drift,correction};
});
const result={version:"0.5.23",symbol:"XAUUSD",generatedAt:Date.now(),strategies:report,storedCalibration:calibrationResearchSummary("XAUUSD"),safety:[
"Calibration only adjusts selection confidence and thresholds; it cannot create a setup.",
"Quarantine requires validated sample evidence and does not bypass setup validation.",
"Corrections are activated only after out-of-sample evidence clears governance thresholds.",
"Sentinel remains the mandatory final execution authority."
]};
fs.mkdirSync("artifacts",{recursive:true});
fs.writeFileSync("artifacts/xauusd-adaptive-calibration.json",JSON.stringify(result,null,2));
console.log(JSON.stringify(result,null,2));
