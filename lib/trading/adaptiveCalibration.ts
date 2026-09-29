import { createHash } from "node:crypto";
import { db, transaction } from "./db";
import type { MarketSnapshot } from "./types";

export type CalibrationStatus = "CALIBRATED" | "DRIFT" | "QUARANTINE" | "INSUFFICIENT" | "SHADOW";
export interface CalibrationObservation { predictedConfidence:number; outcome:0|1; timestamp?:number; }
export interface RollingCalibration { windowSize:number; observations:number; wins:number; meanPredicted:number; actualRate:number; brierScore:number; calibrationError:number; }
export interface CalibrationDecision {
  calibratedConfidence:number;
  thresholdAdjustment:number;
  scoreAdjustment:number;
  riskAdjustment:number;
  driftScore:number;
  status:CalibrationStatus;
  blocked:boolean;
  reason:string;
  windows:RollingCalibration[];
}
export interface CorrectionProposal {
  parameter:string; oldValue:number; proposedValue:number; trainObservations:number; oosObservations:number; oosImprovement:number; status:"SHADOW"|"CANDIDATE"|"ACTIVATED"|"REJECTED"; reason:string;
}

function clamp(v:number,min:number,max:number){return Math.max(min,Math.min(max,v));}
export function wilsonLower(wins:number,n:number):number{
  if(n<=0)return 0; const z=1.96,p=wins/n,d=1+z*z/n;
  return (p+z*z/(2*n)-z*Math.sqrt((p*(1-p)+z*z/(4*n))/n))/d;
}
export function rollingCalibration(observations:CalibrationObservation[],windowSize:number):RollingCalibration{
  const rows=observations.slice(-windowSize), n=rows.length;
  if(!n)return {windowSize,observations:0,wins:0,meanPredicted:0,actualRate:0,brierScore:0,calibrationError:0};
  const meanPredicted=rows.reduce((s,x)=>s+x.predictedConfidence,0)/n;
  const actualRate=rows.reduce((s,x)=>s+x.outcome,0)/n;
  const brierScore=rows.reduce((s,x)=>s+Math.pow(x.predictedConfidence-x.outcome,2),0)/n;
  const bins=new Map<number,{p:number;actual:number;n:number}>();
  for(const x of rows){const b=Math.min(9,Math.floor(x.predictedConfidence*10));const old=bins.get(b)??{p:0,actual:0,n:0};old.p+=x.predictedConfidence;old.actual+=x.outcome;old.n++;bins.set(b,old);}
  const calibrationError=[...bins.values()].reduce((s,b)=>s+(b.n/n)*Math.abs(b.p/b.n-b.actual/b.n),0);
  return {windowSize,observations:n,wins:rows.filter(x=>x.outcome===1).length,meanPredicted:Number(meanPredicted.toFixed(4)),actualRate:Number(actualRate.toFixed(4)),brierScore:Number(brierScore.toFixed(5)),calibrationError:Number(calibrationError.toFixed(5))};
}
export function calibrateConfidence(raw:number,observations:CalibrationObservation[]):number{
  const rows=observations.filter(x=>x.predictedConfidence>=0&&x.predictedConfidence<=1);
  if(rows.length<20)return clamp(raw,0,0.99);
  const nearest=rows.reduce((best,x)=>Math.abs(x.predictedConfidence-raw)<Math.abs(best.predictedConfidence-raw)?x:best,rows[0]);
  const band=rows.filter(x=>Math.abs(x.predictedConfidence-nearest.predictedConfidence)<=0.1);
  const rate=band.reduce((s,x)=>s+x.outcome,0)/Math.max(1,band.length);
  return Number(clamp(raw*0.35+rate*0.65,0,0.99).toFixed(4));
}
export function detectConceptDrift(recent:CalibrationObservation[],baseline:CalibrationObservation[]):number{
  if(recent.length<20||baseline.length<20)return 0;
  const r=rollingCalibration(recent,recent.length),b=rollingCalibration(baseline,baseline.length);
  return Number(clamp(Math.abs(r.actualRate-b.actualRate)*1.5+Math.abs(r.brierScore-b.brierScore),0,1).toFixed(4));
}
export function rollingPerformance(outcomes:Array<0|1>):Record<20|50|100|200,number>{
  const result={} as Record<20|50|100|200,number>;
  for(const n of [20,50,100,200] as const){const rows=outcomes.slice(-n);result[n]=rows.length?rows.reduce((s,x)=>s+x,0)/rows.length:0;}
  return result;
}
export function proposeSelfCorrection(train:CalibrationObservation[],oos:CalibrationObservation[],currentThreshold:number):CorrectionProposal{
  const trainRate=train.length?train.reduce((s,x)=>s+x.outcome,0)/train.length:0;
  const oosRate=oos.length?oos.reduce((s,x)=>s+x.outcome,0)/oos.length:0;
  const baseGap=Math.abs(trainRate-currentThreshold);
  const oosImprovement=oosRate-trainRate;
  const proposedValue=Number(clamp(currentThreshold+(trainRate<currentThreshold?-0.03:0.03),0.5,0.9).toFixed(3));
  const valid=oos.length>=30&&oosImprovement>=0.02;
  return {parameter:"minimum_confidence_threshold",oldValue:currentThreshold,proposedValue,trainObservations:train.length,oosObservations:oos.length,oosImprovement:Number(oosImprovement.toFixed(4)),status:valid?"ACTIVATED":oos.length>=30?"REJECTED":"SHADOW",reason:valid?"Out-of-sample improvement cleared activation threshold.":oos.length>=30?"Out-of-sample validation did not improve performance.":"Insufficient unseen data; correction remains shadow-only."};
}
function sessionOf(time:number){const h=new Date(time).getUTCHours();return h<7?"ASIA":h<12?"LONDON":h<21?"NEW_YORK":"OFF";}
function regimeOf(market:MarketSnapshot){const c=market.candles;if(c.length<60)return "MIXED";const r=c.slice(-20),p=c.slice(-60,-20),a=r.reduce((s,x)=>s+x.high-x.low,0)/r.length,b=p.reduce((s,x)=>s+x.high-x.low,0)/p.length,d=r.at(-1)!.close-r[0].open;if(b&&a>b*1.35)return "EXPANDING";if(d>a*4)return "TRENDING_UP";if(d<-a*4)return "TRENDING_DOWN";return "RANGING";}
export function getCalibrationDecision(market:MarketSnapshot,strategyId:string,rawConfidence:number):CalibrationDecision{
  const session=sessionOf(market.candles.at(-1)?.time??Date.now()),regime=regimeOf(market);
  const rows=db.prepare("SELECT * FROM adaptive_calibration_memory WHERE symbol=? AND strategy_id=? AND (session=? OR session='ALL') AND (regime=? OR regime='ALL') ORDER BY window_size DESC,updated_at DESC").all(market.symbol,strategyId,session,regime) as any[];
  if(!rows.length)return {calibratedConfidence:rawConfidence,thresholdAdjustment:0,scoreAdjustment:0,riskAdjustment:0,driftScore:0,status:"INSUFFICIENT",blocked:false,reason:"No adaptive calibration evidence; neutral until validated.",windows:[]};
  const selected=rows.slice(0,4),obs=Number(selected[0].observations),drift=Math.max(...selected.map(r=>Number(r.drift_score)));
  const calibrated=clamp(rawConfidence+Number(selected[0].confidence_adjustment),0,0.99);
  const blocked=selected.some(r=>r.status==="QUARANTINE")&&obs>=50;
  return {calibratedConfidence:Number(calibrated.toFixed(3)),thresholdAdjustment:Number(selected[0].threshold_adjustment),scoreAdjustment:Number(clamp((calibrated-rawConfidence)*30,-6,6).toFixed(2)),riskAdjustment:Number(selected[0].risk_adjustment),driftScore:drift,status:blocked?"QUARANTINE":drift>=0.35?"DRIFT":"CALIBRATED",blocked,reason:blocked?"Strategy quarantined by statistically persistent calibration drift.":drift>=0.35?"Recent calibration drift detected; selection is penalized until recovery evidence appears.":"Confidence calibrated from validated historical outcomes.",windows:[]};
}
export function persistCalibrationSnapshot(symbol:string,strategyId:string,session:string,regime:string,observations:CalibrationObservation[],source="XAUUSD_CALIBRATION"):void{
  for(const size of [20,50,100,200]){const w=rollingCalibration(observations,size);if(w.observations<10)continue;const recent=observations.slice(-Math.min(size,observations.length)),baseline=observations.slice(-Math.min(size*2,observations.length),-Math.min(size,observations.length));const drift=detectConceptDrift(recent,baseline);const confidenceAdjustment=Number(clamp((w.actualRate-w.meanPredicted)*0.5,-0.15,0.15).toFixed(4));const thresholdAdjustment=Number(clamp((w.meanPredicted-w.actualRate)*0.1,-0.05,0.05).toFixed(4));const riskAdjustment=Number(clamp(-drift*0.5,-0.25,0).toFixed(4));const status:CalibrationStatus=w.observations>=50&&drift>=0.35?"QUARANTINE":drift>=0.2?"DRIFT":w.observations>=30?"CALIBRATED":"INSUFFICIENT";const id=createHash("sha256").update([symbol,strategyId,session,regime,size].join("|")).digest("hex").slice(0,24);transaction(()=>db.prepare("INSERT OR REPLACE INTO adaptive_calibration_memory (id,symbol,strategy_id,session,regime,window_size,observations,wins,mean_predicted,actual_rate,brier_score,calibration_error,drift_score,confidence_adjustment,threshold_adjustment,risk_adjustment,status,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)").run(id,symbol,strategyId,session,regime,size,w.observations,w.wins,w.meanPredicted,w.actualRate,w.brierScore,w.calibrationError,drift,confidenceAdjustment,thresholdAdjustment,riskAdjustment,status,Date.now()));}}
export function persistCorrection(symbol:string,strategyId:string,session:string,regime:string,proposal:CorrectionProposal):void{
  const id=createHash("sha256").update([symbol,strategyId,session,regime,proposal.parameter,String(proposal.proposedValue)].join("|")).digest("hex").slice(0,24);
  db.prepare("INSERT OR REPLACE INTO calibration_corrections (id,symbol,strategy_id,session,regime,parameter,old_value,proposed_value,train_observations,oos_observations,oos_improvement,status,reason,created_at,activated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)").run(id,symbol,strategyId,session,regime,proposal.parameter,proposal.oldValue,proposal.proposedValue,proposal.trainObservations,proposal.oosObservations,proposal.oosImprovement,proposal.status,proposal.reason,Date.now(),proposal.status==="ACTIVATED"?Date.now():null);
}
export function calibrationResearchSummary(symbol="XAUUSD"){return db.prepare("SELECT strategy_id AS strategyId,status,COUNT(*) AS snapshots,MAX(observations) AS observations,AVG(calibration_error) AS calibrationError,MAX(drift_score) AS driftScore FROM adaptive_calibration_memory WHERE symbol=? GROUP BY strategy_id,status ORDER BY observations DESC").all(symbol);}
