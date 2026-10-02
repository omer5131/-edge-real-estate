import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const dir = '.edge-source';
const parts = fs.readdirSync(dir)
  .filter((name) => /^part-\d+\.txt$/.test(name))
  .sort();

if (!parts.length) {
  throw new Error('Edge source archive parts are missing');
}

const encoded = parts.map((name) => fs.readFileSync(path.join(dir, name), 'utf8').trim()).join('');
const json = zlib.gunzipSync(Buffer.from(encoded, 'base64')).toString('utf8');
const files = JSON.parse(json);

for (const [file, content] of Object.entries(files)) {
  const parent = path.dirname(file);
  if (parent !== '.') fs.mkdirSync(parent, { recursive: true });
  fs.writeFileSync(file, content, 'utf8');
}

const nodeTsconfigPath = 'tsconfig.node.json';
if (fs.existsSync(nodeTsconfigPath)) {
  const nodeTsconfig = JSON.parse(fs.readFileSync(nodeTsconfigPath, 'utf8'));
  nodeTsconfig.compilerOptions = {
    ...(nodeTsconfig.compilerOptions || {}),
    noEmit: true
  };
  fs.writeFileSync(nodeTsconfigPath, JSON.stringify(nodeTsconfig, null, 2) + '\n', 'utf8');
}

// Wire the existing polished demo UI to the live Edge backend without
// duplicating the large generated frontend source in Git.
const liveBootstrap = `
import { neighborhoods, properties, dataSources } from './mockData';

type LiveArea = {
  id:string; name:string; city:string;
  avg_price_sqm?:number|null; change_1y?:number|null; change_3y?:number|null;
  transactions_12m?:number; confidence?:string; sample_size?:number; latest_deal_date?:string|null;
  renewal_projects?:number|null; existing_units?:number|null; planned_units?:number|null;
  median_rent_nis?:number|null; median_rent_pp_sqm?:number|null; rent_sample_size?:number|null; rent_observed_at?:string|null;
};
type LiveOpportunity = {
  id:string; address:string; neighborhood_id:string; neighborhood:string; city:string;
  asking_price:number; sqm?:number|null; rooms?:number|null; floor?:string|null; price_sqm?:number|null;
  adjusted_value?:number|null; discount_pct?:number|null; days_on_market?:number;
  seller_motivation?:string; comp_count?:number; confidence?:string; latest_comp_date?:string|null;
  score?:number|null; price_points?:number; original_price?:number|null; last_seen_at?:string|null;
};
type LivePayload={mode:string;generatedAt?:string;areas?:LiveArea[];opportunities?:LiveOpportunity[];sources?:any[]};

const areaIdMap:Record<string,string>={
  'kiryat-eliezer-haifa':'kiryat-eliezer',
  'kiryat-sprinzak-haifa':'kiryat-sprinzak',
  'kiryat-nordau-netanya':'kiryat-nordau',
  'yoseftal-petah-tikva':'yoseftal'
};

function clearDemoFacts(reason='ממתין לנתוני אמת'){
  // Production never falls back to demo properties.
  properties.splice(0,properties.length);
  for(const current of neighborhoods as any[]){
    current.avgPriceSqm=0;
    current.change1Y=0;
    current.change3Y=0;
    current.transactions12M=0;
    current.renewalProjects=0;
    current.existingUnits=0;
    current.plannedUnits=0;
    current.avgRent=0;
    current.grossYield=0;
    current.socioCluster=0;
    current.householdIncome=0;
    current.academicPct=0;
    current.demographicGrowth=0;
    current.priceTrend=[];
    current.rentTrend=[];
    current.stages=[];
    current.infra=[];
    current.micro=[];
    current.dataConfidence='unavailable';
    current.sampleSize=0;
    current.latestDealDate=null;
    current.rentSampleSize=0;
    current.rentObservedAt=null;
    current.dataAvailable=false;
    current.insight=reason;
  }
  for(const source of dataSources as any[]){
    source.status='Not connected';
    source.records='—';
    source.updated='—';
  }
}

export async function bootstrapEdge(){
  clearDemoFacts('טוען נתוני אמת…');
  try{
    const response=await fetch('/api/edge-data',{headers:{accept:'application/json'},cache:'no-store'});
    if(!response.ok) throw new Error('live API '+response.status);
    const payload=await response.json() as LivePayload;
    if(payload.mode!=='live') throw new Error('live API unavailable');

    const byId=new Map((neighborhoods as any[]).map((n:any)=>[n.id,n]));
    for(const area of payload.areas||[]){
      const id=areaIdMap[area.id]||area.id;
      const current:any=byId.get(id);
      if(!current) continue;
      current.name=area.name||current.name;
      current.city=area.city||current.city;
      current.avgPriceSqm=area.avg_price_sqm==null?0:Number(area.avg_price_sqm);
      current.change1Y=area.change_1y==null?0:Number(area.change_1y);
      current.change3Y=area.change_3y==null?0:Number(area.change_3y);
      current.transactions12M=Number(area.transactions_12m||0);
      current.transactions12m=Number(area.transactions_12m||0);
      current.renewalProjects=area.renewal_projects==null?0:Number(area.renewal_projects);
      current.existingUnits=area.existing_units==null?0:Number(area.existing_units);
      current.plannedUnits=area.planned_units==null?0:Number(area.planned_units);
      current.avgRent=area.median_rent_nis==null?0:Number(area.median_rent_nis);
      current.grossYield=0;
      current.dataConfidence=area.confidence||'insufficient';
      current.sampleSize=Number(area.sample_size||0);
      current.latestDealDate=area.latest_deal_date||null;
      current.rentSampleSize=Number(area.rent_sample_size||0);
      current.rentObservedAt=area.rent_observed_at||null;
      current.dataAvailable=current.sampleSize>0;
      current.insight=current.sampleSize>0
        ? ('נתוני אמת · '+current.sampleSize+' עסקאות · confidence: '+current.dataConfidence)
        : 'אין עדיין מספיק עסקאות אמת לאזור הזה.';
    }

    const mapped:any[]=(payload.opportunities||[]).map((p)=>({
      id:p.id,
      address:p.address||'כתובת לא פתורה',
      neighborhoodId:areaIdMap[p.neighborhood_id]||p.neighborhood_id,
      neighborhood:p.neighborhood,
      city:p.city,
      askingPrice:Number(p.asking_price||0),
      sqm:Number(p.sqm||0),
      rooms:Number(p.rooms||0),
      floor:p.floor||'—',
      built:0,
      priceSqm:p.price_sqm==null?0:Number(p.price_sqm),
      adjustedValue:p.adjusted_value==null?0:Number(p.adjusted_value),
      discountPct:p.discount_pct==null?0:Number(p.discount_pct),
      renewalStage:'Live',
      daysOnMarket:Number(p.days_on_market||0),
      sellerMotivation:p.seller_motivation||'לא זמין',
      estimatedRent:0,
      grossYield:0,
      risk:p.confidence==='high'?'נמוך':p.confidence==='medium'?'בינוני':'גבוה',
      score:p.score==null?0:Number(p.score),
      scoreAvailable:p.score!=null,
      compConfidence:p.confidence||'insufficient',
      compCount:Number(p.comp_count||0),
      latestCompDate:p.latest_comp_date||null,
      saved:false,
      rationale:{
        priceGap:p.discount_pct==null?0:Number(p.discount_pct),
        renewal:0,momentum:0,yield:0,
        seller:Number(p.days_on_market||0)>75?8:3,
        compConfidence:Number(p.comp_count||0),
        riskDeduction:p.confidence==='insufficient'?10:0,
      }
    }));
    // Important: replace even when empty. Empty live inventory must stay empty.
    properties.splice(0,properties.length,...mapped);

    for(const live of payload.sources||[]){
      const existing:any=(dataSources as any[]).find((s:any)=>s.name===live.name||s.id===live.id);
      if(existing){
        existing.status=live.last_success_at?'Connected':'Not connected';
        existing.updated=live.last_success_at||live.last_error_at||'—';
      }
    }

    (window as any).__EDGE_LIVE__=true;
    (window as any).__EDGE_GENERATED_AT__=payload.generatedAt||null;
    return {live:true};
  }catch(error){
    clearDemoFacts('נתוני אמת אינם זמינים כרגע. נתוני דמו אינם מוצגים בפרודקשן.');
    (window as any).__EDGE_LIVE__=false;
    (window as any).__EDGE_LIVE_ERROR__=String(error);
    console.error('Edge live data unavailable; demo fallback disabled.',error);
    return {live:false};
  }
}
`
fs.mkdirSync('src/data', { recursive: true });
fs.writeFileSync('src/data/liveBootstrap.ts', liveBootstrap, 'utf8');

