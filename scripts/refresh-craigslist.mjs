import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { chromium } from 'playwright';
import { extractCraigslistDetailUrls, normalizeCraigslistDetailUrl, parseCraigslistSearchCard } from './craigslist-parser.mjs';
import { isTargetRentalAreaText, listingScopeEligible } from './discovery-policy.mjs';

const DATA=path.join(process.cwd(),'data');
const EVIDENCE=path.join(DATA,'evidence');
const iso=new Date().toISOString();
const read=async(p,d)=>{try{return JSON.parse(await fs.readFile(p,'utf8'))}catch{return d}};
const write=async(p,x)=>{await fs.mkdir(path.dirname(p),{recursive:true});await fs.writeFile(p,JSON.stringify(x,null,2)+'\n')};
const hash=s=>crypto.createHash('sha1').update(s).digest('hex').slice(0,12);
const targetGeo=g=>!!g&&g.lat>=49.225&&g.lat<=49.286&&g.lng>=-123.215&&g.lng<=-123.135;
const targetAreaText=s=>isTargetRentalAreaText(s)&&/\b(?:kitsilano|arbutus|point\s+grey|dunbar|west\s+point\s+grey|mackenzie\s+heights|shaughnessy|kerrisdale|southlands|quilchena|musqueam|university\s+endowment\s+lands|(?:w|west)\s+\d+(?:st|nd|rd|th)?\s+(?:ave|avenue|street|st))\b/i.test(String(s||''));

const searches=[
  ['kitsilano','https://vancouver.craigslist.org/search/van/apa?min_bedrooms=2&query=kitsilano'],
  ['arbutus','https://vancouver.craigslist.org/search/van/apa?min_bedrooms=2&query=arbutus'],
  ['point-grey','https://vancouver.craigslist.org/search/van/apa?min_bedrooms=2&query=point%20grey'],
  ['dunbar','https://vancouver.craigslist.org/search/van/apa?min_bedrooms=2&query=dunbar']
];

