import assert from "node:assert/strict";
import { normalizeHistoricalDate } from "../lib/trading/historical";

export function runHistoricalTest(): void {
  assert.equal(normalizeHistoricalDate("2026-09-01"), "2026-09-01", "valid historical date should normalize");
  assert.throws(
    () => normalizeHistoricalDate("2026-02-30"),
    "invalid calendar dates must be rejected",
  );
  assert.throws(
    () => normalizeHistoricalDate("09/01/2026"),
    "non-ISO dates must be rejected",
  );
}
