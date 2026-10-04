import {databaseTransaction,queryDatabase} from './db.js';
import {calculateDeal} from './dealEngine.js';

export const DEAL_STAGES=['Saved','Researching','Contacted','Visit Scheduled','Visited','Negotiating','Due Diligence','Offer','Closed','Rejected'] as const;
const noteCategories=new Set(['seller','visit','legal','building','renovation','financing','renewal','general']);
const ddStatuses=new Set(['unknown','in_progress','verified','issue','not_applicable']);
const scenarioTypes=new Set(['conservative','base','upside','custom']);
const defaultDd=[
 ['legal','ownership','בעלות וזכויות'],['legal','encumbrances','שעבודים / עיקולים'],
 ['planning','permit_match','התאמה להיתר / חריגות'],['building','building_condition','מצב הבניין והרכוש המשותף'],
 ['renewal','renewal_status','סטטוס התחדשות עירונית'],['property','physical_condition','מצב פיזי של הדירה'],
 ['financial','financing','מימון / אישור עקרוני'],['financial','taxes_costs','מיסוי ועלויות עסקה']
];

export async function createDealForListing(listingId:string){
 const existing=await queryDatabase("select * from deals where listing_id=$1::uuid and status='open' order by created_at desc limit 1",[listingId]);
 if(existing[0])return existing[0];
 const listing=await queryDatabase("select l.id::text,l.property_id::text,ls.asking_price_nis::float8 from listings l join lateral (select asking_price_nis from listing_snapshots where listing_id=l.id order by observed_at desc limit 1) ls on true where l.id=$1::uuid",[listingId]);
 if(!listing[0])throw new Error('listing_not_found');
 const d=listing[0];
 const rows=await queryDatabase("insert into deals(property_id,listing_id,stage,status,asking_price_nis,last_activity_at) values($1::uuid,$2::uuid,'Saved','open',$3,now()) returning *",[d.property_id,d.id,d.asking_price_nis]);
 const deal=rows[0];
 const statements:any[]=[{text:"insert into deal_events(deal_id,listing_id,event_type,actor_type,summary,payload) values($1::uuid,$2::uuid,'deal_created','user','Deal saved',jsonb_build_object('stage','Saved'))",params:[deal.id,listingId]}];
 for(let i=0;i<defaultDd.length;i++){const [section,key,label]=defaultDd[i];statements.push({text:"insert into due_diligence_items(deal_id,section,item_key,label,status,sort_order) values($1::uuid,$2,$3,$4,'unknown',$5) on conflict(deal_id,item_key) do nothing",params:[deal.id,section,key,label,i]});}
 await databaseTransaction(statements);
 return deal;
}

export async function listDeals(){
 return queryDatabase("with latest as (select distinct on(listing_id) listing_id,asking_price_nis,area_sqm,rooms,floor from listing_snapshots order by listing_id,observed_at desc), primary_scenario as (select distinct on(deal_id) deal_id,id scenario_id,name scenario_name,outputs,calculation_version,calculated_at from deal_scenarios where is_primary=true order by deal_id,updated_at desc), dd as (select deal_id,count(*) filter(where status='issue')::int issue_count,count(*) filter(where status='verified')::int verified_count,count(*)::int total_count from due_diligence_items group by deal_id) select d.*,l.canonical_address,l.url,n.name_he neighborhood,c.name_he city,latest.asking_price_nis::float8 current_asking_price_nis,latest.area_sqm::float8,latest.rooms::float8,latest.floor::float8,ps.scenario_id,ps.scenario_name,ps.outputs scenario_outputs,ps.calculation_version,ps.calculated_at,coalesce(dd.issue_count,0)::int issue_count,coalesce(dd.verified_count,0)::int verified_count,coalesce(dd.total_count,0)::int dd_total from deals d left join listings l on l.id=d.listing_id left join latest on latest.listing_id=d.listing_id left join neighborhoods n on n.id=l.neighborhood_id left join cities c on c.id=l.city_id left join primary_scenario ps on ps.deal_id=d.id left join dd on dd.deal_id=d.id order by case when d.status='open' then 0 when d.status='closed' then 1 else 2 end,d.last_activity_at desc");
}

