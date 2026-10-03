const mod=await import('../.server-eval/evaluation/neighborhoodEvals.js');
const includeAgent=process.argv.includes('--agent');
const result=await mod.runNeighborhoodEvaluations({includeAgent});
console.log(JSON.stringify(result,null,2));
if(!result.ok)process.exitCode=1;
