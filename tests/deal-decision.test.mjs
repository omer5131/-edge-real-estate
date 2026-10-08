import test from 'node:test';
import assert from 'node:assert/strict';
import {workflowFixture,listingId,otherListingId,assumptions} from './workflow-fixture.mjs';
import {buildDecisionReview} from '../.server-test/server/dealDecision.js';
import {calculateDeal} from '../.server-test/server/dealEngine.js';
const makeBundle=()=>({deal:{id:'deal',listing_id:listingId,next_action:null},scenarios:[{id:'scenario',name:'בסיס',assumptions,outputs:calculateDeal(assumptions),calculation_version:'deal-engine-v1'}],dueDiligence:[],tasks:[],taskSchemaReady:true});
test('Decision evidence never treats absent checks, undated verification or completed tasks as approval',()=>{
 const b=makeBundle();b.dueDiligence=[{id:'dd',item_key:'ownership',label:'זכויות',status:'verified',notes:'נבדק',evidence:[{url:'https://example.com/deed'}]}];b.tasks=[{id:'done',status:'done'},{id:'late',status:'todo',title:'שיחה',due_date:'2026-10-01'},{id:'today',status:'todo',title:'ביקור',due_date:'2026-10-08'}];
 let r=buildDecisionReview(b,'scenario',undefined,new Date('2026-10-08T05:00:00Z'));assert.equal(r.evidence.status,'provisional');assert.equal(r.unresolvedCheckCount,9);assert.equal(r.checks[0].recordedVerification,false);assert.equal(r.openTasks.length,2);assert.equal(r.openTasks[0].overdue,true);assert.equal(r.openTasks[1].overdue,false);
 b.dueDiligence[0].evidence[0].observedAt='2026-10-08';r=buildDecisionReview(b,'scenario');assert.equal(r.unresolvedCheckCount,8);assert.equal(r.checks[0].recordedVerification,true);
 b.taskSchemaReady=false;assert.equal(buildDecisionReview(b,'scenario').openTasks,null);
});
test('Saved values remain missing and explicit exit assumptions suppress incompatible maximum-price output',()=>{
 const b=makeBundle();b.scenarios[0].outputs={};let r=buildDecisionReview(b,'scenario');assert.equal(r.financials.monthlyCashFlowNis,null);assert.equal(r.flags.negativeCashFlow,null);assert.equal(r.flags.aboveModelPrice,null);
 b.scenarios[0].assumptions={...assumptions,exitPriceNis:1500000};b.scenarios[0].outputs=calculateDeal(b.scenarios[0].assumptions);r=buildDecisionReview(b,'scenario');assert.equal(r.financials.maxPurchasePriceForTargetReturnNis,null);assert.match(r.evidence.notes.join(' '),/מחיר יציאה מפורש/);
 assert.throws(()=>buildDecisionReview(b,'missing'),/scenario_not_found/);for(const v of [0,-1,NaN,Infinity])assert.throws(()=>buildDecisionReview(b,'scenario',v),/invalid_offer_preview/);
});
test('Server offer preview uses selected scenario, preserves zero debt and makes no database writes',async()=>{
 const {db,service:s}=await workflowFixture();try{
 const deal=await s.createDealForListing(listingId),other=await s.createDealForListing(otherListingId);
 const base=await s.saveScenario({deal_id:deal.id,name:'בסיס',is_primary:true,assumptions});const second=await s.saveScenario({deal_id:deal.id,name:'חלופה',assumptions:{...assumptions,loanAmountNis:400000}});
 const before=await s.getDealBundle({dealId:deal.id});let r=await s.getDecisionReview({dealId:deal.id,listingId,scenarioId:base.id,offerPrice:950000});assert.equal(r.basis,'offer_preview');assert.equal(r.financials.purchasePriceNis,950000);assert.equal(r.financials.totalAcquisitionCostNis,1084500);assert.equal(r.financials.loanAmountNis,0);assert.equal(r.financials.monthlyDebtServiceNis,0);
 r=await s.getDecisionReview({dealId:deal.id,listingId,scenarioId:second.id});assert.equal(r.scenarioId,second.id);assert.equal(r.financials.loanAmountNis,400000);
 await assert.rejects(()=>s.getDecisionReview({dealId:other.id,listingId:otherListingId,scenarioId:base.id}),/scenario_not_found/);await assert.rejects(()=>s.getDecisionReview({dealId:other.id,listingId,scenarioId:base.id}),/deal_listing_mismatch/);
 assert.deepEqual(await s.getDealBundle({dealId:deal.id}),before);
 }finally{await db.close()}
});
test('Field evidence stays bound to a numeric value and legacy sources do not attest every assumption',()=>{
 const b=makeBundle();let r=buildDecisionReview(b,'scenario');assert.equal(r.fieldEvidence.find(x=>x.key==='expectedMonthlyRentNis').status,'missing');
 b.scenarios[0].assumptions={...assumptions,fieldEvidence:{expectedMonthlyRentNis:{value:4500,sourceUrl:'https://example.com/rent',observedAt:'2026-10-08',notes:'דירה מקבילה; יש לבדוק התאמה'},loanAmountNis:{value:0,sourceUrl:null,observedAt:null,notes:'רכישה ללא הלוואה'}}};
 r=buildDecisionReview(b,'scenario');assert.equal(r.fieldEvidence.find(x=>x.key==='expectedMonthlyRentNis').status,'documented');assert.equal(r.fieldEvidence.find(x=>x.key==='loanAmountNis').status,'assumption');assert.equal(r.fieldEvidence.find(x=>x.key==='annualInterestRatePct').status,'not_used');assert.equal(r.fieldEvidence.find(x=>x.key==='exitPriceNis').status,'not_used');
 b.scenarios[0].assumptions.expectedMonthlyRentNis=4600;r=buildDecisionReview(b,'scenario');assert.equal(r.fieldEvidence.find(x=>x.key==='expectedMonthlyRentNis').status,'stale');assert.equal(r.assumptionEvidenceSummary.stale,1);
 b.scenarios[0].assumptions.fieldEvidence.purchasePriceNis={value:1000000,sourceUrl:'https://example.com/ask',observedAt:'2026-10-08',notes:'מחיר מודעה'};r=buildDecisionReview(b,'scenario',950000);assert.equal(r.fieldEvidence.find(x=>x.key==='purchasePriceNis').status,'stale');
});
test('Invalid field sources cannot alter an existing persisted scenario',async()=>{
 const {db,service:s}=await workflowFixture();try{
 const deal=await s.createDealForListing(listingId),saved=await s.saveScenario({deal_id:deal.id,assumptions}),before=await s.getDealBundle({dealId:deal.id});
 for(const fieldEvidence of [{unknown:{value:1}}, {expectedMonthlyRentNis:{value:'4500'}},{expectedMonthlyRentNis:{value:4500,sourceUrl:'javascript:alert(1)'}},{expectedMonthlyRentNis:{value:4500,sourceUrl:'https://example.com/rent',notes:'ללא תאריך'}},{expectedMonthlyRentNis:{value:4500,sourceUrl:'https://example.com/rent',notes:'בדיקה',observedAt:'2026-02-30'}}])await assert.rejects(()=>s.saveScenario({deal_id:deal.id,scenario_id:saved.id,assumptions:{...assumptions,fieldEvidence}}));
 assert.deepEqual(await s.getDealBundle({dealId:deal.id}),before);
 }finally{await db.close()}
});
test('PostgreSQL persistence retains field evidence across refresh and older clients while recalculating unchanged finance',async()=>{
 const {db,service:s}=await workflowFixture();try{
 const deal=await s.createDealForListing(listingId),fieldEvidence={expectedMonthlyRentNis:{value:4500,sourceUrl:'https://example.com/rent',observedAt:'2026-10-08',notes:'מקור שכירות'}};
 const saved=await s.saveScenario({deal_id:deal.id,name:'מתועד',assumptions:{...assumptions,fieldEvidence}});assert.deepEqual(saved.outputs,calculateDeal(assumptions));
 const older=await s.saveScenario({deal_id:deal.id,scenario_id:saved.id,name:'עדכון',assumptions:{...assumptions,expectedMonthlyRentNis:4600}});assert.deepEqual(older.assumptions.fieldEvidence,fieldEvidence);
 let r=await s.getDecisionReview({dealId:deal.id,listingId,scenarioId:saved.id});assert.equal(r.fieldEvidence.find(x=>x.key==='expectedMonthlyRentNis').status,'stale');
 await s.saveScenario({deal_id:deal.id,scenario_id:saved.id,assumptions:{...older.assumptions,fieldEvidence:{...fieldEvidence,expectedMonthlyRentNis:{...fieldEvidence.expectedMonthlyRentNis,value:4600}}}});r=await s.getDecisionReview({dealId:deal.id,listingId,scenarioId:saved.id});assert.equal(r.fieldEvidence.find(x=>x.key==='expectedMonthlyRentNis').status,'documented');
 }finally{await db.close()}
});
