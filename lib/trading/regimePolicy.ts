export type LearningRegime="TRENDING_UP"|"TRENDING_DOWN"|"RANGING"|"EXPANDING"|"TRANSITION"|"UNKNOWN";

export interface RegimePolicy {
  regime: LearningRegime;
  allowedFamilies: string[];
  minimumScore: number;
  riskMultiplier: number;
  reason: string;
}

export function policyForRegime(regime: LearningRegime): RegimePolicy {
  switch(regime){
    case "TRENDING_UP":
    case "TRENDING_DOWN": return {regime,allowedFamilies:["EMA pullback continuation","breakout continuation","breakout-retest continuation","FVG continuation","order-block retest","volatility expansion momentum"],minimumScore:8,riskMultiplier:1,reason:"Trend regime requires continuation evidence."};
    case "RANGING": return {regime,allowedFamilies:["mean-reversion sweep","previous-day-low sweep reversal","previous-day-high sweep reversal","Asia-range sweep reversal"],minimumScore:8,riskMultiplier:0.7,reason:"Range regime favors rejection/mean-reversion evidence."};
    case "EXPANDING": return {regime,allowedFamilies:["opening-range breakout","breakout continuation","breakout-retest continuation","volatility expansion momentum"],minimumScore:9,riskMultiplier:0.8,reason:"Expansion regime requires confirmed breakout/momentum."};
    case "TRANSITION": return {regime,allowedFamilies:[],minimumScore:10,riskMultiplier:0,reason:"Transition is intentionally no-trade until direction stabilizes."};
    default: return {regime,allowedFamilies:[],minimumScore:10,riskMultiplier:0,reason:"Unknown regime is not tradeable without evidence."};
  }
}
