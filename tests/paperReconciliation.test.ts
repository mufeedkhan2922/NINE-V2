import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { db } from "../lib/trading/db";
import { reconcilePaperState } from "../lib/trading/paperReconciliation";

export function runPaperReconciliationTests(): void {
  const orderId = `TEST-RECON-ORDER-${randomUUID()}`;
  const positionId = `TEST-RECON-POS-${randomUUID()}`;
  const now = Date.now();

  try {
    db.prepare(
      "INSERT INTO orders (id,account_id,symbol,mode,side,quantity,requested_price,filled_price,stop_loss,take_profit,status,broker_order_id,sentinel_approved,request_hash,created_at,updated_at,metadata_json) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
    ).run(
      orderId, "paper-main", "XAUUSD", "PAPER", "BUY", 0.01,
      4300, 4300, 4290, 4320, "FILLED", null, 1,
      `recon-${randomUUID()}`, now, now, "{}",
    );

    db.prepare(
      "INSERT INTO positions (id,account_id,symbol,side,quantity,entry_price,stop_loss,take_profit,opened_at,status,exit_price,closed_at,realized_pnl,order_id) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
    ).run(
      positionId, "paper-main", "XAUUSD", "BUY", 0.01,
      4300, 4290, 4320, now, "OPEN", null, null, null, orderId,
    );

    const healthy = reconcilePaperState();
    assert.equal(healthy.issues.some((i) => i.positionId === positionId && i.severity === "ERROR"), false);
    assert.equal(healthy.score >= 80, true);

    db.prepare("UPDATE orders SET status = 'CLOSED' WHERE id = ?").run(orderId);
    const mismatch = reconcilePaperState();
    assert.equal(
      mismatch.issues.some((i) => i.code === "OPEN_POSITION_ORDER_STATE" && i.orderId === orderId),
      true,
      "reconciliation must detect an open-position/closed-order mismatch",
    );
  } finally {
    db.prepare("DELETE FROM positions WHERE id = ?").run(positionId);
    db.prepare("DELETE FROM orders WHERE id = ?").run(orderId);
  }
}
