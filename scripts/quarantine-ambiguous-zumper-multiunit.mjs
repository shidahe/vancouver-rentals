import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';

const DATA = path.join(process.cwd(), 'data');
const EVIDENCE = path.join(DATA, 'evidence');
const read = async (p, d) => { try { return JSON.parse(await fs.readFile(p, 'utf8')); } catch { return d; } };
const write = async (p, x) => fs.writeFile(p, JSON.stringify(x, null, 2) + '\n');
const hash = s => crypto.createHash('sha1').update(String(s || '')).digest('hex').slice(0, 12);
const today = new Date().toISOString().slice(0, 10);
const AMBIGUITY_NOTE = 'NEEDS CONFIRMATION: Zumper page is an address-level multi-unit page without a public unit identity; page-level low/high price cannot be treated as an exact unit rent.';
const normalizeAmbiguityNote = value => {
  const text = String(value || '');
  const withoutRepeats = text.split(AMBIGUITY_NOTE).join(' ').replace(/\s+/g, ' ').trim();
  return [withoutRepeats, AMBIGUITY_NOTE].filter(Boolean).join(' ');
};

const lp = path.join(DATA, 'listings.json');
const cp = path.join(DATA, 'candidates.json');
const hp = path.join(DATA, 'history.json');
const rp = path.join(DATA, 'zumper-ambiguity-report.json');
const db = await read(lp, { meta: {}, listings: [] });
const candidates = await read(cp, []);
const history = await read(hp, {});
const quarantined = [];
const checked = [];

for (const c of candidates) {
  if (c.source !== 'Zumper' || c.unit || !c.identityKey || !/\/address\//i.test(c.url || '')) continue;
  const evidencePath = path.join(EVIDENCE, `zumper-v3-${hash(c.identityKey)}.json`);
  const evidence = await read(evidencePath, null);
  const desc = String(evidence?.facts?.description || '');
  const jsonText = JSON.stringify(evidence?.jsonLd || []);
  const low = Number(jsonText.match(/"lowPrice"\s*:\s*"?([0-9.]+)/i)?.[1] || 0) || null;
  const high = Number(jsonText.match(/"highPrice"\s*:\s*"?([0-9.]+)/i)?.[1] || 0) || null;
  const ambiguous = /\bMulti[- ]Unit\b/i.test(desc) || (low && high && low !== high);
  checked.push({ identityKey: c.identityKey, url: c.url, ambiguous, lowPrice: low, highPrice: high });
  if (!ambiguous) continue;

  c.autoPublishResult = 'needs_confirmation_multi_unit_address_page';
  const listing = db.listings.find(x => x.source === 'Zumper live detail' && x.url === c.url && !x.unit);
  if (!listing) continue;

  // Keep provenance readable across repeated refreshes. The live-detail pass may mark the
  // record active again before this fail-closed quarantine runs, so normalize the note on
  // every ambiguous observation rather than appending it on every cycle.
  listing.dataNotes = normalizeAmbiguityNote(listing.dataNotes);
  if (listing.availabilityStatus === 'active') {
    listing.availabilityStatus = 'needs_confirmation';
    listing.verificationLevel = 'unverified';
    listing.status = 'corrected';
    listing.priceDrop = false;
    listing.lastChecked = today;
    history[listing.id] ||= [];
    if (!history[listing.id].some(h => h.date === today && h.note === AMBIGUITY_NOTE)) history[listing.id].push({ date: today, rent: listing.rent, note: AMBIGUITY_NOTE });
    quarantined.push({ id: listing.id, address: listing.address, url: listing.url, rent: listing.rent });
  }
}

const stillActive = db.listings.filter(x => x.source === 'Zumper live detail' && x.availabilityStatus === 'active' && checked.some(c => c.ambiguous && c.url === x.url));
if (stillActive.length) throw new Error(`Ambiguous Zumper multi-unit address pages remain active: ${stillActive.map(x => x.id).join(', ')}`);

db.meta ||= {};
db.meta.lastZumperMultiUnitQuarantine = new Date().toISOString();
db.meta.zumperMultiUnitPolicy = 'Address-level Zumper multi-unit pages without a public unit identity are fail-closed: aggregate low/high prices never auto-publish or auto-update an exact rental inventory.';
await write(lp, db);
await write(cp, candidates);
await write(hp, history);
await write(rp, { generatedAt: new Date().toISOString(), checkedCount: checked.length, quarantinedCount: quarantined.length, checked, quarantined });
console.log(`Zumper multi-unit quarantine: checked ${checked.length}, quarantined ${quarantined.length}.`);
