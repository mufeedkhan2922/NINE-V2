import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/security/auth";
import { assertSameOrigin } from "@/lib/security/requestSecurity";
import { rateLimit, requestKey } from "@/lib/security/rateLimit";
import { answerAssistant, getAssistantHistory } from "@/lib/assistant/nineAssistant";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  try {
    assertSameOrigin(request);
    const user = requireUser(request);
    const limit = rateLimit(requestKey(request, user.id), 60, 60_000);
    if (!limit.allowed) {
      return NextResponse.json(
        { ok: false, error: "Assistant rate limit exceeded.", retryAfterSeconds: limit.retryAfterSeconds },
        { status: 429 },
      );
    }
    const requested = Number(request.nextUrl.searchParams.get("limit") || 30);
    const historyLimit = Number.isFinite(requested) ? requested : 30;
    return NextResponse.json({
      ok: true,
      messages: getAssistantHistory(user.id, historyLimit),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Assistant authentication failed.";
    const status = message === "UNAUTHENTICATED" ? 401 : message === "CROSS_ORIGIN" ? 403 : 500;
    return NextResponse.json({ ok: false, error: message }, { status });
  }
}

export async function POST(request: NextRequest) {
  try {
    assertSameOrigin(request);
    const user = requireUser(request);
    const limit = rateLimit(requestKey(request, user.id), 30, 60_000);
    if (!limit.allowed) {
      return NextResponse.json(
        { ok: false, error: "Assistant rate limit exceeded.", retryAfterSeconds: limit.retryAfterSeconds },
        { status: 429 },
      );
    }

    const body = await request.json().catch(() => ({}));
    const message = typeof body?.message === "string" ? body.message.trim().slice(0, 1000) : "";
    if (!message) {
      return NextResponse.json({ ok: false, error: "message is required" }, { status: 400 });
    }

    return NextResponse.json(answerAssistant(message, user.id));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Assistant request failed.";
    const status =
      message === "UNAUTHENTICATED" ? 401 :
      message === "CROSS_ORIGIN" ? 403 :
      500;
    return NextResponse.json({ ok: false, error: message }, { status });
  }
}
