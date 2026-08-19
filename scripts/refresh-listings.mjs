import fs from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';

const ROOT = process.cwd();
const DATA = path.join(ROOT, 'data');
const EVIDENCE = path.join(DATA, 'evidence');
const now = new Date();
const iso = now.toISOString();
const today = iso.slice(0, 10);
const readJson = async (p, fallback) => { try { return JSON.parse(await fs.readFile(p, 'utf8')); } catch { return fallback; } };
const writeJson = async (p, v) => { await fs.mkdir(path.dirname(p), { recursive: true }); await fs.writeFile(p, JSON.stringify(v, null, 2) + '\n'); };
const norm = s => (s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const moneyMatches = text => [...text.matchAll(/\$\s?([2-9][0-9]{3})(?:\.00)?\b/g)].map(m => Number(m[1]));
const firstLikelyRent = text => {
  const vals = moneyMatches(text).filter(v => v >= 2500 && v <= 12000);
  return vals.length ? vals[0] : null;
};
const negativePatterns = [
  /gone too soon/i,
  /listing is no longer available/i,
  /no longer available/i,
  /this rental is unavailable/i,
  /rented\b/i,
  /off market/i,
  /listing.*inactive/i,
  /\binactive\b/i
];
const positivePatterns = [/available now/i, /for rent/i, /now renting/i, /available\s+(?:immediately|[a-z]{3,9}\s+\d{1,2})/i];

function identityTokens(listing) {
  const address = norm(listing.address);
  const number = (listing.address || '').match(/^\s*(\d+)/)?.[1];
  const street = address.split(' ').slice(1, 4).join(' ');
  const unit = String(listing.unit || '').match(/\b(?:unit\s*)?#?([0-9]{2,5})\b/i)?.[1] || null;
  return { address, number, street, unit };
}

function identityMatch(text, listing) {
  const t = norm(text);
  const { number, street, unit } = identityTokens(listing);
  if (!number || !t.includes(number)) return false;
  const streetBits = street.split(' ').filter(x => x.length > 2);
  if (streetBits.length && !streetBits.some(x => t.includes(x))) return false;
  if (unit && listing.type === 'condo') {
    const unitRe = new RegExp(`(?:unit|#|\\b)\\s*${unit}\\b`, 'i');
    return unitRe.test(text) || t.includes(`${unit} ${number}`) || t.includes(`${number} ${street}`);
  }
  return true;
}

function classify(text, listing) {
  const idMatch = identityMatch(text, listing);
  const negative = negativePatterns.find(r => r.test(text));
  const positive = positivePatterns.find(r => r.test(text));
  return {
    identityMatch: idMatch,
    explicitNegative: idMatch && !!negative,
    negativePhrase: negative ? String(negative) : null,
    explicitPositive: idMatch && !!positive,
    positivePhrase: positive ? String(positive) : null,
    extractedRent: idMatch ? firstLikelyRent(text) : null
  };
}

async function visit(page, url) {
  const started = Date.now();
  let response = null;
  try {
    response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
    await page.waitForTimeout(2500);
    const bodyText = await page.locator('body').innerText({ timeout: 10000 });
    const title = await page.title();
    const links = await page.locator('a').evaluateAll(as => as.slice(0, 1200).map(a => ({ href: a.href, text: (a.innerText || '').trim() })));
    return {
      ok: true,
      status: response?.status() ?? null,
      finalUrl: page.url(),
      title,
      bodyText: bodyText.slice(0, 120000),
      links,
      elapsedMs: Date.now() - started
    };
  } catch (error) {
    return { ok: false, error: String(error), status: response?.status() ?? null, finalUrl: page.url(), elapsedMs: Date.now() - started };
  }
}

function isTargetCandidate(text) {
  const t = norm(text);
  const area = /(kitsilano|point grey|west point grey|arbutus|dunbar|quilchena|vancouver)/i.test(text);
  const beds = /(2\s*(?:bed|br)|two bedroom)/i.test(text);
  return area && beds && !/(roommate|shared room|room for rent)/i.test(t);
}

function candidateFromLink(source, link) {
  const text = (link.text || '').replace(/\s+/g, ' ').trim();
  if (!link.href || !/^https?:/i.test(link.href)) return null;
  if (!isTargetCandidate(text)) return null;
  const price = firstLikelyRent(text);
  const sqft = Number(text.match(/([7-9][0-9]{2}|1[0-9]{3})\s*(?:sq\.?\s*ft|sqft)/i)?.[1] || 0) || null;
  return { sourceId: source.id, sourceName: source.name, url: link.href, cardText: text.slice(0, 1000), discoveredAt: iso, indexedPrice: price, sqft };
}

const listingsPath = path.join(DATA, 'listings.json');
const historyPath = path.join(DATA, 'history.json');
const sourcesPath = path.join(DATA, 'live-sources.json');
const candidatesPath = path.join(DATA, 'candidates.json');
const refreshStatePath = path.join(DATA, 'refresh-state.json');
const payload = await readJson(listingsPath, { meta: {}, listings: [] });
const history = await readJson(historyPath, {});
const sources = await readJson(sourcesPath, { discovery: [], seedCandidates: [] });
const previousState = await readJson(refreshStatePath, { listings: {} });
const previousCandidates = await readJson(candidatesPath, []);

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  locale: 'en-CA',
  timezoneId: 'America/Vancouver',
  viewport: { width: 1440, height: 1200 },
  userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/126 Safari/537.36'
});
const page = await context.newPage();
const state = { refreshedAt: iso, listings: {}, sources: {} };

