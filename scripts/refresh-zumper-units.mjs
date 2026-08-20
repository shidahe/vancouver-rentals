import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { chromium } from 'playwright';

const ROOT = process.cwd();
const DATA = path.join(ROOT, 'data');
const EVIDENCE = path.join(DATA, 'evidence');
const iso = new Date().toISOString();
const today = iso.slice(0, 10);
const readJson = async (p, fallback) => { try { return JSON.parse(await fs.readFile(p, 'utf8')); } catch { return fallback; } };
const writeJson = async (p, v) => { await fs.mkdir(path.dirname(p), { recursive: true }); await fs.writeFile(p, JSON.stringify(v, null, 2) + '\n'); };
const norm = s => (s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const slugify = s => norm(s).replace(/ /g, '-').slice(0, 80);

function flattenLd(nodes) {
  const out = [];
  const walk = x => {
    if (!x) return;
    if (Array.isArray(x)) return x.forEach(walk);
    if (typeof x !== 'object') return;
    out.push(x);
    if (x['@graph']) walk(x['@graph']);
  };
  nodes.forEach(walk);
  return out;
}

function parseMoney(v) {
  const n = Number(String(v ?? '').replace(/[^0-9.]/g, ''));
  return n >= 2500 && n <= 12000 ? n : null;
}

function pickStructured(jsonLd, pageText, url) {
  const all = flattenLd(jsonLd);
  const product = all.find(x => x['@type'] === 'Product' && x.offers);
  const residence = all.find(x => ['Apartment','SingleFamilyResidence','Residence','House','Accommodation'].includes(x['@type']));
  const addressObj = residence?.address || product?.address || {};
  const streetAddress = addressObj.streetAddress || null;
  const locality = addressObj.addressLocality || 'Vancouver';
  const region = addressObj.addressRegion || 'BC';
  const postal = addressObj.postalCode || '';
  const address = streetAddress ? `${streetAddress}, ${locality}, ${region}${postal ? ` ${postal}` : ''}` : null;

  const offer = Array.isArray(product?.offers) ? product.offers[0] : product?.offers;
  const rent = parseMoney(offer?.lowPrice) || parseMoney(offer?.price) || parseMoney(offer?.highPrice);
  const description = [product?.description, residence?.description, pageText].filter(Boolean).join('\n');
  const beds = Number(description.match(/\b([1-5](?:\.5)?)\s*(?:bedrooms?|beds?|br)\b/i)?.[1] || 0) || null;
  const baths = Number(description.match(/\b([1-5](?:\.5)?)\s*(?:bathrooms?|baths?|ba)\b/i)?.[1] || 0) || null;
  const sqft = Number(String(residence?.floorSize || '').match(/([0-9]{3,4})/)?.[1] || description.match(/\b([7-9][0-9]{2}|1[0-9]{3}|2[0-9]{3})\s*(?:sq\.?\s*ft|sqft|sqt|ft²|square feet)\b/i)?.[1] || 0) || null;
  const orientationWord = description.match(/\b(north(?:east|west)?|south(?:east|west)?|east|west)[- ]facing\b/i)?.[1] || null;
  const orientation = orientationWord ? orientationWord.toLowerCase().replace('northeast','NE').replace('northwest','NW').replace('southeast','SE').replace('southwest','SW').replace('north','N').replace('south','S').replace('east','E').replace('west','W') : null;
  const unitFromAddress = streetAddress?.match(/^(?:#|unit\s*)?([A-Za-z0-9-]+)\s*[-–]\s*(\d{3,5}\b.*)$/i)?.[1] || null;
  const unitFromText = description.match(/\b(?:unit|suite|#)\s*([A-Za-z0-9-]{1,12})\b/i)?.[1] || null;
  const unit = unitFromAddress || unitFromText;
  const images = [];
  const addImage = x => { const u = typeof x === 'string' ? x : x?.contentUrl || x?.url; if (u && /^https?:/i.test(u) && !images.includes(u)) images.push(u); };
  all.forEach(x => Array.isArray(x.image) ? x.image.forEach(addImage) : addImage(x.image));
  const geo = residence?.geo || all.find(x => x.geo)?.geo;
  const lat = Number(geo?.latitude), lng = Number(geo?.longitude);
  const exactGeo = Number.isFinite(lat) && Number.isFinite(lng) && lat > 49.19 && lat < 49.33 && lng > -123.30 && lng < -123.02 ? { lat, lng } : null;
  const currentlyOnMarket = /currently on market|check availability|request tour|for rent/i.test(pageText) && !/gone too soon|no longer available|this rental is unavailable|listing is inactive|off market/i.test(pageText);
  const petFriendly = residence?.petsAllowed === true || /pet friendly|pets allowed/i.test(description) ? true : null;
  return {
    address, unit, rent, bedrooms: beds, bathrooms: baths, sqft, orientation, exactGeo,
    ac: /air conditioning|air conditioned|central a\/c|central ac/i.test(description) ? true : null,
    parking: /assigned parking|parking included|parking spot|one parking|1 parking/i.test(description) ? true : null,
    petFriendly,
    balcony: /balcony|private patio|patio/i.test(description) ? true : null,
    largeWindows: /large windows|floor.to.ceiling windows|sun.drenched|naturally bright/i.test(description) ? true : null,
    modernInterior: /miele|fisher\s*&\s*paykel|caesarstone|quartz|renovated|waterfall island|modern/i.test(description) ? true : null,
    images: images.slice(0, 16), currentlyOnMarket, description: description.slice(0, 5000), url
  };
}

function identityKey(x) {
  const addr = norm(x.address);
  if (x.unit) return `${addr}::unit:${norm(x.unit)}`;
  // If a marketplace has no public unit number, keep its exact detail URL as a distinct inventory identity.
  return `${addr}::url:${crypto.createHash('sha1').update(x.url).digest('hex').slice(0, 12)}`;
}

function listingIdentityKey(x) {
  const addr = norm(x.address);
  const unit = String(x.unit || '').match(/\b(?:unit|suite|#)?\s*([A-Za-z0-9-]{1,12})\b/i)?.[1];
  if (unit) return `${addr}::unit:${norm(unit)}`;
  if (/zumper\.com/i.test(x.url || '')) return `${addr}::url:${crypto.createHash('sha1').update(x.url).digest('hex').slice(0, 12)}`;
  return `${addr}::legacy:${x.id}`;
}

const listingsPath = path.join(DATA, 'listings.json');
const historyPath = path.join(DATA, 'history.json');
const sourcesPath = path.join(DATA, 'live-sources.json');
const imageSourcesPath = path.join(DATA, 'image-sources.json');
const candidatesPath = path.join(DATA, 'candidates.json');
const payload = await readJson(listingsPath, { meta: {}, listings: [] });
const history = await readJson(historyPath, {});
const sources = await readJson(sourcesPath, { discovery: [] });
const imageSources = await readJson(imageSourcesPath, {});
const previousCandidates = await readJson(candidatesPath, []);

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ locale: 'en-CA', timezoneId: 'America/Vancouver', viewport: { width: 1440, height: 1200 }, userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/126 Safari/537.36' });
const page = await context.newPage();
const searchSources = (sources.discovery || []).filter(s => s.adapter === 'zumper-search');
const detailUrls = new Set();

for (const source of searchSources) {
  try {
    const res = await page.goto(source.url, { waitUntil: 'domcontentloaded', timeout: 45000 });
    if (!res || res.status() >= 400) continue;
    await page.waitForTimeout(3000);
    const hrefs = await page.locator('a').evaluateAll(as => as.map(a => a.href).filter(Boolean));
    for (const href of hrefs) {
      if (/^https:\/\/www\.zumper\.com\/(?:address|apartments-for-rent)\//i.test(href) && !/\/vancouver-bc\/(?:kitsilano|west-point-grey|dunbar)\/2-beds\/?$/i.test(href)) detailUrls.add(href.split('#')[0]);
    }
  } catch {}
}

// Preserve seed detail pages even if the search page temporarily fails to surface them.
for (const seed of sources.seedCandidates || []) if (/zumper\.com/i.test(seed.url || '')) detailUrls.add(seed.url);

const liveCandidates = [];
for (const url of [...detailUrls].slice(0, 80)) {
  try {
    const res = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
    if (!res || res.status() >= 400) continue;
    await page.waitForTimeout(2200);
    const bodyText = await page.locator('body').innerText({ timeout: 10000 });
    const rawLd = await page.locator('script[type="application/ld+json"]').evaluateAll(ns => ns.map(n => n.textContent || '').slice(0, 50));
    const jsonLd = []; for (const raw of rawLd) { try { jsonLd.push(JSON.parse(raw)); } catch {} }
    const facts = pickStructured(jsonLd, bodyText, url);
    if (!facts.address || facts.bedrooms !== 2 || !facts.rent || !facts.currentlyOnMarket) continue;
    if (!/(Vancouver|BC)/i.test(facts.address)) continue;
    const key = identityKey(facts);
    liveCandidates.push({ ...facts, identityKey: key, checkedAt: iso });
    await writeJson(path.join(EVIDENCE, `zumper-${crypto.createHash('sha1').update(key).digest('hex').slice(0, 16)}.json`), { checkedAt: iso, source: 'Zumper live detail', identityKey: key, facts, jsonLd: jsonLd.slice(0, 8) });
  } catch {}
}
await browser.close();

const byIdentity = new Map(payload.listings.map(x => [listingIdentityKey(x), x]));
for (const c of liveCandidates) {
  let listing = byIdentity.get(c.identityKey);
  const listingId = listing?.id || `zumper-${slugify(c.address)}-${c.unit ? `unit-${slugify(c.unit)}` : crypto.createHash('sha1').update(c.url).digest('hex').slice(0, 8)}`;
  if (!listing) {
    listing = {
      id: listingId,
      buildingName: null,
      unit: c.unit || null,
      address: c.address,
      neighborhood: /waterloo|kitsilano/i.test(c.address + c.description) ? 'Kitsilano' : /point grey/i.test(c.description) ? 'Point Grey' : /dunbar/i.test(c.description) ? 'Dunbar' : 'Vancouver West',
      lat: c.exactGeo?.lat ?? null,
      lng: c.exactGeo?.lng ?? null,
      type: /townhouse|townhome/i.test(c.description) ? 'condo' : 'condo',
      rent: c.rent,
      effectiveRent: null,
      bedrooms: c.bedrooms,
      bathrooms: c.bathrooms,
      sqft: c.sqft,
      ac: c.ac,
      parking: c.parking,
      petFriendly: c.petFriendly,
      buildingYear: null,
      orientation: c.orientation,
      balcony: c.balcony,
      largeWindows: c.largeWindows,
      modernInterior: c.modernInterior,
      source: 'Zumper live detail',
      url: c.url,
      photoPageUrl: c.url,
      firstSeen: today,
      lastChecked: today,
      verifiedAt: iso,
      verificationLevel: 'verified',
      verificationMethod: `AUTO-PUBLISHED from exact Zumper detail page; identity key ${c.identityKey}`,
      availabilityStatus: 'active',
      status: 'new',
      priceDrop: false,
      dataNotes: c.unit ? 'Tracked as an independent unit within its building.' : 'Tracked as an independent Zumper detail listing; no public unit number was exposed.'
    };
    // Exact structured geo is required for automatic publication. If absent, keep it as candidate only.
    if (listing.lat == null || listing.lng == null) continue;
    payload.listings.push(listing);
    byIdentity.set(c.identityKey, listing);
    history[listing.id] = [{ date: today, rent: c.rent, note: 'NEW: auto-published from live Zumper detail page.' }];
  } else {
    const oldRent = listing.rent;
    listing.lastChecked = today;
    listing.verifiedAt = iso;
    listing.availabilityStatus = 'active';
    listing.verificationLevel = 'verified';
    if (c.rent !== oldRent) {
      listing.rent = c.rent;
      listing.status = c.rent < oldRent ? 'price_drop' : 'unchanged';
      listing.priceDrop = c.rent < oldRent;
      history[listing.id] ||= [];
      history[listing.id].push({ date: today, rent: c.rent, note: `AUTO Zumper live price update from $${oldRent} to $${c.rent}.` });
    }
    if (c.exactGeo) { listing.lat = c.exactGeo.lat; listing.lng = c.exactGeo.lng; }
  }
  if (c.images.length) {
    imageSources[listing.id] = { referer: c.url, photoPageUrl: c.url, candidates: c.images.slice(0, 8) };
  }
}

const priorByUrl = new Map(previousCandidates.map(x => [x.url, x]));
for (const c of liveCandidates) priorByUrl.set(c.url, { source: 'Zumper', url: c.url, address: c.address, unit: c.unit, livePrice: c.rent, bedrooms: c.bedrooms, bathrooms: c.bathrooms, sqft: c.sqft, identityKey: c.identityKey, liveCheckedAt: iso, explicitNegative: false, autoPublishResult: byIdentity.has(c.identityKey) ? 'published_or_updated' : 'candidate_only' });

payload.meta ||= {};
payload.meta.lastZumperUnitRefresh = iso;
payload.meta.identityPolicy = 'Listings are distinct by address + unit; if a public unit is unavailable, exact marketplace detail URL is treated as a distinct inventory identity. Same-address units are never collapsed.';
await writeJson(listingsPath, payload);
await writeJson(historyPath, history);
await writeJson(imageSourcesPath, imageSources);
await writeJson(candidatesPath, [...priorByUrl.values()].slice(-500));
console.log(`Zumper unit refresh: ${liveCandidates.length} live 2BR detail listings evaluated.`);
