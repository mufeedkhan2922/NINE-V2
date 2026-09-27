/// <reference path="../../types/node-sqlite.d.ts" />
import { DatabaseSync } from "node:sqlite";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";

const dbPath =
  process.env.NINE_DB_PATH ||
  join(".nine-data", "nine.db");

mkdirSync(dirname(dbPath), { recursive: true });

const globalDb = globalThis as typeof globalThis & {
  __nineDatabase?: DatabaseSync;
};

export const db =
  globalDb.__nineDatabase ?? new DatabaseSync(dbPath);

globalDb.__nineDatabase = db;

function exec(sql: string): void {
  db.exec(sql);
}

function ensureColumn(
  table: string,
  column: string,
  definition: string,
): void {
  const columns = db
    .prepare(`PRAGMA table_info(${table})`)
    .all() as Array<{ name: string }>;

  if (!columns.some((item) => item.name === column)) {
    db.exec(
      `ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`,
    );
  }
}

exec(`
PRAGMA journal_mode = WAL;
PRAGMA synchronous = FULL;
PRAGMA foreign_keys = ON;
PRAGMA busy_timeout = 5000;

CREATE TABLE IF NOT EXISTS accounts (
  id TEXT PRIMARY KEY,
  currency TEXT NOT NULL,
  initial_balance REAL NOT NULL,
  balance REAL NOT NULL,
  equity REAL NOT NULL,
  realized_pnl REAL NOT NULL DEFAULT 0,
  unrealized_pnl REAL NOT NULL DEFAULT 0,
  peak_equity REAL NOT NULL,
  daily_start_balance REAL NOT NULL,
  daily_realized_pnl REAL NOT NULL DEFAULT 0,
  trading_day TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS positions (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES accounts(id),
  symbol TEXT NOT NULL,
  side TEXT NOT NULL,
  quantity REAL NOT NULL,
  entry_price REAL NOT NULL,
  stop_loss REAL NOT NULL,
  take_profit REAL NOT NULL,
  opened_at INTEGER NOT NULL,
  status TEXT NOT NULL,
  exit_price REAL,
  closed_at INTEGER,
  realized_pnl REAL
);

CREATE TABLE IF NOT EXISTS trading_events (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  timestamp INTEGER NOT NULL,
  message TEXT NOT NULL,
  symbol TEXT,
  position_id TEXT,
  metadata_json TEXT
);

CREATE TABLE IF NOT EXISTS execution_ledger (
  id TEXT PRIMARY KEY,
  event_type TEXT NOT NULL,
  timestamp INTEGER NOT NULL,
  symbol TEXT NOT NULL,
  mode TEXT NOT NULL,
  side TEXT NOT NULL,
  quantity REAL NOT NULL,
  price REAL NOT NULL,
  stop_loss REAL NOT NULL,
  take_profit REAL NOT NULL,
  status TEXT NOT NULL,
  broker_order_id TEXT,
  request_hash TEXT,
  metadata_json TEXT
);

CREATE TABLE IF NOT EXISTS orders (
  id TEXT PRIMARY KEY,
  account_id TEXT REFERENCES accounts(id),
  symbol TEXT NOT NULL,
  mode TEXT NOT NULL,
  side TEXT NOT NULL,
  quantity REAL NOT NULL,
  requested_price REAL NOT NULL,
  filled_price REAL,
  stop_loss REAL NOT NULL,
  take_profit REAL NOT NULL,
  status TEXT NOT NULL,
  broker_order_id TEXT,
  sentinel_approved INTEGER NOT NULL DEFAULT 0,
  request_hash TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  metadata_json TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS orders_request_hash_idx
ON orders(request_hash);

CREATE INDEX IF NOT EXISTS orders_created_at_idx
ON orders(created_at DESC);

CREATE INDEX IF NOT EXISTS orders_broker_order_id_idx
ON orders(broker_order_id);

CREATE INDEX IF NOT EXISTS orders_status_idx
ON orders(status);

CREATE TRIGGER IF NOT EXISTS execution_ledger_no_update
BEFORE UPDATE ON execution_ledger
BEGIN
  SELECT RAISE(ABORT, 'execution_ledger is immutable');
END;

CREATE TRIGGER IF NOT EXISTS execution_ledger_no_delete
BEFORE DELETE ON execution_ledger
BEGIN
  SELECT RAISE(ABORT, 'execution_ledger is immutable');
END;

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'TRADER',
  created_at INTEGER NOT NULL,
  disabled INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  token_hash TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS sessions_token_hash_idx
ON sessions(token_hash);

CREATE TABLE IF NOT EXISTS backtest_runs (
  id TEXT PRIMARY KEY,
  symbol TEXT NOT NULL,
  timeframe TEXT NOT NULL,
  started_at INTEGER NOT NULL,
  completed_at INTEGER,
  initial_balance REAL NOT NULL,
  final_balance REAL NOT NULL,
  total_trades INTEGER NOT NULL,
  wins INTEGER NOT NULL,
  losses INTEGER NOT NULL,
  win_rate REAL NOT NULL,
  net_pnl REAL NOT NULL,
  max_drawdown REAL NOT NULL,
  profit_factor REAL NOT NULL,
  config_json TEXT
);

CREATE TABLE IF NOT EXISTS backtest_trades (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES backtest_runs(id),
  index_no INTEGER NOT NULL,
  side TEXT NOT NULL,
  entry_time INTEGER NOT NULL,
  exit_time INTEGER NOT NULL,
  entry_price REAL NOT NULL,
  exit_price REAL NOT NULL,
  stop_loss REAL NOT NULL,
  take_profit REAL NOT NULL,
  quantity REAL NOT NULL,
  pnl REAL NOT NULL,
  outcome TEXT NOT NULL,
  reason TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS strategy_memory (
  id TEXT PRIMARY KEY,
  strategy_id TEXT NOT NULL,
  strategy_name TEXT NOT NULL,
  symbol TEXT NOT NULL,
  timeframe TEXT NOT NULL,
  session TEXT NOT NULL,
  regime TEXT NOT NULL,
  trades INTEGER NOT NULL,
  wins INTEGER NOT NULL,
  win_rate REAL NOT NULL,
  expectancy_r REAL NOT NULL,
  profit_factor REAL NOT NULL,
  max_drawdown_r REAL NOT NULL,
  sample_start INTEGER NOT NULL,
  sample_end INTEGER NOT NULL,
  source TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS strategy_memory_lookup_idx
ON strategy_memory(strategy_id, symbol, timeframe, session, regime, updated_at DESC);

CREATE TABLE IF NOT EXISTS xau_setup_tracking (
  setup_id TEXT PRIMARY KEY,
  symbol TEXT NOT NULL,
  lifecycle TEXT NOT NULL,
  first_seen_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL,
  direction TEXT NOT NULL,
  entry REAL,
  stop_loss REAL,
  take_profit REAL,
  matched_paper_position_id TEXT,
  status_reason TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS xau_setup_tracking_last_seen_idx
ON xau_setup_tracking(symbol, last_seen_at DESC);

CREATE TABLE IF NOT EXISTS research_runs (
  id TEXT PRIMARY KEY,
  symbol TEXT NOT NULL,
  timeframe TEXT NOT NULL,
  start_date TEXT NOT NULL,
  end_date TEXT NOT NULL,
  source TEXT NOT NULL,
  candles INTEGER NOT NULL,
  oos_trades INTEGER NOT NULL,
  research_status TEXT NOT NULL,
  research_score REAL NOT NULL,
  target_win_rate REAL NOT NULL,
  target_reached INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  result_json TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS research_runs_lookup_idx
ON research_runs(symbol, timeframe, created_at DESC);

`);

