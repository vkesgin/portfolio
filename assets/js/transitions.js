// === BARBA.JS SAYFA GEÇİŞLERİ ===

const BARBA_CDN = 'https://cdn.jsdelivr.net/npm/@barba/core@2.10.3/dist/barba.umd.min.js';

function loadBarba() {
  return new Promise((resolve) => {
    if (window.barba) { resolve(); return; }
    const s = document.createElement('script');
    s.src = BARBA_CDN;
    s.onload = resolve;
    document.head.appendChild(s);
  });
}

function createOverlay() {
  if (document.getElementById('page-overlay')) return;
  const el = document.createElement('div');
  el.id = 'page-overlay';
  el.innerHTML = `
    <div class="po-block po-block--top"></div>
    <div class="po-block po-block--bottom"></div>
    <div class="po-logo">VK<span>.</span></div>
  `;
  document.body.appendChild(el);
}

function enterAnim(container) {
  return new Promise(resolve => {
    const tl = gsap.timeline({ onComplete: resolve });
    tl.set('#page-overlay', { display: 'flex' })
      .to('.po-block--top',    { yPercent: -100, duration: .7, ease: 'power4.inOut' })
      .to('.po-block--bottom', { yPercent:  100, duration: .7, ease: 'power4.inOut' }, '<')
      .to('.po-logo',          { opacity: 0, duration: .3 }, '<.2')
      .set('#page-overlay',    { display: 'none' })
      .from(container,         { opacity: 0, y: 24, duration: .5, ease: 'power3.out' }, '-=.3');
  });
}

function leaveAnim() {
  return new Promise(resolve => {
    const tl = gsap.timeline({ onComplete: resolve });
    // Önce konumla, sonra göster — 1-frame flash önlenir
    tl.set('.po-block--top',    { yPercent: -100 })
      .set('.po-block--bottom', { yPercent:  100 })
      .set('.po-logo',          { opacity: 0 })
      .set('#page-overlay',     { display: 'flex' })
      .to('.po-block--top',     { yPercent: 0, duration: .7, ease: 'power4.inOut' })
      .to('.po-block--bottom',  { yPercent: 0, duration: .7, ease: 'power4.inOut' }, '<')
      .to('.po-logo',           { opacity: 1, duration: .35, ease: 'power2.in' }, '<.2');
  });
}

function ensurePageCSS() {
  const page = location.pathname;
  const cssMap = {
    services:  '/assets/css/services.css',
    portfolio: '/assets/css/portfolio.css',
    about:     '/assets/css/about.css',
    contact:   '/assets/css/contact.css',
  };
  Object.entries(cssMap).forEach(([key, href]) => {
    if (page.includes(key) && !document.querySelector(`link[href="${href}"]`)) {
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = href;
      document.head.appendChild(link);
    }
  });
}

function reinitPage() {
  if (typeof ScrollTrigger !== 'undefined') {
    ScrollTrigger.getAll().forEach(t => t.kill());
  }

  ensurePageCSS();

  const ts = '?t=' + Date.now();
  const page = location.pathname;

  const s = document.createElement('script');
  s.src = '/assets/js/main.js' + ts;
  document.body.appendChild(s);

  const scriptMap = {
    services:  '/assets/js/services.js',
    portfolio: '/assets/js/portfolio.js',
    about:     '/assets/js/about.js',
    contact:   '/assets/js/contact.js',
  };
  Object.entries(scriptMap).forEach(([key, src]) => {
    if (page.includes(key)) {
      const ps = document.createElement('script');
      ps.src = src + ts;
      document.body.appendChild(ps);
    }
  });

  window.scrollTo(0, 0);
}

async function initBarba() {
  await loadBarba();
  createOverlay();

  barba.init({
    transitions: [{
      name: 'overlay-transition',
      async leave({ current }) {
        await leaveAnim();
        current.container.remove();
      },
      async enter({ next }) {
        reinitPage();
        await enterAnim(next.container);
        if (typeof ScrollTrigger !== 'undefined') ScrollTrigger.refresh();
      }
    }],
    views: [{
      namespace: 'home',
      afterEnter() { window.scrollTo(0, 0); }
    }],
    prevent({ el }) {
      if (!el.href) return false;
      if (el.href.includes('#')) return true;
      if (!el.href.includes(location.hostname)) return true;
      if (el.href.includes('tool-')) return true;
      return false;
    }
  });
}

if (typeof gsap !== 'undefined') {
  initBarba();
} else {
  window.addEventListener('load', () => {
    if (typeof gsap !== 'undefined') initBarba();
  });
}
