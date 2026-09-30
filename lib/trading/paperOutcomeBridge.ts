import type { PaperPosition } from "./types";
import type { DecisionOutcomeObservation } from "./decisionOutcome";

export function buildPaperDecisionObservation(
  position: PaperPosition,
  exitPrice: number,
  exitReason: string,
  timestamp = Date.now(),
): DecisionOutcomeObservation {
  const riskPerUnit = Math.abs(position.entryPrice - position.stopLoss);
  const riskDollars = riskPerUnit * position.quantity;
  const pnl = position.realizedPnl ?? (
    position.side === "BUY"
      ? (exitPrice - position.entryPrice) * position.quantity
      : (position.entryPrice - exitPrice) * position.quantity
  );
  const pnlR = riskDollars > 0 ? pnl / riskDollars : 0;
  const session = position.decisionSession ?? sessionFor(position.openedAt);
  const regime = position.decisionRegime ?? "MIXED";
  return {
    symbol: position.symbol,
    strategyId: position.strategyId ?? "paper-setup",
    session,
    regime,
    direction: position.side === "BUY" ? "LONG" : "SHORT",
    decisionStatus: position.decisionStatus ?? "TRADE",
    outcome: pnlR > 0.05 ? "WIN" : pnlR < -0.05 ? "LOSS" : "BREAKEVEN",
    pnlR,
    maxFavorableR: position.maxFavorableR ?? 0,
    maxAdverseR: position.maxAdverseR ?? 0,
    exitReason,
    traceId: position.traceId,
    timestamp,
  };
}

function sessionFor(timestamp: number): string {
  const hour = new Date(timestamp).getUTCHours();
  if (hour < 7) return "ASIA";
  if (hour < 12) return "LONDON";
  if (hour < 21) return "NEW_YORK";
  return "OFF";
}

export function updatePaperExcursion(position: PaperPosition, price: number): void {
  const riskPerUnit = Math.abs(position.entryPrice - position.stopLoss);
  if (!Number.isFinite(riskPerUnit) || riskPerUnit <= 0) return;
  const favorable = position.side === "BUY"
    ? Math.max(0, price - position.entryPrice)
    : Math.max(0, position.entryPrice - price);
  const adverse = position.side === "BUY"
    ? Math.max(0, position.entryPrice - price)
    : Math.max(0, price - position.entryPrice);
  position.maxFavorableR = Math.max(position.maxFavorableR ?? 0, favorable / riskPerUnit);
  position.maxAdverseR = Math.max(position.maxAdverseR ?? 0, adverse / riskPerUnit);
}
