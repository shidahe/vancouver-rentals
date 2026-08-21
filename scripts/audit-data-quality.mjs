import fs from 'node:fs/promises';
import path from 'node:path';
const DATA=path.join(process.cwd(),'data');
const read=async(p,d)=>{try{return JSON.parse(await fs.readFile(p,'utf8'))}catch{return d}};
const write=async(p,x)=>fs.writeFile(p,JSON.stringify(x,null,2)+'\n');
const db=await read(path.join(DATA,'listings.json'),{listings:[]});
const now=Date.now();
const active=db.listings.filter(l=>(l.availabilityStatus||l.status)==='active'||(!l.availabilityStatus&&l.status!=='removed'&&l.status!=='needs_confirmation'));
const issues=[];
const keyMap=new Map();
const floorplanMap=new Map();
const canon=s=>String(s||'').toLowerCase().replace(/\bwest\b/g,'w').replace(/\beast\b/g,'e').replace(/\bstreet\b/g,'st').replace(/\bavenue\b/g,'ave').replace(/[^a-z0-9]+/g,' ').trim();
const actualUnit=s=>/^(?=[A-Za-z0-9-]*\d)[A-Za-z0-9-]{1,12}$/.test(String(s||'').replace(/^#/,'').trim());
const strongOfficialNegative=s=>['fully_leased','rented','unavailable','inactive','off_market','no_availability'].includes(String(s||'').toLowerCase());
for(const l of active){
  const age=l.verifiedAt?(now-new Date(l.verifiedAt).getTime())/86400000:999;
  if(age>2)issues.push({severity:'high',id:l.id,issue:'stale-verification',detail:`Last verified ${age.toFixed(1)} days ago`});
  if(!l.url||!/^https:\/\//.test(l.url))issues.push({severity:'high',id:l.id,issue:'missing-source-url'});
  if(!Number.isFinite(Number(l.rent))||Number(l.rent)<1500||Number(l.rent)>15000)issues.push({severity:'high',id:l.id,issue:'implausible-rent',detail:l.rent});
  if(!Number.isFinite(Number(l.lat))||!Number.isFinite(Number(l.lng)))issues.push({severity:'high',id:l.id,issue:'missing-coordinates'});
  if(l.bedrooms==null||l.bathrooms==null||l.sqft==null)issues.push({severity:'medium',id:l.id,issue:'missing-core-fields'});
  if(strongOfficialNegative(l.officialStatus))issues.push({severity:'high',id:l.id,issue:'active-despite-official-negative',detail:`officialStatus=${l.officialStatus}${l.officialStatusAuthority?` (${l.officialStatusAuthority})`:''}`});
  if(String(l.verificationLevel||'').toLowerCase()==='unverified')issues.push({severity:'high',id:l.id,issue:'active-but-unverified'});
  if(l.ac==null)issues.push({severity:'info',id:l.id,issue:'unknown-ac'});
  if(l.orientation==null)issues.push({severity:'info',id:l.id,issue:'unknown-orientation'});

  const street=canon(String(l.address||'').split(',')[0]);
  const unit=String(l.unit||'').replace(/^#/,'').trim();
  if(unit&&actualUnit(unit)){
    const k=`${street}::unit:${canon(unit)}`;
    if(keyMap.has(k))issues.push({severity:'high',id:l.id,otherId:keyMap.get(k),issue:'duplicate-address-unit'});else keyMap.set(k,l.id);
  }

  // Purpose-built inventory may intentionally use a floorplan label in `unit` when no public suite number exists.
  // Detect accidental duplicate publication using the same fallback identity used by the crawler: building/address + rent + sqft.
  if(l.type==='purpose-built'&&(!unit||!actualUnit(unit))){
    const fp=`${street}::building:${canon(l.buildingName)}::rent:${Number(l.rent)}::sqft:${Number(l.sqft)}`;
    if(floorplanMap.has(fp))issues.push({severity:'high',id:l.id,otherId:floorplanMap.get(fp),issue:'duplicate-purpose-built-floorplan'});else floorplanMap.set(fp,l.id);
  }
}
const high=issues.filter(x=>x.severity==='high'),medium=issues.filter(x=>x.severity==='medium');
const report={generatedAt:new Date().toISOString(),activeCount:active.length,decisionReady:high.length===0,highIssueCount:high.length,mediumIssueCount:medium.length,infoIssueCount:issues.length-high.length-medium.length,issues};
await write(path.join(DATA,'quality-report.json'),report);
console.log(`Quality audit: ${active.length} active, ${high.length} high issues, decisionReady=${report.decisionReady}`);
