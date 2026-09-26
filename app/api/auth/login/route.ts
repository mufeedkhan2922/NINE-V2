import { NextResponse } from "next/server";
import { login, sessionCookie } from "@/lib/security/auth";
export const dynamic = "force-dynamic";
export async function POST(request: Request) {
  const body = await request.json().catch(() => ({})) as { email?: unknown; password?: unknown };
  const email = typeof body.email === "string" ? body.email : "";
  const password = typeof body.password === "string" ? body.password : "";
  if (!email || !password) return NextResponse.json({ ok: false, error: "Email and password are required." }, { status: 400 });
  const result = login(email, password);
  if (!result) return NextResponse.json({ ok: false, error: "Invalid credentials." }, { status: 401 });
  const response = NextResponse.json({ ok: true, user: result.user });
  response.headers.set("Set-Cookie", sessionCookie(result.token));
  return response;
}
