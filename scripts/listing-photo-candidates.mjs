const uniq = values => [...new Set((values || []).filter(Boolean))];

const unwantedAsset = /(?:logo|icon|avatar|sprite|favicon|placeholder|share-preview|developer_placeholder|agent_placeholder)/i;

function normalizeMarketplacePhoto(url) {
  try {
    const parsed=new URL(url);
    if(/^map\d*\.craigslist\.org$/i.test(parsed.hostname))return null;
    if(parsed.hostname==='images.craigslist.org')parsed.pathname=parsed.pathname.replace(/_[0-9]+x[0-9]+[a-z]?\.(jpe?g|png|webp)$/i,'_600x450.$1');
    return parsed.href;
  } catch {
    return null;
  }
}

function rewAssetGroup(url) {
  try {
    const parsed = new URL(url);
    if (parsed.hostname !== 'assets-listings.rew.ca') return null;
    return `${parsed.origin}${parsed.pathname.slice(0, parsed.pathname.lastIndexOf('/'))}`;
  } catch {
    return null;
  }
}

export function verifiedPhotoCandidates(urls) {
  const candidates = uniq((urls||[]).map(normalizeMarketplacePhoto)).filter(url =>
    /^https?:\/\//i.test(url) && !unwantedAsset.test(url) && !/\.svg(?:\?|$)/i.test(url)
  );

  // REW pages include thumbnails for nearby properties after the subject gallery.
  // The subject photos share one asset directory, so retain the largest repeated
  // listing group rather than mixing in unrelated recommendations.
  const groups = new Map();
  for (const url of candidates) {
    const key = rewAssetGroup(url);
    if (!key) continue;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(url);
  }
  const subjectGroup = [...groups.values()].sort((a, b) => b.length - a.length)[0];
  if (subjectGroup?.length >= 2) return subjectGroup;

  return candidates;
}
