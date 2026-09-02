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
