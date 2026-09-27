import assert from "node:assert/strict";
import { runPaperValidation } from "../lib/trading/paperValidation";
import { NINE_VERSION, runtimeSafety } from "../lib/trading/runtime";

export function runPaperValidationTest(): void {
  assert.equal(NINE_VERSION, "4.1.0");
  const safety = runtimeSafety();
  assert.equal(safety.paperTradingEnabled, true);
  assert.equal(safety.liveTradingEnabled, false);

  const report = runPaperValidation();
  assert.equal(report.liveTradingLocked, true);
  assert.equal(report.paperTradingEnabled, true);
  assert.equal(report.methodology.executionMode, "PAPER_ONLY");
  assert.equal(report.methodology.liveBrokerCalls, false);
  assert.equal(report.methodology.performanceClaim, "NONE");
  assert.notEqual(report.status, "BLOCKED");
  assert.ok(report.checks.some((item) => item.id === "LIVE_LOCK" && item.status === "PASS"));
  assert.ok(report.checks.some((item) => item.id === "PAPER_MODE" && item.status === "PASS"));
  assert.ok(Number.isFinite(report.reconciliation.score));
  assert.ok(Number.isFinite(report.account.balance));
}
