import { NINE_CONCEPTS, NINE_STRATEGIES } from "./strategyLibrary";
import { analyzeSMC } from "./smc";
import { analyzeTechnicals } from "./technical";
import type { Candle, MarketSnapshot, TradeDirection } from "./types";

export type LabSession = "ASIA" | "LONDON" | "NEW_YORK" | "OFF_SESSION";
export type LabRegime =
  | "TRENDING_UP"
  | "TRENDING_DOWN"
  | "RANGING"
  | "EXPANDING"
  | "COMPRESSED"
  | "MIXED";

export interface LabEvent {
  id: string;
  concept: string;
  category: string;
  direction: TradeDirection;
  strength: number;
  timestamp: number;
  evidence: string;
}

export interface LabSetup {
  id: string;
  name: string;
  direction: TradeDirection;
  score: number;
  requiredConcepts: string[];
  matchedConcepts: string[];
  missingConcepts: string[];
  status: "READY" | "FORMING" | "BLOCKED";
  explanation: string;
}

export interface LabLesson {
  id: string;
  title: string;
  category: string;
  level: "FOUNDATION" | "INTERMEDIATE" | "ADVANCED";
  objective: string;
  rules: string[];
  relatedStrategies: string[];
}

export interface StrategyLabSnapshot {
  symbol: MarketSnapshot["symbol"];
  session: LabSession;
  regime: LabRegime;
  trend: string;
  volatility: number;
  events: LabEvent[];
  setups: LabSetup[];
  lessons: LabLesson[];
  conceptCoverage: number;
  generatedAt: number;
}

