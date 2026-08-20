import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { chromium } from 'playwright';

const DATA = path.join(process.cwd(), 'data');
const EVIDENCE = path.join(DATA, 'evidence');
const iso = new Date().toISOString();
const today = iso.slice(0, 10);
const read = async (p, d) => { try { return JSON.parse(await fs.readFile(p, 'utf8')); } catch { return d; } };
const write = async (p, x) => { await fs.mkdir(path.dirname(p), { recursive: true }); await fs.writeFile(p, JSON.stringify(x, null, 2) + '\n'); };
const norm = s => (s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const hash = s => crypto.createHash('sha1').update(s).digest('hex').slice(0, 12);
const unitToken = s => {
  const v = String(s || '').trim().replace(/^#/, '');
  return /^(?=[A-Za-z0-9-]*\d)[A-Za-z0-9-]{1,12}$/.test(v) ? v : null;
};

function objects(ld) {
  const out = [];
  const walk = x => { if (!x) return; if (Array.isArray(x)) return x.forEach(walk); if (typeof x !== 'object') return; out.push(x); if (x['@graph']) walk(x['@graph']); };
  ld.forEach(walk); return out;
}
function money(v) { const n = Number(String(v ?? '').replace(/[^0-9.]/g, '')); return n >= 2500 && n <= 12000 ? n : null; }
function orient(text) {
  const m = text.match(/\b(northeast|northwest|southeast|southwest|north|south|east|west)[- ]facing\b/i)?.[1]?.toLowerCase();
  return ({northeast:'NE',northwest:'NW',southeast:'SE',southwest:'SW',north:'N',south:'S',east:'E',west:'W'})[m] || null;
}
function extract(ld, text, url) {
  const all = objects(ld);
  const product = all.find(x => x['@type'] === 'Product' && x.offers);
  const home = all.find(x => ['Apartment','SingleFamilyResidence','Residence','House','Accommodation'].includes(x['@type']));
  const a = home?.address || product?.address || {};
  const street = a.streetAddress || '';
  if (!street) return null;
  const address = `${street}, ${a.addressLocality || 'Vancouver'}, ${a.addressRegion || 'BC'}${a.postalCode ? ` ${a.postalCode}` : ''}`;
  const desc = [product?.description, home?.description, text].filter(Boolean).join('\n');
  const offer = Array.isArray(product?.offers) ? product.offers[0] : product?.offers;
  const rent = money(offer?.lowPrice) || money(offer?.price) || money(offer?.highPrice);
  const bedrooms = Number(desc.match(/\b([1-5](?:\.5)?)\s*(?:bedrooms?|beds?|br)\b/i)?.[1] || 0) || null;
  const bathrooms = Number(desc.match(/\b([1-5](?:\.5)?)\s*(?:bathrooms?|baths?|ba)\b/i)?.[1] || 0) || null;
  const sqft = Number(String(home?.floorSize || '').match(/([0-9]{3,4})/)?.[1] || desc.match(/\b([7-9][0-9]{2}|1[0-9]{3}|2[0-9]{3})\s*(?:sq\.?\s*ft|sqft|sqt|ft²|square feet)\b/i)?.[1] || 0) || null;
  const addrUnit = street.match(/^(?:#|unit\s*)?((?=[A-Za-z0-9-]*\d)[A-Za-z0-9-]{1,12})\s*[-–]\s*\d{3,5}\b/i)?.[1];
  const textUnit = desc.match(/\b(?:unit|suite|#)\s*((?=[A-Za-z0-9-]*\d)[A-Za-z0-9-]{1,12})\b/i)?.[1];
  const unit = unitToken(addrUnit) || unitToken(textUnit);
  const geo = home?.geo || all.find(x => x.geo)?.geo;
  const lat = Number(geo?.latitude), lng = Number(geo?.longitude);
  const exactGeo = Number.isFinite(lat) && Number.isFinite(lng) && lat > 49.19 && lat < 49.33 && lng > -123.30 && lng < -123.02 ? {lat,lng} : null;
  const images = [];
  const add = x => { const u = typeof x === 'string' ? x : x?.contentUrl || x?.url; if (/^https?:/i.test(u || '') && !images.includes(u)) images.push(u); };
  all.forEach(x => Array.isArray(x.image) ? x.image.forEach(add) : add(x.image));
  const live = /currently on market|check availability|request tour|for rent/i.test(text) && !/gone too soon|no longer available|this rental is unavailable|listing is inactive|currently off market/i.test(text);
  return {url,address,unit,rent,bedrooms,bathrooms,sqft,exactGeo,images:images.slice(0,16),live,description:desc.slice(0,6000),orientation:orient(desc),ac:/air conditioning|air conditioned|central a\/c|central ac/i.test(desc)?true:null,parking:/assigned parking|parking included|parking spot|one parking|1 parking/i.test(desc)?true:null,petFriendly:home?.petsAllowed===true||/pet friendly|pets allowed/i.test(desc)?true:null,balcony:/balcony|private patio|patio/i.test(desc)?true:null,largeWindows:/large windows|floor.to.ceiling windows|sun.drenched|naturally bright/i.test(desc)?true:null,modernInterior:/miele|fisher\s*&\s*paykel|caesarstone|quartz|renovated|waterfall island|modern/i.test(desc)?true:null};
}
function key(x) { return x.unit ? `${norm(x.address)}::unit:${norm(x.unit)}` : `${norm(x.address)}::url:${hash(x.url)}`; }
function listingKey(x) {
  const u = unitToken(String(x.unit || '').match(/(?=[A-Za-z0-9-]*\d)[A-Za-z0-9-]{1,12}/)?.[0]);
  if (u) return `${norm(x.address)}::unit:${norm(u)}`;
  if (/zumper\.com/i.test(x.url || '')) return `${norm(x.address)}::url:${hash(x.url)}`;
  return null;
}

const lp = path.join(DATA,'listings.json'), hp = path.join(DATA,'history.json'), sp = path.join(DATA,'live-sources.json'), ip = path.join(DATA,'image-sources.json'), cp = path.join(DATA,'candidates.json');
const payload = await read(lp,{meta:{},listings:[]}), history = await read(hp,{}), sources = await read(sp,{discovery:[],seedCandidates:[]}), imageSources = await read(ip,{}), oldCandidates = await read(cp,[]);
const browser = await chromium.launch({headless:true});
const context = await browser.newContext({locale:'en-CA',timezoneId:'America/Vancouver',viewport:{width:1440,height:1200},userAgent:'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/126 Safari/537.36'});
const page = await context.newPage(), urls = new Set();
for (const s of (sources.discovery||[]).filter(x=>x.adapter==='zumper-search')) {
  try { const r=await page.goto(s.url,{waitUntil:'domcontentloaded',timeout:45000}); if(!r||r.status()>=400) continue; await page.waitForTimeout(2500); for(const u of await page.locator('a').evaluateAll(as=>as.map(a=>a.href).filter(Boolean))) if(/^https:\/\/www\.zumper\.com\/(address|apartments-for-rent)\//i.test(u)&&!u.includes('/2-beds')) urls.add(u.split('#')[0]); } catch {}
}
for (const s of sources.seedCandidates||[]) if(/zumper\.com/i.test(s.url||'')) urls.add(s.url);
const found=[];
for(const url of [...urls].slice(0,100)) {
  try { const r=await page.goto(url,{waitUntil:'domcontentloaded',timeout:45000}); if(!r||r.status()>=400) continue; await page.waitForTimeout(1800); const text=await page.locator('body').innerText({timeout:10000}); const raws=await page.locator('script[type="application/ld+json"]').evaluateAll(ns=>ns.map(n=>n.textContent||'').slice(0,50)); const ld=[]; for(const raw of raws){try{ld.push(JSON.parse(raw))}catch{}} const x=extract(ld,text,url); if(!x||!x.live||x.bedrooms!==2||!x.rent||!x.exactGeo) continue; x.identityKey=key(x); found.push(x); await write(path.join(EVIDENCE,`zumper-v2-${hash(x.identityKey)}.json`),{checkedAt:iso,identityKey:x.identityKey,facts:x,jsonLd:ld.slice(0,8)}); } catch {}
}
await browser.close();

const map=new Map(); for(const x of payload.listings){const k=listingKey(x); if(k) map.set(k,x);}
for(const c of found){
  let x=map.get(c.identityKey); const id=x?.id||`zumper-${hash(c.identityKey)}`;
  if(!x){x={id,buildingName:null,unit:c.unit||null,address:c.address,neighborhood:/kitsilano/i.test(c.description)?'Kitsilano':/point grey/i.test(c.description)?'Point Grey':/dunbar/i.test(c.description)?'Dunbar':'Vancouver West',lat:c.exactGeo.lat,lng:c.exactGeo.lng,type:'condo',rent:c.rent,effectiveRent:null,bedrooms:2,bathrooms:c.bathrooms,sqft:c.sqft,ac:c.ac,parking:c.parking,petFriendly:c.petFriendly,buildingYear:null,orientation:c.orientation,balcony:c.balcony,largeWindows:c.largeWindows,modernInterior:c.modernInterior,source:'Zumper live detail',url:c.url,photoPageUrl:c.url,firstSeen:today,lastChecked:today,verifiedAt:iso,verificationLevel:'verified',verificationMethod:`AUTO-PUBLISHED from exact live Zumper detail; ${c.identityKey}`,availabilityStatus:'active',status:'new',priceDrop:false,dataNotes:c.unit?'Independent unit identity: address + unit.':'Independent inventory identity: address + exact detail URL (unit not public).'}; payload.listings.push(x); map.set(c.identityKey,x); history[id]=[{date:today,rent:c.rent,note:'NEW: live Zumper detail auto-published as independent inventory.'}];}
  else {const old=x.rent; x.lastChecked=today;x.verifiedAt=iso;x.availabilityStatus='active';x.verificationLevel='verified';x.lat=c.exactGeo.lat;x.lng=c.exactGeo.lng;if(old!==c.rent){x.rent=c.rent;x.status=c.rent<old?'price_drop':'unchanged';x.priceDrop=c.rent<old;(history[x.id]||=[]).push({date:today,rent:c.rent,note:`AUTO Zumper price update $${old} → $${c.rent}.`});}}
  if(c.images.length) imageSources[x.id]={referer:c.url,photoPageUrl:c.url,candidates:c.images.slice(0,8)};
}
const candidatesByUrl=new Map(oldCandidates.map(x=>[x.url,x])); for(const c of found)candidatesByUrl.set(c.url,{source:'Zumper',url:c.url,address:c.address,unit:c.unit,identityKey:c.identityKey,livePrice:c.rent,bedrooms:2,bathrooms:c.bathrooms,sqft:c.sqft,liveCheckedAt:iso,autoPublishResult:map.has(c.identityKey)?'published_or_updated':'candidate_only'});
payload.meta ||= {}; payload.meta.lastZumperUnitRefresh=iso; payload.meta.identityPolicy='Same-address inventory is never collapsed: address + unit is primary identity; address + exact detail URL is fallback when no unit number is public.';
await write(lp,payload);await write(hp,history);await write(ip,imageSources);await write(cp,[...candidatesByUrl.values()].slice(-500));
console.log(`Zumper per-unit v2: ${found.length} verified 2BR inventories.`);
