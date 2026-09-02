import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { bedroomEligible } from './discovery-policy.mjs';

assert.equal(bedroomEligible(1), false);
assert.equal(bedroomEligible(2), true);
assert.equal(bedroomEligible(3), true);

// Permanent regression: this 4BR townhouse exposed the former exact-2BR bug.
const r3160272 = { mls: 'R3160272', address: '2788 W 1st Avenue', bedrooms: 4 };
assert.equal(bedroomEligible(r3160272.bedrooms), true, `${r3160272.mls} must remain discoverable`);

const craigslist = await fs.readFile(new URL('./refresh-craigslist.mjs', import.meta.url), 'utf8');
assert.doesNotMatch(craigslist, /max_bedrooms=2/, 'Craigslist searches must not cap results at 2BR');

const sources = JSON.parse(await fs.readFile(new URL('../data/live-sources.json', import.meta.url), 'utf8'));
for (const source of sources.discovery.filter(x => ['zumper-search', 'rentalsca-search'].includes(x.adapter))) {
  assert.doesNotMatch(source.url, /(?:\/2-beds|\/2-bedrooms)(?:\/|$)/, `${source.id} must not use an exact-2BR search route`);
}

console.log('Discovery bedroom policy: 2BR, 3BR and R3160272 4BR regression pass.');
