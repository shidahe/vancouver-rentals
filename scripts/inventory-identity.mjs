const MLS_PATTERN = /\bR\d{7}\b/i;

export function normalizeMls(value) {
  return String(value || '').match(MLS_PATTERN)?.[0].toUpperCase() || null;
}

export function listingMls(listing = {}) {
  for (const value of [listing.mls, listing.id, listing.unit, listing.source, listing.url]) {
    const mls = normalizeMls(value);
    if (mls) return mls;
  }
  return null;
}

export function mlsIdentity(value) {
  const mls = normalizeMls(value);
  return mls ? `mls:${mls.toLowerCase()}` : null;
}

const canonicalAddress = value => String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

export function findExistingSeedListing(listings = [], seed = {}) {
  const exactId = listings.find(listing => listing.id === seed.listingId);
  if (exactId) return exactId;
  // An exact unit may share a building address with an old floorplan placeholder,
  // but they are different inventory identities. Address fallback is safe only
  // when neither side claims a concrete unit.
  if (seed.unit) return null;
  return listings.find(listing => !listing.unit && canonicalAddress(listing.address) === canonicalAddress(seed.address)) || null;
}
