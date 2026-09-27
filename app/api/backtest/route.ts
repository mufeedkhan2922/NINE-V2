import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { requireUser } from "@/lib/security/auth";
import { assertSameOrigin } from "@/lib/security/requestSecurity";
import { rateLimit, requestKey } from "@/lib/security/rateLimit";
import { getBacktestCandles } from "@/lib/trading/market";
import { runBacktest } from "@/lib/trading/backtest";
import { db } from "@/lib/trading/db";
import type { MarketSymbol, Timeframe } from "@/lib/trading/types";
import { NINE_VERSION } from "@/lib/trading/runtime";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const SYMBOLS: MarketSymbol[] = ["XAUUSD", "NIFTY", "BANKNIFTY"];

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const user = requireUser(request);
    const limit = rateLimit(
      requestKey(request, user.id),
      5,
      60_000,
    );

    if (!limit.allowed) {
      return NextResponse.json(
        {
          ok: false,
          error: "Backtest rate limit exceeded.",
          retryAfterSeconds: limit.retryAfterSeconds,
        },
        { status: 429 },
      );
    }

    const body = (await request
      .json()
      .catch(() => ({}))) as {
      initialBalance?: number;
      riskPercent?: number;
      symbol?: string;
    };

    const rawSymbol = body.symbol?.toUpperCase();
    const symbol = SYMBOLS.includes(rawSymbol as MarketSymbol)
      ? (rawSymbol as MarketSymbol)
      : "XAUUSD";

    const allowedTimeframes: Timeframe[] = ["1min", "5min", "15min", "1h", "4h", "1day"];\n    const timeframe = allowedTimeframes.includes(body.timeframe as Timeframe) ? body.timeframe as Timeframe : "1min";\n    const { candles, source } = await getBacktestCandles(symbol, timeframe);
    const initialBalance =
      Number.isFinite(body.initialBalance) &&
      Number(body.initialBalance) > 0
        ? Number(body.initialBalance)
        : 10000;

    const riskPercent =
      Number.isFinite(body.riskPercent) &&
      Number(body.riskPercent) > 0 &&
      Number(body.riskPercent) <= 1
        ? Number(body.riskPercent)
        : 0.5;

    const result = runBacktest(
      candles,
      initialBalance,
      riskPercent,
    );

    const runId = `RUN-${randomUUID()}`;
    const now = Date.now();

    db.prepare(
      `INSERT INTO backtest_runs (id,symbol,timeframe,started_at,completed_at,initial_balance,final_balance,total_trades,wins,losses,win_rate,net_pnl,max_drawdown,profit_factor,config_json) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    ).run(
      runId,
      symbol,
      "1min",
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
      JSON.stringify({ ...result.config, source, timeframe }),
    );

    const insert = db.prepare(
      `INSERT INTO backtest_trades (id,run_id,index_no,side,entry_time,exit_time,entry_price,exit_price,stop_loss,take_profit,quantity,pnl,outcome,reason) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    );

    for (const trade of result.trades) {
      insert.run(
        trade.id,
        runId,
        trade.index,
        trade.side,
        trade.entryTime,
        trade.exitTime,
        trade.entryPrice,
        trade.exitPrice,
        trade.stopLoss,
        trade.takeProfit,
        trade.quantity,
        trade.pnl,
        trade.outcome,
        trade.reason,
      );
    }

    return NextResponse.json({
      ok: true,
      version: NINE_VERSION,
      runId,
      symbol,
      result,
      source: source === "CACHE" ? "validated-candle-cache" : "validated-provider-history",
      candlesUsed: candles.length,
    });
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Backtest failed.";
    const status =
      message === "UNAUTHENTICATED"
        ? 401
        : message === "CROSS_ORIGIN"
          ? 403
          : 500;

    return NextResponse.json(
      { ok: false, error: message },
      { status },
    );
  }
}
