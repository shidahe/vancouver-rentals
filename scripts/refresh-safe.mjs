import fs from 'node:fs/promises';
import path from 'node:path';

const DATA = path.join(process.cwd(), 'data');
const listingsPath = path.join(DATA, 'listings.json');
const historyPath = path.join(DATA, 'history.json');
const statePath = path.join(DATA, 'refresh-state.json');
const policyPath = path.join(DATA, 'automation-policy.json');

const readJson = async (p, fallback) => { try { return JSON.parse(await fs.readFile(p, 'utf8')); } catch { return fallback; } };
const writeJson = async (p, v) => fs.writeFile(p, JSON.stringify(v, null, 2) + '\n');

const beforePayload = await readJson(listingsPath, { listings: [] });
const beforeHistory = await readJson(historyPath, {});
const beforeById = new Map(beforePayload.listings.map(x => [x.id, structuredClone(x)]));
const policy = await readJson(policyPath, { autoPriceListingIds: [], canonicalRentRepairs: {} });

await import('./refresh-listings.mjs');

const afterPayload = await readJson(listingsPath, { listings: [] });
const afterHistory = await readJson(historyPath, {});
const state = await readJson(statePath, { listings: {} });
const allowPrice = new Set(policy.autoPriceListingIds || []);
const today = new Date().toISOString().slice(0, 10);

for (const listing of afterPayload.listings) {
  const before = beforeById.get(listing.id);
  if (!before) continue;

  const check = state.listings?.[listing.id];
  if (check && check.status >= 400 && ![404, 410].includes(check.status)) {
    // A blocked/forbidden page is not evidence. Restore all mutable verification fields.
    const keep = { availabilityStatus: listing.availabilityStatus, status: listing.status, removedAt: listing.removedAt };
    Object.assign(listing, before);
    if (keep.availabilityStatus === 'removed' && [404, 410].includes(check.status)) Object.assign(listing, keep);
  }

  if (!allowPrice.has(listing.id) && before.rent != null && listing.rent !== before.rent) {
    listing.rent = before.rent;
    listing.status = before.status;
    listing.priceDrop = before.priceDrop;
    const hist = afterHistory[listing.id] || [];
    afterHistory[listing.id] = hist.filter(h => !(h.date === today && /^AUTO price update/i.test(h.note || '')));
  }
}

for (const [id, repair] of Object.entries(policy.canonicalRentRepairs || {})) {
  const listing = afterPayload.listings.find(x => x.id === id);
  if (!listing || listing.rent === repair.rent) continue;
  const badRent = listing.rent;
  listing.rent = repair.rent;
  listing.status = 'unchanged';
  listing.priceDrop = false;
  afterHistory[id] ||= [];
  afterHistory[id] = afterHistory[id].filter(h => !(h.rent === badRent && /AUTO price update/i.test(h.note || '')));
  afterHistory[id].push({ date: today, rent: repair.rent, note: `AUTOMATION CORRECTION: restored canonical rent after parser mixed prices from a multi-unit page. ${repair.reason || ''}`.trim() });
}

await writeJson(listingsPath, afterPayload);
await writeJson(historyPath, afterHistory);
console.log('Safety pass complete: blocked pages ignored, non-allowlisted automated price changes restored, canonical repairs applied.');
