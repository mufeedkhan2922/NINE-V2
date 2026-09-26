import { EngineValidation, MarketSnapshot, TradingSetup } from "./types";

export function validateTradingEngine(market: MarketSnapshot, setup: TradingSetup): EngineValidation {
  const blockers: string[] = [];
  const warnings: string[] = [];
  const marketData = Number.isFinite(market.price) && market.price > 0 && market.candles.length >= 30;
  const quality = Object.values(market.dataQuality ?? {}).every((item) => item?.valid === true);
  const crossTimeframe = market.crossTimeframeValidation?.valid === true;
  const microstructure = market.microstructureValidation?.valid === true;
  const marketState = market.marketState?.tradingPermission === "ALLOWED";
  const risk = setup.risk.allowed;
  const setupGeometry = setup.direction !== "NONE" && setup.entry !== null && setup.stopLoss !== null && setup.takeProfit !== null && (setup.riskReward ?? 0) >= 1.5;

  if (!marketData) blockers.push("Insufficient or invalid market data.");
  if (!quality) blockers.push("One or more candle-quality checks failed.");
  if (!crossTimeframe) blockers.push("Cross-timeframe validation failed.");
  if (!microstructure) blockers.push("Microstructure validation failed.");
  if (!marketState) blockers.push("Market/data state does not permit trading.");
  if (!risk) blockers.push(setup.risk.reason);
  if (!setupGeometry && setup.direction !== "NONE") blockers.push("Trade geometry is incomplete or below the minimum risk/reward threshold.");

  if (market.marketState?.warnings?.length) warnings.push(...market.marketState.warnings.slice(0, 5));
  if (market.crossTimeframeValidation?.warnings?.length) warnings.push(...market.crossTimeframeValidation.warnings.slice(0, 5));

  const checks = { marketData, dataQuality: quality, crossTimeframe, microstructure, marketState, risk, setup: setupGeometry || setup.direction === "NONE" };
  const passed = Object.values(checks).filter(Boolean).length;
  const score = Math.round((passed / Object.keys(checks).length) * 100);

  return { valid: blockers.length === 0, score, blockers, warnings, checks };
}
