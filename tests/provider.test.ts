import { fetchProviderHistoricalCandles, providerHealth } from "../lib/trading/provider";
import * as assert from "./assert";

export async function runProviderContractTest(): Promise<void> {
  const previousKey = process.env.TWELVE_DATA_API_KEY;
  const previousFetch = globalThis.fetch;

  process.env.TWELVE_DATA_API_KEY = "test-key";

  const values = Array.from({ length: 45 }, (_, index) => {
    const close = 2500 + index * 0.5;
    return {
      datetime: `2026-09-01 00:${String(index).padStart(2, "0")}:00`,
      open: String(close - 0.2),
      high: String(close + 0.5),
      low: String(close - 0.5),
      close: String(close),
    };
  });

  let requestedUrl = "";
  globalThis.fetch = (async (input: string | URL | Request) => {
    requestedUrl = String(input);
    return new Response(JSON.stringify({ status: "ok", values }), {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "api-credits-used": "1",
        "api-credits-left": "7",
      },
    });
  }) as typeof fetch;

  try {
    const candles = await fetchProviderHistoricalCandles(
      "XAUUSD",
      "1min",
      "2026-09-01",
      "2026-09-02",
    );

    assert.equal(candles.length, 45, "historical provider should return validated candles");
    assert.ok(requestedUrl.includes("symbol=XAU%2FUSD"), "XAUUSD must map to XAU/USD");
    assert.ok(requestedUrl.includes("start_date=2026-09-01"), "start date must be sent");
    assert.ok(requestedUrl.includes("end_date=2026-09-02"), "end date must be sent");

    const health = providerHealth();
    assert.equal(health.apiCreditsUsed, 1, "credit usage must be captured");
    assert.equal(health.apiCreditsLeft, 7, "remaining credits must be captured");
    assert.equal(health.apiCreditsLimit, 8, "credit limit must be derived");
  } finally {
    globalThis.fetch = previousFetch;
    if (previousKey === undefined) delete process.env.TWELVE_DATA_API_KEY;
    else process.env.TWELVE_DATA_API_KEY = previousKey;
  }
}
