import fs from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';
import { isTargetWestsideCoordinate, parseRealtylinkCoordinateValues, parseRealtylinkRoomCount } from './realtylink-parser.mjs';
import { verifiedPhotoCandidates } from './listing-photo-candidates.mjs';
const DATA=path.join(process.cwd(),'data'),iso=new Date().toISOString();
const write=async(p,x)=>fs.writeFile(p,JSON.stringify(x,null,2)+'\n');
const browser=await chromium.launch({headless:true});
const ctx=await browser.newContext({
  locale:'en-CA',
  timezoneId:'America/Vancouver',
  viewport:{width:1440,height:1400},
  userAgent:'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
  extraHTTPHeaders:{'Accept-Language':'en-CA,en;q=0.9'}
});
const page=await ctx.newPage();
const cleanAddress=value=>String(value||'').replace(/\b(Street|Avenue|Road|Drive|Boulevard|Place)\s+\1\b/gi,'$1').trim();
const searchUrls=['https://realtylink.org/en/apartment~for-rent~vancouver','https://realtylink.org/en/townhouse~for-rent~vancouver','https://realtylink.org/en/house~for-rent~vancouver'];
const urls=new Set(),health=[];
for(const u of searchUrls){try{const r=await page.goto(u,{waitUntil:'domcontentloaded',timeout:45000});health.push({url:u,status:r?.status()??null,checkedAt:iso});if(!r||r.status()>=400)continue;await page.waitForTimeout(1500);for(const h of await page.locator('a').evaluateAll(as=>as.map(a=>a.href))){if(/realtylink\.org\/en\/(?:apartment|townhouse|house)~for-rent~vancouver\/\d+/i.test(h))urls.add(h.split('?')[0]);}}catch(e){health.push({url:u,error:String(e),checkedAt:iso})}}
const candidates=[];
for(const url of [...urls].slice(0,180)){try{const r=await page.goto(url,{waitUntil:'domcontentloaded',timeout:30000});if(!r||r.status()>=400)continue;await page.waitForTimeout(500);const t=await page.locator('body').innerText();const beds=parseRealtylinkRoomCount(t,'bedroom')||0;if(!beds||beds<2)continue;const rent=Number((t.match(/\$\s*([0-9,]+)\s*\/month/i)?.[1]||'').replace(/,/g,''))||null;const rawSqft=Number((t.match(/Floor Area\s*([0-9,]+)\s*sqft/i)?.[1]||'').replace(/,/g,''))||null;const sqft=rawSqft>=200&&rawSqft<=15000?rawSqft:null;const baths=parseRealtylinkRoomCount(t,'bathroom');const title=t.match(/(?:Apartment|Townhouse|House) for rent\s+([\s\S]{0,140}?),\s*(?:Kitsilano|Arbutus|Point Grey|Dunbar|Quilchena|Vancouver)/i)?.[1]?.trim()||null;const latitude=await page.locator('meta[itemprop="latitude"]').first().getAttribute('content');const longitude=await page.locator('meta[itemprop="longitude"]').first().getAttribute('content');const geo=parseRealtylinkCoordinateValues(latitude,longitude);const lat=geo?.lat??null,lng=geo?.lng??null;if(!isTargetWestsideCoordinate(geo)||!rent)continue;const rawAddress=(t.match(/##\s+([^\n]+),\s*(?:Kitsilano|Arbutus|Point Grey|Dunbar|Quilchena|Vancouver West|Vancouver)/i)?.[1]||title||'').trim();const unitMatch=rawAddress.match(/^(?:unit\s+)?([A-Za-z0-9-]+)\s+(?=\d{3,5}\b)/i);const unit=unitMatch?.[1]||null;const unitAddress=cleanAddress(unitMatch?rawAddress.slice(unitMatch[0].length):rawAddress);const parking=/Parking Spaces\s+[1-9]/i.test(t);const ac=/Cooling Features\s+Air Conditioning|\bair condition(?:ing|er)\b/i.test(t);const balcony=/Exterior Features\s+Balcony|\bbalcony\b/i.test(t);const mls=t.match(/MLS[^\n]*No\.\s*([A-Z0-9]+)/i)?.[1]||null;const rawImages=await page.locator('img,source').evaluateAll(nodes=>nodes.flatMap(node=>[node.currentSrc,node.src,node.getAttribute('data-src'),...(node.getAttribute('srcset')||'').split(',').map(x=>x.trim().split(/\s+/)[0])]));rawImages.push(await page.locator('meta[property="og:image"]').first().getAttribute('content'));const images=verifiedPhotoCandidates(rawImages.filter(x=>/media\.realtylink\.org\/images\/consumersite\/property\//i.test(x||'')));candidates.push({source:'Realtylink MLS',url,mls,address:unitAddress||null,unit,type:url.includes('townhouse~')?'townhouse':url.includes('house~')?'house':'condo',rent,bedrooms:beds,bathrooms:baths,sqft,lat,lng,geo:{lat,lng},images,targetArea:true,active:true,parking,ac,balcony,checkedAt:iso,publishable:false});}catch{}}
await browser.close();
await write(path.join(DATA,'realtylink-candidates.json'),{refreshedAt:iso,mode:'candidate-only',health,candidates});
console.log(`Realtylink: ${candidates.length} target-area live 2BR+ candidates.`);
