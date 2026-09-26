import { NextResponse } from "next/server";
import { db } from "@/lib/trading/db";
export const dynamic = "force-dynamic";
export async function GET() {
  try {
    const row = db.prepare("SELECT 1 AS ok").get() as any;
    return NextResponse.json({ ok: row?.ok === 1, service: "NINE", version: "2.2", db: "sqlite", liveTradingEnabled: process.env.NINE_LIVE_TRADING_ENABLED === "true", timestamp: new Date().toISOString() });
  } catch { return NextResponse.json({ ok: false, service: "NINE", timestamp: new Date().toISOString() }, { status: 503 }); }
}
