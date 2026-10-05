import React,{useEffect,useMemo,useState} from 'react';
import './neighborhood-intelligence.css';
import OpenStreetIntelligenceMap from './OpenStreetIntelligenceMap';

type NeighborhoodMapRow={
 neighborhood_id:string;slug:string;name_he:string;city:string;
 deal_heat:number|null;investment_score:number|null;confidence_score:number|null;confidence_level:string|null;
 coverage_pct:number|null;deal_count:number;transaction_count_12m:number;median_price_sqm_12m:number|null;
 price_change_1y:number|null;renewal_expansion_ratio:number|null;estimated_gross_yield:number|null;
 average_wage:number|null;net_internal_migration:number|null;construction_starts:number|null;parcel_count?:number;parcel_geometry_count?:number;geometry:any|null;
};
type CityMapRow={city_id:string;settlement_code:string;name_he:string;name_en:string|null;geometry:any|null;transaction_count_12m:number;median_deal_amount_12m:number|null;median_price_sqm_12m:number|null;price_change_1y:number|null;latest_transaction_date:string|null;has_transaction_data:boolean};
type ParcelMapRow={id:string;gush:number;helka:number;suffix:string;lon:number|null;lat:number|null;geometry:any|null;transaction_count:number;latest_transaction_date:string|null};
type Summary={neighborhood:any;metrics:any[];datasets:any[]};
type LayerKey='median_price_sqm_12m'|'transaction_count_12m'|'price_change_1y'|'median_deal_amount_12m';
const layers:{key:LayerKey;label:string;unit:string}[]=[
 {key:'median_price_sqm_12m',label:'Executed ₪/m²',unit:'₪'},
 {key:'transaction_count_12m',label:'Transactions 12M',unit:'count'},
 {key:'price_change_1y',label:'1Y Price Change',unit:'%'},
 {key:'median_deal_amount_12m',label:'Median Deal Price',unit:'₪'}
];

const money=(v:any)=>v==null?'—':'₪'+Math.round(Number(v)).toLocaleString('he-IL');
const num=(v:any,d=1)=>v==null?'—':Number(v).toFixed(d);
const pct=(v:any)=>v==null?'—':(Number(v)>=0?'+':'')+Number(v).toFixed(1)+'%';

function flattenCoords(g:any):[number,number][]{
 const out:[number,number][]=[];
 const walk=(x:any)=>{
  if(!Array.isArray(x))return;
  if(typeof x[0]==='number'&&typeof x[1]==='number')out.push([x[0],x[1]]);
  else x.forEach(walk);
 };
 walk(g?.coordinates);
 return out;
}
function geoPath(g:any,b:{minX:number;maxX:number;minY:number;maxY:number},w:number,h:number){
 if(!g)return '';
 const sx=(x:number)=>24+(x-b.minX)/(b.maxX-b.minX||1)*(w-48);
 const sy=(y:number)=>24+(b.maxY-y)/(b.maxY-b.minY||1)*(h-48);
 const ring=(r:any[])=>r.map((p,i)=>(i?'L':'M')+sx(p[0]).toFixed(2)+','+sy(p[1]).toFixed(2)).join(' ')+' Z';
 if(g.type==='Polygon')return g.coordinates.map(ring).join(' ');
 if(g.type==='MultiPolygon')return g.coordinates.flatMap((p:any)=>p.map(ring)).join(' ');
 return '';
}
function colorFor(v:number|null,min:number,max:number){
 if(v==null||!Number.isFinite(v))return 'var(--ni-no-data)';
 const t=Math.max(0,Math.min(1,(v-min)/(max-min||1)));
 const hue=8+t*122;
 return `hsl(${hue} 68% ${48-t*9}%)`;
}

function Sparkline({rows}:{rows:any[]}){
 const points=useMemo(()=>{
  const valid=rows.filter(r=>r.deal_date&&Number(r.normalized_pp_sqm??r.pp_sqm)>0).slice().reverse();
  if(valid.length<2)return '';
  const vals=valid.map(r=>Number(r.normalized_pp_sqm??r.pp_sqm));
  const lo=Math.min(...vals),hi=Math.max(...vals);
  return vals.map((v,i)=>`${(i/(vals.length-1))*100},${36-(v-lo)/(hi-lo||1)*30}`).join(' ');
 },[rows]);
 return <svg className="ni-spark" viewBox="0 0 100 40" preserveAspectRatio="none">{points&&<polyline points={points} fill="none" stroke="currentColor" strokeWidth="2"/>}</svg>;
}

