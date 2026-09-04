import fs from 'node:fs/promises';
import path from 'node:path';
import { bedroomEligible, isHouseShareText, rentEligible } from './discovery-policy.mjs';

const DATA=path.join(process.cwd(),'data');
const EVIDENCE=path.join(DATA,'evidence');
const read=async(p,d)=>{try{return JSON.parse(await fs.readFile(p,'utf8'))}catch{return d}};
const write=(p,x)=>fs.writeFile(p,JSON.stringify(x,null,2)+'\n');
const db=await read(path.join(DATA,'listings.json'),{meta:{},listings:[]});
const history=await read(path.join(DATA,'history.json'),{});
const today=new Date().toISOString().slice(0,10);
const files=await fs.readdir(EVIDENCE).catch(()=>[]);
const evidenceCache=new Map();

function focusedEvidence(value){
  const parts=[];
  const visit=item=>{
    if(!item)return;
    if(Array.isArray(item)){for(const child of item)visit(child);return;}
    if(typeof item!=='object')return;
    for(const [key,child] of Object.entries(item)){
      if(key.toLowerCase()==='description'&&typeof child==='string')parts.push(child);
      else if(key==='bodyText'&&typeof child==='string'){
        const description=child.match(/\bDescription\s*\n([\s\S]*?)\nMLS(?:®|©)?\s*(?:No\.)?/i)?.[1];
        if(description)parts.push(description);
      }else visit(child);
    }
  };
  visit(value);
  return parts.join('\n');
}

async function evidenceText(listing){
  const suffix=String(listing.id||'').replace(/^zumper-/,'');
  const names=files.filter(name=>name===`${listing.id}.json`||
    (/^zumper-/.test(listing.id||'')&&new RegExp(`^zumper(?:-v\\d+)?-${suffix}\\.json$`).test(name)));
  const parts=[];
  for(const name of names){
    if(!evidenceCache.has(name))evidenceCache.set(name,await read(path.join(EVIDENCE,name),{}));
    parts.push(focusedEvidence(evidenceCache.get(name)));
  }
  return parts.join('\n');
}

const excluded=[];
for(const listing of db.listings||[]){
  const text=await evidenceText(listing);
  let reason=null;
  if(!rentEligible(listing.rent))reason='monthly rent below CAD $3,500';
  else if(!bedroomEligible(listing.bedrooms))reason=Number(listing.bedrooms)>=5?'five or more bedrooms':'outside the 2–4 bedroom scope';
  else if(listing.rentalScope==='shared_house'||isHouseShareText(text))reason='house share or separately rented portion of a house';
  if(!reason)continue;
  const wasActive=listing.availabilityStatus==='active';
  if(listing.availabilityStatus==='excluded'&&listing.scopeExclusionReason===reason){
    excluded.push({id:listing.id,reason,wasActive:false});
    continue;
  }
  listing.availabilityStatus='excluded';
  listing.status='excluded';
  listing.lastChecked=today;
  listing.verificationLevel='excluded_by_scope';
  listing.verificationMethod=`Excluded by user search scope: ${reason}.`;
  listing.scopeExclusionReason=reason;
  excluded.push({id:listing.id,reason,wasActive});
  if(wasActive){
    history[listing.id]||=[];
    const note=`EXCLUDED: ${reason}.`;
    if(!history[listing.id].some(x=>x.date===today&&x.note===note))history[listing.id].push({date:today,rent:listing.rent,note});
  }
}

db.meta||={};
db.meta.searchScope='Only CAD $3,500+ entire-home rentals with 2–4 bedrooms are eligible. House shares and separately rented portions of houses are excluded.';
await write(path.join(DATA,'listings.json'),db);
await write(path.join(DATA,'history.json'),history);
const countsByReason={};
for(const item of excluded)countsByReason[item.reason]=(countsByReason[item.reason]||0)+1;
const exclusionEventsToday=Object.values(history).flat().filter(x=>x.date===today&&/^EXCLUDED:/.test(x.note||'')).length;
await write(path.join(DATA,'scope-filter-report.json'),{generatedAt:new Date().toISOString(),policy:db.meta.searchScope,activeCount:(db.listings||[]).filter(x=>x.availabilityStatus==='active').length,excludedCount:excluded.length,exclusionEventsToday,countsByReason,excluded});
console.log(`Listing scope: ${excluded.filter(x=>x.wasActive).length} active listings excluded; ${excluded.length} total records outside scope.`);
