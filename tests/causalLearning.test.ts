import { investigateCausalFailure } from "../lib/trading/causalLearning";

export function runCausalLearningTest(): void {
  const candles = Array.from({length:40}, (_,i)=>({
    time:i*60000,
    open:100,
    high:i===10?105:101,
    low:i===10?99:99.8,
    close:i===10?100:100.1,
  }));
  const trade={
    id:"T1", index:10, side:"LONG" as const, entryTime:10*60000, exitTime:11*60000,
    entryPrice:100, exitPrice:99.8, stopLoss:99.7, takeProfit:100.6, quantity:1,
    pnl:-0.2, outcome:"LOSS" as const, reason:"STOP" as const,
    entryReason:"quality; LONG sweep-mss-fvg", exitReason:"stop",
  };
  const assessment=investigateCausalFailure(trade,candles,"XAUUSD");
  if (!assessment.mode || assessment.severity <= 0) throw new Error("causal failure was not classified");
  if (assessment.evidence.length === 0) throw new Error("causal evidence was not recorded");
}
