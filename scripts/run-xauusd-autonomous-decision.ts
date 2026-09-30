import fs from "node:fs";
import { evaluateAutonomousDecision } from "../lib/trading/autonomousDecision";
import type { StrategyCandidate } from "../lib/trading/strategyEngine";

function candidate(
  id: string,
  direction: "LONG" | "SHORT",
  score: number,
  confidence: number,
  family: StrategyCandidate["family"],
  concepts: string[],
  blockers: string[] = [],
): StrategyCandidate {
  return {
    strategyId: id,
    strategyName: id,
    family,
    direction,
    score,
    confidence,
    matchedConcepts: concepts,
    reasons: [],
    blockers,
  };
}

const scenarios = [
  {
    name: "aligned-confluence",
    candidates: [
      candidate("smc", "LONG", 82, 84, "SMC", ["liquidity-sweep", "choch", "fvg"]),
      candidate("trend", "LONG", 78, 80, "TREND", ["trend", "bos", "session-filter"]),
    ],
  },
  {
    name: "directional-conflict",
    candidates: [
      candidate("smc", "LONG", 80, 82, "SMC", ["liquidity-sweep", "fvg"]),
      candidate("reversal", "SHORT", 75, 80, "REVERSAL", ["rsi-regime", "premium-discount"]),
    ],
  },
  {
    name: "weak-evidence",
    candidates: [candidate("trend", "LONG", 54, 58, "TREND", ["trend"])],
  },
  {
    name: "blocked-by-learning",
    candidates: [candidate("smc", "LONG", 90, 95, "SMC", ["fvg"], ["causal failure gate"])],
  },
];

const report = scenarios.map((scenario) => ({
  scenario: scenario.name,
  decision: evaluateAutonomousDecision({ candidates: scenario.candidates }),
}));

const result = {
  version: "0.5.25",
  symbol: "XAUUSD",
  generatedAt: Date.now(),
  scenarios: report,
  safety: [
    "Autonomous decision intelligence is a selection and abstention layer; it does not place broker orders.",
    "WATCH is preferred when evidence is weak or materially conflicted instead of forcing direction.",
    "BLOCKed candidates remain blocked even when their raw score is high.",
    "Sentinel remains the final authority before any execution.",
  ],
};

fs.mkdirSync("artifacts", { recursive: true });
fs.writeFileSync("artifacts/xauusd-autonomous-decision.json", JSON.stringify(result, null, 2));
console.log(JSON.stringify(result, null, 2));
