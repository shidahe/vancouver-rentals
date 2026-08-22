import fs from 'node:fs/promises';
import path from 'node:path';

const DATA=path.join(process.cwd(),'data');
const p=path.join(DATA,'listings.json');
const db=JSON.parse(await fs.readFile(p,'utf8'));
let changed=0;
for(const l of db.listings||[]){
  const s=String(l.verificationMethod||'').trim();
  if(!s) continue;
  const m=s.match(/^(.*?)(?:\s+Cross-verified by live Zumper detail on \d{4}-\d{2}-\d{2}\.)+$/);
  if(!m) continue;
  const dates=[...s.matchAll(/Cross-verified by live Zumper detail on (\d{4}-\d{2}-\d{2})\./g)].map(x=>x[1]);
  const latest=dates.sort().at(-1);
  const base=m[1].trim();
  const next=`${base}${latest?` Cross-verified by live Zumper detail on ${latest}.`:''}`.trim();
  if(next!==s){l.verificationMethod=next;changed++;}
}
if(changed) await fs.writeFile(p,JSON.stringify(db,null,2)+'\n');
console.log(`Verification annotation cleanup: ${changed} listing(s) normalized.`);
