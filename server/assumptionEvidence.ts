import {ASSUMPTION_KEYS,normalizeAssumptionEvidence} from './workflowValidation.js';

export function reviewAssumptionEvidence(assumptions:any){
 const records=normalizeAssumptionEvidence(assumptions.fieldEvidence);
 return ASSUMPTION_KEYS.map(key=>{
  const value=assumptions[key]??null,e=records[key]||null;
  const unused=key==='exitPriceNis'&&value==null||key==='annualAppreciationPct'&&assumptions.exitPriceNis!=null||['annualInterestRatePct','loanTermYears'].includes(key)&&assumptions.loanAmountNis===0;
  const status=unused?'not_used':!e?'missing':e.value!==value?'stale':e.sourceUrl&&e.observedAt&&e.notes?'documented':'assumption';
  return {key,value,status,evidence:e};
 });
}
