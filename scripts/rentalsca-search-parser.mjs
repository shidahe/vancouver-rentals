import { civicAddressMatch } from './inventory-identity.mjs';

const amount=value=>Number(String(value||'').replace(/[^0-9]/g,''))||null;

export function parseRentalsCaSearchLeads(text=''){
  const lines=String(text).split('\n').map(x=>x.replace(/^[•\s]+/,'').trim()).filter(Boolean);
  const leads=[];
  let previousAddress=-1;
  for(let i=0;i<lines.length;i++){
    const address=lines[i];
    if(!/^\s*(?:[A-Za-z0-9#-]+\s+)?\d{3,5}\s+.+,\s*Vancouver,\s*(?:BC|British Columbia)\b/i.test(address))continue;
    const context=lines.slice(Math.max(previousAddress+1,i-8),i).join(' | ');
    previousAddress=i;
    const rentMatch=context.match(/\$\s*([0-9][0-9,]{2,})(?:\s*[–—-]\s*\$?\s*([0-9][0-9,]{2,}))?/);
    const bedMatch=context.match(/(?:([0-4](?:\.5)?)\s*[–—-]\s*)?([1-4](?:\.5)?)\s*(?:Bed|Bedroom)s?\b/i);
    const bathMatch=context.match(/([1-5](?:\.5)?)\s*(?:Bath|Bathroom)s?\b/i);
    if(!rentMatch||!bedMatch)continue;
    const rentMin=amount(rentMatch[1]),rentMax=amount(rentMatch[2])||rentMin;
    const bedroomMin=Number(bedMatch[1]??bedMatch[2]),bedroomMax=Number(bedMatch[2]);
    if(!rentMin||!Number.isFinite(bedroomMax))continue;
    const key=`${address.toLowerCase()}::${rentMin}::${rentMax}::${bedroomMin}::${bedroomMax}`;
    if(!leads.some(x=>x.identityKey===key))leads.push({identityKey:key,address,rentMin,rentMax,bedroomMin,bedroomMax,bathrooms:bathMatch?Number(bathMatch[1]):null});
  }
  return leads;
}

export function classifyRentalsCaSearchLead(lead={},listings=[]){
  const matches=(listings||[]).filter(x=>civicAddressMatch(lead.address,x.address));
  const active=matches.filter(x=>x.availabilityStatus==='active');
  const pending=matches.filter(x=>x.availabilityStatus==='needs_confirmation');
  const preferred=active[0]||pending[0]||matches[0]||null;
  return {
    leadStatus:active.length?'represented_active_address':matches.length?'needs_detail_revalidation':'new_unverified_address',
    addressMatchOnly:matches.length>0,
    matchingListingCount:matches.length,
    matchedListingIds:matches.map(x=>x.id).filter(Boolean),
    matchedListingId:preferred?.id||null,
    matchedAvailabilityStatus:preferred?.availabilityStatus||null
  };
}
