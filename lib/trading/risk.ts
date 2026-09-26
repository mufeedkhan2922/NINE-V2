import { AdvancedRiskAssessment, RiskAssessment, TradeDirection } from "./types";

export const MAX_RISK_PERCENT = 1;
export const MAX_DAILY_LOSS_PERCENT = Number(process.env.NINE_MAX_DAILY_LOSS_PERCENT ?? 2);
export const MAX_DRAWDOWN_PERCENT = Number(process.env.NINE_MAX_DRAWDOWN_PERCENT ?? 5);

export function assessRisk(direction: TradeDirection, riskPercent: number): RiskAssessment {
  if (direction === "NONE") return { allowed: false, riskPercent, maxRiskPercent: MAX_RISK_PERCENT, reason: "No trade direction confirmed." };
  if (!Number.isFinite(riskPercent) || riskPercent <= 0) return { allowed: false, riskPercent, maxRiskPercent: MAX_RISK_PERCENT, reason: "Invalid risk percentage." };
  if (riskPercent > MAX_RISK_PERCENT) return { allowed: false, riskPercent, maxRiskPercent: MAX_RISK_PERCENT, reason: `Risk exceeds NINE's ${MAX_RISK_PERCENT}% limit.` };
  return { allowed: true, riskPercent, maxRiskPercent: MAX_RISK_PERCENT, reason: "Risk parameters accepted." };
}

export function assessAdvancedRisk(args: { direction: TradeDirection; riskPercent: number; equity: number; peakEquity: number; dailyRealizedPnl: number; dailyStartBalance: number; projectedLossDollars: number; notionalDollars: number }): AdvancedRiskAssessment {
  const base = assessRisk(args.direction, args.riskPercent);
  const warnings: string[] = [];
  const dailyLimit = args.dailyStartBalance * (Math.max(0.1, MAX_DAILY_LOSS_PERCENT) / 100);
  const drawdown = args.peakEquity > 0 ? Math.max(0, ((args.peakEquity - args.equity) / args.peakEquity) * 100) : 0;
  const exposure = args.equity > 0 ? (args.notionalDollars / args.equity) * 100 : 100;
  let allowed = base.allowed;
  let reason = base.reason;
  if (args.dailyRealizedPnl <= -dailyLimit) { allowed = false; reason = `Daily loss limit of ${MAX_DAILY_LOSS_PERCENT}% reached.`; }
  if (drawdown >= MAX_DRAWDOWN_PERCENT) { allowed = false; reason = `Maximum drawdown limit of ${MAX_DRAWDOWN_PERCENT}% reached.`; }
  if (exposure > Number(process.env.NINE_MAX_EXPOSURE_PERCENT ?? 100)) { allowed = false; reason = "Maximum portfolio exposure exceeded."; }
  if (args.projectedLossDollars > args.equity * (MAX_RISK_PERCENT / 100)) warnings.push("Projected loss is above the default one-percent equity budget.");
  if (exposure > 50) warnings.push("Position notional is above 50% of account equity.");
  return { ...base, allowed, reason, accountEquity: args.equity, dailyLossLimitPercent: MAX_DAILY_LOSS_PERCENT, maxDrawdownPercent: MAX_DRAWDOWN_PERCENT, exposurePercent: exposure, riskBudgetDollars: args.equity * (MAX_RISK_PERCENT / 100), projectedLossDollars: args.projectedLossDollars, warnings };
}
