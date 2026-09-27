import { getStoreSnapshot } from "./store";
import { MarketSnapshot, NINEOrchestration, PaperAccount, SentinelDecision, SentinelGateResult, SentinelRiskSnapshot, TradingSetup } from "./types";

function finitePositive(value:number|null|undefined):boolean { return typeof value === "number" && Number.isFinite(value) && value > 0; }
function openNotional(account:PaperAccount):number { return account.positions.filter(p=>p.status==="OPEN").reduce((sum,p)=>sum+p.quantity*p.entryPrice,0); }
function consecutiveLosses():number {
  const events=getStoreSnapshot().events.filter(e=>e.type==="PAPER_CLOSE").sort((a,b)=>b.timestamp-a.timestamp);
  let count=0;
  for(const event of events){const pnl=Number(event.metadata?.pnl); if(!Number.isFinite(pnl)) continue; if(pnl<0) count+=1; else break;}
  return count;
}
export function buildRiskSnapshot(_market:MarketSnapshot, setup:TradingSetup, account:PaperAccount):SentinelRiskSnapshot {
  const equity=Math.max(0,account.equity);
  const proposedQuantity=Math.max(0,Number(process.env.NINE_DEFAULT_ORDER_QUANTITY??0.01));
  const proposedNotional=setup.entry&&setup.direction!=="NONE"?Math.abs(setup.entry)*proposedQuantity:0;
  const notional=openNotional(account)+proposedNotional;
  const dailyLossPercent=account.dailyStartBalance>0?Math.max(0,(-account.dailyRealizedPnl/account.dailyStartBalance)*100):0;
  const drawdownPercent=account.peakEquity>0?Math.max(0,((account.peakEquity-equity)/account.peakEquity)*100):0;
  const projectedLoss=setup.entry!==null&&setup.stopLoss!==null?Math.abs(setup.entry-setup.stopLoss)*proposedQuantity:0;
  return {equity,openPositions:account.positions.filter(p=>p.status==="OPEN").length,openNotional:notional,dailyRealizedPnl:account.dailyRealizedPnl,dailyLossPercent,drawdownPercent,projectedLoss,riskPercent:setup.risk.riskPercent,maxRiskPercent:setup.risk.maxRiskPercent,exposurePercent:equity>0?(notional/equity)*100:100,proposedQuantity,proposedNotional};
}
export function evaluateSentinel(market:MarketSnapshot,setup:TradingSetup,account:PaperAccount):SentinelGateResult {
  const risk=buildRiskSnapshot(market,setup,account), checks:string[]=[], blockers:string[]=[], reasonCodes:string[]=[];
  const maxOpen=Math.max(1,Number(process.env.NINE_PAPER_MAX_OPEN_POSITIONS??3));
  const maxDailyLoss=Math.max(0.1,Number(process.env.NINE_MAX_DAILY_LOSS_PERCENT??2));
  const maxDrawdown=Math.max(0.1,Number(process.env.NINE_MAX_DRAWDOWN_PERCENT??5));
  const maxExposure=Math.max(1,Number(process.env.NINE_MAX_EXPOSURE_PERCENT??100));
  const maxConsecutiveLosses=Math.max(1,Number(process.env.NINE_MAX_CONSECUTIVE_LOSSES??3));
  const staleSeconds=Math.max(5,Number(process.env.NINE_MARKET_STALE_SECONDS??20));
  const feedAge=market.timestamp?(Date.now()-market.timestamp)/1000:Infinity;
  if(market.tradingAllowed===true&&market.marketState?.tradingPermission==="ALLOWED"&&market.marketState?.dataState==="LIVE"&&feedAge<=staleSeconds) checks.push("Validated live market data ✓"); else {blockers.push("Market data feed is missing, stale, suspicious, or otherwise blocked.");reasonCodes.push("MARKET_DATA_BLOCKED");}
  if(setup.validation.valid&&setup.status==="VALID") checks.push("Trading engine validation ✓"); else {blockers.push(setup.validation.blockers[0]??"Trading setup did not pass engine validation.");reasonCodes.push("ENGINE_VALIDATION_FAILED");}
  if(setup.direction!=="NONE") checks.push("Trade direction confirmed ✓"); else {blockers.push("No trade direction is confirmed.");reasonCodes.push("NO_DIRECTION");}
  if(setup.entry!==null&&setup.stopLoss!==null&&setup.takeProfit!==null&&finitePositive(setup.entry)&&finitePositive(setup.stopLoss)&&finitePositive(setup.takeProfit)){
    const validGeometry=setup.direction==="LONG"?setup.stopLoss<setup.entry&&setup.takeProfit>setup.entry:setup.stopLoss>setup.entry&&setup.takeProfit<setup.entry;
    if(validGeometry) checks.push("Trade geometry valid ✓"); else {blockers.push("Trade geometry does not match the direction.");reasonCodes.push("INVALID_GEOMETRY");}
  } else {blockers.push("Entry, stop loss, and take profit are required.");reasonCodes.push("MISSING_TRADE_GEOMETRY");}
  if(setup.risk.allowed&&setup.risk.riskPercent<=setup.risk.maxRiskPercent) checks.push("Risk budget ✓"); else {blockers.push(setup.risk.reason);reasonCodes.push("RISK_BUDGET_BLOCKED");}
  if(risk.openPositions<maxOpen) checks.push(`Open-position limit ${risk.openPositions}/${maxOpen} ✓`); else {blockers.push(`Maximum of ${maxOpen} open positions reached.`);reasonCodes.push("OPEN_POSITION_LIMIT");}
  if(risk.dailyLossPercent<maxDailyLoss) checks.push(`Daily loss ${risk.dailyLossPercent.toFixed(2)}% ✓`); else {blockers.push(`Daily loss limit of ${maxDailyLoss}% reached.`);reasonCodes.push("DAILY_LOSS_LIMIT");}
  if(risk.drawdownPercent<maxDrawdown) checks.push(`Drawdown ${risk.drawdownPercent.toFixed(2)}% ✓`); else {blockers.push(`Maximum drawdown of ${maxDrawdown}% reached.`);reasonCodes.push("DRAWDOWN_LIMIT");}
  if(risk.exposurePercent<=maxExposure) checks.push(`Exposure ${risk.exposurePercent.toFixed(2)}% ✓`); else {blockers.push(`Maximum exposure of ${maxExposure}% exceeded.`);reasonCodes.push("EXPOSURE_LIMIT");}
  const losses=consecutiveLosses();
  if(losses<maxConsecutiveLosses) checks.push(`Consecutive-loss guard ${losses}/${maxConsecutiveLosses} ✓`); else {blockers.push(`Consecutive-loss guard reached ${maxConsecutiveLosses} losses.`);reasonCodes.push("CONSECUTIVE_LOSS_LIMIT");}
  const approved=blockers.length===0;
  return {approved,reason:approved?"All Sentinel gates passed.":blockers[0],checks:[...checks,...blockers.map(x=>`BLOCK: ${x}`)],risk};
}
export function sentinelDecision(market:MarketSnapshot,setup:TradingSetup,account:PaperAccount):SentinelDecision {
  const result=evaluateSentinel(market,setup,account);
  const reasonCodes:string[]=[];
  for(const item of result.checks.filter(x=>x.startsWith("BLOCK:"))){ if(item.includes("Market data")) reasonCodes.push("MARKET_DATA_BLOCKED"); else if(item.includes("validation")) reasonCodes.push("ENGINE_VALIDATION_FAILED"); else if(item.includes("direction")) reasonCodes.push("NO_DIRECTION"); else if(item.includes("geometry")) reasonCodes.push("INVALID_GEOMETRY"); else if(item.includes("Risk")) reasonCodes.push("RISK_BUDGET_BLOCKED"); else if(item.includes("open positions")) reasonCodes.push("OPEN_POSITION_LIMIT"); else if(item.includes("Daily")) reasonCodes.push("DAILY_LOSS_LIMIT"); else if(item.includes("drawdown")) reasonCodes.push("DRAWDOWN_LIMIT"); else if(item.includes("exposure")) reasonCodes.push("EXPOSURE_LIMIT"); else if(item.includes("Consecutive")) reasonCodes.push("CONSECUTIVE_LOSS_LIMIT"); }
  return {approved:result.approved,reason:result.reason,checks:result.checks,risk:result.risk,blockers:result.checks.filter(x=>x.startsWith("BLOCK:")),reasonCodes:[...new Set(reasonCodes)]};
}
export function sentinelCanExecute(orchestration:NINEOrchestration):boolean { return orchestration.sentinel.approved&&orchestration.setup.status==="VALID"&&orchestration.setup.validation.valid; }