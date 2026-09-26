import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

import { db, transaction } from "../lib/trading/db";
import {
  createOrder,
  getOrder,
  getOrderByRequestHash,
  updateOrder,
} from "../lib/trading/orders";
import {
  appendExecutionLedger,
  getExecutionLedger,
  requestHash,
} from "../lib/trading/ledger";
import {
  executeBrokerOrder,
} from "../lib/trading/execution";

function uniqueRequest() {
  return {
    symbol: "XAUUSD" as const,
    side: "BUY" as const,
    quantity: 0.01,
    entryPrice: 4300,
    stopLoss: 4290,
    takeProfit: 4320,
    mode: "PAPER" as const,
    sentinelApproved: true,
  };
}

export async function runOrdersTests(): Promise<void> {
  const request = uniqueRequest();
  const hash = requestHash({
    ...request,
    testId: randomUUID(),
  });

  const order = createOrder(
    request,
    hash,
    { test: "orders" },
  );

  assert.equal(order.status, "PENDING");
  assert.equal(
    getOrder(order.id)?.id,
    order.id,
  );

  const duplicate = createOrder(
    request,
    hash,
    { test: "duplicate" },
  );

  assert.equal(
    duplicate.id,
    order.id,
    "Duplicate request must return the existing order.",
  );

  const submitted = updateOrder(
    order.id,
    {
      status: "SUBMITTED",
    },
  );

  assert.equal(
    submitted.status,
    "SUBMITTED",
  );

  const filled = updateOrder(
    order.id,
    {
      status: "FILLED",
      filledPrice: 4300,
    },
  );

  assert.equal(filled.status, "FILLED");
  assert.equal(filled.filledPrice, 4300);

  const closed = updateOrder(
    order.id,
    {
      status: "CLOSED",
    },
  );

  assert.equal(
    closed.status,
    "CLOSED",
  );

  assert.equal(
    getOrderByRequestHash(hash)?.id,
    order.id,
  );

  const ledger = appendExecutionLedger({
    eventType: "FILL",
    timestamp: Date.now(),
    symbol: request.symbol,
    mode: request.mode,
    side: request.side,
    quantity: request.quantity,
    price: request.entryPrice,
    stopLoss: request.stopLoss,
    takeProfit: request.takeProfit,
    status: "FILLED",
    orderId: order.id,
    requestHash: hash,
    metadata: {
      test: true,
    },
  });

  assert.equal(
    ledger.orderId,
    order.id,
  );

  const storedLedger =
    getExecutionLedger(100).find(
      (item) => item.id === ledger.id,
    );

  assert.equal(
    storedLedger?.orderId,
    order.id,
  );

  let immutableUpdateFailed = false;

  try {
    db.prepare(`
      UPDATE execution_ledger
      SET status = 'CORRUPTED'
      WHERE id = ?
    `).run(ledger.id);
  } catch {
    immutableUpdateFailed = true;
  }

  assert.equal(
    immutableUpdateFailed,
    true,
    "Execution ledger must reject updates.",
  );

  let immutableDeleteFailed = false;

  try {
    db.prepare(`
      DELETE FROM execution_ledger
      WHERE id = ?
    `).run(ledger.id);
  } catch {
    immutableDeleteFailed = true;
  }

  assert.equal(
    immutableDeleteFailed,
    true,
    "Execution ledger must reject deletes.",
  );

  const rejected =
    await executeBrokerOrder({
      ...request,
      sentinelApproved: false,
    });

  assert.equal(
    rejected.accepted,
    false,
  );

  assert.match(
    rejected.message,
    /Sentinel approval/i,
  );

  assert.equal(
    process.env.NINE_LIVE_TRADING_ENABLED === "true",
    false,
    "Tests expect live trading to remain disabled by default.",
  );
}