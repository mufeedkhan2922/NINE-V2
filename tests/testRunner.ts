import { runTechnicalTest } from "./technical.test";
import { runSmcTest } from "./smc.test";
import { runRiskTest, runAdvancedRiskTest } from "./risk.test";
import { runBacktestTest } from "./backtest.test";

const tests: Array<[string, () => void]> = [
  ["technical", runTechnicalTest],
  ["smc/chartist", runSmcTest],
  ["risk", runRiskTest],
  ["advanced risk", runAdvancedRiskTest],
  ["backtest", runBacktestTest],
];
let failed = 0;
for (const [name, fn] of tests) { try { fn(); console.log(`PASS ${name}`); } catch (error) { failed += 1; console.error(`FAIL ${name}:`, error); } }
if (failed) (globalThis as any).process.exit(1);
console.log(`NINE test suite: ${tests.length} passed.`);
