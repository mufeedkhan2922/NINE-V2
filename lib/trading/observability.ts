import { randomUUID } from "node:crypto";
import { db } from "./db";

export type AuditLevel = "INFO" | "WARN" | "ERROR" | "SECURITY";

export function recordAudit(level: AuditLevel, action: string, metadata: Record<string, string | number | boolean | null> = {}): void {
  try {
    db.prepare(`INSERT INTO trading_events (id,type,timestamp,message,metadata_json) VALUES (?,?,?,?,?)`).run(
      `AUDIT-${randomUUID()}`,
      `AUDIT_${level}`,
      Date.now(),
      action,
      JSON.stringify(metadata),
    );
  } catch {
    // Observability must never take down a trading request.
  }
}
