import { civicAddressMatch, concreteUnitToken, listingMls } from './inventory-identity.mjs';

const number = value => {
  if (value == null || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const propertyType = listing => String(listing?.type || listing?.propertyType || '').trim().toLowerCase();

// MLS numbers sometimes change when the same detached house is relisted.  Without
// a unit number, address alone is not safe enough, so require the full rental
// fingerprint as well.  Condos and townhouses deliberately remain excluded.
export function wholeHomeMlsRelistMatch(previous, current) {
  const previousMls = listingMls(previous);
  const currentMls = listingMls(current);
  if (!previousMls || !currentMls || previousMls === currentMls) return false;
  if (propertyType(previous) !== 'house' || propertyType(current) !== 'house') return false;
  if (concreteUnitToken(previous?.unit) || concreteUnitToken(current?.unit)) return false;
  if (!civicAddressMatch(previous?.address, current?.address)) return false;

  const fields = ['rent', 'bedrooms'];
  if (fields.some(field => number(previous?.[field]) == null || number(previous?.[field]) !== number(current?.[field]))) return false;
  const previousBaths = number(previous?.bathrooms ?? previous?.baths);
  const currentBaths = number(current?.bathrooms ?? current?.baths);
  const previousSqft = number(previous?.sqft);
  const currentSqft = number(current?.sqft);
  return previousBaths != null && previousBaths === currentBaths && previousSqft != null && currentSqft != null && Math.abs(previousSqft - currentSqft) <= 5;
}
