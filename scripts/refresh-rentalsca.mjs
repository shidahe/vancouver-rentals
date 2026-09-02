import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { chromium } from 'playwright';
import { bedroomEligible } from './discovery-policy.mjs';

const DATA=path.join(process.cwd(),'data');
const EVIDENCE=path.join(DATA,'evidence');
const iso=new Date().toISOString();
const read=async(p,d)=>{try{return JSON.parse(await fs.readFile(p,'utf8'))}catch{return d}};
const write=async(p,x)=>{await fs.mkdir(path.dirname(p),{recursive:true});await fs.writeFile(p,JSON.stringify(x,null,2)+'\n')};
const hash=s=>crypto.createHash('sha1').update(s).digest('hex').slice(0,12);
const norm=s=>(s||'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
function canonStreet(s=''){return norm(s).replace(/\bwest\b/g,'w').replace(/\beast\b/g,'e').replace(/\bnorth\b/g,'n').replace(/\bsouth\b/g,'s').replace(/\bstreet\b/g,'st').replace(/\bavenue\b/g,'ave').replace(/\broad\b/g,'rd').replace(/\bplace\b/g,'pl').replace(/\bdrive\b/g,'dr').replace(/\bboulevard\b/g,'blvd');}
function unitToken(s){const v=String(s||'').trim().replace(/^#/,'');return /^(?=[A-Za-z0-9-]*\d)[A-Za-z0-9-]{1,12}$/.test(v)?v.toUpperCase():null;}
function splitAddr(s=''){let x=String(s).trim(),unit=null;let m=x.match(/^(.*?)(?:\s+|,\s*)(?:unit|suite|apt|#)\s*([A-Za-z0-9-]*\d[A-Za-z0-9-]*)\s*$/i);if(m&&unitToken(m[2])){x=m[1].trim();unit=unitToken(m[2]);}m=x.match(/^#?([A-Za-z0-9-]*\d[A-Za-z0-9-]*)\s*[-–]\s*(\d{3,5}\b.*)$/i);if(!unit&&m&&unitToken(m[1])){unit=unitToken(m[1]);x=m[2].trim();}return{street:x,unit};}
function slugifyAddress(s=''){return String(s).toLowerCase().replace(/\bavenue\b/g,'avenue').replace(/\bstreet\b/g,'street').replace(/\s*&\s*/g,'-and-').replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'');}
function detailUrlFromAddress(line=''){let s=String(line).replace(/,\s*Vancouver,\s*(?:BC|British Columbia).*$/i,'').trim();if(!/\d/.test(s))return null;return `https://rentals.ca/vancouver/${slugifyAddress(s)}`;}

function flat(ld){const out=[];const walk=x=>{if(!x)return;if(Array.isArray(x))return x.forEach(walk);if(typeof x!=='object')return;out.push(x);if(x['@graph'])walk(x['@graph'])};ld.forEach(walk);return out;}
function structuredAddress(ld){for(const x of flat(ld)){const a=x.address;if(a&&typeof a==='object'&&a.streetAddress){const sp=splitAddr(a.streetAddress);return{address:`${sp.street}, ${a.addressLocality||'Vancouver'}, ${a.addressRegion||'BC'}${a.postalCode?` ${a.postalCode}`:''}`,unit:sp.unit};}}return null;}
function geoFromLd(ld){for(const x of flat(ld)){const g=x.geo;if(g){const lat=Number(g.latitude),lng=Number(g.longitude);if(Number.isFinite(lat)&&Number.isFinite(lng))return{lat,lng};}}return null;}
function target(g){return !!g&&g.lat>=49.225&&g.lat<=49.286&&g.lng>=-123.215&&g.lng<=-123.135;}
function firstAddress(text){const lines=text.split('\n').map(x=>x.trim()).filter(Boolean);const s=lines.find(x=>/\d{3,5}.*(?:street|st\b|avenue|ave\b|broadway|road|rd\b|drive|dr\b|place|pl\b).*,\s*Vancouver,\s*(?:BC|British Columbia)/i.test(x));if(!s)return null;const first=s.split(',')[0],sp=splitAddr(first);return{address:`${sp.street}, Vancouver, BC`,unit:sp.unit};}
function money(s){const m=String(s||'').match(/\$\s*([2-9][0-9](?:,[0-9]{3}|[0-9]{2}))/);return m?Number(m[1].replace(',','')):null;}
function parseFloorplans(text){
  const out=[],lines=text.split('\n').map(x=>x.trim()).filter(Boolean);
  // Rentals.ca renders floor-plan rows as nearby text even when it does not explicitly print "Available".
  for(let i=0;i<lines.length;i++){
    if(!/(?:bedroom|bed\b)/i.test(lines[i])||lines[i].length>100)continue;
    const chunk=lines.slice(i,Math.min(lines.length,i+10)).join(' | ');
    const rent=money(chunk),bath=Number(chunk.match(/([1-5](?:\.5)?)\s*(?:Bath|\|)/i)?.[1]||0)||null;
    const sqft=Number(chunk.match(/([0-9]{3,4}(?:\.0)?)\s*(?:ft²|sq\.?\s*ft|sqft)/i)?.[1]||0)||null;
    const beds=Number(lines[i].match(/([1-5](?:\.5)?)\s*(?:Bedroom|Bed)/i)?.[1]||0)||null;
    if(!rent||!beds)continue;
    const label=lines[i].replace(/\s+/g,' ').trim();
    const unit=unitToken(chunk.match(/\b(?:unit|suite|#)\s*([A-Za-z0-9-]*\d[A-Za-z0-9-]*)\b/i)?.[1]);
    if(!out.some(x=>x.label===label&&x.unit===unit&&x.rent===rent&&x.sqft===sqft))out.push({label,unit,beds,baths:bath,sqft,rent,available:true});
  }
  return out.slice(0,30);
}
function parseSingle(text){return{rent:money(text.match(/(?:Rent|monthly rent)[\s\S]{0,80}\$\s*[0-9,]+/i)?.[0]||text),beds:Number(text.match(/\b([1-5](?:\.5)?)\s*(?:bedrooms?|beds?|BR)\b/i)?.[1]||0)||null,baths:Number(text.match(/\b([1-5](?:\.5)?)\s*(?:bathrooms?|baths?|BA)\b/i)?.[1]||0)||null,sqft:Number(text.match(/\b([0-9]{3,4})\s*(?:sq\.?\s*ft|ft²|square feet)\b/i)?.[1]||0)||null};}
function identity(address,unit,floorplan,url){const a=canonStreet(String(address||'').split(',')[0]);if(unit)return`${a}::unit:${norm(unit)}`;if(floorplan)return`${a}::floorplan:${norm(floorplan)}`;return`${a}::url:${hash(url)}`;}

const sources=await read(path.join(DATA,'live-sources.json'),{discovery:[]});
const browser=await chromium.launch({headless:true});
const context=await browser.newContext({locale:'en-CA',timezoneId:'America/Vancouver',viewport:{width:1440,height:1200},userAgent:'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/126 Safari/537.36'});
const page=await context.newPage(),detailUrls=new Set(),sourceHealth={};
for(const s of (sources.discovery||[]).filter(x=>x.adapter==='rentalsca-search')){
  try{
    const r=await page.goto(s.url,{waitUntil:'domcontentloaded',timeout:45000}),status=r?.status()??null;sourceHealth[s.id]={checkedAt:iso,status,ok:!!r&&status<400,finalUrl:page.url()};if(!r||status>=400)continue;
    await page.waitForTimeout(2500);
    for(const u of await page.locator('a').evaluateAll(as=>as.map(a=>a.href).filter(Boolean))){if(!/^https:\/\/rentals\.ca\/vancouver\//i.test(u))continue;const clean=u.split('#')[0].split('?')[0];if(/\/(kitsilano|west-point-grey|arbutus-ridge|dunbar-southlands|quilchena)(?:\/|$)/i.test(clean))continue;if(/\/(2-bedrooms|apartments|condos|houses|rooms|pet-friendly|under-|all-)/i.test(clean))continue;detailUrls.add(clean);}
    // Some Rentals.ca result cards are JS-clickable rather than normal anchors. Recover them from visible address text.
    const bodyText=await page.locator('body').innerText();
    for(const line of bodyText.split('\n').map(x=>x.trim()).filter(Boolean)){
      if(!/,\s*Vancouver,\s*(?:BC|British Columbia)/i.test(line))continue;
      if(!/^\s*(?:[A-Za-z0-9#-]+\s+)?\d{3,5}\s+/i.test(line))continue;
      const u=detailUrlFromAddress(line);if(u)detailUrls.add(u);
    }
  }catch(e){sourceHealth[s.id]={checkedAt:iso,ok:false,error:String(e)}}
}
const pages=[],inventories=[];
for(const url of [...detailUrls].slice(0,160)){
  try{
    const r=await page.goto(url,{waitUntil:'domcontentloaded',timeout:45000});if(!r||r.status()>=400)continue;
    await page.waitForTimeout(1800);const text=await page.locator('body').innerText({timeout:10000});
    const raws=await page.locator('script[type="application/ld+json"]').evaluateAll(ns=>ns.map(n=>n.textContent||'').slice(0,50));const ld=[];for(const raw of raws){try{ld.push(JSON.parse(raw))}catch{}}
    const addr=structuredAddress(ld)||firstAddress(text),geo=geoFromLd(ld),active=!/no longer available|listing is inactive|this rental is unavailable|off market|gone too soon/i.test(text),floorplans=parseFloorplans(text).filter(x=>bedroomEligible(x.beds)),single=parseSingle(text);
    const pageItem={source:'Rentals.ca',url,address:addr?.address||null,addressUnit:addr?.unit||null,geo,targetArea:target(geo),active,floorplans,single,checkedAt:iso};pages.push(pageItem);
    if(active&&target(geo)&&addr?.address){
      if(floorplans.length){for(const f of floorplans)inventories.push({source:'Rentals.ca',url,address:addr.address,unit:f.unit||addr.unit||null,floorplan:f.label,identityKey:identity(addr.address,f.unit||addr.unit,f.label,url),rent:f.rent,bedrooms:f.beds,bathrooms:f.baths,sqft:f.sqft,geo,active:true,checkedAt:iso,publishable:false});}
      else if(bedroomEligible(single.beds)&&single.rent)inventories.push({source:'Rentals.ca',url,address:addr.address,unit:addr.unit||null,floorplan:null,identityKey:identity(addr.address,addr.unit,null,url),rent:single.rent,bedrooms:single.beds,bathrooms:single.baths,sqft:single.sqft,geo,active:true,checkedAt:iso,publishable:false});
    }
    await write(path.join(EVIDENCE,`rentalsca-${hash(url)}.json`),{checkedAt:iso,page:pageItem,jsonLd:ld.slice(0,8),textSample:text.slice(0,7000)});
  }catch{}
}
await browser.close();
await write(path.join(DATA,'rentalsca-candidates.json'),{refreshedAt:iso,mode:'candidate-only',sourceHealth,pages,inventories});
console.log(`Rentals.ca adapter: ${pages.length} pages, ${inventories.length} target-area 2BR+ unit/floorplan inventories.`);
