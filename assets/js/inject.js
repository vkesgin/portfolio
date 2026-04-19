// Kaç klasör derinlikte olduğumuzu otomatik hesapla
const depth   = location.pathname.split('/').filter(Boolean).length;
const isPages = location.pathname.includes('/pages/');
const base    = '/';

async function injectComponent(selector, file) {
  try {
    const res  = await fetch(base + 'components/' + file);
    if (!res.ok) return;
    const html = await res.text();
    const el   = document.querySelector(selector);
    if (el) el.innerHTML = html;
  } catch(e) {
    console.warn('inject failed:', file, e);
  }
}

async function initInject() {
  await Promise.all([
    injectComponent('#header-placeholder', 'header.html'),
    injectComponent('#footer-placeholder', 'footer.html'),
  ]);

  // Inject tamamlandıktan sonra scripti tetikle
  const event = new Event('componentsLoaded');
  document.dispatchEvent(event);
}

initInject();