const ADVANCED_LESSONS: LabLesson[] = [
  { id: "liquidity-engineering", title: "Liquidity engineering", category: "LIQUIDITY", level: "ADVANCED", objective: "Map where obvious stops and breakout orders are likely clustered before interpreting a sweep.", rules: ["Mark equal highs/lows and recent session extremes.", "Treat a sweep as evidence only after rejection or structure confirmation.", "Never assume liquidity must be taken."], relatedStrategies: ["sweep-mss-fvg", "session-sweep", "previous-day-rejection"] },
  { id: "displacement-quality", title: "Displacement quality", category: "MOMENTUM", level: "ADVANCED", objective: "Separate meaningful directional displacement from ordinary candle noise.", rules: ["Compare body/range with recent ATR.", "Prefer closes near the directional extreme.", "Require follow-through or a valid retest."], relatedStrategies: ["bos-continuation", "fvg-continuation", "momentum-expansion"] },
  { id: "failed-breakout", title: "Failed breakout", category: "BREAKOUT", level: "ADVANCED", objective: "Recognize when price breaks a range and quickly re-enters it.", rules: ["Require a prior defined range.", "A close back inside weakens continuation.", "Combine the failure with structure for reversal evidence."], relatedStrategies: ["breakout-retest", "session-sweep", "multi-factor"] },
  { id: "opening-range", title: "Opening range", category: "SESSION", level: "INTERMEDIATE", objective: "Use the first liquid session range as a contextual reference.", rules: ["Define the range before trading its break.", "Do not trade the first wick automatically.", "Use volume or displacement when available."], relatedStrategies: ["compression-break", "momentum-expansion"] },
  { id: "premium-discount-dealing-range", title: "Dealing range premium/discount", category: "STRUCTURE", level: "INTERMEDIATE", objective: "Use a defined dealing range to contextualize directional entries.", rules: ["Define the range before calculating location.", "Prefer longs below equilibrium and shorts above.", "Location does not replace confirmation."], relatedStrategies: ["sweep-mss-fvg", "previous-day-rejection", "multi-factor"] },
  { id: "inducement", title: "Inducement", category: "LIQUIDITY", level: "ADVANCED", objective: "Identify an obvious short-term structure that can attract premature entries before the larger move.", rules: ["Treat minor swing structure as contextual.", "Require the larger liquidity event to confirm.", "Do not infer intent from one candle."], relatedStrategies: ["sweep-mss-fvg", "session-sweep"] },
  { id: "mitigation", title: "Mitigation", category: "LIQUIDITY", level: "ADVANCED", objective: "Track revisits to a displacement origin or imbalance without assuming automatic support/resistance.", rules: ["Validate the original displacement.", "Watch how price reacts on the revisit.", "Invalidate after decisive acceptance through the zone."], relatedStrategies: ["ob-retest", "fvg-continuation"] },
  { id: "time-price-confluence", title: "Time-price confluence", category: "SESSION", level: "ADVANCED", objective: "Combine structural levels with liquid session windows.", rules: ["Prefer level tests during active sessions.", "Avoid treating a clock time as a signal by itself.", "Require price confirmation."], relatedStrategies: ["session-sweep", "previous-day-rejection"] },
  { id: "volatility-state-machine", title: "Volatility state machine", category: "RISK", level: "ADVANCED", objective: "Classify compression, normal volatility and expansion before selecting a playbook.", rules: ["Compare recent range to a longer baseline.", "Expansion can invalidate mean-reversion assumptions.", "Compression without a break is a watch state."], relatedStrategies: ["compression-break", "momentum-expansion", "rsi-mean-reversion"] },
  { id: "regime-switching", title: "Regime switching", category: "STRUCTURE", level: "ADVANCED", objective: "Switch strategy families when trend, range or volatility conditions change.", rules: ["Do not force one strategy through all regimes.", "Require multiple observations for a regime change.", "Use walk-forward evidence to validate regime-specific behavior."], relatedStrategies: ["multi-factor", "ema-pullback", "rsi-mean-reversion"] },
  { id: "confluence-independence", title: "Independent confluence", category: "EXECUTION", level: "ADVANCED", objective: "Avoid counting correlated indicators as independent evidence.", rules: ["Group related signals into one evidence family.", "Give more weight to structurally independent evidence.", "Cap confidence even with many confirmations."], relatedStrategies: ["multi-factor"] },
  { id: "expectancy-over-winrate", title: "Expectancy over win rate", category: "RISK", level: "FOUNDATION", objective: "Teach NINE to evaluate the full payoff distribution instead of optimizing a single win-rate number.", rules: ["Track average win and average loss.", "Track profit factor and expectancy.", "Reject tiny samples as proof."], relatedStrategies: ["multi-factor", "risk-reward"] },
  { id: "sample-size-discipline", title: "Sample-size discipline", category: "EXECUTION", level: "FOUNDATION", objective: "Prevent NINE from declaring a strategy proven after a handful of trades.", rules: ["Require a minimum trade count.", "Prefer out-of-sample validation.", "Use uncertainty bounds when comparing win rates."], relatedStrategies: ["walk-forward", "multi-factor"] },
  { id: "execution-friction", title: "Execution friction", category: "EXECUTION", level: "FOUNDATION", objective: "Measure whether a theoretical edge survives spread and slippage.", rules: ["Apply configured costs in replay.", "Reject fragile setups whose edge disappears after costs.", "Keep live and historical assumptions explicit."], relatedStrategies: ["spread-slippage", "risk-reward"] },
  { id: "same-bar-ambiguity", title: "Same-bar ambiguity", category: "EXECUTION", level: "ADVANCED", objective: "Handle candles where stop and target could both be touched without inventing intrabar order.", rules: ["Use a documented conservative policy.", "Prefer lower-timeframe data when available.", "Do not silently assume the favorable path."], relatedStrategies: ["walk-forward", "anti-lookahead"] },
  { id: "walk-forward-selection", title: "Walk-forward selection", category: "EXECUTION", level: "ADVANCED", objective: "Choose strategies using unseen validation windows rather than full-history optimization.", rules: ["Separate training and validation periods.", "Repeat across multiple windows.", "Promote only robust behavior."], relatedStrategies: ["walk-forward", "multi-factor"] },
  { id: "regime-conditioned-edge", title: "Regime-conditioned edge", category: "EXECUTION", level: "ADVANCED", objective: "Measure whether a setup works because of its market regime rather than everywhere.", rules: ["Segment outcomes by regime.", "Segment again by session when sample size allows.", "Do not extrapolate thin segments."], relatedStrategies: ["multi-factor", "session-sweep", "rsi-mean-reversion"] },
  { id: "no-trade-decision", title: "No-trade decision", category: "RISK", level: "FOUNDATION", objective: "Make WATCH a valid output when evidence conflicts or quality is insufficient.", rules: ["Missing data blocks execution.", "Conflicting directional evidence lowers confidence.", "No setup is better than forced setup."], relatedStrategies: ["no-trade-zone", "multi-factor"] },
];

function sessionOf(time: number): LabSession {
  const hour = new Date(time).getUTCHours();
  if (hour < 8) return "ASIA";
  if (hour < 13) return "LONDON";
  if (hour < 21) return "NEW_YORK";
  return "OFF_SESSION";
}

