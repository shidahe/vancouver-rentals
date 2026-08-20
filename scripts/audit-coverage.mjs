import fs from 'node:fs/promises';
import path from 'node:path';

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

const countOk=obj=>Object.values(obj||{}).filter(x=>x?.ok===true).length;
const countTotal=obj=>Object.keys(obj||{}).length;
const rlHealth=Array.isArray(realtylink.health)?realtylink.health:[];
const zumperFresh=zumper.filter(x=>fresh(x.liveCheckedAt));
const lanes=[
  {
    id:'zumper',kind:'broad-marketplace',healthy:zumperFresh.length>=5,
    status:zumperFresh.length>=5?'healthy':'unhealthy',
    detail:`${zumperFresh.length} fresh live candidates`,
    refreshedAt:zumperFresh.map(x=>x.liveCheckedAt).sort().at(-1)||null
  },
  {
    id:'craigslist',kind:'independent-classifieds',healthy:countOk(craigslist.sourceHealth)>=3,
    status:countOk(craigslist.sourceHealth)>=3?'healthy':countOk(craigslist.sourceHealth)>0?'degraded':'unhealthy',
    detail:`${countOk(craigslist.sourceHealth)}/${countTotal(craigslist.sourceHealth)} regional searches healthy`,
    refreshedAt:craigslist.refreshedAt||null
  },
  {
    id:'rentalsca',kind:'broad-marketplace',healthy:countOk(rentalsca.sourceHealth)>=3,
    status:countOk(rentalsca.sourceHealth)>=3?'healthy':countOk(rentalsca.sourceHealth)>0?'degraded':'unhealthy',
    detail:`${countOk(rentalsca.sourceHealth)}/${countTotal(rentalsca.sourceHealth)} regional searches healthy`,
    refreshedAt:rentalsca.refreshedAt||null
  },
  {
    id:'livrent',kind:'broad-marketplace',healthy:countOk(livrent.sourceHealth)>=1,
    status:countOk(livrent.sourceHealth)>=1?'healthy':'unhealthy',
    detail:`${countOk(livrent.sourceHealth)}/${countTotal(livrent.sourceHealth)} searches healthy`,
    refreshedAt:livrent.refreshedAt||null
  },
  {
    id:'realtylink',kind:'mls-rental',healthy:rlHealth.filter(x=>x.status>=200&&x.status<400).length>=1,
    status:rlHealth.some(x=>x.status>=200&&x.status<400)?'healthy':'unhealthy',
    detail:`${rlHealth.filter(x=>x.status>=200&&x.status<400).length}/${rlHealth.length} searches healthy`,
    refreshedAt:realtylink.refreshedAt||null
  }
];

const freshLanes=lanes.filter(x=>fresh(x.refreshedAt));
const healthy=lanes.filter(x=>x.healthy&&fresh(x.refreshedAt));
const broadHealthy=healthy.some(x=>x.kind==='broad-marketplace');
const independentHealthy=healthy.some(x=>x.kind==='independent-classifieds'||x.kind==='mls-rental');
const coverageReady=healthy.length>=2&&broadHealthy&&independentHealthy;
const warnings=lanes.filter(x=>x.status!=='healthy').map(x=>({severity:'warning',lane:x.id,status:x.status,detail:x.detail}));
const blockers=[];
if(!broadHealthy)blockers.push({severity:'high',issue:'no-healthy-broad-marketplace-discovery-lane'});
if(!independentHealthy)blockers.push({severity:'high',issue:'no-healthy-independent-discovery-lane'});
if(healthy.length<2)blockers.push({severity:'high',issue:'insufficient-independent-discovery-redundancy',detail:`${healthy.length} fresh healthy lanes`});

const report={generatedAt:new Date().toISOString(),coverageReady,healthyLaneCount:healthy.length,freshLaneCount:freshLanes.length,lanes,warnings,blockers,policy:'Coverage is ready when at least two fresh independent discovery families are healthy, including one broad marketplace and one independent classifieds/MLS family. Individual blocked sources are warnings while redundant discovery remains healthy.'};
await write(path.join(DATA,'coverage-report.json'),report);
console.log(`Coverage audit: coverageReady=${coverageReady}, healthy=${healthy.length}/${lanes.length}`);
if(!coverageReady)process.exitCode=2;
