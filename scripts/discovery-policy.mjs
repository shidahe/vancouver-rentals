export const MIN_DISCOVERY_BEDROOMS = 2;
export const MAX_DISCOVERY_BEDROOMS = 4;
export const MIN_DISCOVERY_BATHROOMS = 2;
export const MIN_DISCOVERY_RENT = 4000;
export const MAX_DISCOVERY_RENT = 6000;
export const LISTING_SCOPE_VERSION = 'rent-4000-6000-beds-2-4-baths-2-sunlight-kits-downtown-v4';

const OUT_OF_SCOPE_AREA = /\b(?:Fairview(?:\s+VW)?|False\s+Creek|Mount\s+Pleasant|Riley\s+Park|Olympic\s+Village|South\s+Cambie|Downtown\s+Eastside)\b/i;

export function bedroomEligible(value) {
  const bedrooms = Number(value);
  return Number.isFinite(bedrooms) && bedrooms >= MIN_DISCOVERY_BEDROOMS && bedrooms <= MAX_DISCOVERY_BEDROOMS;
}

export function rentEligible(value) {
  const rent = Number(value);
  return Number.isFinite(rent) && rent >= MIN_DISCOVERY_RENT && rent <= MAX_DISCOVERY_RENT;
}

export function bathroomEligible(value) {
  const bathrooms = Number(value);
  return Number.isFinite(bathrooms) && bathrooms >= MIN_DISCOVERY_BATHROOMS;
}

// An exposure is a directional clue, not proof of unblocked direct sunlight.
// Manually verified sun (for example an in-person showing) is also accepted.
// Unknown exposure must stay out of the published inventory until checked.
export function sunlightEligible(listing) {
  if (listing?.sunlightBlocked === true) return false;
  if (listing?.sunlightVerified === true) return true;
  const o = String(listing?.orientation || '').trim().toLowerCase().replace(/[\s_-]/g, '');
  return ['e', 'east', 'w', 'west', 's', 'south', 'ne', 'northeast', 'nw', 'northwest', 'se', 'southeast', 'sw', 'southwest'].includes(o);
}

export function publicationScopeEligible(listing) {
  return listingScopeEligible(listing) && bathroomEligible(listing?.bathrooms ?? listing?.baths) &&
    listing?.ac === true && sunlightEligible(listing);
}

export function scopeExcludedListingCanReactivate(listing) {
  const wasScopeExcluded = listing?.availabilityStatus === 'excluded' ||
    listing?.verificationLevel === 'excluded_by_scope' ||
    Boolean(listing?.scopeExclusionReason);
  return !wasScopeExcluded || publicationScopeEligible(listing);
}

