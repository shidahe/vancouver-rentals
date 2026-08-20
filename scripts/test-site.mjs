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
  page.on('console', m => { if (m.type() === 'error') consoleErrors.push(m.text()); });
  page.on('requestfailed', r => failedRequests.push(`${r.method()} ${r.url()} :: ${r.failure()?.errorText || 'failed'}`));

  await page.goto(BASE, { waitUntil: 'networkidle', timeout: 60000 });
  await page.waitForFunction(() => document.querySelectorAll('.listing-card').length > 0, null, { timeout: 30000 });
  const title = await page.title();
  assert(title.includes('Vancouver Westside Rentals'), `Unexpected title: ${title}`);

  const cards = await page.locator('.listing-card').count();
  const shown = Number(await page.locator('#resultCount').innerText());
  report.checkpoints.render = { title, cards, shown };
  assert(cards === shown, `Card count ${cards} != resultCount ${shown}`);
  assert(cards > 0, 'No listings rendered with default filters');

  const statLabels = await page.locator('#stats .stat span').allTextContents();
  const statValues = await page.locator('#stats .stat strong').allTextContents();
  report.checkpoints.stats = { labels: statLabels, values: statValues, html: await page.locator('#stats').innerHTML() };
  assert(statLabels.includes('Active') && statLabels.includes('New'), `Stats header did not render expected labels: ${JSON.stringify(statLabels)}`);

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

  const meaningfulConsole = consoleErrors.filter(x => !/favicon/i.test(x));
  const meaningfulFailed = failedRequests.filter(x => !/favicon/i.test(x));
  report.checkpoints.browserHealth = { consoleErrors: meaningfulConsole, failedRequests: meaningfulFailed };
  assert(meaningfulConsole.length === 0, `Browser console errors: ${meaningfulConsole.join('\n')}`);
  assert(meaningfulFailed.length === 0, `Failed browser requests: ${meaningfulFailed.join('\n')}`);

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
