export function aggregateUnitCount(jsonLd = []) {
  let maximum = 0;
  const visit = value => {
    if (!value) return;
    if (Array.isArray(value)) {
      for (const item of value) visit(item);
      return;
    }
    if (typeof value !== 'object') return;
    if (Array.isArray(value.containsPlace)) maximum = Math.max(maximum, value.containsPlace.length);
    for (const child of Object.values(value)) visit(child);
  };
  visit(jsonLd);
  return maximum;
}
