export function realtylinkLaneHealth({ reachable = 0, total = 0, candidates = 0, previousCompleteCount = 0, removalEligible = true, suppression = null } = {}) {
  const partial = removalEligible === false && /partial realtylink snapshot/i.test(String(suppression || ''));
  if (reachable < 1) return { healthy: false, status: 'unhealthy', partial: false, detail: `${reachable}/${total} searches reachable; ${candidates} live candidates parsed` };
  if (candidates < 1) return { healthy: false, status: 'degraded', partial: false, detail: `${reachable}/${total} searches reachable; 0 live candidates parsed` };
  if (partial) return { healthy: false, status: 'degraded', partial: true, detail: `${reachable}/${total} searches reachable; partial snapshot parsed ${candidates} candidates versus complete baseline ${previousCompleteCount}; removals suppressed` };
  return { healthy: true, status: 'healthy', partial: false, detail: `${reachable}/${total} searches reachable; ${candidates} live candidates parsed` };
}

export function marketplaceLaneHealth({ reachable = 0, total = 0, candidates = 0 } = {}) {
  if (reachable < 1) return { healthy: false, status: 'unhealthy', detail: `${reachable}/${total} regional searches reachable; ${candidates} qualifying candidates parsed` };
  if (candidates < 1) return { healthy: false, status: 'degraded', detail: `${reachable}/${total} regional searches reachable; 0 qualifying candidates parsed` };
  const healthy = reachable >= 3;
  return { healthy, status: healthy ? 'healthy' : 'degraded', detail: `${reachable}/${total} regional searches reachable; ${candidates} qualifying candidates parsed` };
}