const browser=await chromium.launch({headless:true});
const context=await browser.newContext({locale:'en-CA',timezoneId:'America/Vancouver',viewport:{width:1440,height:1200},userAgent:'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/126 Safari/537.36'});
const page=await context.newPage();
const sourceHealth={},urls=new Set(),rawCards=[];
for(const [id,url] of searches){
  try{
    const r=await page.goto(url,{waitUntil:'domcontentloaded',timeout:45000}),status=r?.status()??null;
    sourceHealth[id]={checkedAt:iso,status,ok:!!r&&status<400,finalUrl:page.url()};
    if(!r||status>=400)continue;
    await page.waitForTimeout(1500);
    const links=await page.locator('a').evaluateAll(as=>as.map(a=>a.getAttribute('href')||a.href).filter(Boolean));
    const structure=await page.evaluate(()=>{
      const resultNodes=[...document.querySelectorAll('.cl-search-result, .result-row, li.cl-static-search-result, [data-pid]')];
      const postIds=[...new Set(resultNodes.map(n=>n.getAttribute('data-pid')).filter(Boolean))];
      const samples=[...new Set([...document.querySelectorAll('a')].map(a=>a.getAttribute('href')).filter(Boolean).map(raw=>{
        try{const u=new URL(raw,location.href);return `${u.hostname}${u.pathname}`;}catch{return null;}
      }).filter(Boolean))].slice(0,12);
      const cards=resultNodes.map(node=>{
        const anchors=[...node.querySelectorAll('a[href]')];
        const anchor=anchors.find(a=>/\/view\/d\/|\/apa\/d\//i.test(a.getAttribute('href')||a.href))||anchors[0];
        const geoNode=node.matches('[data-latitude][data-longitude]')?node:node.querySelector('[data-latitude][data-longitude]');
        const titleNode=node.querySelector('.titlestring, .title, [class*="title"]');
        const locationNode=node.querySelector('.location, .result-hood, [class*="location"]');
        const image=node.querySelector('img');
        const time=node.querySelector('time[datetime]');
        return {
          href:anchor?.getAttribute('href')||anchor?.href||null,
          dataPid:node.getAttribute('data-pid'),
          title:titleNode?.textContent||anchor?.textContent||null,
          text:node.innerText||node.textContent||'',
          location:locationNode?.textContent||null,
          latitude:geoNode?.getAttribute('data-latitude'),
          longitude:geoNode?.getAttribute('data-longitude'),
          image:image?.currentSrc||image?.src||null,
          datetime:time?.getAttribute('datetime')||null
        };
      });
      return {resultContainerCount:resultNodes.length,postIdCount:postIds.length,hrefShapeSamples:samples,cards};
    });
    let acceptedLinks=0;
    for(const u of links){const detail=normalizeCraigslistDetailUrl(u,page.url());if(detail){urls.add(detail);acceptedLinks++;}}
    const embeddedLinks=extractCraigslistDetailUrls(await page.content(),page.url());
    for(const detail of embeddedLinks)urls.add(detail);
    sourceHealth[id].anchorCount=links.length;
    sourceHealth[id].detailLinkCount=acceptedLinks;
    sourceHealth[id].embeddedDetailLinkCount=embeddedLinks.length;
    rawCards.push(...structure.cards.map(card=>({...card,queryId:id,baseUrl:page.url()})));
    delete structure.cards;
    Object.assign(sourceHealth[id],structure);
    sourceHealth[id].title=await page.title();
  }catch(e){sourceHealth[id]={checkedAt:iso,ok:false,error:String(e)}}
}

const candidates=[],seenCards=new Set();
const diagnostics={discoveredDetailUrls:urls.size,searchCards:rawCards.length,uniqueSearchCards:0,missingRentOrBedrooms:0,outOfScope:0,outOfArea:0,accepted:0,detailChecks:0,errors:0};
for(const raw of rawCards){
  try{
    const parsed=parseCraigslistSearchCard(raw,raw.baseUrl);
    if(!parsed)continue;
    const identity=parsed.postId||hash(parsed.url);
    if(seenCards.has(identity))continue;
    seenCards.add(identity);diagnostics.uniqueSearchCards++;
    if(!parsed.rent||!parsed.bedrooms){diagnostics.missingRentOrBedrooms++;continue;}
    if(!listingScopeEligible({rent:parsed.rent,bedrooms:parsed.bedrooms},parsed.text)){diagnostics.outOfScope++;continue;}
    const inArea=parsed.geo?targetGeo(parsed.geo):targetAreaText([parsed.title,parsed.text,parsed.location].filter(Boolean).join('\n'));
    if(!inArea){diagnostics.outOfArea++;continue;}
    const addressLine=parsed.text.split('\n').map(x=>x.trim()).find(x=>/\bVancouver,?\s*(?:BC)?\b/i.test(x)&&(/\d/.test(x)||targetAreaText(x)))||parsed.location;
    const c={source:'Craigslist',postId:identity,url:parsed.url,title:parsed.title,address:addressLine||null,identityKey:`craigslist::post:${identity}`,rent:parsed.rent,bedrooms:parsed.bedrooms,bathrooms:parsed.bathrooms,sqft:parsed.sqft,geo:parsed.geo,targetArea:true,active:true,postedOrUpdatedAt:parsed.postedOrUpdatedAt,checkedAt:iso,images:parsed.image?[parsed.image]:[],publishable:false,evidenceKind:'current_search_result_card',queryIds:[raw.queryId]};
    candidates.push(c);diagnostics.accepted++;await write(path.join(EVIDENCE,`craigslist-${identity}.json`),{checkedAt:iso,c,cardText:parsed.text.slice(0,3000)});
  }catch{diagnostics.errors++;}
}
await browser.close();
await write(path.join(DATA,'craigslist-candidates.json'),{refreshedAt:iso,mode:'candidate-only',sourceHealth,diagnostics,candidates});
console.log(`Craigslist adapter: ${candidates.length} live recent target-area 2BR+ candidates; ${urls.size} detail URLs discovered.`);
