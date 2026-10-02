import type {VercelRequest,VercelResponse} from '@vercel/node';
import {queryDatabase} from '../server/db.js';

const layers:Record<string,string>={
  deal_heat:'c.deal_heat',
  area_score:'c.area_score',
  price_sqm:'c.median_price_sqm_12m',
  price_growth:'c.price_change_1y',
  renewal:'c.renewal_expansion_ratio',
  population_growth:'c.population_growth_22_24',
  yield:'c.estimated_gross_yield'
};

export default async function handler(req:VercelRequest,res:VercelResponse){
  if(req.method!=='GET')return res.status(405).json({error:'method_not_allowed'});
  const z=Number(req.query.z),x=Number(req.query.x),y=Number(req.query.y);
  const layer=String(req.query.layer||'deal_heat');
  if(!Number.isInteger(z)||!Number.isInteger(x)||!Number.isInteger(y)||z<0||z>18||x<0||y<0)
    return res.status(400).json({error:'invalid_tile'});
  const value=layers[layer];
  if(!value)return res.status(400).json({error:'invalid_layer',allowed:Object.keys(layers)});
  try{
    const rows=await queryDatabase(`
      WITH bounds AS(SELECT ST_TileEnvelope($1,$2,$3) geom),
      features AS(
        SELECT a.id::text id,a.locality_code,a.statistical_area_code,a.locality_name,
          ${value}::float8 value,c.deal_heat::float8,c.area_score::float8,
          c.confidence_score::float8,c.confidence_level,c.coverage_pct::float8,
          c.deal_count,c.transaction_count_12m,c.median_price_sqm_12m::float8,c.price_change_1y::float8,
          ST_AsMVTGeom(ST_Transform(a.geom,3857),b.geom,4096,64,true) geom
        FROM area_dimensions a
        JOIN area_map_cache c ON c.area_id=a.id
        CROSS JOIN bounds b
        WHERE a.geom IS NOT NULL
          AND ST_Intersects(ST_Transform(a.geom,3857),b.geom)
          AND ${value} IS NOT NULL
      )
      SELECT ST_AsMVT(features,'areas',4096,'geom','id') tile FROM features
    `,[z,x,y]);
    const tile=rows[0]?.tile;
    const body=Buffer.isBuffer(tile)?tile:
      tile instanceof Uint8Array?Buffer.from(tile):
      typeof tile==='string'?Buffer.from(tile.replace(/^\\x/,''),'hex'):Buffer.alloc(0);
    res.setHeader('Content-Type','application/vnd.mapbox-vector-tile');
    res.setHeader('Cache-Control','public, s-maxage=300, stale-while-revalidate=3600');
    return res.status(200).send(body);
  }catch(error){
    return res.status(503).json({error:'area_tiles_unavailable',detail:String(error)});
  }
}