const mainPath = 'src/main.tsx';
if (fs.existsSync(mainPath)) {
  let main = fs.readFileSync(mainPath, 'utf8');
  if (!main.includes("liveBootstrap")) {
    main = main.replace(
      /import ['"]\.\/index\.css['"];?/,
      (m) => m + "\nimport { bootstrapEdge } from './data/liveBootstrap';"
    );
    const renderMatch = main.match(/ReactDOM\.createRoot\([\s\S]*$/);
    if (renderMatch) {
      const renderCode = renderMatch[0];
      main = main.slice(0, renderMatch.index) +
        "bootstrapEdge().finally(() => {\n  " +
        renderCode.replace(/\n/g, '\n  ') +
        "\n});\n";
    }
    fs.writeFileSync(mainPath, main, 'utf8');
  }
}

const appPath = 'src/App.tsx';
if (fs.existsSync(appPath)) {
  let app = fs.readFileSync(appPath, 'utf8');
  app = app.replace(/Live data only · no demo fallback/g, 'Live data only · no demo fallback');
  fs.writeFileSync(appPath, app, 'utf8');
}


const p1Main = [
  "import React from 'react';",
  "import ReactDOM from 'react-dom/client';",
  "import './index.css';",
  "import EdgeP1 from './EdgeP1';",
  "",
  "ReactDOM.createRoot(document.getElementById('root')!).render(",
  "  <React.StrictMode>",
  "    <EdgeP1 />",
  "  </React.StrictMode>",
  ");",
  ""
].join("\n");
fs.writeFileSync('src/main.tsx', p1Main, 'utf8');

console.log(`Reconstructed ${Object.keys(files).length} Edge source files and live-data bootstrap.`);
