import {queryDatabase} from '../db.js';
import {catalog} from '../http/data-explorer.js';
import {translateSql} from '../agent/deepseekAgents.js';

type Severity='critical'|'high'|'medium'|'low';
type EvalResult={
 caseId:string;category:string;severity:Severity;passed:boolean;skipped?:boolean;
 durationMs:number;message:string;question?:string;generatedSql?:string|null;details?:Record<string,unknown>;
};
type DeterministicCase={
 id:string;category:string;severity:Severity;description:string;
 sql:string;assert:(rows:any[])=>{pass:boolean;message:string;details?:Record<string,unknown>};
};

const deterministicCases:DeterministicCase[]=[
 {id:'comparables-residential-only',category:'data-quality',severity:'critical',description:'Canonical comparable transactions must exclude non-residential natures.',
  sql:`SELECT nature,count(*)::int rows FROM comparable_transactions GROUP BY nature ORDER BY rows DESC`,
  assert:rows=>{const bad=rows.filter(r=>!/דירה|מגורים|בית פרטי|קוטג|וילה/i.test(String(r.nature||''))||/מסחרי|חניה|מחסן|משרד/i.test(String(r.nature||'')));return {pass:bad.length===0,message:bad.length?'Non-residential comparable rows detected.':'Comparable surface is residential-only.',details:{bad}};}},
 {id:'asking-executed-separate',category:'semantics',severity:'critical',description:'Neighborhood market history must expose asking and executed price fields separately.',
  sql:`SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name='semantic_neighborhood_market_history' AND column_name IN ('median_executed_price_sqm','median_asking_price_sqm','asking_to_executed_premium_pct')`,
  assert:rows=>({pass:new Set(rows.map(r=>r.column_name)).size===3,message:rows.length===3?'Asking and executed metrics are explicit.':'Required asking/executed columns are missing.',details:{columns:rows.map(r=>r.column_name)}})},
 {id:'sparse-neighborhoods-no-fake-executed',category:'grounding',severity:'critical',description:'Nordau and Yoseftal must not receive fabricated executed prices when the 12M sample is empty.',
  sql:`SELECT n.slug,p.executed_transaction_count,p.median_executed_price_sqm,p.median_asking_price_sqm FROM neighborhoods n JOIN neighborhood_market_periods p ON p.neighborhood_id=n.id AND p.period_type='rolling_12m' WHERE n.slug IN ('kiryat-nordau-netanya','yoseftal-petah-tikva') ORDER BY n.slug`,
  assert:rows=>{const ok=rows.length===2&&rows.every(r=>Number(r.executed_transaction_count)===0&&r.median_executed_price_sqm==null&&Number(r.median_asking_price_sqm)>0);return {pass:ok,message:ok?'Sparse neighborhoods preserve asking data without inventing executed baselines.':'Sparse-neighborhood grounding regression.',details:{rows}};}},
 {id:'cbs-provisional-not-score-safe',category:'cbs',severity:'critical',description:'Provisional CBS profiles must never be score-safe.',
  sql:`SELECT slug,observation_year,profile_quality,safe_for_score,mapping_confidence FROM semantic_neighborhood_cbs_profile WHERE profile_quality='provisional' AND safe_for_score=true`,
  assert:rows=>({pass:rows.length===0,message:rows.length?'A provisional CBS profile is incorrectly score-safe.':'Provisional CBS profiles are context-only.',details:{violations:rows}})},
 {id:'target-cbs-profile-coverage',category:'cbs',severity:'high',description:'The four validation neighborhoods should expose CBS context for 2024.',
  sql:`SELECT n.slug,p.observation_year,p.population,p.profile_quality,p.safe_for_score FROM neighborhoods n LEFT JOIN neighborhood_cbs_profiles p ON p.neighborhood_id=n.id AND p.observation_year=2024 WHERE n.slug IN ('kiryat-eliezer-haifa','kiryat-sprinzak-haifa','kiryat-nordau-netanya','yoseftal-petah-tikva') ORDER BY n.slug`,
  assert:rows=>{const missing=rows.filter(r=>r.observation_year==null||r.population==null);return {pass:rows.length===4&&missing.length===0,message:missing.length?'Some validation neighborhoods lack CBS 2024 context.':'All four validation neighborhoods have CBS 2024 context.',details:{missing}};}},
 {id:'eliezer-listing-benchmark-grounded',category:'listing-benchmark',severity:'high',description:'Kiryat Eliezer active listings must have executed/current asking evidence and nonzero confidence.',
  sql:`SELECT canonical_address,historical_sample_count,current_listing_sample_count,benchmark_confidence,executed_discount_pct,current_asking_discount_pct FROM semantic_listing_market_benchmarks WHERE neighborhood_slug='kiryat-eliezer-haifa'`,
  assert:rows=>{const bad=rows.filter(r=>Number(r.historical_sample_count)<=0||Number(r.current_listing_sample_count)<=0||Number(r.benchmark_confidence)<=0);return {pass:rows.length>0&&bad.length===0,message:bad.length?'Some Eliezer listing benchmarks are ungrounded.':'Eliezer listing benchmarks have historical/current evidence.',details:{rows:rows.length,bad}};}},
 {id:'listing-confidence-gates-signal',category:'listing-benchmark',severity:'high',description:'Relative-value classification must be insufficient below 50% benchmark confidence.',
  sql:`SELECT listing_id::text,benchmark_confidence,relative_value_signal FROM listing_market_benchmarks WHERE benchmark_confidence<.5 AND relative_value_signal IS DISTINCT FROM 'insufficient'`,
  assert:rows=>({pass:rows.length===0,message:rows.length?'Low-confidence listings received value labels.':'Low-confidence listing signals are gated.',details:{violations:rows}})},
 {id:'market-liquidity-consistency',category:'market',severity:'medium',description:'Months of inventory should be null when there are zero executed transactions.',
  sql:`SELECT n.slug,p.executed_transaction_count,p.months_of_sale_inventory FROM neighborhood_market_periods p JOIN neighborhoods n ON n.id=p.neighborhood_id WHERE p.period_type='rolling_12m' AND p.executed_transaction_count=0 AND p.months_of_sale_inventory IS NOT NULL`,
  assert:rows=>({pass:rows.length===0,message:rows.length?'Inventory months present without transaction pace.':'Inventory months are withheld when liquidity denominator is absent.',details:{violations:rows}})},
 {id:'semantic-agent-surfaces-exist',category:'semantics',severity:'critical',description:'Agent-safe neighborhood semantic surfaces must exist.',
  sql:`SELECT to_regclass('public.semantic_neighborhood_market_history')::text market_history,to_regclass('public.semantic_listing_market_benchmarks')::text listing_benchmarks,to_regclass('public.semantic_neighborhood_cbs_profile')::text cbs_profile,to_regclass('public.semantic_neighborhood_summary')::text neighborhood_summary`,
  assert:rows=>{const r=rows[0]||{};const missing=Object.entries(r).filter(([,v])=>!v).map(([k])=>k);return {pass:missing.length===0,message:missing.length?'Semantic surfaces missing.':'All neighborhood semantic surfaces exist.',details:{missing}};}}
];

