import { bedroomEligible, rentEligible } from './discovery-policy.mjs';

// RentCafe's floor-plan table exposes exact units even when its price is
// withheld. Keep those units in the audit queue, never in published inventory.
export function rentCafeExactUnits(bodyText = '') {
  const text = String(bodyText);
  const sections = text.split(/(?=^Two Bedroom\s*$|^Three Bedroom\s*$|^Four Bedroom\s*$)/im);
  const units = [];
  for (const section of sections) {
    const beds = { two: 2, three: 3, four: 4 }[section.match(/^(Two|Three|Four) Bedroom\s*$/im)?.[1]?.toLowerCase()];
    if (!beds || !new RegExp(`${beds} Beds?\\s*\\/`, 'i').test(section)) continue;
    const table = section.split(/Unit\s+Base rent\s+Availability/i)[1]?.split(/Ratings and reviews|Check for available units/i)[0];
    if (!table) continue;
    for (const match of table.matchAll(/(?:^|\n)\s*(\d{3,5}[a-z]?)\s+(Ask for pricing|\$[\d,]+(?:\.\d{2})?)\s+(Now|(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d{1,2})\b/gi)) {
      if (!units.some(x => x.unit === match[1])) units.push({ unit: match[1], bedrooms: beds, rent: match[2].startsWith('$') ? Number(match[2].replace(/[$,]/g, '')) : null, availability: match[3] });
    }
  }
  return units;
}

export function rentCafeUnpricedUnits(bodyText = '') {
  return rentCafeExactUnits(bodyText).filter(x => x.rent === null).map(({unit, bedrooms, availability}) => ({unit, bedrooms, availability}));
}

export function aggregateUnitCount(jsonLd = []) {
  let maximum = 0;
  const visit = value => {
    if (!value) return;
    if (Array.isArray(value)) {
      for (const item of value) visit(item);
      return;
    }
    if (typeof value !== 'object') return;
    if (Array.isArray(value.containsPlace)) maximum = Math.max(maximum, value.containsPlace.length);
    for (const child of Object.values(value)) visit(child);
  };
  visit(jsonLd);
  return maximum;
}

export function structuredRentalInventories(jsonLd = []) {
  const rows = [];
  const visit = value => {
    if (!value) return;
    if (Array.isArray(value)) {
      for (const item of value) visit(item);
      return;
    }
    if (typeof value !== 'object') return;
    const price = Number(value.potentialAction?.priceSpecification?.price ?? value.offers?.price);
    const sqft = Number(value.floorSize?.value);
    const name = String(value.name || '');
    const bedrooms = Number(name.match(/\b([1-9]\d?)\s*(?:bedroom|bed|br)\b/i)?.[1]);
    if (Number.isFinite(price) && rentEligible(price) && price <= 15000 &&
        Number.isFinite(sqft) && sqft >= 200 && sqft <= 15000 && bedroomEligible(bedrooms)) {
      const key = `${bedrooms}:${price}:${sqft}`;
      if (!rows.some(row => row.key === key)) rows.push({ key, name, bedrooms, rent: price, sqft });
    }
    for (const child of Object.values(value)) visit(child);
  };
  visit(jsonLd);
  return rows;
}

export function discoveredStructuredInventories(jsonLd = [], defaults = {}) {
  return structuredRentalInventories(jsonLd).map(row => ({
    key: `${row.bedrooms}-bedroom-${Math.round(row.sqft)}-${Math.round(row.rent)}`,
    label: `${row.name || `${row.bedrooms} Bedroom`} · ${Math.round(row.sqft)} sqft · $${Math.round(row.rent).toLocaleString('en-CA')}`,
    bedrooms: row.bedrooms,
    bathrooms: defaults.bathrooms ?? null,
    sqft: row.sqft,
    rent: row.rent,
    unit: null,
    requiredSignals: [Math.round(row.rent).toLocaleString('en-CA'), String(Math.round(row.sqft))],
    availabilitySignals: defaults.availabilitySignals || [],
    dynamicallyDiscovered: true
  }));
}
