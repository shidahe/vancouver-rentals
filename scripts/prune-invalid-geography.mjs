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

const EAST_BOUNDARY = -123.145;
const postal = s => String(s || '').toUpperCase().match(/\b([A-Z]\d[A-Z])\s?\d[A-Z]\d\b/)?.[1] || null;
const isVancouverPostal = s => {
  const fsa = postal(s);
  return !fsa || /^V[56][A-Z]$/.test(fsa);
};
const isAutoZumper = x => x?.source === 'Zumper live detail' || (/zumper\.com/i.test(x?.url || '') && /^zumper-/i.test(x?.id || ''));
const explicitlyOutOfScope = x => /\b(?:Fairview|Downtown Vancouver|Yaletown|Mount Pleasant|Riley Park|Olympic Village|South Cambie)\b/i.test(String(x?.neighborhood || ''));
const eastOfTarget = x => Number.isFinite(Number(x?.lng)) && Number(x.lng) > EAST_BOUNDARY;
// Retain the historical URL guard for old records that were stored before source-neighborhood metadata was preserved.
const knownLegacyOutOfScope = x => /zumper\.com\/address\/1616-w-13th-ave-902-vancouver-bc-v6j-2g6-can/i.test(x?.url || '');
const invalidReason = x => {
  if (!isVancouverPostal(x?.address)) return 'non-vancouver-postal-code';
  if (explicitlyOutOfScope(x)) return 'explicit-source-neighborhood-out-of-scope';
  if (eastOfTarget(x)) return 'east-of-vancouver-west-boundary';
  if (knownLegacyOutOfScope(x)) return 'legacy-confirmed-out-of-scope';
  return null;
};

const removed = [];
db.listings = (db.listings || []).filter(x => {
  if (!isAutoZumper(x)) return true;
  const reason = invalidReason(x);
  if (!reason) return true;
  removed.push({ id: x.id, address: x.address, reason });
  delete history[x.id];
  delete imageSources[x.id];
  return false;
});

const filteredCandidates = (candidates || []).filter(x => !(/zumper\.com/i.test(x?.url || '') && invalidReason(x)));

db.meta ||= {};
db.meta.lastGeographySanitizer = new Date().toISOString();
db.meta.geographySanitizerPolicy = `Auto-discovered Zumper inventory is fail-closed to Vancouver West: valid Vancouver postal prefix, no explicit out-of-scope neighborhood, and longitude at or west of ${EAST_BOUNDARY}.`;
await write(listingsPath, db);
if (removed.length) await write(historyPath, history);
if (removed.length) await write(imageSourcesPath, imageSources);
if (removed.length || filteredCandidates.length !== candidates.length) await write(candidatesPath, filteredCandidates);

console.log(`Geography sanitizer: removed ${removed.length} invalid listing(s), ${candidates.length - filteredCandidates.length} invalid candidate(s).`);
if (removed.length) console.log(JSON.stringify(removed));
