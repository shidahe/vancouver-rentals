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
  // Vancouver postal FSAs are V5* and V6*. The west-side geo gate narrows this further spatially.
  // Explicitly reject V7* North Shore addresses even if a source provides a bad Vancouver locality/coordinate.
  return !fsa || /^V[56][A-Z]$/.test(fsa);
};
const isAutoZumper = x => x?.source === 'Zumper live detail' || (/zumper\.com/i.test(x?.url || '') && /^zumper-/i.test(x?.id || ''));

const removed = [];
db.listings = (db.listings || []).filter(x => {
  if (!isAutoZumper(x) || isVancouverPostal(x.address)) return true;
  removed.push({ id: x.id, address: x.address, reason: 'non-vancouver-postal-code' });
  delete history[x.id];
  delete imageSources[x.id];
  return false;
});

const filteredCandidates = (candidates || []).filter(x => !(/zumper\.com/i.test(x?.url || '') && !isVancouverPostal(x.address)));

if (removed.length || filteredCandidates.length !== candidates.length) {
  db.meta ||= {};
  db.meta.lastGeographySanitizer = new Date().toISOString();
  db.meta.geographySanitizerPolicy = 'Auto-discovered Zumper inventory with an explicit non-Vancouver postal prefix is rejected even when source coordinates fall inside the Vancouver West bounding box.';
  await write(listingsPath, db);
  await write(historyPath, history);
  await write(imageSourcesPath, imageSources);
  await write(candidatesPath, filteredCandidates);
}

console.log(`Geography sanitizer: removed ${removed.length} invalid listing(s), ${candidates.length - filteredCandidates.length} invalid candidate(s).`);
if (removed.length) console.log(JSON.stringify(removed));