function volatilityState(candles: Candle[]): { regime: LabRegime; value: number } {
  if (candles.length < 50) return { regime: "MIXED", value: 0 };
  const recent = candles.slice(-10).map((c) => c.high - c.low);
  const baseline = candles.slice(-50, -10).map((c) => c.high - c.low);
  const avg = recent.reduce((a, b) => a + b, 0) / Math.max(1, recent.length);
  const base = baseline.reduce((a, b) => a + b, 0) / Math.max(1, baseline.length);
  const ratio = base > 0 ? avg / base : 1;
  if (ratio >= 1.35) return { regime: "EXPANDING", value: ratio };
  if (ratio <= 0.7) return { regime: "COMPRESSED", value: ratio };
  return { regime: "MIXED", value: ratio };
}

function trendState(candles: Candle[]): { regime: LabRegime; trend: string } {
  const tech = analyzeTechnicals(candles);
  const first = candles.at(-20)?.close ?? 0;
  const last = candles.at(-1)?.close ?? 0;
  const delta = last - first;
  if (tech.trend === "BULLISH" && delta > 0) return { regime: "TRENDING_UP", trend: "BULLISH" };
  if (tech.trend === "BEARISH" && delta < 0) return { regime: "TRENDING_DOWN", trend: "BEARISH" };
  return { regime: "RANGING", trend: tech.trend };
}