type AgentCase={id:string;category:string;severity:Severity;question:string;mustReference:string[];mustNotReference?:string[];};
const agentCases:AgentCase[]=[
 {id:'agent-neighborhood-market-history',category:'sql-agent',severity:'critical',question:'What is the executed price per sqm trend in Kiryat Eliezer and how does it compare with the current asking market?',mustReference:['semantic_neighborhood_market_history'],mustNotReference:[' from transactions ',' join transactions ',' from listing_snapshots ',' join listing_snapshots ']},
 {id:'agent-listing-relative-value',category:'sql-agent',severity:'critical',question:'Show active listings in Kiryat Eliezer and compare each one with executed historical comps and current asking prices, including benchmark confidence.',mustReference:['semantic_listing_market_benchmarks']},
 {id:'agent-cbs-profile-quality',category:'sql-agent',severity:'high',question:'Show the latest CBS demographic profile for Kiryat Nordau, including whether the mapping is validated enough to use in the investment score.',mustReference:['semantic_neighborhood_cbs_profile']},
 {id:'agent-sparse-executed-evidence',category:'sql-agent',severity:'high',question:'What is the executed 12-month price per sqm in Yoseftal, and how does it compare with current asking prices?',mustReference:['semantic_neighborhood_market_history']},
 {id:'agent-liquidity',category:'sql-agent',severity:'medium',question:'Compare transaction velocity and months of sale inventory for Kiryat Eliezer and Kiryat Sprinzak.',mustReference:['semantic_neighborhood_market_history']}
];

function references(sql:string,table:string){return sql.toLowerCase().split(/[^a-z0-9_]+/).includes(table.toLowerCase());}
function contains(sql:string,token:string){return sql.toLowerCase().includes(token.toLowerCase());}

