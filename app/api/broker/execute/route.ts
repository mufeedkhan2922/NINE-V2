import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/security/auth";
import { assertSameOrigin } from "@/lib/security/requestSecurity";
import { rateLimit, requestKey } from "@/lib/security/rateLimit";
import { getLiveMarketSnapshot } from "@/lib/trading/market";
import { orchestrateNINE } from "@/lib/trading/orchestrator";
import { executeBrokerOrder, executionRequestFromSetup } from "@/lib/trading/execution";
import { getPaperAccount } from "@/lib/trading/paperTrading";
import { liveTradingEnabled } from "@/lib/trading/runtime";
import type { MarketSymbol } from "@/lib/trading/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const user = requireAdmin(request);
    const limit = rateLimit(requestKey(request, user.id), 10, 60_000);
    if (!limit.allowed) return NextResponse.json({ ok: false, error: "Execution rate limit exceeded.", retryAfterSeconds: limit.retryAfterSeconds }, { status: 429 });

    const body = await request.json().catch(() => ({})) as { mode?: "LIVE" | "PAPER"; quantity?: number; symbol?: unknown };
    const requestedSymbol = typeof body.symbol === "string" ? body.symbol.toUpperCase() : "XAUUSD";
    const symbol: MarketSymbol = requestedSymbol === "NIFTY" || requestedSymbol === "BANKNIFTY" || requestedSymbol === "XAUUSD"
      ? requestedSymbol
      : "XAUUSD";
    const mode = body.mode === "LIVE" ? "LIVE" : "PAPER";
    if (mode === "LIVE" && !liveTradingEnabled()) {
      return NextResponse.json({ accepted: false, mode, status: "REJECTED", message: "Live trading is hard-locked. Explicit confirmation and broker configuration are required.", timestamp: Date.now() }, { status: 403 });
    }

    const market = await getLiveMarketSnapshot(symbol);
    const account = getPaperAccount(market.price);
    const orchestration = await orchestrateNINE(market, account);
    if (!orchestration.sentinel.approved) return NextResponse.json({ accepted: false, mode, status: "REJECTED", message: `Sentinel blocked execution: ${orchestration.sentinel.reason}`, timestamp: Date.now(), orchestration }, { status: 403 });

    const riskCapital = Math.max(1, Number(process.env.NINE_LIVE_RISK_CAPITAL_USD ?? 1000));
    const riskPerUnit = orchestration.setup.entry !== null && orchestration.setup.stopLoss !== null ? Math.abs(orchestration.setup.entry - orchestration.setup.stopLoss) : 0;
    const calculatedQuantity = riskPerUnit > 0 ? Math.min((riskCapital * (orchestration.setup.risk.riskPercent / 100)) / riskPerUnit, Number(process.env.NINE_LIVE_MAX_NOTIONAL_USD ?? 5000) / (orchestration.setup.entry ?? 1)) : 0;
    const quantity = typeof body.quantity === "number" && Number.isFinite(body.quantity) && body.quantity > 0 ? Math.min(body.quantity, calculatedQuantity) : calculatedQuantity;
    const executionRequest = executionRequestFromSetup(orchestration.setup, quantity, mode, true);
    if (!executionRequest) return NextResponse.json({ accepted: false, mode, status: "REJECTED", message: "No executable setup is available.", timestamp: Date.now() }, { status: 403 });
    return NextResponse.json({ ...(await executeBrokerOrder(executionRequest)), orchestration });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Execution gateway error.";
    const status = message === "UNAUTHENTICATED" ? 401 : message === "FORBIDDEN" ? 403 : message === "CROSS_ORIGIN" ? 403 : 500;
    return NextResponse.json({ accepted: false, mode: "LIVE", status: "REJECTED", message, timestamp: Date.now() }, { status });
  }
}
