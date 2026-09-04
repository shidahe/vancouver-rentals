import fs from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';
import { verifiedPhotoCandidates } from './listing-photo-candidates.mjs';
import { structuredRentalInventories } from './priority-inventory-policy.mjs';

const DATA=path.join(process.cwd(),'data');
const read=async(p,d)=>{try{return JSON.parse(await fs.readFile(p,'utf8'))}catch{return d}};
const write=async(p,x)=>{await fs.writeFile(p,JSON.stringify(x,null,2)+'\n')};
const now=new Date().toISOString();
const day=now.slice(0,10);
const norm=s=>String(s||'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
const slug=s=>norm(s).replace(/\s+/g,'-');

const cfg=await read(path.join(DATA,'purpose-built-watch.json'),{buildings:[]});
const db=await read(path.join(DATA,'listings.json'),{meta:{},listings:[]});
const history=await read(path.join(DATA,'history.json'),{});
const imageSources=await read(path.join(DATA,'image-sources.json'),{});
const evidence=[];
const browser=await chromium.launch({headless:true});
const ctx=await browser.newContext({locale:'en-CA',timezoneId:'America/Vancouver',viewport:{width:1440,height:1600}});
const page=await ctx.newPage();

for(const b of cfg.buildings||[]){
  const urls=(b.urls&&b.urls.length?b.urls:[b.url]).filter(Boolean);
  const observations=[];
  for(const url of urls){
    let text='',status=null,error=null,images=[],jsonLd=[];
    try{
      const r=await page.goto(url,{waitUntil:'domcontentloaded',timeout:45000}); status=r?.status()??null;
      if(r&&status<400){
        await page.waitForTimeout(2200);
        text=await page.locator('body').innerText({timeout:12000});
        images=await page.evaluate(()=>[
          ...[...document.querySelectorAll('meta[property="og:image"],meta[name="twitter:image"]')].map(x=>x.content),
          ...[...document.images].map(x=>x.currentSrc||x.src)
        ].filter(Boolean).map(x=>{try{return new URL(x,location.href).href}catch{return null}}).filter(Boolean));
        const rawJsonLd=await page.locator('script[type="application/ld+json"]').evaluateAll(nodes=>nodes.map(node=>node.textContent||'').slice(0,50));
        for(const raw of rawJsonLd){try{jsonLd.push(JSON.parse(raw))}catch{}}
      }
    }catch(e){error=String(e)}
    const usable=!!text&&status!==401&&status!==403&&status!==429&&!(status>=500);
    observations.push({url,checkedAt:now,httpStatus:status,usable,error,text,images,jsonLd});
  }

  const buildingEvidence={building:b.name,checkedAt:now,observations:observations.map(o=>({url:o.url,httpStatus:o.httpStatus,usable:o.usable,error:o.error})),inventories:[]};
  for(const inv of b.inventories||[]){
    const sourceMatches=[];
    for(const obs of observations){
      const lower=obs.text.toLowerCase();
      const structuredMatch=structuredRentalInventories(obs.jsonLd).some(row=>
        row.bedrooms===Number(inv.bedrooms)&&row.rent===Number(inv.rent)&&Math.abs(row.sqft-Number(inv.sqft))<=5
      );
      const required=structuredMatch||(inv.requiredSignals||[]).every(x=>lower.includes(String(x).toLowerCase()));
      const availability=(inv.availabilitySignals||[]).some(x=>lower.includes(String(x).toLowerCase()));
      const fullyLeased=/fully leased/i.test(obs.text);
      const verified=obs.usable&&required&&availability&&!fullyLeased;
      sourceMatches.push({url:obs.url,httpStatus:obs.httpStatus,usable:obs.usable,structuredMatch,requiredMatched:required,availabilityMatched:availability,fullyLeased,verified});
    }
    const verifiedSource=sourceMatches.find(x=>x.verified);
    const verified=!!verifiedSource;
    buildingEvidence.inventories.push({...inv,verified,verifiedSource:verifiedSource?.url||null,sourceMatches});

    let listing=db.listings.find(l=>
      (inv.unit&&String(l.unit||'').replace(/^#/,'').startsWith(String(inv.unit))&&norm(l.buildingName||'').includes(norm(b.name))) ||
      (norm(l.buildingName||'')===norm(b.name)&&Number(l.rent)===Number(inv.rent)&&Math.abs(Number(l.sqft||0)-Number(inv.sqft))<=5)
    );

    // A building/multi-unit page saying that some apartment is available is not enough to keep a
    // specific watched unit/floorplan active. If no fallback source contains the exact configured
    // rent + sqft identity anchors and an availability signal, fail closed until exact inventory
    // evidence returns. This prevents stale units from surviving because another unit in the same
    // building remains available.
    if(!verified){
      if(listing&&listing.availabilityStatus==='active'){
        listing.availabilityStatus='needs_confirmation';
        listing.status='corrected';
        listing.lastChecked=day;
        listing.verificationLevel='unverified';
        listing.verificationMethod='Exact purpose-built unit/floorplan inventory was not confirmed on any usable fallback source in the latest refresh.';
        const note='NEEDS CONFIRMATION: latest purpose-built fallback sources did not confirm the exact configured rent + sqft inventory row.';
        history[listing.id] ||= [];
        if(!history[listing.id].some(h=>h.date===day&&h.note===note)) history[listing.id].push({date:day,rent:listing.rent,note});
      }
      continue;
    }

    if(!listing){
      const id=`${slug(b.name)}-${inv.unit?`unit-${slug(inv.unit)}`:`floorplan-${slug(inv.key)}`}`;
      listing={
        id,buildingName:b.name,unit:inv.unit||inv.label,address:b.address,neighborhood:b.neighborhood,type:'purpose-built',
        rent:inv.rent,effectiveRent:null,bedrooms:inv.bedrooms,bathrooms:inv.bathrooms,sqft:inv.sqft,
        ac:b.ac??null,parking:b.parking??null,petFriendly:b.petFriendly??null,buildingYear:b.buildingYear??null,
        orientation:null,balcony:b.balcony??null,largeWindows:b.largeWindows??null,modernInterior:b.modernInterior??null,
        lat:b.lat,lng:b.lng,source:`${b.name} live inventory`,url:verifiedSource.url,status:'new',availabilityStatus:'active',
        firstSeen:day,lastChecked:day,verifiedAt:now,verificationLevel:'primary-live',verificationMethod:`Exact floorplan/unit inventory confirmed on ${verifiedSource.url}`,
        dataNotes:inv.unit?`Live purpose-built inventory; unit ${inv.unit}.`:`Live purpose-built floorplan inventory; public unit number not exposed. Tracked independently by floorplan + rent + sqft.`
      };
      db.listings.push(listing);
      history[id]=history[id]||[];history[id].push({date:day,rent:inv.rent,note:`First seen in live purpose-built inventory via ${verifiedSource.url}`});
    }else{
      if(Number(listing.rent)!==Number(inv.rent)){
        history[listing.id]=history[listing.id]||[];history[listing.id].push({date:day,rent:inv.rent,note:`Live purpose-built inventory price update from ${listing.rent}`});
        listing.priceDrop=Number(inv.rent)<Number(listing.rent);listing.rent=inv.rent;
      }
      Object.assign(listing,{availabilityStatus:'active',lastChecked:day,verifiedAt:now,verificationLevel:'primary-live',verificationMethod:`Exact floorplan/unit inventory confirmed on ${verifiedSource.url}`});
    }

    const verifiedObservation=observations.find(x=>x.url===verifiedSource.url);
    const photoCandidates=verifiedPhotoCandidates(verifiedObservation?.images||[]);
    if(photoCandidates.length){
      imageSources[listing.id]={referer:verifiedSource.url,photoPageUrl:verifiedSource.url,candidates:photoCandidates};
    }
  }
  evidence.push(buildingEvidence);
}
await browser.close();
db.meta.lastPurposeBuiltRefresh=now;
db.meta.purposeBuiltPolicy='Purpose-built buildings are expanded into independent unit/floorplan inventory. Exact unit is preferred; when a public unit number is absent, floorplan + rent + sqft is a temporary independent inventory identity. Multiple independent live source URLs are tried so one blocked marketplace cannot hide inventory. Building-level leasing language alone never creates or preserves a listing: watched inventory without an exact current match is hidden as needs_confirmation until exact evidence returns.';
await write(path.join(DATA,'purpose-built-status.json'),{refreshedAt:now,buildings:evidence});
await write(path.join(DATA,'listings.json'),db);
await write(path.join(DATA,'history.json'),history);
await write(path.join(DATA,'image-sources.json'),imageSources);
console.log(`Purpose-built verifier checked ${evidence.length} buildings across fallback sources.`);
