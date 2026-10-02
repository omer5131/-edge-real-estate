if(!process.env.DATABASE_URL)throw new Error('DATABASE_URL is required');
await import('./migrate-yad2.mjs');
const {runYad2Dataset}=await import('../.server-build/server/sources/yad2Dataset.js');
const report=await runYad2Dataset();
console.log(JSON.stringify(report,null,2));
if(report.ok===false)process.exitCode=1;
