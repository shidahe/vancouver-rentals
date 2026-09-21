import { civicAddressMatch } from './inventory-identity.mjs';

function photoAssetKey(value) {
  const name = String(value || '').split('/').pop()?.split('?')[0] || '';
  const match = name.match(/^([^_]+_[^_]+)_/);
  return match?.[1] || null;
}

const number = value => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

export function craigslistSeedRelistingMatch(candidate, seeds = [], listings = [], imageSources = {}) {
  if (!candidate || candidate.source !== 'Craigslist' || candidate.active === false ||
      candidate.detailVerified !== true || candidate.addressPrecision !== 'exact_civic' ||
      number(candidate.rent) < 3500 || number(candidate.rent) > 15000) return null;

  for (const seed of seeds) {
    if (!/craigslist/i.test(`${seed.source || ''} ${seed.url || ''}`) || !seed.listingId || !seed.unit ||
        !civicAddressMatch(seed.address, candidate.address)) continue;
    const listing = listings.find(item => item.id === seed.listingId);
    if (!listing || !['active', 'removed', 'needs_confirmation'].includes(listing.availabilityStatus) ||
        candidate.url === listing.url) continue;

    const expectedBeds = number(seed.expectedBeds ?? seed.hints?.bedrooms ?? listing.bedrooms);
    const expectedBaths = number(seed.hints?.bathrooms ?? listing.bathrooms);
    const expectedSqft = number(seed.hints?.sqft ?? listing.sqft);
    const priorRent = number(listing.rent);
    const rentChangeRatio = priorRent ? Math.abs(number(candidate.rent) - priorRent) / priorRent : Infinity;
    if (rentChangeRatio > 0.3 || number(candidate.bedrooms) !== expectedBeds ||
        number(candidate.bathrooms) !== expectedBaths || expectedSqft == null || number(candidate.sqft) == null ||
        Math.abs(number(candidate.sqft) - expectedSqft) > 20) continue;

    const priorKeys = new Set((imageSources[listing.id]?.candidates || []).map(photoAssetKey).filter(Boolean));
    const currentKeys = new Set((candidate.images || []).map(photoAssetKey).filter(Boolean));
    const sharedPhotoKeys = [...currentKeys].filter(key => priorKeys.has(key));
    if (sharedPhotoKeys.length < 3) continue;
    return { seed, listing, sharedPhotoKeys, priorRent };
  }
  return null;
}
