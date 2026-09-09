import { listingMls } from './inventory-identity.mjs';

const STATUS_RANK = { active: 4, needs_confirmation: 3, removed: 2, excluded: 1 };

function recordRank(listing) {
  const status = listing.availabilityStatus || listing.status;
  return (STATUS_RANK[status] || 0) * 100
    + (listing.mlsInventoryManaged === false ? 20 : 0)
    + (listing.unit ? 10 : 0)
    + (/^mls-/i.test(listing.id || '') ? 0 : 1);
}

function mergeUniqueHistory(first = [], second = []) {
  const seen = new Set();
  return [...first, ...second].filter(event => {
    const key = JSON.stringify(event);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function dedupeMlsRecords(listings = [], history = {}, imageSources = {}) {
  const groups = new Map();
  for (const listing of listings) {
    const mls = listingMls(listing);
    if (!mls) continue;
    if (!groups.has(mls)) groups.set(mls, []);
    groups.get(mls).push(listing);
  }

  const removedIds = new Set();
  const merged = [];
  for (const [mls, records] of groups) {
    if (records.length < 2) continue;
    const [kept, ...duplicates] = [...records].sort((a, b) => recordRank(b) - recordRank(a));
    for (const duplicate of duplicates) {
      history[kept.id] = mergeUniqueHistory(history[kept.id], history[duplicate.id]);
      history[kept.id] = mergeUniqueHistory(history[kept.id], [{
        date: new Date().toISOString().slice(0, 10),
        rent: kept.rent,
        note: `MERGED duplicate record ${duplicate.id} under canonical MLS ${mls}.`
      }]);
      delete history[duplicate.id];
      if (!imageSources[kept.id] && imageSources[duplicate.id]) imageSources[kept.id] = imageSources[duplicate.id];
      delete imageSources[duplicate.id];
      removedIds.add(duplicate.id);
      merged.push({ mls, kept: kept.id, removed: duplicate.id });
    }
  }

  return { listings: listings.filter(listing => !removedIds.has(listing.id)), merged };
}
