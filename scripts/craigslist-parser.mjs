export function normalizeCraigslistDetailUrl(raw, base = 'https://vancouver.craigslist.org') {
  try {
    const url = new URL(String(raw || ''), base);
    if (!/^https?:$/.test(url.protocol) || !/(^|\.)craigslist\.org$/i.test(url.hostname)) return null;
    if (!/^\/[a-z]{3}\/apa\/d\/[^/]+\/\d+\.html$/i.test(url.pathname)) return null;
    url.hash = '';
    url.search = '';
    return url.href;
  } catch {
    return null;
  }
}

export function craigslistPostId(url) {
  return String(url || '').match(/\/(\d+)\.html$/)?.[1] || null;
}
