export type StrategyFamily =
  | "TREND"
  | "BREAKOUT"
  | "REVERSAL"
  | "SMC"
  | "SESSION"
  | "MEAN_REVERSION"
  | "MOMENTUM";

export interface NINEConcept {
  id: string;
  name: string;
  category: "STRUCTURE" | "LIQUIDITY" | "MOMENTUM" | "RISK" | "SESSION" | "EXECUTION";
  description: string;
  rules: string[];
}

export interface StrategyDefinition {
  id: string;
  name: string;
  family: StrategyFamily;
  preferredTimeframes: string[];
  concepts: string[];
  entryModel: string;
  invalidation: string;
  targetModel: string;
}

export const NINE_CONCEPTS: NINEConcept[] = [
  { id: "trend", name: "Trend alignment", category: "STRUCTURE", description: "Trade with confirmed directional momentum rather than against it.", rules: ["Use EMA structure and recent displacement.", "Require higher-timeframe agreement when available."] },
  { id: "market-structure", name: "Market structure", category: "STRUCTURE", description: "Track higher highs/lows and lower highs/lows to define directional context.", rules: ["Do not treat a single candle as a complete trend.", "Use confirmed structure breaks as evidence."] },
  { id: "bos", name: "Break of structure", category: "STRUCTURE", description: "A confirmed break beyond a meaningful swing can signal continuation.", rules: ["Break must occur after a defined swing.", "Prefer displacement rather than a marginal wick."] },
  { id: "choch", name: "Change of character", category: "STRUCTURE", description: "A structural break against the prior directional sequence can mark a transition.", rules: ["Use with liquidity or momentum confirmation.", "Treat isolated CHoCH as a watch signal."] },
  { id: "liquidity-sweep", name: "Liquidity sweep", category: "LIQUIDITY", description: "Price takes a recent extreme and closes back through it, suggesting rejection.", rules: ["Compare against prior highs/lows.", "Require directional confirmation after the sweep."] },
  { id: "equal-high-low", name: "Equal highs / lows", category: "LIQUIDITY", description: "Repeated nearby extremes can become obvious liquidity references.", rules: ["Use a tolerance rather than exact equality.", "Do not assume a sweep will occur."] },
  { id: "fvg", name: "Fair value gap", category: "LIQUIDITY", description: "A three-candle imbalance can become a retracement or continuation reference.", rules: ["Prefer fresh zones.", "Confirm direction with structure and momentum."] },
  { id: "order-block", name: "Order block", category: "LIQUIDITY", description: "A prior opposing candle before displacement can define a reaction zone.", rules: ["Require displacement away from the zone.", "Invalidate when price decisively breaks the zone."] },
  { id: "premium-discount", name: "Premium / discount", category: "STRUCTURE", description: "Relative position inside a recent range helps contextualize long and short locations.", rules: ["Prefer longs in discount and shorts in premium.", "Do not treat 50% as a guaranteed reversal."] },
  { id: "ema-cross", name: "EMA 9/21 structure", category: "MOMENTUM", description: "Fast/slow exponential averages provide a directional regime filter.", rules: ["Use price location plus EMA ordering.", "Avoid relying on crossovers alone."] },
  { id: "rsi-regime", name: "RSI regime", category: "MOMENTUM", description: "RSI can distinguish momentum regimes from stretched conditions.", rules: ["Above 50 supports bullish momentum; below 50 supports bearish momentum.", "Extreme readings need context."] },
  { id: "atr", name: "ATR volatility", category: "RISK", description: "ATR measures recent range and helps size stops consistently.", rules: ["Use volatility-aware stops.", "Reduce activity when volatility becomes abnormal."] },
  { id: "range-breakout", name: "Range breakout", category: "BREAKOUT", description: "A close outside a compressed range can start directional expansion.", rules: ["Prefer close confirmation.", "Watch for failed breakouts and retests."] },
  { id: "breakout-retest", name: "Breakout retest", category: "BREAKOUT", description: "A broken level can become support or resistance on a controlled retest.", rules: ["Retest must hold the broken level.", "Use momentum confirmation for continuation."] },
  { id: "mean-reversion", name: "Mean reversion", category: "MEAN_REVERSION", description: "In balanced markets, stretched price can revert toward the local mean.", rules: ["Only use in non-trending regimes.", "Avoid fading strong displacement."] },
  { id: "momentum-expansion", name: "Momentum expansion", category: "MOMENTUM", description: "Range expansion with directional closes can identify acceleration.", rules: ["Compare current range with recent median.", "Require directional follow-through."] },
  { id: "asia-range", name: "Asian range", category: "SESSION", description: "The Asian session range can become a liquidity reference for later sessions.", rules: ["Build the range before London/New York.", "Do not assume a breakout direction."] },
  { id: "london-break", name: "London expansion", category: "SESSION", description: "London can expand beyond the earlier session range.", rules: ["Use the pre-London range as context.", "Confirm direction after the break."] },
  { id: "new-york-reversal", name: "New York reversal", category: "SESSION", description: "A sweep of an earlier session extreme during New York can set up a reversal.", rules: ["Require rejection back inside the range.", "Combine with structure shift."] },
  { id: "previous-day-levels", name: "Previous-day high/low", category: "LIQUIDITY", description: "Prior-day extremes are widely watched reference levels.", rules: ["Track both levels.", "Treat breaks and rejections differently."] },
  { id: "session-filter", name: "Session filter", category: "SESSION", description: "Avoid forcing setups during unsuitable sessions.", rules: ["Prefer liquid trading windows.", "Allow monitoring outside preferred windows."] },
  { id: "spread-slippage", name: "Spread and slippage", category: "EXECUTION", description: "Execution costs can turn a theoretical edge into a loss.", rules: ["Model costs in backtests.", "Reject setups whose edge is smaller than friction."] },
  { id: "risk-reward", name: "Risk / reward", category: "RISK", description: "Trade geometry should have a defined invalidation and target.", rules: ["Require a predefined stop.", "Do not widen stops after entry."] },
  { id: "daily-loss", name: "Daily loss guard", category: "RISK", description: "A daily loss budget prevents a bad session from becoming catastrophic.", rules: ["Stop new risk after the configured limit.", "Keep the guard independent of signal confidence."] },
  { id: "drawdown", name: "Drawdown guard", category: "RISK", description: "Peak-to-equity drawdown controls reduce risk during poor regimes.", rules: ["Reduce or block risk at configured thresholds.", "Never bypass Sentinel."] },
  { id: "no-trade-zone", name: "No-trade zone", category: "RISK", description: "Low-quality or conflicting conditions should produce WATCH rather than a forced trade.", rules: ["Mixed higher timeframes can invalidate a setup.", "Missing data always blocks execution."] },
  { id: "walk-forward", name: "Walk-forward validation", category: "EXECUTION", description: "Evaluate strategy parameters on unseen data rather than optimizing the full history.", rules: ["Separate training and validation windows.", "Never select a strategy from in-sample results alone."] },
  { id: "anti-lookahead", name: "Anti-lookahead discipline", category: "EXECUTION", description: "Only information available at the decision timestamp may affect a signal.", rules: ["Never use future bars to form current decisions.", "Keep execution assumptions explicit."] },
  { id: "regime", name: "Market regime", category: "STRUCTURE", description: "Trend, range, volatility and session conditions change which setup families fit.", rules: ["Classify the current regime.", "Do not force one strategy into every regime."] },
  { id: "confluence", name: "Confluence", category: "EXECUTION", description: "Independent evidence can increase confidence when it is not double-counted.", rules: ["Prefer multiple independent signals.", "Cap confidence rather than pretending certainty."] },
];

