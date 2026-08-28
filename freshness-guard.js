(()=>{
  const MAX_AGE_MS=12*60*60*1000;
  const id='dataFreshnessBanner';
  function evaluate(timestamp,nowMs=Date.now()){
    const t=Date.parse(timestamp||'');
    if(!Number.isFinite(t))return{fresh:false,state:'unknown',ageHours:null};
    const ageMs=Math.max(0,nowMs-t);
    return{fresh:ageMs<=MAX_AGE_MS,state:ageMs<=MAX_AGE_MS?'fresh':'stale',ageHours:ageMs/3600000};
  }
  function ensureBanner(){
    let el=document.getElementById(id);
    if(el)return el;
    el=document.createElement('div');
    el.id=id;
    el.setAttribute('role','status');
    el.setAttribute('aria-live','polite');
    el.style.cssText='display:none;margin:0;padding:10px 18px;background:#fff3cd;color:#664d03;border-bottom:1px solid #ffecb5;font:600 14px/1.4 system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;text-align:center;';
    const header=document.querySelector('.topbar');
    if(header)header.insertAdjacentElement('afterend',el);else document.body.prepend(el);
    return el;
  }
  function apply(result,qualityReady,lastRefresh){
    const banner=ensureBanner();
    const runtimeReady=!!qualityReady&&result.fresh;
    document.documentElement.dataset.dataFreshness=result.state;
    document.documentElement.dataset.runtimeDecisionReady=runtimeReady?'true':'false';
    if(runtimeReady){banner.style.display='none';banner.textContent='';return;}
    banner.style.display='block';
    if(result.state==='stale'){
      const hours=Math.round(result.ageHours||0);
      banner.textContent=`Rental data refresh is overdue (${hours}h old). Treat listings as provisional until a fresh verification completes.`;
    }else if(result.state==='unknown'){
      banner.textContent='Rental data freshness could not be verified. Treat listings as provisional until a fresh verification completes.';
    }else{
      banner.textContent=`Latest validation is not decision-ready${lastRefresh?` (data refreshed ${lastRefresh})`:''}. Treat listings as provisional.`;
    }
  }
  async function run(){
    try{
      const [listingsResponse,qualityResponse]=await Promise.all([
        fetch('data/listings.json',{cache:'no-store'}),
        fetch('data/quality-report.json',{cache:'no-store'})
      ]);
      if(!listingsResponse.ok||!qualityResponse.ok)throw new Error('freshness endpoints unavailable');
      const listings=await listingsResponse.json(),quality=await qualityResponse.json();
      const lastRefresh=listings?.meta?.lastAutomatedRefresh||quality?.readinessChecks?.latestDataAt||quality?.generatedAt||null;
      apply(evaluate(lastRefresh),quality?.decisionReady===true,lastRefresh);
    }catch{
      apply({fresh:false,state:'unknown',ageHours:null},false,null);
    }
  }
  window.RentalFreshness={MAX_AGE_MS,evaluate,run};
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',run,{once:true});else run();
})();
