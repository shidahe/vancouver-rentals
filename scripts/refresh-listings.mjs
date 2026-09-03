import fs from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';
import { firstLikelyRent, parseFacts } from './listing-parser.mjs';
import { findExistingSeedListing } from './inventory-identity.mjs';
import { verifiedPhotoCandidates } from './listing-photo-candidates.mjs';

const ROOT = process.cwd();
const DATA = path.join(ROOT, 'data');
const EVIDENCE = path.join(DATA, 'evidence');
const imageSourcesPath = path.join(DATA, 'image-sources.json');
const now = new Date();
const iso = now.toISOString();
const today = iso.slice(0, 10);

const readJson = async (p, fallback) => { try { return JSON.parse(await fs.readFile(p, 'utf8')); } catch { return fallback; } };
const writeJson = async (p, v) => { await fs.mkdir(path.dirname(p), { recursive: true }); await fs.writeFile(p, JSON.stringify(v, null, 2) + '\n'); };
const norm = s => (s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const uniq = xs => [...new Set(xs.filter(Boolean))];

const strongNegativePatterns = [
  /gone too soon/i,
  /listing is no longer available/i,
  /this listing is no longer available/i,
  /this rental is unavailable/i,
  /this property is unavailable/i,
  /listing status\s*[:\-]?\s*inactive/i,
  /this listing is inactive/i,
  /status\s*[:\-]?\s*inactive/i,
  /currently off market/i,
  /listing has been rented/i,
  /this unit has been rented/i
];
const positivePatterns = [
  /available now/i,
  /for rent/i,
  /now renting/i,
  /check availability/i,
  /request (?:a )?tour/i,
  /available\s+(?:immediately|[a-z]{3,9}\s+\d{1,2})/i
];

function identityTokens(item) {
  const address = norm(item.address);
  const number = (item.address || '').match(/^\s*(\d+)/)?.[1];
  const street = address.split(' ').slice(1, 4).join(' ');
  const unit = String(item.unit || '').match(/\b(?:unit\s*)?#?([0-9]{2,5})\b/i)?.[1] || null;
  return { address, number, street, unit };
}

function identityMatch(text, item) {
  const t = norm(text);
  const { number, street, unit } = identityTokens(item);
  if (!number || !t.includes(number)) return false;
  const streetBits = street.split(' ').filter(x => x.length > 2 && !['street','avenue','road'].includes(x));
  if (streetBits.length && !streetBits.some(x => t.includes(x))) return false;
  if (unit && item.type === 'condo') {
    const unitRe = new RegExp(`(?:unit|#|\\b)\\s*${unit}\\b`, 'i');
    return unitRe.test(text) || t.includes(`${unit} ${number}`) || t.includes(`${number} ${street}`);
  }
  return true;
}

function classify(text, item, jsonLd = [], httpStatus = null) {
  const idMatch = identityMatch(text, item);
  const negative = strongNegativePatterns.find(r => r.test(text));
  const positive = positivePatterns.find(r => r.test(text));
  const hardHttpGone = [404, 410].includes(httpStatus);
  return {
    identityMatch: idMatch,
    explicitNegative: (idMatch && !!negative) || hardHttpGone,
    negativePhrase: hardHttpGone ? `HTTP ${httpStatus}` : negative ? String(negative) : null,
    explicitPositive: idMatch && !!positive && !negative,
    positivePhrase: positive ? String(positive) : null,
    extractedRent: idMatch ? firstLikelyRent(text, jsonLd) : null,
    facts: idMatch ? parseFacts(text) : {}
  };
}

async function visit(page, url) {
  const started = Date.now();
  let response = null;
  try {
    response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
    await page.waitForTimeout(3000);
    const bodyText = await page.locator('body').innerText({ timeout: 10000 });
    const title = await page.title();
    const links = await page.locator('a').evaluateAll(as => as.slice(0, 1500).map(a => ({ href: a.href, text: (a.innerText || '').trim() })));
    const jsonLdRaw = await page.locator('script[type="application/ld+json"]').evaluateAll(nodes => nodes.map(n => n.textContent || '').slice(0, 50));
    const socialImages = await page.locator('meta[property="og:image"], meta[name="twitter:image"]')
      .evaluateAll(nodes => nodes.map(node => node.content).filter(Boolean));
    const images = await page.locator('img').evaluateAll(imgs => imgs.slice(0, 100).map(img => img.currentSrc || img.src).filter(Boolean));
    const jsonLd = [];
    for (const raw of jsonLdRaw) { try { jsonLd.push(JSON.parse(raw)); } catch {} }
    return {
      ok: true,
      status: response?.status() ?? null,
      finalUrl: page.url(),
      title,
      bodyText: bodyText.slice(0, 120000),
      links,
      jsonLd,
      images: uniq([...socialImages, ...images]).slice(0, 50),
      elapsedMs: Date.now() - started
    };
  } catch (error) {
    return { ok: false, error: String(error), status: response?.status() ?? null, finalUrl: page.url(), elapsedMs: Date.now() - started };
  }
}

async function geocodeVancouver(address) {
  try {
    const q = encodeURIComponent(address);
    const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=3&countrycodes=ca&q=${q}`;
    const res = await fetch(url, { headers: { 'User-Agent': 'vancouver-rentals-github-action/1.0' } });
    if (!res.ok) return null;
    const rows = await res.json();
    for (const row of rows) {
      const lat = Number(row.lat), lng = Number(row.lon);
      if (lat >= 49.19 && lat <= 49.33 && lng >= -123.30 && lng <= -123.02) return { lat, lng, displayName: row.display_name };
    }
  } catch {}
  return null;
}

function isTargetCandidate(text) {
  const t = norm(text);
  const area = /(kitsilano|point grey|west point grey|arbutus|dunbar|quilchena|vancouver)/i.test(text);
  const numericBeds = Number(text.match(/\b([2-9])(?:\.5)?\s*(?:bedrooms?|beds?|br)\b/i)?.[1] || 0);
  const beds = numericBeds >= 2 || /\b(?:two|three|four|five)\s+bedrooms?\b/i.test(text);
  return area && beds && !/(roommate|shared room|room for rent)/i.test(t);
}

function candidateFromLink(source, link) {
  const text = (link.text || '').replace(/\s+/g, ' ').trim();
  if (!link.href || !/^https?:/i.test(link.href)) return null;
  if (!isTargetCandidate(text)) return null;
  const price = firstLikelyRent(text, []);
  const facts = parseFacts(text);
  return {
    sourceId: source.id,
    sourceName: source.name,
    url: link.href,
    cardText: text.slice(0, 1000),
    discoveredAt: iso,
    indexedPrice: price,
    bedrooms: facts.bedrooms,
    bathrooms: facts.bathrooms,
    sqft: facts.sqft
  };
}

function mergeHints(live, hints = {}) {
  const out = { ...hints };
  for (const [k, v] of Object.entries(live || {})) if (v !== null && v !== undefined) out[k] = v;
  return out;
}

const listingsPath = path.join(DATA, 'listings.json');
const historyPath = path.join(DATA, 'history.json');
const sourcesPath = path.join(DATA, 'live-sources.json');
const candidatesPath = path.join(DATA, 'candidates.json');
const refreshStatePath = path.join(DATA, 'refresh-state.json');
const payload = await readJson(listingsPath, { meta: {}, listings: [] });
const history = await readJson(historyPath, {});
const sources = await readJson(sourcesPath, { discovery: [], seedCandidates: [] });
const imageSources = await readJson(imageSourcesPath, {});
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
const state = { refreshedAt: iso, listings: {}, sources: {}, autoPublished: [] };

for (const listing of payload.listings.filter(x => ['active', 'needs_confirmation'].includes(x.availabilityStatus))) {
  const result = await visit(page, listing.url);
  const evidence = { checkedAt: iso, listingId: listing.id, sourceUrl: listing.url, ...result };
  if (result.ok) Object.assign(evidence, classify(result.bodyText, listing, result.jsonLd, result.status));
  else if ([404, 410].includes(result.status)) Object.assign(evidence, { explicitNegative: true, negativePhrase: `HTTP ${result.status}`, identityMatch: true });

  const safeEvidence = { ...evidence };
  if (safeEvidence.bodyText) safeEvidence.bodyText = safeEvidence.bodyText.slice(0, 30000);
  if (safeEvidence.links) safeEvidence.links = safeEvidence.links.slice(0, 100);
  if (safeEvidence.images) safeEvidence.images = safeEvidence.images.slice(0, 20);
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

  if (evidence.explicitNegative) {
    listing.availabilityStatus = 'removed';
    listing.status = 'removed';
    listing.removedAt = today;
    listing.lastChecked = today;
    listing.verifiedAt = iso;
    listing.verificationMethod = `Automated live check found explicit unavailable evidence (${evidence.negativePhrase || 'negative status'}).`;
    listing.dataNotes = `${listing.dataNotes || ''} AUTO-REMOVED ${today}: explicit live unavailable signal.`.trim();
    history[listing.id] ||= [];
    history[listing.id].push({ date: today, rent: listing.rent ?? null, note: 'AUTO-REMOVED after direct live verification found explicit unavailable evidence.' });
    continue;
  }

  if (!result.ok && listing.availabilityStatus === 'active' && failures >= 2) {
    listing.availabilityStatus = 'needs_confirmation';
    listing.status = 'unchanged';
    listing.lastChecked = today;
    listing.verificationMethod = `Automated live verification failed ${failures} consecutive times; hidden pending confirmation.`;
    history[listing.id] ||= [];
    history[listing.id].push({ date: today, rent: listing.rent ?? null, note: `AUTO-HIDDEN after ${failures} consecutive live verification failures.` });
    continue;
  }

  if (result.ok && evidence.identityMatch) {
    listing.lastChecked = today;
    listing.verifiedAt = iso;
    if (evidence.explicitPositive) listing.verificationMethod = 'Automated live browser check matched listing identity and current availability wording.';
    const photoCandidates = evidence.explicitPositive ? verifiedPhotoCandidates(result.images) : [];
    if (photoCandidates.length && !imageSources[listing.id]?.candidates?.length) {
      imageSources[listing.id] = {
        referer: result.finalUrl || listing.url,
        photoPageUrl: result.finalUrl || listing.url,
        candidates: photoCandidates.slice(0, 12)
      };
    }
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
  await writeJson(path.join(EVIDENCE, `source-${source.id}.json`), {
    checkedAt: iso,
    source,
    ...result,
    bodyText: result.bodyText?.slice(0, 30000),
    links: result.links?.slice(0, 150),
    images: result.images?.slice(0, 20)
  });
  if (!result.ok) continue;
  for (const link of result.links || []) {
    const c = candidateFromLink(source, link);
    if (c) discovered.push(c);
  }
}

for (const seed of sources.seedCandidates || []) {
  const result = await visit(page, seed.url);
  let cls = null;
  if (result.ok) cls = classify(result.bodyText, seed, result.jsonLd, result.status);
  const liveFacts = cls?.facts || {};
  const facts = mergeHints(liveFacts, seed.hints || {});
  const livePrice = cls?.extractedRent || null;
  const direct = result.ok ? {
    ...seed,
    discoveredAt: iso,
    liveCheckedAt: iso,
    liveStatus: result.status,
    finalUrl: result.finalUrl,
    identityMatch: cls.identityMatch,
    explicitPositive: cls.explicitPositive,
    explicitNegative: cls.explicitNegative,
    negativePhrase: cls.negativePhrase,
    livePrice,
    liveFacts,
    pageTextSample: result.bodyText.slice(0, 5000)
  } : { ...seed, discoveredAt: iso, liveCheckedAt: iso, liveStatus: result.status ?? null, error: result.error };

  const existing = findExistingSeedListing(payload.listings, seed);
  const bedOK = facts.bedrooms === seed.expectedBeds || liveFacts.bedrooms === seed.expectedBeds;
  const priceOK = livePrice && livePrice >= 2500 && livePrice <= 12000;
  const canPublish = !!seed.autoPublish && result.ok && cls?.identityMatch && cls?.explicitPositive && !cls?.explicitNegative && bedOK && priceOK;

  if (canPublish) {
    const geo = existing?.lat && existing?.lng ? { lat: existing.lat, lng: existing.lng } : await geocodeVancouver(seed.address);
    if (geo) {
      if (existing) {
        const oldRent = existing.rent;
        existing.rent = livePrice;
        existing.bedrooms = facts.bedrooms ?? existing.bedrooms;
        existing.bathrooms = facts.bathrooms ?? existing.bathrooms;
        existing.sqft = facts.sqft ?? existing.sqft;
        existing.ac = facts.ac ?? existing.ac;
        existing.parking = facts.parking ?? existing.parking;
        existing.petFriendly = facts.petFriendly ?? existing.petFriendly;
        existing.orientation = facts.orientation ?? existing.orientation;
        existing.balcony = facts.balcony ?? existing.balcony;
        existing.buildingYear = facts.buildingYear ?? existing.buildingYear;
        existing.largeWindows = facts.largeWindows ?? existing.largeWindows;
        existing.modernInterior = facts.modernInterior ?? existing.modernInterior;
        existing.lat = geo.lat; existing.lng = geo.lng;
        existing.availabilityStatus = 'active';
        existing.lastChecked = today; existing.verifiedAt = iso;
        existing.verificationMethod = 'AUTO-PUBLISHED/verified from exact live detail page with identity, current availability wording, price, bedrooms and Vancouver geocode.';
        if (oldRent && oldRent !== livePrice) {
          existing.status = livePrice < oldRent ? 'price_drop' : 'unchanged';
          existing.priceDrop = livePrice < oldRent;
          history[existing.id] ||= [];
          history[existing.id].push({ date: today, rent: livePrice, note: `AUTO live price update from ${oldRent} to ${livePrice}.` });
        }
      } else {
        const id = seed.listingId || `auto-${seed.id}`;
        const listing = {
          id,
          buildingName: seed.buildingName || null,
          unit: seed.unit || null,
          address: seed.address,
          neighborhood: seed.neighborhood || 'Vancouver Westside',
          lat: geo.lat,
          lng: geo.lng,
          type: seed.type || 'condo',
          rent: livePrice,
          effectiveRent: null,
          bedrooms: facts.bedrooms,
          bathrooms: facts.bathrooms,
          sqft: facts.sqft,
          ac: facts.ac ?? null,
          parking: facts.parking ?? null,
          petFriendly: facts.petFriendly ?? null,
          buildingYear: facts.buildingYear ?? null,
          orientation: facts.orientation ?? null,
          balcony: facts.balcony ?? null,
          largeWindows: facts.largeWindows ?? null,
          modernInterior: facts.modernInterior ?? null,
          source: seed.source,
          url: seed.url,
          photoPageUrl: seed.url,
          firstSeen: today,
          lastChecked: today,
          verifiedAt: iso,
          verificationMethod: 'AUTO-PUBLISHED from exact live detail page with identity, current availability wording, price, bedrooms and Vancouver geocode.',
          availabilityStatus: 'active',
          status: 'new',
          priceDrop: false,
          dataNotes: seed.userObservedPrice && seed.userObservedPrice === livePrice ? `Live automation confirmed user-observed price $${livePrice}.` : 'Published by strict automated candidate gate.'
        };
        payload.listings.push(listing);
        history[id] = [{ date: today, rent: livePrice, note: 'AUTO-PUBLISHED after strict live detail-page verification.' }];
        state.autoPublished.push(id);
      }
      direct.autoPublishResult = 'published';
      direct.geocode = geo;
      const photoCandidates = verifiedPhotoCandidates(result.images);
      if (photoCandidates.length) {
        imageSources[seed.listingId] = {
          referer: result.finalUrl || seed.url,
          photoPageUrl: result.finalUrl || seed.url,
          candidates: photoCandidates.slice(0, 12)
        };
      }
    } else {
      direct.autoPublishResult = 'blocked_no_vancouver_geocode';
    }
  } else {
    direct.autoPublishResult = seed.autoPublish ? 'blocked_verification_gate' : 'not_enabled';
  }

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
payload.meta.automationNote = 'Live Playwright verifier revalidates current inventory. Strictly configured candidates may auto-publish only after exact identity, positive availability, price, bedroom and Vancouver geocode gates pass.';

await writeJson(listingsPath, payload);
await writeJson(historyPath, history);
await writeJson(candidatesPath, candidates.slice(0, 300));
await writeJson(refreshStatePath, state);
await writeJson(imageSourcesPath, imageSources);
await browser.close();

console.log(`Verified ${Object.keys(state.listings).length} listings; collected ${candidates.length} candidates; auto-published ${state.autoPublished.length}.`);
