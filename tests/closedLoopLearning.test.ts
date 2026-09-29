import { validateClosedLoopRules, evaluateClosedLoopGate, type ClosedLoopRule } from "../lib/trading/closedLoopLearning";
import * as assert from "./assert";

export function runClosedLoopLearningTest(): void {
  const rules: ClosedLoopRule[] = [{
    id: "r1",
    contextKey: "opening-range breakout|LONDON|LONG|RANGING",
    cause: "NO_FOLLOW_THROUGH",
    strategy: "opening-range breakout",
    session: "LONDON",
    side: "LONG",
    regime: "RANGING",
    status: "ACTIVE_BLOCK",
    trainObservations: 30,
    trainFailures: 20,
    trainFailureRate: 0.667,
    oosObservations: 25,
    oosFailures: 18,
    oosWins: 7,
    oosFailureRate: 0.72,
    oosFailureRateLower95: 0.52,
    oosExpectancyR: -0.2,
    counterEvidence: 7,
    recentFailureRate: 0.7,
    reason: "validated",
    updatedAt: Date.now(),
  }];

  const gate = evaluateClosedLoopGate({
    strategy: "opening-range breakout",
    session: "LONDON",
    side: "LONG",
    regime: "RANGING",
    htfAgreement: true,
    volatilityRatio: 1,
    momentumProxy: 1,
    entryTimingScore: 1,
  }, rules);

  assert.equal(gate.blocked, true, "active OOS rule must block matching context");
  assert.equal(gate.status, "ACTIVE_BLOCK", "gate must expose lifecycle status");

  const candles = Array.from({ length: 80 }, (_, i) => ({
    time: i * 300000,
    open: 2500,
    high: 2501,
    low: 2499,
    close: i % 2 ? 2499.8 : 2500.2,
  }));
  const cycle = validateClosedLoopRules([], candles);
  assert.equal(cycle.nextAction, "COLLECT_MORE_DATA", "empty research sample must remain inactive");
}
