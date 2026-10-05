import {Fragment,useEffect,useRef,useState} from 'react';
import './research.css';
const defaults:Record<string,string>={q:'',city:'',minPrice:'',maxPrice:'',minRooms:'',maxRooms:'',minSqm:'',maxSqm:'',minScore:'',subscribed:'',system:'',followed:'',sort:'last_seen_at',dir:'desc'};
function read(){const p=new URLSearchParams(location.hash.split('?')[1]||'');return Object.fromEntries(Object.entries(defaults).map(([k,v])=>[k,p.get(k)??v]));}
function query(f:Record<string,string>){const p=new URLSearchParams();Object.entries(f).forEach(([k,v])=>{if(v&&v!==defaults[k])p.set(k,v)});return p.toString();}
const money=(v:any)=>v==null||v===''?'לא ידוע':'₪'+Number(v).toLocaleString('he-IL',{maximumFractionDigits:0});
const value=(v:any)=>v==null||v===''?'לא ידוע':String(v);
const positionKey='edge:research-position:v1';
export default function Research({onOpen}:{onOpen:(x:any)=>void}){
 const [applied,setApplied]=useState(read),[draft,setDraft]=useState(read),[offset,setOffset]=useState(()=>Number(new URLSearchParams(location.hash.split('?')[1]).get('offset'))||0);
 const [assets,setAssets]=useState<any[]>([]),[total,setTotal]=useState(0),[facets,setFacets]=useState<any>({}),[busy,setBusy]=useState(true),[error,setError]=useState(''),[rowBusy,setRowBusy]=useState<string|null>(null),[expanded,setExpanded]=useState<string|null>(null),[refresh,setRefresh]=useState(0);
 const table=useRef<HTMLDivElement>(null);const request=useRef(0);
 const route=location.hash,dirty=query(draft)!==query(applied);
 useEffect(()=>{const change=()=>{if(!location.hash.startsWith('#/research'))return;const f=read();setApplied(f);setDraft(f);setOffset(Number(new URLSearchParams(location.hash.split('?')[1]).get('offset'))||0)};window.addEventListener('hashchange',change);return()=>window.removeEventListener('hashchange',change)},[]);
 useEffect(()=>{
  const token=++request.current,controller=new AbortController();setBusy(true);setError('');setAssets([]);
  const p=new URLSearchParams({mode:'research',limit:'50',offset:String(offset)});Object.entries(applied).forEach(([k,v])=>{if(v)p.set(k,v)});
  fetch('/api/opportunities?'+p,{cache:'no-store',signal:controller.signal}).then(async r=>{if(!r.ok)throw Error('לא ניתן לטעון את הנכסים. נסה שוב.');const j=await r.json();if(!Array.isArray(j.assets)||!Number.isFinite(Number(j.total)))throw Error('תשובת החיפוש אינה תקינה. נסה שוב.');if(token!==request.current)return;setAssets(j.assets);setTotal(Number(j.total));setFacets(j.facets||{});setBusy(false);
   requestAnimationFrame(()=>{try{const saved=JSON.parse(sessionStorage.getItem(positionKey)||'null');if(saved?.route===location.hash){setExpanded(saved.expanded||null);requestAnimationFrame(()=>{window.scrollTo(0,saved.y||0);if(table.current)table.current.scrollLeft=saved.x||0})}}catch{/* optional browser state */}});
  }).catch(e=>{if(e.name!=='AbortError'&&token===request.current){setError(e.message);setBusy(false)}});
  return()=>controller.abort();
 },[applied,offset,refresh]);
 const change=(k:string,v:string)=>setDraft(f=>({...f,[k]:v}));
 const navigate=(f:Record<string,string>,start=0)=>{const p=new URLSearchParams(query(f));if(start)p.set('offset',String(start));const next='#/research'+(p.size?'?'+p:'');setExpanded(null);try{sessionStorage.removeItem(positionKey)}catch{};if(location.hash===next){setApplied({...f});setOffset(start)}else location.hash=next;};
 const open=(a:any)=>{try{sessionStorage.setItem(positionKey,JSON.stringify({route,y:window.scrollY,x:table.current?.scrollLeft||0,expanded}))}catch{};onOpen({id:a.id,address:a.canonical_address,neighborhood:a.neighborhood,city:a.city,asking_price:a.asking_price_nis==null?null:Number(a.asking_price_nis),sqm:a.area_sqm==null?null:Number(a.area_sqm),rooms:a.rooms==null?null:Number(a.rooms),floor:a.floor,score:a.score==null?null:Number(a.score)})};
 const follow=async(a:any)=>{setRowBusy(a.id);setError('');try{const r=await fetch('/api/opportunities',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({action:a.subscription_id?'unsubscribe':'subscribe',entity_id:a.id,entity_type:'listing'})});const j=await r.json();if(!r.ok||j.error)throw Error('המעקב לא נשמר. נסה שוב.');setRefresh(n=>n+1)}catch(e:any){setError(e.message)}finally{setRowBusy(null)}};
 return <div className="screen research-screen">
  <div className="page-head"><div><span className="eyebrow">מחקר נכסים</span><h1>כל הנכסים ש-Edge מכיר</h1><p>חפש נכס, בדוק את הראיות ופתח תיק עסקה כשיש מועמד מתאים. מעקב שומר נכס לבדיקה; הוא אינו יוצר תיק עסקה.</p><a href="/yad2.html">מחקר יד2 ארצי והיסטוריית שינויים</a></div><div className="hero-stat"><strong>{busy?'…':error?'—':total}</strong><span>נכסים תואמים</span></div></div>
  <form onSubmit={e=>{e.preventDefault();navigate(draft)}} className="research-controls">
   <label>כתובת, שכונה או עיר<input value={draft.q} onChange={e=>change('q',e.target.value)}/></label>
   <label>עיר<select aria-label="עיר" value={draft.city} onChange={e=>change('city',e.target.value)}><option value="">כל הערים</option>{[...new Set([draft.city,...(facets.cities||[])])].filter(Boolean).map((x:any)=><option key={x}>{x}</option>)}</select></label>
   {([['minPrice','מחיר מינימלי'],['maxPrice','מחיר מקסימלי'],['minRooms','חדרים מינימום'],['maxRooms','חדרים מקסימום'],['minSqm','מ״ר מינימום'],['maxSqm','מ״ר מקסימום'],['minScore','ציון מינימלי']] as const).map(([k,label])=><label key={k}>{label}<input type="number" min="0" step={k.includes('Rooms')?'.5':'1'} value={draft[k]} onChange={e=>change(k,e.target.value)}/></label>)}
   <label>מיון<select aria-label="מיון" value={draft.sort} onChange={e=>change('sort',e.target.value)}>{Object.entries({last_seen_at:'עדכון אחרון',asking_price_nis:'מחיר',asking_pp_sqm:'מחיר למ״ר',discount_pct:'פער מול עסקאות',score:'ציון',days_on_market:'ימים בשוק',comp_count:'כמות עסקאות להשוואה'}).map(([k,v])=><option value={k} key={k}>{v}</option>)}</select></label>
   <label>כיוון מיון<select aria-label="כיוון מיון" value={draft.dir} onChange={e=>change('dir',e.target.value)}><option value="desc">יורד</option><option value="asc">עולה</option></select></label>
   <div className="research-checks">{[['subscribed','נכסים במעקב שלי'],['system','סומנו בידי המערכת'],['followed','אזורים במעקב']].map(([k,label])=><label key={k}><input type="checkbox" checked={draft[k]==='true'} onChange={e=>change(k,e.target.checked?'true':'')}/>{label}</label>)}</div>
   <button className="primary" type="submit" disabled={busy}>חפש נכסים</button><button type="button" onClick={()=>navigate(defaults)}>נקה סינון</button>
   <span role="status">{dirty?'הסינון השתנה — לחץ חפש נכסים כדי לעדכן את התוצאות.':busy?'טוען נכסים…':'התוצאות תואמות לסינון המוצג.'}</span>
  </form>
  {error&&<div className="research-error" role="alert">{error}<button onClick={()=>setRefresh(n=>n+1)}>נסה שוב</button></div>}
  {busy?<div className="empty">טוען נכסים…</div>:!error&&assets.length===0?<div className="empty"><h2>לא נמצאו נכסים בסינון הזה</h2><button onClick={()=>navigate(defaults)}>הצג את כל הנכסים</button></div>:assets.length>0&&<>
  <p>מציג {offset+1}–{offset+assets.length} מתוך {total}. הפער הוא אינדיקציה לבדיקה; הוא אינו הוכחה למחיר רכישה כדאי.</p>
  <div className="table-wrap research-table" ref={table} tabIndex={0} aria-label="תוצאות מחקר נכסים"><table><thead><tr><th>נכס</th><th>מבוקש</th><th>גודל וחדרים</th><th>פער לחציון שכונה · 18 חודשים</th><th>ראיות</th><th>פעולות</th></tr></thead><tbody>{assets.map(a=><Fragment key={a.id}><tr>
   <td><button className="research-property" onClick={()=>open(a)}>{a.canonical_address||'כתובת לא ידועה'}</button><small>{a.city||'עיר לא ידועה'} · {a.neighborhood||'שכונה לא ידועה'}</small></td><td>{money(a.asking_price_nis)}<small>{money(a.asking_pp_sqm)} / מ״ר</small></td><td>{value(a.area_sqm)} מ״ר<small>{value(a.rooms)} חדרים · קומה {value(a.floor)}</small></td><td>{a.discount_pct==null?'לא ידוע':Number(a.discount_pct).toFixed(1)+'%'}<small>אינו שווי פרטני לדירה</small></td><td>{value(a.comp_count)} עסקאות באזור<small>כיסוי באזור: {({high:'גבוה',medium:'בינוני',low:'נמוך',insufficient:'אין מספיק ראיות'} as Record<string,string>)[a.confidence]||'לא ידוע'}</small></td>
   <td><button aria-expanded={expanded===a.id} onClick={()=>setExpanded(expanded===a.id?null:a.id)}>פרטים נוספים</button><button disabled={rowBusy===a.id} onClick={()=>follow(a)}>{rowBusy===a.id?'שומר…':a.subscription_id?'הסר מעקב':'עקוב אחר נכס'}</button></td></tr>
   {expanded===a.id&&<tr><td colSpan={6}><dl className="research-details">{[['ימים בשוק',a.days_on_market],['הורדות מחיר',a.price_reductions],['פרויקטי התחדשות באזור',a.renewal_projects],['תוכניות באזור',a.planning_plans],['ציון',a.score],['מקור',a.source_id],['עדכון אחרון',a.last_seen_at?new Date(a.last_seen_at).toLocaleDateString('he-IL'):null],['סומן במערכת',a.system_flag?'כן':'לא']].map(([k,v])=><div key={String(k)}><dt>{k}</dt><dd>{value(v)}</dd></div>)}</dl><p>התחדשות ותכנון באזור אינם מוכיחים שיוך של הבניין או הדירה לפרויקט.</p></td></tr>}
  </Fragment>)}</tbody></table></div><nav className="research-pagination" aria-label="עמודי תוצאות"><button disabled={offset===0||busy} onClick={()=>navigate(applied,Math.max(0,offset-50))}>הקודם</button><span>עמוד {Math.floor(offset/50)+1}</span><button disabled={offset+assets.length>=total||busy} onClick={()=>navigate(applied,offset+50)}>הבא</button></nav></>}
 </div>
}
