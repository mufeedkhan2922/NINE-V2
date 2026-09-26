import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/security/auth";
export const dynamic = "force-dynamic";
export async function GET(request: Request) { const user = getCurrentUser(request); return NextResponse.json({ authenticated: Boolean(user), user }); }
