import { runTechnicalTest } from "./technical.test";
import { runSmcTest } from "./smc.test";
import {
  runRiskTest,
  runAdvancedRiskTest,
} from "./risk.test";
import { runBacktestTest } from "./backtest.test";
import { runOrdersTests } from "./orders.test";
import { runPaperOrdersTests } from "./paperOrders.test";
import { runSentinelTests } from "./sentinel.test";
import { runRuntimeTest } from "./runtime.test";
import { runSecurityTest } from "./security.test";
import { runV26Test } from "./v26.test";
import { runV27Test } from "./v27.test";

const tests: Array<[string, () => void | Promise<void>]> = [
  ["technical", runTechnicalTest],
  ["smc/chartist", runSmcTest],
  ["risk", runRiskTest],
  ["advanced risk", runAdvancedRiskTest],
  ["backtest", runBacktestTest],
  ["orders", runOrdersTests],
  ["paper orders", runPaperOrdersTests],
  ["sentinel", runSentinelTests],
  ["runtime safety", runRuntimeTest],
  ["security", runSecurityTest],
  ["v2.6 intelligence", runV26Test],
  ["v2.7 command center", runV27Test],
];

async function main(): Promise<void> {
  let failed = 0;

  for (const [name, fn] of tests) {
    try {
      await fn();
      console.log(`PASS ${name}`);
    } catch (error) {
      failed += 1;
      console.error(`FAIL ${name}:`, error);
    }
  }

  if (failed) {
    (globalThis as any).process.exit(1);
  }

  console.log(`NINE test suite: ${tests.length} passed.`);
}

void main();