for (const listing of payload.listings.filter(x => ['active', 'needs_confirmation'].includes(x.availabilityStatus))) {
  const result = await visit(page, listing.url);
  const evidence = { checkedAt: iso, listingId: listing.id, sourceUrl: listing.url, ...result };
  if (result.ok) Object.assign(evidence, classify(result.bodyText, listing));
  const safeEvidence = { ...evidence };
  if (safeEvidence.bodyText) safeEvidence.bodyText = safeEvidence.bodyText.slice(0, 30000);
  if (safeEvidence.links) safeEvidence.links = safeEvidence.links.slice(0, 100);
  await writeJson(path.join(EVIDENCE, `${listing.id}.json`), safeEvidence);

  const prev = previousState.listings?.[listing.id] || {};
  const failures = result.ok ? 0 : (prev.consecutiveFailures || 0) + 1;
  state.listings[listing.id] = {
    checkedAt: iso,
    ok: result.ok,
    status: result.status ?? null,
    finalUrl: result.finalUrl || null,
    consecutiveFailures: failures,
    identityMatch: evidence.identityMatch ?? false,
    explicitNegative: evidence.explicitNegative ?? false,
    explicitPositive: evidence.explicitPositive ?? false,
    extractedRent: evidence.extractedRent ?? null
  };

  if (result.ok && evidence.explicitNegative) {
    listing.availabilityStatus = 'removed';
    listing.status = 'removed';
    listing.removedAt = today;
    listing.lastChecked = today;
    listing.verifiedAt = iso;
    listing.verificationMethod = 'Automated live browser check found an explicit inactive/unavailable signal on the matching listing page.';
    listing.dataNotes = `${listing.dataNotes || ''} AUTO-REMOVED ${today}: live page explicitly indicates unavailable/inactive.`.trim();
    history[listing.id] ||= [];
    history[listing.id].push({ date: today, rent: listing.rent ?? null, note: 'AUTO-REMOVED after direct live page showed unavailable/inactive.' });
    continue;
  }

  if (!result.ok && listing.availabilityStatus === 'active' && failures >= 2) {
    listing.availabilityStatus = 'needs_confirmation';
    listing.status = 'unchanged';
    listing.lastChecked = today;
    listing.verificationMethod = `Automated live verification failed ${failures} consecutive times; hidden pending confirmation rather than assumed active.`;
    listing.dataNotes = `${listing.dataNotes || ''} AUTO-HIDDEN ${today}: repeated live verification failure.`.trim();
    history[listing.id] ||= [];
    history[listing.id].push({ date: today, rent: listing.rent ?? null, note: `AUTO-HIDDEN after ${failures} consecutive live verification failures.` });
    continue;
  }

  if (result.ok && evidence.identityMatch) {
    listing.lastChecked = today;
    listing.verifiedAt = iso;
    if (evidence.explicitPositive) listing.verificationMethod = 'Automated live browser check matched listing identity and found current availability wording.';

    // Price auto-update is intentionally conservative: only direct Zumper/RentFaster detail pages.
    const host = new URL(result.finalUrl || listing.url).hostname;
    const priceSafeHost = /(^|\.)(zumper\.com|rentfaster\.ca)$/i.test(host);
    const newRent = evidence.extractedRent;
    if (priceSafeHost && newRent && listing.rent && newRent !== listing.rent && Math.abs(newRent - listing.rent) <= 2500) {
      const oldRent = listing.rent;
      listing.rent = newRent;
      listing.status = newRent < oldRent ? 'price_drop' : 'unchanged';
      listing.priceDrop = newRent < oldRent;
      history[listing.id] ||= [];
      history[listing.id].push({ date: today, rent: newRent, note: `AUTO price update from ${oldRent} to ${newRent} after direct live detail-page verification.` });
    }
  }
}

