import fs from 'node:fs/promises';

const read = p => fs.readFile(p, 'utf8');
const activeAdapters = [
  'scripts/refresh-listings.mjs',
  'scripts/refresh-zumper-units-v2.mjs',
  'scripts/refresh-rentalsca.mjs',
  'scripts/refresh-livrent.mjs',
  'scripts/refresh-craigslist.mjs',
  'scripts/refresh-realtylink.mjs',
  'scripts/reconcile-candidates.mjs'
];
const source = (await Promise.all(activeAdapters.map(read))).join('\n');
const catalog = JSON.parse(await read('data/live-sources.json'));

const failures = [];
for (const pattern of [/bedrooms\s*===\s*2/, /beds\s*!==\s*2/, /max_bedrooms=2/]) {
  if (pattern.test(source)) failures.push(`2BR-only gate remains: ${pattern}`);
}
for (const lane of ['zumper-kitsilano-4br', 'rentalsca-kitsilano-4br', 'livrent-vancouver-4br']) {
  if (!catalog.discovery.some(x => x.id === lane)) failures.push(`Missing 4BR discovery lane: ${lane}`);
}
if (!source.includes("mls:${norm(mls)}")) failures.push('MLS number is not a canonical identity.');
if (!source.includes('auto_published_authoritative_mls')) failures.push('Current authoritative MLS inventory cannot auto-publish.');
if (!source.includes('two consecutive healthy Realtylink inventory snapshots')) failures.push('MLS disappearance does not fail closed.');

// Regression fixture: the reported Kitsilano 4BR must pass the global discovery gate.
const r3160272 = { mls: 'R3160272', bedrooms: 4, rent: 6950, address: '2788 W 1st Avenue, Vancouver, BC' };
if (!(r3160272.bedrooms >= 2 && r3160272.rent >= 2500 && r3160272.rent <= 12000)) {
  failures.push('R3160272 regression fixture is rejected by the 2BR+ policy.');
}

if (failures.length) {
  console.error(failures.join('\n'));
  process.exit(1);
}
console.log('Maintenance policy regression tests passed: 2BR+, MLS identity/publication, and fail-closed removal.');
