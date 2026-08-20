import { spawn } from 'node:child_process';
import { chromium } from 'playwright';

const PORT = 4173;
const BASE = `http://127.0.0.1:${PORT}`;
const server = spawn('python3', ['-m', 'http.server', String(PORT), '--bind', '127.0.0.1'], {
  stdio: ['ignore', 'pipe', 'pipe']
});

const sleep = ms => new Promise(r => setTimeout(r, ms));
const assert = (cond, msg) => { if (!cond) throw new Error(msg); };

async function waitForServer() {
  for (let i = 0; i < 40; i++) {
    try {
      const r = await fetch(BASE);
      if (r.ok) return;
    } catch {}
    await sleep(250);
  }
  throw new Error('Static test server did not start');
}

let browser;
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
  assert(cards === shown, `Card count ${cards} != resultCount ${shown}`);
  assert(cards > 0, 'No listings rendered with default filters');

  const statText = await page.locator('#stats').innerText();
  assert(/Active/.test(statText) && /New/.test(statText), 'Stats header did not render');

  const markers = await page.locator('.leaflet-marker-icon.price-marker').count();
  assert(markers === cards, `Visible cards ${cards} != map markers ${markers}; active listings may be missing coordinates or overlapping renderer failed`);

  // Map/list mobile-style view switch should toggle the layout class.
  await page.locator('#mapView').click();
  assert(await page.locator('.layout').evaluate(el => el.classList.contains('map-mode')), 'Map view toggle failed');
  await page.locator('#listView').click();
  assert(!(await page.locator('.layout').evaluate(el => el.classList.contains('map-mode'))), 'List view toggle failed');

  // Filters should update results deterministically.
  await page.locator('#minSqft').fill('9999');
  await page.locator('#minSqft').dispatchEvent('change');
  await page.waitForTimeout(150);
  assert(Number(await page.locator('#resultCount').innerText()) === 0, 'Min sqft filter did not remove all impossible matches');
  await page.locator('#resetFilters').click();
  await page.waitForTimeout(150);
  assert(Number(await page.locator('#resultCount').innerText()) > 0, 'Reset filters did not restore listings');

  // localStorage user state should survive reload.
  const firstId = await page.locator('.listing-card').first().getAttribute('data-id');
  assert(firstId, 'First listing has no stable id');
  await page.locator('.listing-card').first().locator('[data-action="favorite"]').click();
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForFunction(() => document.querySelectorAll('.listing-card').length > 0);
  const favoriteButton = page.locator(`[data-id="${firstId}"] [data-action="favorite"]`);
  assert((await favoriteButton.innerText()).includes('♥'), 'Favorite state did not survive reload/localStorage');

  // Notes should persist too.
  const note = `smoke-${Date.now()}`;
  const noteBox = page.locator(`[data-id="${firstId}"] .notes`);
  await noteBox.fill(note);
  await noteBox.dispatchEvent('change');
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForFunction(() => document.querySelectorAll('.listing-card').length > 0);
  assert((await page.locator(`[data-id="${firstId}"] .notes`).inputValue()) === note, 'Notes did not survive reload/localStorage');

  // Source link must be a real external URL.
  const sourceHref = await page.locator(`[data-id="${firstId}"] .source-link`).first().getAttribute('href');
  assert(sourceHref && /^https:\/\//.test(sourceHref), `Invalid source link: ${sourceHref}`);

  // Every displayed card must either have a successfully loaded local photo or a usable photo-source fallback.
  const photoAudit = await page.locator('.listing-card').evaluateAll(cards => cards.map(card => {
    const img = card.querySelector('.listing-photo');
    const fallback = card.querySelector('.photo-source-link');
    return {
      id: card.dataset.id,
      hasImg: !!img,
      imgOk: !!img && img.complete && img.naturalWidth > 0,
      fallback: fallback?.getAttribute('href') || null
    };
  }));
  const badPhotos = photoAudit.filter(x => !x.imgOk && !(x.fallback && /^https:\/\//.test(x.fallback)));
  assert(badPhotos.length === 0, `Listings with neither working image nor source fallback: ${JSON.stringify(badPhotos)}`);

  // Same-address marker separation: if duplicate coordinates are present among visible cards,
  // marker DOM positions must not all collapse to one point.
  const markerTransforms = await page.locator('.leaflet-marker-icon.price-marker').evaluateAll(ms => ms.map(m => m.style.transform));
  assert(new Set(markerTransforms).size === markerTransforms.length, 'Two visible listing markers occupy the exact same rendered map position');

  // Local data endpoints must be healthy.
  for (const p of ['data/listings.json', 'data/history.json', 'data/images.json']) {
    const r = await page.request.get(`${BASE}/${p}`);
    assert(r.ok(), `${p} returned HTTP ${r.status()}`);
  }

  // Ignore browser noise caused only by favicon; surface meaningful console/network problems.
  const meaningfulConsole = consoleErrors.filter(x => !/favicon/i.test(x));
  const meaningfulFailed = failedRequests.filter(x => !/favicon/i.test(x));
  assert(meaningfulConsole.length === 0, `Browser console errors: ${meaningfulConsole.join('\n')}`);
  assert(meaningfulFailed.length === 0, `Failed browser requests: ${meaningfulFailed.join('\n')}`);

  console.log(JSON.stringify({
    ok: true,
    cards,
    markers,
    firstListingId: firstId,
    photoAudit,
    consoleErrors: meaningfulConsole,
    failedRequests: meaningfulFailed
  }, null, 2));
} finally {
  if (browser) await browser.close();
  server.kill('SIGTERM');
}
