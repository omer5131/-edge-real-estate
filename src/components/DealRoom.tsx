import {useEffect,useMemo,useState} from 'react';
import {AlertTriangle,ArrowLeft,Bookmark,ExternalLink,Eye,MessageSquare,RefreshCw,ShieldCheck} from 'lucide-react';
import DealWorkflow from './DealWorkflow';
import {benchmarkGap} from './evidence-format';

type Opportunity={id:string;address:string;neighborhood_id:string;neighborhood:string;city:string;asking_price:number;sqm:number|null;rooms:number|null;floor:string|null};
type AskContext={entity_type?:string;listing_id?:string;property_id?:string|null;building_id?:string|null;neighborhood_id?:string|null;active_tab?:string;label?:string};

const money=(n:any)=>n==null||Number.isNaN(Number(n))?'—':Number(n)>=1000000?'₪'+(Number(n)/1000000).toFixed(2)+'M':'₪'+Math.round(Number(n)).toLocaleString('he-IL');
const pct=(n:any)=>n==null?'—':(Number(n)>0?'+':'')+Number(n).toFixed(1)+'%';
const date=(s:any)=>s?new Date(s).toLocaleDateString('he-IL'):'—';
const statusLabel=(s:string)=>({supported:'מבוסס',provisional:'זמני',insufficient_evidence:'אין מספיק ראיות',unavailable:'לא זמין'} as Record<string,string>)[s]||s;

function Evidence({e}:{e:any}){return e?<span className={'deal-evidence '+(e.status||'')}><ShieldCheck size={13}/>{statusLabel(e.status||'unavailable')}{e.sampleSize!=null?' · n='+e.sampleSize:''}</span>:null}
function Metric({label,value,sub}:{label:string;value:any;sub?:any}){return <div className="deal-metric"><span>{label}</span><strong>{value}</strong>{sub&&<small>{sub}</small>}</div>}
function Empty({title,body}:{title:string;body:string}){return <div className="deal-empty"><AlertTriangle size={18}/><div><strong>{title}</strong><span>{body}</span></div></div>}

