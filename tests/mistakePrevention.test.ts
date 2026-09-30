import { db } from "../lib/trading/db";
import { mineMistakePatterns } from "../lib/trading/mistakePatternMining";
import { evaluateMistakePrevention } from "../lib/trading/mistakePrevention";

export function runMistakePreventionTest(): void {
  const symbol = "TEST-PREVENTION-XAUUSD";
  db.prepare("DELETE FROM mistake_patterns WHERE symbol=?").run(symbol);
  db.prepare("DELETE FROM causal_failure_memory WHERE symbol=?").run(symbol);

  for (let s = 0; s < 2; s += 1) {
    for (let i = 0; i < 12; i += 1) {
      db.prepare(`
        INSERT INTO causal_failure_memory
        (id,symbol,strategy,session,regime,side,failure_mode,observations,failures,wins,
         failure_rate,failure_rate_lower_95,expectancy_r,severity,confidence,status,last_seen,source)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
      `).run(
        `prevention-${s}-${i}`,symbol,`strategy-${s}`,"NEW_YORK","TRENDING_UP","LONG",
        "IMMEDIATE_ADVERSE_MOVE",1,1,0,1,0.5,-0.4,1,0.5,"PENALIZE",Date.now(),"TEST"
      );
    }
  }

  mineMistakePatterns(symbol);

  const blocked = evaluateMistakePrevention({
    symbol, session:"NEW_YORK", regime:"TRENDING_UP", side:"LONG",
    strategyId:"new-strategy", score:80, confidence:80, concepts:["liquidity-sweep"]
  });
  if (blocked.status !== "BLOCK") throw new Error("validated recurring pattern did not block a near-miss setup");

  db.prepare("DELETE FROM mistake_patterns WHERE symbol=?").run(symbol);
  db.prepare("DELETE FROM causal_failure_memory WHERE symbol=?").run(symbol);
}
