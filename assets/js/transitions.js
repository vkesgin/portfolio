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
  overlay.style.visibility = 'hidden';

  function forceReflow(el) { void el.getBoundingClientRect(); }

  function playEnter() {
    overlay.style.visibility = '';
    overlay.classList.remove('is-closing', 'is-open');
    overlay.classList.add('is-visible', 'is-open');

    setTimeout(() => {
      overlay.classList.add('is-closing');
      overlay.classList.remove('is-open');

      setTimeout(() => {
        overlay.classList.remove('is-visible', 'is-closing');
        overlay.style.visibility = 'hidden';
        requestAnimationFrame(() => { overlay.style.visibility = ''; });
      }, 650);
    }, 450);
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
