export const MIN_DISCOVERY_BEDROOMS = 2;
export const MAX_DISCOVERY_BEDROOMS = 4;
export const MIN_DISCOVERY_RENT = 3500;
export const LISTING_SCOPE_VERSION = 'rent-3500-beds-2-4-whole-home-westside-v3';

const OUT_OF_SCOPE_AREA = /\b(?:Fairview(?:\s+VW)?|False\s+Creek|West\s+End(?:\s+VW)?|Downtown(?:\s+Vancouver)?|Yaletown|Mount\s+Pleasant|Riley\s+Park|Olympic\s+Village|South\s+Cambie)\b/i;

export function bedroomEligible(value) {
  const bedrooms = Number(value);
  return Number.isFinite(bedrooms) && bedrooms >= MIN_DISCOVERY_BEDROOMS && bedrooms <= MAX_DISCOVERY_BEDROOMS;
}

export function rentEligible(value) {
  const rent = Number(value);
  return Number.isFinite(rent) && rent >= MIN_DISCOVERY_RENT;
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
