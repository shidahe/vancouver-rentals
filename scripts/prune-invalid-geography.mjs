import fs from 'node:fs/promises';
import path from 'node:path';

const DATA = path.join(process.cwd(), 'data');
const read = async (p, d) => { try { return JSON.parse(await fs.readFile(p, 'utf8')); } catch { return d; } };
const write = async (p, x) => { await fs.writeFile(p, JSON.stringify(x, null, 2) + '\n'); };

const listingsPath = path.join(DATA, 'listings.json');
const historyPath = path.join(DATA, 'history.json');
const imageSourcesPath = path.join(DATA, 'image-sources.json');
const candidatesPath = path.join(DATA, 'candidates.json');

const db = await read(listingsPath, { meta: {}, listings: [] });
const history = await read(historyPath, {});
const imageSources = await read(imageSourcesPath, {});
const candidates = await read(candidatesPath, []);

const postal = s => String(s || '').toUpperCase().match(/\b([A-Z]\d[A-Z])\s?\d[A-Z]\d\b/)?.[1] || null;
const isVancouverPostal = s => {
  const fsa = postal(s);
  return !fsa || /^V[56][A-Z]$/.test(fsa);
};
const isAutoZumper = x => x?.source === 'Zumper live detail' || (/zumper\.com/i.test(x?.url || '') && /^zumper-/i.test(x?.id || ''));
const knownOutOfScope = x => /zumper\.com\/address\/1616-w-13th-ave-902-vancouver-bc-v6j-2g6-can/i.test(x?.url || '');

const removed = [];
db.listings = (db.listings || []).filter(x => {
  if (!isAutoZumper(x)) return true;
  let reason = null;
  if (!isVancouverPostal(x.address)) reason = 'non-vancouver-postal-code';
  else if (knownOutOfScope(x)) reason = 'explicit-source-neighborhood-out-of-scope';
  if (!reason) return true;
  removed.push({ id: x.id, address: x.address, reason });
  delete history[x.id];
  delete imageSources[x.id];
  return false;
});

const filteredCandidates = (candidates || []).filter(x => !(/zumper\.com/i.test(x?.url || '') && (!isVancouverPostal(x.address) || knownOutOfScope(x))));

if (removed.length || filteredCandidates.length !== candidates.length) {
  db.meta ||= {};
  db.meta.lastGeographySanitizer = new Date().toISOString();
  db.meta.geographySanitizerPolicy = 'Auto-discovered Zumper inventory is rejected for explicit non-Vancouver postal prefixes and for source-confirmed out-of-scope neighborhoods, even when source coordinates fall inside the broad Vancouver West bounding box.';
  await write(listingsPath, db);
  await write(historyPath, history);
  await write(imageSourcesPath, imageSources);
  await write(candidatesPath, filteredCandidates);
}

console.log(`Geography sanitizer: removed ${removed.length} invalid listing(s), ${candidates.length - filteredCandidates.length} invalid candidate(s).`);
if (removed.length) console.log(JSON.stringify(removed));
