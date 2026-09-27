import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { requireUser } from "@/lib/security/auth";
import { assertSameOrigin } from "@/lib/security/requestSecurity";
import { rateLimit, requestKey } from "@/lib/security/rateLimit";
import { fetchHistoricalBacktestDataset } from "@/lib/trading/historical";
import { runHistoricalIntelligence } from "@/lib/trading/historicalIntelligence";
import { db, transaction } from "@/lib/trading/db";
import { NINE_VERSION } from "@/lib/trading/runtime";
import type { MarketSnapshot, MarketSymbol, Timeframe } from "@/lib/trading/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const SYMBOLS: MarketSymbol[] = ["XAUUSD", "NIFTY", "BANKNIFTY"];
const TIMEFRAMES: Timeframe[] = ["1min", "5min", "15min", "1h", "4h", "1day"];

function numberOr(value: unknown, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function memoryRows(symbol: string, limit = 50) {
  return db.prepare(
    "SELECT strategy_id AS strategyId, strategy_name AS strategyName, symbol, timeframe, session, regime, trades, wins, win_rate AS winRate, expectancy_r AS expectancyR, profit_factor AS profitFactor, max_drawdown_r AS maxDrawdownR, sample_start AS sampleStart, sample_end AS sampleEnd, source, updated_at AS updatedAt FROM strategy_memory WHERE symbol = ? ORDER BY expectancy_r DESC, trades DESC, updated_at DESC LIMIT ?",
  ).all(symbol, Math.max(1, Math.min(200, limit)));
}

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const user = requireUser(request);
    const limit = rateLimit(requestKey(request, user.id), 2, 60_000);
    if (!limit.allowed) {
      return NextResponse.json(
        { ok: false, error: "Historical intelligence rate limit exceeded.", retryAfterSeconds: limit.retryAfterSeconds },
        { status: 429 },
      );
    }

    const body = (await request.json().catch(() => ({}))) as {
      symbol?: string; timeframe?: string; startDate?: string; endDate?: string;
      spreadPrice?: number; slippagePrice?: number; commissionPerTrade?: number;
      delayCandles?: number; rewardRisk?: number; stopAtrMultiplier?: number;
      minimumStopPercent?: number; targetWinRate?: number; folds?: number; monteCarloSimulations?: number;
    };

    const rawSymbol = body.symbol?.toUpperCase();
    const symbol = SYMBOLS.includes(rawSymbol as MarketSymbol) ? rawSymbol as MarketSymbol : "XAUUSD";
    const timeframe = TIMEFRAMES.includes(body.timeframe as Timeframe) ? body.timeframe as Timeframe : "1min";
    if (!body.startDate || !body.endDate) {
      return NextResponse.json({ ok: false, error: "startDate and endDate are required in YYYY-MM-DD format." }, { status: 400 });
    }

    const dataset = await fetchHistoricalBacktestDataset(symbol, timeframe, body.startDate, body.endDate);
    const market: MarketSnapshot = {
      symbol,
      price: dataset.candles.at(-1)?.close ?? 0,
      previousClose: dataset.candles.at(-2)?.close ?? dataset.candles.at(-1)?.close ?? 0,
      changePercent: 0,
      candles: dataset.candles,
      timestamp: dataset.candles.at(-1)?.time ?? Date.now(),
    };

    const result = runHistoricalIntelligence(dataset.candles, market, {
      spreadPrice: Math.max(0, numberOr(body.spreadPrice, 0.20)),
      slippagePrice: Math.max(0, numberOr(body.slippagePrice, 0.10)),
      commissionPerTrade: Math.max(0, numberOr(body.commissionPerTrade, 0)),
      delayCandles: Math.max(0, Math.floor(numberOr(body.delayCandles, 0))),
      rewardRisk: Math.max(0.5, Math.min(5, numberOr(body.rewardRisk, 2))),
      stopAtrMultiplier: Math.max(0.5, Math.min(5, numberOr(body.stopAtrMultiplier, 1.2))),
      minimumStopPercent: Math.max(0.0001, Math.min(0.02, numberOr(body.minimumStopPercent, 0.0012))),
      targetWinRate: Math.max(50, Math.min(99.9, numberOr(body.targetWinRate, 90))),
      folds: Math.max(2, Math.min(8, Math.floor(numberOr(body.folds, 4)))),
      monteCarloSimulations: Math.max(250, Math.min(5000, Math.floor(numberOr(body.monteCarloSimulations, 1000)))),
      source: dataset.source,
    });

    const runId = `LAB-${randomUUID()}`;
    const now = Date.now();
    transaction(() => {
      for (const record of result.memoryRecords) {
        db.prepare(
          "INSERT INTO strategy_memory (id,strategy_id,strategy_name,symbol,timeframe,session,regime,trades,wins,win_rate,expectancy_r,profit_factor,max_drawdown_r,sample_start,sample_end,source,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
        ).run(
          `${runId}-${record.strategyId}-${record.session}-${record.regime}`,
          record.strategyId, record.strategyName, record.symbol, timeframe, record.session, record.regime,
          record.trades, record.wins, record.winRate, record.expectancyR, record.profitFactor,
          record.maxDrawdownR, record.sampleStart, record.sampleEnd, record.source, now,
        );
      }
    });

    return NextResponse.json({
      ok: true, version: NINE_VERSION, runId, symbol, timeframe, source: dataset.source,
      startDate: dataset.startDate, endDate: dataset.endDate, candlesUsed: dataset.candles.length,
      dataQuality: dataset.quality, result, memoryPersisted: result.memoryRecords.length,
      generatedAt: new Date().toISOString(),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Historical intelligence failed.";
    const status = message === "UNAUTHENTICATED" ? 401 : message === "CROSS_ORIGIN" ? 403 : message.includes("TWELVE_DATA_API_KEY") ? 503 : 400;
    return NextResponse.json({ ok: false, version: NINE_VERSION, error: message, code: "HISTORICAL_INTELLIGENCE_FAILED" }, { status });
  }
}

export async function GET(request: Request) {
  try {
    assertSameOrigin(request);
    const user = requireUser(request);
    const limit = rateLimit(requestKey(request, user.id), 10, 60_000);
    if (!limit.allowed) return NextResponse.json({ ok: false, error: "Memory query rate limit exceeded." }, { status: 429 });
    const url = new URL(request.url);
    const requested = url.searchParams.get("symbol");
    const symbol = SYMBOLS.includes(requested as MarketSymbol) ? requested as MarketSymbol : "XAUUSD";
    const limitRows = numberOr(url.searchParams.get("limit"), 50);
    return NextResponse.json({ ok: true, version: NINE_VERSION, symbol, records: memoryRows(symbol, limitRows), generatedAt: new Date().toISOString() });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Strategy memory query failed.";
    const status = message === "UNAUTHENTICATED" ? 401 : message === "CROSS_ORIGIN" ? 403 : 400;
    return NextResponse.json({ ok: false, version: NINE_VERSION, error: message }, { status });
  }
}
