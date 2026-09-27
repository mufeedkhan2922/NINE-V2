import { NextResponse } from "next/server";
import { getLiveMarketSnapshot } from "@/lib/trading/market";
import { orchestrateNINE } from "@/lib/trading/orchestrator";
import { buildDecisionExplanation } from "@/lib/trading/v210";
import { getPaperAccount } from "@/lib/trading/paperTrading";
import { runtimeDiagnostics, NINE_VERSION } from "@/lib/trading/runtime";
import type { MarketSymbol } from "@/lib/trading/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const SYMBOLS: MarketSymbol[] = ["XAUUSD", "NIFTY", "BANKNIFTY"];

export async function GET(request: Request) {
  const raw = new URL(request.url).searchParams.get("symbol")?.toUpperCase();
  const symbol = SYMBOLS.includes(raw as MarketSymbol) ? raw as MarketSymbol : "XAUUSD";
  try {
    const market = await getLiveMarketSnapshot(symbol);
    const account = getPaperAccount(market.price);
    const orchestration = await orchestrateNINE(market, account);
    const explanation = buildDecisionExplanation(orchestration);
    return NextResponse.json({
      ok: true,
      version: NINE_VERSION,
      symbol,
      explanation,
      market: {
        state: market.marketState,
        tradingAllowed: market.tradingAllowed,
        crossTimeframe: market.crossTimeframeValidation,
        microstructure: market.microstructureValidation,
        providerErrors: market.providerErrors,
      },
      runtime: runtimeDiagnostics(),
      generatedAt: new Date().toISOString(),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Diagnostics failed.";
    return NextResponse.json({
      ok: false,
      version: NINE_VERSION,
      symbol,
      explanation: {
        decision: "BLOCKED",
        headline: `NINE is blocked: ${message}`,
        confidence: 0,
        blockers: [{ code: "DIAGNOSTICS_FAILURE", severity: "BLOCK", title: "Diagnostics failure", detail: message, source: "RUNTIME" }],
        warnings: [],
        evidence: [],
        market: { state: "UNKNOWN", dataState: "UNKNOWN", tradingPermission: "BLOCKED", reasons: [message], warnings: [] },
        crossTimeframe: { score: null, valid: false, issues: [message], warnings: [] },
        atlas: { status: "UNAVAILABLE", bias: "NEUTRAL", relevance: "UNAVAILABLE", impact: "No Atlas claim is made because diagnostics could not obtain a validated snapshot.", supportingHeadlines: [], events: 0, errors: [message] },
        sentinel: { approved: false, reason: message, blockers: [message], checksPassed: 0, checksTotal: 0 },
        paper: { allowed: false, reason: "Paper execution is blocked because diagnostics failed.", mode: "PAPER" },
      },
      runtime: runtimeDiagnostics(),
    }, { status: 503 });
  }
}
