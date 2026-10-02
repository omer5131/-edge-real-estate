import {yad2Url} from './yad2Source.js';
export function unlockerConfig(env:NodeJS.ProcessEnv=process.env) {
 if(!env.BRIGHTDATA_API_KEY||!env.BRIGHTDATA_UNLOCKER_ZONE)throw new Error('Bright Data API key and Web Unlocker zone are required');
 if(env.BRIGHTDATA_FREE_TIER_CONFIRMED!=='true')throw new Error('Confirm an eligible unfunded free-tier account before collection');
 return {key:env.BRIGHTDATA_API_KEY,zone:env.BRIGHTDATA_UNLOCKER_ZONE};
}
// Never retry an ambiguous paid POST or silently fall back to another provider.
export async function unlockYad2(url:string,config:ReturnType<typeof unlockerConfig>,reserve:()=>Promise<void>,fetcher:typeof fetch=fetch) {
 const target=yad2Url(url);await reserve();let response:Response;
 try {
  response=await fetcher('https://api.brightdata.com/request',{
   method:'POST',headers:{Authorization:`Bearer ${config.key}`,'Content-Type':'application/json'},
   body:JSON.stringify({zone:config.zone,url:target,format:'raw'}),redirect:'error',signal:AbortSignal.timeout(90000)
  });
 }catch{throw new Error('Bright Data transport failed; request was not retried');}
 if(!response.ok)throw new Error(`Bright Data HTTP ${response.status}; collection stopped`);
 const html=await response.text();
 if(!html.trim()||html.length>10000000)throw new Error('Bright Data returned an empty or oversized page');
 return html;
}
