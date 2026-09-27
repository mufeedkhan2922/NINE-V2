type Bucket = { count: number; resetAt: number };

const buckets = new Map<string, Bucket>();
const MAX_BUCKETS = 10_000;

function normalizeLimit(value: number): number {
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : 1;
}

function normalizeWindow(value: number): number {
  return Number.isFinite(value) && value >= 1_000 ? Math.floor(value) : 60_000;
}

function pruneExpired(now: number): void {
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt <= now) buckets.delete(key);
  }
}

function enforceBucketBound(now: number): void {
  if (buckets.size < MAX_BUCKETS) return;
  pruneExpired(now);
  if (buckets.size < MAX_BUCKETS) return;
  const oldest = buckets.keys().next().value as string | undefined;
  if (oldest) buckets.delete(oldest);
}

export function rateLimit(
  key: string,
  limit = 30,
  windowMs = 60_000,
): { allowed: boolean; remaining: number; retryAfterSeconds: number } {
  const now = Date.now();
  const safeLimit = normalizeLimit(limit);
  const safeWindow = normalizeWindow(windowMs);
  const normalizedKey = String(key).slice(0, 512);
  const current = buckets.get(normalizedKey);

  if (!current || current.resetAt <= now) {
    enforceBucketBound(now);
    buckets.set(normalizedKey, { count: 1, resetAt: now + safeWindow });
    return {
      allowed: true,
      remaining: Math.max(0, safeLimit - 1),
      retryAfterSeconds: Math.ceil(safeWindow / 1000),
    };
  }

  current.count += 1;
  const allowed = current.count <= safeLimit;
  return {
    allowed,
    remaining: Math.max(0, safeLimit - current.count),
    retryAfterSeconds: Math.max(1, Math.ceil((current.resetAt - now) / 1000)),
  };
}

export function requestKey(request: Request, userId?: string): string {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const safeUser = String(userId ?? "anon").slice(0, 128);
  const safeAddress = String(forwarded || "unknown").slice(0, 128);
  return `${safeUser}:${safeAddress}`;
}
