import { NextResponse } from "next/server";
import { clearSessionCookie, logout } from "@/lib/security/auth";
import { assertSameOrigin } from "@/lib/security/requestSecurity";

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    logout(request);
    const response = NextResponse.json({ ok: true });
    response.headers.set("Set-Cookie", clearSessionCookie());
    return response;
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Logout failed." }, { status: 403 });
  }
}
