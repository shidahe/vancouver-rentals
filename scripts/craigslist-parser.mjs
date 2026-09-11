export function normalizeCraigslistDetailUrl(raw, base = 'https://vancouver.craigslist.org') {
  try {
    const url = new URL(String(raw || ''), base);
    if (!/^https?:$/.test(url.protocol) || !/(^|\.)craigslist\.org$/i.test(url.hostname)) return null;
    // Craigslist has used both subarea paths (`/van/apa/...`) and
    // location paths (`/vancouver-bc/apa/...`) on its canonical hosts.
    if (!/^\/(?:[a-z0-9-]+\/){0,2}apa\/d\/[^/]+\/\d+\.html$/i.test(url.pathname)) return null;
    url.hash = '';
    url.search = '';
    return url.href;
  } catch {
    return null;
  }
}

export function extractCraigslistDetailUrls(html, base = 'https://vancouver.craigslist.org') {
  const decoded = String(html || '').replaceAll('\\/', '/').replaceAll('&amp;', '&');
  const matches = decoded.match(/(?:https?:\/\/[^"'<>\s]+)?\/(?:[a-z0-9-]+\/){0,2}apa\/d\/[^"'<>\s/]+\/\d+\.html(?:\?[^"'<>\s]*)?/gi) || [];
  return [...new Set(matches.map(value => normalizeCraigslistDetailUrl(value, base)).filter(Boolean))];
}

export function craigslistPostId(url) {
  return String(url || '').match(/\/(\d+)\.html$/)?.[1] || null;
}
