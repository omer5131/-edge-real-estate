import { parse, toSql } from 'pgsql-ast-parser';
const functions = new Set('count sum avg min max round abs ceil ceiling floor coalesce nullif lower upper trim btrim length substring concat concat_ws date_trunc date_part extract now to_char percentile_cont percentile_disc jsonb_extract_path_text jsonb_typeof jsonb_array_length greatest least'.split(' '));
const types = new Set('text varchar character numeric decimal int integer bigint smallint real float float4 float8 double precision boolean bool date timestamp timestamptz interval json jsonb uuid'.split(' '));
export function validateResearchSql(sql: string, tables: string[]) {
 if(typeof sql!=='string'||!sql.trim()||sql.length>20000)throw new Error('Enter a SQL query of up to 20,000 characters.');
 let ast:any[];try{ast=parse(sql);}catch{throw new Error('Invalid or unsupported SQL syntax. Use SELECT or WITH … SELECT.');}
 if(ast.length!==1)throw new Error('Run one SELECT statement at a time.');
 const allowed=new Set(tables),ctes=new Set<string>();
 const statements=new Set(['select','with','union','union all']);
 function statement(n:any){if(!n||!statements.has(n.type))throw new Error('Only read-only SELECT queries are allowed.');}
 function walk(n:any){
  if(!n||typeof n!=='object')return;
  if(Array.isArray(n)){n.forEach(walk);return;}
  if(n.type==='with') { for(const b of n.bind){statement(b.statement);ctes.add(b.alias.name);}statement(n.in); }
  if(n.type==='union'||n.type==='union all'){statement(n.left);statement(n.right);}
  if(n.type==='select'&&(n.for||n.into))throw new Error('Locking and SELECT INTO are not allowed.');
  if(['insert','update','delete','truncate','create table','drop table','with recursive','values'].includes(n.type))throw new Error('Only SELECT queries are allowed.');
  if(n.type==='table'){
   const name=n.name;
   if(name.schema&&name.schema!=='public')throw new Error('Only public research datasets can be queried.');
   if(!allowed.has(name.name)&&!(ctes.has(name.name)&&!name.schema))throw new Error(`Dataset ${name.name} is not available for research.`);
  }
  if(n.type==='call'){
   if(n.function.schema||!functions.has(n.function.name.toLowerCase()))throw new Error(`Function ${n.function.name} is not supported in research queries.`);
  }
  if(n.type==='cast'&&(n.to.schema||!types.has(n.to.name.toLowerCase())))throw new Error('Unsupported SQL cast.');
  for(const [k,v] of Object.entries(n)){
   if(k==='statement'||k==='in'&&n.type==='with')statement(v);
   walk(v);
  }
 }
 statement(ast[0]);walk(ast[0]);
 return toSql.statement(ast[0]);
}
