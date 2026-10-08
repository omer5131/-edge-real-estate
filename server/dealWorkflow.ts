import {databaseTransaction as liveTransaction,queryDatabase as liveQuery} from './db.js';
import {calculateDeal} from './dealEngine.js';
import {sourceUrl,isoDate,ddEvidence,scenarioAssumptions} from './workflowValidation.js';
import {randomUUID} from 'node:crypto';
import {buildDecisionReview} from './dealDecision.js';

export const DEAL_STAGES=['Saved','Researching','Contacted','Visit Scheduled','Visited','Negotiating','Due Diligence','Offer','Closed','Rejected'] as const;
const noteCategories=new Set(['seller','visit','legal','building','renovation','financing','renewal','general']);
const ddStatuses=new Set(['unknown','in_progress','verified','issue','not_applicable']);
const scenarioTypes=new Set(['conservative','base','upside','custom']);
const defaultDd=[
 ['identity','listing_identity','אימות המודעה, כתובת מלאה וזמינות'],
 ['legal','ownership','בעלות וזכויות'],['legal','encumbrances','שעבודים / עיקולים'],
 ['planning','permit_match','התאמה להיתר / חריגות'],['building','building_condition','מצב הבניין והרכוש המשותף'],
 ['renewal','renewal_status','סטטוס התחדשות עירונית'],['property','physical_condition','מצב פיזי של הדירה'],
 ['financial','financing','מימון / אישור עקרוני'],['financial','taxes_costs','מיסוי ועלויות עסקה']
];

