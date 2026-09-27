import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { requireUser } from "@/lib/security/auth";
import { assertSameOrigin } from "@/lib/security/requestSecurity";
import { rateLimit, requestKey } from "@/lib/security/rateLimit";
import { fetchHistoricalBacktestDataset } from "@/lib/trading/historical";
import { runHistoricalIntelligence } from "@/lib/trading/historicalIntelligence";
import { db, transaction } from "@/lib/trading/db";
import { NINE_VERSION } from "@/lib/trading/runtime";
import type { MarketSymbol, Timeframe } from "@/lib/trading/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const SYMBOLS: MarketSymbol[] = ["XAUUSD", "NIFTY", "BANKNIFTY"];
const TIMEFRAMES: Timeframe[] = ["1min", "5min", "15min", "1h", "4h", "1day"];

function finiteNumber(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const user = requireUser(request);
    const limit = rateLimit(requestKey(request, user.id), 2, 60_000);
    if (!limit.allowed) {
      return NextResponse.json(
        { ok: false, error: "Research rate limit exceeded.", retryAfterSeconds: limit.retryAfterSeconds },
        { status: 429 },
      );
    }

    const body = (await request.json().catch(() => ({}))) as {
      symbol?: string;
      timeframe?: string;
      startDate?: string;
      endDate?: string;
      targetWinRate?: number;
      folds?: number;
      monteCarloSimulations?: number;
      spreadPrice?: number;
      slippagePrice?: number;
      commissionPerTrade?: number;
      delayCandles?: number;
      rewardRisk?: number;
    };

    const rawSymbol = body.symbol?.toUpperCase();
    const symbol = SYMBOLS.includes(rawSymbol as MarketSymbol)
      ? (rawSymbol as MarketSymbol)
      : "XAUUSD";
    const timeframe = TIMEFRAMES.includes(body.timeframe as Timeframe)
      ? (body.timeframe as Timeframe)
      : "1min";

    if (!body.startDate || !body.endDate) {
      return NextResponse.json(
        { ok: false, error: "startDate and endDate are required in YYYY-MM-DD format.", code: "RESEARCH_RANGE_REQUIRED" },
        { status: 400 },
      );
    }

    const dataset = await fetchHistoricalBacktestDataset(
      symbol,
      timeframe,
      body.startDate,
      body.endDate,
    );

    const folds = Math.max(2, Math.min(8, Math.floor(finiteNumber(body.folds, 4))));
    const monteCarloSimulations = Math.max(
      250,
      Math.min(5000, Math.floor(finiteNumber(body.monteCarloSimulations, 1000))),
    );

    const result = runHistoricalIntelligence(
      dataset.candles,
      {
        symbol,
        price: dataset.candles.at(-1)?.close ?? 0,
        previousClose: dataset.candles.at(-2)?.close ?? dataset.candles.at(-1)?.close ?? 0,
        changePercent: 0,
        candles: dataset.candles,
        timestamp: dataset.candles.at(-1)?.time ?? Date.now(),
      },
      {
        source: dataset.source,
        targetWinRate: Math.max(50, Math.min(99.9, finiteNumber(body.targetWinRate, 90))),
        folds,
        monteCarloSimulations,
        spreadPrice: Math.max(0, finiteNumber(body.spreadPrice, 0.2)),
        slippagePrice: Math.max(0, finiteNumber(body.slippagePrice, 0.1)),
        commissionPerTrade: Math.max(0, finiteNumber(body.commissionPerTrade, 0)),
        delayCandles: Math.max(0, Math.floor(finiteNumber(body.delayCandles, 0))),
        rewardRisk: Math.max(0.5, Math.min(10, finiteNumber(body.rewardRisk, 2))),
      },
    );

    const runId = `RESEARCH-${randomUUID()}`;
    const createdAt = Date.now();

    transaction(() => {
      db.prepare(
        `INSERT INTO research_runs
          (id,symbol,timeframe,start_date,end_date,source,candles,oos_trades,research_status,research_score,target_win_rate,target_reached,created_at,result_json)
          VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      ).run(
        runId,
        symbol,
        timeframe,
        dataset.startDate,
        dataset.endDate,
        dataset.source,
        dataset.candles.length,
        result.researchQuality.outOfSampleTrades,
        result.researchQuality.status,
        result.researchQuality.score,
        result.targetWinRate,
        result.targetReached ? 1 : 0,
        createdAt,
        JSON.stringify({
          version: NINE_VERSION,
          dataQuality: dataset.quality,
          fetchedAt: dataset.fetchedAt,
          researchIntegrity: result.researchIntegrity,
          researchMatrix: result.researchMatrix,
          riskProfile: result.riskProfile,
        }),
      );

      const insertMemory = db.prepare(
        `INSERT INTO strategy_memory
          (id,strategy_id,strategy_name,symbol,timeframe,session,regime,trades,wins,win_rate,expectancy_r,profit_factor,max_drawdown_r,sample_start,sample_end,source,updated_at)
          VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      );

      for (const record of result.memoryRecords) {
        insertMemory.run(
          `MEM-${randomUUID()}`,
          record.strategyId,
          record.strategyName,
          record.symbol,
          timeframe,
          record.session,
          record.regime,
          record.trades,
          record.wins,
          record.winRate,
          record.expectancyR,
          record.profitFactor,
          record.maxDrawdownR,
          record.sampleStart,
          record.sampleEnd,
          `${dataset.source}:OOS`,
          createdAt,
        );
      }
    });

    return NextResponse.json({
      ok: true,
      version: NINE_VERSION,
      runId,
      symbol,
      timeframe,
      source: dataset.source,
      startDate: dataset.startDate,
      endDate: dataset.endDate,
      candlesUsed: dataset.candles.length,
      dataQuality: dataset.quality,
      result,
      generatedAt: new Date(createdAt).toISOString(),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Historical research failed.";
    const status =
      message === "UNAUTHENTICATED" ? 401
        : message === "CROSS_ORIGIN" ? 403
          : message.includes("TWELVE_DATA_API_KEY") ? 503
            : message.includes("Historical") || message.includes("date") || message.includes("format") ? 400
              : 503;

    return NextResponse.json(
      { ok: false, version: NINE_VERSION, error: message, code: "HISTORICAL_RESEARCH_FAILED" },
      { status },
    );
  }
}