export function isHouseShareText(value = '') {
  const text = String(value);
  if (/(?:#|\bunit\s+)(?:upper|lower|main|basement)\b/i.test(text)) return true;
  if (/\b(?:main|upper|lower|basement)\s+house\b/i.test(text)) return true;
  if (/\bshared\s+with\s+(?:the\s+)?(?:basement|upper|lower|main)(?:[-\s]+(?:suite|unit))?\s+tenants?\b/i.test(text)) return true;
  if (/\b(?:another|a|an)\s+self[-\s]*contained\s+(?:rental\s+)?(?:suite|unit)\s+(?:on|in)\s+the\s+(?:upper|lower|main|basement|ground)\s+(?:floor|level)\b/i.test(text)) return true;
  return /\b(?:private\s+room|room\s+for\s+rent|shared\s+(?:kitchen|bathroom|accommodation|household)|roommate\s+wanted|looking\s+for\s+(?:a\s+)?roommate)\b/i.test(text) ||
    /(?:^|\n)(?:house\s+for\s+rent\s*\n)?(?:main|upper|lower|ground)(?:\s+floor|\s+level)?\s+\d{3,5}\b/im.test(text) ||
    /\b(?:basement|upper|lower|main|ground|first|second)[-\s]+(?:floor|level)?\s*(?:suite|unit)\b/i.test(text) ||
    /\bbasement\s+\d+(?:\.\d+)?[-\s]*(?:bedroom|bed|br).*?\bsuite\b/i.test(text) ||
    /\bavailable\s*[-:]?\s*basement\b/i.test(text) ||
    /\bbasement\s+self[-\s]*contained\s+suite[\s\S]{0,160}\btenant\b/i.test(text) ||
    /\b(?:upper|lower)\s+levels?\s+(?:are\s+)?(?:available|rented?)\s+(?:for\s+rent\s+)?separately\b/i.test(text) ||
    /\b(?:first|second|main|upper|lower)\s+(?:floor|level)\s+is\s+for\s+rent\b/i.test(text) ||
    /\b(?:portion|part)\s+of\s+(?:a|the)\s+house\b/i.test(text) ||
    /\bground\s+level\s+unit\s+in\s+a\s+(?:duplex|triplex|house)\b/i.test(text);
}

export function isTargetRentalAreaText(value = '') {
  return !OUT_OF_SCOPE_AREA.test(String(value));
}

// Broad Vancouver search pages sometimes expose only a civic address, without
// a neighbourhood or coordinates. Include the Downtown peninsula while preventing
// obviously out-of-scope East Vancouver cards from filling
// the manual revalidation queue. Exact detail pages still use coordinates and
// remain authoritative.
export function isTargetRentalSearchAddress(value = '') {
  const address = String(value).replace(/\s+/g, ' ').trim();
  if (!address || !isTargetRentalAreaText(address)) return false;
  if (/\b(?:east|e)\s+\d+(?:st|nd|rd|th)?\s+(?:avenue|ave)\b/i.test(address)) return false;
  if (/\b(?:Joyce|Prince\s+Albert)\s+(?:Street|St)\b/i.test(address)) return false;
  if (/^\s*2488\s+Granville\s+(?:Street|St)\b/i.test(address)) return false;
  const westAvenue = address.match(/^\s*(\d{1,5})\s+(?:west|w)\s+\d+(?:st|nd|rd|th)?\s+(?:avenue|ave)\b/i);
  if (westAvenue && Number(westAvenue[1]) < 1800) return false;
  return true;
}

export function listingScopeEligible(listing, evidenceText = '') {
  const scopeText = [evidenceText, listing?.description, listing?.address, listing?.unit, listing?.buildingName].filter(Boolean).join('\n');
  const areaText = [listing?.address, listing?.neighborhood].filter(Boolean).join('\n');
  return bedroomEligible(listing?.bedrooms ?? listing?.beds) &&
    rentEligible(listing?.rent ?? listing?.livePrice) &&
    isTargetRentalAreaText(areaText) &&
    listing?.rentalScope !== 'shared_house' &&
    !isHouseShareText(scopeText);
}

export function matchingCrossSourceHousePortionEvidence(listing, candidates = []) {
  const listingLat = Number(listing?.lat ?? listing?.geo?.lat);
  const listingLng = Number(listing?.lng ?? listing?.geo?.lng);
  const listingSqft = Number(listing?.sqft);
  if (!Number.isFinite(listingLat) || !Number.isFinite(listingLng) || !Number.isFinite(listingSqft)) return '';
  const match = candidates.find(candidate => {
    if (candidate?.active === false || candidate?.detailVerified !== true || !isHouseShareText(candidate?.description || '')) return false;
    if (Number(candidate.rent) !== Number(listing?.rent) || Number(candidate.bedrooms) !== Number(listing?.bedrooms)) return false;
    const candidateSqft = Number(candidate.sqft);
    const candidateLat = Number(candidate?.geo?.lat ?? candidate?.lat);
    const candidateLng = Number(candidate?.geo?.lng ?? candidate?.lng);
    if (!Number.isFinite(candidateSqft) || Math.abs(candidateSqft - listingSqft) > 5) return false;
    if (!Number.isFinite(candidateLat) || !Number.isFinite(candidateLng)) return false;
    return Math.abs(candidateLat - listingLat) <= 0.0004 && Math.abs(candidateLng - listingLng) <= 0.0004;
  });
  return match?.description || '';
}

const canonicalPropertyAddress = value => String(value || '')
  .toLowerCase()
  .replace(/\b(?:west|w)\b/g, 'w')
  .replace(/\b(?:east|e)\b/g, 'e')
  .replace(/\b(\d+)(?:st|nd|rd|th)\b/g, '$1')
  .replace(/\bavenue\b/g, 'ave')
  .replace(/\bstreet\b/g, 'st')
  .replace(/[^a-z0-9]+/g, ' ')
  .trim();

// Some houses are marketed as two independently rented portions under
// different MLS numbers. Once precise evidence establishes that the property
// itself is partitioned, every current listing at the same civic address and
// coordinates is a house portion even when its rent/bed/sqft fingerprint differs.
export function matchingPartitionedHousePropertyEvidence(listing, records = []) {
  const listingAddress = canonicalPropertyAddress(listing?.address);
  const listingLat = Number(listing?.lat ?? listing?.geo?.lat);
  const listingLng = Number(listing?.lng ?? listing?.geo?.lng);
  if (!listingAddress || !Number.isFinite(listingLat) || !Number.isFinite(listingLng)) return '';
  const match = records.find(record => {
    if (record?.propertyScope !== 'partitioned_house' || record?.identityVerified !== true ||
        record?.active === false || !isHouseShareText(record?.description || '')) return false;
    if (canonicalPropertyAddress(record.propertyAddress) !== listingAddress) return false;
    const recordLat = Number(record?.geo?.lat ?? record?.lat);
    const recordLng = Number(record?.geo?.lng ?? record?.lng);
    return Number.isFinite(recordLat) && Number.isFinite(recordLng) &&
      Math.abs(recordLat - listingLat) <= 0.0004 && Math.abs(recordLng - listingLng) <= 0.0004;
  });
  return match?.description || '';
}