export async function getDealBundle(input:{dealId?:string;listingId?:string}){
 let dealRows:any[]=[];
 if(input.dealId)dealRows=await queryDatabase('select * from deals where id=$1::uuid limit 1',[input.dealId]);
 else if(input.listingId)dealRows=await queryDatabase("select * from deals where listing_id=$1::uuid order by (status='open') desc,created_at desc limit 1",[input.listingId]);
 const deal=dealRows[0];if(!deal)return null;
 const [scenarios,notes,dd,events]=await Promise.all([
  queryDatabase('select * from deal_scenarios where deal_id=$1::uuid order by is_primary desc,created_at',[deal.id]),
  queryDatabase('select * from investment_notes where deal_id=$1::uuid order by created_at desc',[deal.id]),
  queryDatabase('select * from due_diligence_items where deal_id=$1::uuid order by section,sort_order,label',[deal.id]),
  queryDatabase('select * from deal_events where deal_id=$1::uuid order by event_at desc,id desc limit 300',[deal.id])
 ]);
 return {deal,scenarios,notes,dueDiligence:dd,events};
}

export async function setDealStage(dealId:string,stage:string,rejectionReason?:string|null){
 if(!DEAL_STAGES.includes(stage as any))throw new Error('invalid_stage');
 const [before]=await queryDatabase('select stage,status,listing_id::text from deals where id=$1::uuid',[dealId]);if(!before)throw new Error('deal_not_found');
 const status=stage==='Closed'?'closed':stage==='Rejected'?'rejected':'open';
 const rows=await queryDatabase('update deals set stage=$2,status=$3,last_activity_at=now(),updated_at=now() where id=$1::uuid returning *',[dealId,stage,status]);
 await queryDatabase("insert into deal_events(deal_id,listing_id,event_type,actor_type,summary,payload) values($1::uuid,$2::uuid,'stage_changed','user',$3,$4::jsonb)",[dealId,before.listing_id,before.stage+' → '+stage,JSON.stringify({from:before.stage,to:stage,rejectionReason:rejectionReason||null})]);
 return rows[0];
}

export async function updateNextAction(dealId:string,nextAction:string|null){
 const rows=await queryDatabase('update deals set next_action=$2,last_activity_at=now(),updated_at=now() where id=$1::uuid returning *',[dealId,nextAction]);if(!rows[0])throw new Error('deal_not_found');return rows[0];
}

export async function setOffer(dealId:string,offerPrice:number|null){
 const [deal]=await queryDatabase('select listing_id::text,offer_price_nis::float8 from deals where id=$1::uuid',[dealId]);if(!deal)throw new Error('deal_not_found');
 const price=offerPrice==null?null:Math.max(0,Number(offerPrice));
 const rows=await queryDatabase('update deals set offer_price_nis=$2,last_activity_at=now(),updated_at=now() where id=$1::uuid returning *',[dealId,price]);
 await queryDatabase("insert into deal_events(deal_id,listing_id,event_type,actor_type,summary,payload) values($1::uuid,$2::uuid,'offer_changed','user',$3,$4::jsonb)",[dealId,deal.listing_id,price==null?'Offer cleared':'Offer set',JSON.stringify({previous:deal.offer_price_nis,current:price})]);
 return rows[0];
}

export async function saveScenario(input:any){
 const dealId=String(input.deal_id||'');if(!dealId)throw new Error('deal_id_required');
 const scenarioType=String(input.scenario_type||'custom');if(!scenarioTypes.has(scenarioType))throw new Error('invalid_scenario_type');
 const assumptions=input.assumptions&&typeof input.assumptions==='object'?input.assumptions:{};
 const outputs=calculateDeal(assumptions),isPrimary=Boolean(input.is_primary);
 if(isPrimary)await queryDatabase('update deal_scenarios set is_primary=false,updated_at=now() where deal_id=$1::uuid',[dealId]);
 let rows:any[];
 if(input.scenario_id)rows=await queryDatabase("update deal_scenarios set name=$3,scenario_type=$4,is_primary=$5,assumptions=$6::jsonb,outputs=$7::jsonb,calculation_version='deal-engine-v1',calculated_at=now(),updated_at=now() where id=$1::uuid and deal_id=$2::uuid returning *",[input.scenario_id,dealId,String(input.name||'Scenario'),scenarioType,isPrimary,JSON.stringify(assumptions),JSON.stringify(outputs)]);
 else rows=await queryDatabase("insert into deal_scenarios(deal_id,name,scenario_type,is_primary,assumptions,outputs,calculation_version,calculated_at) values($1::uuid,$2,$3,$4,$5::jsonb,$6::jsonb,'deal-engine-v1',now()) returning *",[dealId,String(input.name||'Scenario'),scenarioType,isPrimary,JSON.stringify(assumptions),JSON.stringify(outputs)]);
 if(!rows[0])throw new Error('scenario_not_found');
 const [deal]=await queryDatabase('select listing_id::text from deals where id=$1::uuid',[dealId]);
 await queryDatabase("insert into deal_events(deal_id,listing_id,event_type,actor_type,summary,payload) values($1::uuid,$2::uuid,'scenario_saved','user',$3,$4::jsonb)",[dealId,deal?.listing_id??null,'Scenario saved: '+rows[0].name,JSON.stringify({scenarioId:rows[0].id,scenarioType,isPrimary,outputs})]);
 await queryDatabase('update deals set last_activity_at=now(),updated_at=now() where id=$1::uuid',[dealId]);return rows[0];
}

