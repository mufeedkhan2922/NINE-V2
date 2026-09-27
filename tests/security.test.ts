import assert from "node:assert/strict";
import { rateLimit } from "../lib/security/rateLimit";

export function runSecurityTest(): void {
  const key = `test-${Date.now()}-${Math.random()}`;
  const first = rateLimit(key, 2, 60_000);
  const second = rateLimit(key, 2, 60_000);
  const third = rateLimit(key, 2, 60_000);
  assert.equal(first.allowed, true);
  assert.equal(second.allowed, true);
  assert.equal(third.allowed, false);
  assert.equal(third.remaining, 0);
}
