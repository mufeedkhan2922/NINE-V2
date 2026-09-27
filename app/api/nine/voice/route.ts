import { NextResponse } from "next/server";
import { requireUser } from "@/lib/security/auth";
import { assertSameOrigin } from "@/lib/security/requestSecurity";
import { rateLimit, requestKey } from "@/lib/security/rateLimit";
import { getLiveMarketSnapshot } from "@/lib/trading/market";
import { getPaperAccount } from "@/lib/trading/paperTrading";
import { orchestrateNINE } from "@/lib/trading/orchestrator";
import { buildAgentOrchestration, buildSpokenResponse, routeVoiceIntent } from "@/lib/trading/agentOrchestrator";
import { NINE_VERSION } from "@/lib/trading/runtime";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const user = requireUser(request);
    const limit = rateLimit(requestKey(request, user.id), 20, 60_000);
    if (!limit.allowed) return NextResponse.json({ ok: false, error: "Voice command rate limit exceeded.", retryAfterSeconds: limit.retryAfterSeconds }, { status: 429 });
    const body = (await request.json().catch(() => ({}))) as { transcript?: string; symbol?: string };
    const transcript = String(body.transcript ?? "").trim();
    const intent = routeVoiceIntent(transcript);
    const symbol = "XAUUSD" as const;
    if (intent.intent === "UNKNOWN") return NextResponse.json({ ok: true, version: NINE_VERSION, intent, response: "I did not map that voice request to a validated NINE command." });
    const market = await getLiveMarketSnapshot(symbol);
    const account = getPaperAccount(market.price);
    const orchestration = await orchestrateNINE(market, account);
    const agents = buildAgentOrchestration(market, orchestration.setup, orchestration.atlas, orchestration.sentinel);
    const response = buildSpokenResponse(intent.intent, agents);
    return NextResponse.json({ ok: true, version: NINE_VERSION, intent, response, agents, executionMode: "PAPER", liveTradingEnabled: false });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Voice command failed.";
    const status = message === "UNAUTHENTICATED" ? 401 : message === "CROSS_ORIGIN" ? 403 : 503;
    return NextResponse.json({ ok: false, version: NINE_VERSION, error: message }, { status });
  }
}