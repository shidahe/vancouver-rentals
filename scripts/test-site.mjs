import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import { chromium } from 'playwright';

const PORT = 4173;
const BASE = `http://127.0.0.1:${PORT}`;
const REPORT = 'data/site-test-report.json';
const server = spawn('python3', ['-m', 'http.server', String(PORT), '--bind', '127.0.0.1'], { stdio: ['ignore', 'pipe', 'pipe'] });
const sleep = ms => new Promise(r => setTimeout(r, ms));
const assert = (cond, msg) => { if (!cond) throw new Error(msg); };

async function waitForServer() {
  for (let i = 0; i < 40; i++) {
    try { const r = await fetch(BASE); if (r.ok) return; } catch {}
    await sleep(250);
  }
  throw new Error('Static test server did not start');
}

let browser;
let report = { checkedAt: new Date().toISOString(), ok: false, checkpoints: {} };
let failure = null;
try {
  await waitForServer();
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  const consoleErrors = [];
  const failedRequests = [];
  const httpErrors = [];
  page.on('console', m => { if (m.type() === 'error') consoleErrors.push(m.text()); });
  page.on('requestfailed', r => failedRequests.push(`${r.resourceType()} ${r.method()} ${r.url()} :: ${r.failure()?.errorText || 'failed'}`));
  page.on('response', r => {
    if (r.status() < 400) return;
    const req = r.request();
    httpErrors.push({ status: r.status(), resourceType: req.resourceType(), method: req.method(), url: r.url() });
  });

  await page.goto(BASE, { waitUntil: 'networkidle', timeout: 60000 });
  await page.waitForFunction(() => document.querySelectorAll('.listing-card').length > 0, null, { timeout: 30000 });
  const title = await page.title();
  assert(title.includes('Vancouver Westside Rentals'), `Unexpected title: ${title}`);

  const cards = await page.locator('.listing-card').count();
  const shown = Number(await page.locator('#resultCount').innerText());
  report.checkpoints.render = { title, cards, shown };
  assert(cards === shown, `Card count ${cards} != resultCount ${shown}`);
  assert(cards > 0, 'No listings rendered with default filters');
  assert(await page.locator('#minSqft').inputValue() === '', 'The 800 sqft preference became a default display gate');

  const statLabels = await page.locator('#stats .stat span').allTextContents();
  const statValues = await page.locator('#stats .stat strong').allTextContents();
  report.checkpoints.stats = { labels: statLabels, values: statValues, html: await page.locator('#stats').innerHTML() };
  assert(statLabels.includes('Active') && statLabels.includes('New 7d'), `Stats header did not render expected labels: ${JSON.stringify(statLabels)}`);
  const refreshedIndex = statLabels.indexOf('Last refreshed');
  assert(refreshedIndex >= 0, 'Last refreshed stat did not render');
  const expectedRefreshed = await page.evaluate(async () => {
    const payload = await (await fetch('data/listings.json')).json();
    const latest = payload.meta?.lastAutomatedRefresh || payload.meta?.lastZumperUnitRefresh || payload.meta?.lastRefreshed;
    return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Vancouver', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' }).format(new Date(latest));
  });
  assert(statValues[refreshedIndex] === expectedRefreshed, `Last refreshed value "${statValues[refreshedIndex]}" did not match Vancouver-local metadata time "${expectedRefreshed}"`);
  assert(/P(?:S|D)T$/.test(statValues[refreshedIndex]), `Last refreshed time lacks an explicit Vancouver timezone: ${statValues[refreshedIndex]}`);
  report.checkpoints.stats.refreshedAt = { displayed: statValues[refreshedIndex], expected: expectedRefreshed, timezone: 'America/Vancouver' };
  const recentIndex = statLabels.indexOf('New 7d');
  const recentAudit = await page.evaluate(async () => {
    const payload = await (await fetch(`data/listings.json?t=${Date.now()}`, { cache: 'no-store' })).json();
    const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Vancouver', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date()).filter(x => x.type !== 'literal').map(x => [x.type, Number(x.value)]));
    const today = Date.UTC(parts.year, parts.month - 1, parts.day) / 86400000;
    const recent = payload.listings.filter(l => {
      const availability = l.availabilityStatus || (l.status === 'removed' ? 'removed' : 'active');
      if (availability !== 'active' || !/^\d{4}-\d{2}-\d{2}$/.test(l.firstSeen || '')) return false;
      const age = today - Date.parse(`${l.firstSeen}T00:00:00Z`) / 86400000;
      return age >= 0 && age < 7;
    });
    const recentIds = new Set(recent.map(l => l.id));
    const badgeIds = [...document.querySelectorAll('.listing-card')].filter(card => card.querySelector('.badge.new')).map(card => card.dataset.id);
    return { expectedCount: recent.length, badgeIds, staleBadgeIds: badgeIds.filter(id => !recentIds.has(id)) };
  });
  assert(Number(statValues[recentIndex]) === recentAudit.expectedCount, `New 7d stat ${statValues[recentIndex]} != firstSeen-derived count ${recentAudit.expectedCount}`);
  assert(recentAudit.staleBadgeIds.length === 0, `Stale listings retained NEW badges: ${recentAudit.staleBadgeIds.join(', ')}`);
  report.checkpoints.stats.newSevenDays = recentAudit;

  const markers = await page.locator('.leaflet-marker-icon.price-marker').count();
  const desktopMapVisible = await page.locator('#map').isVisible();
  report.checkpoints.map = { markers, desktopMapVisible };
  assert(desktopMapVisible, 'Desktop map is not visible');
  assert(markers === cards, `Visible cards ${cards} != map markers ${markers}`);

  await page.locator('#minSqft').fill('9999');
  await page.locator('#minSqft').dispatchEvent('change');
  await page.waitForTimeout(150);
  assert(Number(await page.locator('#resultCount').innerText()) === 0, 'Min sqft filter did not remove all impossible matches');
  await page.locator('#resetFilters').click();
  await page.waitForTimeout(150);
  assert(Number(await page.locator('#resultCount').innerText()) > 0, 'Reset filters did not restore listings');
  report.checkpoints.filters = 'ok';

  const firstId = await page.locator('.listing-card').first().getAttribute('data-id');
  assert(firstId, 'First listing has no stable id');
  await page.locator('.listing-card').first().locator('[data-action="favorite"]').click();
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForFunction(() => document.querySelectorAll('.listing-card').length > 0);
  assert((await page.locator(`[data-id="${firstId}"] [data-action="favorite"]`).innerText()).includes('♥'), 'Favorite state did not survive reload/localStorage');

  const note = `smoke-${Date.now()}`;
  const noteBox = page.locator(`[data-id="${firstId}"] .notes`);
  await noteBox.fill(note);
  await noteBox.dispatchEvent('change');
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForFunction(() => document.querySelectorAll('.listing-card').length > 0);
  assert((await page.locator(`[data-id="${firstId}"] .notes`).inputValue()) === note, 'Notes did not survive reload/localStorage');
  report.checkpoints.localStorage = { favorite: true, notes: true, firstId };

  const sourceHref = await page.locator(`[data-id="${firstId}"] .actions .source-link`).getAttribute('href');
  assert(sourceHref && /^https:\/\//.test(sourceHref), `Invalid source link: ${sourceHref}`);
  report.checkpoints.sourceLink = sourceHref;

  // Force every lazy image into the viewport before deciding whether it works.
  const allCards = page.locator('.listing-card');
  for (let i = 0; i < await allCards.count(); i++) {
    const card = allCards.nth(i);
    await card.scrollIntoViewIfNeeded();
    const img = card.locator('.listing-photo');
    if (await img.count()) {
      await page.waitForFunction(el => {
        const image = el.querySelector('.listing-photo');
        const fallback = el.querySelector('.photo-source-link');
        return !!fallback || (!!image && image.complete);
      }, await card.elementHandle(), { timeout: 5000 }).catch(() => {});
    }
  }
  await page.waitForTimeout(300);

  const photoAudit = await page.locator('.listing-card').evaluateAll(cards => cards.map(card => {
    const img = card.querySelector('.listing-photo');
    const fallback = card.querySelector('.photo-source-link');
    return { id: card.dataset.id, hasImg: !!img, imgOk: !!img && img.complete && img.naturalWidth > 0, fallback: fallback?.getAttribute('href') || null };
  }));
  const badPhotos = photoAudit.filter(x => !x.imgOk && !(x.fallback && /^https:\/\//.test(x.fallback)));
  report.checkpoints.photos = { total: photoAudit.length, loaded: photoAudit.filter(x => x.imgOk).length, fallbacks: photoAudit.filter(x => !x.imgOk && x.fallback).length, bad: badPhotos };
  assert(badPhotos.length === 0, `Listings with neither working image nor source fallback: ${JSON.stringify(badPhotos)}`);

  const markerTransforms = await page.locator('.leaflet-marker-icon.price-marker').evaluateAll(ms => ms.map(m => m.style.transform));
  const uniqueMarkerPositions = new Set(markerTransforms).size;
  report.checkpoints.markerPositions = { total: markerTransforms.length, unique: uniqueMarkerPositions };
  assert(uniqueMarkerPositions === markerTransforms.length, 'Two visible listing markers occupy the exact same rendered map position');

  for (const p of ['data/listings.json', 'data/history.json', 'data/images.json']) {
    const r = await page.request.get(`${BASE}/${p}`);
    assert(r.ok(), `${p} returned HTTP ${r.status()}`);
  }
  report.checkpoints.dataEndpoints = 'ok';

  const mobile = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true });
  const mp = await mobile.newPage();
  await mp.goto(BASE, { waitUntil: 'networkidle', timeout: 60000 });
  await mp.waitForFunction(() => document.querySelectorAll('.listing-card').length > 0, null, { timeout: 30000 });
  assert(await mp.locator('.mobile-controls').isVisible(), 'Mobile controls are not visible at 390px');
  await mp.locator('#filtersToggle').click();
  assert(await mp.locator('#toolbar').evaluate(el => el.classList.contains('mobile-open')), 'Mobile filter drawer did not open');
  await mp.locator('#mapView').click();
  assert(await mp.locator('.layout').evaluate(el => el.classList.contains('map-mode')), 'Mobile map view did not activate');
  await mp.locator('#listView').click();
  assert(!(await mp.locator('.layout').evaluate(el => el.classList.contains('map-mode'))), 'Mobile list view did not reactivate');
  report.checkpoints.mobile = 'ok';
  await mobile.close();

  // Chromium emits generic "Failed to load resource" console errors for HTTP image
  // failures even when the app intentionally recovers with its tested source-link
  // fallback. Treat those generic messages as diagnostics; HTTP responses below are
  // classified by resource type so core application resources remain fail-closed.
  const meaningfulConsole = consoleErrors.filter(x => !/favicon/i.test(x) && !/^Failed to load resource: the server responded with a status of \d+ \(\)$/i.test(x));
  const meaningfulFailed = failedRequests.filter(x => !/favicon/i.test(x));
  const fatalHttp = httpErrors.filter(x => {
    if (/favicon/i.test(x.url)) return false;
    return x.resourceType !== 'image';
  });
  const recoverableImageHttp = httpErrors.filter(x => x.resourceType === 'image' && !/favicon/i.test(x.url));
  report.checkpoints.browserHealth = { consoleErrors: meaningfulConsole, failedRequests: meaningfulFailed, fatalHttpResponses: fatalHttp, recoverableImageHttpResponses: recoverableImageHttp };
  assert(meaningfulConsole.length === 0, `Browser console errors: ${meaningfulConsole.join('\n')}`);
  assert(meaningfulFailed.length === 0, `Failed browser requests: ${meaningfulFailed.join('\n')}`);
  assert(fatalHttp.length === 0, `Core browser resources returned HTTP errors: ${JSON.stringify(fatalHttp)}`);

  report = { ...report, checkedAt: new Date().toISOString(), ok: true };
} catch (err) {
  failure = err;
  report = { ...report, checkedAt: new Date().toISOString(), ok: false, error: String(err?.stack || err) };
} finally {
  if (browser) await browser.close();
  server.kill('SIGTERM');
  await fs.mkdir('data', { recursive: true });
  await fs.writeFile(REPORT, JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report, null, 2));
}
if (failure) throw failure;
