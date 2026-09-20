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
      candidate.detailVerified !== true || candidate.addressPrecision !== 'exact_civic') return null;

  for (const seed of seeds) {
    if (!/craigslist/i.test(`${seed.source || ''} ${seed.url || ''}`) || !seed.listingId || !seed.unit ||
        !civicAddressMatch(seed.address, candidate.address)) continue;
    const listing = listings.find(item => item.id === seed.listingId);
    if (!listing || !['removed', 'needs_confirmation'].includes(listing.availabilityStatus)) continue;

    const expectedBeds = number(seed.expectedBeds ?? seed.hints?.bedrooms ?? listing.bedrooms);
    const expectedBaths = number(seed.hints?.bathrooms ?? listing.bathrooms);
    const expectedSqft = number(seed.hints?.sqft ?? listing.sqft);
    if (number(candidate.rent) !== number(listing.rent) || number(candidate.bedrooms) !== expectedBeds ||
        number(candidate.bathrooms) !== expectedBaths || expectedSqft == null || number(candidate.sqft) == null ||
        Math.abs(number(candidate.sqft) - expectedSqft) > 20) continue;

    const priorKeys = new Set((imageSources[listing.id]?.candidates || []).map(photoAssetKey).filter(Boolean));
    const currentKeys = new Set((candidate.images || []).map(photoAssetKey).filter(Boolean));
    const sharedPhotoKeys = [...currentKeys].filter(key => priorKeys.has(key));
    if (sharedPhotoKeys.length < 3) continue;
    return { seed, listing, sharedPhotoKeys };
  }
  return null;
}
