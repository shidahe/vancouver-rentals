import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';

const DATA=path.join(process.cwd(),'data');
const iso=new Date().toISOString(),today=iso.slice(0,10);
const read=async(p,d)=>{try{return JSON.parse(await fs.readFile(p,'utf8'))}catch{return d}};
const write=async(p,x)=>fs.writeFile(p,JSON.stringify(x,null,2)+'\n');
const norm=s=>(s||'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
const hash=s=>crypto.createHash('sha1').update(s).digest('hex').slice(0,12);
function street(s=''){return norm(String(s).split(',')[0]).replace(/\bwest\b/g,'w').replace(/\beast\b/g,'e').replace(/\bnorth\b/g,'n').replace(/\bsouth\b/g,'s').replace(/\bstreet\b/g,'st').replace(/\bavenue\b/g,'ave').replace(/\broad\b/g,'rd').replace(/\bplace\b/g,'pl').replace(/\bdrive\b/g,'dr').replace(/\bboulevard\b/g,'blvd').replace(/\bparkway\b/g,'pky');}
function unitToken(s){const v=String(s||'').trim().replace(/^#/,'').match(/(?=[A-Za-z0-9-]*\d)[A-Za-z0-9-]{1,12}/)?.[0];return v?v.toUpperCase():null;}
function listingUnit(x){const direct=unitToken(x.unit);if(direct)return direct;const a=String(x.address||'').split(',')[0];return unitToken(a.match(/(?:unit|suite|apt|#)\s*([A-Za-z0-9-]*\d[A-Za-z0-9-]*)/i)?.[1]);}
function key(address,unit,url,floorplan){const a=street(address);const u=unitToken(unit);if(u)return`${a}::unit:${norm(u)}`;if(floorplan)return`${a}::floorplan:${norm(floorplan)}`;return`${a}::url:${hash(url||'')}`;}
function candidateKey(c){return key(c.address,c.unit,c.url,c.floorplan);}
function sourceFamily(c){return /^zumper$/i.test(c.source)?'zumper':/^rentals\.ca$/i.test(c.source)?'rentalsca':/^liv\.rent$/i.test(c.source)?'livrent':norm(c.source);}
function usable(c){return !!c&&c.active!==false&&!c.rented&&c.targetArea!==false&&c.bedrooms===2&&Number(c.rent)>=2500&&Number(c.rent)<=12000&&!!c.address;}
function baths(c){const n=Number(c.bathrooms??c.baths);return Number.isFinite(n)?n:null;}
function sqft(c){const n=Number(c.sqft);return Number.isFinite(n)?n:null;}
function fingerprintCompatible(a,b){
  if(street(a.address)!==street(b.address))return false;
  if(unitToken(a.unit)||unitToken(b.unit))return false;
  if(Number(a.rent)!==Number(b.rent))return false;
  if(Number(a.bedrooms)!==Number(b.bedrooms))return false;
  const ab=baths(a),bb=baths(b),as=sqft(a),bs=sqft(b);
  if(ab==null||bb==null||ab!==bb||as==null||bs==null||Math.abs(as-bs)>5)return false;
  return sourceFamily(a)!==sourceFamily(b);
}

const lp=path.join(DATA,'listings.json'),hp=path.join(DATA,'history.json');
const payload=await read(lp,{meta:{},listings:[]}),history=await read(hp,{});
const zumper=await read(path.join(DATA,'candidates.json'),[]);
const rentals=await read(path.join(DATA,'rentalsca-candidates.json'),{inventories:[]});
const liv=await read(path.join(DATA,'livrent-candidates.json'),{candidates:[]});
const all=[];
for(const c of zumper)all.push({...c,source:c.source||'Zumper',active:true,targetArea:true,bedrooms:c.bedrooms||2,rent:c.livePrice??c.rent});
for(const c of rentals.inventories||[])all.push(c);
for(const c of liv.candidates||[])all.push({...c,bedrooms:c.beds??c.bedrooms,rent:c.rent});

const groups=new Map();
for(const c of all){if(!usable(c))continue;const k=candidateKey(c);if(!groups.has(k))groups.set(k,[]);groups.get(k).push(c);}
const listingByKey=new Map();
for(const x of payload.listings){const k=key(x.address,listingUnit(x),x.url,null);if(!listingByKey.has(k)||listingByKey.get(k).source==='Zumper live detail')listingByKey.set(k,x);}
const state={refreshedAt:iso,groups:[],promoted:[],crossVerified:[],fingerprintCrossVerified:[],negativeMatches:[]};

for(const [k,items] of groups){
  const families=[...new Set(items.map(sourceFamily))];
  const rents=items.map(x=>Number(x.rent)).filter(Number.isFinite);
  const rentSpread=rents.length?Math.max(...rents)-Math.min(...rents):Infinity;
  const exactUnit=items.some(x=>unitToken(x.unit));
  let listing=listingByKey.get(k);
  const summary={identityKey:k,sources:families,rents,exactUnit,matchedListingId:listing?.id||null};

  if(listing&&families.length>=2&&rentSpread<=500){
    listing.availabilityStatus='active';listing.verificationLevel='verified';listing.lastChecked=today;listing.verifiedAt=iso;
    listing.verificationMethod=`Cross-verified by independent live sources: ${families.join(', ')}.`;
    listing.evidenceSources=families;
    state.crossVerified.push(listing.id);state.groups.push({...summary,result:'cross_verified_existing'});continue;
  }

  if(!listing&&exactUnit&&families.length>=2&&rentSpread<=300){
    const best=items.find(x=>x.geo?.lat&&x.geo?.lng)||items.find(x=>x.lat&&x.lng)||items[0];
    const lat=best.geo?.lat??best.lat??null,lng=best.geo?.lng??best.lng??null;
    if(lat==null||lng==null){state.groups.push({...summary,result:'candidate_no_geo'});continue;}
    const unit=unitToken(best.unit),id=`cross-${hash(k)}`,rent=Math.min(...rents);
    listing={id,buildingName:null,unit,address:best.address,neighborhood:'Vancouver West',lat,lng,type:'condo',rent,effectiveRent:null,bedrooms:2,bathrooms:best.bathrooms??best.baths??null,sqft:best.sqft??null,ac:best.ac??null,parking:best.parking??null,petFriendly:best.petFriendly??null,buildingYear:best.buildingYear??null,orientation:best.orientation??null,balcony:best.balcony??null,largeWindows:best.largeWindows??null,modernInterior:best.modernInterior??null,source:`Cross-source: ${families.join(' + ')}`,url:best.url,photoPageUrl:best.url,firstSeen:today,lastChecked:today,verifiedAt:iso,verificationLevel:'verified',verificationMethod:`AUTO-PUBLISHED after exact-unit confirmation from independent live sources: ${families.join(', ')}.`,availabilityStatus:'active',status:'new',priceDrop:false,evidenceSources:families,dataNotes:'Exact unit auto-published only after two-source live agreement.'};
    payload.listings.push(listing);listingByKey.set(k,listing);history[id]=[{date:today,rent,note:`NEW: exact unit independently confirmed by ${families.join(' + ')}.`}];state.promoted.push(id);state.groups.push({...summary,result:'auto_published_cross_source'});continue;
  }
  state.groups.push({...summary,result:'candidate_only'});
}

// Address-only private rentals cannot be keyed across sites by URL. For already-published listings,
// allow a stricter second-source confirmation when exact street, rent, beds, baths and sqft (±5) agree.
// This never auto-publishes a new address-only listing and never merges distinct explicit units.
for(const x of payload.listings){
  if(x.availabilityStatus!=='active'||listingUnit(x)||x.type==='purpose-built')continue;
  const proxy={address:x.address,unit:null,rent:x.rent,bedrooms:x.bedrooms,bathrooms:x.bathrooms,sqft:x.sqft,source:x.source||'existing'};
  const matches=all.filter(c=>usable(c)&&fingerprintCompatible(proxy,c));
  const families=[...new Set(matches.map(sourceFamily))];
  if(!families.length)continue;
  // Require a source family different from the listing's known evidence/source; for Zumper-origin listings,
  // Rentals.ca is sufficient to provide the independent second live observation.
  const currentFamilies=new Set((x.evidenceSources||[]).map(norm));
  if(/zumper/i.test(x.source||''))currentFamilies.add('zumper');
  if(/rentals\.ca/i.test(x.source||''))currentFamilies.add('rentalsca');
  const independent=families.filter(f=>!currentFamilies.has(f));
  if(!independent.length)continue;
  const merged=[...new Set([...currentFamilies,...independent])];
  x.verificationLevel='verified';x.lastChecked=today;x.verifiedAt=iso;x.evidenceSources=merged;
  x.verificationMethod=`Cross-verified by strict address/rent/bed/bath/sqft fingerprint across live sources: ${merged.join(', ')}.`;
  state.fingerprintCrossVerified.push(x.id);
}

for(const c of liv.candidates||[]){if(!c.rented||!unitToken(c.unit))continue;const k=candidateKey(c),x=listingByKey.get(k);if(!x||x.availabilityStatus!=='active')continue;x.availabilityStatus='removed';x.status='removed';x.removedAt=today;x.lastChecked=today;x.verifiedAt=iso;x.verificationMethod='Removed after exact-unit liv.rent detail explicitly showed Rented / no longer accepting applications.';(history[x.id]||=[]).push({date:today,rent:x.rent,note:'AUTO-REMOVED: exact matching liv.rent unit explicitly marked Rented.'});state.negativeMatches.push(x.id);}

payload.meta ||= {};payload.meta.lastCrossSourceReconciliation=iso;payload.meta.reconciliationPolicy='Exact address+unit candidates may auto-publish after two independent live source families agree. Already-published address-only private rentals may gain second-source verification only via strict exact-address + same-rent + same-bed/bath + sqft±5 fingerprint; this fingerprint never auto-publishes a new listing. Exact-unit explicit Rented evidence may remove.';
await write(lp,payload);await write(hp,history);await write(path.join(DATA,'reconciliation-state.json'),state);
console.log(`Reconciliation: ${state.crossVerified.length} exact existing, ${state.fingerprintCrossVerified.length} strict-fingerprint existing, ${state.promoted.length} new exact units promoted, ${state.negativeMatches.length} removed.`);
