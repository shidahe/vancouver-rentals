import fs from 'node:fs/promises';
import path from 'node:path';
const DATA=path.join(process.cwd(),'data');
const read=async(p,d)=>{try{return JSON.parse(await fs.readFile(p,'utf8'))}catch{return d}};
const write=async(p,x)=>fs.writeFile(p,JSON.stringify(x,null,2)+'\n');
const q=await read(path.join(DATA,'quality-report.json'),{});
const smoke=await read(path.join(DATA,'site-test-report.json'),{});
const coverage=await read(path.join(DATA,'coverage-report.json'),{});
const listings=await read(path.join(DATA,'listings.json'),{meta:{}});
const latestDataTimes=[listings.meta?.lastAutomatedRefresh,listings.meta?.lastZumperUnitRefresh,listings.meta?.lastCrossSourceReconciliation,listings.meta?.lastPurposeBuiltRefresh,listings.meta?.lastOfficialStatusRefresh].map(x=>x?new Date(x).getTime():0).filter(Boolean);
const latestData=Math.max(0,...latestDataTimes);
const smokeAt=smoke.checkedAt?new Date(smoke.checkedAt).getTime():0;
const smokeFresh=!!smokeAt&&smokeAt>=latestData-60000;
const existingHigh=Number(q.highIssueCount||0);
const existingMedium=Number(q.mediumIssueCount||0);
const readinessIssues=[];
if(smoke.ok!==true)readinessIssues.push({severity:'high',issue:'latest-browser-smoke-failed-or-missing'});
if(!smokeFresh)readinessIssues.push({severity:'high',issue:'browser-smoke-older-than-rental-data',detail:{smokeCheckedAt:smoke.checkedAt||null,latestDataAt:latestData?new Date(latestData).toISOString():null}});
if(coverage.coverageReady!==true)readinessIssues.push({severity:'high',issue:'discovery-coverage-not-ready',detail:coverage.blockers||[]});
if(existingMedium>0)readinessIssues.push({severity:'high',issue:'medium-data-quality-issues-present',detail:{mediumIssueCount:existingMedium}});
q.readinessChecks={
  smokeOk:smoke.ok===true,
  smokeFresh,
  smokeCheckedAt:smoke.checkedAt||null,
  latestDataAt:latestData?new Date(latestData).toISOString():null,
  coverageReady:coverage.coverageReady===true,
  healthyDiscoveryLanes:Number(coverage.healthyLaneCount||0),
  coverageWarnings:coverage.warnings||[]
};
q.readinessIssues=readinessIssues;
q.decisionReady=existingHigh===0&&existingMedium===0&&readinessIssues.length===0;
q.finalizedAt=new Date().toISOString();
await write(path.join(DATA,'quality-report.json'),q);
console.log(`Final readiness: decisionReady=${q.decisionReady}, highIssues=${existingHigh}, mediumIssues=${existingMedium}, smokeOk=${q.readinessChecks.smokeOk}, smokeFresh=${q.readinessChecks.smokeFresh}, coverageReady=${q.readinessChecks.coverageReady}`);
if(!q.decisionReady)process.exitCode=2;
