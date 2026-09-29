import type { RootCauseFinding } from "./rootCauseLearning";

export interface LearnedRule {
  id: string;
  strategy: string;
  session: string;
  side: "LONG"|"SHORT";
  condition: string;
  cause: string;
  observations: number;
  failures: number;
  failureRate: number;
  meanSeverity: number;
  status: "CANDIDATE"|"VALIDATED"|"BLOCKED";
  reason: string;
}

function key(f: RootCauseFinding): string {
  return [f.context.strategy,f.context.session,f.context.side,f.cause].join("|");
}

export function mineRules(findings: RootCauseFinding[], minimumObservations=20): LearnedRule[] {
  const groups=new Map<string,RootCauseFinding[]>();
  for(const f of findings){ const k=key(f); const g=groups.get(k)??[]; g.push(f); groups.set(k,g); }
  return [...groups.entries()].map(([id,g])=>{
    const failures=g.length;
    const meanSeverity=g.reduce((s,x)=>s+x.severity,0)/failures;
    const rate=1;
    const status=failures>=minimumObservations && meanSeverity>=0.6 ? "BLOCKED" : failures>=Math.ceil(minimumObservations/2) ? "CANDIDATE" : "CANDIDATE";
    return {id,strategy:g[0]!.context.strategy,session:g[0]!.context.session,side:g[0]!.context.side,condition:`${g[0]!.context.regime} + ${g[0]!.cause}`,cause:g[0]!.cause,observations:failures,failures,failureRate:rate,meanSeverity:Number(meanSeverity.toFixed(3)),status,reason:status==="BLOCKED"?"Repeated high-severity failure pattern.":"Insufficient evidence for a hard block."};
  });
}

export function shouldBlockRule(rule: LearnedRule, minimumObservations=20): boolean {
  return rule.status==="BLOCKED" && rule.observations>=minimumObservations;
}
