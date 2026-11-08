export function zumperUnitIsDuplicatedCivic(unit = '', street = '', url = '') {
  const token = String(unit || '').trim().replace(/^#/, '').toUpperCase();
  const civic = String(street || '').trim().match(/^(\d{2,5})\b/)?.[1] || null;
  if (!token || !civic || token !== civic) return false;
  return new RegExp('/address/' + civic + '-' + civic + '(?:-|$)', 'i').test(String(url || '')) ||
    new RegExp('^' + civic + '\\s*[-–]\\s*' + civic + '\\b', 'i').test(String(street || ''));
}

export function zumperStructuredStreetAndUnit(street = '') {
  let value = String(street || '').trim();
  let unit = null;
  const token = raw => {
    const normalized = String(raw || '').trim().replace(/^#/, '');
    return /^(?=[A-Za-z0-9-]*\d)[A-Za-z0-9-]{1,12}$/.test(normalized) ? normalized.toUpperCase() : null;
  };
  let match = value.match(/^#?([A-Za-z0-9-]*\d[A-Za-z0-9-]*)\s*[-–]\s*(\d{3,5}\b.*)$/i);
  if (match && token(match[1])) {
    unit = token(match[1]);
    value = match[2].trim();
    // Zumper occasionally duplicates the civic number in structured addresses,
    // e.g. "1277-1277 Hornby St". That is an address artefact, not unit 1277.
    const civic = value.match(/^(\d{2,5})\b/)?.[1] || null;
    if (zumperUnitIsDuplicatedCivic(unit, String(street || ''))) unit = null;
  }
  if (!unit) {
    match = value.match(/^(.*?)(?:\s+|,\s*)(?:unit|suite|apt|#)\s*([A-Za-z0-9-]*\d[A-Za-z0-9-]*)\s*$/i);
    if (match && token(match[2])) {
      value = match[1].trim();
      unit = token(match[2]);
    }
  }
  return { street: value, unit };
}

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
  // A bare hash may be a transit route (for example "#99 B-Line"), not a
  // unit. Hash-only unit identifiers are accepted from the structured street
  // address by splitStreetAndUnit; free text must include an explicit label.
  const match = text.match(/\b(?:unit|suite|apt)\s+(?:#\s*)?([A-Za-z0-9-]*\d[A-Za-z0-9-]*)\b/i);
  const token = match?.[1]?.toUpperCase() || null;
  const civic = String(street || '').trim().match(/^(\d{2,5})\b/)?.[1] || null;
  return token && token !== civic ? token : null;
}

export function zumperUnitCards(pageText = '') {
  const lines = String(pageText || '').split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  const cards = new Map();
  for (let index = 0; index < lines.length; index += 1) {
    const unit = lines[index].match(/^#?((?=[A-Za-z0-9-]*\d)[A-Za-z0-9-]{1,12})$/)?.[1]?.toUpperCase();
    if (!unit) continue;
    const block = lines.slice(index + 1, index + 14).join('\n');
    const bedrooms = Number(block.match(/\b([1-5](?:\.5)?)\s*(?:bedrooms?|beds?|br)\b/i)?.[1] || 0) || null;
    const bathrooms = Number(block.match(/\b([1-5](?:\.5)?)\s*(?:bathrooms?|baths?|ba)\b/i)?.[1] || 0) || null;
    const sqft = Number((block.match(/\b([0-9]{1,2}(?:,[0-9]{3})|[0-9]{3,4})\s*(?:sq\.?\s*ft|sqft|ft²|square feet)\b/i)?.[1] || '').replace(',', '')) || null;
    const rent = Number((block.match(/(?:^|\n)\$\s*([0-9]{1,2}(?:,[0-9]{3})?)(?:\s|$)/)?.[1] || '').replace(',', '')) || null;
    if (!bedrooms || !bathrooms || !sqft || rent < 2500 || rent > 12000) continue;
    cards.set(unit, { unit, rent, bedrooms, bathrooms, sqft });
  }
  return [...cards.values()];
}

export function zumperUnitRent(pageText = '', unit = '') {
  const token = String(unit || '').trim().replace(/^#/, '');
  if (!token || !/^(?=[A-Za-z0-9-]*\d)[A-Za-z0-9-]{1,12}$/.test(token)) return null;

  const lines = String(pageText || '').split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  const unitLine = new RegExp(`^(?:unit|suite|apt|#)?\\s*${token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i');
  const start = lines.findIndex(line => unitLine.test(line));
  if (start < 0) return null;

  // Zumper address pages can contain several live units. Restrict the price
  // lookup to the selected unit card so AggregateOffer.lowPrice from another
  // unit cannot suppress a qualifying 2BR+ inventory.
  for (const line of lines.slice(start + 1, start + 18)) {
    const match = line.match(/^\$([0-9]{1,2}(?:,[0-9]{3})?)(?:\s|$)/);
    if (!match) continue;
    const rent = Number(match[1].replace(',', ''));
    return rent >= 2500 && rent <= 12000 ? rent : null;
  }
  return null;
}
