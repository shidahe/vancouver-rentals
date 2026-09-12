export function realtylinkLaneHealth({ reachable = 0, total = 0, candidates = 0, previousCompleteCount = 0, removalEligible = true, suppression = null } = {}) {
  const partial = removalEligible === false && /partial realtylink snapshot/i.test(String(suppression || ''));
  if (reachable < 1) return { healthy: false, positiveDiscoveryHealthy: false, status: 'unhealthy', partial: false, detail: `${reachable}/${total} searches reachable; ${candidates} live candidates parsed` };
  if (candidates < 1) return { healthy: false, positiveDiscoveryHealthy: false, status: 'degraded', partial: false, detail: `${reachable}/${total} searches reachable; 0 live candidates parsed` };
  if (partial) return { healthy: false, positiveDiscoveryHealthy: true, status: 'degraded', partial: true, detail: `${reachable}/${total} searches reachable; ${candidates} current live candidates parsed from a partial snapshot versus complete baseline ${previousCompleteCount}; positive discovery usable, removals suppressed` };
  return { healthy: true, positiveDiscoveryHealthy: true, status: 'healthy', partial: false, detail: `${reachable}/${total} searches reachable; ${candidates} live candidates parsed` };
}

export function marketplaceLaneHealth({ reachable = 0, total = 0, candidates = 0 } = {}) {
  if (reachable < 1) return { healthy: false, status: 'unhealthy', detail: `${reachable}/${total} regional searches reachable; ${candidates} qualifying candidates parsed` };
  if (candidates < 1) return { healthy: false, status: 'degraded', detail: `${reachable}/${total} regional searches reachable; 0 qualifying candidates parsed` };
  const healthy = reachable >= 3;
  return { healthy, status: healthy ? 'healthy' : 'degraded', detail: `${reachable}/${total} regional searches reachable; ${candidates} qualifying candidates parsed` };
}

export function rentalscaLaneHealth({ reachable = 0, total = 0, candidates = 0, diagnostics = {} } = {}) {
  const lane=marketplaceLaneHealth({reachable,total,candidates});
  if(candidates>0||reachable<1)return lane;
  const observed=Number(diagnostics.searchResultCount||0);
  const urls=Number(diagnostics.detailUrls||0);
  const blocked=Number(diagnostics.detailBlocked||0);
  if(blocked>0)return {...lane,detail:`${lane.detail}; ${blocked} detail pages blocked after ${urls} discovered URLs`};
  if(observed>0&&urls===0)return {...lane,structureMismatch:true,detail:`${lane.detail}; parser structure mismatch (${observed} visible search results, 0 detail URLs)`};
  if(observed>0)return {...lane,detail:`${lane.detail}; ${observed} visible search results, ${urls} detail URLs, ${Number(diagnostics.detailParsed||0)} parsed details`};
  return lane;
}

export function craigslistLaneHealth({ reachable = 0, total = 0, candidates = 0, sourceHealth = {} } = {}) {
  const lane = marketplaceLaneHealth({ reachable, total, candidates });
  if (candidates > 0 || reachable < 1) return lane;
  const observations = Object.values(sourceHealth || {}).filter(x => x?.ok === true);
  const anchors = observations.reduce((sum,x)=>sum+Number(x.anchorCount||0),0);
  const detailLinks = observations.reduce((sum,x)=>sum+Number(x.detailLinkCount||0)+Number(x.embeddedDetailLinkCount||0),0);
  const resultContainers = observations.reduce((sum,x)=>sum+Number(x.resultContainerCount||0),0);
  const postIds = observations.reduce((sum,x)=>sum+Number(x.postIdCount||0),0);
  if (anchors > 0 && detailLinks === 0) {
    return {...lane,structureMismatch:true,detail:`${lane.detail}; parser structure mismatch (${anchors} anchors, ${resultContainers} result containers, ${postIds} post IDs, 0 detail links)`};
  }
  return lane;
}
