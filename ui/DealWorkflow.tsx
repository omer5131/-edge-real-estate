import {useEffect,useMemo,useState} from 'react';
import {AlertTriangle,CheckCircle2,ClipboardCheck,FileText,RefreshCw,Save,Trash2} from 'lucide-react';

const money=(n:any)=>n==null||Number.isNaN(Number(n))?'—':'₪'+Math.round(Number(n)).toLocaleString('he-IL');
const dt=(v:any)=>v?new Date(v).toLocaleString('he-IL'):'—';
const post=async(body:any)=>{const r=await fetch('/api/opportunities',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({mode:'workflow',...body})});const j=await r.json();if(!r.ok)throw new Error(j.error||'workflow_failed');return j.data};

export default function DealWorkflow({listingId,section,askingPrice}:{listingId:string;section:'deal'|'notes'|'dd'|'timeline';askingPrice:number|null}){
 const [bundle,setBundle]=useState<any>(null),[loading,setLoading]=useState(true),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const [note,setNote]=useState(''),[category,setCategory]=useState('general');
 const [nextAction,setNextAction]=useState('');
 const [offer,setOffer]=useState('');
 const [scenario,setScenario]=useState<any>({purchasePriceNis:askingPrice||0,purchaseTaxNis:0,legalFeesNis:15000,brokerFeesNis:0,appraisalFeesNis:2500,renovationNis:50000,furnishingNis:0,otherAcquisitionNis:0,loanAmountNis:askingPrice?Math.round(askingPrice*.5):0,annualInterestRatePct:4.5,loanTermYears:25,expectedMonthlyRentNis:0,vacancyPct:5,annualMaintenanceNis:6000,annualOtherOperatingNis:0,exitYears:5,annualAppreciationPct:2.5,saleCostsPct:1.5,saleTaxNis:0,targetAnnualReturnPct:8});
 const load=async()=>{setLoading(true);setError('');try{const r=await fetch('/api/opportunities?mode=deal&listing_id='+encodeURIComponent(listingId),{cache:'no-store'});if(r.status===404){setBundle(null);return}const j=await r.json();if(!r.ok)throw new Error(j.error||'deal_load_failed');setBundle(j);setNextAction(j.deal?.next_action||'');setOffer(j.deal?.offer_price_nis==null?'':String(j.deal.offer_price_nis));const primary=j.scenarios?.find((x:any)=>x.is_primary);if(primary?.assumptions)setScenario((s:any)=>({...s,...primary.assumptions}))}catch(e:any){setError(e?.message||String(e))}finally{setLoading(false)}};
 useEffect(()=>{void load()},[listingId]);
 useEffect(()=>{setScenario((s:any)=>({...s,purchasePriceNis:s.purchasePriceNis||askingPrice||0,loanAmountNis:s.loanAmountNis||askingPrice?Math.round((askingPrice||0)*.5):0}))},[askingPrice]);

 const mutate=async(body:any)=>{setBusy(true);setError('');try{await post(body);await load()}catch(e:any){setError(e?.message||String(e))}finally{setBusy(false)}};
 if(loading)return <div className="workflow-loading"><RefreshCw className="spin" size={16}/>טוען workflow…</div>;
 if(error&&!bundle)return <div className="deal-empty"><AlertTriangle size={18}/><div><strong>Workflow unavailable</strong><span>{error}</span></div></div>;
 if(!bundle)return <div className="workflow-start"><ClipboardCheck size={24}/><h3>התחל Deal</h3><p>צור תיק עסקה כדי לנהל תרחישים, הערות, due diligence וטיימליין.</p><button disabled={busy} onClick={()=>mutate({action:'create_deal',listing_id:listingId})}>צור Deal</button></div>;

 const deal=bundle.deal;
 const primary=bundle.scenarios?.find((x:any)=>x.is_primary)||bundle.scenarios?.[0];
 const out=primary?.outputs||{};
 const scenarioField=(key:string,label:string,step='1')=><label className="workflow-field"><span>{label}</span><input type="number" step={step} value={scenario[key]??''} onChange={e=>setScenario((s:any)=>({...s,[key]:e.target.value===''?0:Number(e.target.value)}))}/></label>;

 if(section==='deal')return <div className="workflow-grid">
  <section className="panel workflow-span-2"><div className="deal-panel-head"><h3>Deal workflow</h3><span className="deal-evidence supported">{deal.status}</span></div>
   <div className="workflow-controls">
    <label className="workflow-field"><span>Stage</span><select value={deal.stage} disabled={busy} onChange={e=>mutate({action:'set_stage',deal_id:deal.id,stage:e.target.value})}>{['Saved','Researching','Contacted','Visit Scheduled','Visited','Negotiating','Due Diligence','Offer','Closed','Rejected'].map(x=><option key={x}>{x}</option>)}</select></label>
    <label className="workflow-field grow"><span>Next action</span><input value={nextAction} onChange={e=>setNextAction(e.target.value)} placeholder="לדוגמה: להתקשר למוכר ביום א׳"/></label>
    <button className="workflow-save" disabled={busy} onClick={()=>mutate({action:'next_action',deal_id:deal.id,next_action:nextAction||null})}><Save size={14}/>שמור</button>
    <label className="workflow-field"><span>Offer ₪</span><input type="number" value={offer} onChange={e=>setOffer(e.target.value)}/></label>
    <button className="workflow-save" disabled={busy} onClick={()=>mutate({action:'set_offer',deal_id:deal.id,offer_price_nis:offer===''?null:Number(offer)})}><Save size={14}/>עדכן הצעה</button>
   </div>
  </section>
  <section className="panel workflow-span-2"><h3>Base scenario</h3><div className="workflow-fields">
   {scenarioField('purchasePriceNis','מחיר רכישה')}
   {scenarioField('purchaseTaxNis','מס רכישה')}
   {scenarioField('legalFeesNis','עו״ד')}
   {scenarioField('renovationNis','שיפוץ')}
   {scenarioField('loanAmountNis','משכנתה')}
   {scenarioField('annualInterestRatePct','ריבית %','0.1')}
   {scenarioField('loanTermYears','שנים')}
   {scenarioField('expectedMonthlyRentNis','שכ״ד חודשי')}
   {scenarioField('vacancyPct','Vacancy %','0.1')}
   {scenarioField('annualMaintenanceNis','תחזוקה שנתית')}
   {scenarioField('exitYears','אופק יציאה')}
   {scenarioField('annualAppreciationPct','עליית ערך שנתית %','0.1')}
   {scenarioField('targetAnnualReturnPct','תשואת יעד %','0.1')}
  </div><button className="workflow-primary" disabled={busy} onClick={()=>mutate({action:'save_scenario',deal_id:deal.id,scenario_id:primary?.id,name:'Base',scenario_type:'base',is_primary:true,assumptions:scenario})}>חשב ושמור Base</button></section>
  <section className="panel workflow-span-2"><h3>Scenario outputs</h3>{!primary?<p className="deal-muted">עדיין לא נשמר תרחיש.</p>:<div className="workflow-output-grid">
   {[['Total cost',out.totalAcquisitionCostNis],['Equity',out.equityRequiredNis],['Debt / month',out.monthlyDebtServiceNis],['Cash flow / month',out.monthlyCashFlowNis],['Gross yield',out.grossYieldPct==null?null:String(out.grossYieldPct)+'%'],['Net yield',out.netYieldPct==null?null:String(out.netYieldPct)+'%'],['Cash on cash',out.cashOnCashPct==null?null:String(out.cashOnCashPct)+'%'],['IRR',out.irrPct==null?null:String(out.irrPct)+'%'],['Exit value',out.projectedExitValueNis],['Projected profit',out.projectedProfitNis],['Break-even rent',out.breakEvenMonthlyRentNis],['Max purchase @ target',out.maxPurchasePriceForTargetReturnNis]].map(([label,value]:any)=><div className="deal-metric" key={label}><span>{label}</span><strong>{typeof value==='number'?money(value):value??'—'}</strong></div>)}
  </div>}</section>
 </div>;

 if(section==='notes')return <div className="workflow-grid">
  <section className="panel workflow-span-2"><h3>הוסף הערה</h3><div className="workflow-note-compose"><select value={category} onChange={e=>setCategory(e.target.value)}>{['seller','visit','legal','building','renovation','financing','renewal','general'].map(x=><option key={x}>{x}</option>)}</select><textarea value={note} onChange={e=>setNote(e.target.value)} placeholder="מה גילית? מה צריך לזכור?"/><button disabled={busy||!note.trim()} onClick={async()=>{await mutate({action:'save_note',deal_id:deal.id,category,content:note});setNote('')}}><FileText size={14}/>שמור הערה</button></div></section>
  <section className="panel workflow-span-2"><h3>Notes</h3>{!bundle.notes?.length?<p className="deal-muted">אין הערות עדיין.</p>:<div className="workflow-note-list">{bundle.notes.map((x:any)=><div key={x.id}><div><strong>{x.category}</strong><span>{dt(x.created_at)}</span></div><p>{x.content}</p><button onClick={()=>mutate({action:'delete_note',deal_id:deal.id,note_id:x.id})}><Trash2 size={13}/></button></div>)}</div>}</section>
 </div>;

 if(section==='dd')return <div className="workflow-grid"><section className="panel workflow-span-2"><div className="deal-panel-head"><h3>Due Diligence</h3><span>{bundle.dueDiligence?.filter((x:any)=>x.status==='issue').length||0} issues</span></div><div className="workflow-dd">{bundle.dueDiligence?.map((x:any)=><div key={x.id} className={'workflow-dd-row '+x.status}><div><strong>{x.label}</strong><span>{x.section}</span></div><select value={x.status} disabled={busy} onChange={e=>mutate({action:'update_dd',deal_id:deal.id,item_id:x.id,status:e.target.value,notes:x.notes||'',evidence:x.evidence||[]})}>{['unknown','in_progress','verified','issue','not_applicable'].map(s=><option value={s} key={s}>{s}</option>)}</select></div>)}</div></section></div>;

 return <div className="workflow-grid"><section className="panel workflow-span-2"><h3>Timeline</h3>{!bundle.events?.length?<p className="deal-muted">אין אירועים עדיין.</p>:<div className="workflow-timeline">{bundle.events.map((x:any)=><div key={x.id}><span className="timeline-dot"/><div><strong>{x.summary||x.event_type}</strong><small>{x.event_type} · {x.actor_type} · {dt(x.event_at)}</small></div></div>)}</div>}</section></div>;
}