ensureColumn("positions", "order_id", "TEXT");
ensureColumn("execution_ledger", "order_id", "TEXT");

function importLegacyState(): void {
  const accountExists = db
    .prepare(
      "SELECT 1 AS ok FROM accounts WHERE id = ?",
    )
    .get("paper-main");

  if (accountExists) return;

  const legacy = join(
    dirname(dbPath),
    "state.json",
  );

  if (!existsSync(legacy)) return;

  try {
    const parsed = JSON.parse(
      readFileSync(legacy, "utf8"),
    ) as {
      account?: any;
      events?: any[];
    };

    if (!parsed.account) return;

    const a = parsed.account;

    db.exec("BEGIN IMMEDIATE");

    try {
      db.prepare(
        `
        INSERT INTO accounts (
          id,
          currency,
          initial_balance,
          balance,
          equity,
          realized_pnl,
          unrealized_pnl,
          peak_equity,
          daily_start_balance,
          daily_realized_pnl,
          trading_day,
          updated_at
        )
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
        `,
      ).run(
        "paper-main",
        a.currency ?? "USD",
        a.initialBalance,
        a.balance,
        a.equity,
        a.realizedPnl ?? 0,
        a.unrealizedPnl ?? 0,
        a.peakEquity ?? a.equity,
        a.dailyStartBalance ?? a.balance,
        a.dailyRealizedPnl ?? 0,
        a.tradingDay ??
          new Date()
            .toISOString()
            .slice(0, 10),
        a.updatedAt ?? Date.now(),
      );

      for (const p of Array.isArray(a.positions)
        ? a.positions
        : []) {
        db.prepare(
          `
          INSERT OR IGNORE INTO positions (
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
          VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)
          `,
        ).run(
          p.id,
          "paper-main",
          p.symbol,
          p.side,
          p.quantity,
          p.entryPrice,
          p.stopLoss,
          p.takeProfit,
          p.openedAt,
          p.status,
          p.exitPrice ?? null,
          p.closedAt ?? null,
          p.realizedPnl ?? null,
          p.orderId ?? null,
        );
      }

      for (const e of Array.isArray(
        parsed.events,
      )
        ? parsed.events
        : []) {
        db.prepare(
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
          VALUES (?,?,?,?,?,?,?)
          `,
        ).run(
          e.id,
          e.type,
          e.timestamp,
          e.message,
          e.symbol ?? null,
          e.positionId ?? null,
          JSON.stringify(e.metadata ?? {}),
        );
      }

      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  } catch {
    // A corrupt legacy file must not prevent a fresh database from starting.
  }
}

importLegacyState();

const balance = Number(
  process.env.NINE_PAPER_BALANCE_USD ?? 10_000,
);

const initial =
  Number.isFinite(balance) && balance > 0
    ? balance
    : 10_000;

if (
  !db
    .prepare(
      "SELECT 1 AS ok FROM accounts WHERE id = ?",
    )
    .get("paper-main")
) {
  const now = Date.now();

  db.prepare(
    `
    INSERT INTO accounts (
      id,
      currency,
      initial_balance,
      balance,
      equity,
      realized_pnl,
      unrealized_pnl,
      peak_equity,
      daily_start_balance,
      daily_realized_pnl,
      trading_day,
      updated_at
    )
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
    `,
  ).run(
    "paper-main",
    "USD",
    initial,
    initial,
    initial,
    0,
    0,
    initial,
    initial,
    0,
    new Date(now)
      .toISOString()
      .slice(0, 10),
    now,
  );
}

export function transaction<T>(
  fn: () => T,
): T {
  db.exec("BEGIN IMMEDIATE");

  try {
    const result = fn();

    db.exec("COMMIT");

    return result;
  } catch (error) {
    try {
      db.exec("ROLLBACK");
    } catch {
      // no-op
    }

    throw error;
  }
}

export function jsonParse<T>(
  value: string | null | undefined,
  fallback: T,
): T {
  if (!value) return fallback;

  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}