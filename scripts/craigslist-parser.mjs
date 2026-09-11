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
