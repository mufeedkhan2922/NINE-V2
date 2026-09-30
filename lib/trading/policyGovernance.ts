import { createHash } from "node:crypto";
import { db, transaction } from "./db";
import type { ResearchIntegrityGate } from "./statisticalValidation";

export type PolicyStatus = "SHADOW"|"CANDIDATE"|"ACTIVE"|"RETIRED"|"QUARANTINED";
export interface DecisionEvidence { concept:string; contribution:number; independent:boolean; source:string; }
export interface PolicyEvaluation {
  baselineScore:number;
  candidateScore:number;
  delta:number;
  observations:number;
  confidence:number;
  status:"INSUFFICIENT"|"NEUTRAL"|"PROMOTE"|"REJECT";
}
export interface DecisionGovernance {
  policyVersion:number;
  calibratedScore:number;
  uncertainty:number;
  status:"SHADOW"|"CANDIDATE"|"ACTIVE"|"QUARANTINED";
  canProceed:boolean;
  sentinelRequired:true;
  reason:string;
}

function clamp(v:number,min:number,max:number){return Math.max(min,Math.min(max,v));}
export function wilsonLower(wins:number,n:number):number{
  if(n<=0)return 0;const z=1.96,p=wins/n,d=1+z*z/n;
  return (p+z*z/(2*n)-z*Math.sqrt((p*(1-p)+z*z/(4*n))/n))/d;
}
export function sequentialPolicyEvaluation(
  baseline:Array<0|1>,
  candidate:Array<0|1>,
  minObservations=30,
):PolicyEvaluation{
  const n=Math.min(baseline.length,candidate.length);
  if(n<minObservations)return {baselineScore:0,candidateScore:0,delta:0,observations:n,confidence:0,status:"INSUFFICIENT"};
  const b=baseline.slice(-n).reduce<number>((s,x)=>s+x,0)/n;
  const c=candidate.slice(-n).reduce<number>((s,x)=>s+x,0)/n;
  const delta=c-b;
  const confidence=clamp(Math.min(1,n/200)*(0.5+Math.abs(delta)*4),0,0.99);
  const status=delta>=0.03&&confidence>=0.7?"PROMOTE":delta<=-0.03&&confidence>=0.7?"REJECT":"NEUTRAL";
  return {baselineScore:Number(b.toFixed(4)),candidateScore:Number(c.toFixed(4)),delta:Number(delta.toFixed(4)),observations:n,confidence:Number(confidence.toFixed(3)),status};
}
export function buildDecisionTrace(
  symbol:string,strategyId:string,session:string,regime:string,direction:"LONG"|"SHORT"|"NONE",
  rawScore:number,calibratedScore:number,confidence:number,uncertainty:number,evidence:DecisionEvidence[],blockers:string[],policyVersion=1,
){
  const id=createHash("sha256").update([symbol,strategyId,session,regime,direction,policyVersion,String(Date.now()),Math.random()].join("|")).digest("hex").slice(0,24);
  db.prepare("INSERT INTO decision_trace (id,symbol,strategy_id,session,regime,direction,policy_version,raw_score,calibrated_score,confidence,uncertainty,evidence_json,blockers_json,sentinel_required,sentinel_approved,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)")
    .run(id,symbol,strategyId,session,regime,direction,policyVersion,rawScore,calibratedScore,confidence,uncertainty,JSON.stringify(evidence),JSON.stringify(blockers),1,0,Date.now());
  return id;
}
export function evaluatePolicyGovernance(policyName:string):DecisionGovernance{
  const row=db.prepare("SELECT version,status,config_json FROM decision_policy_versions WHERE policy_name=? ORDER BY CASE WHEN status='ACTIVE' THEN 0 WHEN status='CANDIDATE' THEN 1 WHEN status='SHADOW' THEN 2 WHEN status='QUARANTINED' THEN 3 WHEN status='RETIRED' THEN 4 ELSE 5 END, version DESC LIMIT 1").get(policyName) as any;
  if(!row)return {policyVersion:1,calibratedScore:0,uncertainty:1,status:"SHADOW",canProceed:false,sentinelRequired:true,reason:"No validated policy version; remain shadow-only."};
  const status=row.status as DecisionGovernance["status"];
  const can=status==="ACTIVE";
  return {policyVersion:Number(row.version),calibratedScore:0,uncertainty:can?0.2:0.8,status,canProceed:can,sentinelRequired:true,reason:can?"Validated active policy; Sentinel remains mandatory.":`Policy ${status.toLowerCase()} and cannot authorize execution.`};
}
export function registerPolicyVersion(policyName:string,version:number,config:Record<string,unknown>,status:PolicyStatus="SHADOW",parentId:string|null=null){
  const id=createHash("sha256").update([policyName,version,JSON.stringify(config)].join("|")).digest("hex").slice(0,24);
  db.prepare("INSERT OR REPLACE INTO decision_policy_versions (id,policy_name,version,status,config_json,parent_id,train_observations,oos_observations,oos_delta,confidence,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)")
    .run(id,policyName,version,status,JSON.stringify(config),parentId??null,0,0,0,0,Date.now());
  return id;
}
export function promotePolicy(
  policyName:string,fromVersion:number,toVersion:number,trainObservations:number,oosObservations:number,oosDelta:number,confidence:number,
):"PROMOTED"|"REJECTED"{
  const valid=trainObservations>=50&&oosObservations>=30&&oosDelta>=0.03&&confidence>=0.7&&researchIntegrity.valid;
  transaction(()=>{
    db.prepare("INSERT INTO policy_promotions (id,policy_name,from_version,to_version,train_observations,oos_observations,oos_delta,confidence,reason,status,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)")
      .run(createHash("sha256").update([policyName,fromVersion,toVersion,String(Date.now())].join("|")).digest("hex").slice(0,24),policyName,fromVersion,toVersion,trainObservations,oosObservations,oosDelta,confidence,valid?"OOS governance and research-integrity gates passed.":"OOS governance or research-integrity gate failed.",valid?"PROMOTED":"REJECTED",Date.now());
    if(valid){
      db.prepare("UPDATE decision_policy_versions SET status='RETIRED',retired_at=? WHERE policy_name=? AND version=?").run(Date.now(),policyName,fromVersion);
      db.prepare("UPDATE decision_policy_versions SET status='ACTIVE',activated_at=? WHERE policy_name=? AND version=?").run(Date.now(),policyName,toVersion);
    } else {
      db.prepare("UPDATE decision_policy_versions SET status='QUARANTINED' WHERE policy_name=? AND version=?").run(policyName,toVersion);
    }
  });
  return valid?"PROMOTED":"REJECTED";
}
export function rollbackPolicy(policyName:string,version:number):void{
  transaction(()=>{
    db.prepare("UPDATE decision_policy_versions SET status='RETIRED',retired_at=? WHERE policy_name=? AND status='ACTIVE'").run(Date.now(),policyName);
    db.prepare("UPDATE decision_policy_versions SET status='ACTIVE',activated_at=? WHERE policy_name=? AND version=?").run(Date.now(),policyName,version);
  });
}
export function policyResearchSummary(){return db.prepare("SELECT policy_name AS policyName,status,MAX(version) AS version,MAX(oos_delta) AS oosDelta,MAX(confidence) AS confidence FROM decision_policy_versions GROUP BY policy_name,status ORDER BY policyName").all();}
