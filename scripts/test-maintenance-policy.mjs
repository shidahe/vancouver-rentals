import fs from 'node:fs/promises';
import { findExistingSeedListing, listingMls, mlsIdentity } from './inventory-identity.mjs';
import { firstLikelyRent, parseFacts } from './listing-parser.mjs';
import { isAutoManagedListing } from './stale-auto-policy.mjs';
import { verifiedPhotoCandidates } from './listing-photo-candidates.mjs';

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
const officialWatch = JSON.parse(await read('data/official-watch.json'));
const indexHtml = await read('index.html');

const failures = [];
const staleFixture = { availabilityStatus: 'active', source: 'REW / Rent Sync', verificationMethod: 'Automated live browser check matched listing identity and current availability wording.' };
if (!isAutoManagedListing(staleFixture)) failures.push('Non-Zumper exact-detail inventory bypasses stale expiry.');
if (isAutoManagedListing({ ...staleFixture, mlsInventoryManaged: true })) failures.push('Authoritative MLS-feed inventory is incorrectly handled by generic stale expiry.');
if (isAutoManagedListing({ ...staleFixture, availabilityStatus: 'needs_confirmation' })) failures.push('Inactive inventory is incorrectly eligible for stale expiry.');
if (/id="minSqft"[^>]*value="800"/.test(indexHtml)) failures.push('800 sqft preference is still a default discovery/display gate.');
for (const pattern of [/bedrooms\s*===\s*2/, /beds\s*!==\s*2/, /max_bedrooms=2/]) {
  if (pattern.test(source)) failures.push(`2BR-only gate remains: ${pattern}`);
}
for (const lane of ['zumper-kitsilano-4br', 'rentalsca-kitsilano-4br', 'livrent-vancouver-4br']) {
  if (!catalog.discovery.some(x => x.id === lane)) failures.push(`Missing 4BR discovery lane: ${lane}`);
}
for (const building of ['kits-walk', 'larchway-gardens', 'viridian']) {
  const project = officialWatch.projects.some(x => x.id === building);
  const source = catalog.discovery.some(x => x.id.startsWith(building.replace('-gardens', '')) && ['official', 'property_manager'].includes(x.kind));
  if (!project) failures.push(`Priority building missing from official watch: ${building}`);
  if (!source) failures.push(`Priority building missing from live source catalog: ${building}`);
}
const kitsWalk605 = catalog.seedCandidates?.find(x => x.id === 'rew-kits-walk-605');
if (!kitsWalk605 || kitsWalk605.unit !== '605' || kitsWalk605.address !== '2075 W 12th Ave, Vancouver, BC' || kitsWalk605.expectedBeds !== 2 || !kitsWalk605.autoPublish || !/\/605-2075-w-12th-avenue-vancouver-bc$/.test(kitsWalk605.url)) {
  failures.push('Current Kits Walk Unit 605 exact-detail verification seed is missing or weakened.');
}
const kitsWalk605Page = '$3,650/monthUpdated 7 days ago 2075 W 12th Avenue Vancouver, BC 2 Bed2 Bath741 SqftAvailable Oct 1 Kits Walk offers studio, 1, 2, and 3 bedroom homes.';
const kitsWalk605Facts = parseFacts(kitsWalk605Page);
if (firstLikelyRent(kitsWalk605Page) !== 3650 || kitsWalk605Facts.bedrooms !== 2 || kitsWalk605Facts.bathrooms !== 2 || kitsWalk605Facts.sqft !== 741) {
  failures.push(`Kits Walk Unit 605 compact REW facts parse incorrectly: rent=${firstLikelyRent(kitsWalk605Page)}, facts=${JSON.stringify(kitsWalk605Facts)}`);
}
const oldKitsWalkFloorplan = { id: 'kits-walk-2br-flex-616', unit: '2 Bedroom Flex', address: kitsWalk605.address };
if (findExistingSeedListing([oldKitsWalkFloorplan], kitsWalk605) !== null) {
  failures.push('Exact Kits Walk Unit 605 is incorrectly merged into an address-level floorplan placeholder.');
}
if (findExistingSeedListing([{ ...oldKitsWalkFloorplan, id: kitsWalk605.listingId, unit: '605' }], kitsWalk605)?.unit !== '605') {
  failures.push('Previously published Kits Walk Unit 605 cannot be matched by its exact listing identity.');
}
for (const building of ['kits-walk', 'viridian']) {
  const project = officialWatch.projects.find(x => x.id === building);
  if (!project?.positiveSignals?.includes('now renting')) failures.push(`${building} does not recognize its official Now Renting status.`);
}
if (!source.includes('auto_published_authoritative_mls')) failures.push('Current authoritative MLS inventory cannot auto-publish.');
if (!source.includes('two consecutive healthy Realtylink inventory snapshots')) failures.push('MLS disappearance does not fail closed.');
if (/bedrooms\s*:\s*c\.bedrooms\s*\|\|\s*2/.test(source)) failures.push('Unknown candidate bedrooms are still defaulted to 2BR.');
if (!source.includes('mlsInventoryManaged!==true')) failures.push('MLS search disappearance is not limited to feed-managed inventory.');
if (!source.includes("imageSources[seed.listingId]") || !source.includes('photoCandidates')) {
  failures.push('Strict seed publication does not preserve photo candidates for the image cache.');
}
if (!source.includes("imageSources[listing.id]") || !source.includes('verifiedPhotoCandidates(result.images)')) {
  failures.push('Verified active detail pages do not repair missing image cache sources.');
}
if (!source.includes("meta[property=\"og:image\"]") || !source.includes("meta[name=\"twitter:image\"]")) {
  failures.push('Exact detail-page verification does not prioritize social preview listing photos.');
}

