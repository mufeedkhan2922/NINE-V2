import assert from "node:assert/strict";
import { NINE_VERSION, liveTradingEnabled, runtimeSafety } from "../lib/trading/runtime";

export function runRuntimeTest(): void {
  assert.equal(NINE_VERSION, "2.5.0");
  const previousEnabled = process.env.NINE_LIVE_TRADING_ENABLED;
  const previousConfirmation = process.env.NINE_LIVE_TRADING_CONFIRMATION;
  process.env.NINE_LIVE_TRADING_ENABLED = "true";
  delete process.env.NINE_LIVE_TRADING_CONFIRMATION;
  assert.equal(liveTradingEnabled(), false);
  assert.equal(runtimeSafety().liveTradingEnabled, false);
  process.env.NINE_LIVE_TRADING_CONFIRMATION = "I_UNDERSTAND_LIVE_TRADING";
  assert.equal(liveTradingEnabled(), true);
  if (previousEnabled === undefined) delete process.env.NINE_LIVE_TRADING_ENABLED; else process.env.NINE_LIVE_TRADING_ENABLED = previousEnabled;
  if (previousConfirmation === undefined) delete process.env.NINE_LIVE_TRADING_CONFIRMATION; else process.env.NINE_LIVE_TRADING_CONFIRMATION = previousConfirmation;
}
