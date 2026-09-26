import { randomUUID } from "node:crypto";

import { db } from "./db";
import type {
  ExecutionMode,
  MarketSymbol,
  OrderSide,
  OrderStatus,
  TradingOrder,
} from "./types";

type OrderRow = {
  id: string;
  account_id: string | null;
  symbol: string;
  mode: ExecutionMode;
  side: OrderSide;
  quantity: number;
  requested_price: number;
  filled_price: number | null;
  stop_loss: number;
  take_profit: number;
  status: OrderStatus;
  broker_order_id: string | null;
  sentinel_approved: number;
  request_hash: string;
  created_at: number;
  updated_at: number;
  metadata_json: string | null;
};

export interface CreateOrderInput {
  accountId?: string;
  symbol: MarketSymbol;
  side: OrderSide;
  quantity: number;
  entryPrice: number;
  stopLoss: number;
  takeProfit: number;
  mode: ExecutionMode;
  requestHash: string;
  metadata?: Record<string, string | number | boolean | null>;
  brokerOrderId?: string | null;
  sentinelApproved?: boolean;
}

export interface UpdateOrderInput {
  status?: OrderStatus;
  filledPrice?: number | null;
  brokerOrderId?: string | null;
  metadata?: Record<string, string | number | boolean | null>;
  reason?: string;
  closePrice?: number;
  positionId?: string;
  pnl?: number;
  source?: string;
}

function parseMetadata(
  value: string | null,
): Record<string, string | number | boolean | null> {
  if (!value) {
    return {};
  }

  try {
    const parsed = JSON.parse(value);

    if (
      parsed &&
      typeof parsed === "object" &&
      !Array.isArray(parsed)
    ) {
      return parsed as Record<
        string,
        string | number | boolean | null
      >;
    }
  } catch {
    // Preserve database readability if malformed metadata exists.
  }

  return {};
}

function mapOrder(row: OrderRow): TradingOrder {
  return {
    id: row.id,
    accountId: row.account_id ?? undefined,
    symbol: row.symbol as MarketSymbol,
    mode: row.mode,
    side: row.side,
    quantity: Number(row.quantity),
    requestedPrice: Number(row.requested_price),
    filledPrice:
      row.filled_price === null
        ? undefined
        : Number(row.filled_price),
    stopLoss: Number(row.stop_loss),
    takeProfit: Number(row.take_profit),
    status: row.status,
    brokerOrderId:
      row.broker_order_id ?? undefined,
    sentinelApproved:
      Number(row.sentinel_approved) === 1,
    requestHash: row.request_hash,
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
    metadata: parseMetadata(row.metadata_json),
  };
}

function getOrderByIdFromDatabase(
  id: string,
): TradingOrder | null {
  const row = db
    .prepare(
      `
      SELECT
        id,
        account_id,
        symbol,
        mode,
        side,
        quantity,
        requested_price,
        filled_price,
        stop_loss,
        take_profit,
        status,
        broker_order_id,
        sentinel_approved,
        request_hash,
        created_at,
        updated_at,
        metadata_json
      FROM orders
      WHERE id = ?
      LIMIT 1
      `,
    )
    .get(id) as OrderRow | undefined;

  return row ? mapOrder(row) : null;
}

export function getOrder(
  id: string,
): TradingOrder | null {
  return getOrderByIdFromDatabase(id);
}

export function getOrderByRequestHash(
  requestHash: string,
): TradingOrder | null {
  const row = db
    .prepare(
      `
      SELECT
        id,
        account_id,
        symbol,
        mode,
        side,
        quantity,
        requested_price,
        filled_price,
        stop_loss,
        take_profit,
        status,
        broker_order_id,
        sentinel_approved,
        request_hash,
        created_at,
        updated_at,
        metadata_json
      FROM orders
      WHERE request_hash = ?
      LIMIT 1
      `,
    )
    .get(requestHash) as OrderRow | undefined;

  return row ? mapOrder(row) : null;
}

export function getOrders(
  limit = 100,
): TradingOrder[] {
  const safeLimit = Math.max(
    1,
    Math.min(limit, 500),
  );

  const rows = db
    .prepare(
      `
      SELECT
        id,
        account_id,
        symbol,
        mode,
        side,
        quantity,
        requested_price,
        filled_price,
        stop_loss,
        take_profit,
        status,
        broker_order_id,
        sentinel_approved,
        request_hash,
        created_at,
        updated_at,
        metadata_json
      FROM orders
      ORDER BY created_at DESC
      LIMIT ?
      `,
    )
    .all(safeLimit) as OrderRow[];

  return rows.map(mapOrder);
}

const ALLOWED_TRANSITIONS: Record<
  OrderStatus,
  OrderStatus[]
> = {
  PENDING: [
    "SUBMITTING",
    "SUBMITTED",
    "FILLED",
    "CANCELLED",
    "REJECTED",
  ],

  SUBMITTING: [
    "SUBMITTED",
    "FILLED",
    "CANCELLED",
    "REJECTED",
  ],

  SUBMITTED: [
    "FILLED",
    "CANCELLED",
    "REJECTED",
  ],

  FILLED: [
    "CLOSED",
    "CANCELLED",
  ],

  CLOSED: [],

  CANCELLED: [],

  REJECTED: [],
};

function assertTransition(
  from: OrderStatus,
  to: OrderStatus,
): void {
  if (from === to) {
    return;
  }

  if (!ALLOWED_TRANSITIONS[from]?.includes(to)) {
    throw new Error(
      `Invalid order transition: ${from} -> ${to}`,
    );
  }
}

