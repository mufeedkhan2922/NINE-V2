import { NextResponse } from "next/server";

import { requireUser } from "@/lib/security/auth";
import { assertSameOrigin } from "@/lib/security/requestSecurity";
import { rateLimit, requestKey } from "@/lib/security/rateLimit";
import { getBacktestCandles } from "@/lib/trading/market";
import { runBacktest } from "@/lib/trading/backtest";
import { NINE_VERSION } from "@/lib/trading/runtime";
import type { MarketSymbol, Timeframe } from "@/lib/trading/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const SYMBOLS: MarketSymbol[] = ["XAUUSD", "NIFTY", "BANKNIFTY"];
const TIMEFRAMES: Timeframe[] = ["1min", "5min", "15min", "1h"];

function finiteNumber(value: string | null, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export async function GET(request: Request) {
  try {
    assertSameOrigin(request);
    const user = requireUser(request);
    const limit = rateLimit(requestKey(request, user.id), 5, 60_000);

    if (!limit.allowed) {
      return NextResponse.json(
        { ok: false, error: "Backtest rate limit exceeded.", retryAfterSeconds: limit.retryAfterSeconds },
        { status: 429 },
      );
    }

    const url = new URL(request.url);
    const rawSymbol = url.searchParams.get("symbol")?.toUpperCase();
    const symbol = SYMBOLS.includes(rawSymbol as MarketSymbol)
      ? (rawSymbol as MarketSymbol)
      : "XAUUSD";

    const rawTimeframe = url.searchParams.get("timeframe") ?? "1min";
    const timeframe = TIMEFRAMES.includes(rawTimeframe as Timeframe)
      ? (rawTimeframe as Timeframe)
      : "1min";

    const initialBalance = Math.max(100, finiteNumber(url.searchParams.get("initialBalance"), 10_000));
    const riskPercent = Math.min(2, Math.max(0.1, finiteNumber(url.searchParams.get("riskPercent"), 0.5)));

    const { candles, source } = await getBacktestCandles(symbol, timeframe);
    if (candles.length < 40) {
      return NextResponse.json(
        {
          ok: false,
          version: NINE_VERSION,
          error: `Not enough validated ${timeframe} candles for ${symbol}. At least 40 are required.`,
          code: "INSUFFICIENT_BACKTEST_DATA",
          candlesAvailable: candles.length,
        },
        { status: 422 },
      );
    }

    const result = runBacktest(candles, initialBalance, riskPercent);

    return NextResponse.json({
      ok: true,
      version: NINE_VERSION,
      symbol,
      timeframe,
      source: source === "CACHE" ? "validated-candle-cache" : "validated-provider-history",
      candlesUsed: candles.length,
      strategy: "NINE-TECHNICAL-SMC-V2.9",
      result,
      generatedAt: new Date().toISOString(),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Backtest failed.";
    const status =
      message === "UNAUTHENTICATED" ? 401
        : message === "CROSS_ORIGIN" ? 403
          : message.includes("TWELVE_DATA_API_KEY") ? 503
            : 503;

    return NextResponse.json(
      {
        ok: false,
        version: NINE_VERSION,
        error: message,
        code: message.includes("TWELVE_DATA_API_KEY") ? "MARKET_PROVIDER_UNAVAILABLE" : "BACKTEST_UNAVAILABLE",
      },
      { status },
    );
  }
}
