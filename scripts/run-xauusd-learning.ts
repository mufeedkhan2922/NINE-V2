import fs from "node:fs";
import { fetchProviderHistoricalCandles } from "../lib/trading/provider";
import { runBacktest } from "../lib/trading/backtest";
import { runResearchCycle } from "../lib/trading/autonomousResearch";
import { evaluateRejectedTrade } from "../lib/trading/counterfactual";
import { db, transaction } from "../lib/trading/db";
import type { Candle } from "../lib/trading/types";

const START = process.env.NINE_LEARNING_START ?? "2026-08-01";
const END = process.env.NINE_LEARNING_END ?? "2026-09-29";
const CHUNK_DAYS = 10;

function addDays(d: Date,n:number){const x=new Date(d);x.setUTCDate(x.getUTCDate()+n);return x;}
function iso(d:Date){return d.toISOString().slice(0,10);}

async function fetchHistory(): Promise<Candle[]> {
  const start=new Date(START+"T00:00:00Z"), end=new Date(END+"T00:00:00Z");
  const map=new Map<number,Candle>();
  for(let cursor=start;cursor<end;cursor=addDays(cursor,CHUNK_DAYS)){
    const to=addDays(cursor,CHUNK_DAYS)<end?addDays(cursor,CHUNK_DAYS):end;
    for(const c of await fetchProviderHistoricalCandles("XAUUSD","5min",iso(cursor),iso(to))) map.set(c.time,c);
  }
  return [...map.values()].sort((a,b)=>a.time-b.time);
}

function persistRules(rules: ReturnType<typeof runResearchCycle>["rules"]){
  transaction(()=>{
    const stmt=db.prepare("INSERT OR REPLACE INTO learned_rules (id,symbol,strategy,session,side,condition,cause,observations,failures,failure_rate,mean_severity,status,reason,source,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)");
    for(const r of rules) stmt.run(r.id,"XAUUSD",r.strategy,r.session,r.side,r.condition,r.cause,r.observations,r.failures,r.failureRate,r.meanSeverity,r.status,r.reason,"XAUUSD_RESEARCH",Date.now());
  });
}

async function main(){
  if(!process.env.TWELVE_DATA_API_KEY) throw new Error("TWELVE_DATA_API_KEY is missing.");
  const candles=await fetchHistory();
  const baseline=runBacktest(candles,10000,0.5,undefined,false);
  const cycle=runResearchCycle(baseline.trades,candles);
  persistRules(cycle.rules);

  const counterfactuals=[];
  for(const trade of baseline.trades){
    if(trade.pnl>=0) continue;
    counterfactuals.push(evaluateRejectedTrade(trade.entryTime,trade.side,trade.entryPrice,trade.stopLoss,trade.takeProfit,candles));
  }

  const result={
    version:"0.5.16.0",
    instrument:"XAUUSD",
    timeframe:"5min",
    period:{start:START,end:END},
    architecture:["0.5.11 persistent loss memory","0.5.12 root-cause learning","0.5.13 counterfactual analysis","0.5.14 rule validation","0.5.15 regime policy","0.5.16 autonomous research cycle"],
    baseline:{trades:baseline.totalTrades,wins:baseline.wins,losses:baseline.losses,winRate:baseline.winRate,netPnl:baseline.netPnl,profitFactor:baseline.config?undefined:undefined},
    research:cycle,
    counterfactualSummary:{
      evaluated:counterfactuals.length,
      wouldHaveWon:counterfactuals.filter(x=>x.hypotheticalOutcome==="WOULD_HAVE_WON").length,
      wouldHaveLost:counterfactuals.filter(x=>x.hypotheticalOutcome==="WOULD_HAVE_LOST").length,
      unresolved:counterfactuals.filter(x=>x.hypotheticalOutcome==="UNRESOLVED").length
    },
    warnings:[
      "Root-cause rules are research candidates until they pass independent out-of-sample validation.",
      "Counterfactual results are hypothetical and do not represent executable fills.",
      "No live broker execution is enabled by this research cycle."
    ]
  };
  fs.mkdirSync("artifacts",{recursive:true});
  fs.writeFileSync("artifacts/xauusd-learning-cycle.json",JSON.stringify({...result,counterfactuals},null,2));
  fs.writeFileSync("artifacts/xauusd-learning-cycle.md",[
    "# NINE XAUUSD Autonomous Learning Cycle",
    "",
    `Period: ${START} to ${END}`,
    `Trades investigated: ${baseline.totalTrades}`,
    `Losses investigated: ${baseline.losses}`,
    `Root-cause findings: ${cycle.findings.length}`,
    `Rule candidates: ${cycle.rules.length}`,
    `Counterfactuals evaluated: ${counterfactuals.length}`,
    `Would have won: ${counterfactuals.filter(x=>x.hypotheticalOutcome==="WOULD_HAVE_WON").length}`,
    `Would have lost: ${counterfactuals.filter(x=>x.hypotheticalOutcome==="WOULD_HAVE_LOST").length}`,
    "",
    "## Rule Candidates",
    "",
    ...cycle.rules.map(r=>`- ${r.status}: ${r.strategy} | ${r.session} | ${r.side} | ${r.cause} | observations=${r.observations} | severity=${r.meanSeverity}`),
    "",
    "## Safety",
    "",
    ...result.warnings.map(w=>`- ${w}`)
  ].join("\n"));
  console.log(JSON.stringify(result,null,2));
}
main().catch(e=>{console.error(e instanceof Error?e.stack??e.message:String(e));process.exit(1);});
