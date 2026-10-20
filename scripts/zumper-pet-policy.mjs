const NEGATIVE_PET_POLICY = /\b(?:no\s+(?:cats?|dogs?|pets?)|pets?\s+(?:are\s+)?not\s+(?:allowed|permitted)|no[- ]pet)\b/i;
const POSITIVE_PET_POLICY = /\b(?:pet friendly|pets? allowed|dogs? (?:are )?ok|cats? (?:are )?ok)\b/i;

export function zumperPetFriendly(home, description = '') {
  const text = String(description);
  if (NEGATIVE_PET_POLICY.test(text)) return false;
  if (home?.petsAllowed === false) return false;

  // Zumper renders a generic "Nearby Pet Friendly" navigation widget on
  // property pages. It is not a policy for the advertised unit.
  const listingText = text.replace(/\bNearby Pet Friendly\b/gi, '');
  if (home?.petsAllowed === true || POSITIVE_PET_POLICY.test(listingText)) return true;
  return null;
}

export function zumperPropertyType(home, pageText = '') {
  const schemaType = String(home?.['@type'] || '').toLowerCase();
  if (schemaType === 'singlefamilyresidence' || schemaType === 'house') return 'house';
  if (schemaType === 'apartment') return 'condo';
  if (/\bhouse for rent\b/i.test(String(pageText))) return 'house';
  return 'condo';
}

export function zumperRoomCount(homeDescription = '', pageText = '', productDescription = '', kind = 'bedroom') {
  const label = kind === 'bathroom' ? '(?:bathrooms?|baths?|ba)' : '(?:bedrooms?|beds?|br)';
  const pattern = new RegExp(`\\b([1-5](?:\\.5)?)\\s*${label}\\b`, 'i');

  // The residence description is supplied by the advertiser and can retain a
  // half bath that Zumper's generated Product/SEO summary rounds down (for
  // example, "1 bath" versus the listing's "1.5Bath").
  for (const source of [homeDescription, pageText, productDescription]) {
    const match = String(source || '').match(pattern);
    if (match) return Number(match[1]);
  }
  return null;
}
