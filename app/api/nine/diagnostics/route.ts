import { NextResponse } from "next/server";
import { getLiveMarketSnapshot } from "@/lib/trading/market";
import { orchestrateNINE } from "@/lib/trading/orchestrator";
import { providerDiagnostics, runtimeSafety, NINE_VERSION } from "@/lib/trading/runtime";
import { getPaperAccount } from "@/lib/trading/paperTrading";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  try {
    const market = await getLiveMarketSnapshot("XAUUSD");
    const account = getPaperAccount(market.price);
    const orchestration = await orchestrateNINE(market, account);
    return NextResponse.json({
      ok: true,
      version: NINE_VERSION,
      runtime: runtimeSafety(),
      provider: providerDiagnostics("XAUUSD", {
        lastCandleAt: market.timeframes?.["1min"]?.candles.at(-1)?.time ?? null,
        lastQuoteAt: market.timestamp,
        status: market.providerError ? "DEGRADED" : "HEALTHY",
        error: market.providerError ?? null,
      }),
      marketState: market.marketState,
      dataQuality: market.dataQuality,
      crossTimeframe: market.crossTimeframeValidation,
      microstructure: market.microstructureValidation,
      engine: orchestration.setup.validation,
      sentinel: orchestration.sentinel,
      decision: orchestration.decision,
      atlas: orchestration.atlas,
      generatedAt: Date.now(),
    });
  } catch (error) {
    return NextResponse.json({
      ok: false,
      version: NINE_VERSION,
      runtime: runtimeSafety(),
      provider: providerDiagnostics("XAUUSD", { status: process.env.TWELVE_DATA_API_KEY ? "DEGRADED" : "OFFLINE", error: error instanceof Error ? error.message : "Diagnostics failed." }),
      error: error instanceof Error ? error.message : "Diagnostics failed.",
      generatedAt: Date.now(),
    }, { status: 503 });
  }
}