import { NextRequest, NextResponse } from "next/server";
import { answerAssistant, getAssistantHistory } from "@/lib/assistant/nineAssistant";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const session = request.nextUrl.searchParams.get("session") || "default";
  const limit = Number(request.nextUrl.searchParams.get("limit") || 30);
  return NextResponse.json({ ok: true, messages: getAssistantHistory(session, limit) });
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const message = typeof body?.message === "string" ? body.message : "";
    const session = typeof body?.session === "string" && body.session.trim() ? body.session.trim() : "default";

    if (!message.trim()) {
      return NextResponse.json({ ok: false, error: "message is required" }, { status: 400 });
    }

    return NextResponse.json(answerAssistant(message, session));
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Assistant request failed." },
      { status: 500 },
    );
  }
}
