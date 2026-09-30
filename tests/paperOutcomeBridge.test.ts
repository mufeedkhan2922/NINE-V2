import { db } from "../lib/trading/db";
import { getPaperAccount } from "../lib/trading/paperTrading";

export function runPaperOutcomeBridgeTest(): void {
  const symbol = "XAUUSD";
  db.prepare("DELETE FROM decision_outcome_memory WHERE symbol=?").run(symbol);
  db.prepare("DELETE FROM causal_failure_memory WHERE symbol=?").run(symbol);
  db.prepare("DELETE FROM positions WHERE symbol=?").run(symbol);

  const openedAt = Date.now() - 60_000;
  db.prepare(`
    INSERT INTO positions (
      id, account_id, symbol, side, quantity, entry_price, stop_loss, take_profit,
      opened_at, status, exit_price, closed_at, realized_pnl, order_id,
      strategy_id, decision_session, decision_regime, decision_status, trace_id,
      max_favorable_r, max_adverse_r
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
  `).run(
    "PAPER-BRIDGE-1", "paper-main", symbol, "BUY", 1,
    100, 95, 110, openedAt, "OPEN", null, null, null, null,
    "sweep-mss-fvg", "NEW_YORK", "TRENDING_DOWN", "TRADE", null, 0, 0,
  );

  const account = getPaperAccount(95);
  const position = account.positions.find((item) => item.id === "PAPER-BRIDGE-1");
  if (!position || position.status !== "CLOSED") {
    throw new Error("paper position did not settle through the normal paper account path");
  }
  if ((position.maxAdverseR ?? 0) < 0.99) {
    throw new Error("paper adverse excursion was not captured before settlement");
  }

  const outcome = db.prepare(
    `SELECT strategy_id AS strategyId, session, regime, direction, decision_status AS decisionStatus,
            outcome, pnl_r AS pnlR, max_adverse_r AS maxAdverseR
     FROM decision_outcome_memory
     WHERE symbol=? ORDER BY created_at DESC LIMIT 1`,
  ).get(symbol) as any;

  if (!outcome) throw new Error("paper closure did not create a decision outcome");
  if (outcome.strategyId !== "sweep-mss-fvg" || outcome.session !== "NEW_YORK" || outcome.regime !== "TRENDING_DOWN") {
    throw new Error("paper decision context was not preserved");
  }
  if (outcome.direction !== "LONG" || outcome.decisionStatus !== "TRADE") {
    throw new Error("paper decision direction/status was not preserved");
  }
  if (outcome.outcome !== "LOSS" || Number(outcome.pnlR) >= 0 || Number(outcome.maxAdverseR) < 0.99) {
    throw new Error("paper closure outcome was not classified or measured correctly");
  }

  const causal = db.prepare(
    "SELECT observations,failures,status FROM causal_failure_memory WHERE symbol=? AND strategy=? AND failure_mode='DECISION_OUTCOME'",
  ).get(symbol, "sweep-mss-fvg") as any;
  if (!causal || causal.observations !== 1 || causal.failures !== 1 || causal.status !== "OBSERVE") {
    throw new Error("paper outcome did not enter causal memory conservatively");
  }

  db.prepare("DELETE FROM positions WHERE symbol=?").run(symbol);
  db.prepare("DELETE FROM decision_outcome_memory WHERE symbol=?").run(symbol);
  db.prepare("DELETE FROM causal_failure_memory WHERE symbol=?").run(symbol);
}
