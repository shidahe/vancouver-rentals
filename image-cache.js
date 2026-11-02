window.LOCAL_IMAGE_CACHE = {};

(async function loadLocalImageCache() {
  // Take over image selection immediately, before the async cache fetch completes.
  // This prevents the initial render from racing ahead and requesting brittle remote
  // VERIFIED_IMAGES URLs. While the local manifest is loading, cards show the safe
  // source-link placeholder; once loaded, render() swaps in same-origin cached files.
  const originalPhotoMarkup = photoMarkup;
  let cacheLoaded = false;

  imagesFor = function imagesForLocal(l) {
    const local = window.LOCAL_IMAGE_CACHE?.[l.id];
    return Array.isArray(local) ? local.filter(Boolean) : [];
  };

  photoMarkup = function photoMarkupLocal(l) {
    const images = imagesFor(l);
    if (images.length) return originalPhotoMarkup(l);
    const target = l.photoPageUrl || l.url || '#';
    const message = cacheLoaded ? 'No source photo is available' : 'Loading photos…';
    const linkLabel = cacheLoaded ? 'Open source listing ↗' : 'Open source ↗';
    return `<div class="photo-wrap"><div class="photo-placeholder photo-fallback"><strong>${l.buildingName || 'Rental listing'}</strong><span>${message}</span><a class="photo-source-link" href="${target}" target="_blank" rel="noopener noreferrer">${linkLabel}</a></div></div>`;
  };

  try {
    const response = await fetch(`data/images.json?t=${Date.now()}`, { cache: 'no-store' });
    if (response.ok) window.LOCAL_IMAGE_CACHE = await response.json();
  } catch (err) {
    console.warn('Local image cache unavailable', err);
  }
  cacheLoaded = true;

  if (typeof state !== 'undefined' && state.listings?.length && typeof render === 'function') render();
})();
