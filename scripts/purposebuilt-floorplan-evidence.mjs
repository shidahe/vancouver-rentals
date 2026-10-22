const compact = value => String(value || '').replace(/\s+/g, ' ').trim();
const escapeRegExp = value => String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export function exactPurposeBuiltFloorplanEvidence(text, listing = {}) {
  if (listing.type !== 'purpose-built') return null;
  const label = compact(String(listing.unit || '').split('·').slice(1).join('·'));
  const expectedRent = Number(listing.rent);
  const expectedSqft = Number(listing.sqft);
  if (!label || !Number.isFinite(expectedRent) || !Number.isFinite(expectedSqft)) return null;

  const page = compact(text);
  const start = page.toLowerCase().indexOf(label.toLowerCase());
  if (start < 0) return null;
  const tail = page.slice(start);
  const guidedTour = tail.match(new RegExp(`GUIDED TOUR\\s+FOR\\s+${escapeRegExp(label)}`, 'i'));
  const segment = tail.slice(0, guidedTour ? guidedTour.index + guidedTour[0].length : 450);
  const rent = Number((segment.match(/Starting at\s*\$\s*([0-9,]+(?:\.\d{2})?)/i)?.[1] || '').replace(/,/g, ''));
  const sqft = Number((segment.match(/([0-9,]+)\s*Sq\.\s*Ft\./i)?.[1] || '').replace(/,/g, ''));
  const available = /VIEW AVAILABLE UNITS|AVAILABLE (?:NOW|ON|IMMEDIATELY)|MOVE-IN READY/i.test(segment);
  if (rent !== expectedRent || sqft !== expectedSqft || !available) return null;
  return { label, rent, sqft, segment };
}

const normalizedIdentityText = value => String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const exactPublicUnit = value => /^#?\d+[a-z]?$/i.test(String(value || '').trim());
const identitySlug = value => normalizedIdentityText(value).replace(/\s+/g, '-');

// Rent is intentionally excluded: it is a mutable listing fact, not a
// floorplan identity. Using marketplace keys that contain rent causes a price
// change to manufacture a second record for the same public floorplan.
export function purposeBuiltFloorplanId(buildingName = '', inventory = {}) {
  const building = identitySlug(buildingName);
  if (!building) return '';
  if (exactPublicUnit(inventory.unit)) return `${building}-unit-${identitySlug(inventory.unit)}`;
  const bedrooms = Number(inventory.bedrooms);
  const bathrooms = Number(inventory.bathrooms);
  const sqft = Number(inventory.sqft);
  if (!Number.isFinite(bedrooms) || !Number.isFinite(bathrooms) || !Number.isFinite(sqft)) return '';
  return `${building}-floorplan-${bedrooms}-bedroom-${bathrooms}-bath-${Math.round(sqft)}`;
}

export function samePurposeBuiltFloorplanIdentity(listing = {}, inventory = {}, buildingName = '') {
  if (inventory.unit || exactPublicUnit(listing.unit)) return false;
  return normalizedIdentityText(listing.buildingName) === normalizedIdentityText(buildingName) &&
    Number(listing.bedrooms) === Number(inventory.bedrooms) &&
    Number(listing.bathrooms) === Number(inventory.bathrooms) &&
    Number.isFinite(Number(listing.sqft)) &&
    Number.isFinite(Number(inventory.sqft)) &&
    Math.abs(Number(listing.sqft) - Number(inventory.sqft)) <= 5;
}