const rewPhotos = verifiedPhotoCandidates([
  'https://assets.rew.ca/assets/misc/share-preview.png',
  'https://assets.rew.ca/assets/logos/rew-one/rew-icon.svg',
  'https://assets-listings.rew.ca/listing/rent_sync/87904_1585241/00_subject-a.webp?auto=format',
  'https://assets-listings.rew.ca/listing/rent_sync/87904_1585241/00_subject-b.jpg?auto=format',
  'https://assets-listings.rew.ca/listing/rent_sync/87904_1585241/00_subject-c.webp?auto=format',
  'https://assets-listings.rew.ca/listing/rent_sync/other/00_related.jpg?auto=format'
]);
if (rewPhotos.length !== 3 || rewPhotos.some(url => !url.includes('/87904_1585241/'))) {
  failures.push(`REW photo extraction mixed subject photos with chrome or related listings: ${JSON.stringify(rewPhotos)}`);
}

const legacyMlsListing = { id: '2268-w-broadway-312-r3153999', unit: '312 · MLS R3153999' };
if (listingMls(legacyMlsListing) !== 'R3153999' || mlsIdentity(listingMls(legacyMlsListing)) !== 'mls:r3153999') {
  failures.push('Legacy MLS-backed listings do not resolve to the canonical MLS identity.');
}

// Regression fixture: the reported Kitsilano 4BR must pass the global discovery gate.
const r3160272 = { mls: 'R3160272', bedrooms: 4, rent: 6950, address: '2788 W 1st Avenue, Vancouver, BC' };
if (mlsIdentity(r3160272.mls) !== 'mls:r3160272' || !(r3160272.bedrooms >= 2 && r3160272.rent >= 2500 && r3160272.rent <= 12000)) {
  failures.push('R3160272 regression fixture is rejected by the 2BR+ policy.');
}

if (failures.length) {
  console.error(failures.join('\n'));
  process.exit(1);
}
console.log('Maintenance policy regression tests passed: 2BR+, MLS identity/publication, and fail-closed removal.');
