import fs from "node:fs";
import { fetchProviderHistoricalCandles } from "../lib/trading/provider";
import { buildRegimeIntelligence, persistRegimeIntelligence } from "../lib/trading/regimeIntelligence";

const START = process.env.NINE_REGIME_START ?? "2026-08-01";
const END = process.env.NINE_REGIME_END ?? "2026-09-29";
const CHUNK_DAYS = 10;

function addDays(d: Date, n: number): Date {
  const x = new Date(d);
  x.setUTCDate(x.getUTCDate() + n);
  return x;
}
function iso(d: Date): string { return d.toISOString().slice(0, 10); }

async function main() {
  if (!process.env.TWELVE_DATA_API_KEY) throw new Error("TWELVE_DATA_API_KEY is missing.");
  const start = new Date(START + "T00:00:00Z");
  const end = new Date(END + "T00:00:00Z");
  const map = new Map<number, any>();
  for (let cursor = start; cursor < end; cursor = addDays(cursor, CHUNK_DAYS)) {
    const to = addDays(cursor, CHUNK_DAYS) < end ? addDays(cursor, CHUNK_DAYS) : end;
    for (const candle of await fetchProviderHistoricalCandles("XAUUSD", "5min", iso(cursor), iso(to))) map.set(candle.time, candle);
  }
  const candles = [...map.values()].sort((a,b) => a.time - b.time);
  if (candles.length < 240) throw new Error("Insufficient XAUUSD candles for regime intelligence: " + candles.length);
  const intel = buildRegimeIntelligence("XAUUSD", candles);
  persistRegimeIntelligence(intel);
  const result = {
    version: "0.5.19",
    instrument: "XAUUSD",
    timeframe: "5min",
    period: { start: START, end: END },
    regime: intel.features,
    routes: intel.routes,
    blockedFamilies: intel.blockedFamilies,
    safety: [
      "Regime intelligence changes strategy selection preference only.",
      "Transition states reduce confidence rather than forcing a trade.",
      "No regime classification can bypass setup validation or Sentinel.",
      "This research cycle does not enable live broker execution."
    ]
  };
  fs.mkdirSync("artifacts", { recursive: true });
  fs.writeFileSync("artifacts/xauusd-regime-intelligence.json", JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
}
main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exit(1);
});
