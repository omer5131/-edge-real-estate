import {useEffect,useRef,useState} from 'react';

declare global{interface Window{L?:any}}

function ensureLeaflet(){
 if(window.L)return Promise.resolve(window.L);
 if(!document.getElementById('leaflet-css')){
  const link=document.createElement('link');link.id='leaflet-css';link.rel='stylesheet';
  link.href='https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';document.head.appendChild(link);
 }
 return new Promise<any>((resolve,reject)=>{
  const existing=document.getElementById('leaflet-js') as HTMLScriptElement|null;
  if(existing){existing.addEventListener('load',()=>resolve(window.L),{once:true});existing.addEventListener('error',reject,{once:true});return;}
  const script=document.createElement('script');script.id='leaflet-js';
  script.src='https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';script.async=true;
  script.onload=()=>resolve(window.L);script.onerror=reject;document.head.appendChild(script);
 });
}

type CityRow={city_id:string;settlement_code:string;name_he:string;name_en:string|null;geometry:any|null;transaction_count_12m:number;median_deal_amount_12m:number|null;median_price_sqm_12m:number|null;price_change_1y:number|null;latest_transaction_date:string|null;has_transaction_data:boolean;[key:string]:any};
type NeighborhoodRow={neighborhood_id:string;name_he:string;city:string;geometry:any|null;geometry_confidence?:number|null;[key:string]:any};
type ParcelRow={id:string;gush:number;helka:number;suffix:string;lon:number|null;lat:number|null;geometry:any|null;transaction_count:number;latest_transaction_date:string|null;[key:string]:any};

function colorFor(v:number|null,min:number,max:number){
 if(v==null||!Number.isFinite(v))return '#d9dedb';
 const t=Math.max(0,Math.min(1,(v-min)/(max-min||1)));
 const hue=8+t*122;
 return `hsl(${hue} 68% ${48-t*9}%)`;
}

export default function OpenStreetIntelligenceMap({
 mode,cities,neighborhood,parcels,layer,min,max,selectedCity,onCity,onParcel
}:{
 mode:'israel'|'neighborhood';
 cities:CityRow[];
 neighborhood:NeighborhoodRow|null;
 parcels:ParcelRow[];
 layer:string;
 min:number;
 max:number;
 selectedCity:string|null;
 onCity:(city:CityRow)=>void;
 onParcel:(parcel:ParcelRow)=>void;
}){
 const elRef=useRef<HTMLDivElement|null>(null);
 const mapRef=useRef<any>(null);
 const layerRef=useRef<any>(null);
 const [ready,setReady]=useState(false);

 useEffect(()=>{
  let disposed=false;let resize:undefined|(()=>void);
  ensureLeaflet().then((L:any)=>{
   if(disposed||!elRef.current||mapRef.current)return;
   const map=L.map(elRef.current,{zoomControl:true,attributionControl:true,minZoom:6,maxZoom:20});
   L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{
    maxZoom:20,
    attribution:'&copy; OpenStreetMap contributors'
   }).addTo(map);
   const group=L.featureGroup().addTo(map);
   mapRef.current=map;layerRef.current=group;
   map.setView([31.55,34.95],7);setReady(true);
   resize=()=>map.invalidateSize();requestAnimationFrame(resize);addEventListener('resize',resize);
  }).catch(()=>setReady(false));
  return()=>{disposed=true;if(resize)removeEventListener('resize',resize);if(mapRef.current){mapRef.current.remove();mapRef.current=null;layerRef.current=null;}};
 },[]);

 useEffect(()=>{
  const L=window.L,map=mapRef.current,group=layerRef.current;
  if(!ready||!L||!map||!group)return;
  group.clearLayers();

  if(mode==='neighborhood'&&neighborhood?.geometry){
   const n=L.geoJSON(neighborhood.geometry,{
    style:{color:'#153f2e',weight:3,fillColor:'#2f7d5a',fillOpacity:.10}
   }).bindTooltip(`${neighborhood.name_he}, ${neighborhood.city}`,{sticky:true});
   n.addTo(group);

   for(const parcel of parcels){
    if(!parcel.geometry)continue;
    const g=L.geoJSON(parcel.geometry,{
     style:{
      color:parcel.transaction_count>0?'#173d30':'#65766d',
      weight:parcel.transaction_count>0?1.6:1,
      fillColor:parcel.transaction_count>0?'#4c9a73':'#b9c3bd',
      fillOpacity:parcel.transaction_count>0?.42:.18
     }
    });
    g.bindTooltip(`גוש ${parcel.gush} · חלקה ${parcel.helka}${parcel.transaction_count? ` · ${parcel.transaction_count} עסקאות`:''}`,{sticky:true});
    g.on('click',()=>onParcel(parcel));
    g.addTo(group);
   }
   const bounds=group.getBounds();
   if(bounds.isValid())map.fitBounds(bounds.pad(.08),{animate:false,maxZoom:17});
   return;
  }

  for(const city of cities){
   if(!city.geometry)continue;
   const v=Number(city[layer]);
   const g=L.geoJSON(city.geometry,{
    style:{
     color:selectedCity===city.city_id?'#102f24':'#f7f8f5',
     weight:selectedCity===city.city_id?2.5:1,
     fillColor:city.has_transaction_data?colorFor(Number.isFinite(v)?v:null,min,max):'#d9dedb',
     fillOpacity:.68
    }
   });
   g.bindTooltip(`${city.name_he} · ${city.has_transaction_data?(city[layer]??'אין מדד'):'אין נתוני עסקאות'}`,{sticky:true});
   g.on('click',()=>onCity(city));
   g.addTo(group);
  }
  const bounds=group.getBounds();
  if(bounds.isValid())map.fitBounds(bounds.pad(.025),{animate:false});
 },[ready,mode,cities,neighborhood,parcels,layer,min,max,selectedCity,onCity,onParcel]);

 return <div className="ni-leaflet-map" ref={elRef} aria-label={mode==='neighborhood'?'Neighborhood parcel map':'Israel investment map'}/>;
}
