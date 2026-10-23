const SOFT_UNAVAILABLE_PATTERNS = [
  /alert me when this rental is available/i,
  /notify me when this rental is available/i,
  /we(?:'|’)ll let you know when this property is available/i
];

// Marketplace detail pages can retain an old description and price after a
// listing closes. A current wait-list prompt is a negative availability signal,
// but it receives the normal hide-then-confirm treatment instead of an
// immediate hard removal.
export function softUnavailablePrompt(text) {
  return SOFT_UNAVAILABLE_PATTERNS.find(pattern => pattern.test(String(text || ''))) || null;
}

export function softNegativeDisposition(isSoftNegative, previous = {}, nowMs = Date.now()) {
  if (!isSoftNegative) return null;
  const firstSeenAt = Date.parse(previous.softNegativeFirstSeenAt || previous.checkedAt || '');
  const confirmed = previous.explicitNegative && previous.negativeNeedsConfirmation &&
    Number.isFinite(firstSeenAt) && nowMs - firstSeenAt >= 4 * 60 * 60 * 1000;
  return confirmed ? 'remove' : 'hide';
}

// MLS-managed inventory has an authoritative lifecycle of its own. A linked
// marketplace repost disappearing is useful negative evidence for that repost,
// but it must not terminally remove the canonical MLS identity. Hide the card
// immediately and let current Realtylink evidence restore it, or let the
// consecutive complete-snapshot policy confirm removal.
export function isAuxiliaryNegativeForMls(listing, evidence) {
  if (listing?.mlsInventoryManaged !== true || !listing?.mls || !evidence?.explicitNegative) return false;
  const evidenceUrl = String(evidence.sourceUrl || evidence.finalUrl || listing.url || '');
  return !/realtylink\.org/i.test(evidenceUrl);
}

export function hasCurrentMarketplaceAvailability(text) {
  const value = String(text || '');
  const positive = /currently on market|check availability|request tour|for rent/i.test(value);
  const negative = /gone too soon|no longer available|this rental is unavailable|listing is inactive|currently off market|\boff market\b/i.test(value) ||
    !!softUnavailablePrompt(value);
  return positive && !negative;
}