export default function NeighborhoodIntelligenceShell({children}:{children:React.ReactNode}){
 const [open,setOpen]=useState(()=>location.hash.startsWith('#/areas'));
 const [rows,setRows]=useState<NeighborhoodMapRow[]>([]);
 const [cities,setCities]=useState<CityMapRow[]>([]);
 const [loading,setLoading]=useState(false);
 const [layer,setLayer]=useState<LayerKey>('median_price_sqm_12m');
 const [selected,setSelected]=useState<string|null>(null);
 const [radarAreas,setRadarAreas]=useState<any[]>([]);
 const [selectedCity,setSelectedCity]=useState<string|null>(null);
 const [summary,setSummary]=useState<Summary|null>(null);
 const [section,setSection]=useState('overview');
 const [sectionData,setSectionData]=useState<any>([]);
 const [agentAnswer,setAgentAnswer]=useState('');
 const [asking,setAsking]=useState(false);
 const [error,setError]=useState<string|null>(null);
 const [parcelRows,setParcelRows]=useState<ParcelMapRow[]>([]);
 const [parcelFocus,setParcelFocus]=useState(false);
 const [selectedParcel,setSelectedParcel]=useState<ParcelMapRow|null>(null);

 useEffect(()=>{
  const onHash=()=>{setOpen(location.hash.startsWith('#/areas'));const id=new URLSearchParams(location.hash.split('?')[1]||'').get('neighborhoodId');if(id){const n=rows.find(x=>x.neighborhood_id===id||x.slug===id);if(n){setSelected(n.neighborhood_id);const c=cities.find(x=>x.name_he===n.city);if(c)setSelectedCity(c.city_id);if(id!==n.neighborhood_id)location.hash='#/areas?neighborhoodId='+n.neighborhood_id;}}};
  onHash();addEventListener('hashchange',onHash);return()=>removeEventListener('hashchange',onHash);
 },[rows,cities]);
 useEffect(()=>{
  if(!open||cities.length)return;
  setLoading(true);
  fetch('/api/neighborhood-map?scope=israel').then(r=>{if(!r.ok)throw new Error('Map API '+r.status);return r.json();})
   .then(x=>{
    const nextCities=x.cities||[],nextRows=x.neighborhoods||[];
    setCities(nextCities);setRows(nextRows);
    const requested=new URLSearchParams(location.hash.split('?')[1]||'').get('neighborhoodId');
    const requestedNeighborhood=nextRows.find((n:any)=>n.neighborhood_id===requested||n.slug===requested);
    let remembered:string|null=null;try{remembered=localStorage.getItem('edge:last-neighborhood:v1');}catch{}
    const preferred=requestedNeighborhood||nextRows.find((n:any)=>n.neighborhood_id===remembered);
    const firstCity=nextCities.find((x:any)=>x.name_he===preferred?.city)||nextCities.find((x:any)=>x.name_he==='חיפה')||nextCities.find((x:any)=>x.has_transaction_data)||nextCities[0];
    if(firstCity){
      setSelectedCity(firstCity.city_id);
      const firstNeighborhood=preferred||nextRows.find((n:any)=>n.city===firstCity.name_he&&n.name_he==='קריית שפרינצק')||nextRows.find((n:any)=>n.city===firstCity.name_he);
      setSelected(firstNeighborhood?.neighborhood_id||null);
    }
   })
   .catch(e=>setError(String(e))).finally(()=>setLoading(false));
 },[open,cities.length]);

 useEffect(()=>{if(selected&&open){try{localStorage.setItem('edge:last-neighborhood:v1',selected);}catch{}}},[selected,open]);
 useEffect(()=>{if(!open)return;const controller=new AbortController();fetch('/api/edge-data',{signal:controller.signal}).then(r=>r.ok?r.json():null).then(x=>{if(x)setRadarAreas(x.areas||[])}).catch(()=>{});return()=>controller.abort();},[open]);
 useEffect(()=>{
  if(!selected||!open)return;
  setSummary(null);setSection('overview');setSectionData([]);setAgentAnswer('');
  fetch('/api/neighborhood?neighborhoodId='+encodeURIComponent(selected)+'&section=summary')
   .then(r=>r.json()).then(x=>setSummary(x.data||null)).catch(e=>setError(String(e)));
 },[selected,open]);

 useEffect(()=>{
  if(!selected||!open){setParcelRows([]);return;}
  fetch('/api/neighborhood?neighborhoodId='+encodeURIComponent(selected)+'&section=parcels')
   .then(r=>{if(!r.ok)throw new Error('Parcel API '+r.status);return r.json();})
   .then(x=>setParcelRows(Array.isArray(x.data)?x.data:[]))
   .catch(e=>setError(String(e)));
 },[selected,open]);

 useEffect(()=>{
  if(!selected||section==='overview')return;
  if(section==='identity'){
   fetch('/api/neighborhood-identity?neighborhoodId='+encodeURIComponent(selected))
    .then(r=>r.json()).then(x=>setSectionData(x.data??{})).catch(e=>setError(String(e)));
   return;
  }
  const apiSection=section==='market'?'market-trends':section;
  fetch('/api/neighborhood?neighborhoodId='+encodeURIComponent(selected)+'&section='+apiSection)
   .then(r=>r.json()).then(x=>setSectionData(x.data??[])).catch(e=>setError(String(e)));
 },[selected,section]);

 const mapRows=cities.filter(r=>r.geometry);
 const selectedRow=rows.find(r=>r.neighborhood_id===selected)||null;
 const selectedCityRow=cities.find(r=>r.city_id===selectedCity)||null;
 const cityNeighborhoods=selectedCityRow?rows.filter(r=>r.city===selectedCityRow.name_he):rows;
 const values=cities.map(r=>Number(r[layer])).filter((v,i)=>cities[i]?.has_transaction_data&&Number.isFinite(v));
 const min=values.length?Math.min(...values):0,max=values.length?Math.max(...values):100;
 const current=selectedRow;
 const currentMetric=layers.find(l=>l.key===layer)!;
 const chooseCity=(r:CityMapRow)=>{
  setParcelFocus(false);setSelectedParcel(null);
  setSelectedCity(r.city_id);
  const first=rows.find(n=>n.city===r.name_he);
  setSelected(first?.neighborhood_id||null);
  setSummary(null);setSection('overview');setSectionData([]);
 };

 const openListing=(r:any)=>{
  const detail={id:r.id,address:r.canonical_address||'נכס',neighborhood_id:current?.neighborhood_id||'',neighborhood:current?.name_he||'',city:current?.city||'',asking_price:Number(r.asking_price_nis||0),sqm:r.area_sqm==null?null:Number(r.area_sqm),rooms:r.rooms==null?null:Number(r.rooms),floor:r.floor==null?null:String(r.floor)};
  location.hash='#/property/'+r.id;setOpen(false);window.dispatchEvent(new CustomEvent('edge:open-listing',{detail}));
 };
 const startDeal=async(r:any)=>{
  try{
   const response=await fetch('/api/opportunities',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({mode:'workflow',action:'create_deal',listing_id:r.id})});
   const json=await response.json();if(!response.ok)throw new Error(json.error||'create_deal_failed');
   location.hash='#/deals';setOpen(false);
   window.dispatchEvent(new CustomEvent('edge:open-deals',{detail:{listingId:r.id}}));
  }catch(e){setError(String(e));}
 };

 const askEdge=async()=>{
  if(!current)return;
  setAsking(true);setAgentAnswer('');
  try{
   const question=`Analyze neighborhood ${current.name_he}, ${current.city} (neighborhood_id=${current.neighborhood_id}) using the neighborhood semantic layer. Explain the current investment score, deal heat, strongest evidence, missing evidence, and the most important watch-outs. Distinguish direct neighborhood evidence from municipality-inherited context.`;
   const r=await fetch('/api/ask?mode=edge-agent',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({question,history:[]})});
   const x=await r.json();if(!r.ok)throw new Error(x.error||'Agent request failed');
   setAgentAnswer(x.answer||x.text||JSON.stringify(x));
  }catch(e){setError(String(e));}finally{setAsking(false);}
 };
 const openArea=()=>{location.hash='#/areas';setOpen(true)};
 const close=()=>{location.hash='#/research';setOpen(false)};

 if(!open)return <><div style={{display:'contents'}}>{children}</div><div className="ni-launch-wrap"><button className="ni-launch" onClick={openArea}>Area Intelligence</button></div></>;
 return <><div style={{display:'none'}}>{children}</div><div className="ni-root">
  <header className="ni-header">
   <div><div className="ni-eyebrow">EDGE · ISRAEL AREA INTELLIGENCE</div><h1>Israel Investment Map</h1></div>
   <div className="ni-header-actions">
    <select value={layer} onChange={e=>setLayer(e.target.value as LayerKey)}>{layers.map(x=><option key={x.key} value={x.key}>{x.label}</option>)}</select>
    <select aria-label="בחירת עיר" value={selectedCity||''} onChange={e=>{const city=cities.find(x=>x.city_id===e.target.value);if(city)chooseCity(city);}}><option value="" disabled>בחר עיר</option>{cities.map(c=><option key={c.city_id} value={c.city_id}>{c.name_he}</option>)}</select>
    <select aria-label="אזורי הרדאר" value={radarAreas.some(a=>a.id===selected||a.id===selectedRow?.slug)?selected||'':''} onChange={e=>{location.hash='#/areas?neighborhoodId='+e.target.value;setSection('overview');}}><option value="" disabled>אזורי הרדאר שלך</option>{radarAreas.map(a=><option key={a.id} value={rows.find(n=>n.neighborhood_id===a.id||n.slug===a.id)?.neighborhood_id||a.id}>{a.name} · {a.city}</option>)}</select>
    <a href='#/renewal'>פרויקטי התחדשות</a><button onClick={close}>חזרה למחקר</button>
   </div>
  </header>
  <div className="ni-layout">
   <section className="ni-map-panel">
    <div className="ni-map-topline"><span>{parcelFocus&&selectedRow?selectedRow.name_he+' · parcel geometry':currentMetric.label}</span><span className="ni-muted">{parcelFocus&&selectedRow?((selectedRow.parcel_geometry_count??0)+' mapped parcels'):(`Israel · ${cities.filter(x=>x.has_transaction_data).length} settlements with transaction data · ${cities.length} mapped settlements`)}</span>{parcelFocus&&<button className="ni-map-back" onClick={()=>{setParcelFocus(false);setSelectedParcel(null)}}>Back to Israel</button>}</div>
    {loading?<div className="ni-empty">Loading neighborhood intelligence…</div>:
     mapRows.length?<OpenStreetIntelligenceMap
      mode={parcelFocus&&selectedRow?.geometry?'neighborhood':'israel'}
      cities={mapRows}
      neighborhood={selectedRow}
      parcels={parcelRows}
      layer={layer}
      min={min}
      max={max}
      selectedCity={selectedCity}
      onCity={chooseCity}
      onParcel={setSelectedParcel}
     />:<div className="ni-empty"><strong>Neighborhood polygons are still being resolved.</strong><span>The dashboard remains usable from the neighborhood list; heat polygons appear automatically once geometry is available.</span></div>}
    <div className="ni-legend"><span>Low</span><div className="ni-gradient"/><span>High</span><span className="ni-no-data-box"/> <span>No metric data</span></div>
    <div className="ni-map-note">{parcelFocus&&selectedRow?'OpenStreetMap base with canonical neighborhood and parcel polygons. Click a parcel for cadastral and transaction context.':'All available CBS settlement geography is shown. Gray means geography exists but the current transaction archive has no data for that settlement. Colored areas use executed transaction data only.'}</div>
    {selectedParcel&&<div className="ni-parcel-card"><div><b>גוש {selectedParcel.gush} · חלקה {selectedParcel.helka}</b><span>{selectedParcel.transaction_count||0} linked transactions{selectedParcel.latest_transaction_date?' · latest '+new Date(selectedParcel.latest_transaction_date).toLocaleDateString('he-IL'):''}</span></div><button onClick={()=>setSelectedParcel(null)}>×</button></div>}
    <div className="ni-neighborhood-list">
     {cityNeighborhoods.map(r=><button key={r.neighborhood_id} className={selected===r.neighborhood_id?'active':''} onClick={()=>{location.hash='#/areas?neighborhoodId='+r.neighborhood_id;setSelected(r.neighborhood_id);setParcelFocus(Boolean(r.geometry));setSelectedParcel(null)}}>
      <span><b>{r.name_he}</b><small>{r.city}</small></span>
      <span className="ni-list-score">{r.parcel_geometry_count??r.parcel_count??0} parcels</span>
     </button>)}
    </div>
   </section>
   <section className="ni-detail">
    {!current?<div className="ni-empty"><strong>{selectedCityRow?.name_he||'Choose an area'}</strong><span>{selectedCityRow?.has_transaction_data?('12M transactions: '+selectedCityRow.transaction_count_12m+' · Median ₪/m²: '+money(selectedCityRow.median_price_sqm_12m)):'No transaction data in the current archive.'}</span><span>{cityNeighborhoods.length?'Choose a canonical neighborhood below the map for deeper intelligence.':'Edge has not promoted neighborhood intelligence for this settlement yet.'}</span></div>:<>
     <div className="ni-title-row"><div><div className="ni-eyebrow">{current.city}</div><h2>{current.name_he}</h2></div>
      <div className="ni-title-actions"><button className="ni-listings-cta" onClick={()=>setSection('listings')}>View properties</button><button className="ni-ask" onClick={askEdge} disabled={asking}>{asking?'Analyzing…':'Ask Edge'}</button><div className={'ni-confidence '+(current.confidence_level||'insufficient')}>{current.confidence_level||'insufficient'} confidence</div></div></div>
     <div className="ni-score-grid">
      <div><span>Area Score</span><strong>{current.investment_score==null?'—':Math.round(current.investment_score)}</strong><small>Long-term investment context</small></div>
      <div><span>Deal Heat</span><strong>{current.deal_heat==null?'—':Math.round(current.deal_heat)}</strong><small>{current.deal_count||0} scored active deals</small></div>
      <div><span>Coverage</span><strong>{current.coverage_pct==null?'—':Math.round(current.coverage_pct)+'%'}</strong><small>Score component coverage</small></div>
     </div>
     <nav className="ni-tabs">{['overview','market','listings','rentals','renewal','demographics','infrastructure','supply','city-context','identity','evidence'].map(t=><button key={t} className={section===t?'active':''} onClick={()=>setSection(t)}>{t.replace('-',' ').replace(/\b\w/g,c=>c.toUpperCase())}</button>)}</nav>
     {agentAnswer&&<div className="ni-agent-answer"><b>Edge analysis</b><p>{agentAnswer}</p><button onClick={()=>setAgentAnswer('')}>Close</button></div>}
     {section==='overview'&&<Overview current={current} summary={summary}/>}
     {section==='market'&&<Market data={sectionData}/>}
     {section==='listings'&&<Listings rows={Array.isArray(sectionData)?sectionData:[]} onOpen={openListing} onStartDeal={startDeal}/>} 
     {section==='rentals'&&<Rentals data={sectionData}/>}
     {section==='renewal'&&<Renewal rows={Array.isArray(sectionData)?sectionData:[]}/>}
     {section==='demographics'&&<Demographics data={sectionData}/>}
     {section==='infrastructure'&&<Infrastructure data={sectionData}/>}
     {section==='supply'&&<Supply data={sectionData}/>}
     {section==='city-context'&&<MetricPanel data={Array.isArray(sectionData)?{metrics:sectionData}:sectionData} title="City context inherited to neighborhood" inherited/>}
     {section==='identity'&&<Identity data={sectionData}/>}
     {section==='evidence'&&<Evidence rows={Array.isArray(sectionData)?sectionData:[]} summary={summary}/>}
    </>}
   </section>
  </div>
  {error&&<div className="ni-error">{error}<button onClick={()=>setError(null)}>×</button></div>}
 </div></>;
}

