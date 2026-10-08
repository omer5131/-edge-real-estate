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
