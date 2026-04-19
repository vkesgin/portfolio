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

function buildPortfolioCard(p, large = false) {
  const isVideo = !!p.video_url;
  return `
    <div class="port-card ${large ? 'port-card--wide' : ''} ${isVideo ? 'port-card--video' : ''}"
         data-cat="${p.category}"
         data-title="${p.title}"
         data-desc="${p.description || ''}"
         data-tags="${p.tags || ''}"
         data-year="${p.year || ''}"
         data-img="${p.image_url ? API + p.image_url : ''}"
         ${isVideo ? `data-video="${API + p.video_url}"` : ''}>
      <div class="port-card-img">
        <img src="${p.image_url ? API + p.image_url : ''}" alt="${p.title}" loading="lazy">
        ${isVideo ? `<div class="port-play-icon"><svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><polygon points="5,3 19,12 5,21"/></svg></div>` : ''}
      </div>
      <div class="port-card-overlay">
        <div class="port-card-info">
          <span class="port-cat-tag">${p.category}</span>
          <h3 class="port-card-title">${p.title}</h3>
          <span class="port-card-year">${p.year}</span>
        </div>
        <span class="port-expand">${isVideo ? '▶' : '↗'}</span>
      </div>
    </div>`;
}

function buildWorkCard(p) {
  const isVideo = !!p.video_url;
  return `
    <div class="work-card ${isVideo ? 'work-card--video' : ''}"
         data-cat="${p.category}"
         ${isVideo ? `data-video="${API + p.video_url}"` : ''}
         data-img="${p.image_url ? API + p.image_url : ''}">
      <div class="work-bg">
        <img src="${p.image_url ? API + p.image_url : ''}" alt="${p.title}" loading="lazy">
      </div>
      <div class="work-overlay">
        <span class="work-cat-tag">${p.category}</span>
        <h3 class="work-title">${p.title}</h3>
        <p class="work-desc">${p.description || ''}</p>
        <span class="work-link">${isVideo ? 'İzle ▶' : 'İncele ↗'}</span>
      </div>
      <div class="work-info-bar">
        <span class="work-cat-label">${p.category}</span>
        <span class="work-year">${p.year}</span>
      </div>
    </div>`;
}
