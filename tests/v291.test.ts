import assert from "node:assert/strict";
import {
  fetchProviderCandles,
  fetchProviderQuote,
  isProviderRateLimitedError,
  providerHealth,
} from "../lib/trading/provider";

function makeCandles(count = 20): Array<Record<string, string>> {
  return Array.from({ length: count }, (_, index) => {
    const close = 4200 + index;
    return {
      datetime: new Date(1_700_000_000_000 + index * 60_000).toISOString(),
      open: String(close - 0.2),
      high: String(close + 1),
      low: String(close - 1),
      close: String(close),
      volume: "1000",
    };
  });
}

export async function runV291Test(): Promise<void> {
  const previousKey = process.env.TWELVE_DATA_API_KEY;
  const previousFetch = globalThis.fetch;
  process.env.TWELVE_DATA_API_KEY = "TEST_PROVIDER_KEY";

  let calls = 0;
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    calls += 1;
    const url = String(input);
    if (url.includes("/time_series")) {
      return new Response(JSON.stringify({ status: "ok", values: makeCandles() }), {
        status: 200,
        headers: { "api-credits-used": "1", "api-credits-left": "7" },
      });
    }
    if (url.includes("/price")) {
      return new Response(JSON.stringify({ price: "4201.25" }), {
        status: 200,
        headers: { "api-credits-used": "2", "api-credits-left": "6" },
      });
    }
    return new Response("not found", { status: 404 });
  }) as typeof fetch;

  try {
    const before = providerHealth().requestsLastMinute;
    const [first, second] = await Promise.all([
      fetchProviderCandles("XAUUSD", "1min", 40),
      fetchProviderCandles("XAUUSD", "1min", 40),
    ]);

    assert.equal(first.length, 20);
    assert.equal(second.length, 20);
    assert.equal(calls, 1, "concurrent identical candle requests must be deduplicated");
    assert.equal(providerHealth().requestsLastMinute, before + 1);
    assert.equal(providerHealth().apiCreditsUsed, 1);
    assert.equal(providerHealth().apiCreditsLeft, 7);
    assert.equal(providerHealth().apiCreditsLimit, 8);

    const quote = await fetchProviderQuote("XAUUSD");
    assert.equal(quote.price, 4201.25);
    assert.equal(calls, 2, "quote should require one additional provider request");
    assert.equal(providerHealth().apiCreditsUsed, 2);
    assert.equal(providerHealth().apiCreditsLeft, 6);
    assert.equal(isProviderRateLimitedError(new Error("Twelve Data HTTP 429")), true);
    assert.equal(isProviderRateLimitedError(new Error("normal validation error")), false);
  } finally {
    globalThis.fetch = previousFetch;
    if (previousKey === undefined) delete process.env.TWELVE_DATA_API_KEY;
    else process.env.TWELVE_DATA_API_KEY = previousKey;
  }
}
