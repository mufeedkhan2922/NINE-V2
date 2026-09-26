import { NextResponse } from "next/server";
import { requireUser, requireAdmin } from "@/lib/security/auth";
import { getLiveMarketSnapshot } from "@/lib/trading/market";
import { orchestrateNINE } from "@/lib/trading/orchestrator";
import {
  executeBrokerOrder,
  executionRequestFromSetup,
} from "@/lib/trading/execution";
import { getPaperAccount } from "@/lib/trading/paperTrading";

export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
) {
  try {
    const user = requireUser(request);

    const body =
      (await request.json().catch(
        () => ({}),
      )) as {
        mode?: "LIVE" | "PAPER";
        quantity?: number;
      };

    const mode =
      body.mode === "LIVE"
        ? "LIVE"
        : "PAPER";

    if (mode === "LIVE" && user.role !== "ADMIN") {
      requireAdmin(request);
    }

    if (mode === "LIVE" && process.env.NINE_LIVE_TRADING_ENABLED !== "true") {
      return NextResponse.json({
        accepted: false,
        mode,
        status: "REJECTED",
        message: "Live trading is disabled by NINE safety configuration.",
        timestamp: Date.now(),
      }, { status: 403 });
    }

    const market =
      await getLiveMarketSnapshot(
        "XAUUSD",
      );

    const account =
      getPaperAccount(market.price);

    const orchestration =
      await orchestrateNINE(
        market,
        account,
      );

    const setup =
      orchestration.setup;

    if (!orchestration.sentinel.approved) {
      return NextResponse.json(
        {
          accepted: false,
          mode,
          status: "REJECTED",
          message: `Sentinel blocked execution: ${orchestration.sentinel.reason}`,
          timestamp: Date.now(),
          orchestration,
        },
        { status: 403 },
      );
    }

    const riskDollars =
      getSafeRiskCapital();

    const riskPerUnit =
      setup.entry !== null &&
      setup.stopLoss !== null
        ? Math.abs(
            setup.entry -
              setup.stopLoss,
          )
        : 0;

    const calculatedQuantity =
      riskPerUnit > 0
        ? Math.min(
            (riskDollars *
              (setup.risk.riskPercent /
                100)) /
              riskPerUnit,
            Number(
              process.env
                .NINE_LIVE_MAX_NOTIONAL_USD ??
                5_000,
            ) /
              (setup.entry ?? 1),
          )
        : 0;

    const requestedQuantity =
      typeof body.quantity === "number" &&
      Number.isFinite(body.quantity) &&
      body.quantity > 0
        ? Math.min(
            body.quantity,
            calculatedQuantity,
          )
        : calculatedQuantity;

    const executionRequest =
      executionRequestFromSetup(
        setup,
        requestedQuantity,
        mode,
        true,
      );

    if (!executionRequest) {
      return NextResponse.json(
        {
          accepted: false,
          mode,
          status: "REJECTED",
          message:
            "No executable setup is available.",
          timestamp: Date.now(),
        },
        { status: 403 },
      );
    }

    const result =
      await executeBrokerOrder(
        executionRequest,
      );

    return NextResponse.json({
      ...result,
      orchestration,
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
        accepted: false,
        mode: "LIVE",
        status: "REJECTED",
        message:
          error instanceof Error
            ? error.message
            : "Execution gateway error.",
        timestamp: Date.now(),
      },
      { status: 500 },
    );
  }
}

function getSafeRiskCapital(): number {
  const configured = Number(
    process.env.NINE_LIVE_RISK_CAPITAL_USD ??
      1_000,
  );

  return Number.isFinite(configured) &&
    configured > 0
    ? configured
    : 1_000;
}