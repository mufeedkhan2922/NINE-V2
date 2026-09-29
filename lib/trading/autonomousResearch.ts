import type { BacktestTrade } from "./backtest";
import type { Candle } from "./types";
import { investigateLosses, type RootCauseFinding } from "./rootCauseLearning";
import { mineRules, type LearnedRule } from "./adaptiveRules";

export interface ResearchCycle {
  startedAt: number;
  trades: number;
  losses: number;
  findings: RootCauseFinding[];
  rules: LearnedRule[];
  nextAction: "VALIDATE_RULES"|"COLLECT_MORE_DATA"|"NO_ACTION";
}

export function runResearchCycle(trades: BacktestTrade[], candles: Candle[]): ResearchCycle {
  const startedAt=Date.now();
  const findings=investigateLosses(trades,candles);
  const rules=mineRules(findings, trades, candles, 20);
  const blocked=rules.filter(r=>r.status==="BLOCKED").length;
  return {startedAt,trades:trades.length,losses:trades.filter(t=>t.pnl<0).length,findings,rules,nextAction:blocked?"VALIDATE_RULES":findings.length?"COLLECT_MORE_DATA":"NO_ACTION"};
}
