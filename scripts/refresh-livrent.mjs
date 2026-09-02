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
const targetWords=/\b(kitsilano|west point grey|point grey|arbutus(?: ridge)?|dunbar(?: southlands)?|quilchena)\b/i;
function flat(ld){const out=[];const walk=x=>{if(!x)return;if(Array.isArray(x))return x.forEach(walk);if(typeof x!=='object')return;out.push(x);if(x['@graph'])walk(x['@graph'])};ld.forEach(walk);return out;}
function addressFrom(ld,text){for(const x of flat(ld)){const a=x.address;if(a&&typeof a==='object'&&a.streetAddress)return`${a.streetAddress}, ${a.addressLocality||'Vancouver'}, ${a.addressRegion||'BC'}${a.postalCode?` ${a.postalCode}`:''}`;}const m=text.match(/(?:^|\n)\s*([^\n]{0,40}\d{3,5}[^\n]{0,60}),\s*Vancouver,\s*BC/im);return m?`${m[1].trim()}, Vancouver, BC`:null;}
function geoFrom(ld){for(const x of flat(ld)){const g=x.geo;if(g){const lat=Number(g.latitude),lng=Number(g.longitude);if(Number.isFinite(lat)&&Number.isFinite(lng))return{lat,lng};}}return null;}
function targetGeo(g){return !!g&&g.lat>=49.225&&g.lat<=49.286&&g.lng>=-123.215&&g.lng<=-123.135;}
function money(text){const vals=[...String(text||'').matchAll(/\$\s*([2-9][0-9](?:,[0-9]{3}|[0-9]{2}))/g)].map(m=>Number(m[1].replace(',',''))).filter(n=>n>=2500&&n<=12000);return vals[0]??null;}
function field(text,re){const m=text.match(re);return m?Number(m[1]):null;}
function unitFrom(address,text){const a=String(address||'').split(',')[0];let m=a.match(/^\s*([A-Za-z0-9-]*\d[A-Za-z0-9-]*)\s*[-–]\s*\d{3,5}\b/i);if(m)return m[1].toUpperCase();m=text.match(/\b(?:unit|suite|apt|#)\s*([A-Za-z0-9-]*\d[A-Za-z0-9-]*)\b/i);return m?m[1].toUpperCase():null;}
function identity(address,unit,url){const first=norm(String(address||'').split(',')[0]).replace(/\bwest\b/g,'w').replace(/\beast\b/g,'e').replace(/\bstreet\b/g,'st').replace(/\bavenue\b/g,'ave').replace(/\broad\b/g,'rd').replace(/\bplace\b/g,'pl');return unit?`${first}::unit:${norm(unit)}`:`${first}::url:${hash(url)}`;}

const sources=await read(path.join(DATA,'live-sources.json'),{discovery:[]});
const browser=await chromium.launch({headless:true});
const context=await browser.newContext({locale:'en-CA',timezoneId:'America/Vancouver',viewport:{width:1440,height:1200},userAgent:'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/126 Safari/537.36'});
const page=await context.newPage(),urls=new Set(),sourceHealth={};
for(const s of (sources.discovery||[]).filter(x=>x.adapter==='livrent-search')){try{const r=await page.goto(s.url,{waitUntil:'domcontentloaded',timeout:45000}),status=r?.status()??null;sourceHealth[s.id]={checkedAt:iso,status,ok:!!r&&status<400,finalUrl:page.url()};if(!r||status>=400)continue;await page.waitForTimeout(2500);for(const u of await page.locator('a').evaluateAll(as=>as.map(a=>a.href).filter(Boolean))){if(/^https:\/\/liv\.rent\/rental-listings\/detail\//i.test(u))urls.add(u.split('#')[0].split('?')[0]);}}catch(e){sourceHealth[s.id]={checkedAt:iso,ok:false,error:String(e)}}}
const candidates=[];
for(const url of [...urls].slice(0,120)){try{const r=await page.goto(url,{waitUntil:'domcontentloaded',timeout:45000});if(!r||r.status()>=400)continue;await page.waitForTimeout(1800);const text=await page.locator('body').innerText({timeout:10000});const raws=await page.locator('script[type="application/ld+json"]').evaluateAll(ns=>ns.map(n=>n.textContent||'').slice(0,50));const ld=[];for(const raw of raws){try{ld.push(JSON.parse(raw))}catch{}}const address=addressFrom(ld,text),geo=geoFrom(ld),rented=/marked as rented|\bRented\b|no longer accepting applications/i.test(text),beds=field(text,/\b([1-5](?:\.5)?)\s*Beds?\b/i)||field(text,/\b([1-5](?:\.5)?)\s*Bedrooms?\b/i),baths=field(text,/\b([1-5](?:\.5)?)\s*Baths?\b/i),sqft=field(text,/\b([0-9]{3,4})\s*ft²\b/i)||field(text,/\b([0-9]{3,4})\s*(?:sq\.?\s*ft|sqft)\b/i),rent=money(text),unit=unitFrom(address,text),target=targetGeo(geo)||targetWords.test(text),year=field(text,/Year Completed\s*\n?\s*(20\d{2}|19\d{2})/i),parking=/Parking\s*\n?\s*(?:Included|\$|Yes)/i.test(text),pets=/Pets\s*\n?\s*(?:Allowed|Allowed with restrictions)/i.test(text),ac=/air conditioning|air conditioned|central ac|central a\/c/i.test(text);if(!bedroomEligible(beds))continue;const item={source:'liv.rent',url,address,unit,identityKey:identity(address,unit,url),geo,targetArea:target,rented,active:!rented,rent,beds,baths,sqft,buildingYear:year,parking:parking||null,petFriendly:pets||null,ac:ac||null,checkedAt:iso,publishable:false};candidates.push(item);await write(path.join(EVIDENCE,`livrent-${hash(url)}.json`),{checkedAt:iso,...item,textSample:text.slice(0,7000),jsonLd:ld.slice(0,8)});}catch{}}
await browser.close();
await write(path.join(DATA,'livrent-candidates.json'),{refreshedAt:iso,mode:'candidate-only',sourceHealth,candidates});
console.log(`liv.rent adapter: ${candidates.length} 2BR+ detail pages inspected; rented status recorded explicitly.`);
