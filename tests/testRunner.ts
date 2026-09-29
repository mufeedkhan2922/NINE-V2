import { runTechnicalTest } from "./technical.test";
import { runSmcTest } from "./smc.test";
import { runRiskTest, runAdvancedRiskTest } from "./risk.test";
import { runBacktestTest } from "./backtest.test";
import { runOrdersTests } from "./orders.test";
import { runPaperOrdersTests } from "./paperOrders.test";
import { runPaperReconciliationTests } from "./paperReconciliation.test";
import { runCoreSafetyTests } from "./coreSafety.test";
import { runSentinelTests } from "./sentinel.test";
import { runRuntimeTest } from "./runtime.test";
import { runSecurityTest } from "./security.test";
import { runV26Test } from "./v26.test";
import { runV27Test } from "./v27.test";
import { runV29Test } from "./v29.test";
import { runV291Test } from "./v291.test";
import { runV210Test } from "./v210.test";
import { runHistoricalTest } from "./historical.test";
import { runProviderContractTest } from "./provider.test";
import { runStrategyIntelligenceTest } from "./strategyIntelligence.test";
import { runAdaptiveLearningTest } from "./adaptiveLearning.test";
import { runStrategyLabTest } from "./strategyLab.test";
import { runHistoricalIntelligenceTest } from "./historicalIntelligence.test";
import { runResearchMatrixTest } from "./researchMatrix.test";
import { runAgentOrchestrationTest } from "./agentOrchestration.test";
import { runPaperValidationTest } from "./paperValidation.test";
import { runXAUDecisionEngineTest } from "./xauDecisionEngine.test";
import { runPaperLoopTest } from "./paperLoop.test";
import { runPaperTelemetryTest } from "./paperTelemetry.test";
import { runV5IntelligenceTest } from "./v5Intelligence.test";
import { runRegimeEngineTest } from "./regimeEngine.test";
import { runKronosForecastTest } from "./kronosForecast.test";
import { buildKronosCalibrationReport } from "../lib/trading/kronosCalibration";
import { runKronosCalibrationStoreTest } from "./kronosCalibrationStore.test";
import { runNineAssistantTest } from "./nineAssistant.test";
import { runGeminiProviderTest } from "./geminiProvider.test";
import { runAdaptiveLossFilterTest } from "./adaptiveLossFilter.test";
import { runLossInvestigatorTest } from "./lossInvestigator.test";
import { runClosedLoopLearningTest } from "./closedLoopLearning.test";

const tests: Array<[string, () => void | Promise<void>]> = [
  ["technical", runTechnicalTest],
  ["smc/chartist", runSmcTest],
  ["risk", runRiskTest],
  ["advanced risk", runAdvancedRiskTest],
  ["backtest", runBacktestTest],
  ["orders", runOrdersTests],
  ["paper orders", runPaperOrdersTests],
  ["paper reconciliation", runPaperReconciliationTests],
  ["core safety", runCoreSafetyTests],
  ["sentinel", runSentinelTests],
  ["runtime safety", runRuntimeTest],
  ["security", runSecurityTest],
  ["v2.6 intelligence", runV26Test],
  ["v2.7 command center", runV27Test],
  ["v2.9 full functionality", runV29Test],
  ["v2.9.1 provider reliability", runV291Test],
  ["v2.10 analytics and explanations", runV210Test],
  ["historical backtest", runHistoricalTest],
  ["provider contract", runProviderContractTest],
  ["strategy intelligence", runStrategyIntelligenceTest],
  ["adaptive learning", runAdaptiveLearningTest],
  ["strategy lab", runStrategyLabTest],
  ["historical intelligence", runHistoricalIntelligenceTest],
  ["research matrix", runResearchMatrixTest],
  ["agent orchestration", runAgentOrchestrationTest],
  ["final paper validation", runPaperValidationTest],
  ["XAUUSD decision engine", runXAUDecisionEngineTest],
  ["autonomous paper loop", runPaperLoopTest],
  ["paper telemetry", runPaperTelemetryTest],
  ["v5 intelligence", runV5IntelligenceTest],
  ["v5.5 regime engine", runRegimeEngineTest],
  ["v5.7 Kronos intelligence", runKronosForecastTest],
  ["Kronos calibration ledger", runKronosCalibrationStoreTest],
  ["Kronos calibration baseline", () => {
    const report = buildKronosCalibrationReport([]);
    if (report.state !== "NOT_CALIBRATED" || report.sampleCount !== 0) {
      throw new Error("Kronos calibration baseline failed");
    }
  }],
  ["NINE personal assistant", runNineAssistantTest],
  ["Gemini assistant provider", runGeminiProviderTest],
  ["statistical loss filter", runAdaptiveLossFilterTest],
  ["loss investigation memory", runLossInvestigatorTest],
  ["closed-loop learning", runClosedLoopLearningTest],
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

  if (failed) (globalThis as any).process.exit(1);
  console.log(`NINE test suite: ${tests.length} passed.`);
}

void main();
