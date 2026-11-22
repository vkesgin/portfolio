const base = '/';

async function injectComponent(selector, file) {
  try {
    const res  = await fetch(base + 'components/' + file + '?v=' + Date.now());
    if (!res.ok) return;
    let html = await res.text();
    html = html.replace(/href="\//g, 'href="' + base);
    html = html.replace(/src="\//g, 'src="' + base);
    const el   = document.querySelector(selector);
    if (el) el.innerHTML = html;
  } catch(e) {
    console.warn('inject failed:', file, e);
  }
}

// Dil bayrakları sayfanın sol altında sabit durup içeriğin üstüne biniyordu;
// nav içine (hamburger'in soluna) taşınır.
function dockLanguageSwitcher() {
  const wrap = document.querySelector('.gtranslate_wrapper');
  const nav  = document.getElementById('nav');
  if (!nav) return;
  if (!wrap) {
    // Sayfa henüz sonuna kadar ayrıştırılmadıysa bir kez daha dene
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', dockLanguageSwitcher, { once: true });
    }
    return;
  }
  wrap.removeAttribute('style');
  wrap.classList.add('nav-lang');
  nav.insertBefore(wrap, nav.querySelector('.hamburger'));
}

async function initInject() {
  await Promise.all([
    injectComponent('#header-placeholder', 'header.html'),
    injectComponent('#footer-placeholder', 'footer.html'),
  ]);

  dockLanguageSwitcher();

  // Inject tamamlandıktan sonra scripti tetikle
  const event = new Event('componentsLoaded');
  document.dispatchEvent(event);
}

initInject();
