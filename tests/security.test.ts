import assert from "node:assert/strict";
import { rateLimit, requestKey } from "../lib/security/rateLimit";
import { assertSameOrigin } from "../lib/security/requestSecurity";

export function runSecurityTest(): void {
  const key = `test-${Date.now()}-${Math.random()}`;
  assert.equal(rateLimit(key, 2, 60_000).allowed, true);
  assert.equal(rateLimit(key, 2, 60_000).allowed, true);
  const third = rateLimit(key, 2, 60_000);
  assert.equal(third.allowed, false);
  assert.equal(third.remaining, 0);

  const boundedKey = `bounded-${Date.now()}-${Math.random()}`;
  assert.equal(rateLimit(boundedKey, 0, 1).allowed, true);
  assert.equal(rateLimit(boundedKey, 1, 60_000).allowed, false);

  const request = new Request("https://nine.local/api/test", {
    headers: { host: "nine.local", origin: "https://nine.local", "x-forwarded-for": "203.0.113.10, proxy" },
  });
  assert.doesNotThrow(() => assertSameOrigin(request));
  assert.equal(requestKey(request, "USR-1"), "USR-1:203.0.113.10");

  const crossOrigin = new Request("https://nine.local/api/test", {
    headers: { host: "nine.local", origin: "https://evil.example" },
  });
  assert.throws(() => assertSameOrigin(crossOrigin), /CROSS_ORIGIN/);

  const noOrigin = new Request("https://nine.local/api/test", { headers: { host: "nine.local" } });
  assert.doesNotThrow(() => assertSameOrigin(noOrigin));

  for (let index = 0; index < 12_000; index += 1) {
    assert.equal(rateLimit(`load-${Date.now()}-${index}`, 1, 60_000).allowed, true);
  }
}
