
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  AlertTriangle, ArrowLeft, CheckCircle2, Database, ExternalLink,
  Layers3, MapPinned, MessageSquare, RefreshCw, Search, ShieldCheck, Sparkles, Target, X, Settings, Bookmark, Eye
} from 'lucide-react';
import './p1.css';

type Area={
  id:string;name:string;city:string;avg_price_sqm:number|null;change_1y:number|null;change_3y:number|null;
  transactions_12m:number;confidence:string;sample_size:number;latest_deal_date:string|null;
  renewal_projects:number|null;existing_units:number|null;planned_units:number|null;
  median_rent_nis:number|null;median_rent_pp_sqm:number|null;rent_sample_size:number|null;rent_observed_at:string|null;
  plans?:any[];infrastructure?:any[];
};
type Opportunity={
  id:string;address:string;neighborhood_id:string;neighborhood:string;city:string;asking_price:number;
  sqm:number|null;rooms:number|null;floor:string|null;price_sqm:number|null;adjusted_value:number|null;discount_pct:number|null;
  days_on_market:number;seller_motivation:string;comp_count:number;confidence:string;latest_comp_date:string|null;
  score:number|null;last_seen_at:string|null;
};
type EdgePayload={mode:string;generatedAt:string;areas:Area[];opportunities:Opportunity[];sources:any[]};
type DataStatus={ok:boolean;counts:any;freshness:any[];quality:any[];targets:any[];checkpoints:any[]};

const coords:Record<string,{lat:number;lng:number;zoom:number}>={
  'kiryat-eliezer-haifa':{lat:32.82646,lng:34.97872,zoom:15},
  'kiryat-sprinzak-haifa':{lat:32.82023,lng:34.96238,zoom:15},
  'kiryat-nordau-netanya':{lat:32.28286,lng:34.85575,zoom:15},
  'yoseftal-petah-tikva':{lat:32.09283,lng:34.90590,zoom:15},
};

const money=(n:number|null|undefined)=>{
  if(n==null||Number.isNaN(Number(n))) return '—';
  if(n>=1000000) return '₪'+(n/1000000).toFixed(2)+'M';
  return '₪'+Math.round(n).toLocaleString('he-IL');
};
const num=(n:number|null|undefined)=>n==null?'—':Math.round(Number(n)).toLocaleString('he-IL');
const pct=(n:number|null|undefined)=>n==null?'—':(n>0?'+':'')+Number(n).toFixed(1)+'%';
const date=(s:string|null|undefined)=>s?new Date(s).toLocaleDateString('he-IL'):'—';
const confHe=(c:string)=>({high:'גבוה',medium:'בינוני',low:'נמוך',insufficient:'לא מספיק',unavailable:'לא זמין'} as any)[c]||c;
const confClass=(c:string)=>c==='high'?'good':c==='medium'?'mid':c==='low'?'low':'bad';

function Confidence({value,sample}:{value:string;sample?:number}){
  return <span className={'confidence '+confClass(value)}><ShieldCheck size={13}/>{confHe(value)}{sample!=null?' · n='+sample:''}</span>;
}

function Metric({label,value,sub}:{label:string;value:ReactNode;sub?:ReactNode}){
  return <div className="metric"><span>{label}</span><strong>{value}</strong>{sub&&<small>{sub}</small>}</div>;
}

function Empty({title,body}:{title:string;body:string}){
  return <div className="empty"><AlertTriangle size={22}/><strong>{title}</strong><p>{body}</p></div>;
}

