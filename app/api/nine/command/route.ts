import { NextResponse } from "next/server";
import { requireUser } from "@/lib/security/auth";
import { assertSameOrigin } from "@/lib/security/requestSecurity";
import { rateLimit, requestKey } from "@/lib/security/rateLimit";
import { getLiveMarketSnapshot } from "@/lib/trading/market";
import { orchestrateNINE } from "@/lib/trading/orchestrator";
import { closePaperPosition, executePaperSetup, getPaperAccount } from "@/lib/trading/paperTrading";
import { appendEvent, withStore } from "@/lib/trading/store";
import { recordAudit } from "@/lib/trading/observability";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function classify(text: string): "ANALYZE" | "OPEN_PAPER" | "CLOSE_ALL" | "UNKNOWN" {
  const value = text.toLowerCase().trim();
  if (value.includes("close all") || value.includes("close positions") || value.includes("exit all")) return "CLOSE_ALL";
  if ((value.includes("paper") || value.includes("simulate")) && (value.includes("buy") || value.includes("sell") || value.includes("trade") || value.includes("long") || value.includes("short") || value.includes("execute"))) return "OPEN_PAPER";
  if (value.includes("analy") || value.includes("xau") || value.includes("gold") || value.includes("market") || value.includes("status")) return "ANALYZE";
  return "UNKNOWN";
}

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const user = requireUser(request);
    const limit = rateLimit(requestKey(request, user.id), 30, 60_000);
    if (!limit.allowed) return NextResponse.json({ ok: false, error: "Command rate limit exceeded.", retryAfterSeconds: limit.retryAfterSeconds }, { status: 429 });
    const body = await request.json().catch(() => ({})) as { text?: unknown };
    const text = typeof body.text === "string" ? body.text.trim().slice(0, 500) : "";
    if (!text) return NextResponse.json({ ok: false, error: "Voice command text is required." }, { status: 400 });
    const action = classify(text);
    withStore((store) => appendEvent(store, { type: "COMMAND", message: `Command: ${text}`, metadata: { action, userId: user.id } }));
    recordAudit("INFO", "COMMAND_RECEIVED", { userId: user.id, action });

    if (action === "UNKNOWN") return NextResponse.json({ ok: true, action, message: "Command not recognized. Try: analyze gold, paper trade XAUUSD, or close all positions." });

    const market = await getLiveMarketSnapshot("XAUUSD");
    const account = getPaperAccount(market.price);
    const orchestration = await orchestrateNINE(market, account);
    if (action === "ANALYZE") return NextResponse.json({ ok: true, action, message: orchestration.commandSummary, market, orchestration });
    if (action === "OPEN_PAPER") return NextResponse.json({ ...(executePaperSetup(orchestration, market)), action, orchestration });

    const open = getPaperAccount(market.price).positions.filter((p) => p.status === "OPEN");
    const results = open.map((p) => closePaperPosition(p.id, market.price));
    return NextResponse.json({ ok: true, action, message: results.length ? `${results.length} paper position(s) closed.` : "No open paper positions.", results, account: getPaperAccount(market.price) });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Command execution failed.";
    const status = message === "UNAUTHENTICATED" ? 401 : message === "CROSS_ORIGIN" ? 403 : 500;
    return NextResponse.json({ ok: false, error: message }, { status });
  }
}
