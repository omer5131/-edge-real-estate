import {useEffect,useMemo,useState} from 'react';
import {AlertTriangle,ArrowUpDown,ClipboardList,RefreshCw} from 'lucide-react';

type DealRow=any;
type OpenItem={id:string;address:string;neighborhood_id:string;neighborhood:string;city:string;asking_price:number;sqm:number|null;rooms:number|null;floor:string|null};

const money=(n:any)=>n==null||Number.isNaN(Number(n))?'—':'₪'+Math.round(Number(n)).toLocaleString('he-IL');
const dt=(v:any)=>v?new Date(v).toLocaleDateString('he-IL'):'—';
const stages=['Saved','Researching','Contacted','Visit Scheduled','Visited','Negotiating','Due Diligence','Offer','Closed','Rejected'];

export default function MyDeals({onOpen}:{onOpen:(x:OpenItem)=>void}){
 const [selected,setSelected]=useState<string[]>([]);
 const [rows,setRows]=useState<DealRow[]>([]),[loading,setLoading]=useState(true),[error,setError]=useState(''),[filter,setFilter]=useState<'active'|'closed'|'rejected'|'all'>('active');
 const load=async()=>{setLoading(true);setError('');try{const r=await fetch('/api/opportunities?mode=deals',{cache:'no-store'});const j=await r.json();if(!r.ok)throw new Error(j.error||'deals_load_failed');if(!Array.isArray(j.deals))throw Error('deals_response_invalid');setRows(j.deals)}catch(e:any){setError(e?.message||String(e))}finally{setLoading(false)}};
 useEffect(()=>{void load()},[]);
 const visible=useMemo(()=>rows.filter(x=>filter==='all'||filter==='active'?filter==='all'||x.status==='open':filter==='closed'?x.status==='closed':x.status==='rejected'),[rows,filter]);
 const grouped=useMemo(()=>stages.map(stage=>({stage,items:visible.filter(x=>(x.stage==='Lead'?'Saved':x.stage)===stage)})).filter(g=>g.items.length),[visible]);
 if(loading)return <div className="screen"><div className="loading"><RefreshCw className="spin"/>טוען My Deals…</div></div>;
 return <div className="screen my-deals">
  <div className="screen-head"><div><span className="eyebrow">Acquisition workflow</span><h1>העסקאות שלי</h1><p>כל הנכסים שאתה באמת בוחן, מהשמירה ועד הצעה / סגירה.</p></div><button onClick={load}><RefreshCw size={14}/>רענן</button></div>
  {error&&<div className="deal-empty"><AlertTriangle size={18}/><div><strong>לא ניתן לטעון עסקאות</strong><span>{error}</span></div></div>}
  <div className="my-deals-filters">{(['active','closed','rejected','all'] as const).map(x=><button key={x} className={filter===x?'active':''} onClick={()=>setFilter(x)}>{{active:'פעילות',closed:'נסגרו',rejected:'נדחו',all:'הכול'}[x]}</button>)}</div>
  {!error&&selected.length>=2&&<div className="wf-table-wrap"><table><caption>השוואת מועמדים — תרחיש ראשי שמור; זהות וזכויות מחייבות בדיקה נפרדת</caption><thead><tr><th>נתון</th>{rows.filter(d=>selected.includes(d.id)).map(d=><th key={d.id}>{d.canonical_address||'כתובת לא מאומתת'}<button onClick={()=>setSelected(s=>s.filter(id=>id!==d.id))}>הסר</button></th>)}</tr></thead><tbody>{[['מחיר בקשה',(d:any)=>money(d.current_asking_price_nis??d.asking_price_nis)],['שטח',(d:any)=>d.area_sqm==null?'לא ידוע':d.area_sqm+' מ״ר'],['מחיר למ״ר',(d:any)=>Number(d.area_sqm)>0?money(Number(d.current_asking_price_nis??d.asking_price_nis)/Number(d.area_sqm)):'לא ידוע'],['תרחיש ראשי',(d:any)=>d.scenario_name||'לא נשמר'],['IRR בתרחיש',(d:any)=>d.scenario_outputs?.irrPct==null?'לא חושב':d.scenario_outputs.irrPct+'%'],['בדיקות עם בעיה',(d:any)=>d.issue_count??0],['בדיקות מאומתות',(d:any)=>(d.verified_count??0)+' / '+(d.dd_total??0)],['הצעד הבא',(d:any)=>d.next_action||'לא הוגדר']].map(([label,render]:any)=><tr key={label}><th>{label}</th>{rows.filter(d=>selected.includes(d.id)).map(d=><td key={d.id}>{render(d)}</td>)}</tr>)}</tbody></table></div>}
  {!error&&(!visible.length?<div className="workflow-start"><ClipboardList size={24}/><h3>אין עסקאות בקטגוריה הזו</h3><p>פתח נכס ממחקר או הזדמנויות ולחץ על פתיחת תיק עסקה כדי להתחיל. שמירה למעקב בלבד לא יוצרת תיק עסקה.</p><a className="workflow-primary" href="#/research">מצא נכס למחקר</a></div>:
  <div className="deal-pipeline">
   {grouped.map(group=><section className="pipeline-stage" key={group.stage}><header><strong>{group.stage}</strong><span>{group.items.length}</span></header><div className="pipeline-cards">{group.items.map((d:any)=><article key={d.id}><label><input type="checkbox" checked={selected.includes(d.id)} disabled={!selected.includes(d.id)&&selected.length>=6} onChange={e=>setSelected(s=>e.target.checked?[...s,d.id]:s.filter(id=>id!==d.id))}/> השווה מועמד (2–6)</label><button className="pipeline-card" onClick={()=>{onOpen({id:d.listing_id,address:d.canonical_address||'נכס',neighborhood_id:'',neighborhood:d.neighborhood||'',city:d.city||'',asking_price:Number(d.current_asking_price_nis||d.asking_price_nis||0),sqm:d.area_sqm==null?null:Number(d.area_sqm),rooms:d.rooms==null?null:Number(d.rooms),floor:d.floor==null?null:String(d.floor)});location.hash='#/property/'+d.listing_id+'?section=deal&deal_id='+d.id;}}>
      <div className="pipeline-card-top"><strong>{d.canonical_address||'נכס'}</strong><span>{d.neighborhood||d.city||'—'}</span></div>
      <div className="pipeline-card-price">{money(d.current_asking_price_nis||d.asking_price_nis)}</div>
      <div className="pipeline-meta"><span>{d.area_sqm??'—'} מ״ר</span><span>{d.rooms??'—'} חד׳</span><span>קומה {d.floor??'—'}</span></div>
      <div className="pipeline-status"><span>Next: {d.next_action||'לא הוגדר'}</span>{Number(d.issue_count)>0&&<em>{d.issue_count} issues</em>}</div>
      <div className="pipeline-bottom"><span>{d.scenario_outputs?.irrPct!=null?'IRR '+d.scenario_outputs.irrPct+'%':'אין תרחיש'}</span><span>{dt(d.last_activity_at)}</span></div>
    </button></article>)}</div></section>)}
  </div>)}
 </div>;
}