function AreaMap({area}:{area:Area}){
  const c=coords[area.id]||{lat:32.08,lng:34.78,zoom:12};
  const [layers,setLayers]=useState({transactions:true,rent:true,renewal:true,planning:false,infrastructure:false});
  const d=0.008;
  const bbox=[c.lng-d,c.lat-d,c.lng+d,c.lat+d].join('%2C');
  const src='https://www.openstreetmap.org/export/embed.html?bbox='+bbox+'&layer=mapnik&marker='+c.lat+'%2C'+c.lng;
  const marker=(lat:number,lon:number)=>{
    const x=Math.max(2,Math.min(98,((lon-(c.lng-d))/(2*d))*100));
    const y=Math.max(2,Math.min(98,(((c.lat+d)-lat)/(2*d))*100));
    return {left:x+'%',top:y+'%'};
  };
  const planMarkers=(area.plans||[]).filter((x:any)=>x.lat!=null&&x.lon!=null).slice(0,40);
  const infraMarkers=(area.infrastructure||[]).filter((x:any)=>x.lat!=null&&x.lon!=null).slice(0,80);
  return <div className="map-wrap">
    <div className="layerbar">
      {Object.entries(layers).map(([k,v])=><button key={k} className={v?'active':''} onClick={()=>setLayers(x=>({...x,[k]:!v}))}>
        {({transactions:'עסקאות',rent:'שכירות',renewal:'התחדשות',planning:'תכנון',infrastructure:'תשתיות'} as any)[k]}
      </button>)}
    </div>
    <iframe title={'Map '+area.name} src={src} className="map-frame"/>
    <div className="marker-layer">
      {layers.planning&&planMarkers.map((p:any)=><span key={'p'+p.id} className="map-marker plan" style={marker(Number(p.lat),Number(p.lon))} title={p.name||p.plan_number||'תכנית'}/>)}
      {layers.infrastructure&&infraMarkers.map((i:any)=><span key={'i'+i.id} className={'map-marker infra '+(i.category||'')} style={marker(Number(i.lat),Number(i.lon))} title={i.name||'תשתית'}/>)}
    </div>
    <div className="map-overlay">
      {layers.transactions&&<span>עסקאות: {area.sample_size}</span>}
      {layers.rent&&<span>שכירות: {area.rent_sample_size??'לא נאסף'}</span>}
      {layers.renewal&&<span>התחדשות: {area.renewal_projects??'לא נאסף'}</span>}
      {layers.planning&&<span>תכנון: {(area.plans||[]).length}</span>}
      {layers.infrastructure&&<span>תשתיות: {(area.infrastructure||[]).length}</span>}
    </div>
  </div>;
}

function Radar({areas,onArea}:{areas:Area[];onArea:(a:Area)=>void}){
  const ready=areas.filter(a=>a.sample_size>=3).length;
  return <div className="screen">
    <div className="hero">
      <div><span className="eyebrow">Investment Radar</span><h1>איפה יש מספיק ראיות כדי להתחיל לחפש עסקה?</h1>
      <p>Edge בודק קודם את איכות המדגם. אזור בלי ראיות מספקות נשאר מסומן כחסר — לא ממולא בהערכה.</p></div>
      <div className="hero-stat"><strong>{ready}/{areas.length}</strong><span>אזורים עם מדגם בסיסי</span></div>
    </div>
    <div className="area-grid">
      {areas.map(a=><button key={a.id} className="area-card" onClick={()=>onArea(a)}>
        <div className="card-top"><div><span className="eyebrow">{a.city}</span><h3>{a.name}</h3></div><Confidence value={a.confidence} sample={a.sample_size}/></div>
        <div className="metric-grid">
          <Metric label='חציון ₪/מ"ר' value={a.avg_price_sqm?money(a.avg_price_sqm):'—'} sub={a.avg_price_sqm?a.sample_size+' עסקאות':'אין מדגם מספק'}/>
          <Metric label="שינוי 1Y" value={pct(a.change_1y)} sub={a.change_1y==null?'דורש 2 חלונות זמן':undefined}/>
          <Metric label="שכירות חציונית" value={money(a.median_rent_nis)} sub={a.median_rent_nis?(a.rent_sample_size||0)+' מודעות':'טרם נאסף'}/>
          <Metric label="התחדשות" value={a.renewal_projects==null?'—':num(a.renewal_projects)} sub={a.renewal_projects==null?'מקור טרם הושלם':'פרויקטים שנקלטו'}/>
        </div>
        <div className="card-foot"><span>עסקה אחרונה: {date(a.latest_deal_date)}</span><ArrowLeft size={15}/></div>
      </button>)}
    </div>
  </div>;
}

