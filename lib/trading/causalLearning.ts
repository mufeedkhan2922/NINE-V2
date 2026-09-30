import { createHash } from "node:crypto";
import { db, transaction } from "./db";
import type { BacktestTrade } from "./backtest";
import type { Candle, MarketSnapshot } from "./types";
import { evaluateRejectedTrade, type CounterfactualResult } from "./counterfactual";
import { getMistakePatternDecision } from "./mistakePatternMining";

export type FailureMode =
  | "IMMEDIATE_ADVERSE_MOVE"
  | "NO_FOLLOW_THROUGH"
  | "VOLATILITY_SHOCK"
  | "STRUCTURE_INVALIDATION"
  | "NEAR_TARGET_REVERSAL"
  | "BAD_SESSION"
  | "REGIME_MISMATCH"
  | "LOCATION_FAILURE"
  | "TIMING_FAILURE"
  | "UNKNOWN";

export interface CausalFailureAssessment {
  mode: FailureMode;
  severity: number;
  evidence: string[];
  counterfactual: CounterfactualResult | null;
}

export interface CausalDecision {
  blocked: boolean;
  adjustment: number;
  confidence: number;
  observations: number;
  reason: string;
  failureModes: FailureMode[];
}

function wilsonLower(wins: number, n: number): number {
  if (n <= 0) return 0;
  const z = 1.96, p = wins / n, d = 1 + z*z/n;
  return (p + z*z/(2*n) - z*Math.sqrt((p*(1-p)+z*z/(4*n))/n))/d;
}

function strategyFromReason(reason: string): string {
  return reason.match(/^(?:[^;]+);\s*(?:LONG|SHORT)\s+([^;]+)/i)?.[1]?.trim()
    ?? reason.split(";")[1]?.trim() ?? "UNKNOWN_SETUP";
}

function sessionOf(time: number): string {
  const h = new Date(time).getUTCHours();
  return h < 7 ? "ASIA" : h < 12 ? "LONDON" : h < 21 ? "NEW_YORK" : "OFF";
}

function regimeOf(candles: Candle[]): string {
  if (candles.length < 60) return "MIXED";
  const recent = candles.slice(-20), prior = candles.slice(-60,-20);
  const avg = recent.reduce((s,c)=>s+c.high-c.low,0)/Math.max(1,recent.length);
  const base = prior.reduce((s,c)=>s+c.high-c.low,0)/Math.max(1,prior.length);
  const change = recent.at(-1)!.close-recent[0]!.open;
  if (base>0 && avg>base*1.35) return "EXPANDING";
  if (change > avg*4) return "TRENDING_UP";
  if (change < -avg*4) return "TRENDING_DOWN";
  return "RANGING";
}

function assessFailure(trade: BacktestTrade, candles: Candle[]): CausalFailureAssessment {
  const idx=candles.findIndex(c=>c.time===trade.entryTime);
  const end=candles.findIndex(c=>c.time===trade.exitTime);
  if (trade.pnl>=0 || idx<0 || end<=idx) return {mode:"UNKNOWN",severity:0,evidence:[],counterfactual:null};
  const risk=Math.max(1e-8,Math.abs(trade.entryPrice-trade.stopLoss));
  const look=candles.slice(Math.max(0,idx-20),Math.min(candles.length,end+1));
  const atr=look.length?look.reduce((s,c)=>s+c.high-c.low,0)/look.length:0;
  let mfe=0,mae=0,maxShock=0;
  for(const c of candles.slice(idx,Math.min(end+1,idx+36))){
    const fav=trade.side==="LONG"?(c.high-trade.entryPrice)/risk:(trade.entryPrice-c.low)/risk;
    const adv=trade.side==="LONG"?(trade.entryPrice-c.low)/risk:(c.high-trade.entryPrice)/risk;
    mfe=Math.max(mfe,fav); mae=Math.max(mae,adv);
    if(atr>0) maxShock=Math.max(maxShock,(c.high-c.low)/atr);
  }
  const evidence:string[]=[];
  if(maxShock>=2.5){ evidence.push("range exceeded 2.5x local ATR"); return {mode:"VOLATILITY_SHOCK",severity:1,evidence,counterfactual:null}; }
  if(mfe>=1.5){ evidence.push("trade reached >=1.5R before reversal"); return {mode:"NEAR_TARGET_REVERSAL",severity:.6,evidence,counterfactual:null}; }
  if(mae>=.65 && mfe<.25){ evidence.push("early adverse excursion dominated favorable excursion"); return {mode:"IMMEDIATE_ADVERSE_MOVE",severity:.9,evidence,counterfactual:null}; }
  if(mfe<.5){ evidence.push("favorable excursion stayed below 0.5R"); return {mode:"NO_FOLLOW_THROUGH",severity:.7,evidence,counterfactual:null}; }
  if(trade.reason==="STOP"){ evidence.push("stop was reached after partial favorable movement"); return {mode:"STRUCTURE_INVALIDATION",severity:.75,evidence,counterfactual:null}; }
  return {mode:"UNKNOWN",severity:.3,evidence:["failure signature was not uniquely identifiable"],counterfactual:null};
}

