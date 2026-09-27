import assert from "node:assert/strict";
import {
  NINE_VERSION,
  liveTradingEnabled,
  runtimeSafety,
} from "../lib/trading/runtime";

export function runRuntimeTest(): void {
  assert.equal(
    NINE_VERSION,
    "2.10.3",
  );

  const safety =
    runtimeSafety();

  assert.equal(
    safety.paperTradingEnabled,
    true,
  );

  assert.equal(
    liveTradingEnabled(),
    false,
  );

  assert.equal(
    safety.liveTradingEnabled,
    false,
  );
}