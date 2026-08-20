// Small runtime fixes kept separate from the main app bundle.
(function applySiteFixes() {
  if (typeof renderStats !== 'function' || typeof state === 'undefined') return;
  renderStats = function renderStatsWithAutomationTime() {
    const active = state.listings.filter(x => availability(x) === 'active');
    const fresh = active.filter(x => x.status === 'new');
    const drops = active.filter(x => x.status === 'price_drop' || x.priceDrop);
    const verify = state.listings.filter(x => availability(x) === 'needs_confirmation');
    const latest = state.meta?.lastAutomatedRefresh || state.meta?.lastZumperUnitRefresh || state.meta?.lastRefreshed || null;
    const display = latest ? latest.replace('T', ' ').replace(/Z$/, ' UTC').slice(0, 19) : '—';
    $('stats').innerHTML = `<div class="stat"><strong>${active.length}</strong><span>Active</span></div><div class="stat"><strong>${fresh.length}</strong><span>New</span></div><div class="stat"><strong>${drops.length}</strong><span>Price drops</span></div><div class="stat"><strong>${verify.length}</strong><span>To verify</span></div><div class="stat"><strong>${display}</strong><span>Last refreshed</span></div>`;
  };
  if (state.listings?.length) renderStats();
})();
