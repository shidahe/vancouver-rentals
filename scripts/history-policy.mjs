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
