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
  const text = `${String(home?.description || '')}\n${String(pageText || '')}`;
  // Zumper occasionally emits SingleFamilyResidence for an apartment address.
  // Prefer the current page's explicit listing label and the advertiser's
  // multi-suite-building wording before falling back to schema type.
  if (/\bhouse for rent\b/i.test(text)) return 'house';
  if (/\bapartment for rent\b|\b\d{1,3}-suite apartment building\b/i.test(text)) return 'condo';
  const schemaType = String(home?.['@type'] || '').toLowerCase();
  if (schemaType === 'singlefamilyresidence' || schemaType === 'house') return 'house';
  if (schemaType === 'apartment') return 'condo';
  return 'condo';
}

export function zumperRoomCount(homeDescription = '', pageText = '', productDescription = '', kind = 'bedroom') {
  const label = kind === 'bathroom' ? '(?:bathrooms?|baths?|ba)' : '(?:bedrooms?|beds?|br)';
  const pattern = new RegExp(`\\b([1-5](?:\\.5)?)\\s*${label}\\b`, 'i');
  const labelFirst = new RegExp(`\\b${label}\\s*[:|-]?\\s*([1-5](?:\\.5)?)\\b`, 'i');

  // The residence description is supplied by the advertiser and can retain a
  // half bath that Zumper's generated Product/SEO summary rounds down (for
  // example, "1 bath" versus the listing's "1.5Bath").
  // When it does not contain a count, Product's address-specific summary is
  // safer than the full page body, which may include unrelated nearby cards.
  for (const source of [homeDescription, productDescription]) {
    const match = String(source || '').match(pattern);
    if (match) return Number(match[1]);
  }
  const prominent = String(pageText || '').match(labelFirst);
  if (prominent) return Number(prominent[1]);
  const fallback = String(pageText || '').match(pattern);
  if (fallback) return Number(fallback[1]);
  return null;
}

export function zumperUnitToken(description = '', street = '') {
  const text = String(description || '');
  const match = text.match(/\b(?:unit|suite|apt)\s+(?:#\s*)?([A-Za-z0-9-]*\d[A-Za-z0-9-]*)\b/i) ||
    text.match(/#\s*([A-Za-z0-9-]*\d[A-Za-z0-9-]*)\b/i);
  const token = match?.[1]?.toUpperCase() || null;
  const civic = String(street || '').trim().match(/^(\d{2,5})\b/)?.[1] || null;
  return token && token !== civic ? token : null;
}