const discovered = [];
for (const source of sources.discovery || []) {
  const result = await visit(page, source.url);
  state.sources[source.id] = { checkedAt: iso, ok: result.ok, status: result.status ?? null, finalUrl: result.finalUrl || null, error: result.error || null };
  await writeJson(path.join(EVIDENCE, `source-${source.id}.json`), { checkedAt: iso, source, ...result, bodyText: result.bodyText?.slice(0, 30000), links: result.links?.slice(0, 150) });
  if (!result.ok) continue;
  for (const link of result.links || []) {
    const c = candidateFromLink(source, link);
    if (c) discovered.push(c);
  }
}

for (const seed of sources.seedCandidates || []) {
  const result = await visit(page, seed.url);
  const direct = result.ok ? {
    ...seed,
    discoveredAt: iso,
    liveCheckedAt: iso,
    liveStatus: result.status,
    finalUrl: result.finalUrl,
    livePrice: firstLikelyRent(result.bodyText),
    explicitNegative: negativePatterns.some(r => r.test(result.bodyText)),
    pageTextSample: result.bodyText.slice(0, 3000)
  } : { ...seed, discoveredAt: iso, liveCheckedAt: iso, error: result.error };
  discovered.push(direct);
  await writeJson(path.join(EVIDENCE, `candidate-${seed.id}.json`), direct);
}

const byUrl = new Map();
for (const c of [...previousCandidates, ...discovered]) {
  if (!c.url) continue;
  const old = byUrl.get(c.url);
  if (!old || new Date(c.liveCheckedAt || c.discoveredAt || 0) >= new Date(old.liveCheckedAt || old.discoveredAt || 0)) byUrl.set(c.url, c);
}
const candidates = [...byUrl.values()].sort((a, b) => new Date(b.liveCheckedAt || b.discoveredAt || 0) - new Date(a.liveCheckedAt || a.discoveredAt || 0));

payload.meta ||= {};
payload.meta.lastAutomatedRefresh = iso;
payload.meta.automationNote = 'Live Playwright verifier revalidates current inventory; discovery candidates are collected separately and are not auto-published without sufficient structured evidence.';

await writeJson(listingsPath, payload);
await writeJson(historyPath, history);
await writeJson(candidatesPath, candidates.slice(0, 300));
await writeJson(refreshStatePath, state);
await browser.close();

console.log(`Verified ${Object.keys(state.listings).length} listings; collected ${candidates.length} candidates.`);