function Overview({current,summary}:{current:NeighborhoodMapRow;summary:Summary|null}){
 const metrics=new Map((summary?.metrics||[]).map((m:any)=>[m.metric_key,m]));
 const cards=[
  ['Executed price / m²',money(current.median_price_sqm_12m),'transactions'],
  ['1Y executed price change',pct(current.price_change_1y),'transactions'],
  ['Gross yield',current.estimated_gross_yield==null?'—':num(current.estimated_gross_yield)+'%','sale + rent listings'],
  ['Renewal expansion',current.renewal_expansion_ratio==null?'—':num(current.renewal_expansion_ratio,2)+'x','renewal projects'],
  ['City wage context',money(current.average_wage),'municipality inheritance'],
  ['Net migration',current.net_internal_migration==null?'—':num(current.net_internal_migration,0),'municipality inheritance'],
  ['Construction starts',current.construction_starts==null?'—':num(current.construction_starts,0),'municipality inheritance'],
  ['12M transactions',String(current.transaction_count_12m||0),'comparable transactions']
 ];
 const positives:string[]=[];const watchouts:string[]=[];
 if(current.price_change_1y!=null&&current.price_change_1y>3)positives.push('Executed prices show positive 1Y momentum.');
 if(current.renewal_expansion_ratio!=null&&current.renewal_expansion_ratio>1)positives.push('Mapped renewal pipeline expands residential supply materially.');
 if(current.deal_heat!=null&&current.deal_heat>=60)positives.push('Current scored listings show above-neutral deal heat.');
 if((current.coverage_pct??0)<60)watchouts.push('Score coverage is below the minimum required for a full investment score.');
 if((current.transaction_count_12m??0)<8)watchouts.push('Recent transaction sample is small; price metrics have limited confidence.');
 if(current.estimated_gross_yield==null)watchouts.push('Rental yield evidence is not yet sufficient.');
 return <div className="ni-section">
  <div className="ni-block ni-summary"><h3>Executive summary</h3><div className="ni-summary-cols"><div><b>Signals</b>{positives.length?positives.map(x=><p key={x}>+ {x}</p>):<p>No strong positive signal is asserted without sufficient evidence.</p>}</div><div><b>Watch-outs</b>{watchouts.length?watchouts.map(x=><p key={x}>– {x}</p>):<p>No major data-quality watch-out detected.</p>}</div></div></div>
  <div className="ni-kpis">{cards.map(([label,value,source])=><div key={label}><span>{label}</span><strong>{value}</strong><small>{source}</small></div>)}</div>
  <div className="ni-block">
   <h3>Why this score</h3>
   <div className="ni-metric-list">{Array.from(metrics.values()).slice(0,12).map((m:any)=><div key={m.metric_key}>
    <span><b>{m.metric_key.replaceAll('_',' ')}</b><small>{(m.source_datasets||[]).join(', ')||'derived'} · n={m.sample_count??'—'}</small></span>
    <span>{m.numeric_value==null?'—':num(m.numeric_value,2)}<em>{Math.round(Number(m.confidence||0)*100)}% conf.</em></span>
   </div>)}</div>
  </div>
  <div className="ni-block"><h3>Dataset coverage</h3><div className="ni-source-chips">{(summary?.datasets||[]).map((d:any)=><span key={d.dataset_slug+d.source_grain}><b>{d.dataset_slug}</b>{d.source_grain} · {d.evidence_count} rows · {Math.round(Number(d.avg_mapping_confidence||0)*100)}%</span>)}</div></div>
 </div>;
}
function Market({data}:{data:any}){
 const history=data?.history||[];const rolling=data?.rolling||{};const cbs=(data?.cbsProfile||[]).slice(-1)[0]||{};
 const points=(field:string)=>{
  const valid=history.filter((r:any)=>Number(r[field])>0);if(valid.length<2)return '';
  const vals=valid.map((r:any)=>Number(r[field]));const lo=Math.min(...vals),hi=Math.max(...vals);
  return vals.map((v:number,i:number)=>`${(i/(vals.length-1))*100},${42-(v-lo)/(hi-lo||1)*34}`).join(' ');
 };
 return <div className="ni-section">
  <div className="ni-kpis">
   <div><span>Executed median ₪/m²</span><strong>{money(rolling.median_executed_price_sqm)}</strong><small>{rolling.executed_transaction_count??0} transactions · rolling 12m</small></div>
   <div><span>Current asking ₪/m²</span><strong>{money(rolling.median_asking_price_sqm)}</strong><small>{rolling.active_sale_listing_count??0} active listings</small></div>
   <div><span>Ask vs executed</span><strong>{pct(rolling.asking_to_executed_premium_pct)}</strong><small>median asking / executed</small></div>
   <div><span>Transaction confidence</span><strong>{rolling.transaction_confidence==null?'—':Math.round(Number(rolling.transaction_confidence)*100)+'%'}</strong><small>sample-based confidence</small></div>
   <div><span>3M transaction velocity</span><strong>{rolling.transaction_count_3m??0}</strong><small>executed deals in last 3 months</small></div>
   <div><span>Months of inventory</span><strong>{rolling.months_of_sale_inventory==null?'—':num(rolling.months_of_sale_inventory,1)}</strong><small>active listings / monthly 12M transaction pace</small></div>
  </div>
  <div className="ni-block"><h3>Market trend</h3>
   <div className="ni-chart-legend"><span>Executed ₪/m²</span><span>Current/historical asking ₪/m²</span></div>
   <svg className="ni-trend-chart" viewBox="0 0 100 48" preserveAspectRatio="none">
    {points('median_executed_price_sqm')&&<polyline points={points('median_executed_price_sqm')} fill="none" stroke="currentColor" strokeWidth="1.8"/>}
    {points('median_asking_price_sqm')&&<polyline points={points('median_asking_price_sqm')} fill="none" stroke="gray" strokeWidth="1.3" strokeDasharray="3 2"/>}
   </svg>
  </div>
  <div className="ni-table-wrap"><table><thead><tr><th>Month</th><th>Tx</th><th>Executed ₪/m²</th><th>Sale listings</th><th>Asking ₪/m²</th><th>Ask premium</th></tr></thead><tbody>{history.slice().reverse().slice(0,36).map((r:any)=><tr key={r.period_start}><td>{String(r.period_start).slice(0,7)}</td><td>{r.executed_transaction_count}</td><td>{money(r.median_executed_price_sqm)}</td><td>{r.active_sale_listing_count}</td><td>{money(r.median_asking_price_sqm)}</td><td>{pct(r.asking_to_executed_premium_pct)}</td></tr>)}</tbody></table></div>
  <div className="ni-block"><div className="ni-block-title-row"><h3>CBS profile</h3>{cbs.observation_year&&<span className={'ni-data-badge '+(cbs.profile_quality||'provisional')}>{cbs.profile_quality||'provisional'} · {cbs.safe_for_score?'score-safe':'context-only'}</span>}</div>{cbs.observation_year?<div className="ni-kpis">
   <div><span>Population</span><strong>{cbs.population==null?'—':Math.round(cbs.population).toLocaleString()}</strong><small>CBS {cbs.observation_year}</small></div>
   <div><span>Population growth</span><strong>{pct(cbs.population_growth_from_2022_pct)}</strong><small>2022 → 2024</small></div>
   <div><span>Employment</span><strong>{cbs.employment_pct==null?'—':num(cbs.employment_pct)+'%'}</strong><small>CBS safe-area rollup</small></div>
   <div><span>Academic certificate</span><strong>{cbs.academic_certificate_pct==null?'—':num(cbs.academic_certificate_pct)+'%'}</strong><small>CBS 2022 demographic reference</small></div>
  </div>:<div className="ni-empty ni-small-empty">CBS neighborhood profile will appear when a safe statistical-area crosswalk is available.</div>}</div>
 </div>;
}
function Listings({rows,onOpen,onStartDeal}:{rows:any[];onOpen:(r:any)=>void;onStartDeal:(r:any)=>void}){
 const active=rows.filter(r=>r.status==='active');
 return <div className="ni-section">
  <div className="ni-listing-flow"><div><b>From area to deal</b><span>Review the neighborhood → open a real listing → validate comps and market context → create a Deal and manage it in My Deals.</span></div><strong>{active.length} active properties</strong></div>
  <div className="ni-callout"><b>Relative-value model:</b> each listing is compared separately to executed 12-month neighborhood history, matched room/size comps when sample permits, and the current asking market. Negative percentages mean the listing asks below that benchmark.</div>
  {!rows.length?<div className="ni-empty ni-small-empty">No listings are currently mapped to this neighborhood.</div>:
  <div className="ni-listing-cards">{rows.map(r=><article key={r.id} className={'ni-listing-card '+(r.status==='active'?'':'inactive')}>
   <div className="ni-listing-card-head"><div><b>{r.canonical_address||'Unresolved address'}</b><span>{r.status||'unknown'} · {r.rooms??'—'} rooms · {r.area_sqm??'—'} m²</span></div><span className={'ni-value-signal '+(r.relative_value_signal||'insufficient')}>{r.relative_value_signal||'insufficient'}</span></div>
   <div className="ni-listing-metrics"><span><small>Asking</small><b>{money(r.asking_price_nis)}</b></span><span><small>₪/m²</small><b>{money(r.asking_price_sqm)}</b></span><span><small>Vs executed</small><b>{pct(r.executed_discount_pct)}</b></span><span><small>DOM</small><b>{r.days_on_market??'—'}</b></span></div>
   <div className="ni-listing-actions"><button onClick={()=>onOpen(r)}>Open property</button><button className="primary" disabled={r.status!=='active'} onClick={()=>onStartDeal(r)}>Start Deal</button></div>
  </article>)}</div>}
  <div className="ni-table-wrap ni-desktop-listings"><table><thead><tr><th>Signal</th><th>Score</th><th>Address</th><th>Asking</th><th>₪/m²</th><th>Vs executed</th><th>Vs matched</th><th>Vs current ask</th><th>DOM</th><th>Price cut</th><th>Confidence</th><th>Action</th></tr></thead><tbody>{rows.map(r=><tr key={r.id}>
   <td><b>{r.relative_value_signal||'—'}</b></td><td><b>{r.score==null?'—':Math.round(r.score)}</b></td><td>{r.canonical_address||'Unresolved'}</td><td>{money(r.asking_price_nis)}</td><td>{money(r.asking_price_sqm)}</td>
   <td>{pct(r.executed_discount_pct)}</td><td>{pct(r.matched_executed_discount_pct)}</td><td>{pct(r.current_asking_discount_pct)}</td>
   <td>{r.days_on_market??'—'}</td><td>{pct(r.price_change_since_first_pct)}</td>
   <td>{r.benchmark_confidence==null?'—':Math.round(Number(r.benchmark_confidence)*100)+'%'}</td>
   <td><div className="ni-inline-actions"><button onClick={()=>onOpen(r)}>Open</button><button onClick={()=>onStartDeal(r)} disabled={r.status!=='active'}>Deal</button></div></td>
  </tr>)}</tbody></table></div></div>;
}
function Renewal({rows}:{rows:any[]}){
 return <div className="ni-section"><div className="ni-table-wrap"><table><thead><tr><th>Project</th><th>Stage</th><th>Status</th><th>Existing</th><th>Planned</th><th>Certainty</th></tr></thead><tbody>{rows.map(r=><tr key={r.id}><td><a href={'#/renewal/'+r.id}>{r.project_name||r.plan_number||'Project'}</a><small>{r.developer||''}</small></td><td>{r.stage||'—'}</td><td>{r.status||'—'}</td><td>{r.existing_units??'—'}</td><td>{r.planned_units??'—'}</td><td>{r.planning_certainty==null?'—':Math.round(Number(r.planning_certainty)*100)+'%'}</td></tr>)}</tbody></table></div></div>;
}


