import { buildRegimeIntelligence, classifyMarketRegime } from "../lib/trading/regimeIntelligence";
import * as assert from "./assert";

export function runRegimeIntelligenceTest(): void {
  const candles = Array.from({ length: 140 }, (_, i) => {
    const base = 2500 + i * 0.4;
    return { time: i * 300000, open: base, high: base + 2, low: base - 2, close: base + 0.8 };
  });
  const features = classifyMarketRegime(candles);
  assert.ok(["TRENDING_UP","TRENDING_DOWN","RANGING","EXPANDING","COMPRESSED","MIXED"].includes(features.regime), "regime must be classified");
  assert.ok(features.confidence >= 0 && features.confidence <= 99, "regime confidence must be bounded");
  const intel = buildRegimeIntelligence("XAUUSD", candles);
  assert.equal(intel.symbol, "XAUUSD", "regime symbol must be preserved");
  assert.ok(intel.routes.length === 7, "all strategy families must receive a route");
}
