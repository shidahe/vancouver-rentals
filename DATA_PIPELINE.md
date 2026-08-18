# Listing refresh and verification pipeline

The public site optimizes for **false-positive avoidance**: an unavailable unit must not appear as current inventory merely because a search index, cached page, or syndicated feed still contains it.

## Core rule

**Discovery evidence is not availability evidence.**

Search results, cached crawls, snippets, stale marketplace detail pages, and syndicated copies can discover a candidate, but none of them alone may publish a unit as Active.

## Status model

- `availabilityStatus: active` — sufficiently verified current inventory; shown by default.
- `availabilityStatus: needs_confirmation` — plausible but current availability cannot be proven; hidden by default.
- `availabilityStatus: removed` — explicit Gone/Rented/Unavailable/Inactive/404/410, or stronger fresh evidence says the unit is no longer offered; hidden by default.

`status` separately records the change event: `new`, `unchanged`, `price_drop`, `corrected`, or `removed`.

## Evidence model

Every observation should record:

- source URL
- source type (`official`, `property_manager`, `marketplace`, `search_index`)
- upstream provider/feed when known (for example RentSync or MLS)
- observed/crawl timestamp if available
- unit identity (address + unit/floorplan)
- rent / beds / baths / sqft
- explicit availability wording
- confidence and conflicts

### Evidence tiers

**Tier A — primary current evidence**
- official building live inventory
- property manager's own current availability page
- agent/manager page for a private condo when it is demonstrably current
- direct marketplace page known to be freshly retrieved rather than a cached/index snapshot

**Tier B — corroborating evidence**
- recent marketplace/building page
- recent syndicated inventory page

**Tier C — discovery only**
- web/search snippets
- cached search-engine results
- pages with old crawl dates
- archived/indexed detail-page snapshots

A tool returning an `open` page does **not** imply a live HTTP request. If its crawl/observation timestamp is old, treat it as cached Tier C/B evidence, never as fresh Tier A evidence.

## Independence rule

Two websites are not independent confirmations if they share the same upstream feed/provider. REW, Rentals.ca, Zillow, Zumper, Apartments.com, ForRent, Zolo, Condos.ca and similar sites may syndicate the same RentSync, MLS, CREA or property-manager data.

Count independent evidence by **upstream source**, not hostname.

## Publish gate

A unit may be `active` only when one of these is true:

1. A Tier A primary source explicitly shows that exact unit/floorplan as currently available; or
2. There are at least two sufficiently recent, genuinely independent sources agreeing on identity and availability, with no fresher contradictory evidence.

Additionally, every Active listing must have valid map coordinates (`lat` and `lng`) before publication. Coordinate lookup is part of ingestion, not an optional UI enhancement.

If neither availability condition is met, use `needs_confirmation`.

Any fresher explicit Gone/Rented/Unavailable/Inactive/404/410 evidence immediately wins over an older Available snapshot and changes the record to `removed`.

## User-browser evidence

A current screenshot or report from the user showing the actual browser result is high-priority fresh evidence. If it conflicts with an older indexed/crawled page, the current browser result wins unless a newer authoritative primary source proves otherwise.

## Image ingestion

Images are a separate verified data product. **Finding a photo URL is not the same as successfully importing a photo.**

### Image priority

For each Active listing, prefer images in this order:

1. photos of the exact unit/listing
2. official photos of the exact floorplan
3. official building interior / amenity photos
4. official building exterior photos

Never use another unit's interior photos as if they depict the tracked unit.

### Image fields

New listing refreshes should store image metadata in `data/listings.json` where available:

- `images`: URLs that were actually validated as embeddable candidates
- `photoPageUrl`: source page containing the listing's gallery; defaults to the listing URL
- `photoCount`: source-reported photo count when known
- `imageSource`: source/provider of the embedded image URLs
- `imageScope`: `unit`, `floorplan`, or `building`
- `imagesCheckedAt`: when image availability was last checked

The hard-coded `VERIFIED_IMAGES` object in `app.js` is transitional legacy data. New updates should write image URLs into listing data instead.

### Image validation gate

Before an image URL is considered imported:

1. confirm it belongs to the correct listing/unit/floorplan/building;
2. prefer stable official/property-manager image URLs over marketplace CDN URLs;
3. test that the URL can actually be loaded independently, not merely found inside page HTML;
4. reject short-lived signed URLs, session URLs or URLs that immediately fail anonymous loading;
5. where multiple candidate URLs exist, keep more than one so the browser can fail over;
6. do not describe a listing as having embedded photos unless at least one candidate is expected to load.

Marketplace CDNs such as MLS mirrors can expire or block hotlinking. When stable embedding cannot be established, do **not** fabricate a successful import. Keep `images` empty and use `photoPageUrl`/`photoCount` so the UI shows **View photos on source**.

### Runtime failure handling

The front end tries the next candidate if an image fails to load. Only after all candidate images fail does it replace the carousel with **View photos on source**. A single dead CDN URL must not blank the entire photo card.

## Refresh workflow

### 1. Revalidate existing Active inventory
Before looking for new rentals, re-check every current Active listing. Remove or quarantine stale inventory first.

### 2. Discover
Search official purpose-built sites, property managers, Rentals.ca, liv.rent, REW, Zumper/PadMapper, Craigslist, MLS-backed sources, and manually supplied URLs. Candidates remain unpublished.

### 3. Resolve identity
Use building/address + unit/floorplan as stable identity. Never use a marketplace URL as identity; URLs can be reused, redirected, or retain stale slugs.

### 4. Find the primary source
For purpose-built buildings, locate the official building/property-manager inventory first. Aggregators are secondary. For private condos, prefer the actual property manager/agent page where available.

### 5. Validate freshness
Record the page's observation/crawl date when surfaced by the retrieval tool. Never describe a months-old cached page as current/live.

### 6. Negative verification
Actively look for fresher evidence that the unit is inactive, rented, unavailable, terminated or removed. Fresh negative evidence overrides older Active copies.

### 7. Cross-check conflicts
Compare current unit list, rent, sqft and availability across sources. Detect shared upstream feeds before calling sources independent.

### 8. Apply conservative status
- explicit current availability + publish gate satisfied -> `active`
- plausible listing but freshness/independence insufficient -> `needs_confirmation`
- explicit unavailable/inactive or fresher evidence removes the unit -> `removed`

### 9. Geocode Active inventory
Resolve the verified street address to latitude/longitude. Confirm the point is in the expected Vancouver neighbourhood. No Active record may have null coordinates.

### 10. Ingest and validate images
For each Active listing, find the best available exact-unit/floorplan/building photos, verify identity and embeddability, populate `images` and image metadata when stable, otherwise set an external gallery URL/count. Never allow image collection to weaken availability verification.

### 11. Compare history
Only compare prices after stable identity is established. Identity/sqft/unit drift is a correction or a different listing, never a price drop.

### 12. Publish
Only `availabilityStatus: active` appears by default and counts toward Active. Historical/uncertain units require `Show hidden`.

### 13. Cache bypass
The static app fetches JSON with `cache: no-store` plus a timestamp query so browser cache cannot resurrect a removed listing after deployment.

## Priority buildings

The Raven, Raphael, Arbutus Terrace, Arbutus Residences, Kits Walk and other priority buildings are checked on every refresh even if general search finds nothing. Official/property-manager inventory takes priority over aggregator detail pages.

## Safety bias

When evidence is ambiguous, hide the listing rather than risk showing a dead unit. The site should have fewer listings with higher precision, not many stale listings. The same principle applies to photos: an external-gallery fallback is preferable to a broken or misleading embedded image.
