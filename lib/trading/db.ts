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

CREATE TABLE IF NOT EXISTS trade_lessons (
  id TEXT PRIMARY KEY,
  symbol TEXT NOT NULL,
  strategy TEXT NOT NULL,
  session TEXT NOT NULL,
  side TEXT NOT NULL,
  cause TEXT NOT NULL,
  occurrences INTEGER NOT NULL,
  losses INTEGER NOT NULL,
  wins INTEGER NOT NULL,
  total_r REAL NOT NULL,
  first_seen INTEGER NOT NULL,
  last_seen INTEGER NOT NULL,
  lesson TEXT NOT NULL,
  source TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS trade_lessons_key_idx
ON trade_lessons(symbol, strategy, session, side, cause);

CREATE TABLE IF NOT EXISTS learned_rules (
  id TEXT PRIMARY KEY,
  symbol TEXT NOT NULL,
  strategy TEXT NOT NULL,
  session TEXT NOT NULL,
  side TEXT NOT NULL,
  condition TEXT NOT NULL,
  cause TEXT NOT NULL,
  observations INTEGER NOT NULL,
  failures INTEGER NOT NULL,
  failure_rate REAL NOT NULL,
  mean_severity REAL NOT NULL,
  expectancy_r REAL NOT NULL DEFAULT 0,
  failure_rate_lower_95 REAL NOT NULL DEFAULT 0,
  status TEXT NOT NULL,
  reason TEXT NOT NULL,
  source TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS learned_rules_lookup_idx
ON learned_rules(symbol, strategy, session, side, updated_at DESC);

CREATE TABLE IF NOT EXISTS closed_loop_rules (
  id TEXT PRIMARY KEY,
  symbol TEXT NOT NULL,
  context_key TEXT NOT NULL,
  strategy TEXT NOT NULL,
  session TEXT NOT NULL,
  side TEXT NOT NULL,
  regime TEXT NOT NULL,
  cause TEXT NOT NULL,
  status TEXT NOT NULL,
  train_observations INTEGER NOT NULL,
  train_failures INTEGER NOT NULL,
  train_failure_rate REAL NOT NULL,
  oos_observations INTEGER NOT NULL,
  oos_failures INTEGER NOT NULL,
  oos_wins INTEGER NOT NULL,
  oos_failure_rate REAL NOT NULL,
  oos_failure_rate_lower_95 REAL NOT NULL,
  oos_expectancy_r REAL NOT NULL,
  counter_evidence INTEGER NOT NULL DEFAULT 0,
  recent_failure_rate REAL,
  reason TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS closed_loop_rules_context_idx
ON closed_loop_rules(symbol, context_key);

CREATE INDEX IF NOT EXISTS closed_loop_rules_active_idx
ON closed_loop_rules(symbol, status, expires_at);

CREATE TABLE IF NOT EXISTS strategy_evolution (
  variant_id TEXT PRIMARY KEY,
  base_strategy_id TEXT NOT NULL,
  symbol TEXT NOT NULL,
  session TEXT NOT NULL,
  regime TEXT NOT NULL,
  status TEXT NOT NULL,
  windows_json TEXT NOT NULL,
  trades INTEGER NOT NULL,
  wins INTEGER NOT NULL,
  losses INTEGER NOT NULL,
  win_rate REAL NOT NULL,
  win_rate_lower_95 REAL NOT NULL,
  expectancy_r REAL NOT NULL,
  profit_factor REAL NOT NULL,
  robustness_score REAL NOT NULL,
  consecutive_bad_windows INTEGER NOT NULL DEFAULT 0,
  mutation_json TEXT NOT NULL,
  reason TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS strategy_evolution_lookup_idx
ON strategy_evolution(symbol, base_strategy_id, session, regime, status, updated_at DESC);

CREATE TABLE IF NOT EXISTS regime_memory (
  id TEXT PRIMARY KEY,
  symbol TEXT NOT NULL,
  session TEXT NOT NULL,
  regime TEXT NOT NULL,
  confidence REAL NOT NULL,
  volatility_ratio REAL NOT NULL,
  momentum_score REAL NOT NULL,
  directional_efficiency REAL NOT NULL,
  transition INTEGER NOT NULL DEFAULT 0,
  previous_regime TEXT,
  routes_json TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS regime_memory_lookup_idx
ON regime_memory(symbol, regime, session, updated_at DESC);

CREATE TABLE IF NOT EXISTS strategy_allocation_memory (
  id TEXT PRIMARY KEY,
  symbol TEXT NOT NULL,
  session TEXT NOT NULL,
  regime TEXT NOT NULL,
  direction TEXT NOT NULL,
  strategy_id TEXT NOT NULL,
  family TEXT NOT NULL,
  trades INTEGER NOT NULL,
  expectancy_r REAL NOT NULL,
  win_rate REAL NOT NULL,
  win_rate_lower_95 REAL NOT NULL,
  allocation_weight REAL NOT NULL,
  adjustment REAL NOT NULL,
  source TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS strategy_allocation_lookup_idx
ON strategy_allocation_memory(symbol, session, regime, direction, strategy_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS meta_learning_memory (
  id TEXT PRIMARY KEY,
  symbol TEXT NOT NULL,
  session TEXT NOT NULL,
  regime TEXT NOT NULL,
  direction TEXT NOT NULL,
  concept TEXT NOT NULL,
  observations INTEGER NOT NULL,
  wins INTEGER NOT NULL,
  losses INTEGER NOT NULL,
  weight REAL NOT NULL,
  uncertainty REAL NOT NULL,
  source TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS meta_learning_lookup_idx
ON meta_learning_memory(symbol, session, regime, direction, concept, updated_at DESC);

CREATE TABLE IF NOT EXISTS counterfactual_results (
  id TEXT PRIMARY KEY,
  symbol TEXT NOT NULL,
  entry_time INTEGER NOT NULL,
  side TEXT NOT NULL,
  outcome TEXT NOT NULL,
  hypothetical_pnl REAL NOT NULL,
  max_favorable_r REAL NOT NULL,
  max_adverse_r REAL NOT NULL,
  horizon_candles INTEGER NOT NULL,
  source TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS counterfactual_lookup_idx
ON counterfactual_results(symbol, entry_time DESC);

CREATE TABLE IF NOT EXISTS causal_failure_memory (
  id TEXT PRIMARY KEY,
  symbol TEXT NOT NULL,
  strategy TEXT NOT NULL,
  session TEXT NOT NULL,
  regime TEXT NOT NULL,
  side TEXT NOT NULL,
  failure_mode TEXT NOT NULL,
  observations INTEGER NOT NULL,
  failures INTEGER NOT NULL,
  wins INTEGER NOT NULL,
  failure_rate REAL NOT NULL,
  failure_rate_lower_95 REAL NOT NULL,
  expectancy_r REAL NOT NULL,
  severity REAL NOT NULL,
  confidence REAL NOT NULL,
  status TEXT NOT NULL,
  last_seen INTEGER NOT NULL,
  source TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS causal_failure_key_idx
ON causal_failure_memory(symbol,strategy,session,regime,side,failure_mode);

CREATE TABLE IF NOT EXISTS adaptive_calibration_memory (
  id TEXT PRIMARY KEY,
  symbol TEXT NOT NULL,
  strategy_id TEXT NOT NULL,
  session TEXT NOT NULL,
  regime TEXT NOT NULL,
  window_size INTEGER NOT NULL,
  observations INTEGER NOT NULL,
  wins INTEGER NOT NULL,
  mean_predicted REAL NOT NULL,
  actual_rate REAL NOT NULL,
  brier_score REAL NOT NULL,
  calibration_error REAL NOT NULL,
  drift_score REAL NOT NULL,
  confidence_adjustment REAL NOT NULL,
  threshold_adjustment REAL NOT NULL,
  risk_adjustment REAL NOT NULL,
  status TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS adaptive_calibration_lookup_idx
ON adaptive_calibration_memory(symbol,strategy_id,session,regime,window_size,updated_at DESC);

CREATE TABLE IF NOT EXISTS calibration_corrections (
  id TEXT PRIMARY KEY,
  symbol TEXT NOT NULL,
  strategy_id TEXT NOT NULL,
  session TEXT NOT NULL,
  regime TEXT NOT NULL,
  parameter TEXT NOT NULL,
  old_value REAL NOT NULL,
  proposed_value REAL NOT NULL,
  train_observations INTEGER NOT NULL,
  oos_observations INTEGER NOT NULL,
  oos_improvement REAL NOT NULL,
  status TEXT NOT NULL,
  reason TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  activated_at INTEGER
);

CREATE INDEX IF NOT EXISTS calibration_corrections_lookup_idx
ON calibration_corrections(symbol,strategy_id,status,created_at DESC);

CREATE TABLE IF NOT EXISTS decision_policy_versions (
  id TEXT PRIMARY KEY,
  policy_name TEXT NOT NULL,
  version INTEGER NOT NULL,
  status TEXT NOT NULL,
  config_json TEXT NOT NULL,
  parent_id TEXT,
  train_observations INTEGER NOT NULL,
  oos_observations INTEGER NOT NULL,
  oos_delta REAL NOT NULL,
  confidence REAL NOT NULL,
  created_at INTEGER NOT NULL,
  activated_at INTEGER,
  retired_at INTEGER
);

CREATE UNIQUE INDEX IF NOT EXISTS decision_policy_version_idx
ON decision_policy_versions(policy_name,version);

CREATE TABLE IF NOT EXISTS decision_experiments (
  id TEXT PRIMARY KEY,
  policy_name TEXT NOT NULL,
  baseline_version INTEGER NOT NULL,
  candidate_version INTEGER NOT NULL,
  symbol TEXT NOT NULL,
  session TEXT NOT NULL,
  regime TEXT NOT NULL,
  observations INTEGER NOT NULL,
  baseline_score REAL NOT NULL,
  candidate_score REAL NOT NULL,
  delta REAL NOT NULL,
  confidence REAL NOT NULL,
  status TEXT NOT NULL,
  started_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS decision_experiments_lookup_idx
ON decision_experiments(policy_name,symbol,session,regime,status,updated_at DESC);

CREATE TABLE IF NOT EXISTS decision_trace (
  id TEXT PRIMARY KEY,
  symbol TEXT NOT NULL,
  strategy_id TEXT NOT NULL,
  session TEXT NOT NULL,
  regime TEXT NOT NULL,
  direction TEXT NOT NULL,
  policy_version INTEGER NOT NULL,
  raw_score REAL NOT NULL,
  calibrated_score REAL NOT NULL,
  confidence REAL NOT NULL,
  uncertainty REAL NOT NULL,
  evidence_json TEXT NOT NULL,
  blockers_json TEXT NOT NULL,
  sentinel_required INTEGER NOT NULL DEFAULT 1,
  sentinel_approved INTEGER NOT NULL DEFAULT 0,
  outcome TEXT,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS decision_trace_lookup_idx
ON decision_trace(symbol,strategy_id,session,regime,created_at DESC);

CREATE TABLE IF NOT EXISTS policy_promotions (
  id TEXT PRIMARY KEY,
  policy_name TEXT NOT NULL,
  from_version INTEGER NOT NULL,
  to_version INTEGER NOT NULL,
  train_observations INTEGER NOT NULL,
  oos_observations INTEGER NOT NULL,
  oos_delta REAL NOT NULL,
  confidence REAL NOT NULL,
  reason TEXT NOT NULL,
  status TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS kronos_calibration_forecasts (
  id TEXT PRIMARY KEY,
  symbol TEXT NOT NULL,
  timeframe TEXT NOT NULL,
  model TEXT NOT NULL,
  horizon_candles INTEGER NOT NULL,
  origin_candle_time INTEGER NOT NULL,
  target_candle_time INTEGER NOT NULL,
  generated_at INTEGER NOT NULL,
  current_price REAL NOT NULL,
  median_final REAL NOT NULL,
  low_final REAL NOT NULL,
  high_final REAL NOT NULL,
  forecast_direction TEXT NOT NULL,
  resolved INTEGER NOT NULL DEFAULT 0,
  realized_price REAL,
  realized_at INTEGER,
  created_at INTEGER NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS kronos_calibration_origin_idx
ON kronos_calibration_forecasts(symbol, timeframe, model, horizon_candles, origin_candle_time);

CREATE INDEX IF NOT EXISTS kronos_calibration_pending_idx
ON kronos_calibration_forecasts(symbol, timeframe, model, horizon_candles, resolved, target_candle_time);

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
ensureColumn("learned_rules", "expectancy_r", "REAL NOT NULL DEFAULT 0");
ensureColumn("learned_rules", "failure_rate_lower_95", "REAL NOT NULL DEFAULT 0");

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