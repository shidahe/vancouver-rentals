const norm=s=>String(s||'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
const street=s=>norm(String(s||'').split(',')[0].split(/\s+near\s+/i)[0])
  .replace(/\b(\d+)(?:st|nd|rd|th)\b/g,'$1')
  .replace(/\bwest\b/g,'w').replace(/\beast\b/g,'e').replace(/\bnorth\b/g,'n').replace(/\bsouth\b/g,'s')
  .replace(/\bstreet\b/g,'st').replace(/\bavenue\b/g,'ave').replace(/\broad\b/g,'rd')
  .replace(/\bplace\b/g,'pl').replace(/\bdrive\b/g,'dr').replace(/\bboulevard\b/g,'blvd').replace(/\bparkway\b/g,'pky');
const unit=s=>String(s||'').trim().replace(/^#/,'').match(/(?=[A-Za-z0-9-]*\d)[A-Za-z0-9-]{1,12}/)?.[0]?.toUpperCase()||null;
const baths=x=>{const n=Number(x?.bathrooms??x?.baths);return Number.isFinite(n)?n:null};
const area=x=>{const n=Number(x?.sqft);return Number.isFinite(n)?n:null};
const stop=new Set('a an and are as at be by for from has have in is it its of on or that the this to was were will with you your'.split(' '));
function tokens(text){
  return new Set(norm(text).split(' ').filter(x=>x.length>=4&&!stop.has(x)));
}

export function craigslistCrossSourcePriceMatch(candidate,listing,listingEvidenceText=''){
  if(!candidate||!listing||!/^craigslist$/i.test(candidate.source||'')||candidate.active===false||
    candidate.detailVerified!==true||candidate.addressPrecision!=='exact_civic'||
    listing.availabilityStatus!=='active'||!/zumper/i.test(listing.source||'')||
    unit(candidate.unit)||unit(listing.unit)||street(candidate.address)!==street(listing.address)||
    Number(candidate.bedrooms)!==Number(listing.bedrooms)||baths(candidate)!==baths(listing)||
    area(candidate)==null||area(listing)==null||Math.abs(area(candidate)-area(listing))>5)return null;
  const priorRent=Number(listing.rent),newRent=Number(candidate.rent);
  if(!Number.isFinite(priorRent)||!Number.isFinite(newRent)||newRent<3500||newRent>15000||
    Math.abs(newRent-priorRent)/priorRent>0.3||candidate.url===listing.url)return null;
  const candidateTokens=tokens(candidate.description||candidate.bodyText||'');
  const evidenceTokens=tokens(listingEvidenceText);
  const shared=[...candidateTokens].filter(x=>evidenceTokens.has(x));
  if(shared.length<18||shared.length/Math.max(1,Math.min(candidateTokens.size,evidenceTokens.size))<0.45)return null;
  return {listing,candidate,priorRent,newRent,sharedDescriptionTokenCount:shared.length};
}
