import {useEffect,useState} from 'react';
import {ExternalLink,Link2,FilePlus2,RefreshCw,CheckCircle2,AlertTriangle} from 'lucide-react';
import './external-data-intake.css';

type Kind='sale'|'rent';
type Mode='url'|'manual';
const blank={url:'',city:'',neighborhood:'',address:'',askingPrice:'',askingRent:'',areaSqm:'',rooms:'',floor:'',propertyType:'',brokerName:'',description:'',publishedAt:'',contactPhone:'',lat:'',lon:'',gush:'',helka:'',notes:''};
const numeric=new Set(['askingPrice','askingRent','areaSqm','rooms','lat','lon','gush','helka']);

export default function ExternalDataIntake(){
 const [mode,setMode]=useState<Mode>('url'),[kind,setKind]=useState<Kind>('sale'),[form,setForm]=useState<any>(blank);
 const [busy,setBusy]=useState(false),[message,setMessage]=useState<any>(null),[rows,setRows]=useState<any[]>([]);
 const set=(k:string,v:any)=>setForm((x:any)=>({...x,[k]:v}));
 const load=async()=>{try{const r=await fetch('/api/external-data?limit=12',{cache:'no-store'});const j=await r.json();setRows(j.intakes||[])}catch{}};
 useEffect(()=>{load()},[]);
 const submit=async()=>{
  setBusy(true);setMessage(null);
  try{
   const payload:any={intakeMode:mode,listingType:kind};
   Object.entries(form).forEach(([k,v])=>{if(v!==''&&v!=null)payload[k]=numeric.has(k)?Number(v):v});
   if(kind==='rent'&&form.askingRent==='')delete payload.askingRent;
   const r=await fetch('/api/external-data',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(payload)});
   const j=await r.json();
   if(!r.ok&&r.status!==202)throw new Error(j.error||'Failed to add listing');
   if(j.needsInput){
    setMessage({type:'warn',text:'The link was saved, but Edge could not extract enough fields automatically. Complete the form below and submit it manually.'});
    setMode('manual');
    setForm((x:any)=>({...x,...j.extracted,url:x.url||j.extracted?.canonicalUrl||''}));
   }else{
    setMessage({type:'ok',text:(kind==='sale'?'Sale':'Rental')+' listing registered in the canonical data pipeline.'});
    setForm(blank);
   }
   await load();
  }catch(e:any){setMessage({type:'error',text:String(e?.message||e)})}
  finally{setBusy(false)}
 };
 return <section className="external-intake panel">
  <div className="external-head">
   <div><span className="eyebrow">Add external data</span><h3>Add a listed apartment</h3>
    <p className="panel-sub">Add a sale or rental listing from a URL, or enter the initial observation manually. Once accepted it uses the same canonical listing, history, geography, dedupe and scoring pipeline as collected inventory.</p></div>
   <div className="external-kind"><button className={kind==='sale'?'active':''} onClick={()=>setKind('sale')}>For sale</button><button className={kind==='rent'?'active':''} onClick={()=>setKind('rent')}>For rent</button></div>
  </div>
  <div className="external-options">
   <button className={mode==='url'?'active':''} onClick={()=>setMode('url')}><Link2 size={17}/><span><b>Collect from link</b><small>Paste a listing URL and let Edge extract the first observation.</small></span></button>
   <button className={mode==='manual'?'active':''} onClick={()=>setMode('manual')}><FilePlus2 size={17}/><span><b>Enter manually</b><small>Provide the listing details directly when a source cannot be collected.</small></span></button>
  </div>
  {message&&<div className={'external-message '+message.type}>{message.type==='ok'?<CheckCircle2 size={16}/>:<AlertTriangle size={16}/>}<span>{message.text}</span></div>}
  {mode==='url'?<div className="external-url-form">
    <label>Listing URL<input type="url" value={form.url} onChange={e=>set('url',e.target.value)} placeholder="https://…"/></label>
    <label>City <span>optional hint</span><input value={form.city} onChange={e=>set('city',e.target.value)} placeholder="חיפה"/></label>
    <label>Neighborhood <span>optional hint</span><input value={form.neighborhood} onChange={e=>set('neighborhood',e.target.value)} placeholder="קריית אליעזר"/></label>
    <button className="primary external-submit" disabled={busy||!form.url} onClick={submit}>{busy?<><RefreshCw className="spin" size={15}/>Collecting…</>:<><ExternalLink size={15}/>Collect & register</>}</button>
   </div>:<div className="external-manual-form">
    <label className="wide">Source URL <span>optional</span><input type="url" value={form.url} onChange={e=>set('url',e.target.value)} placeholder="https://…"/></label>
    <label>City<input value={form.city} onChange={e=>set('city',e.target.value)} placeholder="חיפה"/></label>
    <label>Neighborhood<input value={form.neighborhood} onChange={e=>set('neighborhood',e.target.value)} placeholder="קריית אליעזר"/></label>
    <label className="wide">Address *<input value={form.address} onChange={e=>set('address',e.target.value)} placeholder="רחוב ומספר"/></label>
    {kind==='sale'?<label>Asking price (₪) *<input type="number" value={form.askingPrice} onChange={e=>set('askingPrice',e.target.value)}/></label>:<label>Monthly rent (₪) *<input type="number" value={form.askingRent} onChange={e=>set('askingRent',e.target.value)}/></label>}
    <label>Area m²<input type="number" value={form.areaSqm} onChange={e=>set('areaSqm',e.target.value)}/></label>
    <label>Rooms<input type="number" step=".5" value={form.rooms} onChange={e=>set('rooms',e.target.value)}/></label>
    <label>Floor<input value={form.floor} onChange={e=>set('floor',e.target.value)}/></label>
    <label>Property type<input value={form.propertyType} onChange={e=>set('propertyType',e.target.value)} placeholder="Apartment"/></label>
    <label>Broker / publisher<input value={form.brokerName} onChange={e=>set('brokerName',e.target.value)}/></label>
    <label>Published at<input type="date" value={form.publishedAt} onChange={e=>set('publishedAt',e.target.value)}/></label>
    <label>Gush<input type="number" value={form.gush} onChange={e=>set('gush',e.target.value)}/></label>
    <label>Helka<input type="number" value={form.helka} onChange={e=>set('helka',e.target.value)}/></label>
    <label>Latitude<input type="number" step="any" value={form.lat} onChange={e=>set('lat',e.target.value)}/></label>
    <label>Longitude<input type="number" step="any" value={form.lon} onChange={e=>set('lon',e.target.value)}/></label>
    <label className="wide">Description<textarea value={form.description} onChange={e=>set('description',e.target.value)} rows={3}/></label>
    <label className="wide">Notes<textarea value={form.notes} onChange={e=>set('notes',e.target.value)} rows={2}/></label>
    <div className="wide external-form-actions"><button className="primary external-submit" disabled={busy||!form.address||(kind==='sale'?!form.askingPrice:!form.askingRent)} onClick={submit}>{busy?<><RefreshCw className="spin" size={15}/>Registering…</>:<><FilePlus2 size={15}/>Register in data pipeline</>}</button></div>
   </div>}
  <div className="external-recent"><div className="external-recent-head"><b>Recent external intake</b><button onClick={load}><RefreshCw size={13}/>Refresh</button></div>
   {!rows.length?<span className="muted">No external listings added yet.</span>:<div className="table-wrap"><table><thead><tr><th>Type</th><th>Method</th><th>Status</th><th>Submitted</th><th>Source</th></tr></thead><tbody>
    {rows.map(r=><tr key={r.id}><td>{r.listing_type}</td><td>{r.intake_mode}</td><td><span className={'external-status '+r.status}>{r.status}</span>{r.error&&<small>{r.error}</small>}</td><td>{new Date(r.created_at).toLocaleString()}</td><td>{r.url?<a href={r.url} target="_blank" rel="noreferrer">Open link ↗</a>:'Manual'}</td></tr>)}
   </tbody></table></div>}
  </div>
 </section>;
}
