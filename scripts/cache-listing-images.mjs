import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';

const ROOT = process.cwd();
const DATA = path.join(ROOT, 'data');
const ASSETS = path.join(ROOT, 'assets', 'listings');
const MAX_IMAGES = 5;
const MIN_BYTES = 8_000;
const MAX_BYTES = 12 * 1024 * 1024;

const readJson = async (p, fallback) => {
  try { return JSON.parse(await fs.readFile(p, 'utf8')); } catch { return fallback; }
};
const writeJson = async (p, value) => fs.writeFile(p, JSON.stringify(value, null, 2) + '\n');

const extFromType = type => {
  const t = String(type || '').toLowerCase();
  if (t.includes('image/jpeg')) return '.jpg';
  if (t.includes('image/png')) return '.png';
  if (t.includes('image/webp')) return '.webp';
  if (t.includes('image/avif')) return '.avif';
  if (t.includes('image/gif')) return '.gif';
  return null;
};

const extFromUrl = url => {
  try {
    const ext = path.extname(new URL(url).pathname).toLowerCase();
    return ['.jpg', '.jpeg', '.png', '.webp', '.avif', '.gif'].includes(ext) ? (ext === '.jpeg' ? '.jpg' : ext) : null;
  } catch { return null; }
};

const isLikelyImage = (buf, type) => {
  if (!buf || buf.length < MIN_BYTES || buf.length > MAX_BYTES) return false;
  if (String(type || '').toLowerCase().startsWith('image/')) return true;
  const h = buf.subarray(0, 12);
  return h[0] === 0xff && h[1] === 0xd8 ||
    h[0] === 0x89 && h[1] === 0x50 && h[2] === 0x4e && h[3] === 0x47 ||
    h.subarray(0, 4).toString() === 'RIFF' && h.subarray(8, 12).toString() === 'WEBP' ||
    h.subarray(4, 12).toString().includes('ftypavif');
};

const sources = await readJson(path.join(DATA, 'image-sources.json'), {});
const oldIndex = await readJson(path.join(DATA, 'images.json'), {});
const inventory = await readJson(path.join(DATA, 'listings.json'), null);
if (!Array.isArray(inventory?.listings)) throw new Error('Cannot safely prune image cache without a valid listings inventory.');
const activeIds = new Set(inventory.listings.filter(x => x.availabilityStatus === 'active').map(x => x.id));
const nextIndex = {};
const report = { refreshedAt: new Date().toISOString(), listings: {}, totals: { sourceListings: 0, cachedListings: 0, downloaded: 0, failed: 0, preserved: 0, prunedListings: 0, prunedIndexImages: 0, prunedOrphanFiles: 0 } };

await fs.mkdir(ASSETS, { recursive: true });

for (const [id, spec] of Object.entries(sources)) {
  if (!activeIds.has(id)) continue;
  report.totals.sourceListings++;
  const dir = path.join(ASSETS, id);
  await fs.mkdir(dir, { recursive: true });

  const preserved = [];
  for (const rel of Array.isArray(oldIndex[id]) ? oldIndex[id] : []) {
    try {
      const stat = await fs.stat(path.join(ROOT, rel));
      if (stat.isFile() && stat.size >= MIN_BYTES) preserved.push(rel);
    } catch {}
  }

  const files = [...preserved];
  const seenHashes = new Set();
  for (const rel of files) {
    try { seenHashes.add(crypto.createHash('sha1').update(await fs.readFile(path.join(ROOT, rel))).digest('hex')); } catch {}
  }

  const failures = [];
  let downloaded = 0;
  for (const url of Array.isArray(spec?.candidates) ? spec.candidates : []) {
    if (files.length >= MAX_IMAGES) break;
    try {
      const headers = {
        'user-agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/140 Safari/537.36',
        'accept': 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8'
      };
      if (spec?.referer) headers.referer = spec.referer;
      const res = await fetch(url, { headers, redirect: 'follow', signal: AbortSignal.timeout(20_000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const contentType = res.headers.get('content-type') || '';
      const arr = new Uint8Array(await res.arrayBuffer());
      const buf = Buffer.from(arr);
      if (!isLikelyImage(buf, contentType)) throw new Error(`not a usable image (${contentType || 'unknown'}, ${buf.length} bytes)`);
      const hash = crypto.createHash('sha1').update(buf).digest('hex');
      if (seenHashes.has(hash)) continue;
      seenHashes.add(hash);
      const ext = extFromType(contentType) || extFromUrl(url) || '.jpg';
      const filename = `${files.length + 1}${ext}`;
      const abs = path.join(dir, filename);
      await fs.writeFile(abs, buf);
      files.push(path.posix.join('assets', 'listings', id, filename));
      downloaded++;
      report.totals.downloaded++;
    } catch (err) {
      failures.push({ url, error: String(err?.message || err) });
      report.totals.failed++;
    }
  }

  if (files.length) {
    nextIndex[id] = files.slice(0, MAX_IMAGES);
    report.totals.cachedListings++;
  }
  report.totals.preserved += preserved.length;
  report.listings[id] = { cached: files.length, preserved: preserved.length, downloaded, failures: failures.slice(0, 5), photoPageUrl: spec?.photoPageUrl || null };
}

// Keep valid cached images for active listings temporarily missing from image-sources.json so refreshes do not cause regressions.
for (const [id, rels] of Object.entries(oldIndex)) {
  if (!activeIds.has(id)) continue;
  if (nextIndex[id]) continue;
  const valid = [];
  for (const rel of Array.isArray(rels) ? rels : []) {
    try {
      const stat = await fs.stat(path.join(ROOT, rel));
      if (stat.isFile() && stat.size >= MIN_BYTES) valid.push(rel);
    } catch {}
  }
  if (valid.length) nextIndex[id] = valid.slice(0, MAX_IMAGES);
}

// Removed, excluded, and confirmation-pending listings are not rendered. Delete their
// cached media so stale inventory cannot permanently inflate every checkout and Pages build.
// A listing that becomes active again is recached above during the same refresh.
for (const [id, rels] of Object.entries(oldIndex)) {
  if (activeIds.has(id)) continue;
  report.totals.prunedListings++;
  report.totals.prunedIndexImages += Array.isArray(rels) ? rels.length : 0;
  await fs.rm(path.join(ASSETS, id), { recursive: true, force: true });
}

const referenced = new Set(Object.values(nextIndex).flat().map(rel => path.resolve(ROOT, rel)));
for (const entry of await fs.readdir(ASSETS, { withFileTypes: true })) {
  const dir = path.join(ASSETS, entry.name);
  if (!entry.isDirectory()) continue;
  if (!activeIds.has(entry.name)) {
    if (!Object.hasOwn(oldIndex, entry.name)) report.totals.prunedListings++;
    await fs.rm(dir, { recursive: true, force: true });
    continue;
  }
  for (const file of await fs.readdir(dir, { withFileTypes: true })) {
    if (file.isFile() && !referenced.has(path.resolve(dir, file.name))) {
      await fs.rm(path.join(dir, file.name), { force: true });
      report.totals.prunedOrphanFiles++;
    }
  }
}

await writeJson(path.join(DATA, 'images.json'), nextIndex);
await writeJson(path.join(DATA, 'image-cache-report.json'), report);
console.log(`Image cache: ${report.totals.cachedListings}/${report.totals.sourceListings} source listings cached; ${report.totals.downloaded} new images; ${report.totals.failed} candidate failures.`);
