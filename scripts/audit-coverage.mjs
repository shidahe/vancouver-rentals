import fs from 'node:fs/promises';
import path from 'node:path';
import { aggregateUnitCount } from './priority-inventory-policy.mjs';

const DATA=path.join(process.cwd(),'data');
const read=async(p,d)=>{try{return JSON.parse(await fs.readFile(p,'utf8'))}catch{return d}};
const write=async(p,x)=>fs.writeFile(p,JSON.stringify(x,null,2)+'\n');
const now=Date.now();
const fresh=(iso,hours=12)=>!!iso&&now-new Date(iso).getTime()<=hours*3600000;

const zumper=await read(path.join(DATA,'candidates.json'),[]);
const rentalsca=await read(path.join(DATA,'rentalsca-candidates.json'),{});
const craigslist=await read(path.join(DATA,'craigslist-candidates.json'),{});
const livrent=await read(path.join(DATA,'livrent-candidates.json'),{});
const realtylink=await read(path.join(DATA,'realtylink-candidates.json'),{});
const officialStatus=await read(path.join(DATA,'official-status.json'),{projects:[]});
const listings=await read(path.join(DATA,'listings.json'),{listings:[]});
const kitsWalkAggregate=await read(path.join(DATA,'evidence','source-kits-walk-rentalsca.json'),{});

const countOk=obj=>Object.values(obj||{}).filter(x=>x?.ok===true).length;
const countTotal=obj=>Object.keys(obj||{}).length;
const rlHealth=Array.isArray(realtylink.health)?realtylink.health:[];
const rlReachable=rlHealth.filter(x=>x.status>=200&&x.status<400).length;
const rlCandidates=Array.isArray(realtylink.candidates)?realtylink.candidates.length:0;
const zumperFresh=zumper.filter(x=>fresh(x.liveCheckedAt));
const discoveryLanes=[
  {id:'zumper',kind:'broad-marketplace',healthy:zumperFresh.length>=5,status:zumperFresh.length>=5?'healthy':'unhealthy',detail:`${zumperFresh.length} fresh live candidates`,refreshedAt:zumperFresh.map(x=>x.liveCheckedAt).sort().at(-1)||null},
  {id:'craigslist',kind:'independent-classifieds',healthy:countOk(craigslist.sourceHealth)>=3,status:countOk(craigslist.sourceHealth)>=3?'healthy':countOk(craigslist.sourceHealth)>0?'degraded':'unhealthy',detail:`${countOk(craigslist.sourceHealth)}/${countTotal(craigslist.sourceHealth)} regional searches healthy`,refreshedAt:craigslist.refreshedAt||null},
  {id:'rentalsca',kind:'broad-marketplace',healthy:countOk(rentalsca.sourceHealth)>=3,status:countOk(rentalsca.sourceHealth)>=3?'healthy':countOk(rentalsca.sourceHealth)>0?'degraded':'unhealthy',detail:`${countOk(rentalsca.sourceHealth)}/${countTotal(rentalsca.sourceHealth)} regional searches healthy`,refreshedAt:rentalsca.refreshedAt||null},
  {id:'livrent',kind:'broad-marketplace',healthy:countOk(livrent.sourceHealth)>=1,status:countOk(livrent.sourceHealth)>=1?'healthy':'unhealthy',detail:`${countOk(livrent.sourceHealth)}/${countTotal(livrent.sourceHealth)} searches healthy`,refreshedAt:livrent.refreshedAt||null},
  {id:'realtylink',kind:'mls-rental',healthy:rlReachable>=1&&rlCandidates>=1,status:rlReachable<1?'unhealthy':rlCandidates<1?'degraded':'healthy',detail:`${rlReachable}/${rlHealth.length} searches reachable; ${rlCandidates} live candidates parsed`,refreshedAt:realtylink.refreshedAt||null}
];
const priorityIds=['kits-walk','larchway-gardens','viridian'];
const priorityLanes=priorityIds.map(id=>{
  const project=(officialStatus.projects||[]).find(x=>x.id===id);
  const observations=project?.observations||[];
  const usable=observations.filter(x=>x.usable===true).length;
  const total=observations.length;
  const checkedAt=project?.checkedAt||observations.map(x=>x.checkedAt).sort().at(-1)||null;
  return {id:`priority-${id}`,kind:'priority-official',healthy:usable>=1,status:usable>=1?'healthy':'unhealthy',detail:`${usable}/${total} official sources usable`,refreshedAt:checkedAt};
});
const lanes=[...discoveryLanes,...priorityLanes];

