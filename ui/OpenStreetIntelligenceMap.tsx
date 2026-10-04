import {useEffect,useRef} from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

type CityRow={
 city_id:string;name_he:string;geometry:any|null;has_transaction_data:boolean;
 [key:string]:any;
};
type NeighborhoodRow={neighborhood_id:string;name_he:string;city:string;geometry:any|null;geometry_confidence?:number|null;[key:string]:any};
type ParcelRow={id:string;gush:number;helka:number;suffix:string;geometry:any|null;transaction_count:number;latest_transaction_date:string|null;[key:string]:any};

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
 const mapRef=useRef<L.Map|null>(null);
 const layerRef=useRef<L.FeatureGroup|null>(null);

 useEffect(()=>{
  if(!elRef.current||mapRef.current)return;
  const map=L.map(elRef.current,{zoomControl:true,attributionControl:true,minZoom:6,maxZoom:20});
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{
   maxZoom:20,
   attribution:'&copy; OpenStreetMap contributors'
  }).addTo(map);
  const group=L.featureGroup().addTo(map);
  mapRef.current=map;layerRef.current=group;
  map.setView([31.55,34.95],7);
  const resize=()=>map.invalidateSize();
  requestAnimationFrame(resize);
  addEventListener('resize',resize);
  return()=>{removeEventListener('resize',resize);map.remove();mapRef.current=null;layerRef.current=null;};
 },[]);

 useEffect(()=>{
  const map=mapRef.current,group=layerRef.current;
  if(!map||!group)return;
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
 },[mode,cities,neighborhood,parcels,layer,min,max,selectedCity,onCity,onParcel]);

 return <div className="ni-leaflet-map" ref={elRef} aria-label={mode==='neighborhood'?'Neighborhood parcel map':'Israel investment map'}/>;
}