function Opportunities({items,onOpen}:{items:Opportunity[];onOpen:(x:Opportunity)=>void}){
  const [q,setQ]=useState('');
  const filtered=items.filter(x=>(x.address+' '+x.neighborhood+' '+x.city).includes(q));
  return <div className="screen">
    <div className="page-head"><div><span className="eyebrow">Opportunity Finder</span><h1>מלאי פעיל שעבר שכבת ראיות</h1>
      <p>Score מוצג רק כשקיימים לפחות 3 comps סגורים תקינים. ללא ראיות — אין Score.</p></div>
      <div className="search"><Search size={15}/><input value={q} onChange={e=>setQ(e.target.value)} placeholder="חפש כתובת או שכונה"/></div>
    </div>
    {filtered.length===0?<Empty title="אין כרגע הזדמנויות מאומתות" body="Edge לא יציג נכסי דמו. המלאי יופיע כאן לאחר קליטת מודעות מכירה אמיתיות וחיבורן ל-comps תקינים."/>:
    <>
    <div className="opp-cards">{filtered.map(x=><button className="opp-card" key={x.id} onClick={()=>onOpen(x)}>
      <div className="opp-title"><div><strong>{x.address}</strong><span>{x.neighborhood}, {x.city}</span></div>{x.score==null?<span className="no-score">ללא Score</span>:<span className="score">{x.score}</span>}</div>
      <div className="opp-metrics"><Metric label="מבוקש" value={money(x.asking_price)}/><Metric label='₪/מ"ר' value={money(x.price_sqm)}/><Metric label="פער comps" value={pct(x.discount_pct)}/><Metric label="ימים בשוק" value={x.days_on_market}/></div>
      <div className="opp-foot"><Confidence value={x.confidence} sample={x.comp_count}/><span>{x.seller_motivation||'—'}</span></div>
    </button>)}</div>
    <div className="table-wrap opp-table"><table><thead><tr><th>נכס</th><th>מבוקש</th><th>₪/מ"ר</th><th>שווי comps</th><th>פער</th><th>Seller</th><th>ראיות</th><th>Score</th></tr></thead>
    <tbody>{filtered.map(x=><tr key={x.id} onClick={()=>onOpen(x)}>
      <td><strong>{x.address}</strong><small>{x.neighborhood}, {x.city}</small></td><td>{money(x.asking_price)}</td><td>{money(x.price_sqm)}</td>
      <td>{money(x.adjusted_value)}</td><td>{pct(x.discount_pct)}</td><td>{x.seller_motivation||'—'}<small>{x.days_on_market} ימים</small></td>
      <td><Confidence value={x.confidence} sample={x.comp_count}/><small>עד {date(x.latest_comp_date)}</small></td>
      <td>{x.score==null?<span className="muted">אין Score</span>:<span className="score">{x.score}</span>}</td>
    </tr>)}</tbody></table></div></>}
  </div>;
}

function AreaView({area}:{area:Area}){
  return <div className="screen">
    <div className="page-head"><div><span className="eyebrow">Area Intelligence · {area.city}</span><h1>{area.name}</h1>
      <p>תמונת מצב מבוססת מקורות שנקלטו בפועל. שכבה שלא נאספה מוצגת כלא זמינה.</p></div><Confidence value={area.confidence} sample={area.sample_size}/></div>
    <div className="split">
      <AreaMap area={area}/>
      <div className="side-stack">
        <div className="panel"><h3>מחיר וסחירות</h3><div className="metric-grid">
          <Metric label='חציון ₪/מ"ר' value={money(area.avg_price_sqm)}/><Metric label="עסקאות 12M" value={num(area.transactions_12m)}/>
          <Metric label="שינוי 1Y" value={pct(area.change_1y)}/><Metric label="עסקה אחרונה" value={date(area.latest_deal_date)}/>
        </div></div>
        <div className="panel"><h3>שכירות</h3>{area.median_rent_nis==null?<Empty title="טרם נאסף מדגם שכירות" body="הערכה לא תוצג עד שקליטת מודעות שכירות אמיתיות תסתיים."/>:
          <div className="metric-grid"><Metric label="חציון מבוקש" value={money(area.median_rent_nis)}/><Metric label='₪/מ"ר' value={money(area.median_rent_pp_sqm)}/><Metric label="מדגם" value={num(area.rent_sample_size)}/></div>}</div>
        <div className="panel"><h3>התחדשות ותכנון</h3>{area.renewal_projects==null?<Empty title="שכבת ההתחדשות עדיין לא מוכנה" body="לא מוצגים נתוני דמו או הערכות ידניות."/>:
          <div className="metric-grid"><Metric label="פרויקטים" value={num(area.renewal_projects)}/><Metric label="יח״ד קיימות" value={num(area.existing_units)}/><Metric label="יח״ד מתוכננות" value={num(area.planned_units)}/><Metric label="תכניות XPLAN" value={num((area.plans||[]).length)}/></div>}</div>
        <div className="panel"><h3>תשתיות סביב האזור</h3>{!(area.infrastructure||[]).length?<Empty title="אין עדיין שכבות תחבורה שנקלטו" body="הקולקטור יציג כאן תחנות ומתקנים מתוכננים לאחר הסנכרון."/>:
          <div className="feature-list">{(area.infrastructure||[]).slice(0,8).map((i:any)=><div className="feature-row" key={i.id}><strong>{i.name}</strong><span>{i.category} · {i.status||'—'}</span></div>)}</div>}</div>
      </div>
    </div>
  </div>;
}