function Demographics({data}:{data:any}){
 const profiles=data?.profiles||[];const latest=profiles.slice(-1)[0]||{};const metrics=data?.metrics||[];
 return <div className="ni-section">
  {data?.note&&<div className="ni-callout">{data.note}</div>}
  {latest.observation_year?<><div className="ni-block"><div className="ni-block-title-row"><h3>CBS neighborhood profile</h3><span className={'ni-data-badge '+(latest.profile_quality||'provisional')}>{latest.profile_quality||'provisional'} · {latest.safe_for_score?'score-safe':'context-only'}</span></div>
   <div className="ni-kpis">
    <div><span>Population</span><strong>{latest.population==null?'—':Math.round(latest.population).toLocaleString()}</strong><small>CBS {latest.observation_year}</small></div>
    <div><span>2022→2024 population</span><strong>{pct(latest.population_growth_from_2022_pct)}</strong><small>{latest.statistical_area_count??0} statistical areas</small></div>
    <div><span>Employment</span><strong>{latest.employment_pct==null?'—':num(latest.employment_pct)+'%'}</strong><small>demographic reference 2022</small></div>
    <div><span>Academic certificate</span><strong>{latest.academic_certificate_pct==null?'—':num(latest.academic_certificate_pct)+'%'}</strong><small>demographic reference 2022</small></div>
    <div><span>Median annual employee wage</span><strong>{money(latest.median_annual_employee_wage)}</strong><small>CBS census wage metric</small></div>
    <div><span>Owner households</span><strong>{latest.owner_households_pct==null?'—':num(latest.owner_households_pct)+'%'}</strong><small>CBS Census 2022</small></div>
    <div><span>Renter households</span><strong>{latest.renter_households_pct==null?'—':num(latest.renter_households_pct)+'%'}</strong><small>CBS Census 2022</small></div>
    <div><span>Mapping confidence</span><strong>{latest.mapping_confidence==null?'—':Math.round(Number(latest.mapping_confidence)*100)+'%'}</strong><small>{latest.crosswalk_method||'crosswalk'}</small></div>
   </div>
  </div></>:<div className="ni-empty ni-small-empty">No CBS neighborhood profile is available yet.</div>}
  <MetricPanel data={{metrics}} title="Additional demographic & economic context"/>
 </div>;
}

