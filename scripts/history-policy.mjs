export const historyEventKey = event => JSON.stringify([
  String(event?.date || ''),
  event?.rent ?? null,
  String(event?.note || '').trim()
]);

export function dedupeHistoryEvents(history = {}) {
  let removed = 0;
  const normalized = {};
  for (const [listingId, events] of Object.entries(history)) {
    const seen = new Set();
    normalized[listingId] = [];
    for (const event of Array.isArray(events) ? events : []) {
      const key = historyEventKey(event);
      if (seen.has(key)) {
        removed += 1;
        continue;
      }
      seen.add(key);
      normalized[listingId].push(event);
    }
  }
  return { history: normalized, removed };
}

const scopeChurnNote = note => /^(?:CORRECTED: restored after exact current MLS detail|AUTO-REMOVED: MLS )/.test(String(note || ''));

export function pruneExcludedScopeChurn(history = {}, excludedIds = []) {
  const excluded = new Set(excludedIds);
  let removed = 0;
  const normalized = {};
  for (const [listingId, events] of Object.entries(history)) {
    let scopeExcluded = false;
    normalized[listingId] = [];
    for (const event of Array.isArray(events) ? events : []) {
      if (/^EXCLUDED:/.test(String(event?.note || ''))) scopeExcluded = true;
      if (excluded.has(listingId) && scopeExcluded && scopeChurnNote(event?.note)) {
        removed += 1;
        continue;
      }
      normalized[listingId].push(event);
    }
  }
  return { history: normalized, removed };
}
