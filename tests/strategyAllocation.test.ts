import { calculateStrategyAllocations } from "../lib/trading/strategyAllocation";

export function runStrategyAllocationTest(): void {
  const allocations = calculateStrategyAllocations([
    { strategyId: "trend-a", family: "TREND", trades: 80, expectancyR: 0.65, winRate: 64 },
    { strategyId: "smc-b", family: "SMC", trades: 80, expectancyR: 0.05, winRate: 51 },
    { strategyId: "reversal-c", family: "REVERSAL", trades: 80, expectancyR: -0.35, winRate: 42 },
  ]);

  if (allocations.length !== 3) throw new Error("allocation count failed");
  const trend = allocations.find((x) => x.strategyId === "trend-a");
  const reversal = allocations.find((x) => x.strategyId === "reversal-c");
  if (!trend || !reversal) throw new Error("allocation lookup failed");
  if (trend.allocationWeight <= 1) throw new Error("positive edge was not allocated above baseline");
  if (reversal.allocationWeight >= 1) throw new Error("negative edge was not allocated below baseline");
  if (Math.abs(trend.adjustment) > 6 || Math.abs(reversal.adjustment) > 6) throw new Error("allocation adjustment escaped safety bounds");

  const empty = calculateStrategyAllocations([]);
  if (empty.length !== 0) throw new Error("empty allocation baseline failed");
}