const freshLanes=lanes.filter(x=>fresh(x.refreshedAt));
const healthyDiscovery=discoveryLanes.filter(x=>x.healthy&&fresh(x.refreshedAt));
const priorityHealthy=priorityLanes.every(x=>x.healthy&&fresh(x.refreshedAt));
const healthy=lanes.filter(x=>x.healthy&&fresh(x.refreshedAt));
const broadHealthy=healthy.some(x=>x.kind==='broad-marketplace');
const independentHealthy=healthy.some(x=>x.kind==='independent-classifieds'||x.kind==='mls-rental');
const coverageReady=healthyDiscovery.length>=2&&broadHealthy&&independentHealthy&&priorityHealthy;
const warnings=lanes.filter(x=>x.status!=='healthy').map(x=>({severity:'warning',lane:x.id,status:x.status,detail:x.detail}));
const aggregateText=String(kitsWalkAggregate.bodyText||'');
const textCount=Number(aggregateText.match(/(?:listing|property|it)\s+has\s+(\d+)\s+units?/i)?.[1]||0);
const aggregateCount=Math.max(textCount,aggregateUnitCount(kitsWalkAggregate.jsonLd));
const exactKitsWalkCount=(listings.listings||[]).filter(x=>
  x.availabilityStatus==='active' && /kits walk/i.test(String(x.buildingName||'')) && /^\d+[A-Za-z]?$/.test(String(x.unit||''))
).length;
const inventoryGaps=[];
if(aggregateCount>exactKitsWalkCount){
  const gap={severity:'warning',lane:'priority-kits-walk-inventory',status:'incomplete',detail:`Aggregate inventory reports ${aggregateCount} units; ${exactKitsWalkCount} exact active units are verified`};
  warnings.push(gap);
  inventoryGaps.push({building:'kits-walk',aggregateCount,exactVerifiedCount:exactKitsWalkCount,missingExactUnits:aggregateCount-exactKitsWalkCount,evidenceUrl:kitsWalkAggregate.source?.url||null});
}
const blockers=[];
if(!broadHealthy)blockers.push({severity:'high',issue:'no-healthy-broad-marketplace-discovery-lane'});
if(!independentHealthy)blockers.push({severity:'high',issue:'no-healthy-independent-discovery-lane'});
if(healthyDiscovery.length<2)blockers.push({severity:'high',issue:'insufficient-independent-discovery-redundancy',detail:`${healthyDiscovery.length} fresh healthy discovery lanes`});
for(const lane of priorityLanes.filter(x=>!x.healthy||!fresh(x.refreshedAt))){
  blockers.push({severity:'high',issue:'priority-building-official-monitor-unhealthy',lane:lane.id,detail:lane.detail});
}

const report={generatedAt:new Date().toISOString(),coverageReady,healthyLaneCount:healthyDiscovery.length,freshLaneCount:freshLanes.length,priorityOfficialReady:priorityHealthy,inventoryGaps,lanes,warnings,blockers,policy:'Coverage is ready when at least two fresh independent discovery families are healthy, including one broad marketplace and one independent classifieds/MLS family, and every priority building has at least one fresh usable official source. Aggregate inventory counts are compared with exact verified units and reported as warnings, never auto-published.'};
await write(path.join(DATA,'coverage-report.json'),report);
console.log(`Coverage audit: coverageReady=${coverageReady}, healthy=${healthy.length}/${lanes.length}`);
