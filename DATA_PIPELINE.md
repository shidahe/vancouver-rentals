# Listing refresh and verification pipeline

The public site optimizes for **high recall during discovery and high precision during publication**: we should find as many plausible new West Side rentals as possible, but an unavailable or stale unit must never appear as current inventory merely because a search index, cached page, or syndicated feed still contains it.

## Core rules

**Discovery evidence is not availability evidence.** Search results, cached crawls, snippets, stale marketplace detail pages, and syndicated copies can discover a candidate, but none of them alone may publish a unit as Active.

**Do not filter too early during discovery.** A candidate must not be discarded merely because sqft, AC, orientation, parking, building year, or bathroom count is missing from one source. Discover broadly first; enrich and score later. This prevents good listings from disappearing because an aggregator omitted a field.

## Status model

- `availabilityStatus: active` — sufficiently verified current inventory; shown by default.
- `availabilityStatus: needs_confirmation` — plausible but current availability cannot be proven; hidden by default.
- `availabilityStatus: removed` — explicit Gone/Rented/Unavailable/Inactive/404/410, or stronger fresh evidence says the unit is no longer offered; hidden by default.

`status` separately records the change event: `new`, `unchanged`, `price_drop`, `corrected`, or `removed`.

## Evidence model

Every observation should record source URL, source type, upstream provider/feed when known, observed/crawl timestamp, unit identity, rent, beds/baths/sqft, explicit availability wording, and conflicts.

### Evidence tiers

**Tier A — primary current evidence**
- official building live inventory
- property manager's own current availability page
- agent/manager page for a private condo when demonstrably current
- direct marketplace page known to be freshly retrieved rather than a cached/index snapshot

**Tier B — corroborating evidence**
- recent marketplace/building page
- recent syndicated inventory page

**Tier C — discovery only**
- web/search snippets
- cached search-engine results
- pages with old crawl dates
- archived/indexed detail-page snapshots

A retrieval tool returning a page does not imply a live HTTP request. If its crawl/observation timestamp is old, treat it as cached Tier C/B evidence, never fresh Tier A evidence.

## Independence rule

Two websites are not independent confirmations if they share the same upstream feed/provider. REW, Rentals.ca, Zillow, Zumper, Apartments.com, ForRent, Zolo, Condos.ca and similar sites may syndicate the same RentSync, MLS, CREA or property-manager data. Count independent evidence by **upstream source**, not hostname.

## Publish gate

A unit may be `active` only when either (1) a Tier A primary source explicitly shows that exact unit/floorplan as currently available, or (2) at least two sufficiently recent, genuinely independent sources agree on identity and availability with no fresher contradictory evidence.

Every Active listing must also have valid map coordinates. If availability cannot be proven, use `needs_confirmation`. Any fresher explicit Gone/Rented/Unavailable/Inactive/404/410 evidence wins over an older Available snapshot and changes the record to `removed`.

## User-browser evidence

A current screenshot or report from the user showing the actual browser result is high-priority fresh evidence. If it conflicts with an older indexed/crawled page, the current browser result wins unless a newer authoritative primary source proves otherwise. The same applies to price: a user-observed current detail-page price is stronger than an older search/index price and must trigger a fresh price reconciliation rather than being ignored.

## Discovery coverage matrix

Every full refresh must run **all** of these discovery lanes; checking only Google/MLS or only the priority buildings is insufficient:

1. **Marketplace lane:** Zumper/PadMapper, Rentals.ca, liv.rent, RentFaster, REW, Craigslist Vancouver, Zillow/other useful rental marketplaces.
2. **MLS/condo lane:** current Vancouver West rental inventory from MLS-backed broker/IDX pages and listing-agent pages.
3. **Purpose-built lane:** official availability for known and newly discovered rental buildings, including priority buildings.
4. **Property-manager lane:** Homax/Arbutus Rental, Macdonald Commercial, Warrington Residential, QuadReal, Hollyburn, Concert, Tribe/other relevant Vancouver West managers, plus managers discovered from marketplace listings.
5. **Address/neighbourhood lane:** separate searches for Kitsilano, Arbutus Ridge, Point Grey, and adjacent Dunbar/West Point Grey/Quilchena areas; do not rely on one broad `Vancouver West` query.
6. **Recency lane:** sort/search by newest or recently updated where the source supports it, and inspect at least the newest result pages rather than relying only on relevance ranking.
7. **User-lead lane:** any address/URL supplied by the user is immediately added to the candidate pool and reconciled against all available evidence.

### Discovery filter policy

Discovery should be broader than the UI preference filters. Capture plausible 2BR rentals even when one of sqft, AC, parking, orientation, or year is unknown. Apply the user's preferences during enrichment/ranking. Hard reject only obvious non-matches (wrong geography, clearly <2BR when searching the 2BR pool, short-term-only when inappropriate, explicit inactive/removed, etc.).

