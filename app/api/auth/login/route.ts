import { NextResponse } from "next/server";
import { login, sessionCookie } from "@/lib/security/auth";
import { assertSameOrigin } from "@/lib/security/requestSecurity";
import { rateLimit, requestKey } from "@/lib/security/rateLimit";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const limit = rateLimit(requestKey(request), 8, 60_000);
    if (!limit.allowed) return NextResponse.json({ ok: false, error: "Too many login attempts.", retryAfterSeconds: limit.retryAfterSeconds }, { status: 429 });
    const body = await request.json().catch(() => ({})) as { email?: unknown; password?: unknown };
    const email = typeof body.email === "string" ? body.email : "";
    const password = typeof body.password === "string" ? body.password : "";
    if (!email || !password) return NextResponse.json({ ok: false, error: "Email and password are required." }, { status: 400 });
    const result = login(email, password);
    if (!result) return NextResponse.json({ ok: false, error: "Invalid credentials." }, { status: 401 });
    const response = NextResponse.json({ ok: true, user: result.user });
    response.headers.set("Set-Cookie", sessionCookie(result.token));
    return response;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Login failed.";
    return NextResponse.json({ ok: false, error: message }, { status: message === "CROSS_ORIGIN" ? 403 : 500 });
  }
}
