import type { BacktestTrade } from "./backtest";
import type { Candle } from "./types";

export interface CounterfactualResult {
  tradeId: string;
  rejected: boolean;
  hypotheticalOutcome: "WOULD_HAVE_WON" | "WOULD_HAVE_LOST" | "UNRESOLVED";
  hypotheticalPnl: number;
  maxFavorableR: number;
  maxAdverseR: number;
  horizonCandles: number;
}

export function evaluateRejectedTrade(entryTime: number, side: "LONG"|"SHORT", entry: number, stop: number, target: number, candles: Candle[], horizon=36): CounterfactualResult {
  const index = candles.findIndex(c=>c.time>=entryTime);
  if(index<0) return {tradeId:String(entryTime),rejected:true,hypotheticalOutcome:"UNRESOLVED",hypotheticalPnl:0,maxFavorableR:0,maxAdverseR:0,horizonCandles:0};
  const risk=Math.max(0.000001,Math.abs(entry-stop));
  let mfe=0, mae=0;
  for(const c of candles.slice(index,index+horizon)){
    const fav=side==="LONG"?(c.high-entry)/risk:(entry-c.low)/risk;
    const adv=side==="LONG"?(entry-c.low)/risk:(c.high-entry)/risk;
    mfe=Math.max(mfe,fav); mae=Math.max(mae,adv);
    const stopHit=side==="LONG"?c.low<=stop:c.high>=stop;
    const targetHit=side==="LONG"?c.high>=target:c.low<=target;
    if(stopHit||targetHit) return {tradeId:String(entryTime),rejected:true,hypotheticalOutcome:targetHit&&!stopHit?"WOULD_HAVE_WON":"WOULD_HAVE_LOST",hypotheticalPnl:targetHit&&!stopHit?Math.abs(target-entry): -risk,maxFavorableR:mfe,maxAdverseR:mae,horizonCandles:index};
  }
  return {tradeId:String(entryTime),rejected:true,hypotheticalOutcome:"UNRESOLVED",hypotheticalPnl:0,maxFavorableR:mfe,maxAdverseR:mae,horizonCandles:Math.min(horizon,candles.length-index)};
}
