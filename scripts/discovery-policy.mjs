export const MIN_DISCOVERY_BEDROOMS = 2;

export function bedroomEligible(value) {
  const bedrooms = Number(value);
  return Number.isFinite(bedrooms) && bedrooms >= MIN_DISCOVERY_BEDROOMS;
}
