// Make photo failure handling robust even when an image fails before the original error listener is attached.
(function patchPhotoResilience() {
  if (typeof wirePhotos !== 'function' || typeof imagesFor !== 'function') return;

  wirePhotos = function wirePhotosResilient(card, l) {
    const wrap = card.querySelector('.photo-wrap');
    const images = imagesFor(l);
    if (!wrap || !images.length) return;

    const img = wrap.querySelector('.listing-photo');
    const count = wrap.querySelector('.photo-count');
    const nav = wrap.querySelector('.photo-nav');
    if (!img) return;

    const failed = new Set();
    let current = Number(wrap.dataset.photoIndex || 0) || 0;
    let fallbackShown = false;

    const showFallback = () => {
      if (fallbackShown) return;
      fallbackShown = true;
      img.style.display = 'none';
      if (nav) nav.style.display = 'none';
      if (!wrap.querySelector('.photo-fallback')) {
        wrap.insertAdjacentHTML('afterbegin', fallbackPhotoMarkup(l, 'Embedded photos could not be loaded'));
      }
    };

    const show = i => {
      if (fallbackShown) return;
      current = (i + images.length) % images.length;
      wrap.dataset.photoIndex = String(current);
      img.style.display = 'block';
      if (count) count.textContent = `${current + 1} / ${images.length}`;
      if (img.getAttribute('src') !== images[current]) img.src = images[current];
      // A cached failure can already be complete before the error event listener gets a chance to run.
      queueMicrotask(() => {
        if (img.complete && img.naturalWidth === 0) tryNextWorking();
      });
    };

    const tryNextWorking = () => {
      if (fallbackShown) return;
      failed.add(current);
      if (failed.size >= images.length) return showFallback();
      for (let step = 1; step <= images.length; step++) {
        const next = (current + step) % images.length;
        if (!failed.has(next)) return show(next);
      }
      showFallback();
    };

    wrap.querySelector('.photo-prev')?.addEventListener('click', e => {
      e.stopPropagation();
      const next = (current - 1 + images.length) % images.length;
      failed.delete(next);
      show(next);
    });
    wrap.querySelector('.photo-next')?.addEventListener('click', e => {
      e.stopPropagation();
      const next = (current + 1) % images.length;
      failed.delete(next);
      show(next);
    });
    img.addEventListener('error', tryNextWorking);

    // Critical race fix: detect an image that already failed before this listener was attached.
    if (img.complete && img.naturalWidth === 0) tryNextWorking();
  };
})();
