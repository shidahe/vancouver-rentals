import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { chromium } from 'playwright';

const DATA=path.join(process.cwd(),'data');
const EVIDENCE=path.join(DATA,'evidence');
const iso=new Date().toISOString();
const now=Date.now();
const read=async(p,d)=>{try{return JSON.parse(await fs.readFile(p,'utf8'))}catch{return d}};
const write=async(p,x)=>{await fs.mkdir(path.dirname(p),{recursive:true});await fs.writeFile(p,JSON.stringify(x,null,2)+'\n')};
const hash=s=>crypto.createHash('sha1').update(s).digest('hex').slice(0,12);
const norm=s=>(s||'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
const targetGeo=g=>!!g&&g.lat>=49.225&&g.lat<=49.286&&g.lng>=-123.215&&g.lng<=-123.135;
const money=s=>{const m=String(s||'').match(/\$\s*([2-9][0-9](?:,[0-9]{3}|[0-9]{2}))/);return m?Number(m[1].replace(',','')):null};
const num=(re,s)=>{const m=String(s||'').match(re);return m?Number(m[1]):null};
const dateFrom=s=>{const m=String(s||'').match(/(?:posted|updated):\s*(\d{4}-\d{2}-\d{2})/i);if(!m)return null;const t=Date.parse(m[1]+'T12:00:00Z');return Number.isFinite(t)?new Date(t).toISOString():null};

const searches=[
  ['kitsilano','https://vancouver.craigslist.org/search/van/apa?min_bedrooms=2&query=kitsilano'],
  ['arbutus','https://vancouver.craigslist.org/search/van/apa?min_bedrooms=2&query=arbutus'],
  ['point-grey','https://vancouver.craigslist.org/search/van/apa?min_bedrooms=2&query=point%20grey'],
  ['dunbar','https://vancouver.craigslist.org/search/van/apa?min_bedrooms=2&query=dunbar']
];

const browser=await chromium.launch({headless:true});
const context=await browser.newContext({locale:'en-CA',timezoneId:'America/Vancouver',viewport:{width:1440,height:1200},userAgent:'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/126 Safari/537.36'});
const page=await context.newPage();
const sourceHealth={},urls=new Set();
for(const [id,url] of searches){
  try{
    const r=await page.goto(url,{waitUntil:'domcontentloaded',timeout:45000}),status=r?.status()??null;
    sourceHealth[id]={checkedAt:iso,status,ok:!!r&&status<400,finalUrl:page.url()};
    if(!r||status>=400)continue;
    await page.waitForTimeout(1500);
    const links=await page.locator('a').evaluateAll(as=>as.map(a=>a.href).filter(Boolean));
    for(const u of links)if(/^https:\/\/vancouver\.craigslist\.org\/van\/apa\/d\/.+\/\d+\.html(?:$|\?)/i.test(u))urls.add(u.split('?')[0]);
  }catch(e){sourceHealth[id]={checkedAt:iso,ok:false,error:String(e)}}
}

const candidates=[];
for(const url of [...urls].slice(0,120)){
  try{
    const r=await page.goto(url,{waitUntil:'domcontentloaded',timeout:30000});if(!r||r.status()>=400)continue;
    await page.waitForTimeout(700);
    const text=await page.locator('body').innerText({timeout:10000});
    if(/this posting has been deleted by its author|this posting has expired|flagged for removal/i.test(text))continue;
    const title=(await page.locator('#titletextonly').count())?await page.locator('#titletextonly').innerText():await page.title();
    const rent=money((await page.locator('.price').count())?await page.locator('.price').first().innerText():title+'\n'+text);
    const bedrooms=num(/\b([1-5])BR\b/i,title+'\n'+text)??num(/\b([1-5])\s*bedrooms?\b/i,text);
    const bathrooms=num(/\b([1-5](?:\.5)?)Ba\b/i,text)??num(/\b([1-5](?:\.5)?)\s*bathrooms?\b/i,text);
    const sqft=num(/\b([0-9]{3,4})ft\^?\{?2\}?\b/i,title+'\n'+text)??num(/\b([0-9]{3,4})\s*(?:sq\.?\s*ft|sqft|square feet)\b/i,text);
    if(!bedrooms||bedrooms<2||!rent)continue;
    const mapEl=page.locator('[data-latitude][data-longitude]').first();
    let geo=null;if(await mapEl.count()){const a=await mapEl.evaluate(el=>({lat:Number(el.getAttribute('data-latitude')),lng:Number(el.getAttribute('data-longitude'))}));if(Number.isFinite(a.lat)&&Number.isFinite(a.lng))geo=a;}
    const addressLine=text.split('\n').map(x=>x.trim()).find(x=>/\bVancouver,\s*BC\b/i.test(x)&&(/\d/.test(x)||/Kitsilano|Arbutus|Point Grey|Dunbar/i.test(x)))||null;
    const postId=url.match(/\/(\d+)\.html$/)?.[1]||hash(url);
    const dated=[...text.matchAll(/(?:posted|updated):\s*(\d{4}-\d{2}-\d{2})/ig)].map(m=>Date.parse(m[1]+'T12:00:00Z')).filter(Number.isFinite);
    const latestDate=dated.length?Math.max(...dated):null;
    const recent=latestDate?now-latestDate<=45*86400000:true;
    const inArea=geo?targetGeo(geo):/kitsilano|arbutus|point grey|dunbar|west \d+(?:st|nd|rd|th)|w \d+(?:st|nd|rd|th)/i.test(text);
    if(!recent||!inArea)continue;
    const imgs=await page.locator('img').evaluateAll(ns=>ns.map(n=>n.src).filter(u=>/^https?:\/\//i.test(u)&&/images\.craigslist\.org/i.test(u))).catch(()=>[]);
    const c={source:'Craigslist',postId,url,title,address:addressLine,identityKey:`craigslist::post:${postId}`,rent,bedrooms,bathrooms,sqft,geo,targetArea:inArea,active:true,postedOrUpdatedAt:latestDate?new Date(latestDate).toISOString():null,checkedAt:iso,images:[...new Set(imgs)].slice(0,12),publishable:false};
    candidates.push(c);await write(path.join(EVIDENCE,`craigslist-${postId}.json`),{checkedAt:iso,c,textSample:text.slice(0,7000)});
  }catch{}
}
await browser.close();
await write(path.join(DATA,'craigslist-candidates.json'),{refreshedAt:iso,mode:'candidate-only',sourceHealth,candidates});
console.log(`Craigslist adapter: ${candidates.length} live recent target-area 2BR+ candidates.`);
