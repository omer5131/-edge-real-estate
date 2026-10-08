import {calculateDeal} from './dealEngine.js';
import {scenarioAssumptions,sourceUrl,isoDate} from './workflowValidation.js';

// A review of user-recorded evidence, never an approval of an asset or its rights.
const requiredChecks=['listing_identity','ownership','encumbrances','permit_match','building_condition','renewal_status','physical_condition','financing','taxes_costs'];
const numberOrNull=(v:unknown)=>v==null||v===''||!Number.isFinite(Number(v))?null:Number(v);
export function buildDecisionReview(bundle:any,scenarioId:string,offerPrice?:number,now=new Date()){
 const scenario=bundle.scenarios.find((s:any)=>s.id===scenarioId);
 if(!scenario)throw Error('scenario_not_found');
 const assumptions=scenarioAssumptions(scenario.assumptions);
 if(offerPrice!==undefined&&(!Number.isFinite(offerPrice)||offerPrice<=0))throw Error('invalid_offer_preview');
 const preview=offerPrice!==undefined;
 // Loan and all fees remain explicit fixed assumptions; no inferred tax/financing approval.
 const effective=preview?scenarioAssumptions({...assumptions,purchasePriceNis:offerPrice}):assumptions;
 const outputs=preview?calculateDeal(effective as any):scenario.outputs||{};
 const checks=(bundle.dueDiligence||[]).map((d:any)=>{
  const sources=(Array.isArray(d.evidence)?d.evidence:[]).flatMap((e:any)=>{try{const url=sourceUrl(e.url),observedAt=isoDate(e.observedAt);return url?[{url,title:String(e.title||'מקור'),observedAt}]:[];}catch{return [];}});
  const recordedVerification=d.status==='verified'&&Boolean(d.notes?.trim())&&sources.some((s:any)=>s.observedAt);
  return {id:d.id,key:d.item_key,label:d.label,status:d.status,notes:d.notes||null,sources,recordedVerification,needsReview:d.status!=='not_applicable'&&!recordedVerification};
 });
 const missingChecks=requiredChecks.filter(key=>!checks.some((c:any)=>c.key===key));
 const today=now.toLocaleDateString('en-CA',{timeZone:'Asia/Jerusalem'});
 const openTasks=(bundle.tasks||[]).filter((t:any)=>!['done','cancelled'].includes(t.status)).map((t:any)=>({id:t.id,title:t.title,assignee:t.assignee||null,dueDate:t.due_date?String(t.due_date).slice(0,10):null,overdue:Boolean(t.due_date&&String(t.due_date).slice(0,10)<today)}));
 const limitations=['הסיכום מתייחס לתרחיש השמור ולבדיקות שתיעדת; הוא אינו אישור לרכישה או אימות מקצועי.','יכולת ההון העצמי אינה ידועה. עלויות נוספות ורזרבה שמורות יחד ואינן רזרבה נפרדת מאומתת.'];
 if(preview)limitations.push('בתצוגת ההצעה רק מחיר הרכישה משתנה. ההלוואה, המסים והעמלות נשארים כפי שנשמרו; יש לעדכן אותם בתרחיש אם הם תלויים במחיר.');
 if(!assumptions.evidence.sourceUrl||!assumptions.evidence.observedAt)limitations.push('חסר מקור מתוארך להנחות התרחיש.');
 if(bundle.taskSchemaReady===false)limitations.push('מידע המשימות אינו זמין; אין להסיק שאין משימות פתוחות.');
 if(effective.exitPriceNis!=null)limitations.push('מחיר מרבי אינו מוצג: מודל המחיר המרבי אינו משתמש במחיר יציאה מפורש.');
 const maxPrice=effective.exitPriceNis==null?numberOrNull(outputs.maxPurchasePriceForTargetReturnNis):null;
 if(maxPrice!=null)limitations.push('המחיר המרבי הוא תוצאת מודל: הוא שומר יחס הלוואה למחיר, עלויות קבועות ועליית ערך משוערת; אינו תקרת מימון מאושרת או שווי שמאי.');
 const purchasePrice=numberOrNull(effective.purchasePriceNis),irr=numberOrNull(outputs.irrPct),cashFlow=numberOrNull(outputs.monthlyCashFlowNis);
 return {
  version:'decision-review-v1',dealId:bundle.deal.id,listingId:bundle.deal.listing_id,scenarioId:scenario.id,scenarioName:scenario.name,
  basis:preview?'offer_preview':'saved_scenario',calculationVersion:preview?'deal-engine-v1':scenario.calculation_version,calculatedAt:preview?now.toISOString():scenario.calculated_at,scenarioCalculatedAt:scenario.calculated_at,
  reviewedAt:now.toISOString(),evidence:{status:'provisional',sourceIds:['deal_scenarios','due_diligence_items','deal_tasks'],notes:limitations},
  financials:{purchasePriceNis:purchasePrice,totalAcquisitionCostNis:numberOrNull(outputs.totalAcquisitionCostNis),equityRequiredNis:numberOrNull(outputs.equityRequiredNis),loanAmountNis:effective.loanAmountNis,monthlyDebtServiceNis:numberOrNull(outputs.monthlyDebtServiceNis),monthlyCashFlowNis:cashFlow,irrPct:irr,targetAnnualReturnPct:effective.targetAnnualReturnPct,maxPurchasePriceForTargetReturnNis:maxPrice,otherAcquisitionAndReserveNis:effective.otherAcquisitionNis},
  flags:{aboveModelPrice:maxPrice==null||purchasePrice==null?null:purchasePrice>maxPrice,belowTargetReturn:irr==null?null:irr<Number(effective.targetAnnualReturnPct),negativeCashFlow:cashFlow==null?null:cashFlow<0},
  assumptionEvidence:assumptions.evidence,checks,missingChecks,openTasks:bundle.taskSchemaReady===false?null:openTasks,
  unresolvedCheckCount:checks.filter((c:any)=>c.needsReview).length+missingChecks.length,
  nextAction:bundle.deal.next_action||null
 };
}
