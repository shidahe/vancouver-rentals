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
const beforeById = new Map(beforePayload.listings.map(x => [x.id, structuredClone(x)]));
const policy = await readJson(policyPath, { autoPriceListingIds: [], canonicalRentRepairs: {} });

await import('./refresh-listings.mjs');

const afterPayload = await readJson(listingsPath, { listings: [] });
const afterHistory = await readJson(historyPath, {});
const state = await readJson(statePath, { listings: {}, sources: {} });
const allowPrice = new Set(policy.autoPriceListingIds || []);
const today = new Date().toISOString().slice(0, 10);

for (const listing of afterPayload.listings) {
  const before = beforeById.get(listing.id);
  if (!before) continue;

  const check = state.listings?.[listing.id];
  if (check && check.status >= 400 && ![404, 410].includes(check.status)) {
    // 401/403/429/5xx are blocked/error pages, not rental evidence.
    Object.assign(listing, before);
    check.ok = false;
    check.usableEvidence = false;
    check.blockedReason = `HTTP ${check.status}`;
  }

  if (!allowPrice.has(listing.id) && before.rent != null && listing.rent !== before.rent) {
    listing.rent = before.rent;
    listing.status = before.status;
    listing.priceDrop = before.priceDrop;
    const hist = afterHistory[listing.id] || [];
    afterHistory[listing.id] = hist.filter(h => !(h.date === today && /^AUTO price update/i.test(h.note || '')));
  }
}

for (const source of Object.values(state.sources || {})) {
  if (source.status >= 400) {
    source.ok = false;
    source.usableEvidence = false;
    source.blockedReason = `HTTP ${source.status}`;
  } else if (source.ok) {
    source.usableEvidence = true;
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
  const already = afterHistory[id].some(h => h.date === today && /AUTOMATION CORRECTION/.test(h.note || ''));
  if (!already) afterHistory[id].push({ date: today, rent: repair.rent, note: `AUTOMATION CORRECTION: restored canonical rent after parser mixed prices from a multi-unit page. ${repair.reason || ''}`.trim() });
}

afterPayload.meta ||= {};
afterPayload.meta.automationSafety = 'Prices auto-update only for allowlisted exact single-unit pages. HTTP 401/403/429/5xx responses are unusable evidence.';

await writeJson(listingsPath, afterPayload);
await writeJson(historyPath, afterHistory);
await writeJson(statePath, state);
console.log('Safety pass complete: blocked pages ignored, non-allowlisted automated price changes restored, canonical repairs applied.');
