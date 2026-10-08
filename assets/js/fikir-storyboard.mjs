/* fikir-storyboard.mjs: AI storyboard UI for the Fikir Havuzu board (fikir.html).
 * Loaded lazily by fikir.html: import('/assets/js/fikir-storyboard.mjs?v=...'), then createStoryboardUI(deps).
 * All DOM is built with deps.h() (text nodes only; href/src must be absolute http(s)). Server data is never
 * read back from the DOM (GTranslate may rewrite it); each section re-renders only when its data signature changes.
 *
 * deps: { api, ApiError, h, toast, confirmDialog, openModal, closeModal, setBusy, session, config, API_BASE, safeHttpUrl, posts,
 *         defer?(entry, key, fn) }  defer: fikir.html applyOrDefer (a card wholly above the viewport is re-rendered once it is in view)
 * A text card has two slots: entry.refs.sbMedia (top, edge to edge: the frame carousel; its size is reserved by fikir.html's CSS)
 * and entry.refs.sbSlot (under the idea text: title, "N kare", progress, "Storyboard'u aç").
 */

const CSS_HREF = '/assets/css/fikir-storyboard.css?v=20261008';
const SHOT_TR = {
  extreme_wide: 'ÇOK GENİŞ PLAN', wide: 'GENİŞ PLAN', full: 'BOY PLAN', medium: 'ORTA PLAN', close_up: 'YAKIN PLAN',
  extreme_close_up: 'ÇOK YAKIN PLAN', aerial_drone: 'HAVADAN (DRONE)', pov: 'ÖZNEL KAMERA', over_the_shoulder: 'OMUZ ÜSTÜ',
  insert: 'DETAY (İNSERT)',
};
const MOVE_TR = {
  static: 'SABİT', pan: 'PAN', tilt: 'TİLT', dolly_in: 'DOLLY İLERİ', dolly_out: 'DOLLY GERİ', tracking: 'TAKİP (TRAVELLING)',
  crane_up: 'VİNÇ YUKARI', crane_down: 'VİNÇ AŞAĞI', handheld: 'ELDE KAMERA', zoom_in: 'ZOOM İÇERİ', zoom_out: 'ZOOM DIŞARI',
  orbit: 'ETRAFINDA DÖNÜŞ (ORBİT)', drone_flyover: 'DRONE GEÇİŞİ',   // 'çevrinme' would read as a pan/tilt
};
const CONF_TR = { high: 'yüksek', medium: 'orta', low: 'düşük' };
const ERR_TR = {
  quota: 'Yapay zekâ günlük kapasitesi doldu; eksik kareler yarın çizilebilir.',
  draft_failed: 'Sahne metni üretilemedi.',
  frames_failed: 'Bazı kareler çizilemedi.',
  stale: 'İşlem yarıda kaldı.',
  scene_failed: 'Sahne yeniden yazılamadı.',
  start_failed: 'İşlem başlatılamadı.',
  not_rendered: 'Çizilemedi.',
  redraw_failed: 'Yeniden çizilemedi; önceki kare duruyor.',
  stale_image: 'Metin değişti ama kare yeniden çizilemedi.',
  gone: 'Storyboard silinmiş.',
};
const RESEARCH_TR = {
  no_key: 'Web araştırması yapılmadı.', no_entities: 'Araştırılacak marka/kısaltma bulunmadı.', monthly_cap: 'Aylık araştırma kotası doldu; araştırma yapılmadı.',
  disabled: 'Web araştırması kapalı.', auth: 'Araştırma servisine bağlanılamadı.', plan_limit: 'Araştırma kotası doldu; araştırma yapılmadı.',
  partial: 'Web araştırması kısmen yapıldı.', error: 'Web araştırması başarısız oldu.',
};
const ACTIVE = (s) => s === 'queued' || s === 'running';
const POLL_MAX_MS = 15000;
const POLL_GIVE_UP_MS = 30 * 60 * 1000;
const LAYOUT_KEY = 'fikir_sb_layout';   // viewer layout per browser: 'big' (default, one scene per row) | 'sheet' (print layout)

const trUpper = (s) => String(s || '').replace(/i/g, 'İ').replace(/ı/g, 'I').toUpperCase();
const fmtDur = (x) => { const v = Number(x) || 0; return Number.isInteger(v) ? String(v) : String(v).replace('.', ','); };
const shortModel = (m) => String(m || '').split('/').pop();
const isTall = (aspect) => aspect === '9:16' || aspect === '4:5';
// Card carousel stage (same rule as fikir.html sbShape): 'wide' 16:9 (default), 'tall' 4:5 box, 'square' 1:1 box.
const sbShape = (aspect) => (isTall(aspect) ? 'tall' : aspect === '1:1' ? 'square' : 'wide');
const ratioCss = (aspect) => (aspect ? aspect.replace(':', ' / ') : '16 / 9');

// Browser-side colour safety net (measured: grayscale frames 0.5-1.5, the one colour-drift frame 20.0).
function colorSpread(img) {
  const c = document.createElement('canvas');
  const w = (c.width = 64), hh = (c.height = 36);
  const g = c.getContext('2d', { willReadFrequently: true });
  g.drawImage(img, 0, 0, w, hh);
  const p = g.getImageData(0, 0, w, hh).data;
  let s = 0;
  for (let i = 0; i < p.length; i += 4) s += Math.abs(p[i] - p[i + 1]) + Math.abs(p[i + 1] - p[i + 2]);
  return s / (w * hh);
}