function MetricPanel({data,title,inherited=false}:{data:any;title:string;inherited?:boolean}){
 const metrics=Array.isArray(data)?data:(data?.metrics||[]);
 return <div className="ni-section">
  {inherited&&<div className="ni-callout"><b>Context only:</b> these values originate at municipality grain and are inherited to the neighborhood with reduced confidence.</div>}
  {data?.note&&<div className="ni-callout">{data.note}</div>}
  <div className="ni-block"><h3>{title}</h3>{metrics.length?<div className="ni-metric-list">{metrics.map((m:any)=><div key={m.metric_key}>
   <span><b>{m.label||m.metric_key.replaceAll('_',' ')}</b><small>{m.preferred_dataset||m.source_datasets?.join(', ')||'derived'} · {m.as_of_date||''}</small></span>
   <span>{m.numeric_value==null?(m.text_value||'—'):num(m.numeric_value,2)}<em>{Math.round(Number(m.confidence||0)*100)}% conf.</em></span>
  </div>)}</div>:<div className="ni-empty ni-small-empty">No verified neighborhood-level metrics are available yet.</div>}</div>
 </div>;
}
function Rentals({data}:{data:any}){
 const rows=data?.inventory||[];const metrics=data?.metrics||[];
 return <div className="ni-section"><MetricPanel data={{metrics}} title="Rental economics"/>
  <div className="ni-table-wrap"><table><thead><tr><th>Address</th><th>Rent</th><th>Rent/m²</th><th>Rooms</th><th>m²</th><th>Status</th></tr></thead><tbody>{rows.map((r:any)=><tr key={r.id}><td>{r.canonical_address||'Unresolved'}</td><td>{money(r.asking_rent_nis)}</td><td>{money(r.rent_per_sqm)}</td><td>{num(r.rooms,1)}</td><td>{num(r.area_sqm,0)}</td><td>{r.status}</td></tr>)}</tbody></table></div>
 </div>;
}
function Infrastructure({data}:{data:any}){
 return <div className="ni-section">{!data?.available&&<div className="ni-callout"><b>Not enough verified neighborhood geography yet.</b> Infrastructure is not inherited from city-level proximity. This section will populate only after a verified neighborhood crosswalk/geometry exists.</div>}<MetricPanel data={data} title="Infrastructure access"/></div>;
}
function Supply({data}:{data:any}){
 const r=data?.renewal?.[0]||{};
 return <div className="ni-section"><div className="ni-kpis">
  <div><span>Renewal projects</span><strong>{r.projects??0}</strong><small>direct neighborhood mapping</small></div>
  <div><span>Existing units</span><strong>{r.existing_units??0}</strong><small>renewal pipeline</small></div>
  <div><span>Planned units</span><strong>{r.planned_units??0}</strong><small>not delivered units</small></div>
  <div><span>Additional units</span><strong>{r.additional_units??0}</strong><small>planned increment</small></div>
 </div><MetricPanel data={data} title="Supply context"/></div>;
}