export default function DealRoom({item,onBack,onAsk}:{item:Opportunity;onBack:()=>void;onAsk:(c:AskContext)=>void}){
 const [data,setData]=useState<any>(null),[loading,setLoading]=useState(true),[busy,setBusy]=useState(false);
 type Tab='overview'|'market'|'comps'|'area'|'deal'|'notes'|'dd'|'timeline';
 const readTab=()=>{const x=new URLSearchParams(location.hash.split('?')[1]||'').get('section');return ['market','comps','area','deal','notes','dd','timeline'].includes(x||'')?x as Tab:'overview'};
 const [tab,setTabState]=useState<Tab>(readTab),[loadError,setLoadError]=useState('');
 const setTab=(next:Tab)=>{setTabState(next);const p=new URLSearchParams(location.hash.split('?')[1]||'');p.set('section',next);location.hash='#/property/'+item.id+'?'+p};
 useEffect(()=>{const change=()=>setTabState(readTab());window.addEventListener('hashchange',change);return()=>window.removeEventListener('hashchange',change)},[item.id]);
 const load=async()=>{setLoading(true);setLoadError('');try{const r=await fetch('/api/property?id='+encodeURIComponent(item.id),{cache:'no-store'});const j=await r.json();if(!r.ok||!j.listing?.id)throw Error('לא ניתן לטעון את הנכס');setData(j)}catch(e:any){setLoadError(e.message);setData(null)}finally{setLoading(false)}};
 useEffect(()=>{void load()},[item.id]);
 const c=data?.context,l=c?.listing||{},a=c?.asset||{},v=c?.valuation,m=c?.activeMarket,h=c?.historicalMarket,n=c?.neighborhood,p=c?.planning,legacy=data?.listing||{};
 const ask=l.askingPriceNis??legacy.asking_price_ils??item.asking_price;
 const base=v?.valuation?.baseNis,low=v?.valuation?.lowNis,high=v?.valuation?.highNis,discount=v?.valuation?.discountToBasePct;
 const agentContext=useMemo(()=>({entity_type:'listing',listing_id:item.id,property_id:a.propertyId??null,building_id:a.buildingId??null,neighborhood_id:a.neighborhoodId??null,active_tab:tab,label:(a.canonicalAddress||legacy.address||item.address)+' · '+tab}),[item.id,a.propertyId,a.buildingId,a.neighborhoodId,a.canonicalAddress,legacy.address,item.address,tab]);

 if(loading)return <div className="screen"><div className="loading"><RefreshCw className="spin"/>טוען Deal Room…</div></div>;
 if(!data||data.error)return <div className="screen"><button className="back" onClick={onBack}><ArrowLeft/>חזרה</button><Empty title="לא ניתן לטעון את הנכס" body={loadError||data?.error||'שגיאת API'}/><button onClick={()=>void load()}>נסה שוב</button></div>;

 const follow=async()=>{setBusy(true);setLoadError('');try{const r=await fetch('/api/opportunities',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({action:legacy.subscription_id?'unsubscribe':'subscribe',entity_id:item.id,entity_type:'listing'})});if(!r.ok)throw Error('המעקב לא נשמר');await load()}catch(e:any){setLoadError(e.message)}finally{setBusy(false)}};
 const thesis:string[]=[];
 if(discount!=null)thesis.push('מחיר מבוקש מול שווי בסיס מעסקאות: '+benchmarkGap(discount,true));
 if(m?.summary?.subjectDeltaToMedianPct!=null)thesis.push('מחיר מבוקש מול חציון מלאי פעיל: '+benchmarkGap(m.summary.subjectDeltaToMedianPct,false));
 if(p?.renewalProjects?.length)thesis.push(String(p.renewalProjects.length)+' פרויקטי התחדשות מקושרים לשכונה');
 const risks=(c?.evidence?.notes||[]).slice(0,5);
 const source=l.sourceUrl||legacy.url,sourceKind=l.sourceUrlKind||legacy.source_url_kind||'unknown';
 const gaps=[...(!a.buildingId?['אמת כתובת מלאה וזהות בניין']:[]),...(sourceKind!=='item'?['אתר מודעה מדויקת ואמת זמינות ואיש קשר']:[]),...(!v?.comparables?.some((x:any)=>x.selected&&['same_building','same_street','nearby'].includes(x.relation))?['בדוק התאמת עסקאות לבניין ולדירה ולא רק לשכונה']:[])];

 return <div className="screen deal-room">
  <button className="back" onClick={onBack}><ArrowLeft size={15}/>חזרה למסך הקודם</button>
  <div className="deal-hero">
   <div><span className="eyebrow">Deal Room · {data.tier==='full'?'Full research':'Basic'}</span><h1>{a.canonicalAddress||legacy.address||item.address}</h1><p>{a.neighborhoodName||legacy.neighborhood||item.neighborhood}, {a.cityName||legacy.city||item.city}</p><div className="deal-facts"><a href={'#/renewal'}>פרויקטי התחדשות</a><span>{l.areaSqm??legacy.area_sqm??item.sqm??'—'} מ״ר</span><span>{l.rooms??legacy.rooms??item.rooms??'—'} חדרים</span><span>קומה {l.floor??legacy.floor??item.floor??'—'}</span></div></div>
   <div className="deal-actions"><button className="ask-deal" onClick={()=>setTab('deal')}>פתח תיק עסקה</button><button className={'follow '+(legacy.subscription_id?'on':'')} onClick={follow} disabled={busy}>{legacy.subscription_id?<><Bookmark size={14}/>במעקב</>:<><Eye size={14}/>שמור ומעקב</>}</button>{source&&<a className="source-link" href={source} target="_blank" rel="noreferrer">{sourceKind==='item'?'מודעה מקורית':'עמוד מקור / חיפוש'} <ExternalLink size={13}/></a>}<button className="ask-deal" onClick={()=>onAsk(agentContext)}><MessageSquare size={14}/>Ask Edge על הנכס</button></div>
  </div>
  {data.tier!=='full'&&<div className="upgrade-banner"><Bookmark size={18}/><div><strong>Basic profile</strong><span>שמור את הנכס כדי לפתוח valuation, active market, area ו-planning מלאים.</span></div></div>}
  <p className="deal-muted">מעקב שומר את הנכס למחקר ולעדכונים. תיק עסקה מנהל תרחישים, בדיקות, הצעות ושלבי רכישה — אלה פעולות נפרדות.</p>
  {loadError&&<p role="alert">{loadError}</p>}
  <section className="panel deal-identity-warning"><h3>זהות והתאמת הראיות</h3><p>{a.buildingId?'קיים מזהה בניין קנוני; יש לבדוק תחולת זכויות בנפרד.':'זהות הבניין לא הושלמה. מדגם עסקאות אינו מאמת את כתובת הדירה או את זכויותיה.'}</p><p>{sourceKind==='item'?'קישור מודעה מדויק זמין — הזמינות טרם אומתה בשיחה.':'אין קישור מודעה מדויק מאומת. עמוד חיפוש אינו מזהה דירה.'}</p>{gaps.length>0&&<ul>{gaps.map(x=><li key={x}>{x}</li>)}</ul>}<button onClick={()=>setTab('dd')}>תעד בדיקה או פתח משימה</button></section>
  <div className="deal-kpis"><Metric label="מחיר מבוקש" value={money(ask)} sub={l.askingPricePerSqm?money(l.askingPricePerSqm)+' / מ״ר':undefined}/><Metric label="שווי לפי עסקאות סגורות" value={money(base)} sub={(low||high)?money(low)+' – '+money(high):'אין טווח מבוסס'}/><Metric label="מבוקש מול שווי בסיס" value={benchmarkGap(discount,true)} sub="עסקאות נבחרות מעד 5 שנות היסטוריה; לא חציון שכונתי"/><Metric label="מלאי דומה" value={m?.summary?.inventoryCount??'—'} sub={m?.summary?.medianAskingPriceNis?'חציון '+money(m.summary.medianAskingPriceNis):'אין מדגם'}/></div>
  <div className="deal-panel-head"><span>איכות מדגם לשווי — לא אימות זהות</span><Evidence e={v?.evidence}/><span>ראיות למלאי פעיל</span><Evidence e={m?.evidence}/></div>
  <div className="deal-tabs">{([['overview','Overview'],['market','Market'],['comps','Comps'],['area','Area'],['deal','Deal'],['notes','Notes'],['dd','Due Diligence'],['timeline','Timeline']] as const).map(([id,label])=><button key={id} className={tab===id?'active':''} onClick={()=>setTab(id)}>{label}</button>)}</div>

  {tab==='overview'&&<div className="deal-grid">
   <section className="panel deal-span-2"><div className="deal-panel-head"><h3>Investment snapshot</h3><Evidence e={c?.evidence}/></div><div className="deal-summary-grid"><Metric label="Ask" value={money(ask)}/><Metric label="Closed comps base" value={money(base)}/><Metric label="Active market median" value={money(m?.summary?.medianAskingPriceNis)}/><Metric label="Neighborhood" value={n?.name||legacy.neighborhood||'—'}/></div></section>
   <section className="panel"><h3>למה זה מעניין?</h3>{thesis.length?<ul className="deal-list">{thesis.map((x,i)=><li key={i}>{x}</li>)}</ul>:<Empty title="אין thesis מבוסס" body="אין מספיק ראיות כרגע להצדקת הזדמנות."/>}</section>
   <section className="panel"><h3>סיכונים ואי-ודאות</h3>{risks.length?<ul className="deal-risk-list">{risks.map((x:string,i:number)=><li key={i}>{x}</li>)}</ul>:<p className="deal-muted">אין הערות איכות נוספות מעבר ל-confidence.</p>}</section>
   <section className="panel deal-span-2"><h3>Seller signal</h3><div className="deal-summary-grid"><Metric label="ימים בשוק" value={data.seller?.days_on_market??'—'} sub={data.seller?.lifecycle_evidence==='supported'?'נצפה לאורך זמן':'עדיין אין היסטוריית תצפיות מספקת'}/><Metric label="הורדות מחיר" value={data.seller?.price_reductions??'—'} sub={data.seller?.lifecycle_evidence==='supported'?undefined:'לא מאומת עדיין'}/><Metric label="מחיר מקורי" value={money(data.seller?.original_asking_price)}/><Metric label="עדכון אחרון" value={date(l.lastSeenAt)}/></div></section>
  </div>}

  {tab==='market'&&<div className="deal-grid">
   <section className="panel deal-span-2"><div className="deal-panel-head"><h3>Active alternatives</h3><Evidence e={m?.evidence}/></div>{!m?.listings?.length?<Empty title="אין מלאי פעיל דומה" body="Edge לא משלים מלאי חסר בהערכות."/>:<div className="table-wrap"><table><thead><tr><th>נכס</th><th>מבוקש</th><th>₪/מ״ר</th><th>שטח</th><th>חדרים</th><th>DOM</th><th>Similarity</th></tr></thead><tbody>{m.listings.map((x:any)=><tr key={x.listingId}><td>{x.address||'כתובת חסרה — דורש בירור'}</td><td>{money(x.currentAskingPriceNis)}</td><td>{money(x.askingPricePerSqm)}</td><td>{x.areaSqm??'—'}</td><td>{x.rooms??'—'}</td><td>{x.daysOnMarket??'—'}</td><td>{Math.round((x.similarityScore||0)*100)}%</td></tr>)}</tbody></table></div>}</section>
   <section className="panel"><h3>Market position</h3><div className="deal-summary-grid one"><Metric label="Inventory" value={m?.summary?.inventoryCount??'—'}/><Metric label="Median ask" value={money(m?.summary?.medianAskingPriceNis)}/><Metric label="Median ask/m²" value={money(m?.summary?.medianAskingPricePerSqm)}/><Metric label="Subject percentile" value={m?.summary?.subjectAskingPercentile==null?'—':Number(m.summary.subjectAskingPercentile).toFixed(0)+'%'}/></div></section>
   <section className="panel"><h3>Evidence rule</h3><p className="deal-muted">מחירי מודעות הם benchmark תחרותי בלבד ואינם משמשים כשווי עסקה סגורה. DOM מוצג רק אחרי שתי תצפיות לפחות לאורך יום ומעלה.</p>{m?.rejectedListings?.length>0&&<p className="deal-muted">{m.rejectedListings.length} מודעות נוספות נפסלו בגלל פערי שטח/חדרים או similarity נמוך.</p>}</section>
   <section className="panel deal-span-2"><div className="deal-panel-head"><h3>Closed-sale neighborhood trend</h3><Evidence e={h?.evidence}/></div>
    <div className="deal-summary-grid"><Metric label="Latest median ₪/m²" value={money(h?.summary?.latestMedianExecutedPriceSqm)}/><Metric label="12m change" value={pct(h?.summary?.changeVs12MonthsAgoPct)}/><Metric label="Transactions in latest month" value={h?.summary?.latestTransactionCount??'—'}/><Metric label="Asking premium vs executed" value={pct(h?.summary?.latestAskingPremiumPct)}/></div>
    {h?.trend?.length>0&&<div className="table-wrap"><table><thead><tr><th>Month</th><th>Closed deals</th><th>Median ₪/m²</th><th>P25–P75 ₪/m²</th><th>Active listings</th><th>Ask premium</th></tr></thead><tbody>{h.trend.slice(-12).reverse().map((x:any)=><tr key={x.periodStart}><td>{date(x.periodStart)}</td><td>{x.executedTransactionCount}</td><td>{money(x.medianExecutedPriceSqm)}</td><td>{money(x.p25ExecutedPriceSqm)} – {money(x.p75ExecutedPriceSqm)}</td><td>{x.activeSaleListingCount}</td><td>{pct(x.askingToExecutedPremiumPct)}</td></tr>)}</tbody></table></div>}
   </section>
  </div>}

  {tab==='comps'&&<div className="deal-grid">
   <section className="panel deal-span-2"><div className="deal-panel-head"><h3>Closed comparable sales</h3><Evidence e={v?.evidence}/></div>{!v?.comparables?.length?<Empty title="אין comps מתאימים" body="השווי נשאר חסר או זמני עד שיהיו עסקאות סגורות מתאימות."/>:<div className="table-wrap"><table><thead><tr><th>כתובת</th><th>תאריך</th><th>מחיר</th><th>שטח</th><th>חדרים</th><th>₪/מ״ר</th><th>Similarity</th><th>Relation</th></tr></thead><tbody>{v.comparables.filter((x:any)=>x.selected).map((x:any)=><tr key={x.transactionId}><td>{x.address||'—'}</td><td>{date(x.dealDate)}</td><td>{money(x.salePriceNis)}</td><td>{x.areaSqm??'—'}</td><td>{x.rooms??'—'}</td><td>{money(x.pricePerSqm)}</td><td>{Math.round((x.similarityScore||0)*100)}%</td><td>{({same_building:'אותו בניין',same_street:'אותו רחוב',nearby:'קרוב',same_neighborhood:'אותה שכונה בלבד',fallback:'הרחבת חיפוש'} as Record<string,string>)[x.relation]||x.relation}</td></tr>)}</tbody></table></div>}</section>
   <section className="panel"><h3>Valuation range</h3><div className="deal-summary-grid one"><Metric label="Low" value={money(low)}/><Metric label="Base" value={money(base)}/><Metric label="High" value={money(high)}/><Metric label="Base ₪/m²" value={money(v?.valuation?.pricePerSqm)}/></div></section>
   <section className="panel"><h3>מגבלות התאמה ומקורות</h3><ul className="deal-risk-list">{(v?.evidence?.notes||['אין הערות מודל נוספות']).map((x:string,i:number)=><li key={i}>{x}</li>)}</ul></section>
   <section className="panel deal-span-2"><div className="deal-panel-head"><h3>Historical similar sales</h3><Evidence e={h?.evidence}/></div>
    {!h?.similarSales?.length?<Empty title="אין עסקאות עבר דומות מספיק" body="Edge לא יציג עסקאות שכונתיות רחבות כאילו הן comps לנכס."/>:<div className="table-wrap"><table><thead><tr><th>כתובת</th><th>תאריך</th><th>מחיר</th><th>₪/מ״ר</th><th>שטח</th><th>חדרים</th><th>קומה</th><th>Relation</th><th>Similarity</th></tr></thead><tbody>{h.similarSales.map((x:any)=><tr key={x.transactionId}><td>{x.address||'—'}</td><td>{date(x.dealDate)}</td><td>{money(x.salePriceNis)}</td><td>{money(x.pricePerSqm)}</td><td>{x.areaSqm??'—'}</td><td>{x.rooms??'—'}</td><td>{x.floor??'—'}</td><td>{x.relation}</td><td>{Math.round((x.similarityScore||0)*100)}%</td></tr>)}</tbody></table></div>}
   </section>
  </div>}

  {(['deal','notes','dd','timeline'] as string[]).includes(tab)&&<DealWorkflow key={item.id+':'+(new URLSearchParams(location.hash.split('?')[1]||'').get('deal_id')||'')} listingId={item.id} dealId={new URLSearchParams(location.hash.split('?')[1]||'').get('deal_id')} section={tab as 'deal'|'notes'|'dd'|'timeline'} askingPrice={ask} gaps={gaps}/>}

  {tab==='area'&&<div className="deal-grid">
   <section className="panel deal-span-2"><div className="deal-panel-head"><h3>{n?.name||legacy.neighborhood||item.neighborhood}</h3><Evidence e={n?.mapping?.evidence}/></div>{!n?<Empty title="אין Neighborhood Intelligence" body="הנכס עדיין לא ממופה לשכונה קנונית."/>:<div className="area-section-grid">{[['Market',n.market],['Population',n.population],['Socioeconomic',n.socioeconomic],['Education',n.education],['Housing',n.housing]].map(([label,metrics]:any)=><div className="area-metric-group" key={label}><h4>{label}</h4>{(metrics||[]).slice(0,6).map((x:any)=><div className="area-metric-line" key={x.key}><span>{x.label}</span><strong>{x.value==null?'—':typeof x.value==='number'?Number(x.value).toLocaleString('he-IL'):x.value}</strong><small>{x.period||x.unit||''}</small></div>)}</div>)}</div>}</section>
   <section className="panel"><h3>התחדשות בסביבה — תחולת הדירה לא אומתה</h3>{p?.renewalProjects?.length?<div className="deal-feature-list">{p.renewalProjects.slice(0,6).map((x:any,i:number)=><div key={i}><strong><a href={'#/renewal/'+x.id}>{x.name||x.project_name||'פרויקט'}</a></strong><span>{x.status||'סטטוס לא זמין'}</span></div>)}</div>:<Empty title="אין פרויקט מקושר" body="אין כרגע ראיה מקושרת להתחדשות."/>}</section>
   <section className="panel"><h3>Planning / infrastructure</h3><div className="deal-summary-grid one"><Metric label="Plans" value={p?.plans?.length??0}/><Metric label="Infrastructure" value={p?.infrastructure?.length??0}/></div><Evidence e={p?.evidence}/></section>
  </div>}
 </div>
}
