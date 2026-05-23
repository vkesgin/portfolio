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
