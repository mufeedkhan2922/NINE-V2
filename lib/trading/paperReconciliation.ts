import { db } from "./db";
import { getStoreSnapshot } from "./store";

export type ReconciliationSeverity = "INFO" | "WARNING" | "ERROR";

export interface ReconciliationIssue {
  code: string;
  severity: ReconciliationSeverity;
  message: string;
  orderId?: string;
  positionId?: string;
}

export interface PaperReconciliation {
  healthy: boolean;
  score: number;
  checkedAt: number;
  account: {
    balance: number;
    equity: number;
    openPositions: number;
  };
  counts: {
    openPositions: number;
    filledOrders: number;
    closedOrders: number;
    fillLedgerEvents: number;
    closeLedgerEvents: number;
  };
  issues: ReconciliationIssue[];
}

type PositionRow = {
  id: string;
  order_id: string | null;
  status: string;
  symbol: string;
  side: string;
  quantity: number;
  entry_price: number;
  stop_loss: number;
  take_profit: number;
  exit_price: number | null;
};

type OrderRow = {
  id: string;
  status: string;
  mode: string;
  symbol: string;
  side: string;
  quantity: number;
  filled_price: number | null;
  stop_loss: number;
  take_profit: number;
};

function nearlyEqual(a: number, b: number, tolerance = 1e-8): boolean {
  return Math.abs(a - b) <= tolerance;
}

export function reconcilePaperState(): PaperReconciliation {
  const store = getStoreSnapshot();
  const issues: ReconciliationIssue[] = [];

  const positions = db.prepare(
    "SELECT id, order_id, status, symbol, side, quantity, entry_price, stop_loss, take_profit, exit_price FROM positions WHERE account_id = ?",
  ).all("paper-main") as PositionRow[];

  const orders = db.prepare(
    "SELECT id, status, mode, symbol, side, quantity, filled_price, stop_loss, take_profit FROM orders WHERE account_id = ? OR (account_id IS NULL AND mode = 'PAPER')",
  ).all("paper-main") as OrderRow[];

  const orderById = new Map(orders.map((order) => [order.id, order]));

  const fillCounts = db.prepare(
    "SELECT COUNT(*) AS count FROM execution_ledger WHERE mode = 'PAPER' AND event_type = 'FILL'",
  ).get() as { count: number };

  const closeCounts = db.prepare(
    "SELECT COUNT(*) AS count FROM execution_ledger WHERE mode = 'PAPER' AND event_type = 'CLOSE'",
  ).get() as { count: number };

  for (const position of positions) {
    if (!position.order_id) {
      issues.push({
        code: "POSITION_WITHOUT_ORDER",
        severity: "ERROR",
        message: `Position ${position.id} has no order reference.`,
        positionId: position.id,
      });
      continue;
    }

    const order = orderById.get(position.order_id);
    if (!order) {
      issues.push({
        code: "POSITION_ORDER_MISSING",
        severity: "ERROR",
        message: `Position ${position.id} references missing order ${position.order_id}.`,
        orderId: position.order_id,
        positionId: position.id,
      });
      continue;
    }

    if (order.mode !== "PAPER") {
      issues.push({
        code: "MODE_MISMATCH",
        severity: "ERROR",
        message: `Position ${position.id} is linked to a non-paper order.`,
        orderId: order.id,
        positionId: position.id,
      });
    }

    if (position.status === "OPEN" && order.status !== "FILLED") {
      issues.push({
        code: "OPEN_POSITION_ORDER_STATE",
        severity: "ERROR",
        message: `Open position ${position.id} has order ${order.id} in ${order.status} state.`,
        orderId: order.id,
        positionId: position.id,
      });
    }

    if (position.status === "CLOSED" && order.status !== "CLOSED") {
      issues.push({
        code: "CLOSED_POSITION_ORDER_STATE",
        severity: "ERROR",
        message: `Closed position ${position.id} has order ${order.id} in ${order.status} state.`,
        orderId: order.id,
        positionId: position.id,
      });
    }

    if (!nearlyEqual(position.quantity, order.quantity)) {
      issues.push({
        code: "QUANTITY_MISMATCH",
        severity: "ERROR",
        message: `Position ${position.id} quantity does not match order ${order.id}.`,
        orderId: order.id,
        positionId: position.id,
      });
    }

    if (order.filled_price !== null && !nearlyEqual(position.entry_price, order.filled_price)) {
      issues.push({
        code: "FILL_PRICE_MISMATCH",
        severity: "ERROR",
        message: `Position ${position.id} entry price does not match order fill price.`,
        orderId: order.id,
        positionId: position.id,
      });
    }
  }

  for (const order of orders.filter((item) => item.status === "FILLED" || item.status === "CLOSED")) {
    const position = positions.find((item) => item.order_id === order.id);
    if (!position) {
      issues.push({
        code: "ORDER_WITHOUT_POSITION",
        severity: "WARNING",
        message: `Filled/closed paper order ${order.id} has no position row.`,
        orderId: order.id,
      });
    }
  }

  const openPositions = positions.filter((item) => item.status === "OPEN").length;
  const filledOrders = orders.filter((item) => item.status === "FILLED").length;
  const closedOrders = orders.filter((item) => item.status === "CLOSED").length;
  const errorCount = issues.filter((item) => item.severity === "ERROR").length;
  const warningCount = issues.filter((item) => item.severity === "WARNING").length;
  const score = Math.max(0, 100 - errorCount * 20 - warningCount * 5);

  return {
    healthy: issues.every((item) => item.severity === "INFO"),
    score,
    checkedAt: Date.now(),
    account: {
      balance: store.account.balance,
      equity: store.account.equity,
      openPositions: store.account.positions.filter((item) => item.status === "OPEN").length,
    },
    counts: {
      openPositions,
      filledOrders,
      closedOrders,
      fillLedgerEvents: Number(fillCounts.count),
      closeLedgerEvents: Number(closeCounts.count),
    },
    issues,
  };
}
