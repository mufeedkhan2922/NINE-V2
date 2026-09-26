import { NextResponse } from "next/server";
import { requireUser } from "@/lib/security/auth";
import { getLiveMarketSnapshot } from "@/lib/trading/market";
import { orchestrateNINE } from "@/lib/trading/orchestrator";
import {
  closePaperPosition,
  executePaperSetup,
  getPaperAccount,
} from "@/lib/trading/paperTrading";
import { appendEvent, withStore } from "@/lib/trading/store";

export const dynamic = "force-dynamic";

function classify(
  text: string,
): "ANALYZE" | "OPEN_PAPER" | "CLOSE_ALL" | "UNKNOWN" {
  const value = text.toLowerCase().trim();

  if (
    value.includes("close all") ||
    value.includes("close positions") ||
    value.includes("exit all")
  ) {
    return "CLOSE_ALL";
  }

  if (
    value.includes("paper") &&
    (value.includes("buy") ||
      value.includes("sell") ||
      value.includes("trade") ||
      value.includes("long") ||
      value.includes("short") ||
      value.includes("execute"))
  ) {
    return "OPEN_PAPER";
  }

  if (
    value.includes("analy") ||
    value.includes("xau") ||
    value.includes("gold") ||
    value.includes("market")
  ) {
    return "ANALYZE";
  }

  return "UNKNOWN";
}

export async function POST(request: Request) {
  try {
    requireUser(request);

    const body = (await request.json().catch(() => ({}))) as {
      text?: unknown;
    };

    const text = typeof body.text === "string" ? body.text.trim() : "";

    if (!text) {
      return NextResponse.json(
        {
          ok: false,
          error: "Voice command text is required.",
        },
        { status: 400 },
      );
    }

    const action = classify(text);

    withStore((store) =>
      appendEvent(store, {
        type: "COMMAND",
        message: `Voice command: ${text}`,
        metadata: { action },
      }),
    );

    if (action === "UNKNOWN") {
      return NextResponse.json({
        ok: true,
        action,
        message:
          "Command not recognized. Try: analyze gold, paper trade, or close all positions.",
      });
    }

    const market = await getLiveMarketSnapshot("XAUUSD");
    const account = getPaperAccount(market.price);
    const orchestration = await orchestrateNINE(market, account);

    if (action === "ANALYZE") {
      return NextResponse.json({
        ok: true,
        action,
        message: orchestration.commandSummary,
        market,
        orchestration,
      });
    }

    if (action === "OPEN_PAPER") {
      const paperResult = executePaperSetup(orchestration, market);

      return NextResponse.json({
        ...paperResult,
        action,
        orchestration,
      });
    }

    const closeAccount = getPaperAccount(market.price);

    const openPositions = closeAccount.positions.filter(
      (position) => position.status === "OPEN",
    );

    const results = openPositions.map((position) =>
      closePaperPosition(position.id, market.price),
    );

    return NextResponse.json({
      ok: true,
      action,
      message: results.length
        ? `${results.length} paper position(s) closed.`
        : "No open paper positions.",
      results,
      account: getPaperAccount(market.price),
    });
  } catch (error) {
    if (
      error instanceof Error &&
      error.message === "UNAUTHENTICATED"
    ) {
      return NextResponse.json(
        {
          ok: false,
          error: "Authentication required.",
        },
        { status: 401 },
      );
    }

    return NextResponse.json(
      {
        ok: false,
        error:
          error instanceof Error
            ? error.message
            : "Command execution failed.",
      },
      { status: 500 },
    );
  }
}