function buildMetadata(
  current: Record<string, string | number | boolean | null>,
  patch: UpdateOrderInput,
): Record<string, string | number | boolean | null> {
  return {
    ...current,
    ...(patch.reason !== undefined
      ? { reason: patch.reason }
      : {}),
    ...(patch.positionId !== undefined
      ? { positionId: patch.positionId }
      : {}),
    ...(patch.closePrice !== undefined
      ? { closePrice: patch.closePrice }
      : {}),
    ...(patch.pnl !== undefined
      ? { pnl: patch.pnl }
      : {}),
    ...(patch.source !== undefined
      ? { source: patch.source }
      : {}),
    ...(patch.metadata ?? {}),
  };
}

export function createOrderInTransaction(
  input: CreateOrderInput,
): TradingOrder {
  const existing = getOrderByRequestHash(
    input.requestHash,
  );

  if (existing) {
    return existing;
  }

  const now = Date.now();
  const orderId = `ORD-${randomUUID()}`;

  const sentinelApproved =
    input.sentinelApproved === true ? 1 : 0;

  const metadata = {
    ...(input.metadata ?? {}),
  };

  try {
    db.prepare(
      `
      INSERT INTO orders (
        id,
        account_id,
        symbol,
        mode,
        side,
        quantity,
        requested_price,
        filled_price,
        stop_loss,
        take_profit,
        status,
        broker_order_id,
        sentinel_approved,
        request_hash,
        created_at,
        updated_at,
        metadata_json
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
    ).run(
      orderId,
      input.accountId ?? null,
      input.symbol,
      input.mode,
      input.side,
      input.quantity,
      input.entryPrice,
      null,
      input.stopLoss,
      input.takeProfit,
      "PENDING",
      input.brokerOrderId ?? null,
      sentinelApproved,
      input.requestHash,
      now,
      now,
      JSON.stringify(metadata),
    );
  } catch (error) {
    const duplicate = getOrderByRequestHash(
      input.requestHash,
    );

    if (duplicate) {
      return duplicate;
    }

    throw error;
  }

  const created = getOrder(orderId);

  if (!created) {
    throw new Error(
      `Order was inserted but could not be reloaded: ${orderId}`,
    );
  }

  return created;
}

export function createOrder(
  request: {
    symbol: MarketSymbol;
    side: OrderSide;
    quantity: number;
    entryPrice: number;
    stopLoss: number;
    takeProfit: number;
    mode: ExecutionMode;
    sentinelApproved: boolean;
  },
  requestHash: string,
  metadata: Record<string, string | number | boolean | null> = {},
): TradingOrder {
  return createOrderInTransaction({
    symbol: request.symbol,
    side: request.side,
    quantity: request.quantity,
    entryPrice: request.entryPrice,
    stopLoss: request.stopLoss,
    takeProfit: request.takeProfit,
    mode: request.mode,
    requestHash,
    metadata,
    sentinelApproved: request.sentinelApproved,
  });
}

export function updateOrder(
  orderId: string,
  patch: UpdateOrderInput,
): TradingOrder {
  const current = getOrder(orderId);

  if (!current) {
    throw new Error(
      `Order not found: ${orderId}`,
    );
  }

  const nextStatus =
    patch.status ?? current.status;

  assertTransition(
    current.status,
    nextStatus,
  );

  const metadata = buildMetadata(
    current.metadata ?? {},
    patch,
  );

  const nextFilledPrice =
    patch.filledPrice !== undefined
      ? patch.filledPrice
      : current.filledPrice;

  const nextBrokerOrderId =
    patch.brokerOrderId !== undefined
      ? patch.brokerOrderId
      : current.brokerOrderId;

  const now = Date.now();

  db.prepare(
    `
    UPDATE orders
    SET
      status = ?,
      broker_order_id = ?,
      filled_price = ?,
      updated_at = ?,
      metadata_json = ?
    WHERE id = ?
    `,
  ).run(
    nextStatus,
    nextBrokerOrderId ?? null,
    nextFilledPrice ?? null,
    now,
    JSON.stringify(metadata),
    orderId,
  );

  const updated = getOrder(orderId);

  if (!updated) {
    throw new Error(
      `Order disappeared after update: ${orderId}`,
    );
  }

  return updated;
}

export function transitionOrderInTransaction(
  orderId: string,
  nextStatus: OrderStatus,
  patch: {
    brokerOrderId?: string | null;
    fillPrice?: number | null;
    closePrice?: number;
    reason?: string;
    positionId?: string;
    pnl?: number;
    source?: string;
  } = {},
): TradingOrder {
  return updateOrder(orderId, {
    status: nextStatus,
    brokerOrderId: patch.brokerOrderId,
    filledPrice: patch.fillPrice,
    closePrice: patch.closePrice,
    reason: patch.reason,
    positionId: patch.positionId,
    pnl: patch.pnl,
    source: patch.source,
  });
}

export function cancelOrderInTransaction(
  orderId: string,
  reason = "Order cancelled.",
): TradingOrder {
  return transitionOrderInTransaction(
    orderId,
    "CANCELLED",
    {
      reason,
      source: "order-manager",
    },
  );
}

export function rejectOrderInTransaction(
  orderId: string,
  reason = "Order rejected.",
): TradingOrder {
  return transitionOrderInTransaction(
    orderId,
    "REJECTED",
    {
      reason,
      source: "order-manager",
    },
  );
}