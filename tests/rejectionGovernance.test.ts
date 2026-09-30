import { db } from "../lib/trading/db";
import {
  auditRejectionGovernance,
  getRejectionGovernanceDecision,
} from "../lib/trading/rejectionGovernance";

export function runRejectionGovernanceTest(): void {
  const symbol = "TEST_GOV_" + Date.now();
  const blocker = "ADAPTIVE LOSS FILTER";
  const session = "NEW_YORK";
  const regime = "RANGING";
  const side = "LONG";

  const result = auditRejectionGovernance({
    symbol,
    blocker,
    session,
    regime,
    side,
  });

  if (result.status !== "NEUTRAL" || result.executable !== false) {
    throw new Error("neutral rejection governance state invalid");
  }

  db.prepare(
    `INSERT INTO rejection_quality_memory
      (id,symbol,blocker,session,regime,side,outcome,observations,wins,losses,expectancy_r,win_rate_lower_95,status,source,updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
  ).run(
    "gov-costly-" + Date.now(),
    symbol,
    "ADAPTIVE_LOSS_FILTER",
    session,
    regime,
    side,
    "WOULD_HAVE_WON",
    20,
    20,
    0,
    1,
    0.83,
    "COSTLY",
    "TEST",
    Date.now(),
  );

  const costly = auditRejectionGovernance({
    symbol,
    blocker,
    session,
    regime,
    side,
  });
  if (costly.status !== "SHADOW_REVIEW" || costly.executable !== false) {
    throw new Error("costly blocker escaped shadow governance");
  }

  const persisted = getRejectionGovernanceDecision({
    symbol,
    blocker,
    session,
    regime,
    side,
  });
  if (persisted.status !== "SHADOW_REVIEW" || persisted.executable !== false) {
    throw new Error("shadow governance state was not persisted");
  }

  db.prepare("DELETE FROM rejection_governance_memory WHERE symbol=?").run(symbol);
  db.prepare("DELETE FROM rejection_quality_memory WHERE symbol=?").run(symbol);
}
