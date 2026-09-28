import { NextResponse } from "next/server";
import { requireUser } from "@/lib/security/auth";
import { assertSameOrigin } from "@/lib/security/requestSecurity";
import { rateLimit, requestKey } from "@/lib/security/rateLimit";
import { getLiveMarketSnapshot } from "@/lib/trading/market";
import { orchestrateNINE } from "@/lib/trading/orchestrator";
import { closePaperPosition, executePaperSetup, getPaperAccount } from "@/lib/trading/paperTrading";
import { appendEvent, withStore } from "@/lib/trading/store";
import { recordAudit } from "@/lib/trading/observability";
import type { MarketSymbol } from "@/lib/trading/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { classifyCommand } from "@/lib/trading/commands";

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const user = requireUser(request);
    const limit = rateLimit(requestKey(request, user.id), 30, 60_000);
    if (!limit.allowed) return NextResponse.json({ ok: false, error: "Command rate limit exceeded.", retryAfterSeconds: limit.retryAfterSeconds }, { status: 429 });
    const body = await request.json().catch(() => ({})) as { text?: unknown; symbol?: unknown };
    const text = typeof body.text === "string" ? body.text.trim().slice(0, 500) : "";
    const requestedSymbol = typeof body.symbol === "string" ? body.symbol.toUpperCase() : "XAUUSD";
    const symbol: MarketSymbol = requestedSymbol === "NIFTY" || requestedSymbol === "BANKNIFTY" || requestedSymbol === "XAUUSD"
      ? requestedSymbol
      : "XAUUSD";
    if (!text) return NextResponse.json({ ok: false, error: "Voice command text is required." }, { status: 400 });
    const action = classifyCommand(text);
    withStore((store) => appendEvent(store, { type: "COMMAND", message: `Command: ${text}`, metadata: { action, userId: user.id } }));
    recordAudit("INFO", "COMMAND_RECEIVED", { userId: user.id, action, symbol });

    if (action === "UNKNOWN") return NextResponse.json({ ok: true, action, symbol, message: "Command not recognized. Try: analyze gold, analyze current setup, paper trade, or close all positions." });

    const market = await getLiveMarketSnapshot(symbol);
    const account = getPaperAccount(market.price);
    const orchestration = await orchestrateNINE(market, account);
    if (action === "ANALYZE") return NextResponse.json({ ok: true, action, message: orchestration.commandSummary, market, orchestration });
    if (action === "OPEN_PAPER") return NextResponse.json({ ...(executePaperSetup(orchestration, market)), action, orchestration });

    if (!orchestration.sentinel.approved) {
      return NextResponse.json({
        ok: false,
        action,
        symbol,
        message: `Close-all blocked by Sentinel: ${orchestration.sentinel.reason}`,
        sentinel: orchestration.sentinel,
        account: getPaperAccount(market.price),
      });
    }

    const open = getPaperAccount(market.price).positions.filter((p) => p.status === "OPEN");
    const results = open.map((p) => closePaperPosition(p.id, market.price));
    return NextResponse.json({
      ok: true,
      action,
      symbol,
      message: results.length ? `${results.length} paper position(s) closed.` : "No open paper positions.",
      results,
      sentinel: orchestration.sentinel,
      account: getPaperAccount(market.price),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Command execution failed.";
    const status = message === "UNAUTHENTICATED" ? 401 : message === "CROSS_ORIGIN" ? 403 : 500;
    return NextResponse.json({ ok: false, error: message }, { status });
  }
}
