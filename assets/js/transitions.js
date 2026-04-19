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

// Overlay elementi oluştur
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

// Sayfaya giriş — overlay açılır, içerik gelir
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

// Sayfadan çıkış — overlay kapanır
function leaveAnim() {
  return new Promise(resolve => {
    const tl = gsap.timeline({ onComplete: resolve });
    tl.set('#page-overlay', { display: 'flex' })
      .set('.po-block--top',    { yPercent: -100 })
      .set('.po-block--bottom', { yPercent:  100 })
      .set('.po-logo',          { opacity: 1 })
      .to('.po-block--top',     { yPercent: 0, duration: .65, ease: 'power4.inOut' })
      .to('.po-block--bottom',  { yPercent: 0, duration: .65, ease: 'power4.inOut' }, '<')
      .to('.po-logo',           { opacity: 1, duration: .2 }, '<.3');
  });
}

// Yeni sayfanın script'lerini yeniden çalıştır
function reinitPage(container) {
  // Inject sistemi tekrar çalışsın
  if (window.injectComponents) {
    window.injectComponents().then(() => {
      // main.js'i yeniden yükle
      const s = document.createElement('script');
      const isPages = location.pathname.includes('/pages/');
      s.src = (isPages ? '../' : './') + 'assets/js/main.js?t=' + Date.now();
      document.body.appendChild(s);

      // Sayfa özel scriptleri
      const page = location.pathname;
      const scripts = [];
      if (page.includes('services'))  scripts.push('services.js');
      if (page.includes('portfolio')) scripts.push('portfolio.js');
      if (page.includes('about'))     scripts.push('about.js');
      if (page.includes('contact'))   scripts.push('contact.js');

      scripts.forEach(name => {
        const ps = document.createElement('script');
        ps.src = (isPages ? '../' : './') + 'assets/js/' + name + '?t=' + Date.now();
        document.body.appendChild(ps);
      });
    });
  }

  // ScrollTrigger'ı sıfırla
  if (typeof ScrollTrigger !== 'undefined') {
    ScrollTrigger.getAll().forEach(t => t.kill());
    ScrollTrigger.refresh();
  }

  // Sayfanın en üstüne dön
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
        reinitPage(next.container);
        await enterAnim(next.container);
      }
    }],
    views: [{
      namespace: 'home',
      afterEnter() { window.scrollTo(0, 0); }
    }],
    prevent({ el }) {
      // Hash linkleri, dış linkler, araç sayfaları geçişi engelle
      if (el.href && el.href.includes('#')) return true;
      if (el.href && !el.href.includes(location.hostname)) return true;
      if (el.href && el.href.includes('tool-')) return true;
      return false;
    }
  });
}

// Barba başlat
if (typeof gsap !== 'undefined') {
  initBarba();
} else {
  document.addEventListener('DOMContentLoaded', () => {
    if (typeof gsap !== 'undefined') initBarba();
  });
}
