
import { sql } from '../db.js';
import { sha256, text, pick, int } from '../normalize.js';

const SERVICE='https://ags.iplan.gov.il/arcgisiplan/rest/services/PlanningPublic/Xplan/MapServer';
const TARGETS=[
  {slug:'kiryat-eliezer-haifa',lat:32.82646,lon:34.97872},
  {slug:'kiryat-sprinzak-haifa',lat:32.82023,lon:34.96238},
  {slug:'kiryat-nordau-netanya',lat:32.28286,lon:34.85575},
  {slug:'yoseftal-petah-tikva',lat:32.09283,lon:34.90590},
];

async function getJson(url:string){
  const c=new AbortController(); const t=setTimeout(()=>c.abort(),20000);
  try{
    const r=await fetch(url,{headers:{'user-agent':'EdgeRealEstate/1.0'},signal:c.signal});
    if(!r.ok) throw new Error('XPLAN '+r.status);
    const body=await r.text();const ct=r.headers.get('content-type')||'';
    if(!body.trim().startsWith('{')&&!body.trim().startsWith('['))throw new Error('XPLAN non-JSON '+ct+' '+body.slice(0,80));
    return JSON.parse(body);
  }finally{clearTimeout(t)}
}
function attr(a:any,names:string[]){for(const n of names){if(a?.[n]!=null&&String(a[n]).trim())return a[n]}return null}
function polygonGeoJSON(g:any){
  if(!g?.rings||!Array.isArray(g.rings)||!g.rings.length)return null;
  return JSON.stringify({type:'Polygon',coordinates:g.rings});
}
export async function ingestXplan(runId:string){
  const root=await getJson(SERVICE+'?f=json');
  const layers=(root.layers||[]).filter((l:any)=>/plan|תכנ|קווים|blue/i.test(String(l.name||''))).slice(0,6);
  if(!layers.length && root.layers?.length) layers.push(...root.layers.slice(0,3));
  let fetched=0,inserted=0,updated=0,errors=0;

  for(const target of TARGETS){
    const n=await sql`SELECT id FROM neighborhoods WHERE slug=${target.slug} LIMIT 1`;
    if(!n.length)continue;
    const nid=String(n[0].id);
    for(const layer of layers){
      try{
        const d=0.015;
        const geom={xmin:target.lon-d,ymin:target.lat-d,xmax:target.lon+d,ymax:target.lat+d,spatialReference:{wkid:4326}};
        const u=new URL(SERVICE+'/'+layer.id+'/query');
        u.searchParams.set('f','json');u.searchParams.set('where','1=1');u.searchParams.set('geometry',JSON.stringify(geom));
        u.searchParams.set('geometryType','esriGeometryEnvelope');u.searchParams.set('inSR','4326');u.searchParams.set('outSR','4326');
        u.searchParams.set('spatialRel','esriSpatialRelIntersects');u.searchParams.set('outFields','*');u.searchParams.set('returnGeometry','true');
        u.searchParams.set('resultRecordCount','150');
        const p=await getJson(u.toString());
        for(const f of p.features||[]){
          fetched++;
          const a=f.attributes||{};
          const ext=String(attr(a,['OBJECTID','ObjectId','OID','ID','PLAN_ID','MIVAT_CODE','ENTITY_ID'])??sha256({layer:layer.id,a}));
          const h=sha256({layer:layer.id,feature:f});
          const raw=await sql`
            INSERT INTO raw_records(source_id,external_id,entity_hint,payload_hash,payload,ingestion_run_id)
            VALUES('xplan',${layer.id+':'+ext},'planning_plan',${h},${JSON.stringify(f)}::jsonb,${runId}::uuid)
            ON CONFLICT(source_id,external_id,payload_hash) DO UPDATE SET observed_at=now()
            RETURNING id`;
          const plan=text(attr(a,['PL_NUMBER','PLAN_NUM','PLAN_NUMBER','MIVAT_CODE','MISPAR_TOCHNIT','PLAN_NO']));
          const name=text(attr(a,['PL_NAME','PLAN_NAME','NAME','SHEM_TOCHNIT','ENTITY_NAME']))||('XPLAN '+(plan||ext));
          const status=text(attr(a,['STATUS','PLAN_STATUS','STAGE','STATUS_DESC','MATZAV']));
          const authority=text(attr(a,['AUTHORITY','AUTH_NAME','PL_AUTHORITY','MOSAD_TICHNUN']));
          const units=int(attr(a,['HOUSING_UNITS','NUM_OF_UNITS','YECHIDOT_DIUR','UNITS']));
          const gj=polygonGeoJSON(f.geometry);
          const existed=await sql`SELECT 1 FROM planning_plans WHERE source_id='xplan' AND source_plan_id=${layer.id+':'+ext}`;
          await sql`
            INSERT INTO planning_plans(source_id,source_plan_id,neighborhood_id,plan_number,name,status,authority,housing_units,source_url,geom,raw_record_id)
            VALUES('xplan',${layer.id+':'+ext},${nid}::uuid,${plan},${name},${status},${authority},${units},
              ${'https://ags.iplan.gov.il/'},CASE WHEN ${gj}::text IS NULL THEN NULL ELSE ST_Multi(ST_SetSRID(ST_GeomFromGeoJSON(${gj}),4326)) END,${Number(raw[0].id)})
            ON CONFLICT(source_id,source_plan_id) DO UPDATE SET neighborhood_id=EXCLUDED.neighborhood_id,plan_number=COALESCE(EXCLUDED.plan_number,planning_plans.plan_number),
              name=EXCLUDED.name,status=COALESCE(EXCLUDED.status,planning_plans.status),authority=COALESCE(EXCLUDED.authority,planning_plans.authority),
              housing_units=COALESCE(EXCLUDED.housing_units,planning_plans.housing_units),geom=COALESCE(EXCLUDED.geom,planning_plans.geom),
              raw_record_id=EXCLUDED.raw_record_id,observed_at=now()`;
          existed.length?updated++:inserted++;
        }
      }catch(e){errors++;console.error('xplan',target.slug,layer.id,e)}
    }
  }
  return {fetched,inserted,updated,errors};
}