export function createWorkflowService(store={queryDatabase:liveQuery,databaseTransaction:liveTransaction}){
 const {queryDatabase,databaseTransaction}=store;
async function createDealForListing(listingId:string){
 const existing=await queryDatabase("select * from deals where listing_id=$1::uuid and status='open' order by created_at desc limit 1",[listingId]);
 if(existing[0])return existing[0];
 const listing=await queryDatabase("select l.id::text,l.property_id::text,ls.asking_price_nis::float8 from listings l join lateral (select asking_price_nis from listing_snapshots where listing_id=l.id order by observed_at desc limit 1) ls on true where l.id=$1::uuid",[listingId]);
 if(!listing[0])throw new Error('listing_not_found');
 const d=listing[0];
 const id=randomUUID();
 const statements:any[]=[{text:"insert into deals(id,property_id,listing_id,stage,status,asking_price_nis,last_activity_at) values($1::uuid,$2::uuid,$3::uuid,'Saved','open',$4,now()) returning *",params:[id,d.property_id,d.id,d.asking_price_nis]},
 {text:"insert into deal_events(deal_id,listing_id,event_type,actor_type,summary,payload) values($1::uuid,$2::uuid,'deal_created','user','Deal saved',jsonb_build_object('stage','Saved'))",params:[id,listingId]}];
 for(let i=0;i<defaultDd.length;i++){const [section,key,label]=defaultDd[i];statements.push({text:"insert into due_diligence_items(deal_id,section,item_key,label,status,sort_order) values($1::uuid,$2,$3,$4,'unknown',$5) on conflict(deal_id,item_key) do nothing",params:[id,section,key,label,i]});}
 const result=await databaseTransaction(statements);return result[0][0];
}

async function listDeals(){
 return queryDatabase("with latest as (select distinct on(listing_id) listing_id,asking_price_nis,area_sqm,rooms,floor from listing_snapshots order by listing_id,observed_at desc), primary_scenario as (select distinct on(deal_id) deal_id,id scenario_id,name scenario_name,outputs,calculation_version,calculated_at from deal_scenarios where is_primary=true order by deal_id,updated_at desc), dd as (select deal_id,count(*) filter(where status='issue')::int issue_count,count(*) filter(where status='verified')::int verified_count,count(*)::int total_count from due_diligence_items group by deal_id) select d.*,l.canonical_address,l.url,n.name_he neighborhood,c.name_he city,latest.asking_price_nis::float8 current_asking_price_nis,latest.area_sqm::float8,latest.rooms::float8,latest.floor::float8,ps.scenario_id,ps.scenario_name,ps.outputs scenario_outputs,ps.calculation_version,ps.calculated_at,coalesce(dd.issue_count,0)::int issue_count,coalesce(dd.verified_count,0)::int verified_count,coalesce(dd.total_count,0)::int dd_total from deals d left join listings l on l.id=d.listing_id left join latest on latest.listing_id=d.listing_id left join neighborhoods n on n.id=l.neighborhood_id left join cities c on c.id=l.city_id left join primary_scenario ps on ps.deal_id=d.id left join dd on dd.deal_id=d.id order by case when d.status='open' then 0 when d.status='closed' then 1 else 2 end,d.last_activity_at desc");
}

async function getDealBundle(input:{dealId?:string;listingId?:string}){
 let dealRows:any[]=[];
 if(input.dealId)dealRows=await queryDatabase('select * from deals where id=$1::uuid limit 1',[input.dealId]);
 else if(input.listingId)dealRows=await queryDatabase("select * from deals where listing_id=$1::uuid order by (status='open') desc,created_at desc limit 1",[input.listingId]);
 const deal=dealRows[0];if(!deal)return null;
 if(input.listingId&&String(deal.listing_id)!==input.listingId)throw Error('deal_listing_mismatch');
 let taskSchemaReady=true;
 const [scenarios,notes,dd,events,tasks]=await Promise.all([
  queryDatabase('select * from deal_scenarios where deal_id=$1::uuid order by is_primary desc,created_at',[deal.id]),
  queryDatabase('select * from investment_notes where deal_id=$1::uuid order by created_at desc',[deal.id]),
  queryDatabase('select * from due_diligence_items where deal_id=$1::uuid order by section,sort_order,label',[deal.id]),
  queryDatabase('select * from deal_events where deal_id=$1::uuid order by event_at desc,id desc limit 300',[deal.id]),
  queryDatabase('select * from deal_tasks where deal_id=$1::uuid order by (status in (\'done\',\'cancelled\')),due_date nulls last,created_at',[deal.id]).catch(e=>{if(e.code==='42P01'){taskSchemaReady=false;return [];}throw e;})
 ]);
 return {deal,scenarios,notes,dueDiligence:dd,events,tasks,taskSchemaReady};
}

async function getDecisionReview(input:{dealId:string;listingId?:string;scenarioId:string;offerPrice?:number}){
 const bundle=await getDealBundle(input);if(!bundle)throw Error('deal_not_found');
 return buildDecisionReview(bundle,input.scenarioId,input.offerPrice);
}

async function setDealStage(dealId:string,stage:string,rejectionReason?:string|null){
 if(!DEAL_STAGES.includes(stage as any))throw new Error('invalid_stage');
 if(stage==='Rejected'&&!rejectionReason?.trim())throw Error('rejection_reason_required');
 const [before]=await queryDatabase('select stage,status,listing_id::text from deals where id=$1::uuid',[dealId]);if(!before)throw new Error('deal_not_found');
 const status=stage==='Closed'?'closed':stage==='Rejected'?'rejected':'open';
 const result=await databaseTransaction([{text:'update deals set stage=$2,status=$3,last_activity_at=now(),updated_at=now() where id=$1::uuid returning *',params:[dealId,stage,status]},{text:"insert into deal_events(deal_id,listing_id,event_type,actor_type,summary,payload) values($1::uuid,$2::uuid,'stage_changed','user',$3,$4::jsonb)",params:[dealId,before.listing_id,before.stage+' → '+stage,JSON.stringify({from:before.stage,to:stage,rejectionReason:rejectionReason||null})]}]);
 return result[0][0];
}

async function updateNextAction(dealId:string,nextAction:string|null){
 const rows=await queryDatabase('update deals set next_action=$2,last_activity_at=now(),updated_at=now() where id=$1::uuid returning *',[dealId,nextAction]);if(!rows[0])throw new Error('deal_not_found');return rows[0];
}

async function setOffer(dealId:string,offerPrice:number|null){
 if(offerPrice!=null&&(!Number.isFinite(offerPrice)||offerPrice<0))throw Error('invalid_offer');
 const [deal]=await queryDatabase('select listing_id::text,offer_price_nis::float8 from deals where id=$1::uuid',[dealId]);if(!deal)throw new Error('deal_not_found');
 const price=offerPrice==null?null:Math.max(0,Number(offerPrice));
 const result=await databaseTransaction([{text:'update deals set offer_price_nis=$2,last_activity_at=now(),updated_at=now() where id=$1::uuid returning *',params:[dealId,price]},{text:"insert into deal_events(deal_id,listing_id,event_type,actor_type,summary,payload) values($1::uuid,$2::uuid,'offer_changed','user',$3,$4::jsonb)",params:[dealId,deal.listing_id,price==null?'Offer cleared':'Offer set',JSON.stringify({previous:deal.offer_price_nis,current:price})]}]);
 return result[0][0];
}

async function saveScenario(input:any){
 const dealId=String(input.deal_id||'');if(!dealId)throw new Error('deal_id_required');
 const scenarioType=String(input.scenario_type||'custom');if(!scenarioTypes.has(scenarioType))throw new Error('invalid_scenario_type');
 const [parent]=await queryDatabase('select id from deals where id=$1::uuid',[dealId]);if(!parent)throw Error('deal_not_found');
 let rawAssumptions=input.assumptions;
 if(input.scenario_id){const [existing]=await queryDatabase('select id,assumptions from deal_scenarios where id=$1::uuid and deal_id=$2::uuid',[input.scenario_id,dealId]);if(!existing)throw Error('scenario_not_found');
  // Older clients do not know fieldEvidence. Preserve attribution, bound to its old value.
  if(rawAssumptions&&typeof rawAssumptions==='object'&&!Array.isArray(rawAssumptions)&&!Object.hasOwn(rawAssumptions,'fieldEvidence'))rawAssumptions={...rawAssumptions,fieldEvidence:existing.assumptions?.fieldEvidence};
 }
 const assumptions=scenarioAssumptions(rawAssumptions);
 const outputs=calculateDeal(assumptions as any),isPrimary=Boolean(input.is_primary);
 const scenarioId=input.scenario_id||randomUUID(),name=String(input.name||'Scenario').slice(0,200);
 const statements:any[]=[{text:'select id from deals where id=$1::uuid for update',params:[dealId]}];
 if(isPrimary)statements.push({text:'update deal_scenarios set is_primary=false,updated_at=now() where deal_id=$1::uuid',params:[dealId]});
 const at=statements.length;
 statements.push({text:input.scenario_id?"update deal_scenarios set name=$3,scenario_type=$4,is_primary=$5,assumptions=$6::jsonb,outputs=$7::jsonb,calculation_version='deal-engine-v1',calculated_at=now(),updated_at=now() where id=$1::uuid and deal_id=$2::uuid returning *":"insert into deal_scenarios(id,deal_id,name,scenario_type,is_primary,assumptions,outputs,calculation_version,calculated_at) values($1::uuid,$2::uuid,$3,$4,$5,$6::jsonb,$7::jsonb,'deal-engine-v1',now()) returning *",params:[scenarioId,dealId,name,scenarioType,isPrimary,JSON.stringify(assumptions),JSON.stringify(outputs)]},
 {text:"insert into deal_events(deal_id,event_type,actor_type,summary,payload) values($1::uuid,'scenario_saved','user',$2,$3::jsonb)",params:[dealId,'Scenario saved: '+name,JSON.stringify({scenarioId,scenarioType,isPrimary,outputs})]},
 {text:'update deals set last_activity_at=now(),updated_at=now() where id=$1::uuid',params:[dealId]});
 const result=await databaseTransaction(statements);return result[at][0];
}

async function saveNote(input:any){
 input={...input,evidence_url:sourceUrl(input.evidence_url)};
 const dealId=String(input.deal_id||''),content=String(input.content||'').trim(),category=String(input.category||'general');
 if(!dealId||!content)throw new Error('deal_and_content_required');if(!noteCategories.has(category))throw new Error('invalid_note_category');
 const [deal]=await queryDatabase('select listing_id::text,property_id::text from deals where id=$1::uuid',[dealId]);if(!deal)throw Error('deal_not_found');
 if(input.note_id){const [existing]=await queryDatabase('select id from investment_notes where id=$1::uuid and deal_id=$2::uuid',[input.note_id,dealId]);if(!existing)throw Error('note_not_found');}
 const noteId=input.note_id||randomUUID();
 const write=input.note_id?{text:'update investment_notes set category=$3,content=$4,evidence_url=$5,updated_at=now() where id=$1::uuid and deal_id=$2::uuid returning *',params:[noteId,dealId,category,content,input.evidence_url||null]}:{text:'insert into investment_notes(id,deal_id,listing_id,property_id,category,content,evidence_url) values($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5,$6,$7) returning *',params:[noteId,dealId,deal.listing_id,deal.property_id,category,content,input.evidence_url||null]};
 const result=await databaseTransaction([write,{text:"insert into deal_events(deal_id,listing_id,event_type,actor_type,summary,payload) values($1::uuid,$2::uuid,'note_saved','user',$3,$4::jsonb)",params:[dealId,deal.listing_id,'Note saved: '+category,JSON.stringify({noteId,category})]},{text:'update deals set last_activity_at=now(),updated_at=now() where id=$1::uuid',params:[dealId]}]);return result[0][0];
}

async function deleteNote(dealId:string,noteId:string){
 const rows=await queryDatabase('delete from investment_notes where id=$1::uuid and deal_id=$2::uuid returning id,category',[noteId,dealId]);if(!rows[0])throw new Error('note_not_found');
 await queryDatabase("insert into deal_events(deal_id,event_type,actor_type,summary,payload) values($1::uuid,'note_deleted','user',$2,$3::jsonb)",[dealId,'Note deleted: '+rows[0].category,JSON.stringify({noteId})]);return {ok:true};
}

async function updateDueDiligence(input:any){
 const dealId=String(input.deal_id||''),itemId=String(input.item_id||''),status=String(input.status||'unknown');
 if(!dealId||!itemId||!ddStatuses.has(status))throw new Error('invalid_due_diligence_update');
 const evidence=ddEvidence(input.evidence),notes=String(input.notes||'').trim();
 if(status==='verified'&&(!notes||!evidence.length))throw Error('verification_requires_findings_and_source');
 const [before]=await queryDatabase('select status,label from due_diligence_items where id=$1::uuid and deal_id=$2::uuid',[itemId,dealId]);if(!before)throw new Error('dd_item_not_found');
 const [deal]=await queryDatabase('select listing_id::text from deals where id=$1::uuid',[dealId]);
 const result=await databaseTransaction([{text:'update due_diligence_items set status=$3,notes=$4,evidence=$5::jsonb,updated_at=now() where id=$1::uuid and deal_id=$2::uuid returning *',params:[itemId,dealId,status,notes||null,JSON.stringify(evidence)]},{text:"insert into deal_events(deal_id,listing_id,event_type,actor_type,summary,payload) values($1::uuid,$2::uuid,'due_diligence_changed','user',$3,$4::jsonb)",params:[dealId,deal?.listing_id??null,before.label+': '+before.status+' → '+status,JSON.stringify({itemId,from:before.status,to:status})]},{text:'update deals set last_activity_at=now(),updated_at=now() where id=$1::uuid',params:[dealId]}]);return result[0][0];
}

async function createDdItem(input:any){
 const label=String(input.label||'').trim();if(!label||label.length>300)throw Error('dd_label_required');
 const rows=await queryDatabase("insert into due_diligence_items(deal_id,section,item_key,label,status) values($1::uuid,'custom',gen_random_uuid()::text,$2,'unknown') returning *",[input.deal_id,label]);return rows[0];
}
async function saveTask(input:any){
 const dealId=String(input.deal_id||''),title=String(input.title||'').trim(),status=String(input.status||'todo'),result=String(input.result||'').trim();
 if(!dealId||!title||title.length>500||!['todo','in_progress','done','cancelled'].includes(status))throw Error('invalid_task');
 if(status==='done'&&!result)throw Error('task_result_required');
 if(input.dd_item_id){const [dd]=await queryDatabase('select id from due_diligence_items where id=$1::uuid and deal_id=$2::uuid',[input.dd_item_id,dealId]);if(!dd)throw Error('dd_item_not_found');}
 const params=[dealId,title,String(input.assignee||'').slice(0,200)||null,isoDate(input.due_date),status,sourceUrl(input.source_url),isoDate(input.observed_at),result||null,input.dd_item_id||null];
 const statement=input.task_id?"update deal_tasks set title=$2,assignee=$3,due_date=$4::date,status=$5,source_url=$6,observed_at=$7::date,result=$8,dd_item_id=$9::uuid,updated_at=now() where deal_id=$1::uuid and id=$10::uuid returning *":"insert into deal_tasks(deal_id,title,assignee,due_date,status,source_url,observed_at,result,dd_item_id) values($1::uuid,$2,$3,$4::date,$5,$6,$7::date,$8,$9::uuid) returning *";
 if(input.task_id){const [existing]=await queryDatabase('select id from deal_tasks where id=$1::uuid and deal_id=$2::uuid',[input.task_id,dealId]);if(!existing)throw Error('task_not_found');}
 const savedTask=await databaseTransaction([{text:statement,params:input.task_id?[...params,input.task_id]:params},{text:"insert into deal_events(deal_id,event_type,actor_type,summary,payload) values($1::uuid,'task_saved','user',$2,$3::jsonb)",params:[dealId,title+': '+status,JSON.stringify({status})]},{text:'update deals set last_activity_at=now(),updated_at=now() where id=$1::uuid',params:[dealId]}]);return savedTask[0][0];
}
return {createDealForListing,listDeals,getDealBundle,getDecisionReview,setDealStage,updateNextAction,setOffer,saveScenario,saveNote,deleteNote,updateDueDiligence,saveTask,createDdItem};
}
export const {createDealForListing,listDeals,getDealBundle,getDecisionReview,setDealStage,updateNextAction,setOffer,saveScenario,saveNote,deleteNote,updateDueDiligence,saveTask,createDdItem}=createWorkflowService();