function PropertyView({item,onBack}:{item:Opportunity;onBack:()=>void}){
  const [data,setData]=useState<any>(null);
  const [loading,setLoading]=useState(true);
  useEffect(()=>{setLoading(true);fetch('/api/property?id='+encodeURIComponent(item.id)).then(r=>r.json()).then(setData).finally(()=>setLoading(false));},[item.id]);
  if(loading)return <div className="screen"><div className="loading"><RefreshCw className="spin"/>טוען Property Intelligence…</div></div>;
  if(!data||data.error)return <div className="screen"><button className="back" onClick={onBack}><ArrowLeft/>חזרה</button><Empty title="לא ניתן לטעון את הנכס" body={data?.error||'שגיאת API'}/></div>;
  const l=data.listing||{};
  const [subBusy,setSubBusy]=useState(false);
  const toggleSub=async()=>{setSubBusy(true);await fetch('/api/research',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({action:l.subscription_id?'unsubscribe':'subscribe',entity_id:item.id,entity_type:'listing'})});const r=await fetch('/api/property?id='+encodeURIComponent(item.id),{cache:'no-store'});setData(await r.json());setSubBusy(false)};
  return <div className="screen">
    <button className="back" onClick={onBack}><ArrowLeft size={15}/>חזרה להזדמנויות</button>
    <div className="page-head"><div><span className="eyebrow">Property Intelligence · {data.tier==='full'?'Full research':'Basic'}</span><h1>{l.address||item.address}</h1>
      <p>{l.neighborhood}, {l.city} · {data.tier==='full'?'מעקב מלא לאורך זמן':'מידע בסיסי — עקוב כדי להפעיל מחקר מלא'}</p></div>
      <div className="property-actions"><button className={'follow '+(l.subscription_id?'on':'')} onClick={toggleSub} disabled={subBusy}>{l.subscription_id?<><Bookmark size={14}/>במעקב</>:<><Eye size={14}/>הפעל מעקב מלא</>}</button><Confidence value={data.confidence?.confidence||'insufficient'} sample={data.confidence?.sample_12m||0}/></div></div>
    {data.tier==='basic'&&<div className="upgrade-banner"><Bookmark size={18}/><div><strong>Basic property profile</strong><span>Follow this asset to unlock full comp history, seller behavior, rent, planning, renewal, infrastructure and score explanation — and keep tracking changes over time.</span></div></div>}
    <div className="property-grid">
      <div className="panel"><h3>Investment memo</h3>
        <p className="memo">{data.comps?.length>=3?'יש בסיס ראשוני להשוואת מחיר. יש לבדוק התאמות קומה, מצב ובניין לפני החלטה.':'אין עדיין מספיק comps כדי לבסס שווי אמין; Edge לא מפיק Score.'}</p>
        <div className="metric-grid"><Metric label="מבוקש" value={money(l.asking_price_ils)}/><Metric label="שטח" value={l.area_sqm?l.area_sqm+' מ"ר':'—'}/><Metric label="חדרים" value={l.rooms??'—'}/><Metric label="מדגם comps" value={data.comps?.length||0}/></div>
      </div>
      <div className="panel wide"><h3>Comparable transactions</h3>{!data.comps?.length?<Empty title="אין comps תקינים" body="עסקאות בעלות חלקית וחריגות איכות מסוננות החוצה."/>:
        <div className="table-wrap"><table><thead><tr><th>כתובת</th><th>תאריך</th><th>מחיר</th><th>שטח</th><th>₪/מ"ר</th></tr></thead><tbody>
        {data.comps.map((c:any,i:number)=><tr key={i}><td>{c.address}</td><td>{c.date}</td><td>{money(c.price)}</td><td>{c.sqm||'—'}</td><td>{money(c.price_sqm)}</td></tr>)}</tbody></table></div>}</div>
      <div className="panel"><h3>Seller signal</h3>{data.seller&&Object.keys(data.seller).length?<div className="metric-grid"><Metric label="ימים בשוק" value={data.seller.days_on_market??'—'}/><Metric label="הורדות מחיר" value={data.seller.price_reductions??'—'}/><Metric label="מחיר מקורי" value={money(data.seller.original_asking_price)}/></div>:<Empty title="אין היסטוריית מוכר" body="אין מספיק snapshots כדי להסיק מוטיבציה."/>}</div>
      <div className="panel"><h3>התחדשות</h3>{data.renewal?.length?data.renewal.map((r:any,i:number)=><div className="renew-row" key={i}><strong>{r.name}</strong><span>{r.status||'סטטוס לא זמין'} · {r.plan_number||'ללא מספר תכנית'}</span>{r.official_url&&<a href={r.official_url} target="_blank" rel="noreferrer">מקור רשמי <ExternalLink size={12}/></a>}</div>):<Empty title="לא נמצא פרויקט מקושר" body="לא נציג סטטוס התחדשות משוער."/>}</div>
    </div>
  </div>;
}

