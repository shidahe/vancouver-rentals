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
    if (Number.isFinite(price) && price >= 1500 && price <= 15000 &&
        Number.isFinite(sqft) && sqft >= 200 && sqft <= 15000 && bedrooms >= 2) {
      const key = `${bedrooms}:${price}:${sqft}`;
      if (!rows.some(row => row.key === key)) rows.push({ key, name, bedrooms, rent: price, sqft });
    }
    for (const child of Object.values(value)) visit(child);
  };
  visit(jsonLd);
  return rows;
}
