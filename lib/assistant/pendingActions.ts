import { randomUUID } from "node:crypto";
import { db } from "../trading/db";

export type PendingAssistantAction = "OPEN_PAPER" | "CLOSE_ALL";
export type PendingAssistantStatus = "PENDING" | "EXECUTING" | "EXECUTED" | "FAILED" | "CANCELLED" | "EXPIRED";

const init = globalThis as typeof globalThis & { __nineAssistantActionStoreReady?: boolean };
if (!init.__nineAssistantActionStoreReady) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS assistant_pending_actions (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      action TEXT NOT NULL,
      symbol TEXT NOT NULL,
      request_text TEXT NOT NULL,
      status TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL,
      resolved_at INTEGER,
      result_message TEXT
    );
    CREATE INDEX IF NOT EXISTS assistant_pending_actions_session_idx
      ON assistant_pending_actions(session_id, created_at DESC);
  `);
  init.__nineAssistantActionStoreReady = true;
}

export interface PendingAssistantActionRecord {
  id: string;
  sessionId: string;
  action: PendingAssistantAction;
  symbol: "XAUUSD";
  requestText: string;
  status: PendingAssistantStatus;
  createdAt: number;
  expiresAt: number;
  resolvedAt: number | null;
  resultMessage: string | null;
}

function rowToRecord(row: any): PendingAssistantActionRecord {
  return {
    id: String(row.id),
    sessionId: String(row.session_id),
    action: row.action as PendingAssistantAction,
    symbol: "XAUUSD",
    requestText: String(row.request_text),
    status: row.status as PendingAssistantStatus,
    createdAt: Number(row.created_at),
    expiresAt: Number(row.expires_at),
    resolvedAt: row.resolved_at === null || row.resolved_at === undefined ? null : Number(row.resolved_at),
    resultMessage: row.result_message === null || row.result_message === undefined ? null : String(row.result_message),
  };
}

export function createPendingAssistantAction(
  sessionId: string,
  action: PendingAssistantAction,
  requestText: string,
  ttlMs = 90_000,
): PendingAssistantActionRecord {
  const now = Date.now();
  const record: PendingAssistantActionRecord = {
    id: `AST-ACT-${randomUUID()}`,
    sessionId,
    action,
    symbol: "XAUUSD",
    requestText,
    status: "PENDING",
    createdAt: now,
    expiresAt: now + Math.max(10_000, Math.min(ttlMs, 300_000)),
    resolvedAt: null,
    resultMessage: null,
  };

  db.prepare(
    `UPDATE assistant_pending_actions
     SET status = 'CANCELLED', resolved_at = ?, result_message = ?
     WHERE session_id = ? AND status = 'PENDING'`
  ).run(now, 'Superseded by a newer trade action.', sessionId);

  db.prepare(
    `INSERT INTO assistant_pending_actions
      (id, session_id, action, symbol, request_text, status, created_at, expires_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    record.id,
    record.sessionId,
    record.action,
    record.symbol,
    record.requestText,
    record.status,
    record.createdAt,
    record.expiresAt,
  );

  return record;
}

export function getLatestPendingAssistantAction(sessionId: string): PendingAssistantActionRecord | null {
  const row = db.prepare(
    `SELECT id, session_id, action, symbol, request_text, status, created_at, expires_at, resolved_at, result_message
     FROM assistant_pending_actions
     WHERE session_id = ? AND status = 'PENDING'
     ORDER BY created_at DESC LIMIT 1`,
  ).get(sessionId) as any;

  if (!row) return null;

  const record = rowToRecord(row);
  if (record.expiresAt <= Date.now()) {
    db.prepare(
      `UPDATE assistant_pending_actions
       SET status = 'EXPIRED', resolved_at = ?, result_message = ?
       WHERE id = ? AND status = 'PENDING'`,
    ).run(Date.now(), "Confirmation expired.", record.id);
    return null;
  }

  return record;
}

export function claimPendingAssistantAction(
  sessionId: string,
  actionId?: string,
): PendingAssistantActionRecord | null {
  const candidate = actionId
    ? db.prepare(
        `SELECT id, session_id, action, symbol, request_text, status, created_at, expires_at, resolved_at, result_message
         FROM assistant_pending_actions
         WHERE id = ? AND session_id = ? LIMIT 1`,
      ).get(actionId, sessionId) as any
    : getLatestPendingAssistantAction(sessionId);

  if (!candidate) return null;

  const record = rowToRecord(candidate);
  const now = Date.now();

  if (record.status !== "PENDING") return null;

  if (record.expiresAt <= now) {
    db.prepare(
      `UPDATE assistant_pending_actions
       SET status = 'EXPIRED', resolved_at = ?, result_message = ?
       WHERE id = ? AND status = 'PENDING'`,
    ).run(now, "Confirmation expired.", record.id);
    return null;
  }

  const result = db.prepare(
    `UPDATE assistant_pending_actions
     SET status = 'EXECUTING'
     WHERE id = ? AND session_id = ? AND status = 'PENDING' AND expires_at > ?`,
  ).run(record.id, sessionId, now);

  if (Number((result as any).changes ?? 0) !== 1) return null;

  return { ...record, status: "EXECUTING" };
}

export function resolvePendingAssistantAction(
  actionId: string,
  status: "EXECUTED" | "FAILED" | "CANCELLED",
  resultMessage: string,
): void {
  db.prepare(
    `UPDATE assistant_pending_actions
     SET status = ?, resolved_at = ?, result_message = ?
     WHERE id = ?`,
  ).run(status, Date.now(), resultMessage, actionId);
}
