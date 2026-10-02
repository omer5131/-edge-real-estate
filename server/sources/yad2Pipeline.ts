import {randomUUID} from 'node:crypto';
import {queryDatabase,databaseTransaction} from '../db.js';
export function pipelineDb(deps:any={}) {
 return {query:deps.queryDatabase??queryDatabase,transaction:deps.databaseTransaction??databaseTransaction};
}
export function positiveLimit(value:any,fallback:number) {
 const n=Number(value??fallback);if(!Number.isInteger(n)||n<1)throw new Error('Limits must be positive integers');return n;
}
export async function pipelineLease(db:ReturnType<typeof pipelineDb>,id:number) {
 const token=randomUUID();
 const rows=await db.query(`INSERT INTO yad2_worker_lock(id,token,expires_at) VALUES($1,$2::uuid,now()+interval '5 minutes')
 ON CONFLICT(id) DO UPDATE SET token=EXCLUDED.token,expires_at=EXCLUDED.expires_at
 WHERE yad2_worker_lock.expires_at<now() RETURNING token`,[id,token]);
 if(!rows.length)throw new Error('This pipeline service is already running');
 return {
  async renew() {
   const rows=await db.query(`UPDATE yad2_worker_lock SET expires_at=now()+interval '5 minutes' WHERE id=$1 AND token=$2::uuid AND expires_at>now() RETURNING token`,[id,token]);
   if(!rows.length)throw new Error('Pipeline lease lost');
  },
  async release(){await db.query('DELETE FROM yad2_worker_lock WHERE id=$1 AND token=$2::uuid',[id,token]);}
 };
}
