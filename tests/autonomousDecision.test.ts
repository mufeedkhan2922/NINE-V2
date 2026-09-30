import { evaluateAutonomousDecision } from "../lib/trading/autonomousDecision";
import type { StrategyCandidate } from "../lib/trading/strategyEngine";

function candidate(
  strategyId: string,
  direction: "LONG" | "SHORT",
  score: number,
  confidence: number,
  family: StrategyCandidate["family"],
  concepts: string[],
  blockers: string[] = [],
): StrategyCandidate {
  return {
    strategyId,
    strategyName: strategyId,
    family,
    direction,
    score,
    confidence,
    matchedConcepts: concepts,
    reasons: [],
    blockers,
  };
}

export function runAutonomousDecisionTest(): void {
  const trade = evaluateAutonomousDecision({
    candidates: [
      candidate("a", "LONG", 82, 84, "SMC", ["liquidity-sweep", "choch", "fvg"]),
      candidate("b", "LONG", 78, 80, "TREND", ["trend", "bos", "session-filter"]),
    ],
  });
  if (trade.status !== "TRADE" || trade.direction !== "LONG") {
    throw new Error("aligned high-quality evidence did not reach TRADE");
  }
  if (trade.uncertainty >= 0.45) throw new Error("high-quality evidence remained too uncertain");

  const conflict = evaluateAutonomousDecision({
    candidates: [
      candidate("a", "LONG", 80, 82, "SMC", ["liquidity-sweep", "fvg"]),
      candidate("b", "SHORT", 75, 80, "REVERSAL", ["rsi-regime", "premium-discount"]),
    ],
  });
  if (conflict.status !== "WATCH" || conflict.direction !== "NONE") {
    throw new Error("directional conflict was not converted to WATCH");
  }

  const weak = evaluateAutonomousDecision({
    candidates: [candidate("a", "LONG", 54, 58, "TREND", ["trend"])],
  });
  if (weak.status !== "WATCH" || weak.direction !== "NONE") {
    throw new Error("weak evidence was not abstained");
  }

  const blocked = evaluateAutonomousDecision({
    candidates: [candidate("a", "LONG", 90, 95, "SMC", ["fvg"], ["causal failure gate"])],
  });
  if (blocked.status !== "BLOCK" || blocked.direction !== "NONE") {
    throw new Error("blocked candidate bypassed the autonomous gate");
  }
}