export async function saveNote(input:any){
 const dealId=String(input.deal_id||''),content=String(input.content||'').trim(),category=String(input.category||'general');
 if(!dealId||!content)throw new Error('deal_and_content_required');if(!noteCategories.has(category))throw new Error('invalid_note_category');
 let rows:any[];
 if(input.note_id)rows=await queryDatabase('update investment_notes set category=$3,content=$4,evidence_url=$5,updated_at=now() where id=$1::uuid and deal_id=$2::uuid returning *',[input.note_id,dealId,category,content,input.evidence_url||null]);
 else{
  const [deal]=await queryDatabase('select listing_id::text,property_id::text from deals where id=$1::uuid',[dealId]);if(!deal)throw new Error('deal_not_found');
  rows=await queryDatabase('insert into investment_notes(deal_id,listing_id,property_id,category,content,evidence_url) values($1::uuid,$2::uuid,$3::uuid,$4,$5,$6) returning *',[dealId,deal.listing_id,deal.property_id,category,content,input.evidence_url||null]);
 }
 if(!rows[0])throw new Error('note_not_found');
 const [deal]=await queryDatabase('select listing_id::text from deals where id=$1::uuid',[dealId]);
 await queryDatabase("insert into deal_events(deal_id,listing_id,event_type,actor_type,summary,payload) values($1::uuid,$2::uuid,'note_saved','user',$3,$4::jsonb)",[dealId,deal?.listing_id??null,'Note saved: '+category,JSON.stringify({noteId:rows[0].id,category})]);
 await queryDatabase('update deals set last_activity_at=now(),updated_at=now() where id=$1::uuid',[dealId]);return rows[0];
}

export async function deleteNote(dealId:string,noteId:string){
 const rows=await queryDatabase('delete from investment_notes where id=$1::uuid and deal_id=$2::uuid returning id,category',[noteId,dealId]);if(!rows[0])throw new Error('note_not_found');
 await queryDatabase("insert into deal_events(deal_id,event_type,actor_type,summary,payload) values($1::uuid,'note_deleted','user',$2,$3::jsonb)",[dealId,'Note deleted: '+rows[0].category,JSON.stringify({noteId})]);return {ok:true};
}

export async function updateDueDiligence(input:any){
 const dealId=String(input.deal_id||''),itemId=String(input.item_id||''),status=String(input.status||'unknown');
 if(!dealId||!itemId||!ddStatuses.has(status))throw new Error('invalid_due_diligence_update');
 const [before]=await queryDatabase('select status,label from due_diligence_items where id=$1::uuid and deal_id=$2::uuid',[itemId,dealId]);if(!before)throw new Error('dd_item_not_found');
 const rows=await queryDatabase('update due_diligence_items set status=$3,notes=$4,evidence=$5::jsonb,updated_at=now() where id=$1::uuid and deal_id=$2::uuid returning *',[itemId,dealId,status,input.notes||null,JSON.stringify(Array.isArray(input.evidence)?input.evidence:[])]);
 const [deal]=await queryDatabase('select listing_id::text from deals where id=$1::uuid',[dealId]);
 await queryDatabase("insert into deal_events(deal_id,listing_id,event_type,actor_type,summary,payload) values($1::uuid,$2::uuid,'due_diligence_changed','user',$3,$4::jsonb)",[dealId,deal?.listing_id??null,before.label+': '+before.status+' → '+status,JSON.stringify({itemId,from:before.status,to:status})]);
 await queryDatabase('update deals set last_activity_at=now(),updated_at=now() where id=$1::uuid',[dealId]);return rows[0];
}
