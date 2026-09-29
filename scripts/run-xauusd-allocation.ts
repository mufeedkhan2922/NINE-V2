import fs from "node:fs";
import { db } from "../lib/trading/db";
import { NINE_STRATEGIES } from "../lib/trading/strategyLibrary";
import { calculateStrategyAllocations } from "../lib/trading/strategyAllocation";

function main() {
  const rows = db.prepare(
    `SELECT symbol, session, regime, strategy_id, trades, expectancy_r, win_rate
     FROM strategy_memory
     WHERE trades >= 10
     ORDER BY symbol, session, regime, updated_at DESC`,
  ).all() as Array<{
    symbol: string;
    session: string;
    regime: string;
    strategy_id: string;
    trades: number;
    expectancy_r: number;
    win_rate: number;
  }>;

  const groups = new Map<string, typeof rows>();
  for (const row of rows) {
    const key = [row.symbol, row.session, row.regime].join("|");
    const group = groups.get(key) ?? [];
    if (!group.some((item) => item.strategy_id === row.strategy_id)) group.push(row);
    groups.set(key, group);
  }

  const report = [...groups.entries()].map(([key, group]) => {
    const [symbol, session, regime] = key.split("|");
    const allocations = calculateStrategyAllocations(group.map((row) => ({
      strategyId: row.strategy_id,
      family: NINE_STRATEGIES.find((s) => s.id === row.strategy_id)?.family ?? "SMC",
      trades: Number(row.trades),
      expectancyR: Number(row.expectancy_r ?? 0),
      winRate: Number(row.win_rate ?? 0),
    })));
    return { symbol, session, regime, allocations };
  });

  const result = {
    version: "0.5.20",
    contexts: report.length,
    report,
    safety: [
      "Allocation is conservative and peer-relative; it does not create a setup.",
      "Minimum evidence is 10 trades and allocation adjustments are capped at ±6 score points.",
      "Sentinel, risk controls, setup validation and execution locks remain authoritative."
    ],
  };

  fs.mkdirSync("artifacts", { recursive: true });
  fs.writeFileSync("artifacts/xauusd-strategy-allocation.json", JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
}

main();