export const NINE_STRATEGIES: StrategyDefinition[] = [
  { id: "sweep-mss-fvg", name: "Liquidity Sweep + MSS + FVG", family: "SMC", preferredTimeframes: ["1min", "5min", "15min"], concepts: ["liquidity-sweep", "choch", "fvg", "premium-discount", "risk-reward"], entryModel: "Sweep a recent extreme, confirm structure shift, then use a fresh imbalance as the location.", invalidation: "Beyond the swept extreme / structural invalidation.", targetModel: "Next opposing liquidity or fixed 2R baseline." },
  { id: "ob-retest", name: "Order Block Retest", family: "SMC", preferredTimeframes: ["5min", "15min", "1h"], concepts: ["order-block", "bos", "trend", "premium-discount"], entryModel: "Wait for displacement and retest of the validated order-block zone.", invalidation: "Decisive close through the zone.", targetModel: "Prior swing or 2R baseline." },
  { id: "ema-pullback", name: "EMA 9/21 Pullback", family: "TREND", preferredTimeframes: ["5min", "15min"], concepts: ["ema-cross", "trend", "atr", "risk-reward"], entryModel: "Trend-aligned pullback toward the EMA structure followed by continuation.", invalidation: "Trend structure breaks.", targetModel: "Prior impulse extreme or 2R baseline." },
  { id: "breakout-retest", name: "Range Breakout + Retest", family: "BREAKOUT", preferredTimeframes: ["5min", "15min"], concepts: ["range-breakout", "breakout-retest", "momentum-expansion", "atr"], entryModel: "Close outside a defined range, then hold the broken level on retest.", invalidation: "Return into the range with failed follow-through.", targetModel: "Range expansion or 2R baseline." },
  { id: "session-sweep", name: "Session Range Sweep", family: "SESSION", preferredTimeframes: ["1min", "5min"], concepts: ["asia-range", "london-break", "new-york-reversal", "liquidity-sweep"], entryModel: "Sweep a prior session extreme and reclaim the range with structure confirmation.", invalidation: "Continuation beyond the swept extreme.", targetModel: "Opposite session extreme / next liquidity." },
  { id: "previous-day-rejection", name: "Previous-Day Level Rejection", family: "REVERSAL", preferredTimeframes: ["5min", "15min"], concepts: ["previous-day-levels", "liquidity-sweep", "premium-discount"], entryModel: "Reject previous-day high/low after a liquidity run.", invalidation: "Acceptance beyond the level.", targetModel: "Session midpoint or opposite liquidity." },
  { id: "momentum-expansion", name: "Momentum Expansion", family: "MOMENTUM", preferredTimeframes: ["1min", "5min"], concepts: ["momentum-expansion", "atr", "trend", "session-filter"], entryModel: "Trade confirmed range expansion in the established direction.", invalidation: "Immediate loss of expansion structure.", targetModel: "Volatility-adjusted continuation." },
  { id: "rsi-mean-reversion", name: "RSI Mean Reversion", family: "MEAN_REVERSION", preferredTimeframes: ["5min", "15min"], concepts: ["rsi-regime", "mean-reversion", "premium-discount"], entryModel: "Fade a stretched move only when the market regime is balanced.", invalidation: "Trend continuation beyond the stretch.", targetModel: "Local mean / range midpoint." },
  { id: "bos-continuation", name: "BOS Continuation", family: "TREND", preferredTimeframes: ["5min", "15min", "1h"], concepts: ["bos", "trend", "ema-cross", "risk-reward"], entryModel: "Confirmed break in the direction of higher-timeframe trend.", invalidation: "Break failure.", targetModel: "Next swing/liquidity." },
  { id: "fvg-continuation", name: "FVG Continuation", family: "SMC", preferredTimeframes: ["1min", "5min", "15min"], concepts: ["fvg", "trend", "momentum-expansion"], entryModel: "Use a fresh imbalance as a continuation location after displacement.", invalidation: "Full invalidation of the imbalance.", targetModel: "Next liquidity." },
  { id: "compression-break", name: "Compression Break", family: "BREAKOUT", preferredTimeframes: ["1min", "5min"], concepts: ["range-breakout", "atr", "momentum-expansion"], entryModel: "Trade the confirmed break after a compressed volatility regime.", invalidation: "Breakout failure.", targetModel: "Measured range expansion." },
  { id: "multi-factor", name: "Multi-Factor Confluence", family: "SMC", preferredTimeframes: ["1min", "5min", "15min", "1h"], concepts: ["confluence", "regime", "market-structure", "risk-reward", "anti-lookahead"], entryModel: "Require independent structure, liquidity, momentum and higher-timeframe agreement.", invalidation: "Any primary structural invalidation.", targetModel: "Only trade when geometry remains positive after costs." },
];

export function getStrategyKnowledge(strategyId?: string): StrategyDefinition[] {
  return strategyId ? NINE_STRATEGIES.filter((strategy) => strategy.id === strategyId) : NINE_STRATEGIES;
}
