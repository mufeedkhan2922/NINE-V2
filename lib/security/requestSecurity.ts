export function assertSameOrigin(request: Request): void {
  const origin = request.headers.get("origin");
  if (!origin) return;
  const host = request.headers.get("host");
  if (!host) return;
  try {
    const parsed = new URL(origin);
    if (parsed.host !== host) throw new Error("CROSS_ORIGIN");
  } catch {
    throw new Error("CROSS_ORIGIN");
  }
}

export function clientAddress(request: Request): string {
  return request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
}