function eventStrength(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function buildEvents(market: MarketSnapshot): LabEvent[] {
  const candles = market.candles;
  const events: LabEvent[] = [];
  const last = candles.at(-1);
  const prev = candles.at(-2);
  if (!last || !prev) return events;

  const smc = analyzeSMC(candles);
  const session = sessionOf(last.time);
  if (smc.liquiditySweep) {
    events.push({
      id: "liquidity-sweep",
      concept: "liquidity-sweep",
      category: "LIQUIDITY",
      direction: smc.sweepDirection,
      strength: eventStrength(82),
      timestamp: last.time,
      evidence: "Recent extreme was swept and SMC marked a directional rejection.",
    });
  }
  if (smc.marketStructureShift) {
    events.push({
      id: "market-structure-shift",
      concept: "choch",
      category: "STRUCTURE",
      direction: smc.structureDirection,
      strength: eventStrength(78),
      timestamp: last.time,
      evidence: "Market structure shift is currently detected.",
    });
  }
  if (smc.fairValueGap) {
    events.push({
      id: "fair-value-gap",
      concept: "fvg",
      category: "LIQUIDITY",
      direction: smc.structureDirection,
      strength: eventStrength(72),
      timestamp: last.time,
      evidence: "A current imbalance is available as a location reference.",
    });
  }
  if (smc.orderBlock) {
    events.push({
      id: "order-block",
      concept: "order-block",
      category: "LIQUIDITY",
      direction: smc.structureDirection,
      strength: eventStrength(68),
      timestamp: last.time,
      evidence: "A validated order-block candidate is present.",
    });
  }

  const recent = candles.slice(-20);
  const rangeHigh = Math.max(...recent.map((c) => c.high));
  const rangeLow = Math.min(...recent.map((c) => c.low));
  const previousHigh = Math.max(...candles.slice(-21, -1).map((c) => c.high));
  const previousLow = Math.min(...candles.slice(-21, -1).map((c) => c.low));
  if (last.close > previousHigh) {
    events.push({ id: "range-break-up", concept: "range-breakout", category: "BREAKOUT", direction: "LONG", strength: 75, timestamp: last.time, evidence: "Close broke the prior 20-candle high." });
  }
  if (last.close < previousLow) {
    events.push({ id: "range-break-down", concept: "range-breakout", category: "BREAKOUT", direction: "SHORT", strength: 75, timestamp: last.time, evidence: "Close broke the prior 20-candle low." });
  }

  const currentRange = last.high - last.low;
  const avgRange = recent.reduce((sum, c) => sum + (c.high - c.low), 0) / Math.max(1, recent.length);
  if (currentRange > avgRange * 1.5) {
    events.push({ id: "displacement", concept: "momentum-expansion", category: "MOMENTUM", direction: last.close >= last.open ? "LONG" : "SHORT", strength: 70, timestamp: last.time, evidence: "Current candle range is materially larger than the recent average." });
  }
  if (currentRange < avgRange * 0.65) {
    events.push({ id: "compression", concept: "compression", category: "VOLATILITY", direction: "NONE", strength: 65, timestamp: last.time, evidence: "Current candle range is compressed relative to the recent average." });
  }

  const midpoint = (rangeHigh + rangeLow) / 2;
  const locationDirection: TradeDirection =
    last.close < midpoint ? "LONG" : last.close > midpoint ? "SHORT" : "NONE";
  events.push({
    id: "dealing-range-location",
    concept: "premium-discount",
    category: "STRUCTURE",
    direction: locationDirection,
    strength: eventStrength(55 + Math.min(20, Math.abs(last.close - midpoint) / Math.max(0.0001, rangeHigh - rangeLow) * 100)),
    timestamp: last.time,
    evidence: last.close < midpoint ? "Price is in the lower half of the recent dealing range." : last.close > midpoint ? "Price is in the upper half of the recent dealing range." : "Price is near dealing-range equilibrium.",
  });

  if (session === "LONDON" || session === "NEW_YORK") {
    events.push({ id: "active-session", concept: "session-filter", category: "SESSION", direction: "NONE", strength: 65, timestamp: last.time, evidence: session + " is an active liquid session window." });
  }

  return events;
}

function buildSetups(events: LabEvent[]): LabSetup[] {
  const eventConcepts = new Set(events.map((event) => event.concept));
  return NINE_STRATEGIES.map((strategy) => {
    const matched = strategy.concepts.filter((concept) => eventConcepts.has(concept));
    const missing = strategy.concepts.filter((concept) => !eventConcepts.has(concept));
    const directional = events.filter((event) => event.direction !== "NONE" && matched.includes(event.concept));
    const long = directional.filter((event) => event.direction === "LONG").length;
    const short = directional.filter((event) => event.direction === "SHORT").length;
    const direction: TradeDirection = long > short ? "LONG" : short > long ? "SHORT" : "NONE";
    const score = Math.min(100, Math.round((matched.length / Math.max(1, strategy.concepts.length)) * 75 + (direction !== "NONE" ? 15 : 0)));
    const status: LabSetup["status"] =
      matched.length >= Math.max(2, Math.ceil(strategy.concepts.length * 0.65)) && direction !== "NONE"
        ? "READY"
        : matched.length > 0
          ? "FORMING"
          : "BLOCKED";
    return {
      id: strategy.id,
      name: strategy.name,
      direction,
      score,
      requiredConcepts: strategy.concepts,
      matchedConcepts: matched,
      missingConcepts: missing,
      status,
      explanation:
        status === "READY"
          ? "Required concept coverage is currently sufficient for research/paper evaluation."
          : status === "FORMING"
            ? "Some setup ingredients are present; wait for missing confirmation."
            : "No current evidence satisfies the setup model.",
    };
  }).sort((a, b) => b.score - a.score);
}

export function buildStrategyLabSnapshot(market: MarketSnapshot): StrategyLabSnapshot {
  const candles = market.candles.slice(-240);
  if (candles.length < 40) {
    return {
      symbol: market.symbol,
      session: sessionOf(candles.at(-1)?.time ?? Date.now()),
      regime: "MIXED",
      trend: "NEUTRAL",
      volatility: 0,
      events: [],
      setups: [],
      lessons: ADVANCED_LESSONS,
      conceptCoverage: 0,
      generatedAt: Date.now(),
    };
  }

  const scopedMarket = { ...market, candles };
  const volatility = volatilityState(candles);
  const trend = trendState(candles);
  const regime = volatility.regime === "MIXED" ? trend.regime : volatility.regime;
  const events = buildEvents(scopedMarket);
  const setups = buildSetups(events);
  const availableConcepts = new Set([
    ...NINE_CONCEPTS.map((concept) => concept.id),
    ...ADVANCED_LESSONS.map((lesson) => lesson.id),
  ]);
  const observed = new Set(events.map((event) => event.concept));
  const conceptCoverage = Math.round((observed.size / Math.max(1, availableConcepts.size)) * 100);

  return {
    symbol: market.symbol,
    session: sessionOf(candles.at(-1)!.time),
    regime,
    trend: trend.trend,
    volatility: Number(volatility.value.toFixed(3)),
    events,
    setups,
    lessons: ADVANCED_LESSONS,
    conceptCoverage,
    generatedAt: Date.now(),
  };
}