export function investigateCausalFailure(trade: BacktestTrade,candles:Candle[],symbol="XAUUSD"): CausalFailureAssessment {
  return assessFailure(trade,candles);
}

export function recordCausalOutcomes(trades: BacktestTrade[], candles: Candle[], symbol="XAUUSD"): number {
  let recorded=0;
  for(const trade of trades){
    const assessment=assessFailure(trade,candles);
    const strategy=strategyFromReason(trade.entryReason), session=sessionOf(trade.entryTime), regime=regimeOf(candles);
    const mode=assessment.mode;
    const id=createHash("sha256").update([symbol,strategy,session,regime,trade.side,mode].join("|")).digest("hex").slice(0,24);
    const risk=Math.max(1e-8,Math.abs(trade.entryPrice-trade.stopLoss));
    const r=trade.pnl/(risk*Math.max(1e-8,trade.quantity));
    transaction(()=>{
      const old=db.prepare("SELECT observations,failures,wins,expectancy_r,severity FROM causal_failure_memory WHERE id=?").get(id) as any;
      if(old){
        const n=Number(old.observations)+1, failures=Number(old.failures)+(trade.pnl<0?1:0), wins=Number(old.wins)+(trade.pnl>=0?1:0);
        const exp=(Number(old.expectancy_r)*Number(old.observations)+r)/n;
        const fr=failures/n;
        const lower=wilsonLower(failures,n);
        db.prepare("UPDATE causal_failure_memory SET observations=?,failures=?,wins=?,failure_rate=?,failure_rate_lower_95=?,expectancy_r=?,severity=?,confidence=?,status=?,last_seen=?,source=? WHERE id=?")
          .run(n,failures,wins,fr,lower,exp,(Number(old.severity)*Number(old.observations)+assessment.severity)/n,Math.min(1,n/100),n>=20&&lower>=.55&&exp<-.05?"BLOCK":n>=5&&lower>=.45?"PENALIZE":"OBSERVE",Date.now(),"XAUUSD_CAUSAL",id);
      } else {
        const n=1, failures=trade.pnl<0?1:0, wins=trade.pnl>=0?1:0, fr=failures/n;
        db.prepare("INSERT INTO causal_failure_memory (id,symbol,strategy,session,regime,side,failure_mode,observations,failures,wins,failure_rate,failure_rate_lower_95,expectancy_r,severity,confidence,status,last_seen,source) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)")
          .run(id,symbol,strategy,session,regime,trade.side,mode,n,failures,wins,fr,wilsonLower(failures,n),r,assessment.severity,.01,"OBSERVE",Date.now(),"XAUUSD_CAUSAL");
      }
    });
    recorded++;
  }
  return recorded;
}

