import fs from 'node:fs/promises';
import path from 'node:path';

const DATA = path.join(process.cwd(), 'data');
const now = new Date();
const today = now.toISOString().slice(0, 10);
const MAX_AGE_MS = 48 * 60 * 60 * 1000;
const read = async (p, d) => { try { return JSON.parse(await fs.readFile(p, 'utf8')); } catch { return d; } };
const write = async (p, x) => fs.writeFile(p, JSON.stringify(x, null, 2) + '\n');

const lp = path.join(DATA, 'listings.json');
const hp = path.join(DATA, 'history.json');
const db = await read(lp, { meta: {}, listings: [] });
const history = await read(hp, {});
let expired = 0;

for (const l of db.listings || []) {
  if (l.source !== 'Zumper live detail' || l.availabilityStatus !== 'active') continue;
  const verified = Date.parse(l.verifiedAt || '');
  if (!Number.isFinite(verified) || now.getTime() - verified <= MAX_AGE_MS) continue;

  l.availabilityStatus = 'needs_confirmation';
  l.status = 'corrected';
  l.verificationLevel = 'unverified';
  l.lastChecked = today;
  l.dataNotes = `${String(l.dataNotes || '').replace(/\s*Auto-hidden after exceeding the 48-hour live-verification window\.?/gi, '').trim()} Auto-hidden after exceeding the 48-hour live-verification window.`.trim();
  history[l.id] ||= [];
  const last = history[l.id][history[l.id].length - 1];
  if (!last || last.note !== 'Auto-hidden: Zumper live detail was not reverified within 48 hours.') {
    history[l.id].push({ date: today, rent: l.rent ?? null, note: 'Auto-hidden: Zumper live detail was not reverified within 48 hours.' });
  }
  expired++;
}

db.meta ||= {};
db.meta.lastStaleAutoListingExpiry = now.toISOString();
db.meta.staleAutoListingPolicy = 'Auto-published Zumper live-detail inventory is fail-closed: if it is not reverified within 48 hours, it is hidden as needs_confirmation until exact live evidence returns.';
await write(lp, db);
await write(hp, history);
console.log(`Stale auto-listing expiry: ${expired} listing(s) hidden.`);