Maintain a temporary candidate set keyed by normalized address + unit/floorplan. Deduplicate only after candidates from all lanes have been collected, so a weak marketplace hit can be enriched by a stronger manager/agent source.

## Price freshness and reconciliation

Price is time-sensitive and can disagree even within one marketplace (search card, address page, and detail page may update at different times).

For every new candidate and every existing Active listing:

1. record each observed price together with source and observation timestamp;
2. prefer the freshest direct detail/primary page over category/search cards and cached snippets;
3. if fresh sources disagree, do **not** silently choose a price — mark `priceNeedsConfirmation` or quarantine the listing until reconciled if the difference is material;
4. re-check the detail page when a marketplace search card shows a newer price drop;
5. user-observed current price triggers immediate reconciliation and is treated as fresh evidence;
6. only mark `PRICE DROP` when stable listing identity is confirmed and the newer price is verified.

## Image ingestion

Images are a separate verified data product. Finding a photo URL is not the same as successfully importing a photo.

For each Active listing prefer: exact-unit photos, exact floorplan photos, official building interior/amenity photos, then official exterior photos. Never use another unit's interior photos as if they depict the tracked unit.

New refreshes should maintain image candidates/source metadata and the local GitHub Pages cache. Marketplace CDN URLs are download inputs, not assumed-stable browser hotlinks. The image-cache workflow downloads valid candidates to `assets/listings/<listing-id>/`; `data/images.json` is the browser-facing manifest. If no image can be safely cached, use the external gallery fallback.

## Full refresh workflow

### 1. Revalidate existing Active inventory
Before looking for new rentals, re-check every current Active listing. Remove or quarantine stale inventory first.

### 2. Run every discovery lane
Run the complete Discovery Coverage Matrix. Do not stop because a few good candidates have already been found. Collect candidates before applying preference scoring.

### 3. Merge and resolve identity
Normalize address/unit/floorplan, merge duplicate observations, and retain all source evidence. Never use a marketplace URL as stable identity.

### 4. Find primary sources
For purpose-built buildings locate official/property-manager inventory. For private condos/townhomes prefer listing-agent or property-manager originals. A marketplace listing should also be used to discover the manager/agent named in its description.

### 5. Validate freshness and price
Record observation/crawl date. Reconcile detail-page price against search-card/index prices. Never call a months-old crawl current.

### 6. Negative verification
Actively search for inactive, rented, unavailable, terminated, removed, 404 or 410 evidence for the same stable identity. Fresh negative evidence overrides older Active copies.

### 7. Cross-check conflicts
Compare unit, rent, sqft and availability across sources and detect shared upstream feeds before calling sources independent.

### 8. Apply conservative status
- explicit current availability + publish gate satisfied -> `active`
- plausible listing but freshness/independence insufficient -> `needs_confirmation`
- explicit unavailable/inactive or fresher removal evidence -> `removed`

### 9. Enrich instead of dropping
Fill sqft, AC, parking, pet policy, building year, orientation, balcony, large windows and modern-interior indicators from secondary/official sources where possible. Missing enrichment fields remain `null`; they do not erase an otherwise valid candidate.

### 10. Geocode Active inventory
Resolve verified address to latitude/longitude and confirm expected Vancouver neighbourhood. No Active record may have null coordinates.

### 11. Ingest and validate images
Find and validate image candidates, update `data/image-sources.json`, and let the cache workflow create local assets. Never allow image collection to weaken availability verification.

### 12. Compare history
Only compare prices after stable identity is established. Identity/sqft/unit drift is a correction or different listing, never a price drop.

### 13. Coverage audit before publish
Before finishing a refresh, explicitly verify that every discovery lane ran and review candidates that were excluded. Record the refresh coverage in `meta` (sources/lanes checked and timestamp). This is the guard against accidentally omitting an entire marketplace such as Zumper.

### 14. Publish
Only `availabilityStatus: active` appears by default and counts toward Active. Historical/uncertain units require `Show hidden`.

### 15. Cache bypass
The static app fetches JSON with `cache: no-store` plus a timestamp query so browser cache cannot resurrect removed listings.

## Priority buildings

The Raven, Raphael, Arbutus Terrace, Arbutus Residences, Kits Walk, 19 on the Greenway and other high-quality West Side purpose-built rentals are checked on every refresh even if general search finds nothing. Official/property-manager inventory takes priority over aggregator detail pages.

## Safety bias

Use **high recall for candidate discovery, high precision for Active publication**. It is acceptable to collect many candidates internally; it is not acceptable to publish stale inventory. Missing optional attributes should reduce match confidence, not cause a candidate to be missed entirely.