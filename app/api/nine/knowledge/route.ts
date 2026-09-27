import { NextResponse } from "next/server";
import { requireUser } from "@/lib/security/auth";
import { assertSameOrigin } from "@/lib/security/requestSecurity";
import { NINE_CONCEPTS, NINE_STRATEGIES } from "@/lib/trading/strategyLibrary";
import { NINE_VERSION } from "@/lib/trading/runtime";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    assertSameOrigin(request);
    requireUser(request);
    return NextResponse.json({
      ok: true,
      version: NINE_VERSION,
      knowledge: {
        concepts: NINE_CONCEPTS,
        strategies: NINE_STRATEGIES,
        conceptCount: NINE_CONCEPTS.length,
        strategyCount: NINE_STRATEGIES.length,
      },
      generatedAt: new Date().toISOString(),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Knowledge request failed.";
    const status = message === "UNAUTHENTICATED" ? 401 : message === "CROSS_ORIGIN" ? 403 : 500;
    return NextResponse.json({ ok: false, version: NINE_VERSION, error: message }, { status });
  }
}
