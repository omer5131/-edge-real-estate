export type DealAssumptions={
  purchasePriceNis:number;
  purchaseTaxNis?:number;
  legalFeesNis?:number;
  brokerFeesNis?:number;
  appraisalFeesNis?:number;
  renovationNis?:number;
  furnishingNis?:number;
  otherAcquisitionNis?:number;
  loanAmountNis?:number;
  annualInterestRatePct?:number;
  loanTermYears?:number;
  expectedMonthlyRentNis?:number;
  vacancyPct?:number;
  annualMaintenanceNis?:number;
  annualOtherOperatingNis?:number;
  exitYears?:number;
  annualAppreciationPct?:number;
  exitPriceNis?:number|null;
  saleCostsPct?:number;
  saleTaxNis?:number;
  targetAnnualReturnPct?:number;
};

export type DealOutputs={
  totalAcquisitionCostNis:number;
  equityRequiredNis:number;
  monthlyDebtServiceNis:number;
  annualDebtServiceNis:number;
  effectiveAnnualRentNis:number;
  annualOperatingExpensesNis:number;
  grossYieldPct:number|null;
  netYieldPct:number|null;
  annualCashFlowNis:number;
  monthlyCashFlowNis:number;
  cashOnCashPct:number|null;
  projectedExitValueNis:number;
  loanBalanceAtExitNis:number;
  projectedExitEquityNis:number;
  projectedProfitNis:number;
  irrPct:number|null;
  breakEvenMonthlyRentNis:number|null;
  maxPurchasePriceForTargetReturnNis:number|null;
};

const n=(v:unknown,d=0)=>{const x=Number(v);return Number.isFinite(x)?x:d};
const clamp=(v:number,min:number,max:number)=>Math.max(min,Math.min(max,v));
const pmt=(principal:number,annualRatePct:number,years:number)=>{
  if(principal<=0||years<=0)return 0;
  const months=Math.max(1,Math.round(years*12)),r=Math.max(0,annualRatePct)/100/12;
  if(r===0)return principal/months;
  return principal*r/(1-Math.pow(1+r,-months));
};
const balanceAfterMonths=(principal:number,annualRatePct:number,years:number,monthsElapsed:number)=>{
  if(principal<=0)return 0;
  const total=Math.max(1,Math.round(years*12)),elapsed=clamp(Math.round(monthsElapsed),0,total),r=Math.max(0,annualRatePct)/100/12;
  if(elapsed>=total)return 0;
  if(r===0)return principal*(1-elapsed/total);
  const payment=pmt(principal,annualRatePct,years);
  return Math.max(0,principal*Math.pow(1+r,elapsed)-payment*((Math.pow(1+r,elapsed)-1)/r));
};
const npv=(rate:number,cashflows:number[])=>cashflows.reduce((sum,cf,i)=>sum+cf/Math.pow(1+rate,i),0);
const irr=(cashflows:number[])=>{
  if(cashflows.length<2||!cashflows.some(x=>x<0)||!cashflows.some(x=>x>0))return null;
  let lo=-.99,hi=5;
  let flo=npv(lo,cashflows),fhi=npv(hi,cashflows);
  if(flo*fhi>0)return null;
  for(let i=0;i<120;i++){const mid=(lo+hi)/2,fm=npv(mid,cashflows);if(Math.abs(fm)<1e-7)return mid;if(flo*fm<=0){hi=mid;fhi=fm}else{lo=mid;flo=fm}}
  return (lo+hi)/2;
};

