import { NextResponse } from "next/server";
import { getLiveMarketSnapshot } from "@/lib/trading/market";
import { orchestrateNINE } from "@/lib/trading/orchestrator";
import { runXAUAutonomousPaperLoop } from "@/lib/trading/paperLoop";
import { getPaperAccount } from "@/lib/trading/paperTrading";
import { runtimeSafety, NINE_VERSION } from "@/lib/trading/runtime";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function authorized(request: Request): boolean {
  const secret = process.env.NINE_CRON_SECRET?.trim();
  if (!secret) return false;
  const header = request.headers.get("authorization") ?? "";
  return header === `Bearer ${secret}`;
}

async function notifyTelegram(message: string): Promise<void> {
  const token = process.env.TELEGRAM_BOT_TOKEN?.trim();
  const chatId = process.env.TELEGRAM_CHAT_ID?.trim();
  if (!token || !chatId) return;

  const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text: message, disable_web_page_preview: true }),
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error("Telegram notification failed.");
  }
}

export async function GET(request: Request) {
  if (!authorized(request)) {
    return NextResponse.json({ ok: false, error: "UNAUTHORIZED" }, { status: 401 });
  }

  const startedAt = Date.now();

  try {
    const market = await getLiveMarketSnapshot("XAUUSD");
    const account = getPaperAccount(market.price);
    const orchestration = await orchestrateNINE(market, account);
    const paperLoop = runXAUAutonomousPaperLoop(market, orchestration);

    const transitioned = paperLoop.transition.from !== paperLoop.state;

    if (transitioned && paperLoop.state === "ENTERED" && paperLoop.entry.opened) {
      await notifyTelegram(
        [
          "NINE XAUUSD PAPER ENTRY",
          `Direction: ${orchestration.setup.direction}`,
          `Entry: ${orchestration.setup.entry ?? "—"}`,
          `SL: ${orchestration.setup.stopLoss ?? "—"}`,
          `TP: ${orchestration.setup.takeProfit ?? "—"}`,
          `Sentinel: ${orchestration.sentinel.approved ? "APPROVED" : "BLOCKED"}`,
        ].join("\n"),
      );
    }

    if (transitioned && paperLoop.state === "CLOSED") {
      await notifyTelegram("NINE XAUUSD PAPER POSITION CLOSED");
    }

    return NextResponse.json({
      ok: true,
      service: "NINE_CRON",
      version: NINE_VERSION,
      symbol: "XAUUSD",
      state: paperLoop.state,
      lifecycle: paperLoop.lifecycle,
      setupId: paperLoop.setupId,
      positionId: paperLoop.positionId,
      sentinelApproved: orchestration.sentinel.approved,
      marketData: market.feedStatus ?? "UNKNOWN",
      durationMs: Date.now() - startedAt,
      safety: runtimeSafety(),
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        service: "NINE_CRON",
        error: error instanceof Error ? error.message : "Heartbeat failed.",
        durationMs: Date.now() - startedAt,
        timestamp: new Date().toISOString(),
      },
      { status: 503 },
    );
  }
}
