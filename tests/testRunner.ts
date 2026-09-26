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

const tests: Array<[string, () => void | Promise<void>]> = [
  ["technical", runTechnicalTest],
  ["smc/chartist", runSmcTest],
  ["risk", runRiskTest],
  ["advanced risk", runAdvancedRiskTest],
  ["backtest", runBacktestTest],
  ["orders", runOrdersTests],
  ["paper orders", runPaperOrdersTests],
  ["sentinel", runSentinelTests],
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