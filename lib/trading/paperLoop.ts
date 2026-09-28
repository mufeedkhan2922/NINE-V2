import { db } from "./db";
import { executePaperSetup, getPaperAccount } from "./paperTrading";
import { buildXAUDecisionEngine, createSetupTracking, type XAUDecisionEngine, type XAUSetupTracking } from "./xauDecisionEngine";
import { buildPaperTelemetry, paperTelemetryHealth, type PaperTelemetry } from "./paperTelemetry";
import type { MarketSnapshot, NINEOrchestration } from "./types";

export type PaperLoopState = "DETECTED" | "VALIDATED" | "TRACKING" | "ENTERED" | "MANAGING" | "CLOSED" | "BLOCKED" | "EXPIRED";

export interface XAUAutonomousPaperLoop {
  state: PaperLoopState;
  setupId: string;
  lifecycle: XAUDecisionEngine["lifecycle"];
  positionId: string | null;
  entry: { attempted: boolean; opened: boolean; orderId: string | null; message: string };
  transition: { from: string | null; to: PaperLoopState; timestamp: number; reason: string };
  history: Array<{ id: number; fromState: string | null; toState: string; timestamp: number; reason: string; positionId: string | null }>;
  account: ReturnType<typeof getPaperAccount>;
  telemetry: PaperTelemetry;
  health: ReturnType<typeof paperTelemetryHealth>;
}

function ensureTables(): void {
  db.exec(
    "CREATE TABLE IF NOT EXISTS xau_paper_lifecycle (" +
      "setup_id TEXT PRIMARY KEY, symbol TEXT NOT NULL, state TEXT NOT NULL, position_id TEXT, " +
      "first_seen_at INTEGER NOT NULL, last_seen_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, reason TEXT NOT NULL" +
    ");" +
    "CREATE TABLE IF NOT EXISTS xau_paper_transitions (" +
      "id INTEGER PRIMARY KEY AUTOINCREMENT, setup_id TEXT NOT NULL, from_state TEXT, to_state TEXT NOT NULL, " +
      "timestamp INTEGER NOT NULL, reason TEXT NOT NULL, position_id TEXT" +
    ");" +
    "CREATE INDEX IF NOT EXISTS xau_paper_transitions_setup_idx ON xau_paper_transitions(setup_id, timestamp DESC);",
  );
}

function currentRecord(setupId: string) {
  ensureTables();
  return db.prepare("SELECT setup_id AS setupId, state, position_id AS positionId, first_seen_at AS firstSeenAt, last_seen_at AS lastSeenAt, reason FROM xau_paper_lifecycle WHERE setup_id = ?").get(setupId) as {
    setupId: string; state: PaperLoopState; positionId: string | null; firstSeenAt: number; lastSeenAt: number; reason: string;
  } | undefined;
}

function history(setupId: string) {
  ensureTables();
  return db.prepare("SELECT id, from_state AS fromState, to_state AS toState, timestamp, reason, position_id AS positionId FROM xau_paper_transitions WHERE setup_id = ? ORDER BY timestamp DESC LIMIT 20").all(setupId) as Array<{
    id: number; fromState: string | null; toState: string; timestamp: number; reason: string; positionId: string | null;
  }>;
}

function transition(setupId: string, symbol: string, to: PaperLoopState, reason: string, positionId: string | null) {
  const now = Date.now();
  const existing = currentRecord(setupId);
  if (existing?.state === to && existing.positionId === positionId) {
    db.prepare("UPDATE xau_paper_lifecycle SET last_seen_at = ?, updated_at = ?, reason = ?, position_id = ? WHERE setup_id = ?").run(now, now, reason, positionId, setupId);
    return { from: existing.state as PaperLoopState, timestamp: now };
  }
  db.prepare(
    "INSERT INTO xau_paper_lifecycle (setup_id, symbol, state, position_id, first_seen_at, last_seen_at, updated_at, reason) VALUES (?, ?, ?, ?, ?, ?, ?, ?) " +
    "ON CONFLICT(setup_id) DO UPDATE SET state=excluded.state, position_id=excluded.position_id, last_seen_at=excluded.last_seen_at, updated_at=excluded.updated_at, reason=excluded.reason",
  ).run(setupId, symbol, to, positionId, existing?.firstSeenAt ?? now, now, now, reason);
  db.prepare("INSERT INTO xau_paper_transitions (setup_id, from_state, to_state, timestamp, reason, position_id) VALUES (?, ?, ?, ?, ?, ?)").run(setupId, existing?.state ?? null, to, now, reason, positionId);
  return { from: existing?.state ?? null, timestamp: now };
}

