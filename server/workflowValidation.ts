export function sourceUrl(value:unknown){
 if(value==null||value==='')return null;
 try{const u=new URL(String(value));if(!['http:','https:'].includes(u.protocol)||u.username||u.password)throw Error();return u.href;}catch{throw Error('invalid_source_url')}
}
export function isoDate(value:unknown){
 if(value==null||value==='')return null;
 const s=String(value),d=new Date(s+'T00:00:00Z');if(!/^\d{4}-\d{2}-\d{2}$/.test(s)||!Number.isFinite(d.getTime())||d.toISOString().slice(0,10)!==s)throw Error('invalid_date');return s;
}
export function ddEvidence(input:unknown){
 if(!Array.isArray(input))return [];
 if(input.length>30)throw Error('too_many_sources');
 return input.map((x:any)=>{const url=sourceUrl(x?.url);if(!url)throw Error('source_url_required');return {url,title:String(x.title||'מקור').slice(0,300),observedAt:isoDate(x.observedAt),note:String(x.note||'').slice(0,2000)};});
}
export function scenarioAssumptions(value:any): import('./dealEngine.js').DealAssumptions & {evidence:{notes:string;sourceUrl:string|null;observedAt:string|null}}{
 if(!value||typeof value!=='object'||Array.isArray(value))throw Error('assumptions_required');
 const keys=['purchasePriceNis','purchaseTaxNis','legalFeesNis','brokerFeesNis','appraisalFeesNis','renovationNis','furnishingNis','otherAcquisitionNis','loanAmountNis','annualInterestRatePct','loanTermYears','expectedMonthlyRentNis','vacancyPct','annualMaintenanceNis','annualOtherOperatingNis','exitYears','annualAppreciationPct','exitPriceNis','saleCostsPct','saleTaxNis','targetAnnualReturnPct'];
 const a:Record<string,number|null>={};for(const key of keys){const v=value[key];if(key==='exitPriceNis'&&(v==null||v==='')){a[key]=null;continue;}if(v==null||v===''||!Number.isFinite(Number(v)))throw Error('assumption_required:'+key);a[key]=Number(v);}
 if(Number(a.purchasePriceNis)<=0||Number(a.loanTermYears)<=0||Number(a.exitYears)<1||Number(a.exitYears)>50)throw Error('invalid_scenario_range');
 for(const key of keys){if(!['annualAppreciationPct','targetAnnualReturnPct','exitPriceNis'].includes(key)&&Number(a[key])<0)throw Error('negative_assumption:'+key);}
 if(Number(a.vacancyPct)>100||Number(a.saleCostsPct)>100||Number(a.loanAmountNis)>Number(a.purchasePriceNis)+keys.filter(k=>['purchaseTaxNis','legalFeesNis','brokerFeesNis','appraisalFeesNis','renovationNis','furnishingNis','otherAcquisitionNis'].includes(k)).reduce((n,k)=>n+Number(a[k]),0))throw Error('invalid_scenario_range');
 if(a.exitPriceNis!=null&&a.exitPriceNis<=0)throw Error('invalid_exit_price');
 if(Number(a.annualAppreciationPct)<-100||Number(a.targetAnnualReturnPct)<=-100||Number(a.loanTermYears)>100||!Number.isInteger(a.exitYears))throw Error('invalid_scenario_range');
 return {...a,evidence:{notes:String(value.evidence?.notes||'').slice(0,3000),sourceUrl:sourceUrl(value.evidence?.sourceUrl),observedAt:isoDate(value.evidence?.observedAt)}} as import('./dealEngine.js').DealAssumptions & {evidence:{notes:string;sourceUrl:string|null;observedAt:string|null}};
}