export function calculateDeal(a:DealAssumptions):DealOutputs{
  const purchase=Math.max(0,n(a.purchasePriceNis));
  const tax=Math.max(0,n(a.purchaseTaxNis)),legal=Math.max(0,n(a.legalFeesNis)),broker=Math.max(0,n(a.brokerFeesNis)),appraisal=Math.max(0,n(a.appraisalFeesNis));
  const renovation=Math.max(0,n(a.renovationNis)),furnishing=Math.max(0,n(a.furnishingNis)),other=Math.max(0,n(a.otherAcquisitionNis));
  const acquisitionCosts=tax+legal+broker+appraisal+renovation+furnishing+other;
  const total=purchase+acquisitionCosts;
  const loan=clamp(n(a.loanAmountNis),0,total);
  const rate=Math.max(0,n(a.annualInterestRatePct)),term=Math.max(0.01,n(a.loanTermYears,25));
  const monthlyDebt=pmt(loan,rate,term),annualDebt=monthlyDebt*12;
  const monthlyRent=Math.max(0,n(a.expectedMonthlyRentNis)),vacancy=clamp(n(a.vacancyPct),0,100)/100;
  const effectiveRent=monthlyRent*12*(1-vacancy);
  const opEx=Math.max(0,n(a.annualMaintenanceNis))+Math.max(0,n(a.annualOtherOperatingNis));
  const noi=effectiveRent-opEx;
  const annualCash=noi-annualDebt;
  const equity=Math.max(0,total-loan);
  const grossYield=purchase>0?monthlyRent*12/purchase*100:null;
  const netYield=total>0?noi/total*100:null;
  const coc=equity>0?annualCash/equity*100:null;
  const exitYears=Math.max(1,Math.round(n(a.exitYears,5)));
  const appreciation=n(a.annualAppreciationPct,2.5)/100;
  const exitValue=a.exitPriceNis!=null&&Number.isFinite(Number(a.exitPriceNis))?Math.max(0,Number(a.exitPriceNis)):purchase*Math.pow(1+appreciation,exitYears);
  const saleCosts=exitValue*clamp(n(a.saleCostsPct),0,100)/100+Math.max(0,n(a.saleTaxNis));
  const loanBalance=balanceAfterMonths(loan,rate,term,exitYears*12);
  const exitEquity=Math.max(0,exitValue-saleCosts-loanBalance);
  const yearly=[-equity];
  for(let y=1;y<=exitYears;y++)yearly.push(annualCash+(y===exitYears?exitEquity:0));
  const irrValue=irr(yearly);
  const breakEvenRent=(annualDebt+opEx)/(12*Math.max(.0001,1-vacancy));
  const target=n(a.targetAnnualReturnPct,8)/100;
  let maxPurchase:number|null=null;
  if(monthlyRent>0&&target>-0.99){
    let lo=0,hi=Math.max(purchase*3,1_000_000);
    const passes=(price:number)=>{
      const loanRatio=purchase>0?loan/purchase:0;
      const assumedLoan=Math.min(price*loanRatio,price+acquisitionCosts);
      const eq=Math.max(0,price+acquisitionCosts-assumedLoan);
      const md=pmt(assumedLoan,rate,term)*12;
      const cf=noi-md;
      const ev=price*Math.pow(1+appreciation,exitYears);
      const lb=balanceAfterMonths(assumedLoan,rate,term,exitYears*12);
      const ee=Math.max(0,ev-ev*clamp(n(a.saleCostsPct),0,100)/100-Math.max(0,n(a.saleTaxNis))-lb);
      const cfs=[-eq];for(let y=1;y<=exitYears;y++)cfs.push(cf+(y===exitYears?ee:0));
      const r=irr(cfs);return r!=null&&r>=target;
    };
    while(passes(hi)&&hi<100_000_000)hi*=1.5;
    for(let i=0;i<70;i++){const mid=(lo+hi)/2;if(passes(mid))lo=mid;else hi=mid}
    maxPurchase=lo>0?lo:null;
  }
  return {
    totalAcquisitionCostNis:Math.round(total),
    equityRequiredNis:Math.round(equity),
    monthlyDebtServiceNis:Math.round(monthlyDebt),
    annualDebtServiceNis:Math.round(annualDebt),
    effectiveAnnualRentNis:Math.round(effectiveRent),
    annualOperatingExpensesNis:Math.round(opEx),
    grossYieldPct:grossYield==null?null:Number(grossYield.toFixed(2)),
    netYieldPct:netYield==null?null:Number(netYield.toFixed(2)),
    annualCashFlowNis:Math.round(annualCash),
    monthlyCashFlowNis:Math.round(annualCash/12),
    cashOnCashPct:coc==null?null:Number(coc.toFixed(2)),
    projectedExitValueNis:Math.round(exitValue),
    loanBalanceAtExitNis:Math.round(loanBalance),
    projectedExitEquityNis:Math.round(exitEquity),
    projectedProfitNis:Math.round(exitEquity+annualCash*exitYears-equity),
    irrPct:irrValue==null?null:Number((irrValue*100).toFixed(2)),
    breakEvenMonthlyRentNis:Number.isFinite(breakEvenRent)?Math.round(breakEvenRent):null,
    maxPurchasePriceForTargetReturnNis:maxPurchase==null?null:Math.round(maxPurchase)
  };
}
