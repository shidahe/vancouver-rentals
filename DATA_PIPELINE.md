# Listing refresh and verification pipeline

The public site optimizes for **false-positive avoidance**: an unavailable unit must not appear as current inventory merely because a search index, cached page, or syndicated feed still contains it.

## Core rule

**Discovery evidence is not availability evidence.**

Search results, cached crawls, snippets, stale marketplace detail pages, and syndicated copies can discover a candidate, but none of them alone may publish a unit as Active.

## Status model

- `availabilityStatus: active` — sufficiently verified current inventory; shown by default.
- `availabilityStatus: needs_confirmation` — plausible but current availability cannot be proven; hidden by default.
- `availabilityStatus: removed` — explicit Gone/Rented/Unavailable/404/410, or stronger fresh evidence says the unit is no longer offered; hidden by default.

`status` separately records the change event: `new`, `unchanged`, `price_drop`, `corrected`, or `removed`.

## Evidence model

Every observation records:

- source URL
- source type (`official`, `property_manager`, `marketplace`, `search_index`)
- upstream provider/feed when known (for example RentSync)
- observed/crawl timestamp if available
- unit identity (address + unit/floorplan)
- rent / beds / baths / sqft
- explicit availability wording
- confidence and conflicts

### Evidence tiers

**Tier A — primary current evidence**
- official building live inventory
- property manager's own current availability page
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

Two websites are not independent confirmations if they share the same upstream feed/provider. REW, Rentals.ca, Zillow, Zumper, Apartments.com, ForRent and similar sites may syndicate the same RentSync/property-manager data.

Count independent evidence by **upstream source**, not hostname.

## Publish gate

A unit may be `active` only when one of these is true:

1. A Tier A primary source explicitly shows that exact unit/floorplan as currently available; or
2. There are at least two sufficiently recent, genuinely independent sources agreeing on identity and availability, with no fresher contradictory evidence.

Additionally, every Active listing must have valid map coordinates (`lat` and `lng`) before publication. Coordinate lookup is part of ingestion, not an optional UI enhancement. If an otherwise verified listing has no coordinates yet, geocode the verified street address before committing it as Active.

If neither availability condition is met, use `needs_confirmation`.

Any fresher explicit Gone/Rented/Unavailable/404/410 evidence immediately wins over an older Available snapshot and changes the record to `removed`.

## User-browser evidence

A current screenshot or report from the user showing the actual browser result is high-priority fresh evidence. If it conflicts with an older indexed/crawled page, the current browser result wins unless a newer authoritative primary source proves otherwise.

## Refresh workflow

### 1. Discover
Search official purpose-built sites, property managers, Rentals.ca, liv.rent, REW, Zumper/PadMapper, Craigslist, and manually supplied URLs. Candidates remain unpublished.

### 2. Resolve identity
Use building/address + unit/floorplan as stable identity. Never use a marketplace URL as identity; URLs can be reused, redirected, or keep stale slugs.

### 3. Find the primary source
For purpose-built buildings, locate the official building/property-manager inventory first. Aggregators are secondary. For private condos, prefer the actual property manager/agent page where available.

### 4. Validate freshness
Record the page's observation/crawl date when surfaced by the retrieval tool. Never describe a months-old cached page as 'currently opened/live'.

### 5. Cross-check conflicts
Compare current unit list, rent, sqft and availability across sources. Detect shared upstream feeds before calling sources independent.

### 6. Apply conservative status
- explicit current availability + publish gate satisfied -> `active`
- plausible listing but freshness/independence insufficient -> `needs_confirmation`
- explicit unavailable or fresher evidence removes the unit -> `removed`

### 7. Geocode Active inventory
Resolve the verified street address to latitude/longitude. Confirm the point is in the expected Vancouver neighbourhood and is not a same-number address in another city or on another street. No Active record may have null coordinates.

### 8. Compare history
Only compare prices after stable identity is established. Identity/sqft/unit drift is a correction or a different listing, never a price drop.

### 9. Publish
Only `availabilityStatus: active` appears by default and counts toward Active. Historical/uncertain units require `Show hidden`.

### 10. Cache bypass
The static app fetches JSON with `cache: no-store` plus a timestamp query so browser cache cannot resurrect a removed listing after deployment.

## Priority buildings

The Raven, Raphael, Arbutus Terrace, Arbutus Residences, Kits Walk and other priority buildings are checked on every refresh even if general search finds nothing. Official/property-manager inventory takes priority over aggregator detail pages.

## Safety bias

When evidence is ambiguous, hide the listing rather than risk showing a dead unit. The site should have fewer listings with higher precision, not many stale listings.
