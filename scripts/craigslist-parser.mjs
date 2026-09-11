export function normalizeCraigslistDetailUrl(raw, base = 'https://vancouver.craigslist.org') {
  try {
    const url = new URL(String(raw || ''), base);
    if (!/^https?:$/.test(url.protocol) || !/(^|\.)craigslist\.org$/i.test(url.hostname)) return null;
    // Craigslist has used both legacy numeric `.html` links and its current
    // `/view/d/<slug>/<opaque-id>` links on the shared www host.
    const legacy=/^\/(?:[a-z0-9-]+\/){0,2}apa\/d\/[^/]+\/\d+\.html$/i.test(url.pathname);
    const current=/^\/view\/d\/[^/]+\/[a-z0-9_-]+$/i.test(url.pathname);
    if (!legacy && !current) return null;
    url.hash = '';
    url.search = '';
    return url.href;
  } catch {
    return null;
  }
}

export function extractCraigslistDetailUrls(html, base = 'https://vancouver.craigslist.org') {
  const decoded = String(html || '').replaceAll('\\/', '/').replaceAll('&amp;', '&');
  const matches = decoded.match(/(?:https?:\/\/[^"'<>\s]+)?(?:\/(?:[a-z0-9-]+\/){0,2}apa\/d\/[^"'<>\s/]+\/\d+\.html|\/view\/d\/[^"'<>\s/]+\/[a-z0-9_-]+)(?:\?[^"'<>\s]*)?/gi) || [];
  return [...new Set(matches.map(value => normalizeCraigslistDetailUrl(value, base)).filter(Boolean))];
}

export function craigslistPostId(url) {
  const value=String(url || '');
  return value.match(/\/(\d+)\.html$/)?.[1] || value.match(/\/view\/d\/[^/]+\/([a-z0-9_-]+)$/i)?.[1] || null;
}

const numberFrom = (pattern, value) => {
  const match = String(value || '').match(pattern);
  return match ? Number(match[1].replaceAll(',', '')) : null;
};

export function parseCraigslistSearchCard(card = {}, base = 'https://vancouver.craigslist.org') {
  const url = normalizeCraigslistDetailUrl(card.href || card.url, base);
  if (!url) return null;
  const text = [card.title, card.text, card.location].filter(Boolean).join('\n');
  const rent = numberFrom(/\$\s*((?:[1-9][0-9]{0,2}(?:,[0-9]{3})+)|(?:[1-9][0-9]{2,4}))/, text);
  const bedrooms = numberFrom(/(?:^|[^0-9])([1-5])\s*(?:br\b|beds?\b|bedrooms?\b)/i, text);
  const bathrooms = numberFrom(/(?:^|[^0-9])([1-5](?:\.5)?)\s*(?:ba\b|baths?\b|bathrooms?\b)/i, text);
  const sqft = numberFrom(/(?:^|[^0-9])([1-9][0-9]?,[0-9]{3}|[0-9]{3,4})\s*(?:ft\s*2\b|ft\^?2\b|sq\.?\s*ft\.?\b|sqft\b|square\s+feet\b)/i, text);
  const latitude = Number(card.latitude ?? card.lat);
  const longitude = Number(card.longitude ?? card.lng);
  const geo = Number.isFinite(latitude) && Number.isFinite(longitude) ? { lat: latitude, lng: longitude } : null;
  const suppliedPostId = String(card.postId || card.dataPid || '').trim();
  const postId = suppliedPostId || craigslistPostId(url);
  return {
    url,
    postId,
    title: String(card.title || '').trim() || String(card.text || '').trim().split('\n')[0] || null,
    text: String(card.text || '').trim(),
    location: String(card.location || '').trim() || null,
    rent,
    bedrooms,
    bathrooms,
    sqft,
    geo,
    image: /^https?:\/\//i.test(String(card.image || '')) ? String(card.image) : null,
    postedOrUpdatedAt: card.datetime && Number.isFinite(Date.parse(card.datetime)) ? new Date(card.datetime).toISOString() : null
  };
}
