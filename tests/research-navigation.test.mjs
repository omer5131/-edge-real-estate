import {createRequire} from 'node:module';
import {spawn} from 'node:child_process';
import assert from 'node:assert/strict';
const {chromium}=createRequire(import.meta.url)('playwright');
const server=spawn('python',['-m','http.server','4188','--directory','dist'],{stdio:'ignore'});
let browser,bad=false,postFails=false,seen=[];
const listingId='22222222-2222-2222-2222-222222222222';
try{
 browser=await chromium.launch({headless:true,args:['--no-sandbox']});
 const page=await browser.newPage({viewport:{width:1440,height:900}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/api/**',async route=>{
  const u=new URL(route.request().url());let response={},status=200;
  if(u.pathname==='/api/edge-data')response={mode:'live',areas:[],opportunities:[],generatedAt:'2026-10-05'};
  if(u.pathname==='/api/data-status')response={freshness:[],counts:{}};
  if(u.pathname==='/api/opportunities'){
   if(route.request().method()==='POST'){response={error:'save_failed'};status=postFails?503:200;if(!postFails)response={ok:true};}
   else if(u.searchParams.get('mode')==='research'){
    seen.push(Object.fromEntries(u.searchParams));
    response=bad?{error:'bad_shape'}:{assets:Array.from({length:50},(_,i)=>({id:i===0?listingId:String(i),canonical_address:'נכס '+i,city:'חיפה',area_sqm:i===0?null:85,rooms:4,asking_price_nis:i===0?null:1000000,comp_count:2,confidence:'low'})),total:120,facets:{cities:['חיפה']}};
   }else{response={deal:{id:'fixture-deal',stage:'Watching'},scenarios:[],notes:[],dueDiligence:[],events:[]};}
  }
  if(u.pathname==='/api/property')response={tier:'basic',listing:{id:listingId,address:'נכס 0',city:'חיפה'},comps:[]};
  await route.fulfill({status,contentType:'application/json',body:JSON.stringify(response)});
 });
 await page.goto('http://127.0.0.1:4188/#/research');
 await page.getByRole('button',{name:'נכס 0',exact:true}).waitFor();
 assert.equal(await page.locator('thead th').count(),6);
 assert((await page.locator('tbody tr').first().innerText()).includes('לא ידוע'));
 const before=seen.length;await page.getByLabel('מחיר מקסימלי',{exact:true}).fill('1500000');await page.getByLabel('מיון',{exact:true}).selectOption('asking_price_nis');
 assert.equal(seen.length,before,'Draft filters do not silently change results');
 await Promise.all([page.waitForResponse(r=>r.url().includes('maxPrice=1500000')),page.getByRole('button',{name:'חפש נכסים',exact:true}).click()]);
 await page.getByRole('button',{name:'נכס 0',exact:true}).waitFor();
 const saved=page.url();assert(saved.includes('maxPrice=1500000'));
 await page.getByRole('button',{name:'פרטים נוספים',exact:true}).first().click();
 await page.evaluate(()=>{window.scrollTo(0,350);document.querySelector('.research-table').scrollLeft=-100});
 const y=await page.evaluate(()=>window.scrollY);
 // Clicking a visible row preserves the research context.
 await page.getByRole('button',{name:'נכס 0',exact:true}).click();
 await page.getByRole('button',{name:'Notes',exact:true}).click();
 await page.getByPlaceholder('מה גילית? מה צריך לזכור?').fill('הערה שלא נשמרה');postFails=true;
 await page.getByRole('button',{name:'שמור הערה',exact:true}).click();
 await page.getByRole('alert').filter({hasText:'save_failed'}).waitFor();
 assert.equal(await page.getByPlaceholder('מה גילית? מה צריך לזכור?').inputValue(),'הערה שלא נשמרה','Failed save must preserve note');postFails=false;
 await page.getByRole('button',{name:'חזרה למסך הקודם',exact:true}).click();
 await page.getByRole('button',{name:'נכס 0',exact:true}).waitFor();
 assert.equal(page.url(),saved);assert.equal(await page.getByLabel('מחיר מקסימלי',{exact:true}).inputValue(),'1500000');
 await page.waitForFunction(y=>Math.abs(window.scrollY-y)<10,y);
 assert.equal(await page.getByRole('button',{name:'פרטים נוספים',exact:true}).first().getAttribute('aria-expanded'),'true');
 await page.reload();await page.getByRole('button',{name:'נכס 0',exact:true}).waitFor();assert.equal(await page.getByLabel('מיון',{exact:true}).inputValue(),'asking_price_nis');
 postFails=true;await page.getByRole('button',{name:'עקוב אחר נכס',exact:true}).first().click();await page.getByRole('alert').waitFor();assert((await page.getByRole('alert').innerText()).includes('המעקב לא נשמר'));
 bad=true;await page.getByRole('button',{name:'נסה שוב',exact:true}).click();await page.getByText('תשובת החיפוש אינה תקינה. נסה שוב.',{exact:false}).waitFor();assert.equal(await page.getByText('לא נמצאו נכסים בסינון הזה',{exact:true}).count(),0);
 bad=false;await page.getByRole('button',{name:'נסה שוב',exact:true}).click();await page.getByRole('button',{name:'נכס 0',exact:true}).waitFor();
 await Promise.all([page.waitForResponse(r=>r.url().includes('offset=50')),page.getByRole('button',{name:'הבא',exact:true}).click()]);await page.getByRole('button',{name:'נכס 0',exact:true}).waitFor();assert(page.url().includes('offset=50'));
 await page.setViewportSize({width:390,height:844});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+1),'No page-wide overflow on mobile');
 assert.deepEqual(errors,[]);console.log('PASS research: drafts, URL filters/sort, return/refresh context, expanded row/scroll, nulls, failed follow, malformed response, retry, pagination and mobile overflow');
}finally{if(browser)await browser.close();server.kill();}
