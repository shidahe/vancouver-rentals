# Automated rental refresh

The repository has a scheduled live-verification and discovery pipeline in `.github/workflows/refresh-listings.yml`.

## Schedule

The workflow runs every 6 hours and can also be started manually with **Actions → Refresh rental inventory → Run workflow**.

## Core flow

1. Launch Chromium through Playwright.
2. Re-open every `active` and `needs_confirmation` listing.
3. Save fresh evidence under `data/evidence/`.
4. Remove only on explicit live unavailable/inactive evidence for the matching inventory identity.
5. Hide as `needs_confirmation` after repeated verification failures rather than assuming a listing remains active.
6. Run high-recall discovery lanes.
7. Resolve each candidate to a live detail page.
8. Apply geography + identity + availability gates before publication.
9. Cache usable listing images through the existing local image-cache workflow.
10. Commit refreshed data to `main`, which updates GitHub Pages.

## Discovery vs publication

Discovery is intentionally high recall and may include nearby search noise. Publication is precision-first.

- Search/index pages discover candidates; they never prove availability.
- HTTP 401/403/429/5xx pages are unusable evidence, not confirmation and not removal evidence.
- Explicit current `inactive`, `rented`, `unavailable`, `gone`, 404 or 410 evidence overrides older positive evidence.
- A candidate outside the configured Vancouver West target geography is discarded even if a marketplace search page surfaced it.
- Real target-area 2BR listings may still be collected when they are under 800 sqft or have fewer than 2 baths; those are preference/filter dimensions, not discovery gates.

## Inventory identity and multi-unit buildings

A building/address is a grouping key, not a listing identity.

Primary identity order:

1. **canonical street address + explicit unit**
2. **canonical street address + floorplan** when a purpose-built source exposes a floorplan but no unit number
3. **canonical street address + exact detail URL** as a temporary fallback when the marketplace does not expose a public unit/floorplan identifier

Street normalization standardizes common variants such as `West → W`, `Street → St`, and `Avenue → Ave`. Unit suffixes such as `#312` are split out of the street address. This allows the same unit from MLS/Zumper/Rentals.ca to dedupe while keeping #301, #405, #706, etc. as separate listings.

Same-address inventory must never be collapsed merely because coordinates are identical. The frontend offsets overlapping same-address markers for display only; stored coordinates remain exact.

## Price safety

Price changes are allowed automatically only when the crawler has an exact single-inventory detail page. A multi-unit building page must never use the first price on the page to overwrite a specific unit. Static fields can be locked after high-confidence structured verification.

## Current adapters

### Zumper

Zumper currently runs full live per-inventory discovery for Kitsilano, West Point Grey, Dunbar, Arbutus and Quilchena. Exact detail pages are parsed from JSON-LD/body data, geo-gated to Vancouver West, deduped across sources, and can auto-publish when live verification succeeds.

### Rentals.ca

Rentals.ca currently runs in **candidate/evidence mode**. West-side search lanes discover detail pages and save parsed single-listing/floorplan evidence to `data/rentalsca-candidates.json`. Purpose-built pages can expose multiple floorplans, so publication will use `address + unit` or `address + floorplan`, never one record for the whole building.

### Other sources

RentFaster, official purpose-built pages, Homax/Arbutus Rental and other property-manager sources remain in the general verifier/source registry. liv.rent and Craigslist are planned next after the Rentals.ca candidate output is validated.

## Generated data

- `data/candidates.json` — current marketplace candidate pool
- `data/rentalsca-candidates.json` — Rentals.ca candidate/floorplan evidence
- `data/refresh-state.json` — verifier/source health
- `data/evidence/` — latest direct-page evidence snapshots
- `data/image-sources.json` — candidate image URLs for local caching
- `data/images.json` — successfully cached local images

The operating principle is **high recall during discovery, high precision for public Active inventory**.
