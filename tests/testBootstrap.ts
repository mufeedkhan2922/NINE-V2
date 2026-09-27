import { rmSync, mkdirSync } from "node:fs";
import { join } from "node:path";

/**
 * Test-process bootstrap.
 *
 * The application database is deliberately isolated from the test database.
 * Every `npm test` run starts from a fresh SQLite file so persisted production
 * state, WAL files, or a malformed local database can never contaminate tests.
 */
const testDataDir = join(process.cwd(), ".nine-test-data");
const testDbPath = join(testDataDir, "nine.db");

rmSync(testDataDir, { recursive: true, force: true });
mkdirSync(testDataDir, { recursive: true });

process.env.NINE_DB_PATH = testDbPath;

void import("./testRunner").catch((error) => {
  console.error("NINE test bootstrap failed:", error);
  process.exitCode = 1;
});
