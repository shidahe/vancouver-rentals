// Display-only marker separation for multiple independent units at the same address.
// Listing lat/lng data remains exact; only the rendered marker position is offset.
(() => {
  const originalMoney = money;
  renderMarkers = function renderMarkersPerUnit(data) {
    for (const m of state.markers.values()) m.remove();
    state.markers.clear();

    const groups = new Map();
    for (const l of data) {
      if (!l.lat || !l.lng) continue;
      const key = (l.address || `${l.lat},${l.lng}`).toLowerCase().replace(/\s+/g, ' ').trim();
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(l);
    }

    for (const listings of groups.values()) {
      listings.forEach((l, index) => {
        const count = listings.length;
        let lat = l.lat, lng = l.lng;
        if (count > 1) {
          const angle = (2 * Math.PI * index / count) - Math.PI / 2;
          const radius = count <= 4 ? 0.00042 : 0.00052;
          lat += Math.sin(angle) * radius;
          lng += Math.cos(angle) * radius;
        }
        const av = availability(l);
        const icon = L.divIcon({
          className: `price-marker ${l.type === 'purpose-built' ? '' : 'condo'} ${av !== 'active' ? 'removed' : ''}`,
          html: `<div>${originalMoney(l.rent).replace('CA','')}</div>`,
          iconSize: [70, 28],
          iconAnchor: [35, 14]
        });
        const m = L.marker([lat, lng], { icon }).addTo(state.map);
        const unitLine = l.unit ? `<br><strong>Unit ${l.unit}</strong>` : '';
        const siblingLine = count > 1 ? `<br><small>${count} tracked units at this address · marker offset for visibility</small>` : '';
        m.bindPopup(`<strong>${l.buildingName || l.address}</strong>${unitLine}<br>${l.bedrooms}BR · ${l.sqft || '?'} sqft<br>${originalMoney(l.rent)}/mo${siblingLine}`);
        m.on('click', () => {
          if (window.innerWidth <= 900) setView('list');
          setTimeout(() => document.querySelector(`[data-id="${CSS.escape(l.id)}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 50);
        });
        state.markers.set(l.id, m);
      });
    }
  };

  if (typeof state !== 'undefined' && state.listings?.length && typeof render === 'function') render();
})();
