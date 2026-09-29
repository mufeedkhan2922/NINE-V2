import fs from "node:fs";
import { db } from "../lib/trading/db";
import { calculateMetaAdjustment, deduplicateEvidence } from "../lib/trading/metaLearning";

function main() {
  const rows = db.prepare(
    `SELECT symbol, session, regime, direction, concept, observations, wins, losses
     FROM meta_learning_memory
     WHERE observations >= 10
     ORDER BY updated_at DESC`,
  ).all() as Array<{
    symbol:string; session:string; regime:string; direction:string; concept:string;
    observations:number; wins:number; losses:number;
  }>;

  const contexts = new Map<string, typeof rows>();
  for (const row of rows) {
    const key = [row.symbol,row.session,row.regime,row.direction].join("|");
    const group=contexts.get(key)??[];
    group.push(row);
    contexts.set(key,group);
  }

  const report=[...contexts.entries()].map(([key,group])=>{
    const [symbol,session,regime,direction]=key.split("|");
    const evidence=group.map(x=>x.concept);
    const unique=deduplicateEvidence(evidence);
    const adjustment=calculateMetaAdjustment(group.filter(x=>unique.includes(x.concept)).map(x=>({
      concept:x.concept, observations:Number(x.observations), wins:Number(x.wins), losses:Number(x.losses)
    })));
    return {symbol,session,regime,direction,independentEvidence:unique,adjustment};
  });

  const result={
    version:"0.5.21",
    contexts:report.length,
    report,
    safety:[
      "Meta-learning modifies evidence weighting; it cannot create a setup.",
      "Correlated evidence is de-duplicated before arbitration.",
      "Weak or conflicting evidence produces abstention rather than a forced direction.",
      "Sentinel and risk controls remain authoritative."
    ]
  };
  fs.mkdirSync("artifacts",{recursive:true});
  fs.writeFileSync("artifacts/xauusd-meta-learning.json",JSON.stringify(result,null,2));
  console.log(JSON.stringify(result,null,2));
}
main();
