import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { chromium } from 'playwright';

const DATA=path.join(process.cwd(),'data');
const EVIDENCE=path.join(DATA,'evidence');
const iso=new Date().toISOString();
const read=async(p,d)=>{try{return JSON.parse(await fs.readFile(p,'utf8'))}catch{return d}};
const write=async(p,x)=>{await fs.mkdir(path.dirname(p),{recursive:true});await fs.writeFile(p,JSON.stringify(x,null,2)+'\n')};
const hash=s=>crypto.createHash('sha1').update(s).digest('hex').slice(0,12);

function flat(ld){const out=[];const walk=x=>{if(!x)return;if(Array.isArray(x))return x.forEach(walk);if(typeof x!=='object')return;out.push(x);if(x['@graph'])walk(x['@graph'])};ld.forEach(walk);return out;}
function structuredAddress(ld){for(const x of flat(ld)){const a=x.address;if(a&&typeof a==='object'&&a.streetAddress){return `${a.streetAddress}, ${a.addressLocality||'Vancouver'}, ${a.addressRegion||'BC'}${a.postalCode?` ${a.postalCode}`:''}`;}}return null;}
function geoFromLd(ld){for(const x of flat(ld)){const g=x.geo;if(g){const lat=Number(g.latitude),lng=Number(g.longitude);if(Number.isFinite(lat)&&Number.isFinite(lng))return{lat,lng};}}return null;}
function target(g){return !!g&&g.lat>=49.225&&g.lat<=49.286&&g.lng>=-123.215&&g.lng<=-123.135;}
function firstAddress(text){const lines=text.split('\n').map(x=>x.trim()).filter(Boolean);return lines.find(x=>/\d{3,5}.*(?:street|st\b|avenue|ave\b|broadway|road|rd\b|drive|dr\b|place|pl\b).*,\s*Vancouver,\s*BC/i.test(x))||null;}
function money(s){const m=String(s||'').match(/\$\s*([2-9][0-9](?:,[0-9]{3}|[0-9]{2}))/);return m?Number(m[1].replace(',','')):null;}
function parseFloorplans(text){
  const out=[];
  const lines=text.split('\n').map(x=>x.trim()).filter(Boolean);
  for(let i=0;i<lines.length;i++){
    if(!/(?:bedroom|bed\b)/i.test(lines[i])||lines[i].length>80)continue;
    const chunk=lines.slice(i,Math.min(lines.length,i+12)).join(' | ');
    const rent=money(chunk);
    const bath=Number(chunk.match(/([1-5](?:\.5)?)\s*Bath/i)?.[1]||0)||null;
    const sqft=Number(chunk.match(/([0-9]{3,4}(?:\.0)?)\s*ft²/i)?.[1]||0)||null;
    const beds=Number(lines[i].match(/([1-5](?:\.5)?)\s*(?:Bedroom|Bed)/i)?.[1]||0)||null;
    if(!rent||!beds)continue;
    if(!/Available/i.test(chunk))continue;
    const label=lines[i].replace(/\s+/g,' ').trim();
    if(!out.some(x=>x.label===label&&x.rent===rent&&x.sqft===sqft))out.push({label,beds,baths:bath,sqft,rent,available:true});
  }
  return out.slice(0,20);
}
function parseSingle(text){
  const rent=money(text.match(/(?:Rent|monthly rent)[\s\S]{0,80}\$\s*[0-9,]+/i)?.[0]||text);
  const beds=Number(text.match(/\b([1-5](?:\.5)?)\s*(?:bedrooms?|beds?|BR)\b/i)?.[1]||0)||null;
  const baths=Number(text.match(/\b([1-5](?:\.5)?)\s*(?:bathrooms?|baths?|BA)\b/i)?.[1]||0)||null;
  const sqft=Number(text.match(/\b([0-9]{3,4})\s*(?:sq\.?\s*ft|ft²|square feet)\b/i)?.[1]||0)||null;
  const unit=text.match(/(?:^|\n)\s*(?:unit|suite|#)?\s*([A-Za-z0-9-]*\d[A-Za-z0-9-]*)\s*[-–]\s*\d{3,5}\b/im)?.[1]||null;
  return{rent,beds,baths,sqft,unit};
}

const sources=await read(path.join(DATA,'live-sources.json'),{discovery:[]});
const browser=await chromium.launch({headless:true});
const context=await browser.newContext({locale:'en-CA',timezoneId:'America/Vancouver',viewport:{width:1440,height:1200},userAgent:'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/126 Safari/537.36'});
const page=await context.newPage();
const detailUrls=new Set();
const sourceHealth={};
for(const s of (sources.discovery||[]).filter(x=>x.adapter==='rentalsca-search')){
  try{
    const r=await page.goto(s.url,{waitUntil:'domcontentloaded',timeout:45000});
    const status=r?.status()??null; sourceHealth[s.id]={checkedAt:iso,status,ok:!!r&&status<400,finalUrl:page.url()};
    if(!r||status>=400)continue;
    await page.waitForTimeout(2500);
    const links=await page.locator('a').evaluateAll(as=>as.map(a=>a.href).filter(Boolean));
    for(const u of links){
      if(!/^https:\/\/rentals\.ca\/vancouver\//i.test(u))continue;
      const clean=u.split('#')[0].split('?')[0];
      if(/\/(kitsilano|west-point-grey|arbutus-ridge|dunbar-southlands|quilchena)(?:\/|$)/i.test(clean))continue;
      if(/\/(2-bedrooms|apartments|condos|houses|rooms|pet-friendly|under-|all-)/i.test(clean))continue;
      detailUrls.add(clean);
    }
  }catch(e){sourceHealth[s.id]={checkedAt:iso,ok:false,error:String(e)}}
}

const candidates=[];
for(const url of [...detailUrls].slice(0,100)){
  try{
    const r=await page.goto(url,{waitUntil:'domcontentloaded',timeout:45000}); if(!r||r.status()>=400)continue;
    await page.waitForTimeout(2200);
    const text=await page.locator('body').innerText({timeout:10000});
    if(/report listing/i.test(text)===false&&text.length<500)continue;
    const raws=await page.locator('script[type="application/ld+json"]').evaluateAll(ns=>ns.map(n=>n.textContent||'').slice(0,50));
    const ld=[];for(const raw of raws){try{ld.push(JSON.parse(raw))}catch{}}
    const address=structuredAddress(ld)||firstAddress(text);
    const geo=geoFromLd(ld);
    const floorplans=parseFloorplans(text).filter(x=>x.beds>=2&&x.beds<3.5);
    const single=parseSingle(text);
    const active=!/no longer available|listing is inactive|this rental is unavailable|off market|gone too soon/i.test(text);
    const item={source:'Rentals.ca',url,address,geo,targetArea:target(geo),active,floorplans,single,checkedAt:iso,textSample:text.slice(0,7000)};
    candidates.push(item);
    await write(path.join(EVIDENCE,`rentalsca-${hash(url)}.json`),{checkedAt:iso,...item,jsonLd:ld.slice(0,8)});
  }catch{}
}
await browser.close();
await write(path.join(DATA,'rentalsca-candidates.json'),{refreshedAt:iso,sourceHealth,candidates});
console.log(`Rentals.ca adapter: ${candidates.length} detail pages inspected; candidate-only mode.`);
