export type ScoreWeights = Record<'deal'|'market'|'renewal'|'demographics'|'rental'|'infrastructure'|'supply',number>;

export type ScoreModel = {
  version:string;
  weights:ScoreWeights;
  parameters:{
    bayesian_k:number;
    minimum_component_coverage_pct:number;
    deal_max_age_days:number;
    confidence:{high:number;medium:number;low:number};
  };
};

export type WeightedDeal = {
  score:number;
  ageDays:number;
  confidenceWeight:number;
};

export function clamp(value:number,min=0,max=100){
  return Math.max(min,Math.min(max,value));
}

export function freshnessWeight(ageDays:number){
  if(ageDays<=7)return 1;
  if(ageDays<=14)return .9;
  if(ageDays<=30)return .75;
  if(ageDays<=60)return .5;
  return 0;
}

export function weightedDealScore(deals:WeightedDeal[]){
  let numerator=0,denominator=0,count=0;
  for(const d of deals){
    const fw=freshnessWeight(d.ageDays);
    const cw=clamp(d.confidenceWeight,0,1);
    const w=fw*cw;
    if(w<=0)continue;
    numerator+=clamp(d.score)*w;
    denominator+=w;
    count++;
  }
  return {score:denominator?numerator/denominator:null,count,weight:denominator};
}

export function bayesianAdjust(localScore:number|null,localCount:number,priorScore:number|null,k:number){
  if(localScore==null)return priorScore;
  if(priorScore==null)return localScore;
  const n=Math.max(0,localCount),prior=Math.max(0,k);
  return (n/(n+prior))*localScore+(prior/(n+prior))*priorScore;
}

export function weightedAreaScore(
  components:Partial<Record<keyof ScoreWeights,number|null>>,
  weights:ScoreWeights,
  minimumCoveragePct:number
){
  const totalWeight=Object.values(weights).reduce((a,b)=>a+b,0);
  let availableWeight=0,weighted=0;
  const normalized:Record<string,number|null>={};
  for(const [key,weight] of Object.entries(weights)){
    const raw=components[key as keyof ScoreWeights];
    const value=raw==null||Number.isNaN(Number(raw))?null:clamp(Number(raw));
    normalized[key]=value;
    if(value==null)continue;
    availableWeight+=weight;
    weighted+=value*weight;
  }
  const coveragePct=totalWeight?100*availableWeight/totalWeight:0;
  if(coveragePct<minimumCoveragePct)return {score:null,coveragePct,components:normalized};
  return {score:availableWeight?weighted/availableWeight:null,coveragePct,components:normalized};
}

export function confidenceLevel(score:number|null,thresholds:{high:number;medium:number;low:number}){
  if(score==null||score<thresholds.low)return 'insufficient' as const;
  if(score>=thresholds.high)return 'high' as const;
  if(score>=thresholds.medium)return 'medium' as const;
  return 'low' as const;
}

export function percentileRank(values:number[],value:number){
  const usable=values.filter(v=>Number.isFinite(v)).sort((a,b)=>a-b);
  if(!usable.length)return null;
  let below=0,equal=0;
  for(const v of usable){if(v<value)below++;else if(v===value)equal++;}
  return 100*(below+.5*equal)/usable.length;
}
