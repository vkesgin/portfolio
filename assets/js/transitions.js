(function () {

  const DURATION = 600;

  const overlay = document.createElement('div');
  overlay.id = 'pt-overlay';
  overlay.innerHTML = `
    <div class="pt-panel pt-panel--left"></div>
    <div class="pt-panel pt-panel--right"></div>
    <div class="pt-center">
      <span class="pt-logo">VK<span>.</span></span>
    </div>`;
  document.body.appendChild(overlay);

  function forceReflow(el) { void el.getBoundingClientRect(); }

  function playEnter() {
    overlay.classList.add('is-visible');
    overlay.classList.remove('is-closing');
    forceReflow(overlay);
    overlay.classList.add('is-open');
    setTimeout(() => {
      overlay.classList.add('is-closing');
      setTimeout(() => {
        overlay.classList.remove('is-visible', 'is-open', 'is-closing');
      }, DURATION);
    }, 400);
  }

  function playLeave(href) {
    return new Promise(resolve => {
      overlay.classList.add('is-visible');
      forceReflow(overlay);
      overlay.classList.add('is-open');
      setTimeout(resolve, DURATION);
    }).then(() => { window.location.href = href; });
  }

  document.addEventListener('click', function (e) {
    const a = e.target.closest('a');
    if (!a) return;

    const href = a.getAttribute('href');
    if (!href) return;
    if (href.includes('#')) return;
    if (href.startsWith('http') && !href.includes(location.hostname)) return;
    if (href.startsWith('mailto:') || href.startsWith('tel:')) return;
    if (a.target === '_blank') return;

    e.preventDefault();
    playLeave(href);
  }, true);

  playEnter();

})();
