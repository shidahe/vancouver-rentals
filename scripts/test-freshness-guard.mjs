import { spawn } from 'node:child_process';
import { chromium } from 'playwright';

const PORT=4174;
const BASE=`http://127.0.0.1:${PORT}`;
const server=spawn('python3',['-m','http.server',String(PORT),'--bind','127.0.0.1'],{stdio:['ignore','pipe','pipe']});
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const assert=(cond,msg)=>{if(!cond)throw new Error(msg)};

async function waitForServer(){
  for(let i=0;i<40;i++){
    try{const r=await fetch(BASE);if(r.ok)return}catch{}
    await sleep(250);
  }
  throw new Error('Static test server did not start');
}

let browser;
try{
  await waitForServer();
  browser=await chromium.launch({headless:true});
  const page=await browser.newPage({viewport:{width:1280,height:900}});
  await page.goto(BASE,{waitUntil:'networkidle',timeout:60000});
  await page.waitForFunction(()=>window.RentalFreshness&&document.documentElement.dataset.dataFreshness,{timeout:15000});
  const current=await page.evaluate(()=>({
    freshness:document.documentElement.dataset.dataFreshness,
    ready:document.documentElement.dataset.runtimeDecisionReady,
    bannerVisible:getComputedStyle(document.getElementById('dataFreshnessBanner')).display!=='none'
  }));
  assert(current.freshness==='fresh',`Freshly generated data was not marked fresh: ${JSON.stringify(current)}`);
  assert(current.ready==='true',`Fresh decision-ready data was not runtime-ready: ${JSON.stringify(current)}`);
  assert(!current.bannerVisible,`Fresh data warning banner should be hidden: ${JSON.stringify(current)}`);

  const synthetic=await page.evaluate(()=>{
    const old=new Date(Date.now()-13*60*60*1000).toISOString();
    const result=window.RentalFreshness.evaluate(old,Date.now());
    return{state:result.state,fresh:result.fresh,ageHours:result.ageHours};
  });
  assert(synthetic.state==='stale'&&!synthetic.fresh&&synthetic.ageHours>=13,`13-hour-old data did not fail closed: ${JSON.stringify(synthetic)}`);
  console.log(JSON.stringify({ok:true,current,synthetic},null,2));
}finally{
  if(browser)await browser.close();
  server.kill('SIGTERM');
}
