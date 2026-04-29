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
  const isVideo  = !!p.video_url;
  const imgSrc   = getMediaUrl(p.thumbnail_url || p.image_url);
  const videoSrc = getMediaUrl(p.video_url);
  const catLabel = {
    web: 'Web Design', '3d': '3D Animasyon', '2d': '2D Animasyon',
    video: 'Videografi', graphic: 'Grafik Tasarım'
  }[p.category] || p.category;

  return `
    <div class="port-card ${isVideo ? 'port-card--video' : ''}"
         data-cat="${p.category}"
         data-title="${p.title || ''}"
         data-desc="${(p.description || '').replace(/"/g, '&quot;')}"
         data-tags="${p.tags || ''}"
         data-year="${p.year || ''}"
         data-img="${imgSrc}"
         ${isVideo ? `data-video="${videoSrc}"` : ''}>
      <div class="port-card-img">
        ${imgSrc
          ? `<img src="${imgSrc}" alt="${p.title || ''}" loading="lazy" onerror="this.style.display='none'">`
          : '<div class="port-card-placeholder"></div>'
        }
        ${isVideo ? `
          <div class="port-play-icon">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
              <polygon points="5,3 19,12 5,21"/>
            </svg>
          </div>` : ''
        }
      </div>
      <div class="port-card-overlay">
        <div class="port-card-info">
          <span class="port-cat-tag">${catLabel}</span>
          <h3 class="port-card-title">${p.title || ''}</h3>
          <span class="port-card-year">${p.year || ''}</span>
        </div>
        <span class="port-expand">${isVideo ? '▶' : '↗'}</span>
      </div>
    </div>`;
}

