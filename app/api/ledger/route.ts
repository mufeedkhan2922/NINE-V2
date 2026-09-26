import { NextResponse } from "next/server";
import { getExecutionLedger } from "@/lib/trading/ledger";
import { getOrders } from "@/lib/trading/orders";
import { requireUser } from "@/lib/security/auth";

export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
) {
  try {
    requireUser(request);

    return NextResponse.json({
      ok: true,
      ledger: getExecutionLedger(200),
      orders: getOrders(200),
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
        error: "Ledger unavailable.",
      },
      { status: 500 },
    );
  }
}