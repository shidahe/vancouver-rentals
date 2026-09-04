export const MIN_DISCOVERY_BEDROOMS = 2;
export const MAX_DISCOVERY_BEDROOMS = 4;
export const MIN_DISCOVERY_RENT = 3500;

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
  return /\b(?:private\s+room|room\s+for\s+rent|shared\s+(?:kitchen|bathroom|accommodation|household)|roommate\s+wanted|looking\s+for\s+(?:a\s+)?roommate)\b/i.test(text) ||
    /\b(?:basement|upper|lower|main|ground|first|second)[-\s]+(?:floor|level)?\s*(?:suite|unit)\b/i.test(text) ||
    /\bbasement\s+\d+(?:\.\d+)?[-\s]*(?:bedroom|bed|br).*?\bsuite\b/i.test(text) ||
    /\bavailable\s*[-:]?\s*basement\b/i.test(text) ||
    /\bbasement\s+self[-\s]*contained\s+suite[\s\S]{0,160}\btenant\b/i.test(text) ||
    /\b(?:upper|lower)\s+levels?\s+(?:are\s+)?(?:available|rented?)\s+(?:for\s+rent\s+)?separately\b/i.test(text) ||
    /\b(?:first|second|main|upper|lower)\s+(?:floor|level)\s+is\s+for\s+rent\b/i.test(text) ||
    /\b(?:portion|part)\s+of\s+(?:a|the)\s+house\b/i.test(text) ||
    /\bground\s+level\s+unit\s+in\s+a\s+(?:duplex|triplex|house)\b/i.test(text);
}

export function listingScopeEligible(listing, evidenceText = '') {
  return bedroomEligible(listing?.bedrooms ?? listing?.beds) &&
    rentEligible(listing?.rent ?? listing?.livePrice) &&
    listing?.rentalScope !== 'shared_house' &&
    !isHouseShareText(evidenceText || listing?.description || '');
}
