import { getMistakePatternDecision } from "./mistakePatternMining";

export type PreventionStatus = "ALLOW" | "PENALIZE" | "WATCH" | "BLOCK";

export interface MistakePreventionInput {
  symbol: string;
  session: string;
  regime: string;
  side: "LONG" | "SHORT";
  strategyId: string;
  score: number;
  confidence: number;
  concepts: string[];
}

export interface MistakePreventionDecision {
  status: PreventionStatus;
  adjustment: number;
  similarity: number;
  observations: number;
  reason: string;
  matchedPatterns: string[];
}

/**
 * Pre-trade safety layer. It does not create trades; it only removes confidence
 * from contexts that resemble statistically validated recurring failure clusters.
 */
export function evaluateMistakePrevention(input: MistakePreventionInput): MistakePreventionDecision {
  const pattern = getMistakePatternDecision(input.symbol, input.session, input.regime, input.side);
  if (pattern.blocked) {
    return {
      status: "BLOCK",
      adjustment: -6,
      similarity: 1,
      observations: pattern.observations,
      reason: pattern.reason,
      matchedPatterns: pattern.patterns,
    };
  }

  if (pattern.adjustment < 0) {
    const contextSimilarity = Math.min(1, pattern.observations / 50);
    const confidencePenalty = input.confidence < 70 ? 0.15 : 0;
    const similarity = Math.max(0, Math.min(1, contextSimilarity + confidencePenalty));
    return {
      status: similarity >= 0.65 ? "WATCH" : "PENALIZE",
      adjustment: pattern.adjustment,
      similarity,
      observations: pattern.observations,
      reason: pattern.reason,
      matchedPatterns: pattern.patterns,
    };
  }

  return {
    status: "ALLOW",
    adjustment: 0,
    similarity: 0,
    observations: 0,
    reason: "No validated recurring mistake pattern matches the current context.",
    matchedPatterns: [],
  };
}
