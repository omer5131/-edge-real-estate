import test from 'node:test';
import assert from 'node:assert/strict';
import {workflowFixture,listingId,otherListingId,assumptions} from './workflow-fixture.mjs';
import {createWorkflowService} from '../.server-test/server/dealWorkflow.js';
import {listingLifecycle} from '../.server-test/server/listingLifecycle.js';
import {sourceUrl,isoDate,scenarioAssumptions} from '../.server-test/server/workflowValidation.js';
test('Observed lifecycle never turns a single snapshot into known DOM',()=>{for(const [n,span,days] of [[0,null,null],[1,30,null],[2,0,null],[2,.9,null],[2,1,1],[3,5.8,5]])assert.equal(listingLifecycle(n,span).daysOnMarket,days);});
test('Sources, dates and assumptions reject unsafe or ambiguous values',()=>{assert.throws(()=>sourceUrl('javascript:alert(1)'));assert.throws(()=>sourceUrl('https://user:pass@example.com'));for(const d of ['2026-02-30','2026-99-01','yesterday'])assert.throws(()=>isoDate(d),/invalid_date/);assert.throws(()=>scenarioAssumptions({...assumptions,loanAmountNis:''}),/assumption_required/);assert.throws(()=>scenarioAssumptions({...assumptions,annualAppreciationPct:-101}),/range/);assert.equal(scenarioAssumptions(assumptions).loanAmountNis,0);});
test('Actual workflow SQL persists deal, notes, evidence, independent tasks, scenarios and stages',async()=>{
 const {db,service:s}=await workflowFixture();try{
  const deal=await s.createDealForListing(listingId),other=await s.createDealForListing(otherListingId);assert.equal((await s.createDealForListing(listingId)).id,deal.id);
  await assert.rejects(()=>s.getDealBundle({dealId:other.id,listingId}),/deal_listing_mismatch/);
  let b=await s.getDealBundle({dealId:deal.id});assert.equal(b.dueDiligence.length,9);assert.equal(b.taskSchemaReady,true);
  const note=await s.saveNote({deal_id:deal.id,content:'שיחת מוכר',category:'seller',evidence_url:'https://example.com/call'});assert.equal(note.content,'שיחת מוכר');
  const dd=b.dueDiligence.find(x=>x.item_key==='listing_identity');await assert.rejects(()=>s.updateDueDiligence({deal_id:deal.id,item_id:dd.id,status:'verified'}),/requires/);
  const evidence=[{url:'https://example.com/identity',title:'מקור מדויק',observedAt:'2026-10-05'}];await s.updateDueDiligence({deal_id:deal.id,item_id:dd.id,status:'in_progress',notes:'נדרשת כתובת מלאה',evidence});
  await assert.rejects(()=>s.saveTask({deal_id:deal.id,title:'אמת כתובת',status:'done'}),/result_required/);
  await assert.rejects(()=>s.saveTask({deal_id:other.id,title:'בדיקה זרה',dd_item_id:dd.id}),/dd_item_not_found/);
  const task=await s.saveTask({deal_id:deal.id,title:'אמת כתובת',dd_item_id:dd.id,assignee:'בודק',due_date:'2026-10-10',source_url:evidence[0].url});await s.saveTask({...task,due_date:'2026-10-10',task_id:task.id,deal_id:deal.id,status:'done',result:'המוכר מסר כתובת; עדיין נדרש מסמך'});
  b=await s.getDealBundle({dealId:deal.id});assert.equal(b.tasks[0].status,'done');assert.equal(b.dueDiligence.find(x=>x.id===dd.id).status,'in_progress');assert.equal(b.dueDiligence.find(x=>x.id===dd.id).evidence[0].observedAt,'2026-10-05');assert.equal(b.notes[0].evidence_url,'https://example.com/call');
  const base=await s.saveScenario({deal_id:deal.id,name:'ללא הלוואה',scenario_type:'base',is_primary:true,assumptions});assert.equal(base.assumptions.loanAmountNis,0);assert.equal(base.outputs.monthlyDebtServiceNis,0);assert.equal(base.outputs.totalAcquisitionCostNis,1134500);assert.equal(base.assumptions.evidence.sourceUrl,assumptions.evidence.sourceUrl);
  const conservative=await s.saveScenario({deal_id:deal.id,name:'שמרני',scenario_type:'conservative',is_primary:true,assumptions:{...assumptions,loanAmountNis:500000,annualAppreciationPct:0}});assert.notEqual(conservative.outputs.monthlyDebtServiceNis,0);
  await s.saveScenario({deal_id:deal.id,scenario_id:base.id,name:'עודכן',scenario_type:'base',is_primary:true,assumptions});b=await s.getDealBundle({dealId:deal.id});assert.equal(b.scenarios.length,2);assert.equal(b.scenarios.filter(x=>x.is_primary).length,1);assert.equal(b.scenarios.find(x=>x.is_primary).id,base.id);
  await assert.rejects(()=>s.saveScenario({deal_id:deal.id,scenario_id:conservative.id.replace(/^./,'0'),is_primary:true,assumptions}),/not_found/);assert.equal((await s.getDealBundle({dealId:deal.id})).scenarios.find(x=>x.is_primary).id,base.id);
  await assert.rejects(()=>s.setDealStage(deal.id,'Rejected',''),/reason_required/);await s.setDealStage(deal.id,'Researching');await s.updateNextAction(deal.id,'תאם ביקור');await s.setOffer(deal.id,950000);assert.equal((await s.listDeals()).find(x=>x.id===deal.id).offer_price_nis,'950000');
  assert((await s.getDealBundle({dealId:deal.id})).events.length>=8);
 }finally{await db.close();}
});
test('Injected SQL failure rolls back primary scenario and task, not just UI state',async()=>{
 const {db,service:s,store}=await workflowFixture();try{
 const deal=await s.createDealForListing(listingId),base=await s.saveScenario({deal_id:deal.id,is_primary:true,assumptions});
 const failing=createWorkflowService({...store,databaseTransaction:queries=>store.databaseTransaction([...queries.slice(0,-1),{text:'select definitely_missing_column',params:[]}])});
 await assert.rejects(()=>failing.saveScenario({deal_id:deal.id,is_primary:true,assumptions}));let b=await s.getDealBundle({dealId:deal.id});assert.equal(b.scenarios.length,1);assert.equal(b.scenarios[0].id,base.id);assert.equal(b.scenarios[0].is_primary,true);
 await assert.rejects(()=>failing.saveTask({deal_id:deal.id,title:'לא יישמר'}));b=await s.getDealBundle({dealId:deal.id});assert.equal(b.tasks.length,0);
 await assert.rejects(()=>failing.saveNote({deal_id:deal.id,content:'לא יישמר'}));assert.equal((await s.getDealBundle({dealId:deal.id})).notes.length,0);
 await assert.rejects(()=>failing.setDealStage(deal.id,'Researching'));assert.equal((await s.getDealBundle({dealId:deal.id})).deal.stage,'Saved');
 const item=b.dueDiligence[0];await assert.rejects(()=>failing.updateDueDiligence({deal_id:deal.id,item_id:item.id,status:'issue',notes:'לא יישמר',evidence:[]}));assert.equal((await s.getDealBundle({dealId:deal.id})).dueDiligence.find(x=>x.id===item.id).status,'unknown');
 }finally{await db.close();}
});