export function createStoryboardUI(deps) {
  const { api, h, toast, confirmDialog, openModal, closeModal, setBusy, session, config, API_BASE } = deps;
  ensureCss();

  const cards = new Map();      // postId -> { entry, summary, sig, root }
  const watchers = new Map();   // sbId -> { subs:Set, timer, delay, sig, startedAt, fails, inflight }
  // rewriteDraft / fixDraft: text typed into the "Yeniden yaz" inputs / "Yorumu düzelt" box, kept across re-renders.
  // focusNext: the field the user just opened ('fix' or a scene number); only that one is focused, once.
  // layout: 'big' (one scene per row, large frame + text beside / below it) or 'sheet' (the print grid); printing always uses
  // the sheet. target: scene to scroll to once the sheet is rendered (a carousel slide was tapped).
  const viewer = { el: null, sbId: null, data: null, sigs: new Map(), fixOpen: false, rewriteOpen: new Set(),
    rewriteDraft: new Map(), fixDraft: null, focusNext: null, printPending: false, layout: readLayout(), target: null };
  function readLayout() { try { return localStorage.getItem(LAYOUT_KEY) === 'sheet' ? 'sheet' : 'big'; } catch (_) { return 'big'; } }
  const fileUrl = (path) => (path ? deps.safeHttpUrl(API_BASE + path) : null);
  const user = () => session.user;
  const left = () => (config.sb && config.sb.left) || null;
  const setLeft = (l) => { if (l && config.sb) { config.sb.left = l; refreshQuotaHints(); } };
  // A job ended: the server may have given units back (failed build on AI quota, failed op), so re-read today's quota.
  let leftReq = null;
  function refreshLeft() {
    if (!session.token || leftReq) return;
    leftReq = api('GET', '/api/inspire/config')
      .then((c) => { if (c && c.sb && c.sb.left) setLeft(c.sb.left); })
      .catch(() => { /* keep the shown quota */ })
      .finally(() => { leftReq = null; });
  }

  function ensureCss() {
    if (document.querySelector('link[data-sb-css]')) return;
    const l = document.createElement('link');
    l.rel = 'stylesheet'; l.href = CSS_HREF; l.dataset.sbCss = '1';
    document.head.append(l);
  }
  const canCreateFor = (post) => !!(config.storyboard && post && (post.is_mine || (user() && user().is_admin)));
  const errText = (e) => (e && e.message) || 'İşlem yapılamadı.';
  function quotaText(kind) {
    const l = left();
    if (!l) return '';
    if (kind === 'frames') return l.frames == null ? '' : `Bugün kalan yeniden çizim: ${l.frames}`;
    if (l.per_user == null) return `Bugün kalan (genel): ${l.daily}`;
    return `Bugün kalan storyboard hakkın: ${l.storyboards}`;
  }

  /* ------------------------------------------------------------ polling */
  function summarize(full) {
    const frames = full.frames || [];
    return {
      id: full.id, version: full.version, status: full.status, stage: full.stage,
      // before the draft exists: the server's provisional aspect (explicit format, else the previous version's)
      title: full.draft ? full.draft.title : null, aspect: full.draft ? full.draft.aspect_ratio : full.aspect || null,
      frame_total: frames.length, frame_done: frames.filter((f) => f.path).length, frame_busy: frames.filter((f) => f.busy).length,
      thumbs: frames.filter((f) => f.path).map((f) => ({ n: f.n, path: f.path })),
      scenes: full.draft ? full.draft.scenes.map((sc) => ({ n: sc.n, title: sc.title, shot: sc.shot })) : [],
      error_code: full.error ? full.error.code : null, previous_id: full.previous_id || null, updated_at: full.updated_at,
    };
  }
  const isBusy = (s) => !!s && (ACTIVE(s.status) || s.frame_busy > 0);
  // A list summary from a worker that predates the card carousel has no `scenes` and at most 4 thumbs: the card reads the
  // full storyboard once (one GET through the watcher) so every frame and caption shows; a refresh never downgrades it.
  const isLegacy = (s) => !!s && !Array.isArray(s.scenes);
  const needsUpgrade = (s) => isLegacy(s) && !isBusy(s) && (s.frame_done > 0 || s.frame_total > 0);
  // active: whether the job is known to be running (true/false) or unknown (null); a running -> ended transition
  // re-reads the quota (refreshLeft).
  function watch(sbId, cb, active = null) {
    let w = watchers.get(sbId);
    if (!w) {
      w = { subs: new Set(), timer: 0, delay: 2000, sig: '', startedAt: Date.now(), fails: 0, inflight: false, active };
      watchers.set(sbId, w);
      schedule(sbId, 300);
    } else if (active) w.active = true;
    w.subs.add(cb);
  }
  function unwatch(sbId, cb) {
    const w = watchers.get(sbId);
    if (!w) return;
    w.subs.delete(cb);
    if (!w.subs.size) { clearTimeout(w.timer); watchers.delete(sbId); }
  }
  function schedule(sbId, ms) {
    const w = watchers.get(sbId);
    if (!w) return;
    clearTimeout(w.timer);
    w.timer = setTimeout(() => poll(sbId), ms);
  }
  async function poll(sbId) {
    const w = watchers.get(sbId);
    if (!w || w.inflight) return;
    if (document.visibilityState === 'hidden') { schedule(sbId, 5000); return; }
    w.inflight = true;
    let full = null;
    try {
      full = await api('GET', `/api/inspire/storyboards/${sbId}`);
      w.fails = 0;
    } catch (e) {
      w.inflight = false;
      if (e && e.status === 404) { for (const cb of [...w.subs]) cb(null, sbId); clearTimeout(w.timer); watchers.delete(sbId); return; }
      w.fails++;
      schedule(sbId, Math.min(30000, 2000 * 2 ** w.fails));
      return;
    }
    w.inflight = false;
    if (!watchers.has(sbId)) return;
    const sig = JSON.stringify([full.status, full.stage, full.updated_at, full.frames.map((f) => [f.path, f.status]), full.ops.map((o) => [o.id, o.status])]);
    const changed = sig !== w.sig;
    w.sig = sig;
    for (const cb of [...w.subs]) cb(full, sbId);
    const active = !!full.poll_ms;
    if (w.active && !active) refreshLeft();
    w.active = active;
    if (!active) { clearTimeout(w.timer); if (!viewerShows(sbId)) watchers.delete(sbId); else w.delay = 0; return; }
    if (Date.now() - w.startedAt > POLL_GIVE_UP_MS) {
      for (const cb of [...w.subs]) cb({ ...full, _giveUp: true }, sbId);
      clearTimeout(w.timer); watchers.delete(sbId); return;
    }
    w.delay = changed ? full.poll_ms : Math.min(POLL_MAX_MS, Math.round((w.delay || full.poll_ms) * 1.5));
    schedule(sbId, w.delay);
  }
  function kick(sbId) {   // after an action: poll soon even if the watcher was idle
    const w = watchers.get(sbId);
    if (w) { w.startedAt = Date.now(); w.delay = 1500; w.active = true; schedule(sbId, 800); }
  }
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') for (const id of watchers.keys()) schedule(id, 200);
  });

  /* ------------------------------------------------------------ card panel */
  function mount(entry) {
    if (!entry || entry.view.kind !== 'text' || !entry.refs.sbSlot) return;
    const slot = entry.refs.sbSlot;
    let c = cards.get(entry.id);
    if (!c) {
      c = { entry, summary: entry.post.storyboard || null, sig: '', onData: null, car: null, carSig: '', shape: null };
      c.onData = (full, sbId) => onCardData(c, full, sbId);
      cards.set(entry.id, c);
      slot.addEventListener('click', (ev) => onCardClick(c, ev));
      if (entry.refs.sbMedia) entry.refs.sbMedia.addEventListener('click', (ev) => onCardClick(c, ev));
    }
    c.entry = entry;
    renderCard(c);
    if (isBusy(c.summary)) watch(c.summary.id, c.onData, true);
    else if (needsUpgrade(c.summary)) watch(c.summary.id, c.onData);
  }
  function patch(entry, post) {
    const c = cards.get(entry.id);
    if (!c) { mount(entry); return; }
    c.entry = entry;
    const incoming = post.storyboard || null;
    const cur = c.summary;
    if (incoming && cur && incoming.id === cur.id && (incoming.updated_at || 0) < (cur.updated_at || 0)) { renderCard(c); return; } // poll is ahead
    if (incoming && cur && incoming.id !== cur.id && incoming.version < cur.version) { renderCard(c); return; }
    if (!incoming && cur && watchers.has(cur.id)) { renderCard(c); return; }
    if (incoming && cur && incoming.id === cur.id && isLegacy(incoming) && !isLegacy(cur) && (incoming.updated_at || 0) <= (cur.updated_at || 0)) { renderCard(c); return; }
    setSummary(c, incoming);
  }
  function unmount(entry) {
    const c = cards.get(entry.id);
    if (!c) return;
    if (c.summary) unwatch(c.summary.id, c.onData);
    dropCar(c);
    cards.delete(entry.id);
  }
  function setSummary(c, s) {
    if (c.summary && (!s || s.id !== c.summary.id)) unwatch(c.summary.id, c.onData);
    c.summary = s;
    renderCard(c);
    if (isBusy(s)) watch(s.id, c.onData, true);
    else if (needsUpgrade(s)) watch(s.id, c.onData);
  }
  function onCardData(c, full, sbId) {
    if (!c.summary || c.summary.id !== sbId) return;
    if (!full) { setSummary(c, null); return; }
    c.summary = summarize(full);
    c.giveUp = !!full._giveUp;
    renderCardLater(c);
  }
  // Card height changes wait while the card is wholly above the viewport (fikir.html applyOrDefer).
  function renderCardLater(c) {
    if (typeof deps.defer === 'function') deps.defer(c.entry, 'sb', () => { if (cards.get(c.entry.id) === c) renderCard(c); });
    else renderCard(c);
  }
  // After a version was deleted: the card shows its previous finished version (or nothing).
  async function showPrevious(c, prevId) {
    let s = null;
    if (prevId) { try { s = summarize(await api('GET', `/api/inspire/storyboards/${prevId}`)); } catch (_) { s = null; } }
    if (cards.get(c.entry.id) === c) setSummary(c, s);
  }
  function focusCard(postId) {   // the button that opened the viewer may have been re-rendered meanwhile
    if (document.activeElement && document.activeElement !== document.body) return;
    const c = cards.get(String(postId));
    const b = c && (c.entry.refs.sbSlot.querySelector('[data-sb="open"], [data-sb="open-prev"], [data-sb="create"]') ||
      (c.car && c.car.track.isConnected ? c.car.track : null));
    if (b) b.focus({ preventScroll: true });
  }
  function track(entry, summary) {   // after a create from the add modal / "Storyboard oluştur" / "Yorumu düzelt"
    const c = cards.get(entry.id);
    if (!c) { entry.post.storyboard = summary; mount(entry); return; }
    setSummary(c, summary);
    if (summary) kick(summary.id);
  }

  function renderCard(c) {
    renderInfo(c);
    renderCarousel(c);
  }
  // The panel under the idea text: label + chip, title, progress steps, errors, buttons (the frames are in the carousel).
  function renderInfo(c) {
    const { entry, summary: s } = c;
    const slot = entry.refs.sbSlot;
    // The quota only shows on the "Storyboard oluştur" card, so only that state depends on it.
    const info = s && { ...s, thumbs: null, scenes: null };
    const sig = JSON.stringify([info, config.storyboard, entry.post.is_mine, user() && user().is_admin, s ? null : left(), c.giveUp]);
    if (sig === c.sig) return;
    c.sig = sig;
    slot.textContent = '';
    const mine = canCreateFor(entry.post);
    if (s && s.status === 'failed' && !mine) {
      // A failed build has no draft and only its owner can act on it: others see the previous version, if any.
      if (!s.previous_id) { slot.hidden = true; return; }
      slot.hidden = false;
      slot.append(h('div', { class: 'sb-card' },
        h('div', { class: 'sb-card-head' }, h('span', { class: 'sb-label' }, 'Storyboard')),
        h('div', { class: 'sb-card-actions' },
          h('button', { type: 'button', class: 'btn btn-primary btn-sm', 'data-sb': 'open-prev' }, 'Storyboard\'u aç'))));
      return;
    }
    if (!s) {
      if (!canCreateFor(entry.post)) { slot.hidden = true; return; }
      slot.hidden = false;
      const l = left();
      const none = l && l.storyboards === 0;
      slot.append(h('div', { class: 'sb-card' },
        h('div', { class: 'sb-card-actions' },
          h('button', { type: 'button', class: 'btn btn-outline btn-sm', 'data-sb': 'create', disabled: none }, 'Storyboard oluştur'),
          h('span', { class: 'sb-hint' }, none ? 'Bugünkü hakkın doldu.' : quotaText('sb')))));
      return;
    }
    slot.hidden = false;
    const chip = statusChip(s);
    const body = [h('div', { class: 'sb-card-head' }, h('span', { class: 'sb-label' }, 'Storyboard'), chip)];
    if (s.title) body.push(h('div', { class: 'sb-title' }, s.title));
    if (ACTIVE(s.status)) body.push(stepsList(s));
    if (s.status === 'failed') {
      body.push(h('div', { class: 'sb-err' }, ERR_TR[s.error_code] || 'Storyboard oluşturulamadı.'));
      if (s.previous_id) body.push(h('div', { class: 'sb-hint' }, 'Son sürüm oluşturulamadı; önceki sürüm duruyor.'));
    } else if (s.status === 'partial') body.push(h('div', { class: 'sb-hint' }, s.error_code === 'quota' ? ERR_TR.quota : `${s.frame_total - s.frame_done} kare çizilemedi.`));
    if (c.giveUp) body.push(h('div', { class: 'sb-hint' }, 'Durum güncellenemiyor; sayfayı yenile.'));
    const actions = h('div', { class: 'sb-card-actions' });
    if (s.status !== 'failed' || s.title) actions.append(h('button', { type: 'button', class: 'btn btn-primary btn-sm', 'data-sb': 'open' }, 'Storyboard\'u aç'));
    if (s.status === 'failed' && s.previous_id) actions.append(h('button', { type: 'button', class: 'btn btn-primary btn-sm', 'data-sb': 'open-prev' }, 'Önceki sürümü aç'));
    if (s.status === 'failed' && mine) actions.append(h('button', { type: 'button', class: 'btn btn-outline btn-sm', 'data-sb': 'create' }, 'Tekrar dene'));
    body.push(actions);
    slot.append(h('div', { class: 'sb-card' }, ...body));
  }
  function statusChip(s) {
    if (ACTIVE(s.status)) return h('span', { class: 'sb-chip run' }, s.status === 'queued' ? 'Sırada' : 'Hazırlanıyor');
    if (s.frame_busy) return h('span', { class: 'sb-chip run' }, 'Güncelleniyor');
    if (s.status === 'done') return h('span', { class: 'sb-chip ok' }, `${s.frame_total} kare`);
    if (s.status === 'partial') return h('span', { class: 'sb-chip warn' }, `${s.frame_done}/${s.frame_total} kare`);
    return h('span', { class: 'sb-chip bad' }, 'Hata');
  }
  function stepsList(s) {
    const order = { queued: 0, research: 1, draft: 2, images: 3, done: 4 };
    const at = order[s.stage] ?? 0;
    const st = (i) => (at > i ? 'done' : at === i ? 'now' : '');
    const total = s.frame_total || 0;
    return h('ol', { class: 'sb-steps' },
      h('li', { class: st(1) }, 'Araştırılıyor'),
      h('li', { class: st(2) }, 'Sahneler yazılıyor'),
      h('li', { class: st(3) }, total ? `Çiziliyor ${s.frame_done}/${total}` : 'Çiziliyor'));
  }
  async function onCardClick(c, ev) {
    const b = ev.target.closest('[data-sb]');
    if (!b) return;
    const act = b.dataset.sb;
    if ((act === 'car-prev' || act === 'car-next') && c.car) { carGo(c.car, carBase(c.car) + (act === 'car-next' ? 1 : -1)); return; }
    if (act === 'open-at' && c.summary) { openViewer(c.summary.id, Number(b.dataset.n) || null); return; }
    if (act === 'open' && c.summary) { openViewer(c.summary.id); return; }
    if (act === 'open-prev' && c.summary && c.summary.previous_id) { openViewer(c.summary.previous_id); return; }
    if (act === 'create') startFor(c.entry, {}, b);
  }
  async function startFor(entry, body, btn) {
    setBusy(btn, true);
    try {
      const r = await api('POST', `/api/inspire/posts/${encodeURIComponent(entry.id)}/storyboards`, body);
      setLeft(r.left);
      track(entry, r.storyboard);
      return r.storyboard;
    } catch (e) {
      if (e && e.data && e.data.left) setLeft(e.data.left);
      if (e.status !== 401) toast(errText(e), 'error', 5000);
      return null;
    } finally { setBusy(btn, false); }
  }

  /* ------------------------------------------------------------ card carousel (Instagram-post-like media block) */
  // All frames of the card's version, swipeable (CSS scroll-snap; arrows on hover/focus; ← → / Home / End when focused;
  // Enter or a tap opens the viewer at that scene). The block's size comes from fikir.html's CSS (.sb-media, .sb-car-stage,
  // .sb-car-foot): identical before and after this module loaded. Slides are keyed by scene number, so frames fill in as they
  // arrive and a redrawn frame is swapped without moving the carousel. Images: the current slide loads lazily with the page,
  // the next one right after it; the others when the user navigates.
  const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)');
  const carOf = new WeakMap();   // track -> carousel
  // a moved card (column change) loses its scroll position: restore the current slide when the track's size changes
  const carRO = 'ResizeObserver' in window ? new ResizeObserver((recs) => { for (const r of recs) { const car = carOf.get(r.target); if (car) snapCar(car); } }) : null;
  // same rule as fikir.html sbMediaShown(): a running build, or a build with frames
  const mediaShown = (s) => !!s && (ACTIVE(s.status) || s.frame_done > 0 || (s.frame_total > 0 && s.status !== 'failed'));
  // shape: the stage shape while the aspect is still unknown (a build before its draft): the card keeps its current one.
  function carouselPlan(s, shape) {
    if (!mediaShown(s)) return null;
    const thumbs = new Map((s.thumbs || []).map((t) => [t.n, t.path]));
    const scenes = new Map((s.scenes || []).map((x) => [x.n, x]));
    const ns = new Set([...scenes.keys(), ...thumbs.keys()]);
    for (let k = 1; ns.size < (s.frame_total || 0) && k <= 8; k++) ns.add(k);
    const busy = ACTIVE(s.status) || s.frame_busy > 0;
    const slides = [...ns].sort((a, b) => a - b).map((n) => {
      const sc = scenes.get(n) || {};
      const path = thumbs.get(n) || null;
      // legacy summary (frames 5+ not listed, being read): a neutral placeholder, never "Çizilemedi"
      return { n, path, title: sc.title || '', shot: sc.shot || null, state: path ? 'img' : busy ? 'busy' : isLegacy(s) ? 'wait' : 'failed' };
    });
    if (!slides.length) {   // research / draft: one "preparing" slide until the scenes exist
      const text = s.status === 'queued' ? 'Sırada…' : s.stage === 'research' ? 'Araştırılıyor…' : s.stage === 'draft' ? 'Sahneler yazılıyor…' : 'Hazırlanıyor…';
      slides.push({ n: 0, path: null, title: '', shot: null, state: 'prep', text });
    }
    return { shape: s.aspect ? sbShape(s.aspect) : shape || 'wide', slides };
  }
  function renderCarousel(c) {
    const media = c.entry.refs.sbMedia;
    if (!media) return;
    const plan = carouselPlan(c.summary, c.shape);
    const sig = JSON.stringify(plan);
    if (sig === c.carSig && (!plan || (c.car && media.contains(c.car.root)))) return;
    c.carSig = sig;
    media.hidden = !plan;
    if (c.entry.el) c.entry.el.classList.toggle('has-sb-media', !!plan);
    if (!plan) { dropCar(c); media.textContent = ''; return; }
    c.shape = plan.shape;
    media.classList.toggle('tall', plan.shape === 'tall');
    media.classList.toggle('square', plan.shape === 'square');
    if (!c.car || !media.contains(c.car.root)) { dropCar(c); c.car = buildCar(c, media); }
    updateCar(c.car, plan);
  }
  function dropCar(c) {
    if (!c.car) return;
    if (carRO) carRO.unobserve(c.car.track);
    cancelAnimationFrame(c.car.raf);
    clearTimeout(c.car.goalT);
    c.car = null;
  }
  function buildCar(c, media) {
    media.textContent = '';
    const track = h('div', { class: 'sb-car-track', tabindex: '0', role: 'group', 'aria-roledescription': 'carousel',
      'aria-label': 'Storyboard kareleri (← → ile gez, Enter ile aç)' });
    const prev = h('button', { type: 'button', class: 'sb-car-nav prev', 'data-sb': 'car-prev', tabindex: '-1', 'aria-label': 'Önceki kare' });
    const next = h('button', { type: 'button', class: 'sb-car-nav next', 'data-sb': 'car-next', tabindex: '-1', 'aria-label': 'Sonraki kare' });
    const count = h('span', { class: 'sb-car-count', 'aria-hidden': 'true' });
    const dots = h('div', { class: 'sb-car-dots', 'aria-hidden': 'true' });
    const cap = h('div', { class: 'sb-car-cap' });
    const root = h('div', { class: 'sb-car' }, h('div', { class: 'sb-car-stage' }, track, prev, next, count), h('div', { class: 'sb-car-foot' }, dots, cap));
    media.append(root);
    const car = { c, root, track, prev, next, count, dots, cap, slides: new Map(), order: [], plan: null, idx: 0, goal: null, goalT: 0, touched: false, raf: 0 };
    track.addEventListener('scroll', () => onCarScroll(car), { passive: true });
    track.addEventListener('keydown', (e) => onCarKey(car, e));
    carOf.set(track, car);
    if (carRO) carRO.observe(track);
    return car;
  }
  function updateCar(car, plan) {
    const want = new Set(plan.slides.map((p) => p.n));
    for (const [n, sl] of car.slides) if (!want.has(n)) { sl.el.remove(); car.slides.delete(n); }
    plan.slides.forEach((p, i) => {
      let sl = car.slides.get(p.n);
      if (!sl) {
        sl = { n: p.n, el: h('div', { class: 'sb-car-slide', 'data-sb': 'open-at', 'data-n': p.n || null, role: 'group', 'aria-roledescription': 'slide' }),
          img: null, path: null, srcPath: null, state: '', waiting: false };
        car.slides.set(p.n, sl);
      }
      if (car.track.children[i] !== sl.el) car.track.insertBefore(sl.el, car.track.children[i] || null);
      sl.el.setAttribute('aria-label', `${i + 1} / ${plan.slides.length}` + (p.title ? `: ${p.title}` : ''));
      applySlide(sl, p);
    });
    car.order = plan.slides.map((p) => car.slides.get(p.n));
    car.plan = plan;
    if (car.idx > car.order.length - 1) { car.idx = Math.max(0, car.order.length - 1); snapCar(car); }
    if (car.dots.childElementCount !== (car.order.length > 1 ? car.order.length : 0)) {
      car.dots.textContent = '';
      if (car.order.length > 1) for (let k = 0; k < car.order.length; k++) car.dots.append(h('span', { class: 'sb-car-dot' }));
    }
    updateCarUI(car);
    loadAround(car);
  }
  function applySlide(sl, p) {
    if (p.path) {
      if (!sl.img) {
        sl.img = h('img', { class: 'sb-car-img', alt: '', decoding: 'async', crossorigin: 'anonymous', draggable: 'false' });
        sl.img.addEventListener('error', () => sl.el.classList.add('img-err'));
        sl.img.addEventListener('load', () => sl.el.classList.remove('img-err'));
      }
      sl.img.alt = `Sahne ${p.n}` + (p.title ? `: ${p.title}` : '');
      if (sl.path !== p.path) {
        sl.path = p.path;
        if (sl.srcPath) setSrc(sl, true);   // already shown: a redrawn frame replaces it now
      }
      if (sl.state !== 'img') { sl.state = 'img'; sl.el.textContent = ''; sl.el.append(sl.img); }
      return;
    }
    sl.path = null;
    const key = `${p.state}:${p.text || ''}`;
    if (sl.state === key) return;
    sl.state = key;
    sl.el.textContent = '';
    const failed = p.state === 'failed';
    sl.el.append(h('div', { class: 'sb-car-ph' + (failed ? ' err' : '') },
      failed ? null : h('span', { class: 'sb-car-pulse', 'aria-hidden': 'true' }),
      h('span', null, failed ? 'Çizilemedi' : p.state === 'prep' ? p.text : p.state === 'wait' ? 'Yükleniyor…' : 'Çiziliyor…')));
  }
  function setSrc(sl, eager) {
    if (!sl || !sl.img || !sl.path || sl.srcPath === sl.path) return;
    const url = fileUrl(sl.path);
    if (!url) return;
    sl.img.loading = eager ? 'eager' : 'lazy';
    sl.img.src = url;
    sl.srcPath = sl.path;
  }
  function loadAround(car) {
    const cur = car.order[car.idx];
    setSrc(cur, car.touched);
    const near = [car.order[car.idx + 1]];
    if (car.touched) near.push(car.order[car.idx - 1]);
    const ready = car.touched || !cur || !cur.img || !cur.srcPath || (cur.img.complete && cur.img.naturalWidth > 0);
    if (ready) { for (const sl of near) setSrc(sl, true); return; }
    if (cur.waiting) return;
    cur.waiting = true;
    const done = () => { cur.waiting = false; cur.img.removeEventListener('load', done); cur.img.removeEventListener('error', done); if (car.c.car === car) loadAround(car); };
    cur.img.addEventListener('load', done);
    cur.img.addEventListener('error', done);
  }
  function updateCarUI(car) {
    const n = car.order.length;
    const i = car.idx;
    car.count.textContent = `${i + 1}/${n}`;
    car.count.hidden = n < 2;
    car.prev.hidden = i <= 0;
    car.next.hidden = i >= n - 1;
    [...car.dots.children].forEach((d, k) => d.classList.toggle('on', k === i));
    const p = car.plan && car.plan.slides[i];
    car.cap.textContent = '';
    if (!p) return;
    if (p.state === 'prep') { car.cap.append(h('span', { class: 'sb-car-t' }, 'Storyboard hazırlanıyor')); return; }
    car.cap.append(h('span', { class: 'sb-car-n' }, String(p.n)), h('span', { class: 'sb-car-t' }, p.title || `Sahne ${p.n}`));
    if (p.shot) car.cap.append(h('span', { class: 'sb-car-shot' }, SHOT_TR[p.shot] || trUpper(p.shot.replace(/_/g, ' '))));   // native append() would print a null
  }
  function onCarScroll(car) {
    if (car.raf) return;
    car.raf = requestAnimationFrame(() => {
      car.raf = 0;
      const w = car.track.clientWidth;
      if (!w || !car.order.length) return;
      const i = Math.max(0, Math.min(car.order.length - 1, Math.round(car.track.scrollLeft / w)));
      if (i === car.goal) car.goal = null;
      if (i === car.idx) return;
      car.idx = i;
      car.touched = true;
      updateCarUI(car);
      loadAround(car);
    });
  }
  function snapCar(car) {
    const w = car.track.clientWidth;
    if (w && Math.abs(car.track.scrollLeft - car.idx * w) > 1) car.track.scrollLeft = car.idx * w;
  }
  // Slide a smooth scroll is heading to: a second arrow press / click during the scroll goes one further from there, not
  // from the slide still shown (a stale goal from an interrupted scroll expires).
  const carBase = (car) => (car.goal != null ? car.goal : car.idx);
  function carGo(car, i) {
    const n = car.order.length;
    if (!n) return;
    i = Math.max(0, Math.min(n - 1, i));
    car.touched = true;
    car.goal = i;
    clearTimeout(car.goalT);
    car.goalT = setTimeout(() => { car.goal = null; }, 1000);
    setSrc(car.order[i], true);
    setSrc(car.order[i + 1], true);
    car.track.scrollTo({ left: i * car.track.clientWidth, behavior: reduceMotion.matches ? 'auto' : 'smooth' });
  }
  function onCarKey(car, e) {
    if (e.altKey || e.ctrlKey || e.metaKey || e.target !== car.track) return;
    let i = null;
    if (e.key === 'ArrowRight') i = carBase(car) + 1;
    else if (e.key === 'ArrowLeft') i = carBase(car) - 1;
    else if (e.key === 'Home') i = 0;
    else if (e.key === 'End') i = car.order.length - 1;
    else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      const sl = car.order[car.idx];
      if (car.c.summary) openViewer(car.c.summary.id, (sl && sl.n) || null);
      return;
    }
    if (i == null) return;
    e.preventDefault();
    carGo(car, i);
  }

  /* ------------------------------------------------------------ add modal fields */
  let form = null;
  function decorateAddForm() {
    const textForm = document.getElementById('text-form');
    if (!textForm) return;
    if (!form) {
      const brand = h('input', { type: 'text', id: 'sb-brand', class: 'modal-input', maxlength: 80, placeholder: 'Marka / müşteri (isteğe bağlı)', 'aria-label': 'Marka / müşteri', autocomplete: 'off' });
      const place = h('input', { type: 'text', id: 'sb-place', class: 'modal-input', maxlength: 80, placeholder: 'Yer: şehir / semt (isteğe bağlı)', 'aria-label': 'Yer (şehir/semt)', autocomplete: 'off' });
      const format = h('select', { id: 'sb-format', class: 'modal-input', 'aria-label': 'Format' },
        h('option', { value: 'auto' }, 'Otomatik'), h('option', { value: '16:9' }, '16:9 yatay'), h('option', { value: '9:16' }, '9:16 dikey'));
      const enable = h('input', { type: 'checkbox', id: 'sb-enable', checked: true });
      const hint = h('div', { class: 'sb-quota-hint', id: 'sb-quota-hint', 'aria-live': 'polite' });
      const root = h('div', { class: 'sb-fields', id: 'sb-fields', hidden: true },
        h('div', { class: 'sb-row' }, brand, place),
        h('label', { class: 'sb-format' }, 'Format', format),
        h('label', { class: 'sb-check' }, enable, 'Storyboard oluştur'),
        hint);
      const anchor = document.getElementById('text-error');
      textForm.insertBefore(root, anchor || textForm.lastElementChild);
      form = { root, brand, place, format, enable, hint };
      enable.addEventListener('change', () => { brand.disabled = place.disabled = format.disabled = !enable.checked; });
    }
    refreshQuotaHints();
  }
  function refreshQuotaHints() {
    if (form) {
      form.root.hidden = !config.storyboard;
      const l = left();
      const none = !!l && l.storyboards === 0;
      form.enable.disabled = none;
      if (none) form.enable.checked = false;
      form.hint.textContent = none ? 'Bugünkü storyboard hakkın doldu; fikir storyboard\'suz kaydedilir.' : quotaText('sb');
      form.hint.classList.toggle('none', none);
    }
    for (const c of cards.values()) renderCardLater(c);   // storyboard cards: unchanged signature, no re-render
    if (viewer.data) renderViewer(viewer.data);
  }
  function formSpec() {
    if (!form || form.root.hidden || !form.enable.checked || form.enable.disabled) return null;
    return { brand: form.brand.value.trim(), place: form.place.value.trim(), format: form.format.value };
  }
  function resetAddForm() {
    if (!form) return;
    form.brand.value = ''; form.place.value = ''; form.format.value = 'auto';
    form.enable.checked = true;
    form.brand.disabled = form.place.disabled = form.format.disabled = false;
    refreshQuotaHints();
  }
  // fikir.html calls this with the POST /api/inspire/posts response of a text idea.
  function afterTextPost(entry, res) {
    if (res && res.sb_left) setLeft(res.sb_left);
    if (res && res.storyboard_error) toast(res.storyboard_error.message || 'Storyboard başlatılamadı.', 'error', 6000);
    if (entry && res && res.storyboard) track(entry, res.storyboard);
  }

  /* ------------------------------------------------------------ viewer */
  function buildViewer() {
    const close = h('button', { type: 'button', class: 'close-modal', 'data-sbv': 'close', 'aria-label': 'Kapat' }, '×');
    const status = h('span', { class: 'sb-tb-status', 'aria-live': 'polite' });
    const layout = h('div', { class: 'sb-layout', role: 'group', 'aria-label': 'Görünüm' },
      h('button', { type: 'button', 'data-sbv': 'layout', 'data-layout': 'big', title: 'Her sahne büyük, alt alta' }, 'Büyük'),
      h('button', { type: 'button', 'data-sbv': 'layout', 'data-layout': 'sheet', title: 'Yazdırılan sayfa düzeni' }, 'Sayfa'));
    const actions = h('div', { class: 'sb-tb-actions' });
    const sheet = h('article', { class: 'sb-sheet' });
    const toolbar = h('div', { class: 'sb-toolbar' }, close, status, layout, actions);
    const inner = h('div', { class: 'sb-viewer-inner', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'sb-v-title' }, toolbar, sheet);
    const el = h('div', { class: 'modal-overlay sb-viewer', id: 'sb-viewer', hidden: true }, inner);
    document.body.append(el);
    el.sbDismiss = closeViewer;   // fikir.html dismissModal() calls this (Esc)
    el.addEventListener('click', onViewerClick);
    el.addEventListener('submit', onViewerSubmit);
    Object.assign(viewer, { el, close, status, actions, sheet, inner, toolbar, layoutEl: layout });
    applyLayout();
  }
  function applyLayout() {
    viewer.sheet.classList.toggle('is-big', viewer.layout === 'big');
    for (const b of viewer.layoutEl.querySelectorAll('button')) b.setAttribute('aria-pressed', String(b.dataset.layout === viewer.layout));
  }
  // Switching keeps the scene that was at the top of the screen in view.
  function setLayout(v) {
    if (v !== 'big' && v !== 'sheet') return;
    if (v === viewer.layout) return;
    const anchor = firstVisibleScene();
    viewer.layout = v;
    try { localStorage.setItem(LAYOUT_KEY, v); } catch (_) { /* private mode: this session only */ }
    applyLayout();
    if (anchor != null) scrollToScene(anchor, false);
  }
  function firstVisibleScene() {
    if (!viewer.scenes || !viewer.inner.scrollTop) return null;
    const top = viewer.toolbar.getBoundingClientRect().bottom;
    for (const [n, v] of viewer.scenes) if (v.cell.getBoundingClientRect().bottom > top + 8) return n;
    return null;
  }
  function scrollToScene(n, flash = true) {
    const v = viewer.scenes && viewer.scenes.get(n);
    if (!v || !v.cell.isConnected) return false;
    const gap = v.cell.getBoundingClientRect().top - viewer.inner.getBoundingClientRect().top;
    viewer.inner.scrollTop += gap - viewer.toolbar.offsetHeight - 12;
    if (flash) {
      v.cell.classList.remove('sb-target');
      void v.cell.offsetWidth;   // restart the highlight
      v.cell.classList.add('sb-target');
      clearTimeout(v.flashTimer);
      v.flashTimer = setTimeout(() => v.cell.classList.remove('sb-target'), 1800);
    }
    return true;
  }
  const viewerShows = (sbId) => !!viewer.el && !viewer.el.hidden && viewer.sbId === sbId;
  const onViewerData = (full, sbId) => {
    if (viewer.sbId !== sbId) return;
    if (!full) { toast('Storyboard silinmiş.', 'error'); closeViewer(); return; }
    renderViewer(full);
  };
  // at: scene number to show (a tapped carousel slide), or null.
  async function openViewer(sbId, at = null) {
    if (!viewer.el) buildViewer();
    if (viewer.sbId && viewer.sbId !== sbId) unwatch(viewer.sbId, onViewerData);
    const fresh = viewer.sbId !== sbId;
    if (fresh) {
      viewer.sigs.clear(); viewer.sheet.textContent = ''; viewer.data = null; viewer.fixOpen = false; viewer.rewriteOpen.clear();
      viewer.rewriteDraft.clear(); viewer.fixDraft = null; viewer.focusNext = null; viewer.scenes = null;
    }
    viewer.sbId = sbId;
    viewer.target = at;
    if (viewer.el.hidden) openModal(viewer.el, viewer.close);
    if (fresh) viewer.inner.scrollTop = 0;
    viewer.status.textContent = 'Yükleniyor…';
    try {
      const full = await api('GET', `/api/inspire/storyboards/${sbId}`);
      if (viewer.sbId !== sbId) return;
      renderViewer(full);
      watch(sbId, onViewerData, !!full.poll_ms);
    } catch (e) {
      viewer.status.textContent = errText(e);
    }
  }
  function closeViewer() {
    if (!viewer.el || viewer.el.hidden) return;
    const postId = viewer.data ? viewer.data.post_id : null;
    if (viewer.sbId) {
      unwatch(viewer.sbId, onViewerData);
      const w = watchers.get(viewer.sbId);
      if (w && !w.subs.size) watchers.delete(viewer.sbId);
    }
    viewer.sbId = null;
    closeModal(viewer.el);
    if (postId != null) focusCard(postId);
  }

  function renderViewer(full) {
    viewer.data = full;
    const d = full.draft;
    const canEdit = !!full.can_edit;
    const busyOps = full.ops.filter((o) => ACTIVE(o.status));
    // toolbar
    const st = ACTIVE(full.status) ? progressText(full)
      : busyOps.length ? 'Güncelleniyor…'
      : full.status === 'failed' ? (ERR_TR[full.error && full.error.code] || 'Storyboard oluşturulamadı.')
      : full.status === 'partial' ? (full.error && full.error.code === 'quota' ? ERR_TR.quota : `${full.frame_total - full.frame_done} kare çizilemedi.`)
      : `Sürüm ${full.version}`;
    viewer.status.textContent = st;
    const tbSig = JSON.stringify([canEdit, full.can_delete, full.status, full.frame_done, full.frame_total, busyOps.length, left(), full.previous_id]);
    if (viewer.sigs.get('tb') !== tbSig) {
      viewer.sigs.set('tb', tbSig);
      viewer.actions.textContent = '';
      if (d) viewer.actions.append(h('button', { type: 'button', class: 'btn btn-outline btn-sm', 'data-sbv': 'print' }, 'Yazdır / PDF'));
      if (canEdit && d && !ACTIVE(full.status)) viewer.actions.append(h('button', { type: 'button', class: 'btn btn-outline btn-sm', 'data-sbv': 'fix' }, 'Yorumu düzelt'));
      if (canEdit && d && full.status === 'partial' && !busyOps.length) viewer.actions.append(h('button', { type: 'button', class: 'btn btn-outline btn-sm', 'data-sbv': 'resume' }, 'Eksik kareleri çiz'));
      if (!d && full.status === 'failed' && full.previous_id) viewer.actions.append(h('button', { type: 'button', class: 'btn btn-outline btn-sm', 'data-sbv': 'prev' }, 'Önceki sürümü aç'));
      if (canEdit && !d && full.status === 'failed') viewer.actions.append(h('button', { type: 'button', class: 'btn btn-outline btn-sm', 'data-sbv': 'retry' }, 'Tekrar dene'));
      if (full.can_delete) viewer.actions.append(h('button', { type: 'button', class: 'btn btn-outline btn-sm', 'data-sbv': 'delete' }, 'Sil'));
    }
    // sheet
    const sheet = viewer.sheet;
    if (!d) {
      const sig = JSON.stringify(['empty', full.status, full.stage]);
      if (viewer.sigs.get('sheet') !== sig) {
        viewer.sigs.clear(); viewer.sigs.set('sheet', sig); viewer.sigs.set('tb', tbSig);
        sheet.textContent = '';
        sheet.append(...[h('h1', { id: 'sb-v-title' }, 'Storyboard'),   // native append() would print a null as "null"
          ACTIVE(full.status) ? h('div', { class: 'sb-progress' }, stepsList(summarize(full))) : null,
          h('p', { class: 'sb-empty-sheet' }, ACTIVE(full.status) ? 'Sahneler yazılıyor; metin hazır olunca burada görünecek.' : (ERR_TR[full.error && full.error.code] || 'Storyboard oluşturulamadı.'))].filter(Boolean));
      }
      return;
    }
    if (viewer.sigs.get('sheet') !== 'draft') {
      viewer.sigs.clear(); viewer.sigs.set('tb', tbSig); viewer.sigs.set('sheet', 'draft');
      sheet.textContent = '';
      viewer.head = h('header', { class: 'sb-head' });
      viewer.progress = h('div', { class: 'sb-progress' });
      viewer.grid = h('section', { class: 'sb-grid', 'aria-label': 'Sahneler' });
      viewer.foot = h('footer', { class: 'sb-foot' });
      viewer.fix = h('div', { class: 'sb-fix', hidden: true });
      viewer.scenes = new Map();
      sheet.append(viewer.head, viewer.progress, viewer.grid, viewer.foot, viewer.fix);
    }
    const headSig = JSON.stringify([d.title, d.logline, d.core_message, d.aspect_ratio, d.scenes.map((s) => s.duration_s), full.input, full.entities]);
    if (viewer.sigs.get('head') !== headSig) {
      viewer.sigs.set('head', headSig);
      viewer.head.textContent = '';
      const brand = (full.input && full.input.brand) || (full.entities && full.entities.brand) || '';
      const place = (full.input && full.input.place) || (full.entities && full.entities.place) || '';
      const kicker = [brand && trUpper(brand), place && trUpper(place), 'KABA STORYBOARD'].filter(Boolean).join('  ·  ');
      const total = d.scenes.reduce((s, x) => s + (Number(x.duration_s) || 0), 0);
      viewer.head.append(
        h('div', { class: 'sb-kicker' }, kicker),
        h('h1', { id: 'sb-v-title' }, d.title),
        h('p', { class: 'sb-logline' }, d.logline),
        h('p', { class: 'sb-meta' }, h('b', null, 'Ana mesaj: '), d.core_message),
        h('p', { class: 'sb-meta' }, h('b', null, 'Format: '), `${d.aspect_ratio}  ·  ${d.scenes.length} sahne  ·  toplam ${fmtDur(total)} sn  ·  kurşun kalem eskiz (renksiz)`),
        h('hr', { class: 'sb-rule' }));
    }
    const progSig = JSON.stringify([full.status, full.stage, full.frame_done, full.frame_total]);
    if (viewer.sigs.get('prog') !== progSig) {
      viewer.sigs.set('prog', progSig);
      viewer.progress.textContent = '';
      viewer.progress.hidden = !ACTIVE(full.status);
      if (ACTIVE(full.status)) viewer.progress.append(stepsList(summarize(full)));
    }
    renderScenes(full, canEdit);
    const footSig = JSON.stringify([d.interpretations, d.assumptions, full.research, full.models, full.seed]);
    if (viewer.sigs.get('foot') !== footSig) {
      viewer.sigs.set('foot', footSig);
      viewer.foot.textContent = '';
      const interp = (d.interpretations || []).map((it) => `${it.name}: ${it.meaning} (güven: ${CONF_TR[it.confidence] || it.confidence})`).join('; ');
      if (interp) viewer.foot.append(h('p', null, h('b', null, 'Yorum: '), interp));
      for (const a of d.assumptions || []) viewer.foot.append(h('p', null, h('b', null, 'Varsayım: '), a));
      const r = full.research;
      if (r && r.sources && r.sources.length) viewer.foot.append(h('p', null, h('b', null, 'Kaynaklar: '), [...new Set(r.sources.map((s) => s.host).filter(Boolean))].join(', ')));
      else if (r && r.degraded) viewer.foot.append(h('p', null, h('b', null, 'Araştırma: '), RESEARCH_TR[r.degraded] || 'Web araştırması yapılmadı.'));
      viewer.foot.append(h('p', null, h('b', null, 'Not: '),
        `Yapay zekâ ile üretilmiş kaba eskizdir; ölçü, mekân ve marka bilgileri müşteriyle doğrulanmalıdır. Metin: ${shortModel(full.models.text)} · Görsel: FLUX.2 klein 4B (seed ${full.seed}, ortak karakter + mekân referansı).`));
    }
    renderFix(full);
    if (viewer.target != null) { scrollToScene(viewer.target); viewer.target = null; }   // first render with scenes
  }
  function progressText(full) {
    if (full.stage === 'queued') return 'Sırada…';
    if (full.stage === 'research') return 'Araştırılıyor…';
    if (full.stage === 'draft') return 'Sahneler yazılıyor…';
    return `Çiziliyor ${full.frame_done}/${full.frame_total}`;
  }
  function renderScenes(full, canEdit) {
    const d = full.draft;
    const tall = isTall(d.aspect_ratio);
    const cols = tall ? 4 : 3;
    viewer.grid.style.setProperty('--sb-cols', String(cols));
    viewer.grid.style.setProperty('--sb-cols-m', tall ? '2' : '1');
    viewer.grid.classList.toggle('tall', tall);
    viewer.grid.classList.toggle('square', d.aspect_ratio === '1:1');
    const layoutSig = JSON.stringify([d.scenes.length, cols]);
    if (viewer.sigs.get('layout') !== layoutSig) {
      viewer.sigs.set('layout', layoutSig);
      viewer.grid.textContent = '';
      viewer.scenes.clear();
      for (let i = 0; i < d.scenes.length; i += cols) {
        const row = h('div', { class: 'sb-row' });
        for (const sc of d.scenes.slice(i, i + cols)) {
          const cell = h('div', { class: 'sb-scene', 'data-n': sc.n });
          viewer.scenes.set(sc.n, { cell, sig: '', img: null, path: null });
          row.append(cell);
        }
        viewer.grid.append(row);
      }
    }
    const busyFrames = new Set(full.ops.filter((o) => ACTIVE(o.status)).map((o) => o.n));
    for (const sc of d.scenes) {
      const v = viewer.scenes.get(sc.n);
      const fr = full.frames.find((f) => f.n === sc.n) || { status: 'pending' };
      const locked = ACTIVE(full.status) || busyFrames.has(0) || busyFrames.has(sc.n) || fr.busy;
      const open = viewer.rewriteOpen.has(sc.n);
      const sig = JSON.stringify([sc, fr.path, fr.status, fr.error, fr.busy, canEdit, locked, open, d.aspect_ratio, left() && left().frames]);
      if (v.sig === sig) continue;
      v.sig = sig;
      renderScene(v, sc, fr, { canEdit, locked, open, aspect: d.aspect_ratio, active: ACTIVE(full.status) });
    }
  }
  function renderScene(v, sc, fr, o) {
    const cell = v.cell;
    const focused = document.activeElement;
    const hadFocus = !!focused && focused.tagName === 'INPUT' && cell.contains(focused);
    const caret = hadFocus ? [focused.selectionStart, focused.selectionEnd] : null;
    // keep the <img> element when the image did not change (no reload, no flicker)
    let img = v.img;
    const url = fileUrl(fr.path);
    if (url && v.path !== fr.path) {
      img = h('img', { alt: `Sahne ${sc.n} eskizi`, loading: 'eager', decoding: 'async', crossorigin: 'anonymous' });
      img.addEventListener('load', () => { try { if (colorSpread(img) > 5) img.classList.add('sb-desat'); } catch (_) { /* tainted canvas: ignore */ } }, { once: true });
      img.src = url;
      v.img = img; v.path = fr.path;
    } else if (!url) { v.img = null; v.path = null; img = null; }
    cell.textContent = '';
    const frame = h('div', { class: 'sb-frame' });
    frame.style.aspectRatio = ratioCss(o.aspect);
    frame.append(h('span', { class: 'sb-badge' }, String(sc.n)));
    if (img) frame.append(img);
    else if (fr.status === 'failed') frame.append(h('div', { class: 'sb-frame-ph err' }, ERR_TR[fr.error] || 'Çizilemedi'));
    else frame.append(h('div', { class: 'sb-frame-ph' }, o.active || fr.busy ? 'Çiziliyor…' : 'Bekliyor'));
    if (fr.busy || (o.active && !img && fr.status === 'running')) frame.append(h('div', { class: 'sb-frame-busy' }, h('span', { class: 'spinner', 'aria-hidden': 'true' })));
    const q = (t) => (t && String(t).trim() ? `“${t}”` : '—');
    // .sb-s-text: in the "Büyük" layout it sits beside the frame (below it on narrow screens)
    const tx = h('div', { class: 'sb-s-text' });
    cell.append(frame, tx);
    tx.append(
      h('h3', { class: 'sb-s-title' }, sc.title),
      h('div', { class: 'sb-s-shot' }, `${SHOT_TR[sc.shot] || sc.shot}  ·  ${MOVE_TR[sc.camera_move] || sc.camera_move}  ·  ${fmtDur(sc.duration_s)} sn`),
      h('dl', { class: 'sb-s-rows' },
        h('dt', null, 'Aksiyon'), h('dd', null, sc.action),
        h('dt', null, 'Ekran yazısı'), h('dd', null, q(sc.onscreen_text)),
        h('dt', null, 'Dış ses (VO)'), h('dd', null, q(sc.vo)),
        h('dt', null, 'Ses / müzik'), h('dd', { class: 'soft' }, sc.sound)));
    if (img && fr.error === 'stale_image') tx.append(h('div', { class: 'sb-s-note sb-noprint' }, ERR_TR.stale_image));
    else if (img && fr.error === 'redraw_failed') tx.append(h('div', { class: 'sb-s-note sb-noprint' }, ERR_TR.redraw_failed));
    if (o.canEdit) {
      const noFrames = left() && left().frames === 0;
      tx.append(h('div', { class: 'sb-s-actions' },
        h('button', { type: 'button', 'data-sbv': 'redraw', 'data-n': sc.n, disabled: o.locked || noFrames, title: noFrames ? 'Bugünkü yeniden çizim hakkın doldu' : 'Aynı sahneyi yeni bir tohumla yeniden çiz' }, 'Yeniden çiz'),
        h('button', { type: 'button', 'data-sbv': 'rewrite-open', 'data-n': sc.n, disabled: o.locked || noFrames, 'aria-expanded': String(o.open) }, 'Yeniden yaz')));
      if (o.open && !o.locked) {
        const input = h('input', { type: 'text', maxlength: 300, placeholder: 'Ne değişsin? Örn. kamera yerden baksın, fil daha küçük', 'aria-label': `Sahne ${sc.n} için not`, enterkeyhint: 'send' });
        input.value = viewer.rewriteDraft.get(sc.n) || '';
        input.addEventListener('input', () => viewer.rewriteDraft.set(sc.n, input.value));
        input.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.stopPropagation(); closeRewrite(sc.n); } });
        tx.append(h('form', { class: 'sb-rewrite', 'data-n': sc.n }, input,
          h('button', { type: 'submit' }, 'Yeniden yaz'), h('button', { type: 'button', class: 'sec', 'data-sbv': 'rewrite-cancel', 'data-n': sc.n }, 'Vazgeç')));
        if (hadFocus || viewer.focusNext === sc.n) {
          if (viewer.focusNext === sc.n) viewer.focusNext = null;
          setTimeout(() => {
            if (!input.isConnected) return;
            input.focus({ preventScroll: true });
            if (caret) { try { input.setSelectionRange(caret[0], caret[1]); } catch (_) { /* ignore */ } }
          }, 0);
        }
      }
    }
  }
  function closeRewrite(n) { viewer.rewriteOpen.delete(n); viewer.rewriteDraft.delete(n); renderViewer(viewer.data); }
  function renderFix(full) {
    const d = full.draft;
    const sig = JSON.stringify([viewer.fixOpen, full.can_edit, left() && left().storyboards]);
    if (viewer.sigs.get('fix') === sig) return;
    viewer.sigs.set('fix', sig);
    const box = viewer.fix;
    const hadFocus = !!document.activeElement && box.contains(document.activeElement);
    box.textContent = '';
    box.hidden = !(viewer.fixOpen && full.can_edit);
    if (box.hidden) return;
    const lines = (d.interpretations || []).filter((it) => it.confidence !== 'high').map((it) => it.name)
      .filter((n, i, a) => a.indexOf(n) === i).map((n) => `${n} = `);
    const ta = h('textarea', { maxlength: 500, 'aria-label': 'Yorum düzeltmesi', placeholder: 'Örn. STM = Sayın Ticaret Merkezi (dükkânlardan oluşan proje)' });
    ta.value = viewer.fixDraft != null ? viewer.fixDraft : lines.join('\n');
    ta.addEventListener('input', () => { viewer.fixDraft = ta.value; });
    ta.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.stopPropagation(); viewer.fixOpen = false; viewer.fixDraft = null; renderViewer(viewer.data); } });
    const l = left();
    const cost = l && l.per_user != null ? `Bugünkü storyboard hakkından 1 kullanır (kalan: ${l.storyboards}).` : 'Bugünkü genel storyboard kotasından 1 kullanır.';
    box.append(h('form', { class: 'sb-fix-form' },
      h('p', { class: 'sb-meta' }, h('b', null, 'Yorumu düzelt: '), 'Yanlış anlaşılan isim ve kısaltmaları her satıra bir tane yaz. Storyboard bu bilgilerle baştan oluşturulur.'),
      ta,
      h('div', { class: 'sb-fix-actions' }, h('span', { class: 'sb-fix-hint' }, cost),
        h('button', { type: 'button', class: 'sec', 'data-sbv': 'fix-cancel' }, 'Vazgeç'),
        h('button', { type: 'submit', disabled: !!l && l.storyboards === 0 }, 'Düzelt ve yeniden oluştur'))));
    const opened = viewer.focusNext === 'fix';
    if (opened || hadFocus) {
      if (opened) viewer.focusNext = null;
      setTimeout(() => { if (!ta.isConnected) return; ta.focus({ preventScroll: true }); if (opened) box.scrollIntoView({ block: 'nearest' }); }, 0);
    }
  }

  async function onViewerClick(ev) {
    const b = ev.target.closest('[data-sbv]');
    if (!b) return;
    const act = b.dataset.sbv;
    if (act === 'layout') { setLayout(b.dataset.layout); return; }   // these two work while the sheet is still loading
    if (act === 'close') { closeViewer(); return; }
    if (!viewer.data) return;
    const full = viewer.data;
    const n = Number(b.dataset.n || 0);
    if (act === 'print') { printSheet(); return; }
    if (act === 'fix') { viewer.fixOpen = true; viewer.fixDraft = null; viewer.focusNext = 'fix'; renderViewer(full); return; }
    if (act === 'fix-cancel') { viewer.fixOpen = false; viewer.fixDraft = null; renderViewer(full); return; }
    if (act === 'rewrite-open') { viewer.rewriteOpen.add(n); viewer.focusNext = n; renderViewer(full); return; }
    if (act === 'rewrite-cancel') { closeRewrite(n); return; }
    if (act === 'prev' && full.previous_id) { openViewer(full.previous_id); return; }
    if (act === 'redraw') { await runOp(b, `/api/inspire/storyboards/${full.id}/frames/${n}/redraw`, {}); return; }
    if (act === 'resume') { await runOp(b, `/api/inspire/storyboards/${full.id}/resume`, {}); return; }
    if (act === 'retry') {
      const entry = deps.posts.get(String(full.post_id));
      if (!entry) return;
      const s = await startFor(entry, {}, b);
      if (s) openViewer(s.id);
      return;
    }
    if (act === 'delete') {
      if (!(await confirmDialog('Bu storyboard silinsin mi? Fikir kartı kalır.', 'Sil'))) return;
      try {
        await api('DELETE', `/api/inspire/storyboards/${full.id}`);
        const c = cards.get(String(full.post_id));
        closeViewer();
        toast('Storyboard silindi.', 'ok');
        if (c && c.summary && c.summary.id === full.id) await showPrevious(c, full.previous_id);   // the card falls back
        else if (c && c.summary && c.summary.previous_id === full.id) setSummary(c, { ...c.summary, previous_id: null });
        focusCard(full.post_id);
      } catch (e) { if (e.status !== 401) toast(errText(e), 'error'); }
    }
  }
  async function onViewerSubmit(ev) {
    ev.preventDefault();
    const full = viewer.data;
    if (!full) return;
    const f = ev.target;
    const btn = f.querySelector('button[type=submit]');
    if (f.classList.contains('sb-rewrite')) {
      const n = Number(f.dataset.n);
      const note = f.querySelector('input').value.trim();
      if (note.length < 3) { toast('Notu biraz daha açık yaz (en az 3 karakter).', 'error'); return; }
      const okRun = await runOp(btn, `/api/inspire/storyboards/${full.id}/scenes/${n}/rewrite`, { note });
      if (okRun) closeRewrite(n);
      return;
    }
    if (f.classList.contains('sb-fix-form')) {
      const corrections = f.querySelector('textarea').value.split('\n').map((x) => x.trim()).filter((x) => x && !/^[^=:]+[=:]\s*$/.test(x)).join('\n');
      if (!corrections) { toast('En az bir düzeltme yaz (örn. STM = …).', 'error'); return; }
      const entry = deps.posts.get(String(full.post_id));
      if (!entry) { toast('Fikir kartı bulunamadı; sayfayı yenile.', 'error'); return; }
      const s = await startFor(entry, { corrections }, btn);
      if (s) { viewer.fixOpen = false; viewer.fixDraft = null; openViewer(s.id); toast('Storyboard düzeltmelerle yeniden oluşturuluyor.', 'ok'); }
    }
  }
  async function runOp(btn, path, body) {
    setBusy(btn, true);
    try {
      const r = await api('POST', path, body);
      setLeft(r.left);
      kick(viewer.sbId);
      const c = cards.get(String(viewer.data.post_id));
      if (c && c.summary) watch(c.summary.id, c.onData, true);
      return true;
    } catch (e) {
      if (e && e.data && e.data.left) setLeft(e.data.left);
      if (e.status !== 401) toast(errText(e), 'error', 5000);
      return false;
    } finally { setBusy(btn, false); }
  }

  /* ------------------------------------------------------------ print (A4 landscape, sheet only) */
  function printSheet() {
    if (viewer.printPending) return;   // a second click while the frames are still loading
    viewer.printPending = true;
    document.documentElement.classList.add('sb-print');
    const imgs = [...viewer.sheet.querySelectorAll('img')].filter((i) => !i.complete);
    let t = 0;
    const go = () => {   // exactly once: when every frame settled, or after 4 s with whatever has loaded
      if (!viewer.printPending) return;
      viewer.printPending = false;
      clearTimeout(t);
      window.print();
    };
    if (!imgs.length) { go(); return; }
    let waiting = imgs.length;
    t = setTimeout(go, 4000);
    const settled = () => { if (--waiting === 0) go(); };
    for (const i of imgs) { i.addEventListener('load', settled, { once: true }); i.addEventListener('error', settled, { once: true }); }
  }
  window.addEventListener('beforeprint', () => { if (viewer.el && !viewer.el.hidden) document.documentElement.classList.add('sb-print'); });
  window.addEventListener('afterprint', () => document.documentElement.classList.remove('sb-print'));

  /* ------------------------------------------------------------ lifecycle */
  function configChanged() { decorateAddForm(); refreshQuotaHints(); }
  function stopAll() {
    for (const w of watchers.values()) clearTimeout(w.timer);
    watchers.clear();
    for (const c of cards.values()) dropCar(c);
    cards.clear();
    if (viewer.el && !viewer.el.hidden) closeViewer();
  }

  return { mount, patch, unmount, track, afterTextPost, decorateAddForm, formSpec, resetAddForm, configChanged, openViewer, closeViewer, stopAll, setLeft };
}