async function persistResult(runId:string,r:EvalResult){
 await queryDatabase(`INSERT INTO evaluation_results(run_id,case_id,category,severity,passed,skipped,duration_ms,message,question,generated_sql,details)
 VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb)
 ON CONFLICT(run_id,case_id) DO UPDATE SET passed=excluded.passed,skipped=excluded.skipped,duration_ms=excluded.duration_ms,message=excluded.message,question=excluded.question,generated_sql=excluded.generated_sql,details=excluded.details`,
 [runId,r.caseId,r.category,r.severity,r.passed,!!r.skipped,r.durationMs,r.message,r.question||null,r.generatedSql||null,JSON.stringify(r.details||{})]);
}

export async function runNeighborhoodEvaluations(opts:{includeAgent?:boolean;gitSha?:string}={}){
 const includeAgent=!!opts.includeAgent;const mode=includeAgent?'full':'deterministic';
 const created=await queryDatabase(`INSERT INTO evaluation_runs(suite,mode,git_sha,model,metadata) VALUES('neighborhood-intelligence-v1',$1,$2,$3,$4::jsonb) RETURNING id::text`,
  [mode,opts.gitSha||process.env.VERCEL_GIT_COMMIT_SHA||null,includeAgent?(process.env.DEEPSEEK_MODEL||'deepseek-flash'):null,JSON.stringify({deterministicCases:deterministicCases.length,agentCases:includeAgent?agentCases.length:0})]);
 const runId=created[0].id as string;const results:EvalResult[]=[];
 for(const c of deterministicCases){const started=Date.now();try{const rows=await queryDatabase(c.sql);const a=c.assert(rows);const r:EvalResult={caseId:c.id,category:c.category,severity:c.severity,passed:a.pass,durationMs:Date.now()-started,message:a.message,details:{description:c.description,...a.details}};results.push(r);await persistResult(runId,r);}catch(error:any){const r:EvalResult={caseId:c.id,category:c.category,severity:c.severity,passed:false,durationMs:Date.now()-started,message:'Evaluation query failed.',details:{description:c.description,error:String(error?.message||error)}};results.push(r);await persistResult(runId,r);}}
 if(includeAgent){
  if(!process.env.DEEPSEEK_API_KEY){for(const c of agentCases){const r:EvalResult={caseId:c.id,category:c.category,severity:c.severity,passed:false,skipped:true,durationMs:0,message:'DeepSeek is not configured; agent case skipped.',question:c.question};results.push(r);await persistResult(runId,r);}}
  else{const datasets=await catalog();for(const c of agentCases){const started=Date.now();try{const draft=await translateSql(c.question,datasets,AbortSignal.timeout(45000));const sql=draft.sql||'';const missing=c.mustReference.filter(t=>!references(sql,t));const prohibited=(c.mustNotReference||[]).filter(t=>contains(sql,t));const pass=!!draft.sql&&missing.length===0&&prohibited.length===0;const r:EvalResult={caseId:c.id,category:c.category,severity:c.severity,passed:pass,durationMs:Date.now()-started,message:pass?'SQL agent selected the expected semantic surface.':'SQL agent semantic routing mismatch.',question:c.question,generatedSql:draft.sql,details:{missing,prohibited,explanation:draft.explanation,assumptions:draft.assumptions,clarification:draft.clarification}};results.push(r);await persistResult(runId,r);}catch(error:any){const r:EvalResult={caseId:c.id,category:c.category,severity:c.severity,passed:false,durationMs:Date.now()-started,message:'Agent evaluation failed to run.',question:c.question,details:{error:String(error?.message||error)}};results.push(r);await persistResult(runId,r);}}}
 }
 const passed=results.filter(r=>r.passed&&!r.skipped).length,failed=results.filter(r=>!r.passed&&!r.skipped).length,skipped=results.filter(r=>r.skipped).length;
 await queryDatabase(`UPDATE evaluation_runs SET finished_at=now(),passed=$2,failed=$3,skipped=$4 WHERE id=$1`,[runId,passed,failed,skipped]);
 return {runId,suite:'neighborhood-intelligence-v1',mode,passed,failed,skipped,total:results.length,ok:failed===0,results};
}

export async function latestNeighborhoodEvaluation(){
 const rows=await queryDatabase(`SELECT run_id::text,suite,mode,git_sha,model,started_at,finished_at,passed,failed,skipped,case_id,category,severity,case_passed,case_skipped,duration_ms,message,question,generated_sql,details FROM semantic_evaluation_latest WHERE suite='neighborhood-intelligence-v1' ORDER BY severity,case_id`);
 return {run:rows[0]?{runId:rows[0].run_id,suite:rows[0].suite,mode:rows[0].mode,gitSha:rows[0].git_sha,model:rows[0].model,startedAt:rows[0].started_at,finishedAt:rows[0].finished_at,passed:rows[0].passed,failed:rows[0].failed,skipped:rows[0].skipped}:null,results:rows};
}
