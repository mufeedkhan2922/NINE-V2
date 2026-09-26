import { createHash, randomUUID } from "node:crypto";
import { db } from "./db";
import { ExecutionLedgerRecord } from "./types";

export function requestHash(input: unknown): string {
  return createHash("sha256").update(JSON.stringify(input)).digest("hex");
}

export function appendExecutionLedger(record: Omit<ExecutionLedgerRecord, "id">): ExecutionLedgerRecord {
  const full: ExecutionLedgerRecord = { ...record, id: `LEDGER-${randomUUID()}` };
  db.prepare(`INSERT INTO execution_ledger (id,event_type,timestamp,symbol,mode,side,quantity,price,stop_loss,take_profit,status,broker_order_id,request_hash,metadata_json) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(full.id,full.eventType,full.timestamp,full.symbol,full.mode,full.side,full.quantity,full.price,full.stopLoss,full.takeProfit,full.status,full.brokerOrderId ?? null,full.requestHash ?? null,JSON.stringify(full.metadata ?? {}));
  return full;
}

export function getExecutionLedger(limit = 100): ExecutionLedgerRecord[] {
  return (db.prepare(`SELECT * FROM execution_ledger ORDER BY timestamp DESC LIMIT ?`).all(Math.max(1, Math.min(limit, 500))) as any[]).map((r) => ({
    id: r.id, eventType: r.event_type, timestamp: Number(r.timestamp), symbol: r.symbol, mode: r.mode, side: r.side, quantity: Number(r.quantity), price: Number(r.price), stopLoss: Number(r.stop_loss), takeProfit: Number(r.take_profit), status: r.status, brokerOrderId: r.broker_order_id ?? undefined, requestHash: r.request_hash ?? undefined, metadata: r.metadata_json ? JSON.parse(r.metadata_json) : {},
  }));
}
