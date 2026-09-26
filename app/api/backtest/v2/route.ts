import { NextResponse } from "next/server";
import { requireUser } from "@/lib/security/auth";
import { assertSameOrigin } from "@/lib/security/requestSecurity";
import { rateLimit, requestKey } from "@/lib/security/rateLimit";
import { getLiveMarketSnapshot } from "@/lib/trading/market";
import { runBacktestV26 } from "@/lib/trading/v26";
import type { MarketSymbol } from "@/lib/trading/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const SYMBOLS: MarketSymbol[] = ["XAUUSD", "NIFTY", "BANKNIFTY"];

export async function GET(request: Request) {
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

    const url = new URL(request.url);
    const rawSymbol = url.searchParams.get("symbol")?.toUpperCase();
    const symbol = SYMBOLS.includes(rawSymbol as MarketSymbol)
      ? (rawSymbol as MarketSymbol)
      : "XAUUSD";

    const initialBalance = Math.max(
      100,
      Number(url.searchParams.get("initialBalance") ?? 10000),
    );
    const riskPercent = Math.min(
      2,
      Math.max(
        0.1,
        Number(url.searchParams.get("riskPercent") ?? 0.5),
      ),
    );

    const market = await getLiveMarketSnapshot(symbol);
    const candles = market.timeframes?.["1min"]?.candles ?? [];
    const result = runBacktestV26(
      candles,
      initialBalance,
      riskPercent,
    );

    return NextResponse.json({
      ok: true,
      version: "2.7",
      symbol,
      source: "validated-live-candle-cache",
      result,
      generatedAt: new Date().toISOString(),
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Backtest failed.";
    const status =
      message === "UNAUTHENTICATED"
        ? 401
        : message === "CROSS_ORIGIN"
          ? 403
          : 503;

    return NextResponse.json(
      {
        ok: false,
        version: "2.7",
        error: message,
      },
      { status },
    );
  }
}
