window.LOCAL_IMAGE_CACHE = {};

(async function loadLocalImageCache() {
  try {
    const response = await fetch(`data/images.json?t=${Date.now()}`, { cache: 'no-store' });
    if (response.ok) window.LOCAL_IMAGE_CACHE = await response.json();
  } catch (err) {
    console.warn('Local image cache unavailable', err);
  }

  const originalPhotoMarkup = photoMarkup;

  imagesFor = function imagesForLocal(l) {
    const local = window.LOCAL_IMAGE_CACHE?.[l.id];
    return Array.isArray(local) ? local.filter(Boolean) : [];
  };

  photoMarkup = function photoMarkupLocal(l) {
    const images = imagesFor(l);
    if (images.length) return originalPhotoMarkup(l);
    const target = l.photoPageUrl || l.url || '#';
    return `<div class="photo-wrap"><div class="photo-placeholder"><strong>${l.buildingName || 'Rental listing'}</strong><span>Photos are hosted by the source</span><a class="source-link photo-source-link" href="${target}" target="_blank" rel="noopener noreferrer">View photos on source ↗</a></div></div>`;
  };

  if (typeof state !== 'undefined' && state.listings?.length && typeof render === 'function') render();
})();
