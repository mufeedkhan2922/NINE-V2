import { db } from "../lib/trading/db";
import { sequentialPolicyEvaluation, registerPolicyVersion, evaluatePolicyGovernance, promotePolicy, rollbackPolicy } from "../lib/trading/policyGovernance";
import type { ResearchIntegrityGate } from "../lib/trading/statisticalValidation";

export function runPolicyGovernanceTest(): void {
  const baseline=Array.from({length:200},(_,i)=>(i%2===0?1:0) as 0|1);
  const candidate=Array.from({length:200},(_,i)=>(i%10<7?1:0) as 0|1);
  const evalResult=sequentialPolicyEvaluation(baseline,candidate,30);
  if(evalResult.status!=="PROMOTE"||evalResult.delta<0.03) throw new Error("OOS promotion gate failed");
  const insufficient=sequentialPolicyEvaluation(baseline.slice(0,10),candidate.slice(0,10),30);
  if(insufficient.status!=="INSUFFICIENT") throw new Error("minimum sample gate failed");

  const name="TEST_POLICY_"+Date.now();
  registerPolicyVersion(name,1,{threshold:0.7},"SHADOW");
  const before=evaluatePolicyGovernance(name);
  if(before.canProceed||before.sentinelRequired!==true) throw new Error("shadow policy bypassed governance");
  registerPolicyVersion(name,2,{threshold:0.72},"CANDIDATE");
  const researchIntegrity: ResearchIntegrityGate = {
    valid: true,
    reasons: [],
    foldAudit: { valid: true, reason: "validated", validFolds: 2 },
    parameterAudit: { valid: true, reason: "no OOS tuning", parameters: {} },
    multipleTesting: { hypotheses: 2, alpha: 0.05, adjustedAlpha: 0.025, valid: true, method: "BONFERRONI" },
    reproducibilityHash: "test-integrity",
  };
  const result=promotePolicy(name,1,2,60,60,evalResult.delta,0.9,researchIntegrity);
  if(result!=="PROMOTED") throw new Error("validated policy did not promote");
  const active=evaluatePolicyGovernance(name);
  if(active.policyVersion!==2||!active.canProceed||!active.sentinelRequired) throw new Error("active policy state invalid");
  registerPolicyVersion(name,3,{threshold:0.74},"CANDIDATE");
  const rejectedIntegrity = { ...researchIntegrity, valid: false, reasons: ["missing provenance"] };
  const rejected = promotePolicy(name,2,3,60,60,evalResult.delta,0.9,rejectedIntegrity);
  if(rejected!=="REJECTED") throw new Error("incomplete research integrity must block promotion");
  rollbackPolicy(name,1);
  const rolled=evaluatePolicyGovernance(name);
  if(rolled.policyVersion!==1||!rolled.canProceed||!rolled.sentinelRequired) throw new Error("rollback failed");
  db.prepare("DELETE FROM policy_promotions WHERE policy_name=?").run(name);
  db.prepare("DELETE FROM decision_policy_versions WHERE policy_name=?").run(name);
}