function DataConsole({status}:{status:DataStatus|null}){
  if(!status)return <div className="screen"><div className="loading"><RefreshCw className="spin"/>טוען מצב מקורות…</div></div>;
  return <div className="screen">
    <div className="page-head"><div><span className="eyebrow">Data & Agents</span><h1>בריאות מקורות ו-ETL</h1><p>זהו מקור האמת התפעולי של Edge — לא סטטוס דמו.</p></div></div>
    <div className="summary-strip">
      <Metric label="עסקאות" value={num(status.counts?.transactions)}/><Metric label="Comparable" value={num(status.counts?.comparable_transactions)}/>
      <Metric label="Excluded" value={num(status.counts?.excluded_transactions)}/><Metric label="Target parcels" value={num(status.counts?.target_parcels)}/>
      <Metric label="Sale listings" value={num(status.counts?.listings)}/><Metric label="Rental listings" value={num(status.counts?.rental_listings)}/>
      <Metric label="XPLAN plans" value={num(status.counts?.planning_plans)}/><Metric label="Infrastructure" value={num(status.counts?.infrastructure_projects)}/>
    </div>
    <div className="panel"><h3>Provider health</h3><p className="panel-sub">Freshness + run outcome + raw ingestion + usable canonical coverage.</p>
      <div className="provider-cards">{(status.freshness||[]).filter((s:any)=>s.is_enabled).map((s:any)=><div className={'provider-card '+s.health} key={'m'+s.source_id}>
        <div className="provider-head"><div><strong>{s.name}</strong><small>{s.source_id}</small></div><span className={'health '+s.health}>{s.health==='healthy'?<CheckCircle2 size={13}/>:<AlertTriangle size={13}/>} {s.health}</span></div>
        <div className="provider-stats"><Metric label="Fetched" value={num(s.fetched_count)}/><Metric label="Raw" value={num(s.raw_rows)}/><Metric label="Usable" value={num(s.canonical_rows)}/></div>
        <div className="provider-reason">{s.health_reason||'—'}<small>Last run: {date(s.last_finished_at)}</small></div>
      </div>)}</div>
      <div className="table-wrap provider-table"><table><thead><tr><th>מקור</th><th>Health</th><th>Run</th><th>Fetched</th><th>Raw</th><th>Usable</th><th>Last run</th><th>Reason</th></tr></thead><tbody>
      {(status.freshness||[]).filter((s:any)=>s.is_enabled).map((s:any)=><tr key={s.source_id}><td><strong>{s.name}</strong><small>{s.source_id}</small></td>
        <td><span className={'health '+s.health}>{s.health==='healthy'?<CheckCircle2 size={13}/>:<AlertTriangle size={13}/>} {s.health}</span></td>
        <td>{s.run_status||'—'}</td><td>{num(s.fetched_count)}</td><td>{num(s.raw_rows)}</td><td>{num(s.canonical_rows)}</td>
        <td>{date(s.last_finished_at)}</td><td className="err">{s.health_reason||s.error_summary||'—'}</td></tr>)}
    </tbody></table></div></div>
    <div className="panel"><h3>Coverage by target neighborhood</h3><div className="table-wrap"><table><thead><tr><th>שכונה</th><th>Target parcels</th><th>עסקאות 12M</th><th>Confidence</th><th>עסקה אחרונה</th></tr></thead><tbody>
      {(status.quality||[]).map((q:any)=><tr key={q.slug}><td>{q.name_he}</td><td>{q.target_parcels}</td><td>{q.sample_12m}</td><td><Confidence value={q.confidence} sample={q.sample_12m}/></td><td>{date(q.latest_deal_date)}</td></tr>)}
    </tbody></table></div></div>
  </div>;
}


