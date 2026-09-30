import { db } from "../lib/trading/db";
import { getMistakePatternDecision, mineMistakePatterns } from "../lib/trading/mistakePatternMining";

export function runMistakePatternMiningTest(): void {
  const symbol = "TEST-PATTERN-XAUUSD";
  db.prepare("DELETE FROM mistake_patterns WHERE symbol=?").run(symbol);
  db.prepare("DELETE FROM causal_failure_memory WHERE symbol=?").run(symbol);

  for (let strategyIndex = 0; strategyIndex < 2; strategyIndex += 1) {
    const strategy = `strategy-${strategyIndex}`;
    db.prepare(`
      INSERT INTO causal_failure_memory
      (id,symbol,strategy,session,regime,side,failure_mode,observations,failures,wins,
       failure_rate,failure_rate_lower_95,expectancy_r,severity,confidence,status,last_seen,source)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    `).run(
      `pattern-${strategy}`,symbol,strategy,"NEW_YORK","TRENDING_UP","LONG","IMMEDIATE_ADVERSE_MOVE",
      12,12,0,1,0.5,-0.4,1,0.5,"PENALIZE",Date.now(),"TEST"
    );
  }

  const mined = mineMistakePatterns(symbol);
  const pattern = mined.find((row) => row.failureMode === "IMMEDIATE_ADVERSE_MOVE");
  if (!pattern) throw new Error("recurring mistake pattern was not mined");
  if (pattern.strategies !== 2) throw new Error("pattern did not detect cross-strategy recurrence");
  if (pattern.status !== "BLOCK") throw new Error("validated recurring pattern was not blocked");

  const decision = getMistakePatternDecision(symbol,"NEW_YORK","TRENDING_UP","LONG");
  if (!decision.blocked) throw new Error("validated recurring pattern did not reach the decision gate");
  if (!decision.patterns.includes("IMMEDIATE_ADVERSE_MOVE")) throw new Error("pattern signature missing from gate decision");

  db.prepare("DELETE FROM mistake_patterns WHERE symbol=?").run(symbol);
  db.prepare("DELETE FROM causal_failure_memory WHERE symbol=?").run(symbol);
}
