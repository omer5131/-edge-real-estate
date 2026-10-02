import catalog from './researchCatalog.json' with { type: 'json' };
import { datasetTable, identifier } from './overApi.js';
const literal=(value:string)=>"E'"+value.replaceAll('\\','\\\\').replaceAll("'","''")+"'";
export type Field = { name:string; source?:string; type:string; description:string; constant?:number; unit?:string|null };
export type ResearchDataset = { id:string; slug:string; title:string; category:string; adapter:string; sourceTable?:string|null; sourceUrl?:string|null; dateColumn?:string|null; observationYear?:number|null; grain:string; geography:string; fields:Field[]; keys:string[]; caveats:string[]; joins:any[]; blockedReason?:string|null; refresh:string };
export const researchCatalog = catalog as ResearchDataset[];
export const semanticView = (d:ResearchDataset) => 'research_'+d.slug;
export function fieldExpression(f:Field):string {
  if(f.constant!==undefined)return String(f.constant);
  const source=`_edge_payload->>${literal(f.source ?? f.name)}`;
  if(f.type==='json')return `_edge_payload->${literal(f.source ?? f.name)}`;
  if(f.type==='number'||f.type==='integer') {
    const clean=`replace(replace(btrim(${source}),',',''),'%','')`;
    return `CASE WHEN ${clean} ~ '^-?[0-9]+([.][0-9]+)?$' THEN ${clean}::numeric ELSE NULL END`;
  }
  return `NULLIF(${source},'')`;
}
export function datasetDdl(d:ResearchDataset):string[] {
  const table=identifier(datasetTable(d.id)),view=identifier(semanticView(d));
  const fields=d.fields.map(f=>`${fieldExpression(f)} AS ${identifier(f.name)}`);
  // Entity keys are source-specific. Incomplete keys fall back to hash instead of collapsing missing records.
  const keys=d.keys.map(k=>d.fields.find(f=>f.name===k)).filter(Boolean) as Field[];
  const key=keys.length ? `CASE WHEN ${keys.map(f=>`${fieldExpression(f)} IS NOT NULL`).join(' AND ')} THEN jsonb_build_array(${keys.map(fieldExpression).join(',')})::text ELSE _edge_source_key END` : '_edge_source_key';
  const order=`COALESCE(_edge_payload->>'first_seen',_edge_payload->>'_first_seen','') DESC,_edge_loaded_at DESC,_edge_hash DESC`;
  return [
    `CREATE TABLE IF NOT EXISTS ${table} (_edge_hash text PRIMARY KEY,_edge_source_key text NOT NULL,_edge_payload jsonb NOT NULL,_edge_loaded_at timestamptz NOT NULL DEFAULT now(),_edge_seen_at timestamptz NOT NULL DEFAULT now())`,
    `CREATE INDEX IF NOT EXISTS ${identifier(datasetTable(d.id)+'_source_key')} ON ${table}(_edge_source_key)`,
    `INSERT INTO over_datasets(dataset_id,title,table_name,source_table,source_schema,date_column,enabled,status,last_error) VALUES(${literal(d.id)}::uuid,${literal(d.title)},${literal(datasetTable(d.id))},${d.sourceTable?literal(d.sourceTable):'NULL'},${literal(JSON.stringify(d.adapter==='archive'?{table:d.sourceTable,columns:[...new Set([...d.fields.filter(f=>f.source).map(f=>f.source),'first_seen','row_hash'])],first_seen_column:'first_seen'}:{}))}::jsonb,${d.dateColumn?literal(d.dateColumn):'NULL'},${d.adapter==='unavailable'?'false':'true'},${literal(d.adapter==='unavailable'?'failed':'pending')},${d.blockedReason?literal(d.blockedReason):'NULL'}) ON CONFLICT(dataset_id) DO NOTHING`,
    `CREATE OR REPLACE VIEW ${view} AS SELECT DISTINCT ON (${key}) _edge_hash AS _record_id,_edge_loaded_at AS _loaded_at,_edge_payload AS _source_payload${fields.length?','+fields.join(','):''} FROM ${table} ORDER BY ${key},${order}`,
    `COMMENT ON VIEW ${view} IS ${literal(JSON.stringify({grain:d.grain,keys:d.keys,source:d.sourceUrl,caveats:d.caveats}))}`,
    ...d.fields.map(f=>`COMMENT ON COLUMN ${view}.${identifier(f.name)} IS ${literal(f.description)}`)
  ];
}
export function researchSchemaStatements():string[] {
 return [
  `CREATE TABLE IF NOT EXISTS research_semantic_catalog(dataset_id uuid PRIMARY KEY REFERENCES over_datasets(dataset_id),slug text UNIQUE NOT NULL,view_name text UNIQUE NOT NULL,definition jsonb NOT NULL,updated_at timestamptz NOT NULL DEFAULT now())`,
  ...researchCatalog.flatMap(d=>[...datasetDdl(d),`INSERT INTO research_semantic_catalog(dataset_id,slug,view_name,definition) VALUES(${literal(d.id)}::uuid,${literal(d.slug)},${literal(semanticView(d))},${literal(JSON.stringify(d))}::jsonb) ON CONFLICT(dataset_id) DO UPDATE SET view_name=EXCLUDED.view_name,definition=EXCLUDED.definition,updated_at=now()`])
,`CREATE TABLE IF NOT EXISTS research_schema_versions(version text PRIMARY KEY,applied_at timestamptz NOT NULL DEFAULT now())`,`INSERT INTO research_schema_versions(version) VALUES('research-v1') ON CONFLICT DO NOTHING`
 ];
}
export function semanticDefinition(d:ResearchDataset) {
 return {...d,table:datasetTable(d.id),view:semanticView(d),queryEndpoint:'/api/over-datasets?mode=query&dataset='+d.slug,
  examples:[{question:'Inspect latest observations',sql:`SELECT * FROM ${identifier(semanticView(d))} LIMIT 20`},...(d.fields.some(f=>f.name==='municipality')?[{question:'Compare municipality observations from 2022',sql:`SELECT * FROM ${identifier(semanticView(d))} WHERE municipality = 'חיפה' AND observation_year >= 2022 ORDER BY observation_year DESC LIMIT 100`}]:[])],
  queryRules:['Prefer semantic views over raw version tables.','Never use first_seen or _loaded_at as the observation date.','Check collection status and coverage before drawing conclusions.','Join only on verified identifiers and matching geographic boundary versions.','Queries use an allowlisted parameterized read-only API; arbitrary SQL is not accepted.']};
}
export function buildResearchQuery(d:ResearchDataset,input:any) {
 const fields=new Map(d.fields.map(f=>[f.name,f]));fields.set('_record_id',{name:'_record_id',type:'text',description:'Record hash'});fields.set('_loaded_at',{name:'_loaded_at',type:'text',description:'Cache load timestamp'});
 const col=(name:string)=>{if(!fields.has(name))throw new Error('Unknown semantic field: '+name);return identifier(name)};
 const params:any[]=[];const where:string[]=[];
 if(input.filters!==undefined&&!Array.isArray(input.filters))throw new Error('filters must be an array');
 if((input.filters?.length??0)>20)throw new Error('Too many filters');
 for(const f of input.filters??[]) {
   const name=col(f.field);const op=f.op??'eq';
   if(!['eq','gte','lte','contains','in'].includes(op))throw new Error('Unsupported filter operator');
   if(op==='in') {if(!Array.isArray(f.value)||!f.value.length||f.value.length>100)throw new Error('Invalid IN filter');params.push(f.value);where.push(`${name}=ANY($${params.length})`);}
   else {if(!['string','number','boolean'].includes(typeof f.value))throw new Error('Invalid filter value');if(op==='contains'&&fields.get(f.field)?.type!=='text')throw new Error('contains requires a text field');params.push(op==='contains'?'%'+f.value+'%':f.value);where.push(`${name} ${({eq:'=',gte:'>=',lte:'<=',contains:'ILIKE'} as any)[op]} $${params.length}`);}
 }
 let selection:string[];const groups:string[]=input.groupBy??[];
 if(!Array.isArray(groups)||groups.length>8)throw new Error('Invalid groupBy');groups.forEach(col);
 if(input.metrics?.length) {
   if(!Array.isArray(input.metrics)||input.metrics.length>12)throw new Error('Invalid metrics');
   selection=[...groups.map(col),...input.metrics.map((m:any,i:number)=>{if(!['count','sum','avg','min','max','median'].includes(m.op))throw new Error('Unknown metric');const c=m.field?col(m.field):'*';if(m.op!=='count'&&!['number','integer'].includes(fields.get(m.field)?.type??''))throw new Error('Metric requires a numeric field');return `${m.op==='median'?`percentile_cont(.5) WITHIN GROUP (ORDER BY ${c})`:`${m.op}(${c})`} AS ${identifier('metric_'+i)}`;})];
 } else {if(groups.length)throw new Error('groupBy requires metrics');const columns=input.columns??['_record_id',...d.fields.filter(f=>!['geometry','geometry_wkt','geom'].includes(f.name)).map(f=>f.name)];if(!Array.isArray(columns)||!columns.length||columns.length>120)throw new Error('Invalid columns');selection=columns.map(col);}
 const limit=Math.max(1,Math.min(200,Number(input.limit??50))),offset=Math.max(0,Math.min(100000,Number(input.offset??0)));
 if(!Number.isInteger(limit)||!Number.isInteger(offset))throw new Error('Invalid pagination');
 let order='';
 if(input.orderBy){const ord=input.orderBy;if(!['asc','desc'].includes(ord.direction??'asc'))throw new Error('Invalid sort direction');if(input.metrics?.length&&!groups.includes(ord.field))throw new Error('Aggregate ordering requires a group field');order=` ORDER BY ${col(ord.field)} ${ord.direction??'asc'} NULLS LAST`;}
 else if(!input.metrics?.length)order=' ORDER BY _record_id';
 params.push(limit,offset);
 return {text:`SELECT ${selection.join(',')} FROM ${identifier(semanticView(d))}${where.length?' WHERE '+where.join(' AND '):''}${groups.length?' GROUP BY '+groups.map(col).join(','):''}${order} LIMIT $${params.length-1} OFFSET $${params.length}`,params,limit,offset};
}
