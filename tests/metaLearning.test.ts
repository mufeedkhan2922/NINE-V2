import { arbitrateStrategies, calculateMetaAdjustment, deduplicateEvidence, metaWilsonLower } from "../lib/trading/metaLearning";

export function runMetaLearningTest(): void {
  const deduped = deduplicateEvidence(["trend", "ema-cross", "bos", "choch", "fvg", "order-block"]);
  if (deduped.length >= 6) throw new Error("correlated evidence was not deduplicated");

  const strong = calculateMetaAdjustment([
    { concept: "structure", observations: 120, wins: 82, losses: 38 },
    { concept: "liquidity", observations: 120, wins: 76, losses: 44 },
  ]);
  if (strong.adjustment <= 0 || strong.abstain) throw new Error("strong evidence was not recognized");

  const weak = calculateMetaAdjustment([{ concept: "new", observations: 3, wins: 2, losses: 1 }]);
  if (!weak.abstain) throw new Error("weak evidence did not abstain");

  const conflict = arbitrateStrategies([
    { strategyId: "a", family: "TREND", direction: "LONG", score: 70, confidence: 70, blockers: [] },
    { strategyId: "b", family: "REVERSAL", direction: "SHORT", score: 67, confidence: 68, blockers: [] },
  ]);
  if (!conflict.abstain || conflict.direction !== "NONE") throw new Error("conflict arbitration failed");

  const aligned = arbitrateStrategies([
    { strategyId: "a", family: "TREND", direction: "LONG", score: 80, confidence: 82, blockers: [] },
    { strategyId: "b", family: "SMC", direction: "LONG", score: 76, confidence: 78, blockers: [] },
  ]);
  if (aligned.direction !== "LONG" || aligned.abstain) throw new Error("aligned arbitration failed");

  if (metaWilsonLower(0, 20) !== 0) throw new Error("Wilson lower bound baseline failed");
}