function Research({onOpen}:{onOpen:(x:any)=>void}){
 const [assets,setAssets]=useState<any[]>([]),[q,setQ]=useState(''),[only,setOnly]=useState(false),[busy,setBusy]=useState(false);
 const load=async()=>{setBusy(true);try{const r=await fetch('/api/research?q='+encodeURIComponent(q)+(only?'&subscribed=true':''),{cache:'no-store'});const j=await r.json();setAssets(j.assets||[])}finally{setBusy(false)}};
 useEffect(()=>{load()},[only]);
 const sub=async(a:any)=>{await fetch('/api/research',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({action:a.subscription_id?'unsubscribe':'subscribe',entity_id:a.id,entity_type:'listing'})});await load()};
 return <div className="screen"><div className="page-head"><div><span className="eyebrow">Research Universe</span><h1>חקור את כל הנכסים — לא רק הזדמנויות</h1><p>כל נכס שנקלט זמין למחקר בסיסי. Follow מפעיל מחקר מלא ומעקב לאורך זמן.</p></div><div className="hero-stat"><strong>{assets.length}</strong><span>נכסים בתוצאה</span></div></div>
 <div className="research-tools"><div className="search"><Search size={15}/><input value={q} onChange={e=>setQ(e.target.value)} onKeyDown={e=>e.key==='Enter'&&load()} placeholder="כתובת, שכונה או עיר"/><button onClick={load}>חפש</button></div><button className={only?'active':''} onClick={()=>setOnly(!only)}><Bookmark size={14}/>במעקב בלבד</button></div>
 {busy?<div className="empty">טוען…</div>:assets.length===0?<Empty title="אין נכסים בתוצאה" body="ה-Research Universe יתמלא מכל מודעות המכירה שנקלטות, ללא תלות ב-Edge Score."/>:
 <div className="research-grid">{assets.map(a=><article className="research-card" key={a.id}><button className="research-main" onClick={()=>onOpen({id:a.id,address:a.canonical_address,neighborhood:a.neighborhood,city:a.city,asking_price:Number(a.asking_price_nis),sqm:Number(a.area_sqm),rooms:Number(a.rooms),floor:a.floor,score:a.score==null?null:Number(a.score)})}><div><strong>{a.canonical_address||'כתובת לא זמינה'}</strong><span>{a.neighborhood} · {a.city}</span></div><div className="research-price">{money(Number(a.asking_price_nis))}<small>{a.asking_pp_sqm?money(Number(a.asking_pp_sqm))+'/מ״ר':'—'}</small></div><div className="research-meta"><span>{a.rooms||'—'} חד׳</span><span>{a.area_sqm||'—'} מ״ר</span><span>{a.score?'Score '+a.score:'ללא Score'}</span></div></button><button className={'follow '+(a.subscription_id?'on':'')} onClick={()=>sub(a)}>{a.subscription_id?<><Bookmark size={14}/>במעקב</>:<><Eye size={14}/>עקוב</>}</button></article>)}</div>}
 </div>
}

