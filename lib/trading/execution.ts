import {
  ExecutionRequest,
  ExecutionResult,
  TradingSetup,
} from "./types";

import {
  appendEvent,
  withStore,
} from "./store";

import {
  appendExecutionLedger,
  requestHash,
} from "./ledger";

import {
  createOrder,
  getOrderByRequestHash,
  updateOrder,
} from "./orders";

import { getBrokerAdapter } from "./broker";
import { liveTradingEnabled } from "./runtime";
import { validateExecutionRequest } from "./coreSafety";

const MAX_LIVE_NOTIONAL_USD = Number(
  process.env.NINE_LIVE_MAX_NOTIONAL_USD ?? 5_000,
);

function validFinitePositive(
  value: number,
): boolean {
  return (
    Number.isFinite(value) &&
    value > 0
  );
}

function validateGeometry(
  request: ExecutionRequest,
): string | null {
  if (
    !validFinitePositive(
      request.quantity,
    )
  ) {
    return "Quantity must be a positive finite number.";
  }

  if (
    !validFinitePositive(
      request.entryPrice,
    ) ||
    !validFinitePositive(
      request.stopLoss,
    ) ||
    !validFinitePositive(
      request.takeProfit,
    )
  ) {
    return "Entry, stop and target must be positive finite numbers.";
  }

  if (
    request.side === "BUY" &&
    !(
      request.stopLoss <
        request.entryPrice &&
      request.takeProfit >
        request.entryPrice
    )
  ) {
    return "BUY geometry is invalid.";
  }

  if (
    request.side === "SELL" &&
    !(
      request.stopLoss >
        request.entryPrice &&
      request.takeProfit <
        request.entryPrice
    )
  ) {
    return "SELL geometry is invalid.";
  }

  const notional =
    request.quantity *
    request.entryPrice;

  if (
    !Number.isFinite(notional) ||
    notional > MAX_LIVE_NOTIONAL_USD
  ) {
    return `Notional exceeds the ${MAX_LIVE_NOTIONAL_USD} USD live safety cap.`;
  }

  return null;
}

export function executionRequestFromSetup(
  setup: TradingSetup,
  quantity: number,
  mode: "PAPER" | "LIVE",
  sentinelApproved: boolean,
): ExecutionRequest | null {
  if (
    setup.direction === "NONE" ||
    setup.entry === null ||
    setup.stopLoss === null ||
    setup.takeProfit === null
  ) {
    return null;
  }

  return {
    symbol: setup.symbol,
    side:
      setup.direction === "LONG"
        ? "BUY"
        : "SELL",
    quantity,
    entryPrice: setup.entry,
    stopLoss: setup.stopLoss,
    takeProfit: setup.takeProfit,
    mode,
    sentinelApproved,
  };
}

