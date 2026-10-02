import {recentListing} from './scrapingBee.js';
// No ordering guarantee: daily discovery is a bounded front-page scan, not
// proof that all new ads have been found. Never reconcile disappearance here.
export function collectionPlan(scope:any,now=new Date()) {
 const incremental=!!scope.backfill_completed_at;
 const started=new Date(scope.cycle_started_at??now);
 const baseline=new Date(scope.backfill_started_at??started);
 const since=incremental?new Date(scope.last_completed_at??scope.backfill_completed_at):baseline;
 if(![started,baseline,since].every(d=>Number.isFinite(d.getTime())))throw new Error('Invalid collection checkpoint');
 const days=Number(scope.config?.published_within_days??30);
 const oldest=new Date((incremental?since:baseline).getTime()-(incremental?1:days)*86400000);
 const maxPages=Number(incremental?scope.config?.daily_max_pages??3:scope.config?.max_pages??10);
 const knownPageStop=Number(scope.config?.known_page_stop??2);
 if(!Number.isInteger(maxPages)||maxPages<1||!Number.isInteger(knownPageStop)||knownPageStop<1||!Number.isInteger(days)||days<1)throw new Error('Invalid collection limit');
 return {incremental,started,baseline,oldest:oldest.toISOString().slice(0,10),maxPages,knownPageStop};
}
export function isNewCandidate(row:any,plan:ReturnType<typeof collectionPlan>,known:boolean) {
 return !known && typeof row.published_at==='string' && row.published_at>=plan.oldest;
}
export function eligibleNewListing(row:any,config:any,plan:ReturnType<typeof collectionPlan>,now=new Date()) {
 // Keep the initial lower boundary fixed during a long, budget-limited backfill.
 const days=Number(config.published_within_days??30)+(plan.incremental?0:Math.max(0,Math.ceil((now.getTime()-plan.baseline.getTime())/86400000)));
 return recentListing(row,{...config,published_within_days:days},now)&&isNewCandidate(row,plan,false);
}
