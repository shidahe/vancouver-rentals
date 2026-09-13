const ACTIVE = 'active';
const MAX_EVIDENCE_AGE_MS = 24 * 60 * 60 * 1000;

const normalizedUrl = value => {
  try {
    const url = new URL(String(value || ''));
    url.hash = '';
    url.search = '';
    return url.href.replace(/\/$/, '');
  } catch {
    return null;
  }
};

// The live-detail verifier runs before several source-specific adapters. Keep a
// final fail-closed guard so a later adapter cannot accidentally republish an
// identity whose own current detail page has already supplied negative evidence.
export function activeListingContradictedByFreshEvidence(listing, evidence, nowMs = Date.now()) {
  if (!listing || (listing.availabilityStatus || listing.status) !== ACTIVE) return false;
  if (!evidence?.identityMatch || !evidence?.explicitNegative) return false;

  const checkedAt = Date.parse(evidence.checkedAt || '');
  if (!Number.isFinite(checkedAt) || nowMs - checkedAt > MAX_EVIDENCE_AGE_MS) return false;

  const listingUrl = normalizedUrl(listing.url);
  const evidenceUrl = normalizedUrl(evidence.sourceUrl || evidence.finalUrl);
  if (!listingUrl || listingUrl !== evidenceUrl) return false;

  const verifiedAt = Date.parse(listing.verifiedAt || '');
  return !Number.isFinite(verifiedAt) || checkedAt >= verifiedAt;
}
