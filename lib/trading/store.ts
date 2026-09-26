import { randomUUID } from "node:crypto";

import { db, jsonParse, transaction } from "./db";
import type {
  PaperAccount,
  PaperPosition,
  TradingEvent,
} from "./types";

export interface NineStore {
  account: PaperAccount;
  events: TradingEvent[];
}

function mapAccount(
  row: any,
  positions: PaperPosition[],
): PaperAccount {
  return {
    currency: row.currency,
    initialBalance: Number(row.initial_balance),
    balance: Number(row.balance),
    equity: Number(row.equity),
    realizedPnl: Number(row.realized_pnl),
    unrealizedPnl: Number(row.unrealized_pnl),
    peakEquity: Number(row.peak_equity),
    dailyStartBalance: Number(row.daily_start_balance),
    dailyRealizedPnl: Number(row.daily_realized_pnl),
    tradingDay: row.trading_day,
    positions,
    updatedAt: Number(row.updated_at),
  };
}

function loadAccount(): PaperAccount {
  const row = db
    .prepare(
      "SELECT * FROM accounts WHERE id = ?",
    )
    .get("paper-main");

  if (!row) {
    throw new Error("Paper account is not initialized.");
  }

  const positionRows = db
    .prepare(
      `
        SELECT *
        FROM positions
        WHERE account_id = ?
        ORDER BY opened_at ASC
      `,
    )
    .all("paper-main") as any[];

  const positions = positionRows.map(
    (p) =>
      ({
        id: p.id,
        symbol: p.symbol,
        side: p.side,
        quantity: Number(p.quantity),
        entryPrice: Number(p.entry_price),
        stopLoss: Number(p.stop_loss),
        takeProfit: Number(p.take_profit),
        openedAt: Number(p.opened_at),
        status: p.status,
        exitPrice:
          p.exit_price == null
            ? undefined
            : Number(p.exit_price),
        closedAt:
          p.closed_at == null
            ? undefined
            : Number(p.closed_at),
        realizedPnl:
          p.realized_pnl == null
            ? undefined
            : Number(p.realized_pnl),
        orderId:
          p.order_id == null
            ? undefined
            : String(p.order_id),
      }) as PaperPosition,
  );

  return mapAccount(row, positions);
}

function loadEvents(
  limit = 250,
): TradingEvent[] {
  const safeLimit = Math.max(
    1,
    Math.min(limit, 1000),
  );

  return (
    db
      .prepare(
        `
          SELECT *
          FROM trading_events
          ORDER BY timestamp DESC
          LIMIT ?
        `,
      )
      .all(safeLimit) as any[]
  )
    .reverse()
    .map(
      (e) =>
        ({
          id: e.id,
          type: e.type,
          timestamp: Number(e.timestamp),
          message: e.message,
          symbol:
            e.symbol == null
              ? undefined
              : e.symbol,
          positionId:
            e.position_id == null
              ? undefined
              : e.position_id,
          metadata: jsonParse(
            e.metadata_json,
            {},
          ),
        }) as TradingEvent,
    );
}

function saveAccount(
  account: PaperAccount,
): void {
  db.prepare(
    `
      UPDATE accounts
      SET
        currency = ?,
        initial_balance = ?,
        balance = ?,
        equity = ?,
        realized_pnl = ?,
        unrealized_pnl = ?,
        peak_equity = ?,
        daily_start_balance = ?,
        daily_realized_pnl = ?,
        trading_day = ?,
        updated_at = ?
      WHERE id = ?
    `,
  ).run(
    account.currency,
    account.initialBalance,
    account.balance,
    account.equity,
    account.realizedPnl,
    account.unrealizedPnl,
    account.peakEquity,
    account.dailyStartBalance,
    account.dailyRealizedPnl,
    account.tradingDay,
    account.updatedAt,
    "paper-main",
  );

  /*
   * The positions collection is authoritative.
   *
   * Previously, saveAccount() only UPSERTed positions that
   * existed in the in-memory account. If a position was removed
   * from account.positions, its old SQLite row remained alive.
   *
   * That caused a reset to appear successful in memory while
   * loadStore() immediately loaded the old position again.
   *
   * Keep the database exactly synchronized with the account.
   */
  db.prepare(
    `
      DELETE FROM positions
      WHERE account_id = ?
    `,
  ).run("paper-main");

  const insertPosition = db.prepare(
    `
      INSERT INTO positions (
        id,
        account_id,
        symbol,
        side,
        quantity,
        entry_price,
        stop_loss,
        take_profit,
        opened_at,
        status,
        exit_price,
        closed_at,
        realized_pnl,
        order_id
      )
      VALUES (
        ?, ?, ?, ?, ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?
      )
    `,
  );

  for (const position of account.positions) {
    insertPosition.run(
      position.id,
      "paper-main",
      position.symbol,
      position.side,
      position.quantity,
      position.entryPrice,
      position.stopLoss,
      position.takeProfit,
      position.openedAt,
      position.status,
      position.exitPrice ?? null,
      position.closedAt ?? null,
      position.realizedPnl ?? null,
      position.orderId ?? null,
    );
  }
}

export function loadStore(): NineStore {
  return {
    account: loadAccount(),
    events: loadEvents(),
  };
}

export function saveStore(
  store: NineStore,
): void {
  transaction(() => {
    saveAccount(store.account);
  });
}

export function withStore<T>(
  mutator: (store: NineStore) => T,
): T {
  return transaction(() => {
    const store = loadStore();

    const result = mutator(store);

    saveAccount(store.account);

    const insertEvent = db.prepare(
      `
        INSERT OR IGNORE INTO trading_events (
          id,
          type,
          timestamp,
          message,
          symbol,
          position_id,
          metadata_json
        )
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `,
    );

    for (const event of store.events) {
      insertEvent.run(
        event.id,
        event.type,
        event.timestamp,
        event.message,
        event.symbol ?? null,
        event.positionId ?? null,
        JSON.stringify(
          event.metadata ?? {},
        ),
      );
    }

    return result;
  });
}

export function appendEvent(
  store: NineStore,
  event: Omit<
    TradingEvent,
    "id" | "timestamp"
  >,
): TradingEvent {
  const record: TradingEvent = {
    ...event,
    id: `EVT-${randomUUID()}`,
    timestamp: Date.now(),
  };

  store.events.push(record);

  return record;
}

export function getStoreSnapshot(): NineStore {
  return loadStore();
}