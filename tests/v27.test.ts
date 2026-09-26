import assert from "node:assert/strict";

import {
  NINE_VERSION,
  liveTradingEnabled,
  marketFeedStatus,
  runtimeSafety,
} from "../lib/trading/runtime";

function withEnvironment(
  values: Record<string, string | undefined>,
  fn: () => void,
): void {
  const previous: Record<string, string | undefined> = {};

  for (const key of Object.keys(values)) {
    previous[key] = process.env[key];

    const value = values[key];

    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }

  try {
    fn();
  } finally {
    for (const key of Object.keys(values)) {
      const value = previous[key];

      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
}

export async function runV27Test(): Promise<void> {
  /*
   * V2.7 runtime identity
   */
  assert.equal(
    NINE_VERSION,
    "2.7.0",
    "NINE runtime version must be 2.7.0.",
  );

  /*
   * Live trading must remain locked when the explicit
   * confirmation is missing or incorrect.
   */
  withEnvironment(
    {
      NINE_LIVE_TRADING_ENABLED: "true",
      NINE_LIVE_TRADING_CONFIRMATION: "INVALID_CONFIRMATION",
      BROKER_EXECUTION_WEBHOOK_URL: undefined,
      BROKER_EXECUTION_WEBHOOK_SECRET: undefined,
    },
    () => {
      assert.equal(
        liveTradingEnabled(),
        false,
        "Live trading must remain disabled without the exact safety confirmation.",
      );

      const safety = runtimeSafety();

      assert.equal(
        safety.liveTradingEnabled,
        false,
        "Effective live trading must remain disabled without a configured broker.",
      );

      assert.equal(
        safety.paperTradingEnabled,
        true,
        "Paper trading must remain enabled.",
      );

      assert.equal(
        safety.brokerConfigured,
        false,
        "Broker must be reported as unconfigured when gateway credentials are absent.",
      );

      assert.ok(
        safety.warnings.some((warning) =>
          warning.toLowerCase().includes("confirmation"),
        ),
        "Runtime safety should explain a missing/invalid live-trading confirmation.",
      );
    },
  );

  /*
   * A missing market snapshot is always non-tradable.
   */
  const disconnected = marketFeedStatus(null);

  assert.equal(
    disconnected.connection,
    "DISCONNECTED",
    "Missing market data must report DISCONNECTED.",
  );

  assert.equal(
    disconnected.stale,
    true,
    "Missing market data must be treated as stale/unavailable.",
  );

  assert.equal(
    disconnected.tradingAllowed,
    false,
    "Missing market data must never be tradable.",
  );

  assert.equal(
    disconnected.priceSource,
    "NONE",
    "Missing market data must not invent a price source.",
  );

  /*
   * A stale snapshot must remain non-tradable even if the
   * upstream market object claims trading is allowed.
   */
  const stale = marketFeedStatus({
    timestamp: Date.now() - 60_000,
    priceSource: "QUOTE",
    tradingAllowed: true,
    marketState: {
      dataState: "STALE",
    },
  });

  assert.equal(
    stale.connection,
    "DEGRADED",
    "Stale market data must report DEGRADED.",
  );

  assert.equal(
    stale.stale,
    true,
    "Stale market data must be marked stale.",
  );

  assert.equal(
    stale.tradingAllowed,
    false,
    "Stale market data must never be tradable.",
  );

  /*
   * A suspicious snapshot must also be blocked.
   */
  const suspicious = marketFeedStatus({
    timestamp: Date.now(),
    priceSource: "QUOTE",
    tradingAllowed: true,
    marketState: {
      dataState: "SUSPICIOUS",
    },
  });

  assert.equal(
    suspicious.connection,
    "DEGRADED",
    "Suspicious market data must report DEGRADED.",
  );

  assert.equal(
    suspicious.stale,
    true,
    "Suspicious market data must be treated as unsafe.",
  );

  assert.equal(
    suspicious.tradingAllowed,
    false,
    "Suspicious market data must never be tradable.",
  );

  /*
   * A fresh validated snapshot may be tradable only when the
   * market layer itself explicitly allows trading.
   */
  const fresh = marketFeedStatus({
    timestamp: Date.now(),
    priceSource: "QUOTE",
    tradingAllowed: true,
    marketState: {
      dataState: "NORMAL",
    },
  });

  assert.equal(
    fresh.connection,
    "CONNECTED",
    "Fresh validated market data must report CONNECTED.",
  );

  assert.equal(
    fresh.stale,
    false,
    "Fresh validated market data must not be marked stale.",
  );

  assert.equal(
    fresh.tradingAllowed,
    true,
    "Fresh validated market data may be tradable when the market layer explicitly allows it.",
  );

  /*
   * Fresh data must still remain non-tradable when the upstream
   * market layer explicitly blocks trading.
   */
  const freshBlocked = marketFeedStatus({
    timestamp: Date.now(),
    priceSource: "QUOTE",
    tradingAllowed: false,
    marketState: {
      dataState: "NORMAL",
    },
  });

  assert.equal(
    freshBlocked.connection,
    "CONNECTED",
    "Fresh but intentionally blocked market data can remain connected.",
  );

  assert.equal(
    freshBlocked.stale,
    false,
    "Fresh blocked market data should not be incorrectly classified as stale.",
  );

  assert.equal(
    freshBlocked.tradingAllowed,
    false,
    "Market-level tradingAllowed=false must remain a hard block.",
  );
}