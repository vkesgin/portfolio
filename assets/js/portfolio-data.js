// ============================================================
const API = 'https://vk-portfolio-api.vkesgin38.workers.dev';
// ============================================================

async function loadPortfolioFromAPI() {
  try {
    const r = await fetch(`${API}/api/projects`);
    if (!r.ok) return null;
    return await r.json();
  } catch { return null; }
}

async function loadFeaturedFromAPI() {
  try {
    const r = await fetch(`${API}/api/projects?featured=1`);
    if (!r.ok) return null;
    return await r.json();
  } catch { return null; }
}

function getMediaUrl(url) {
  if (!url) return '';
  if (url.startsWith('http')) return url;
  return API + url;
}

function buildPortfolioCard(p) {
  const isVideo    = !!p.video_url;
  const imgSrc     = getMediaUrl(p.thumbnail_url || p.image_url);
  const videoSrc   = getMediaUrl(p.video_url);
  const catLabel   = { web:'Web Design', '3d':'3D Animasyon', '2d':'2D Animasyon', video:'Videografi', graphic:'Grafik Tasarım' }[p.category] || p.category;

  return `
    <div class="port-card ${isVideo ? 'port-card--video' : ''}"
         data-cat="${p.category}"
         data-title="${p.title || ''}"
         data-desc="${(p.description || '').replace(/"/g,'&quot;')}"
         data-tags="${p.tags || ''}"
         data-year="${p.year || ''}"
         data-img="${imgSrc}"
         ${isVideo ? `data-video="${videoSrc}"` : ''}>
      <div class="port-card-img">
        ${imgSrc
          ? `<img src="${imgSrc}" alt="${p.title || ''}" loading="lazy" onerror="this.style.display='none'">`
          : '<div style="width:100%;height:100%;background:#1a1a1a;position:absolute;inset:0;"></div>'
        }
        ${isVideo ? `
          <div class="port-play-icon">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><polygon points="5,3 19,12 5,21"/></svg>
          </div>` : ''
        }
      </div>
      <div class="port-card-overlay" ${!imgSrc ? 'style="opacity:1"' : ''}>
        <div class="port-card-info">
          <span class="port-cat-tag">${catLabel}</span>
          <h3 class="port-card-title">${p.title || ''}</h3>
          <span class="port-card-year">${p.year || ''}</span>
        </div>
        <span class="port-expand">${isVideo ? '▶' : '↗'}</span>
      </div>
    </div>`;
}

function buildWorkCard(p) {
  const isVideo  = !!p.video_url;
  const imgSrc   = getMediaUrl(p.thumbnail_url || p.image_url);
  const videoSrc = getMediaUrl(p.video_url);
  const catLabel = { web:'Web Design', '3d':'3D Animasyon', '2d':'2D Animasyon', video:'Videografi', graphic:'Grafik Tasarım' }[p.category] || p.category;

  // Video kartlarında thumbnail yoksa özel placeholder
  const bgInner = imgSrc
    ? `<img src="${imgSrc}" alt="${p.title || ''}" loading="lazy" onerror="this.parentElement.style.background='#111'; this.style.display='none';"`
    + ` style="width:100%;height:100%;object-fit:cover;display:block;filter:grayscale(30%) brightness(0.7);transition:transform .6s,filter .4s;">`
    : (isVideo
        ? `<div style="position:absolute;inset:0;background:linear-gradient(135deg,#111 0%,#1a1a1a 60%,#0f1a1a 100%);display:flex;align-items:center;justify-content:center;">
            <div style="width:60px;height:60px;border-radius:50%;border:1.5px solid rgba(0,229,255,.35);background:rgba(0,0,0,.5);display:flex;align-items:center;justify-content:center;">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="rgba(0,229,255,.7)"><polygon points="5,3 19,12 5,21"/></svg>
            </div>
           </div>`
        : `<div style="position:absolute;inset:0;background:#111;"></div>`);

  return `
    <div class="work-card ${isVideo ? 'work-card--video' : ''}"
         data-cat="${p.category}"
         ${isVideo ? `data-video="${videoSrc}"` : ''}
         data-img="${imgSrc}">
      <div class="work-bg" style="position:absolute;inset:0;overflow:hidden;">
        ${bgInner}
      </div>
      <div class="work-overlay" ${!imgSrc ? 'style="opacity:1;background:linear-gradient(to top,rgba(0,0,0,.9) 0%,rgba(0,0,0,.2) 100%)"' : ''}>
        <span class="work-cat-tag">${catLabel}</span>
        <h3 class="work-title">${p.title || ''}</h3>
        <p class="work-desc">${p.description || ''}</p>
        <span class="work-link">${isVideo ? 'İzle ▶' : 'İncele ↗'}</span>
      </div>
      <div class="work-info-bar">
        <span class="work-cat-label">${catLabel}</span>
        <span class="work-year">${p.year || ''}</span>
      </div>
    </div>`;
}
