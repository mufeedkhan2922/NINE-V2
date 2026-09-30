import { getMistakePatternDecision } from "./mistakePatternMining";
import { getCounterfactualPreventionDecision } from "./counterfactualReplay";

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
  const counterfactual = getCounterfactualPreventionDecision(
    input.symbol,
    input.session,
    input.regime,
    input.side,
  );

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

  if (pattern.adjustment < 0 || counterfactual.adjustment < 0) {
    const contextSimilarity = Math.min(1, pattern.observations / 50);
    const confidencePenalty = input.confidence < 70 ? 0.15 : 0;
    const counterfactualSimilarity = Math.min(1, counterfactual.observations / 50);
    const similarity = Math.max(
      0,
      Math.min(1, Math.max(contextSimilarity, counterfactualSimilarity) + confidencePenalty),
    );
    const adjustment = Math.max(-6, pattern.adjustment + counterfactual.adjustment);
    const reasons = [
      pattern.adjustment < 0 ? pattern.reason : null,
      counterfactual.adjustment < 0 ? counterfactual.reason : null,
    ].filter(Boolean).join(" ");
    return {
      status: similarity >= 0.65 ? "WATCH" : "PENALIZE",
      adjustment,
      similarity,
      observations: Math.max(pattern.observations, counterfactual.observations),
      reason: reasons || "Historical failure evidence requires additional scrutiny.",
      matchedPatterns: [
        ...pattern.patterns,
        ...(counterfactual.adjustment < 0 ? ["COUNTERFACTUAL_REPLAY"] : []),
      ],
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