function Admin(){
 const [d,setD]=useState<any>(null),[saving,setSaving]=useState(false);
 const load=async()=>{const r=await fetch('/api/admin',{cache:'no-store'});setD(await r.json())};useEffect(()=>{load()},[]);
 if(!d)return <div className="screen"><div className="empty">טוען הגדרות…</div></div>;
 const cfg=d.config||{};const fields=[['base_score','Base score'],['price_gap_weight','Price-gap weight'],['price_gap_min','Price-gap min'],['price_gap_max','Price-gap max'],['renewal_project_weight','Renewal / project'],['renewal_execution_bonus','Execution bonus'],['seller_reduction_weight','Price-reduction weight'],['comp_min_required','Minimum comps'],['low_comp_risk','Low-comp risk']];
 const save=async()=>{setSaving(true);await fetch('/api/admin',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({action:'score',...cfg})});await load();setSaving(false)};
 const area=async(a:any)=>{await fetch('/api/admin',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({action:'area',neighborhood_id:a.id,followed:!a.followed,research_depth:'full'})});await load()};
 return <div className="screen"><div className="page-head"><div><span className="eyebrow">Administration</span><h1>איך Edge מחפש ומדרג</h1><p>שינוי נוסחה יוצר גרסת Score חדשה. שינוי אזור מגדיר את יקום המחקר והאיסוף הבא.</p></div></div>
 <div className="admin-grid"><div className="panel"><h3>Score formula</h3><div className="formula">Score = Base + Price Gap + Renewal + Seller + Comp Confidence − Risk</div><div className="config-grid">{fields.map(([k,l])=><label key={k}><span>{l}</span><input type="number" step="0.1" value={cfg[k]??''} onChange={e=>setD({...d,config:{...cfg,[k]:Number(e.target.value)}})}/></label>)}</div><button className="primary" onClick={save} disabled={saving}>{saving?'שומר…':'שמור ויצור גרסת Score חדשה'}</button><small className="version">Active: {cfg.model_version}</small></div>
 <div className="panel"><h3>Followed areas</h3><p className="panel-sub">אזורים פעילים נכנסים לאיסוף, מחקר ומעקב. אפשר להוסיף שכונות חדשות לבסיס הנתונים ואז להפעיל אותן כאן.</p><div className="area-admin">{d.areas.map((a:any)=><button key={a.id} className={a.followed?'followed':''} onClick={()=>area(a)}><div><strong>{a.name_he}</strong><span>{a.city}</span></div><span>{a.followed?'במעקב':'לא במעקב'}</span></button>)}</div></div></div></div>
}

function AskDrawer({open,onClose}:{open:boolean;onClose:()=>void}){
  const [q,setQ]=useState('');
  const [messages,setMessages]=useState<{role:string;text:string;evidence?:any}[]>([]);
  const [busy,setBusy]=useState(false);
  const ask=async(text:string)=>{
    if(!text.trim()||busy)return;
    setMessages(m=>[...m,{role:'user',text}]);setQ('');setBusy(true);
    try{const r=await fetch('/api/ask',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({question:text})});const j=await r.json();
      setMessages(m=>[...m,{role:'edge',text:j.answer||j.error||'אין תשובה',evidence:j.evidence}]);
    }catch{setMessages(m=>[...m,{role:'edge',text:'שירות Ask Edge אינו זמין כרגע.'}]);}finally{setBusy(false);}
  };
  if(!open)return null;
  return <div className="drawer-backdrop" onMouseDown={onClose}><aside className="drawer" onMouseDown={e=>e.stopPropagation()}>
    <div className="drawer-head"><div><strong>Ask Edge</strong><span>Live data agent · Neon</span></div><button onClick={onClose}><X/></button></div>
    <div className="chat">{messages.length===0&&<div className="suggestions"><span>נסה:</span>
      {['השווה בין קריית אליעזר לקריית שפרינצק','מה המחיר למ״ר בקריית אליעזר?','יש כרגע הזדמנויות בקריית נורדאו?'].map(x=><button key={x} onClick={()=>ask(x)}>{x}</button>)}</div>}
      {messages.map((m,i)=><div key={i} className={'bubble '+m.role}><pre>{m.text}</pre>{m.evidence&&<small>Evidence attached · live DB</small>}</div>)}
      {busy&&<div className="bubble edge">Edge קורא את בסיס הנתונים…</div>}</div>
    <form className="ask-form" onSubmit={e=>{e.preventDefault();ask(q)}}><textarea value={q} onChange={e=>setQ(e.target.value)} placeholder="שאל על אזור, מחיר, שכירות או הזדמנות"/><button disabled={busy}><Sparkles size={16}/></button></form>
  </aside></div>;
}