function normalizeStrategyKey(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

export function getCausalDecision(market:MarketSnapshot,strategy:string,side:"LONG"|"SHORT",concepts:string[]):CausalDecision {
  const candle=market.candles.at(-1); const session=sessionOf(candle?.time??Date.now()); const regime=regimeOf(market.candles);
  const rows=db.prepare("SELECT * FROM causal_failure_memory WHERE symbol=? AND session=? AND (regime=? OR regime='MIXED') AND side=? ORDER BY failure_rate_lower_95 DESC").all(market.symbol,session,regime,side) as any[];
  const strategyKey = normalizeStrategyKey(strategy);
  const strategyRows = rows.filter(r => normalizeStrategyKey(String(r.strategy)) === strategyKey);
  if(!strategyRows.length) return {blocked:false,adjustment:0,confidence:0,observations:0,reason:"No causal failure memory for this exact context.",failureModes:[]};
  const relevant=concepts.length===0
    ? strategyRows
    : strategyRows.filter(r =>
        r.failure_mode === "DECISION_OUTCOME" ||
        concepts.some(c => String(r.failure_mode).toLowerCase().includes(c.toLowerCase().replace(/-/g, "_")))
      );
  const observations=relevant.reduce((s,r)=>s+Number(r.observations),0);
  const blocked=relevant.some(r=>r.status==="BLOCK" && Number(r.failure_rate_lower_95)>=.55 && Number(r.observations)>=20);
  const penalty=relevant.reduce((s,r)=>s+(r.status==="PENALIZE"?Math.min(3,Number(r.failure_rate_lower_95)*4):0),0);
  const pattern = getMistakePatternDecision(market.symbol, session, regime, side);
  const combinedBlocked = blocked || pattern.blocked;
  const combinedAdjustment = Number((-Math.min(6, penalty + Math.abs(pattern.adjustment))).toFixed(2));
  return {
    blocked: combinedBlocked,
    adjustment: combinedAdjustment,
    confidence: Number(Math.min(1, relevant.reduce((s,r)=>s+Number(r.confidence),0)/Math.max(1,relevant.length)).toFixed(3)),
    observations: observations + pattern.observations,
    reason: combinedBlocked
      ? (pattern.blocked ? pattern.reason : "Repeated causal failure pattern is statistically persistent in this context.")
      : penalty > 0 || pattern.adjustment !== 0
        ? `Prior causal/mistake-pattern failures reduce selection confidence; new evidence can recover the pattern. ${pattern.reason}`
        : "Causal history is observational only.",
    failureModes: [...relevant.map(r=>r.failure_mode as FailureMode), ...pattern.patterns as FailureMode[]],
  };
}

export function evaluateCounterfactualsForTrade(trade:BacktestTrade,candles:Candle[]):CounterfactualResult {
  return evaluateRejectedTrade(trade.entryTime,trade.side,trade.entryPrice,trade.stopLoss,trade.takeProfit,candles,36);
}

export function persistCounterfactual(symbol:string,result:CounterfactualResult,side:"LONG"|"SHORT",source="XAUUSD_CAUSAL"):void {
  db.prepare("INSERT INTO counterfactual_results (id,symbol,entry_time,side,outcome,hypothetical_pnl,max_favorable_r,max_adverse_r,horizon_candles,source,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)")
    .run(createHash("sha256").update([symbol,result.tradeId,result.hypotheticalOutcome,String(Date.now())].join("|")).digest("hex").slice(0,24),symbol,Number(result.tradeId),side,result.hypotheticalOutcome,result.hypotheticalPnl,result.maxFavorableR,result.maxAdverseR,result.horizonCandles,source,Date.now());
}

export function causalResearchSummary(symbol="XAUUSD"){
  const rows=db.prepare("SELECT failure_mode AS failureMode,status,COUNT(*) AS contexts,SUM(observations) AS observations,AVG(failure_rate) AS failureRate,AVG(expectancy_r) AS expectancyR FROM causal_failure_memory WHERE symbol=? GROUP BY failure_mode,status ORDER BY observations DESC").all(symbol) as any[];
  return rows;
}
