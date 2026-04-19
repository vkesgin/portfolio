(function () {
  'use strict';

  const LOCO_CDN = 'https://cdn.jsdelivr.net/npm/locomotive-scroll@4.1.4/dist/locomotive-scroll.min.js';
  const LOCO_CSS = 'https://cdn.jsdelivr.net/npm/locomotive-scroll@4.1.4/dist/locomotive-scroll.min.css';

  function loadCSS() {
    if (document.querySelector('#loco-css')) return;
    const link = document.createElement('link');
    link.id   = 'loco-css';
    link.rel  = 'stylesheet';
    link.href = LOCO_CSS;
    document.head.appendChild(link);
  }

  function loadJS() {
    return new Promise(resolve => {
      if (window.LocomotiveScroll) { resolve(); return; }
      const s = document.createElement('script');
      s.src = LOCO_CDN;
      s.onload = resolve;
      s.onerror = () => { console.warn('Locomotive Scroll yüklenemedi'); resolve(); };
      document.head.appendChild(s);
    });
  }

  async function init() {
    if (window.matchMedia('(max-width: 768px)').matches) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    loadCSS();
    await loadJS();
    if (!window.LocomotiveScroll) return;

    const scrollEl = document.querySelector('[data-scroll-container]');
    if (!scrollEl) return;

    const loco = new LocomotiveScroll({
      el: scrollEl,
      smooth: true,
      multiplier: 0.9,
      lerp: 0.07,
      smartphone: { smooth: false },
      tablet:     { smooth: false },
    });

    if (typeof ScrollTrigger !== 'undefined') {
      ScrollTrigger.scrollerProxy(scrollEl, {
        scrollTop(val) {
          if (arguments.length) {
            loco.scrollTo(val, { duration: 0, disableLerp: true });
          }
          return loco.scroll.instance.scroll.y;
        },
        getBoundingClientRect() {
          return { top: 0, left: 0, width: window.innerWidth, height: window.innerHeight };
        },
        pinType: scrollEl.style.transform ? 'transform' : 'fixed',
      });

      loco.on('scroll', ScrollTrigger.update);
      loco.on('scroll', (args) => {
        window._locoScrollY = args.scroll.y;
        window.dispatchEvent(new Event('scroll'));
      });
      ScrollTrigger.addEventListener('refresh', () => loco.update());
      ScrollTrigger.refresh();
    }

    window._loco = loco;
    window.addEventListener('beforeunload', () => {
      ro.disconnect();
      loco.destroy();
      window._loco = null;
    });

    const ro = new ResizeObserver(() => {
      loco.update();
      if (typeof ScrollTrigger !== 'undefined') ScrollTrigger.refresh();
    });
    ro.observe(scrollEl);

    document.addEventListener('click', (e) => {
      const a = e.target.closest('a');
      if (!a) return;
      const href = a.getAttribute('href');
      if (!href || !href.includes('#')) return;
      const hash = href.split('#')[1];
      if (!hash) return;
      const target = document.getElementById(hash);
      if (!target) return;
      e.preventDefault();
      loco.scrollTo(target, { offset: -80 });
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