export default function EdgeP1(){
  const [data,setData]=useState<EdgePayload|null>(null);
  const [status,setStatus]=useState<DataStatus|null>(null);
  const [error,setError]=useState('');
  const [tab,setTab]=useState<'radar'|'research'|'opps'|'area'|'data'|'admin'|'property'>('radar');
  const [area,setArea]=useState<Area|null>(null);
  const [property,setProperty]=useState<Opportunity|null>(null);
  const [askOpen,setAskOpen]=useState(false);
  const [refreshing,setRefreshing]=useState(false);

  const load=async()=>{
    setRefreshing(true);setError('');
    try{
      const [a,b]=await Promise.all([fetch('/api/edge-data',{cache:'no-store'}),fetch('/api/data-status',{cache:'no-store'})]);
      if(!a.ok)throw new Error('edge-data '+a.status);
      const live=await a.json(); if(live.mode!=='live')throw new Error(live.error||'live API unavailable');
      setData(live); if(b.ok)setStatus(await b.json());
      if(!area&&live.areas?.length)setArea(live.areas[0]);
    }catch(e:any){setError(e?.message||String(e));setData(null);}finally{setRefreshing(false);}
  };
  useEffect(()=>{load();},[]);

  const currentArea=area||data?.areas?.[0]||null;
  const sourceHealth=useMemo(()=>status?.freshness||[],[status]);
  const degraded=sourceHealth.filter((s:any)=>s.health==='degraded').length;

  if(!data&&error)return <div dir="rtl" className="edge-p1 fatal"><AlertTriangle/><h1>Edge live data unavailable</h1><p>{error}</p><button onClick={load}>נסה שוב</button></div>;
  if(!data)return <div dir="rtl" className="edge-p1 fatal"><RefreshCw className="spin"/><h1>טוען נתוני אמת…</h1></div>;

  const nav=[
    ['radar','רדאר',MapPinned],['research','מחקר',Search],['opps','הזדמנויות',Target],['area','אזור',Layers3],['data','נתונים',Database],['admin','ניהול',Settings]
  ] as const;

  return <div dir="rtl" className="edge-p1">
    <aside className="rail"><div className="brand"><span>E</span><b>EDGE</b></div>
      {nav.map(([id,label,Icon])=><button key={id} className={tab===id?'active':''} onClick={()=>setTab(id as any)}><Icon size={18}/><span>{label}</span></button>)}
    </aside>
    <div className="workspace">
      <header className="topbar">
        <div className="live"><span className="dot"/>LIVE · {date(data.generatedAt)}{degraded>0&&<em>{degraded} מקורות degraded</em>}</div>
        <div className="top-actions"><button onClick={load} disabled={refreshing}><RefreshCw size={14} className={refreshing?'spin':''}/>רענן</button><button className="ask" onClick={()=>setAskOpen(true)}><MessageSquare size={15}/>Ask Edge</button></div>
      </header>
      <main>
        {tab==='radar'&&<Radar areas={data.areas||[]} onArea={a=>{setArea(a);setTab('area')}}/>}
        {tab==='research'&&<Research onOpen={x=>{setProperty(x);setTab('property')}}/>}
        {tab==='opps'&&<Opportunities items={data.opportunities||[]} onOpen={x=>{setProperty(x);setTab('property')}}/>}
        {tab==='area'&&currentArea&&<AreaView area={currentArea}/>}
        {tab==='data'&&<DataConsole status={status}/>} 
        {tab==='admin'&&<Admin/>}
        {tab==='property'&&property&&<PropertyView item={property} onBack={()=>setTab('opps')}/>}
      </main>
    </div>
    <AskDrawer open={askOpen} onClose={()=>setAskOpen(false)}/>
  </div>;
}