function runXAUAutonomousPaperLoopCore(
  market: MarketSnapshot,
  orchestration: NINEOrchestration,
  existingTracking?: XAUSetupTracking,
): XAUAutonomousPaperLoop {
  const account = getPaperAccount(market.price);
  const setup = orchestration.setup;
  const setupTracking = createSetupTracking(setup, account, existingTracking);
  const decision = buildXAUDecisionEngine(market, setup, orchestration.atlas, orchestration.sentinel, account, setupTracking);
  const record = currentRecord(setupTracking.setupId);
  const openPosition = account.positions.find((position) => position.id === record?.positionId && position.status === "OPEN");
  const closedPosition = account.positions.find((position) => position.id === record?.positionId && position.status === "CLOSED");

  if (closedPosition && record?.state !== "CLOSED") {
    const tr = transition(setupTracking.setupId, setup.symbol, "CLOSED", "Paper position closed and PnL was recorded.", closedPosition.id);
    return {
      state: "CLOSED", setupId: setupTracking.setupId, lifecycle: "PAPER_CLOSED", positionId: closedPosition.id,
      entry: { attempted: false, opened: false, orderId: closedPosition.orderId, message: "Paper position closed and recorded." },
      transition: { from: tr.from, to: "CLOSED", timestamp: tr.timestamp, reason: "Paper position closed and recorded." },
      history: history(setupTracking.setupId), account,
    };
  }

  if (openPosition) {
    const tr = transition(setupTracking.setupId, setup.symbol, "MANAGING", "Paper position is open and being marked to market.", openPosition.id);
    return {
      state: "MANAGING", setupId: setupTracking.setupId, lifecycle: "PAPER_ACTIVE", positionId: openPosition.id,
      entry: { attempted: false, opened: true, orderId: openPosition.orderId, message: "Paper position is being managed." },
      transition: { from: tr.from, to: "MANAGING", timestamp: tr.timestamp, reason: "Paper position is open and being marked to market." },
      history: history(setupTracking.setupId), account,
    };
  }

  if (decision.lifecycle === "EXPIRED") {
    const tr = transition(setupTracking.setupId, setup.symbol, "EXPIRED", decision.invalidation.reason, null);
    return {
      state: "EXPIRED", setupId: setupTracking.setupId, lifecycle: "EXPIRED", positionId: null,
      entry: { attempted: false, opened: false, orderId: null, message: decision.invalidation.reason },
      transition: { from: tr.from, to: "EXPIRED", timestamp: tr.timestamp, reason: decision.invalidation.reason },
      history: history(setupTracking.setupId), account,
    };
  }

  if (record?.state === "CLOSED" || record?.state === "EXPIRED") {
    return {
      state: record.state, setupId: setupTracking.setupId, lifecycle: record.state === "CLOSED" ? "PAPER_CLOSED" : "EXPIRED",
      positionId: record.positionId, entry: { attempted: false, opened: false, orderId: null, message: record.reason },
      transition: { from: record.state, to: record.state, timestamp: Date.now(), reason: record.reason },
      history: history(setupTracking.setupId), account,
    };
  }

  if (decision.lifecycle === "PAPER_READY" && orchestration.sentinel.approved) {
    transition(setupTracking.setupId, setup.symbol, "VALIDATED", "Setup passed validation and Sentinel approved paper execution.", null);
    transition(setupTracking.setupId, setup.symbol, "TRACKING", "Setup is tracked for idempotent paper lifecycle management.", null);
    const result = executePaperSetup(orchestration, market);
    const position = result.position;
    if (result.ok && position) {
      const tr = transition(setupTracking.setupId, setup.symbol, "ENTERED", result.message, position.id);
      return {
        state: "ENTERED", setupId: setupTracking.setupId, lifecycle: "PAPER_ACTIVE", positionId: position.id,
        entry: { attempted: true, opened: true, orderId: result.orderId ?? position.orderId, message: result.message },
        transition: { from: tr.from, to: "ENTERED", timestamp: tr.timestamp, reason: result.message },
        history: history(setupTracking.setupId), account: result.account,
      };
    }
    const tr = transition(setupTracking.setupId, setup.symbol, "BLOCKED", result.message, null);
    return {
      state: "BLOCKED", setupId: setupTracking.setupId, lifecycle: "BLOCKED", positionId: null,
      entry: { attempted: true, opened: false, orderId: result.orderId ?? null, message: result.message },
      transition: { from: tr.from, to: "BLOCKED", timestamp: tr.timestamp, reason: result.message },
      history: history(setupTracking.setupId), account: result.account,
    };
  }

  const state: PaperLoopState = decision.lifecycle === "BLOCKED" ? "BLOCKED" : decision.lifecycle === "FORMING" ? "DETECTED" : "TRACKING";
  const reason = decision.lifecycle === "BLOCKED" ? orchestration.sentinel.reason : decision.lifecycle === "FORMING" ? "Directional setup detected; validation is still forming." : "Waiting for a validated paper entry.";
  const tr = transition(setupTracking.setupId, setup.symbol, state, reason, null);
  return {
    state, setupId: setupTracking.setupId, lifecycle: decision.lifecycle, positionId: null,
    entry: { attempted: false, opened: false, orderId: null, message: reason },
    transition: { from: tr.from, to: state, timestamp: tr.timestamp, reason },
    history: history(setupTracking.setupId), account,
  };
}


export function runXAUAutonomousPaperLoop(
  market: MarketSnapshot,
  orchestration: NINEOrchestration,
  existingTracking?: XAUSetupTracking,
): XAUAutonomousPaperLoop {
  const result = runXAUAutonomousPaperLoopCore(market, orchestration, existingTracking);
  return {
    ...result,
    telemetry: buildPaperTelemetry(result.account),
    health: paperTelemetryHealth(result.state, result.transition.timestamp),
  };
}
