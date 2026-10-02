if(!process.env.DATABASE_URL)throw new Error('DATABASE_URL is required');
const {collectYad2}=await import('../.server-build/server/sources/yad2Collector.js');
const report=await collectYad2();
console.log(JSON.stringify(report,null,2));
if(!report.ok)process.exitCode=1;
