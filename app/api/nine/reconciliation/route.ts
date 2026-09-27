import { NextResponse } from "next/server";
import { requireUser } from "@/lib/security/auth";
import { assertSameOrigin } from "@/lib/security/requestSecurity";
import { rateLimit, requestKey } from "@/lib/security/rateLimit";
import { reconcilePaperState } from "@/lib/trading/paperReconciliation";
import { NINE_VERSION } from "@/lib/trading/runtime";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    assertSameOrigin(request);
    const user = requireUser(request);
    const limit = rateLimit(requestKey(request, user.id), 20, 60_000);
    if (!limit.allowed) {
      return NextResponse.json(
        { ok: false, error: "Reconciliation rate limit exceeded." },
        { status: 429 },
      );
    }

    return NextResponse.json({
      ok: true,
      version: NINE_VERSION,
      reconciliation: reconcilePaperState(),
      generatedAt: new Date().toISOString(),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Paper reconciliation failed.";
    const status =
      message === "UNAUTHENTICATED" ? 401 :
      message === "CROSS_ORIGIN" ? 403 : 400;

    return NextResponse.json(
      { ok: false, version: NINE_VERSION, error: message },
      { status },
    );
  }
}
