import { assessRisk, assessAdvancedRisk } from "../lib/trading/risk";
import * as assert from "./assert";
export function runRiskTest() { assert.equal(assessRisk("NONE", 0.5).allowed, false, "NONE must be blocked"); assert.equal(assessRisk("LONG", 2).allowed, false, "risk above max must be blocked"); }
export function runAdvancedRiskTest() { const result = assessAdvancedRisk({ direction: "LONG", riskPercent: 0.5, equity: 9000, peakEquity: 10000, dailyRealizedPnl: 0, dailyStartBalance: 10000, projectedLossDollars: 45, notionalDollars: 1000 }); assert.equal(result.allowed, false, "drawdown must block"); assert.match(result.reason, /drawdown/i, "reason should mention drawdown"); }
