# Vancouver Westside Rental Radar

A zero-backend static rental tracker for Kitsilano, Arbutus Ridge, Point Grey and nearby Vancouver Westside neighbourhoods.

## Architecture

- `index.html` — dashboard shell
- `style.css` — responsive UI
- `app.js` — Leaflet map, filters, match score, local browser state
- `data/listings.json` — latest normalized listing snapshot
- `data/history.json` — observed rent history

The app is intentionally static and suitable for GitHub Pages. It uses Leaflet + OpenStreetMap tiles from public CDNs and requires no application server.

## Browser-local state

Favorite, hidden/not-interested, contacted and notes are stored in `localStorage` under `vancouver-rentals:user-state:v1`. Refreshing or replacing listing JSON therefore does not overwrite personal state in the same browser/profile.

## Listing update contract

On each refresh:

1. Recheck public listing aggregators and priority purpose-built rental sites.
2. Normalize listings and deduplicate by building/address/unit/floorplan.
3. Preserve stable `id` values for existing listings.
4. Compare rent against `data/history.json`; append only meaningful observations/changes.
5. Set `priceDrop: true` when the current rent is below the previous observed rent.
6. Set `status: "new"` for newly discovered listings, `"active"` after the initial cycle, and `"removed"` only when unavailability is reasonably confirmed.
7. Never infer unknown AC, orientation, parking, incentive applicability, etc. Use `null` and add a `dataNotes` explanation where useful.
8. Update `meta.lastRefreshed`.

## Match score

The client-side score currently emphasizes 800+ sqft, 2BR+, 2BA, AC, newer construction, south/SE/SW exposure, parking, large windows and modern interiors, while penalizing confirmed north-facing units and confirmed lack of AC. It is deliberately transparent in `score()` in `app.js` and can be tuned over time.

## GitHub Pages

Configure Pages to deploy from the repository's `main` branch root. No build step is required.

## Data caveat

Rental availability changes quickly. The dashboard records when each source was last checked and should be treated as a search/triage tool; verify the original listing before contacting a landlord or property manager.
