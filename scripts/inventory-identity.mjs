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

function civicStreet(value) {
  const normalized = String(value || '').toLowerCase()
    .replace(/\bwest\b/g, 'w').replace(/\beast\b/g, 'e')
    .replace(/\bnorth\b/g, 'n').replace(/\bsouth\b/g, 's')
    .replace(/\bavenue\b/g, 'ave').replace(/\bstreet\b/g, 'st')
    .replace(/\broad\b/g, 'rd').replace(/\bdrive\b/g, 'dr')
    .replace(/\bboulevard\b/g, 'blvd').replace(/\bplace\b/g, 'pl')
    .replace(/[^a-z0-9]+/g, ' ');
  const match = normalized.match(/\b(\d{2,5}x?)\s+(?:(w|e|n|s)\s+)?(\d+)(?:st|nd|rd|th)?\s+(ave|st|rd|dr|blvd|pl)(?:\s+(w|e|n|s))?\b/);
  return match ? { civic: match[1], direction: match[2] || match[5] || '', street: match[3], type: match[4] } : null;
}

export function maskedCivicAddressMatch(first, second) {
  const a = civicStreet(first), b = civicStreet(second);
  if (!a || !b || a.street !== b.street || a.type !== b.type || a.direction !== b.direction) return false;
  const [masked, exact] = a.civic.endsWith('x') ? [a.civic, b.civic] : b.civic.endsWith('x') ? [b.civic, a.civic] : [];
  if (!masked || !/^\d+$/.test(exact) || exact.length !== masked.length) return false;
  return exact.startsWith(masked.slice(0, -1));
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
