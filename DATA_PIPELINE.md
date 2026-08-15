# Listing refresh and verification pipeline

The public site must optimize for **current availability accuracy**, not raw search recall.

## Status model

Each listing has two separate concepts:

- `availabilityStatus`: `active`, `removed`, or `needs_confirmation`
- `status`: change/event state such as `new`, `unchanged`, `price_drop`, `removed`, or `corrected`

Only `availabilityStatus: active` is shown by default and counted as Active.

## Refresh pipeline

### 1. Discover candidates

Search public sources including official purpose-built rental sites, property-management sites, Rentals.ca, liv.rent, REW, Zumper/PadMapper, Craigslist, and manually supplied URLs.

A search result or cached search-engine snippet is **discovery evidence only**. It must never by itself make a listing Active.

### 2. Verify every candidate at the detail source

Before publishing as Active, open the current detail page and verify, when applicable:

- source URL resolves successfully
- availability is explicitly current (`Available now`, an active move-in date, `For rent`, etc.)
- address/building matches
- unit/floor-plan identity matches
- rent matches the current page
- bedrooms/bathrooms/sqft match

If the page says rented, unavailable, removed, expired, 404/410, or equivalent, set `availabilityStatus: removed`.

If the page loads but identity has drifted (for example the same source URL now represents a different unit), or current availability cannot be proven, set `availabilityStatus: needs_confirmation` and exclude it from the default site.

### 3. Prefer authoritative and fresh evidence

Evidence priority:

1. Official building / property manager availability page
2. Current direct listing page from a marketplace
3. Current Craigslist detail page
4. Search-engine result / cached snippet (discovery only)

When two sources conflict, prefer the freshest authoritative source. Material identity conflicts (unit, sqft, bedrooms) must not be silently treated as a price change.

### 4. Stable identity and deduplication

Do not use a marketplace URL as the listing identity. URLs can be reused or redirected.

Use a stable logical identity derived from building/address + unit/floor-plan. When a source URL changes to a different unit, keep the old listing as historical/unverified and create a new listing record for the newly verified unit.

### 5. Compare with prior snapshot

For each stable listing identity:

- first verified appearance -> `status: new`
- same verified listing, lower rent -> `status: price_drop`
- same verified listing, unchanged -> `status: unchanged`
- no longer available -> `availabilityStatus: removed`, `status: removed`
- source fields materially changed in a way that suggests stale/incorrect prior data -> `status: corrected` (not a price drop)

Append meaningful observations to `data/history.json`.

### 6. Publish gate

Before committing `data/listings.json`, every `availabilityStatus: active` record must have:

- `lastChecked`
- `verifiedAt`
- `verificationMethod`
- a direct source URL
- explicit current availability evidence from the opened page

Records failing the gate are `needs_confirmation`, not Active.

### 7. Front-end cache policy

The application fetches listing/history JSON with cache bypassing so a newly deployed removal or price change is not hidden behind an older browser cache.

## Priority-building rule

The Raven, Raphael, Arbutus Terrace, Arbutus Residences, Kits Walk and other priority buildings are always checked during a refresh even when no candidate appears in general search results. Their **official availability pages** should be checked first when available.