export async function executeBrokerOrder(
  request: ExecutionRequest,
): Promise<ExecutionResult> {
  const timestamp = Date.now();

  const coreSafety = validateExecutionRequest(request);
  if (!coreSafety.valid && request.mode === "PAPER") {
    return {
      accepted: false,
      mode: request.mode,
      status: "REJECTED",
      message: coreSafety.blockers.join(" "),
      timestamp,
    };
  }

  if (request.mode === "LIVE" && !liveTradingEnabled()) {
    return {
      accepted: false,
      mode: "LIVE",
      status: "REJECTED",
      message: "Live trading is hard-locked by NINE safety configuration.",
      timestamp,
    };
  }

  const hash =
    requestHash(request);

  /*
   * SAFETY ORDER:
   *
   * Sentinel approval is checked BEFORE
   * idempotency. An old rejected order must
   * never hide a current Sentinel rejection.
   */
  if (!request.sentinelApproved) {
    const message =
      "Sentinel approval is required before execution.";

    const existing =
      getOrderByRequestHash(hash);

    /*
     * If a rejected order already exists for
     * the same unauthorized request, reuse it.
     * Otherwise create the audit order now.
     */
    const order =
      existing ??
      createOrder(
        request,
        hash,
        {
          reason: message,
          source: "execution-engine",
        },
      );

    if (
      order.status !==
      "REJECTED"
    ) {
      updateOrder(order.id, {
        status: "REJECTED",
        reason: message,
        source: "sentinel",
        metadata: {
          reason: message,
        },
      });
    }

    appendExecutionLedger({
      eventType: "RISK_BLOCK",
      timestamp,
      symbol: request.symbol,
      mode: request.mode,
      side: request.side,
      quantity: request.quantity,
      price: request.entryPrice,
      stopLoss: request.stopLoss,
      takeProfit: request.takeProfit,
      status: "REJECTED",
      requestHash: hash,
      orderId: order.id,
      metadata: {
        reason: message,
        source: "sentinel",
      },
    });

    withStore((store) =>
      appendEvent(store, {
        type: "BROKER_REJECT",
        message,
        symbol: request.symbol,
        metadata: {
          orderId: order.id,
          reason: message,
        },
      }),
    );

    return {
      accepted: false,
      mode: request.mode,
      status: "REJECTED",
      message,
      timestamp,
      orderId: order.id,
    };
  }

  /*
   * Geometry validation happens after Sentinel
   * approval and before order submission.
   */
  const geometryError =
    validateGeometry(request);

  if (geometryError) {
    const existing =
      getOrderByRequestHash(hash);

    const order =
      existing ??
      createOrder(
        request,
        hash,
        {
          reason: geometryError,
          source: "execution-engine",
        },
      );

    if (
      order.status !==
      "REJECTED"
    ) {
      updateOrder(order.id, {
        status: "REJECTED",
        reason: geometryError,
        source: "geometry",
        metadata: {
          reason: geometryError,
        },
      });
    }

    appendExecutionLedger({
      eventType: "RISK_BLOCK",
      timestamp,
      symbol: request.symbol,
      mode: request.mode,
      side: request.side,
      quantity: request.quantity,
      price: request.entryPrice,
      stopLoss: request.stopLoss,
      takeProfit: request.takeProfit,
      status: "REJECTED",
      requestHash: hash,
      orderId: order.id,
      metadata: {
        reason: geometryError,
        source: "geometry",
      },
    });

    withStore((store) =>
      appendEvent(store, {
        type: "BROKER_REJECT",
        message: geometryError,
        symbol: request.symbol,
        metadata: {
          orderId: order.id,
        },
      }),
    );

    return {
      accepted: false,
      mode: request.mode,
      status: "REJECTED",
      message: geometryError,
      timestamp,
      orderId: order.id,
    };
  }

  /*
   * Idempotency guard.
   *
   * Only approved and geometrically valid
   * requests reach this point.
   */
  const existing =
    getOrderByRequestHash(hash);

  if (existing) {
    const accepted =
      existing.status === "SUBMITTED" ||
      existing.status === "FILLED" ||
      existing.status === "CLOSED";

    return {
      accepted,
      mode: existing.mode,
      status: accepted
        ? "SUBMITTED"
        : "REJECTED",
      message:
        `Duplicate execution request detected. Existing order ${existing.id} is ${existing.status}.`,
      brokerOrderId:
        existing.brokerOrderId,
      timestamp,
      orderId: existing.id,
    };
  }

  const order = createOrder(
    request,
    hash,
    {
      source: "execution-engine",
      mode: request.mode,
    },
  );

  /*
   * Paper mode is deliberately simulated here.
   * Actual paper positions are handled by
   * paperTrading.ts.
   */
  if (request.mode !== "LIVE") {
    const updated =
      updateOrder(
        order.id,
        {
          status: "SUBMITTED",
          filledPrice:
            request.entryPrice,
          metadata: {
            simulated: true,
          },
        },
      );

    appendExecutionLedger({
      eventType: "SUBMIT",
      timestamp,
      symbol: request.symbol,
      mode: "PAPER",
      side: request.side,
      quantity: request.quantity,
      price: request.entryPrice,
      stopLoss: request.stopLoss,
      takeProfit: request.takeProfit,
      status: "SIMULATED",
      requestHash: hash,
      orderId: updated.id,
      metadata: {
        simulated: true,
      },
    });

    return {
      accepted: true,
      mode: "PAPER",
      status: "SIMULATED",
      message:
        "Paper mode selected; no broker order was sent.",
      timestamp,
      orderId: updated.id,
    };
  }

  updateOrder(
    order.id,
    {
      status: "SUBMITTING",
    },
  );

  const adapter =
    getBrokerAdapter();

  const result =
    await adapter.submitOrder(
      request,
    );

  const updated =
    updateOrder(
      order.id,
      {
        status: result.accepted
          ? "SUBMITTED"
          : "REJECTED",
        brokerOrderId:
          result.brokerOrderId ??
          null,
        metadata: {
          adapter: adapter.id,
          message:
            result.message,
        },
      },
    );

  appendExecutionLedger({
    eventType:
      result.accepted
        ? "SUBMIT"
        : "REJECT",
    timestamp:
      result.timestamp,
    symbol: request.symbol,
    mode: "LIVE",
    side: request.side,
    quantity: request.quantity,
    price: request.entryPrice,
    stopLoss: request.stopLoss,
    takeProfit: request.takeProfit,
    status: result.status,
    brokerOrderId:
      result.brokerOrderId,
    requestHash: hash,
    orderId: updated.id,
    metadata: {
      adapter: adapter.id,
      message: result.message,
    },
  });

  withStore((store) =>
    appendEvent(store, {
      type: result.accepted
        ? "BROKER_SUBMIT"
        : "BROKER_REJECT",
      message:
        result.message,
      symbol: request.symbol,
      metadata: {
        quantity:
          request.quantity,
        brokerOrderId:
          result.brokerOrderId ??
          null,
        adapter:
          adapter.id,
        orderId:
          updated.id,
      },
    }),
  );

  return {
    ...result,
    orderId:
      updated.id,
  };
}