function Evidence({rows,summary}:{rows:any[];summary:Summary|null}){
 return <div className="ni-section"><div className="ni-callout"><b>Semantic rule:</b> every row below is linked to this neighborhood with an explicit source grain and mapping method. Municipality inheritance is context, not a neighborhood-level measurement.</div>
 <div className="ni-table-wrap"><table><thead><tr><th>Dataset</th><th>Source grain</th><th>Observation</th><th>Mapping</th><th>Confidence</th></tr></thead><tbody>{rows.slice(0,250).map((r,i)=><tr key={r.dataset_slug+r.source_record_id+i}><td><b>{r.dataset_slug}</b></td><td>{r.source_grain}</td><td>{r.observation_date||r.observation_year||'—'}</td><td>{r.mapping_method}</td><td>{Math.round(Number(r.mapping_confidence||0)*100)}%</td></tr>)}</tbody></table></div>
 <div className="ni-source-chips">{(summary?.datasets||[]).map((d:any)=><span key={d.dataset_slug+d.source_grain}><b>{d.dataset_slug}</b>{d.source_grain} · {d.evidence_count} evidence rows</span>)}</div></div>;
}

function Identity({data}:{data:any}){
 const c=data?.canonical||{};const aliases=data?.aliases||[];const mappings=data?.mappings||[];const stats=data?.statAreas||[];const parcels=data?.parcels||[];const geometries=data?.geometries||[];
 return <div className="ni-section">
  <div className="ni-callout"><b>Canonical neighborhood:</b> this is the source of truth used by agents, scores and dashboards. Source labels and boundaries below are evidence mapped into this neighborhood_id.</div>
  <div className="ni-kpis">
   <div><span>Aliases</span><strong>{c.alias_count??aliases.length}</strong><small>resolved source labels</small></div>
   <div><span>Source mappings</span><strong>{c.source_mapping_count??mappings.length}</strong><small>transactions, listings, CBS, renewal</small></div>
   <div><span>CBS areas</span><strong>{c.statistical_area_count??stats.length}</strong><small>supporting statistical geography</small></div>
   <div><span>Mapped parcels</span><strong>{c.parcel_count??parcels.length}</strong><small>cadastral evidence</small></div>
  </div>
  <div className="ni-block"><h3>Canonical boundary</h3><div className="ni-metric-list">
   <div><span><b>Boundary version</b><small>{c.geometry_source||'No active source'}</small></span><span>{c.boundary_version||'—'}</span></div>
   <div><span><b>Method</b><small>how the active polygon was formed</small></span><span>{c.geometry_method||'—'}</span></div>
   <div><span><b>Geometry confidence</b><small>identity confidence, not investment confidence</small></span><span>{c.geometry_confidence==null?'—':Math.round(Number(c.geometry_confidence)*100)+'%'}</span></div>
  </div></div>
  <div className="ni-block"><h3>Aliases</h3><div className="ni-source-chips">{aliases.length?aliases.map((a:any,i:number)=><span key={i}><b>{a.alias}</b>{a.source_id||'edge'} · {Math.round(Number(a.confidence||0)*100)}%</span>):<span>No source aliases yet.</span>}</div></div>
  <div className="ni-table-wrap"><table><thead><tr><th>Source</th><th>Entity</th><th>Name / ID</th><th>Method</th><th>Confidence</th></tr></thead><tbody>{mappings.slice(0,250).map((m:any,i:number)=><tr key={i}><td>{m.source_id}</td><td>{m.source_entity_type}</td><td>{m.source_name||m.source_entity_id}</td><td>{m.mapping_method}</td><td>{Math.round(Number(m.mapping_confidence||0)*100)}%</td></tr>)}</tbody></table></div>
  <div className="ni-block"><h3>Boundary history</h3><div className="ni-source-chips">{geometries.length?geometries.map((g:any,i:number)=><span key={i}><b>{g.geometry_version}</b>{g.geometry_method} · {Math.round(Number(g.confidence||0)*100)}% {g.is_active?'· ACTIVE':''}</span>):<span>No promoted polygon yet.</span>}</div></div>
  <div className="ni-block"><h3>Supporting geography</h3><div className="ni-source-chips">{stats.map((a:any)=><span key={a.stat_area_id}><b>CBS {a.stat_area_code}</b>{a.mapping_method} · {Math.round(Number(a.mapping_confidence||0)*100)}%</span>)}</div></div>
 </div>;
}
