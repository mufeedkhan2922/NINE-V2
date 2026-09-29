import fs from "node:fs";
import { fetchProviderHistoricalCandles } from "../lib/trading/provider";
import { runStrategyEvolutionResearch, evolutionSummary } from "../lib/trading/strategyEvolutionResearch";

const START = process.env.NINE_EVOLUTION_START ?? "2026-08-01";
const END = process.env.NINE_EVOLUTION_END ?? "2026-09-29";
const CHUNK_DAYS = 10;

function addDays(d: Date, n: number): Date {
  const x = new Date(d);
  x.setUTCDate(x.getUTCDate() + n);
  return x;
}

function iso(d: Date): string {
  return d.toISOString().slice(0, 10);
}

async function fetchHistory() {
  const start = new Date(START + "T00:00:00Z");
  const end = new Date(END + "T00:00:00Z");
  const map = new Map<number, any>();
  for (let cursor = start; cursor < end; cursor = addDays(cursor, CHUNK_DAYS)) {
    const to = addDays(cursor, CHUNK_DAYS) < end ? addDays(cursor, CHUNK_DAYS) : end;
    for (const candle of await fetchProviderHistoricalCandles("XAUUSD", "5min", iso(cursor), iso(to))) map.set(candle.time, candle);
  }
  return [...map.values()].sort((a, b) => a.time - b.time);
}

async function main() {
  if (!process.env.TWELVE_DATA_API_KEY) throw new Error("TWELVE_DATA_API_KEY is missing.");
  const candles = await fetchHistory();
  if (candles.length < 240) throw new Error("Insufficient XAUUSD candles for evolution: " + candles.length);
  const snapshot = runStrategyEvolutionResearch(candles, "XAUUSD");
  const result = {
    version: "0.5.18",
    instrument: "XAUUSD",
    timeframe: "5min",
    period: { start: START, end: END },
    summary: evolutionSummary(snapshot),
    activeStrategies: snapshot.activeStrategies,
    shadowStrategies: snapshot.shadowStrategies,
    retiredStrategies: snapshot.retiredStrategies,
    nextAction: snapshot.nextAction,
    mutations: snapshot.mutations.length,
    walkForwardWindows: snapshot.windows.length,
    records: snapshot.records,
  };
  fs.mkdirSync("artifacts", { recursive: true });
  fs.writeFileSync("artifacts/xauusd-strategy-evolution.json", JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exit(1);
});
