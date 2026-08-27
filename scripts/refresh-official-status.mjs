import fs from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';

const DATA = path.join(process.cwd(), 'data');
const watchPath = path.join(DATA, 'official-watch.json');
const overridePath = path.join(DATA, 'manual-overrides.json');
const outPath = path.join(DATA, 'official-status.json');
const iso = new Date().toISOString();
const read = async (p, d) => { try { return JSON.parse(await fs.readFile(p, 'utf8')); } catch { return d; } };
const write = async (p, x) => fs.writeFile(p, JSON.stringify(x, null, 2) + '\n');
const watch = await read(watchPath, { projects: [] });
const manual = await read(overridePath, { overrides: [] });
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ locale: 'en-CA', timezoneId: 'America/Vancouver', viewport: { width: 1440, height: 1200 } });
const page = await context.newPage();
const projects = [];
const challengePage = text => /please wait while your request is being verified|verify you are human|checking your browser|just a moment|security verification|cloudflare ray id/i.test(String(text || ''));

for (const project of watch.projects || []) {
  const observations = [];
  for (const url of project.officialUrls || []) {
    try {
      const response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
      const status = response?.status() ?? null;
      if (!response || status >= 400) {
        observations.push({ url, checkedAt: iso, httpStatus: status, usable: false });
        continue;
      }
      await page.waitForTimeout(1200);
      const text = (await page.locator('body').innerText({ timeout: 10000 })).replace(/\s+/g, ' ').trim();
      if (challengePage(text)) {
        observations.push({ url, checkedAt: iso, httpStatus: status, usable: false, blockedByChallenge: true, textSample: text.slice(0, 500) });
        continue;
      }
      const lower = text.toLowerCase();
      const negatives = (project.negativeSignals || []).filter(s => lower.includes(String(s).toLowerCase()));
      const positives = (project.positiveSignals || []).filter(s => lower.includes(String(s).toLowerCase()));
      observations.push({ url, checkedAt: iso, httpStatus: status, usable: true, negatives, positives, textSample: text.slice(0, 2500) });
    } catch (e) {
      observations.push({ url, checkedAt: iso, usable: false, error: String(e) });
    }
  }

  const manualForProject = (manual.overrides || []).filter(o =>
    (o.buildingName && o.buildingName.toLowerCase() === String(project.buildingName || '').toLowerCase()) ||
    (o.address && o.address.toLowerCase() === String(project.address || '').toLowerCase())
  );
  const latestManual = manualForProject
    .filter(o => o.evidenceObservedAt)
    .sort((a, b) => new Date(b.evidenceObservedAt) - new Date(a.evidenceObservedAt))[0] || null;

  const liveNegative = observations.some(o => o.usable && o.negatives?.length);
  const livePositive = observations.some(o => o.usable && o.positives?.length);
  let effectiveStatus = 'unknown';
  let authority = 'none';
  let reason = 'No decisive official signal.';

  if (latestManual?.strongNegative) {
    effectiveStatus = 'fully_leased';
    authority = latestManual.evidenceType || 'manual_official_announcement';
    reason = latestManual.reason || 'Newer official manual announcement is a strong negative.';
  } else if (liveNegative) {
    effectiveStatus = 'fully_leased';
    authority = 'official_web';
    reason = 'Official page contains a strong negative leasing signal.';
  } else if (livePositive) {
    effectiveStatus = 'leasing';
    authority = 'official_web';
    reason = 'Official page contains current leasing/availability language.';
  }

  projects.push({
    id: project.id,
    buildingName: project.buildingName,
    address: project.address,
    checkedAt: iso,
    effectiveStatus,
    authority,
    reason,
    latestManualAnnouncement: latestManual ? {
      evidenceObservedAt: latestManual.evidenceObservedAt,
      evidenceUrl: latestManual.evidenceUrl,
      reason: latestManual.reason,
      strongNegative: !!latestManual.strongNegative
    } : null,
    observations
  });
}

await browser.close();
await write(outPath, {
  refreshedAt: iso,
  policy: 'Fresh explicit official negative announcements override older official website leasing language and all marketplace evidence. Official positive status alone does not prove a specific unit is available.',
  projects
});
console.log(`Official status refresh: ${projects.length} projects checked.`);
