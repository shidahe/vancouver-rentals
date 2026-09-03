const RENT_CAPTURE = '([0-9]{1,2}(?:,[0-9]{3})|[0-9]{4,5})';

export function moneyMatches(text = '') {
  const pattern = new RegExp(`\\$\\s?${RENT_CAPTURE}(?:\\.00)?\\b`, 'g');
  return [...text.matchAll(pattern)]
    .map(match => Number(match[1].replace(',', '')))
    .filter(value => value >= 2500 && value <= 12000);
}

export function firstLikelyRent(text = '', jsonLd = []) {
  const structured = [];
  const walk = value => {
    if (!value) return;
    if (Array.isArray(value)) return value.forEach(walk);
    if (typeof value !== 'object') return;
    for (const [key, child] of Object.entries(value)) {
      if (/^(price|lowPrice|highPrice)$/i.test(key)) {
        const amount = Number(String(child).replace(/[^0-9.]/g, ''));
        if (amount >= 2500 && amount <= 12000) structured.push(amount);
      }
      walk(child);
    }
  };
  jsonLd.forEach(walk);
  if (structured.length) return structured[0];

  const contextual = [
    new RegExp(`monthly\\s+rent[^$]{0,80}\\$\\s?${RENT_CAPTURE}`, 'i'),
    new RegExp(`rent\\s*(?:price)?\\s*[:\\-]?[^$]{0,50}\\$\\s?${RENT_CAPTURE}`, 'i'),
    new RegExp(`\\$\\s?${RENT_CAPTURE}\\s*(?:\\/\\s*mo|per\\s+month|monthly)`, 'i')
  ];
  for (const pattern of contextual) {
    const match = text.match(pattern);
    if (match) return Number(match[1].replace(',', ''));
  }
  return moneyMatches(text)[0] ?? null;
}

export function parseFacts(text = '') {
  // Browser innerText can collapse adjacent responsive fields into strings such as
  // "2 Bed2 Bath741 SqftAvailable". Restore those visual boundaries before parsing
  // so a later building description cannot override the exact unit summary.
  const spaced = text
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/([A-Za-z])(\d)/g, '$1 $2');
  const beds = spaced.match(/\b([1-5](?:\.5)?)\s*(?:bedrooms?|beds?|br)\b/i) || spaced.match(/\b(two|three|four|five)\s+bedrooms?\b/i);
  const baths = spaced.match(/\b([1-5](?:\.5)?)\s*(?:bathrooms?|baths?|ba)\b/i);
  const sqft = spaced.match(/\b([3-9][0-9]{2}|[1-9][0-9]{3})\s*(?:sq\.?\s*ft|sqft|ft²|square feet)\b/i);
  const year = spaced.match(/(?:year built|built in|built)\s*[:\-]?\s*(19[5-9][0-9]|20[0-2][0-9])/i);
  const orientation = spaced.match(/\b(north(?:east|west)?|south(?:east|west)?|east|west)[- ]facing\b/i)?.[1] || null;
  const wordNum = value => ({ two: 2, three: 3, four: 4, five: 5 }[value] ?? Number(value));
  return {
    bedrooms: beds ? wordNum(beds[1].toLowerCase()) : null,
    bathrooms: baths ? Number(baths[1]) : null,
    sqft: sqft ? Number(sqft[1]) : null,
    buildingYear: year ? Number(year[1]) : null,
    ac: /\b(?:air conditioning|air conditioned|central ac|central a\/c)\b/i.test(spaced) ? true : null,
    parking: /\b(?:assigned parking|parking included|1 parking|one parking|parking spot)\b/i.test(spaced) ? true : null,
    petFriendly: /\b(?:pet friendly|pets allowed|dogs ok|cats ok|dog friendly|cat friendly)\b/i.test(spaced) ? true : null,
    orientation: orientation ? orientation.replace(/north/i, 'N').replace(/south/i, 'S').replace(/east/i, 'E').replace(/west/i, 'W') : null,
    balcony: /\b(?:balcony|private patio|patio)\b/i.test(spaced) ? true : null,
    largeWindows: /\b(?:large windows|floor.to.ceiling windows|over height windows|oversized windows)\b/i.test(spaced) ? true : null,
    modernInterior: /\b(?:miele|fisher\s*&\s*paykel|caesarstone|quartz|renovated|modern interior|waterfall island)\b/i.test(spaced) ? true : null
  };
}
