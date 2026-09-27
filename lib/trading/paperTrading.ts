import { randomUUID } from "node:crypto";

import {
  MarketSnapshot,
  NINEOrchestration,
  OrderSide,
  PaperAccount,
  PaperPosition,
  TradeDirection,
} from "./types";
import {
  appendEvent,
  getStoreSnapshot,
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
import { validatePaperAccountCore } from "./coreSafety";

const MAX_OPEN_POSITIONS = Number(
  process.env.NINE_PAPER_MAX_OPEN_POSITIONS ?? 3,
);

const MAX_DAILY_LOSS_PERCENT = Number(
  process.env.NINE_PAPER_MAX_DAILY_LOSS_PERCENT ?? 2,
);

const MAX_NOTIONAL_USD = Number(
  process.env.NINE_PAPER_MAX_NOTIONAL_USD ?? 5_000,
);

function safeNumber(
  value: number,
  fallback: number,
): number {
  return Number.isFinite(value)
    ? value
    : fallback;
}

function resetDailyCounters(
  account: PaperAccount,
): void {
  const today = new Date()
    .toISOString()
    .slice(0, 10);

  if (account.tradingDay !== today) {
    account.tradingDay = today;
    account.dailyStartBalance = account.balance;
    account.dailyRealizedPnl = 0;
  }
}

function markToMarket(
  account: PaperAccount,
  price: number,
): void {
  let unrealized = 0;

  for (const position of account.positions) {
    if (position.status !== "OPEN") {
      continue;
    }

    const pnl =
      position.side === "BUY"
        ? (price - position.entryPrice) *
          position.quantity
        : (position.entryPrice - price) *
          position.quantity;

    unrealized += pnl;
  }

  account.unrealizedPnl = unrealized;
  account.equity =
    account.balance + unrealized;

  if (account.equity > account.peakEquity) {
    account.peakEquity = account.equity;
  }
}

function settleTriggeredPositions(
  account: PaperAccount,
  price: number,
  store?: ReturnType<typeof getStoreSnapshot>,
): void {
  const now = Date.now();

  for (
    const position of account.positions.filter(
      (item) => item.status === "OPEN",
    )
  ) {
    const stopHit =
      position.side === "BUY"
        ? price <= position.stopLoss
        : price >= position.stopLoss;

    const targetHit =
      position.side === "BUY"
        ? price >= position.takeProfit
        : price <= position.takeProfit;

    if (!stopHit && !targetHit) {
      continue;
    }

    const exitPrice = stopHit
      ? position.stopLoss
      : position.takeProfit;

    const pnl =
      position.side === "BUY"
        ? (exitPrice - position.entryPrice) *
          position.quantity
        : (position.entryPrice - exitPrice) *
          position.quantity;

    position.status = "CLOSED";
    position.exitPrice = exitPrice;
    position.closedAt = now;
    position.realizedPnl = pnl;

    if (position.orderId) {
      updateOrder(position.orderId, {
        status: "CLOSED",
        closePrice: exitPrice,
        pnl,
        positionId: position.id,
        reason: stopHit ? "STOP" : "TARGET",
        source: "paperTrading",
      });
    }

    if (store) {
      appendEvent(store, {
      type: "PAPER_CLOSE",
      message: `Paper position ${position.id} closed at ${exitPrice.toFixed(2)}.`,
      symbol: position.symbol,
      positionId: position.id,
      metadata: {
        pnl,
        orderId: position.orderId,
        reason: stopHit ? "STOP" : "TARGET",
      },
      });
    }

    account.balance += pnl;
    account.realizedPnl += pnl;
    account.dailyRealizedPnl += pnl;

    appendExecutionLedger({
      eventType: "CLOSE",
      timestamp: now,
      symbol: position.symbol,
      mode: "PAPER",
      side: position.side,
      quantity: position.quantity,
      price: exitPrice,
      stopLoss: position.stopLoss,
      takeProfit: position.takeProfit,
      status: "CLOSED",
      orderId: position.orderId,
      metadata: {
        positionId: position.id,
        pnl,
        reason: stopHit
          ? "STOP"
          : "TARGET",
      },
    });
  }
}

function sideForDirection(
  direction: TradeDirection,
): OrderSide | null {
  if (direction === "LONG") {
    return "BUY";
  }

  if (direction === "SHORT") {
    return "SELL";
  }

  return null;
}

function paperOrderRequestHash(
  orchestration: NINEOrchestration,
  market: MarketSnapshot,
  side: OrderSide,
  quantity: number,
): string {
  return requestHash({
    source: "paper-execution",
    symbol: orchestration.setup.symbol,
    side,
    quantity,
    entryPrice: orchestration.setup.entry,
    stopLoss: orchestration.setup.stopLoss,
    takeProfit: orchestration.setup.takeProfit,
    marketTimestamp: market.timestamp,
    mode: "PAPER",
    commandSummary:
      orchestration.commandSummary,
  });
}

export function getPaperAccount(
  price?: number,
): PaperAccount {
  return withStore((store) => {
    const account = store.account;
    const mark = safeNumber(price ?? 0, 0);

    if (mark > 0) {
      resetDailyCounters(account);
      settleTriggeredPositions(account, mark, store);
      markToMarket(account, mark);
    } else {
      const openPosition = account.positions.find(
        (position) => position.status === "OPEN",
      );
      markToMarket(
        account,
        openPosition?.entryPrice ?? account.balance,
      );
    }

    return account;
  });
}

export function getPaperEvents(
  limit = 30,
) {
  return getStoreSnapshot()
    .events
    .slice(
      -Math.max(
        1,
        Math.min(limit, 100),
      ),
    )
    .reverse();
}

export function executePaperSetup(
  orchestration: NINEOrchestration,
  market: MarketSnapshot,
): {
  ok: boolean;
  message: string;
  position?: PaperPosition;
  orderId?: string;
  account: PaperAccount;
} {
  const setup =
    orchestration.setup;

  const side =
    sideForDirection(
      setup.direction,
    );

  /*
   * Capture the nullable setup values into local
   * constants after validating them. This gives TypeScript
   * a stable non-null value for the rest of execution.
   */
  const entryPrice =
    setup.entry;

  const stopLoss =
    setup.stopLoss;

  const takeProfit =
    setup.takeProfit;

  if (
    !orchestration.sentinel.approved ||
    !side ||
    entryPrice === null ||
    stopLoss === null ||
    takeProfit === null
  ) {
    return withStore((store) => {
      appendEvent(store, {
        type: "PAPER_REJECT",
        message:
          orchestration.sentinel
            .reason,
        symbol: setup.symbol,
      });

      markToMarket(
        store.account,
        market.price,
      );

      return {
        ok: false,
        message:
          orchestration.sentinel
            .reason,
        account: store.account,
      };
    });
  }

  return withStore((store) => {
    const account =
      store.account;

    const accountSafety = validatePaperAccountCore(account);
    if (!accountSafety.valid) {
      const message = `Paper account safety validation failed: ${accountSafety.blockers.join(" ")}`;
      appendEvent(store, {
        type: "RISK_GUARD",
        message,
        symbol: setup.symbol,
      });
      return {
        ok: false,
        message,
        account,
      };
    }

    resetDailyCounters(
      account,
    );

    settleTriggeredPositions(
      account,
      market.price,
      store,
    );

    markToMarket(
      account,
      market.price,
    );

    /*
     * Calculate quantity before the duplicate check
     * because quantity is part of the deterministic
     * paper request identity.
     */
    const riskDollars =
      account.equity *
      (setup.risk.riskPercent / 100);

    const riskPerUnit =
      Math.abs(
        entryPrice -
          stopLoss,
      );

    if (
      !Number.isFinite(
        riskDollars,
      ) ||
      riskDollars <= 0 ||
      !Number.isFinite(
        riskPerUnit,
      ) ||
      riskPerUnit <= 0
    ) {
      const message =
        "Invalid paper risk geometry.";

      appendEvent(store, {
        type: "PAPER_REJECT",
        message,
        symbol: setup.symbol,
      });

      return {
        ok: false,
        message,
        account,
      };
    }

    const rawQuantity =
      Math.min(
        riskDollars /
          riskPerUnit,
        MAX_NOTIONAL_USD /
          entryPrice,
      );

    const quantity = Number(
      rawQuantity.toFixed(4),
    );

    if (
      !Number.isFinite(
        quantity,
      ) ||
      quantity <= 0
    ) {
      const message =
        "Calculated paper quantity is invalid.";

      appendEvent(store, {
        type: "PAPER_REJECT",
        message,
        symbol: setup.symbol,
      });

      return {
        ok: false,
        message,
        account,
      };
    }

    const hash =
      paperOrderRequestHash(
        orchestration,
        market,
        side,
        quantity,
      );

    /*
     * Idempotency check must happen before the
     * open-position guards. A repeated request should
     * resolve to the original order.
     */
    const existing =
      getOrderByRequestHash(hash);

    if (existing) {
      const existingPosition =
        account.positions.find(
          (position) =>
            position.orderId ===
            existing.id,
        );

      return {
        ok:
          existing.status ===
            "FILLED" ||
          existing.status ===
            "CLOSED",
        message:
          `Duplicate paper execution request detected. Existing order ${existing.id} is ${existing.status}.`,
        position:
          existingPosition,
        orderId:
          existing.id,
        account,
      };
    }

    const openPositions =
      account.positions.filter(
        (item) =>
          item.status === "OPEN",
      );

    if (
      openPositions.length >=
      Math.max(
        1,
        MAX_OPEN_POSITIONS,
      )
    ) {
      const message =
        `Paper risk guard: maximum ${MAX_OPEN_POSITIONS} open positions reached.`;

      appendEvent(store, {
        type: "RISK_GUARD",
        message,
        symbol: setup.symbol,
      });

      return {
        ok: false,
        message,
        account,
      };
    }

    const dailyLossLimit =
      account.dailyStartBalance *
      (Math.max(
        0.1,
        MAX_DAILY_LOSS_PERCENT,
      ) / 100);

    if (
      account.dailyRealizedPnl <=
      -dailyLossLimit
    ) {
      const message =
        `Paper risk guard: daily realized loss limit of ${MAX_DAILY_LOSS_PERCENT}% reached.`;

      appendEvent(store, {
        type: "RISK_GUARD",
        message,
        symbol: setup.symbol,
      });

      return {
        ok: false,
        message,
        account,
      };
    }

    if (
      openPositions.some(
        (position) =>
          position.symbol ===
            setup.symbol &&
          position.side === side,
      )
    ) {
      const message =
        `Paper risk guard: an open ${side} ${setup.symbol} position already exists.`;

      appendEvent(store, {
        type: "RISK_GUARD",
        message,
        symbol: setup.symbol,
      });

      return {
        ok: false,
        message,
        account,
      };
    }

    const order =
      createOrder(
        {
          symbol:
            setup.symbol,
          side,
          quantity,
          entryPrice,
          stopLoss,
          takeProfit,
          mode: "PAPER",
          sentinelApproved:
            true,
        },
        hash,
        {
          source:
            "paperTrading",
          commandSummary:
            orchestration.commandSummary,
          marketTimestamp:
            market.timestamp,
        },
      );

    const position:
      PaperPosition = {
      id:
        `PAPER-${Date.now()}-${randomUUID().slice(0, 8)}`,
      symbol:
        setup.symbol,
      side,
      quantity,
      entryPrice,
      stopLoss,
      takeProfit,
      openedAt:
        Date.now(),
      status: "OPEN",
      orderId:
        order.id,
    };

    account.positions.push(
      position,
    );

    markToMarket(
      account,
      market.price,
    );

    const filledOrder =
      updateOrder(
        order.id,
        {
          status: "FILLED",
          filledPrice:
            entryPrice,
          positionId:
            position.id,
          source:
            "paperTrading",
        },
      );

    appendExecutionLedger({
      eventType: "FILL",
      timestamp: Date.now(),
      symbol:
        setup.symbol,
      mode: "PAPER",
      side,
      quantity,
      price:
        entryPrice,
      stopLoss,
      takeProfit,
      status: "FILLED",
      orderId:
        filledOrder.id,
      requestHash:
        hash,
      metadata: {
        positionId:
          position.id,
        simulated:
          true,
      },
    });

    appendEvent(store, {
      type: "PAPER_OPEN",
      message:
        `${side} ${quantity} ${position.symbol} opened in paper mode.`,
      symbol:
        position.symbol,
      positionId:
        position.id,
      metadata: {
        quantity,
        entry:
          entryPrice,
        stop:
          stopLoss,
        target:
          takeProfit,
        orderId:
          filledOrder.id,
      },
    });

    return {
      ok: true,
      message:
        `${side} ${quantity} ${position.symbol} paper position opened.`,
      position,
      orderId:
        filledOrder.id,
      account,
    };
  });
}

export function closePaperPosition(
  id: string,
  marketPrice: number,
): {
  ok: boolean;
  message: string;
  orderId?: string;
  account: PaperAccount;
} {
  return withStore((store) => {
    const account =
      store.account;

    settleTriggeredPositions(
      account,
      marketPrice,
      store,
    );

    const position =
      account.positions.find(
        (item) =>
          item.id === id &&
          item.status === "OPEN",
      );

    if (!position) {
      return {
        ok: false,
        message:
          "Open paper position not found (it may already have hit SL/TP).",
        account,
      };
    }

    const pnl =
      position.side === "BUY"
        ? (marketPrice -
            position.entryPrice) *
          position.quantity
        : (position.entryPrice -
            marketPrice) *
          position.quantity;

    position.status =
      "CLOSED";

    position.exitPrice =
      marketPrice;

    position.closedAt =
      Date.now();

    position.realizedPnl =
      pnl;

    account.balance += pnl;
    account.realizedPnl += pnl;
    account.dailyRealizedPnl += pnl;

    markToMarket(
      account,
      marketPrice,
    );

    if (position.orderId) {
      updateOrder(
        position.orderId,
        {
          status: "CLOSED",
          closePrice:
            marketPrice,
          pnl,
          positionId:
            position.id,
          source:
            "paperTrading",
        },
      );
    }

    appendExecutionLedger({
      eventType: "CLOSE",
      timestamp: Date.now(),
      symbol:
        position.symbol,
      mode: "PAPER",
      side:
        position.side,
      quantity:
        position.quantity,
      price:
        marketPrice,
      stopLoss:
        position.stopLoss,
      takeProfit:
        position.takeProfit,
      status: "CLOSED",
      orderId:
        position.orderId,
      metadata: {
        positionId:
          position.id,
        pnl,
      },
    });

    appendEvent(store, {
      type: "PAPER_CLOSE",
      message:
        `Paper position ${position.id} closed at ${marketPrice.toFixed(2)}.`,
      symbol:
        position.symbol,
      positionId:
        position.id,
      metadata: {
        pnl,
        orderId:
          position.orderId,
      },
    });

    return {
      ok: true,
      message:
        `Paper position closed at ${marketPrice.toFixed(2)}.`,
      orderId:
        position.orderId,
      account,
    };
  });
}