import { NextResponse } from "next/server";
import { requireUser } from "@/lib/security/auth";
import { assertSameOrigin } from "@/lib/security/requestSecurity";
import { rateLimit, requestKey } from "@/lib/security/rateLimit";
import { NINE_VERSION } from "@/lib/trading/runtime";
import { runPaperValidation } from "@/lib/trading/paperValidation";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    assertSameOrigin(request);
    const user = requireUser(request);
    const limit = rateLimit(requestKey(request, user.id), 10, 60_000);
    if (!limit.allowed) {
      return NextResponse.json(
        { ok: false, version: NINE_VERSION, error: "Validation rate limit exceeded.", retryAfterSeconds: limit.retryAfterSeconds },
        { status: 429 },
      );
    }

    const report = runPaperValidation();

    return NextResponse.json({
      ok: report.status !== "BLOCKED",
      version: NINE_VERSION,
      report,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Paper validation failed.";
    const status =
      message === "UNAUTHENTICATED"
        ? 401
        : message === "CROSS_ORIGIN"
          ? 403
          : 503;

    return NextResponse.json(
      { ok: false, version: NINE_VERSION, error: message },
      { status },
    );
  }
}
