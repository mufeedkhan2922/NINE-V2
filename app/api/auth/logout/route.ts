import { NextResponse } from "next/server";
import { clearSessionCookie, logout } from "@/lib/security/auth";
export async function POST(request: Request) { logout(request); const response = NextResponse.json({ ok: true }); response.headers.set("Set-Cookie", clearSessionCookie()); return response; }
