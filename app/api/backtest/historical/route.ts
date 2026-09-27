import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { requireUser } from "@/lib/security/auth";
import { assertSameOrigin } from "@/lib/security/requestSecurity";
import { rateLimit, requestKey } from "@/lib/security/rateLimit";
import { fetchHistoricalBacktestDataset } from "@/lib/trading/historical";
import { runBacktest } from "@/lib/trading/backtest";
import { db } from "@/lib/trading/db";
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
    const limit = rateLimit(requestKey(request, user.id), 3, 60_000);
    if (!limit.allowed) {
      return NextResponse.json(
        { ok: false, error: "Historical backtest rate limit exceeded.", retryAfterSeconds: limit.retryAfterSeconds },
        { status: 429 },
      );
    }

    const body = (await request.json().catch(() => ({}))) as {
      symbol?: string;
      timeframe?: string;
      startDate?: string;
      endDate?: string;
      initialBalance?: number;
      riskPercent?: number;
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
        { ok: false, error: "startDate and endDate are required in YYYY-MM-DD format.", code: "HISTORICAL_RANGE_REQUIRED" },
        { status: 400 },
      );
    }

    const dataset = await fetchHistoricalBacktestDataset(
      symbol,
      timeframe,
      body.startDate,
      body.endDate,
    );

    const initialBalance = Math.max(100, finiteNumber(body.initialBalance, 10_000));
    const riskPercent = Math.min(2, Math.max(0.1, finiteNumber(body.riskPercent, 0.5)));
    const result = runBacktest(dataset.candles, initialBalance, riskPercent);

    const runId = `RUN-${randomUUID()}`;
    const now = Date.now();
    db.prepare(
      `INSERT INTO backtest_runs (id,symbol,timeframe,started_at,completed_at,initial_balance,final_balance,total_trades,wins,losses,win_rate,net_pnl,max_drawdown,profit_factor,config_json) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    ).run(
      runId,
      symbol,
      timeframe,
      now,
      Date.now(),
      result.initialBalance,
      result.finalBalance,
      result.totalTrades,
      result.wins,
      result.losses,
      result.winRate,
      result.netPnl,
      result.maxDrawdown,
      result.profitFactor,
      JSON.stringify({
        ...result.config,
        source: dataset.source,
        startDate: dataset.startDate,
        endDate: dataset.endDate,
        fetchedAt: dataset.fetchedAt,
        dataQualityScore: dataset.quality.score,
      }),
    );

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
      generatedAt: new Date().toISOString(),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Historical backtest failed.";
    const status =
      message === "UNAUTHENTICATED" ? 401
        : message === "CROSS_ORIGIN" ? 403
          : message.includes("TWELVE_DATA_API_KEY") ? 503
            : message.includes("Historical") || message.includes("date") ? 400
              : 503;

    return NextResponse.json(
      { ok: false, version: NINE_VERSION, error: message, code: "HISTORICAL_BACKTEST_FAILED" },
      { status },
    );
  }
}
