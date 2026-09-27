import { normalizeHistoricalDate } from "../lib/trading/historical";
import * as assert from "./assert";

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
