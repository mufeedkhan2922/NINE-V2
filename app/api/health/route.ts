import { NextResponse } from "next/server";
import { db } from "@/lib/trading/db";
import { NINE_VERSION } from "@/lib/trading/runtime";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  try {
    const row = db.prepare("SELECT 1 AS ok").get() as { ok?: number };
    const safety = runtimeSafety();

    return NextResponse.json({
      ok: row?.ok === 1,
      service: "NINE",
      version: NINE_VERSION,
      db: "sqlite",
      timestamp: new Date().toISOString(),
    });
  } catch {
    return NextResponse.json(
      {
        ok: false,
        service: "NINE",
        version: NINE_VERSION,
        timestamp: new Date().toISOString(),
      },
      { status: 503 },
    );
  }
}
