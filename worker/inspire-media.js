// inspire-media.js: link previews for Fikir Havuzu (meta v2 + Media v1). PURE module: no network, no D1/R2, no
// `cloudflare:workers` import, so `node --test tests/` can load it. worker/index.js does every fetch (SSRF-guarded) and
// passes the text here. Imports only the shared link parser.
//
//   parseHead(html, pageUrl)        <head> -> OpenGraph/Twitter/<title> fields + og:video*, twitter:player*, JSON-LD,
//                                   head <video>/<source> tags, canonical, oEmbed discovery link
//   wantsBody(head, pageUrl)        read past </head> (up to MAX_PAGE_BYTES)? Only for video-looking pages without a video
//   scanBody(html, pageUrl, head)   JSON-LD blocks, <video>/<source> tags and inline media URLs after the head (bounded)
//   collectFromScrape(json, url)    Browser Run Quick Action `scrape` JSON -> the same structure, plus {blocked, gone,
//                                   empty, status}
//   extractMedia(collected, url)    candidate scoring -> {media, image, imageMedia, playAtSource, candidates}
//   isBlocked / isExpiringUrl / adapterFor / variantsFor / sanitizeMedia / sniffMagic / oembedMedia / sameSite
import { parseLink, mediaKindOf } from '../assets/js/fikir-url.mjs';

export const META_V = 2, MEDIA_V = 1;
export const MAX_HEAD_BYTES = 512 * 1024, MAX_PAGE_BYTES = 1024 * 1024;
export const MAX_LD_BLOCKS = 6, MAX_LD_BYTES = 96 * 1024, MAX_TAGS = 40, MAX_INLINE = 60;
export const AUTOPLAY_MAX_BYTES = 30 * 1024 * 1024;
export const MAX_MEDIA_JSON = 6 * 1024;
export const BLOCK_TITLE_RE = /security filter|just a moment|attention required|access denied|verify you are human|pardon our interruption|checking your browser|are you a robot|request unsuccessful|unusual traffic|bot-wall/i;
export const MEDIA_MIMES = new Set([
  'video/mp4', 'video/webm', 'video/quicktime', 'application/vnd.apple.mpegurl',
  'image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif',
]);
// Server-generated upload paths only (see index.js uploads): fikir/<postId>/<slot>-<32 hex>.<ext>
export const FILES_PATH_RE = /^\/files\/fikir\/\d{1,15}\/[vip]-[0-9a-f]{32}\.(mp4|webm|mov|jpg|png|webp|gif)$/;
export const FILES_KEY_RE = /^fikir\/\d{1,15}\/[vip]-[0-9a-f]{32}\.(mp4|webm|mov|jpg|png|webp|gif)$/;
const MEDIA_KINDS = new Set(['video', 'image', 'hls', 'player']);
const SOURCE_RE = /^(og|ld|html|inline|oembed|br|manual|upload|bookmarklet|instagram|x|tiktok|facebook|pinterest|reddit|adapter:[a-z0-9_]{1,30})$/;
// R2 copies of a platform's video post (worker/index.js inspireCopy): post.media.source = the platform. These carry the
// credit (`by`), the caption (plain text, <= COPY_CAPTION_MAX code points) and the sound flag (`audio`) for the card.
export const COPY_SOURCES = new Set(['instagram', 'x', 'tiktok', 'facebook', 'pinterest', 'reddit']);
export const COPY_CAPTION_MAX = 2000;
// Instagram user names; the other platforms' handles (TikTok uniqueId, X screen_name, Reddit /u/, Pinterest username)
const COPY_BY_RE = { instagram: /^[A-Za-z0-9._]{1,30}$/, other: /^[A-Za-z0-9._-]{1,40}$/ };

/* ------------------------------------------------------------------ text helpers (moved from index.js) */

const ENTITIES = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '–', mdash: '—', hellip: '…',
  lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”', laquo: '«', raquo: '»', bull: '•',
  middot: '·', copy: '©', reg: '®', trade: '™', euro: '€', pound: '£', deg: '°', times: '×',
  ccedil: 'ç', Ccedil: 'Ç', ouml: 'ö', Ouml: 'Ö', uuml: 'ü', Uuml: 'Ü', scedil: 'ş',
  Scedil: 'Ş', gbreve: 'ğ', Gbreve: 'Ğ', inodot: 'ı', imath: 'ı', Idot: 'İ', acirc: 'â',
  Acirc: 'Â', icirc: 'î', ucirc: 'û', eacute: 'é', egrave: 'è', aacute: 'á', agrave: 'à',
  iacute: 'í', oacute: 'ó', uacute: 'ú', ntilde: 'ñ', auml: 'ä', Auml: 'Ä', szlig: 'ß',
};
export function inspireDecodeEntities(s) {
  return String(s).replace(/&(#\d{1,7}|#[xX][0-9a-fA-F]{1,6}|[A-Za-z][A-Za-z0-9]{1,31});?/g, (m, e) => {
    if (e[0] === '#') {
      const cp = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return cp > 0 && cp <= 0x10FFFF && !(cp >= 0xD800 && cp <= 0xDFFF) ? String.fromCodePoint(cp) : m;
    }
    return Object.prototype.hasOwnProperty.call(ENTITIES, e) ? ENTITIES[e] : m;
  });
}
export function inspireAttrs(s) {
  const out = Object.create(null);
  const re = /([^\s"'<>\/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
  let m;
  while ((m = re.exec(s))) {
    const k = m[1].toLowerCase();
    if (!(k in out)) out[k] = m[2] ?? m[3] ?? m[4] ?? '';
  }
  return out;
}
export function inspireMetaText(s, max) {
  if (s == null) return null;
  let t = inspireDecodeEntities(s);
  // Some sites (LinkedIn) double-encode: content="Microsoft&amp;#39;s" -> decode once more.
  if (/&(#\d{1,7}|#[xX][0-9a-fA-F]{1,6}|amp|quot|apos|lt|gt|nbsp);/.test(t)) t = inspireDecodeEntities(t);
  t = t
    .replace(/<[^>]*>/g, ' ')
    .replace(/[\u0000-\u001F\u007F-\u009F‪-‮⁦-⁩﻿]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!t) return null;
  const chars = Array.from(t);
  if (chars.length > max) t = chars.slice(0, max - 1).join('').trimEnd() + '…';
  return t;
}

/* ------------------------------------------------------------------ small utils */

// Plain DNS names / IPv4 hosts only (index.js inspireHostOk uses the same rule).
export function hostOk(href) {
  try { return /^[a-z0-9._-]+$/i.test(new URL(href).hostname); } catch { return false; }
}
// Absolute http(s) URL (entities decoded, <= 2048 chars, no credentials) or null.
export function absUrl(raw, base) {
  if (raw == null) return null;
  const s = inspireDecodeEntities(String(raw).trim());
  if (!s || /^(data|blob|javascript|about|file):/i.test(s)) return null;
  try {
    const u = new URL(s, base);
    if ((u.protocol !== 'https:' && u.protocol !== 'http:') || u.username || u.password) return null;
    u.hash = '';
    return u.href.length <= 2048 ? u.href : null;
  } catch { return null; }
}
const toInt = (v) => {
  if (v == null) return null;
  if (typeof v === 'object' && !Array.isArray(v)) v = v.value;
  const n = Math.round(parseFloat(String(v)));
  return Number.isFinite(n) && n >= 1 && n <= 100000 ? n : null;
};
const dims = (n) => (n != null && n >= 1 && n <= 10000 ? n : null);
function pathOf(url) {
  try { const p = new URL(url).pathname; try { return decodeURIComponent(p); } catch { return p; } } catch { return ''; }
}
const lower = (s) => String(s || '').toLowerCase();
const normPage = (u) => { try { const x = new URL(u); x.hash = ''; x.search = ''; return x.href.replace(/\/+$/, '').toLowerCase(); } catch { return ''; } };

// 'video' | 'hls' | null for a candidate URL (extension first, then a declared video/* or mpegurl type).
function fileKind(url, type) {
  const p = lower(pathOf(url));
  if (/\.(mp4|m4v|webm|mov)$/.test(p)) return 'video';
  if (/\.m3u8$/.test(p)) return 'hls';
  const t = lower(type);
  if (/^video\/(mp4|webm|quicktime|x-m4v|ogg)\b/.test(t)) return 'video';
  if (/mpegurl/.test(t)) return 'hls';
  return null;
}
function mimeFor(url, kind, declared) {
  const t = lower(declared).split(';')[0].trim();
  if (MEDIA_MIMES.has(t)) return t;
  const p = lower(pathOf(url));
  if (kind === 'hls' || /\.m3u8$/.test(p)) return 'application/vnd.apple.mpegurl';
  if (/\.(mp4|m4v)$/.test(p)) return 'video/mp4';
  if (/\.webm$/.test(p)) return 'video/webm';
  if (/\.mov$/.test(p)) return 'video/quicktime';
  if (/\.jpe?g$/.test(p)) return 'image/jpeg';
  if (/\.png$/.test(p)) return 'image/png';
  if (/\.webp$/.test(p)) return 'image/webp';
  if (/\.gif$/.test(p)) return 'image/gif';
  if (/\.avif$/.test(p)) return 'image/avif';
  return null;
}

/* ------------------------------------------------------------------ parsing */

const HEAD_END_RE = /<\/head\s*>|<body[\s>]/i;
export function headEnd(html) { const i = html.search(HEAD_END_RE); return i > 0 ? i : html.length; }
const LD_RE = () => /<script\b[^>]*application\/ld\+json[^>]*>([\s\S]*?)<\/script\s*>/gi;
const TAG_RE = () => /<(video|source)\b([^>]*)>/gi;
// Inline media URLs (JSON blobs, scripts): plain, \/-escaped or /-escaped slashes; query may carry &.
const INLINE_RE = () => /https?:(?:\\?\/|\\u002[fF]){2}(?:[^"'\s<>\\]|\\\/|\\u002[fF]){4,1500}?\.(?:mp4|m4v|webm|mov|m3u8)(?:\?(?:[^"'\s<>\\]|\\u0026|\\\/){0,500})?/g;

function parseLdText(text, out, max) {
  if (out.length >= max || text.length > MAX_LD_BYTES) return;
  try {
    const v = JSON.parse(text.trim().replace(/^<!--|-->$/g, ''));
    if (v && typeof v === 'object') out.push(v);
  } catch (e) {}
}
function scanLd(text, out) {
  const re = LD_RE();
  let m, n = 0;
  while ((m = re.exec(text)) && n < MAX_LD_BLOCKS) { n++; parseLdText(m[1], out, MAX_LD_BLOCKS * 2); }
}
// <video>/<source> tags with a src; a <source> inherits poster/width/height from the last <video> before it.
function scanTags(text, offset, base, out, from) {
  const re = TAG_RE();
  let m, seen = 0, lastVideo = null;
  while ((m = re.exec(text)) && out.length < MAX_TAGS && seen < 2000) {
    seen++;
    const a = inspireAttrs(m[2]);
    const isVideo = m[1].toLowerCase() === 'video';
    if (isVideo) lastVideo = { poster: absUrl(a.poster, base), w: toInt(a.width), h: toInt(a.height) };
    const src = a.src ? absUrl(a.src, base) : null;
    if (!src) continue;
    const pv = lastVideo || {};
    out.push({ src, type: lower(a.type), poster: pv.poster || null, w: pv.w || null, h: pv.h || null, pos: offset + m.index, from });
  }
}
function unescapeInline(s) {
  return s.replace(/\\u002[fF]/g, '/').replace(/\\\//g, '/').replace(/\\u0026/g, '&').replace(/&amp;/g, '&');
}
function scanInline(text, offset, base, out) {
  const re = INLINE_RE();
  let m, n = 0;
  while ((m = re.exec(text)) && n < MAX_INLINE) {
    n++;
    const url = absUrl(unescapeInline(m[0]), base);
    if (url) out.push({ url, pos: offset + m.index });
  }
}
// Item id: the last run of >= 5 digits in the page path (4720543, 66110223).
export function itemIdOf(pageUrl) {
  const runs = pathOf(pageUrl).match(/\d{5,}/g);
  return runs ? runs[runs.length - 1] : null;
}
function anchorKeys(pageUrl) {
  const id = itemIdOf(pageUrl);
  if (id) return [id];
  const segs = pathOf(pageUrl).split('/').filter(Boolean);
  const last = segs.length ? segs[segs.length - 1] : '';
  return last.length >= 10 ? [last] : [];
}
function findAnchors(text, keys) {
  const out = [];
  for (const k of keys) {
    let i = text.indexOf(k);
    while (i >= 0 && out.length < 50) { out.push(i); i = text.indexOf(k, i + k.length); }
  }
  return out.sort((a, b) => a - b);
}

// OpenGraph / Twitter-card / <title> + media hints from the document head.
export function parseHead(html, pageUrl) {
  html = String(html || '');
  const end = headEnd(html);
  const head = html.slice(0, end);
  const metas = Object.create(null);
  const ogVideos = [];
  let cur = null;
  const metaRe = /<meta\b([^>]*)>/gi;
  let m;
  while ((m = metaRe.exec(head))) {
    const a = inspireAttrs(m[1]);
    const key = (a.property || a.name || a.itemprop || '').toLowerCase().trim();
    if (!key || a.content == null || !a.content.trim()) continue;
    const val = a.content.trim();
    if (!(key in metas)) metas[key] = val;
    if (!key.startsWith('og:video')) continue;
    // og:video structured property: og:video / og:video:url / og:video:secure_url start or fill an entry,
    // :type/:width/:height attach to the current one (Imgur puts :width before og:video).
    if (key === 'og:video' || key === 'og:video:url' || key === 'og:video:secure_url') {
      const slot = key === 'og:video:secure_url' ? 'secure' : 'url';
      if (cur && slot === 'url' && cur.url === val) continue;
      if (!cur || cur[slot]) {
        if (ogVideos.length >= 8) { cur = null; continue; }
        cur = { url: null, secure: null, type: null, w: null, h: null };
        ogVideos.push(cur);
      }
      cur[slot] = val;
    } else {
      if (!cur) { if (ogVideos.length >= 8) continue; cur = { url: null, secure: null, type: null, w: null, h: null }; ogVideos.push(cur); }
      if (key === 'og:video:type' && !cur.type) cur.type = lower(val);
      else if (key === 'og:video:width' && cur.w == null) cur.w = toInt(val);
      else if (key === 'og:video:height' && cur.h == null) cur.h = toInt(val);
    }
  }
  let imageSrc = null, canonical = null, oembedHref = null;
  const linkRe = /<link\b([^>]*)>/gi;
  while ((m = linkRe.exec(head))) {
    const a = inspireAttrs(m[1]);
    const rel = lower(a.rel);
    if (!imageSrc && /(^|\s)image_src(\s|$)/.test(rel) && a.href) imageSrc = a.href;
    else if (!canonical && /(^|\s)canonical(\s|$)/.test(rel) && a.href) canonical = absUrl(a.href, pageUrl);
    else if (!oembedHref && /alternat/.test(rel) && lower(a.type) === 'application/json+oembed' && a.href) oembedHref = absUrl(a.href, pageUrl);
  }
  const pick = (...keys) => { for (const k of keys) if (metas[k]) return metas[k]; return null; };
  const titleTag = /<title\b[^>]*>([\s\S]*?)<\/title\s*>/i.exec(head);
  const image = absUrl(pick('og:image:secure_url', 'og:image', 'og:image:url', 'twitter:image', 'twitter:image:src') || imageSrc, pageUrl);
  const videos = [];
  for (const v of ogVideos) {
    for (const raw of [v.secure, v.url]) {
      const url = absUrl(raw, pageUrl);
      if (url && !videos.some((x) => x.url === url)) videos.push({ url, type: v.type, w: v.w, h: v.h });
    }
  }
  const twStreamUrl = absUrl(pick('twitter:player:stream'), pageUrl);
  const twPlayerUrl = absUrl(pick('twitter:player'), pageUrl);
  const ld = [];
  scanLd(head, ld);
  const videoTags = [];
  scanTags(head, 0, pageUrl, videoTags, 'head');
  return {
    title: inspireMetaText(pick('og:title', 'twitter:title') ?? (titleTag ? titleTag[1] : null), 200),
    description: inspireMetaText(pick('og:description', 'twitter:description', 'description'), 400),
    image,
    site_name: inspireMetaText(pick('og:site_name', 'application-name'), 100),
    docTitle: titleTag ? inspireMetaText(titleTag[1], 300) : null,
    ogType: lower(pick('og:type')),
    ogUrl: absUrl(pick('og:url'), pageUrl),
    canonical,
    imageW: toInt(pick('og:image:width')),
    imageH: toInt(pick('og:image:height')),
    ogVideos: videos,
    twStream: twStreamUrl ? { url: twStreamUrl, type: lower(pick('twitter:player:stream:content_type')) } : null,
    twPlayer: twPlayerUrl ? { url: twPlayerUrl, w: toInt(pick('twitter:player:width')), h: toInt(pick('twitter:player:height')) } : null,
    twCard: lower(pick('twitter:card')),
    ld,
    videoTags,
    inline: [],
    anchors: [],
    oembedHref,
    headLen: end,
  };
}
export const inspireParseHead = parseHead;

const VIDEO_PATH_RE = /(^|\/)(video|videos|clip|clips|footage|stock-video|free-stock-video|premium-video|free-video|gif|gifs|watch|shot|shots)(\/|-|_|$)/i;
const PHOTO_PATH_RE = /(^|\/)(photo|photos|free-photo|premium-photo|image|images|image-photo|illustration|illustrations|vector|vectors|artwork|art|gallery|pin)(\/|-|_|$)/i;

// Read past </head>? Only when the head has no usable video and the page looks like a video page.
export function wantsBody(head, pageUrl) {
  if (!head) return false;
  const ex = extractMedia(head, pageUrl);
  if (ex.media && (ex.media.kind === 'video' || ex.media.kind === 'hls')) return false;
  if (ex.playAtSource) return false;
  if (/^video/.test(head.ogType || '')) return true;
  if (head.twCard === 'player') return true;
  const { vos } = walkLd(head.ld, head, pageUrl);
  if (vos.some((v) => !v.files.length)) return true;
  return VIDEO_PATH_RE.test(pathOf(pageUrl));
}

// Bounded scan of the text after the head: <= 6 JSON-LD blocks, <= 40 media tags, <= 60 inline media URLs.
// Never JSON.parse(__NEXT_DATA__) (the inline regex reads its URLs instead).
export function scanBody(html, pageUrl, head = null) {
  html = String(html || '');
  const start = head && Number.isFinite(head.headLen) ? Math.min(head.headLen, html.length) : headEnd(html);
  const text = html.slice(start);
  const ld = [], videoTags = [], inline = [];
  scanLd(text, ld);
  scanTags(text, start, pageUrl, videoTags, 'body');
  scanInline(text, start, pageUrl, inline);
  const anchors = findAnchors(html, anchorKeys(pageUrl));
  return { ld, videoTags, inline, anchors };
}
// head + body (+ adapter extras) -> one structure for extractMedia.
export function mergeCollected(head, body) {
  if (!body) return head;
  return {
    ...head,
    ld: [...(head.ld || []), ...(body.ld || [])],
    videoTags: [...(head.videoTags || []), ...(body.videoTags || [])],
    inline: [...(head.inline || []), ...(body.inline || [])],
    anchors: body.anchors && body.anchors.length ? body.anchors : head.anchors || [],
  };
}

/* ------------------------------------------------------------------ Browser Run scrape -> collected */

const escAttr = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
function attrsHtml(list) {
  if (!Array.isArray(list)) return '';
  let s = '';
  for (const a of list.slice(0, 40)) {
    if (!a || typeof a.name !== 'string' || !/^[a-zA-Z_:][-a-zA-Z0-9_:.]{0,60}$/.test(a.name)) continue;
    s += ` ${a.name}="${escAttr(String(a.value == null ? '' : a.value).slice(0, 4096))}"`;
  }
  return s;
}
// Quick Action `scrape` response {success, result:[{selector, results:[{attributes, text, html}]}], meta:{status, title,
// headers, finalUrl}} -> the parseHead+scanBody structure (built by re-serialising the elements and parsing them with
// the same code), plus {blocked, gone, empty, status, finalUrl}. blocked = a bot wall / challenge only (isBlocked() signals,
// or a title that is just the host); a removed page (404/410: gone) or a page without og:/JSON-LD/<video> (empty) is not.
export function collectFromScrape(json, pageUrl) {
  const res = json && Array.isArray(json.result) ? json.result : [];
  const meta = (json && json.meta && typeof json.meta === 'object') ? json.meta : {};
  const status = Number(meta.status) || 0;
  const finalUrl = absUrl(meta.finalUrl, pageUrl) || pageUrl;
  const sel = (s) => { const r = res.find((x) => x && x.selector === s); return r && Array.isArray(r.results) ? r.results.slice(0, 60) : []; };
  let head = '<head>';
  const t = sel('title')[0];
  const titleText = t ? String(t.text || t.html || '').slice(0, 1000) : '';
  if (titleText) head += `<title>${escAttr(titleText)}</title>`;
  let ogCount = 0;
  for (const s of ['meta[property^="og:"]', 'meta[property^="twitter:"]', 'meta[name^="twitter:"]', 'meta[name="description"]']) {
    for (const r of sel(s)) { if (s.includes('og:')) ogCount++; head += `<meta${attrsHtml(r.attributes)}>`; }
  }
  for (const r of sel('link[rel="canonical"]')) head += `<link${attrsHtml(r.attributes)}>`;
  const ldResults = sel('script[type="application/ld+json"]');
  for (const r of ldResults.slice(0, MAX_LD_BLOCKS)) {
    const txt = String(r.html || r.text || '');
    if (txt.length <= MAX_LD_BYTES && !/<\/script/i.test(txt)) head += `<script type="application/ld+json">${txt}</script>`;
  }
  head += '</head><body>';
  const videos = sel('video');
  const sources = sel('video source');
  let usedInner = false;
  for (const v of videos.slice(0, MAX_TAGS)) {
    head += `<video${attrsHtml(v.attributes)}>`;
    const inner = String(v.html || '');
    const re = /<source\b[^>]*>/gi;
    let m, k = 0;
    while ((m = re.exec(inner)) && k < 8) { k++; usedInner = true; head += m[0]; }
    head += '</video>';
  }
  if (!usedInner) for (const s of sources.slice(0, MAX_TAGS)) head += `<source${attrsHtml(s.attributes)}>`;
  head += '</body>';
  const h = parseHead(head, finalUrl);
  const body = scanBody(head, finalUrl, h);
  const collected = mergeCollected(h, { ...body, inline: [] });
  let host = '';
  try { host = new URL(finalUrl).hostname.replace(/^www\./, '').toLowerCase(); } catch (e) {}
  const tl = lower(titleText).trim();
  const headers = meta.headers && typeof meta.headers === 'object' ? meta.headers : null;
  const blocked = isBlocked({ status, headers, title: titleText }) || (!!tl && (tl === host || tl === 'www.' + host));
  const empty = ogCount === 0 && ldResults.length === 0 && videos.length === 0 && sources.length === 0;
  return { ...collected, blocked: !!blocked, gone: status === 404 || status === 410, empty, status, finalUrl };
}

/* ------------------------------------------------------------------ JSON-LD walk */

const ORG_TYPES = /^(Organization|Corporation|OnlineBusiness|NewsMediaOrganization|LocalBusiness|Person|Brand|WebSite|SearchAction|PostalAddress|ContactPoint)$/;
const typesOf = (o) => [].concat(o['@type'] || []).map((t) => String(t).replace(/^.*[/#:]/, ''));
const firstUrl = (v, base) => {
  for (const x of [].concat(v == null ? [] : v).slice(0, 6)) {
    const s = typeof x === 'string' ? x : x && typeof x === 'object' ? (x.url || x.contentUrl || x['@id']) : null;
    const u = typeof s === 'string' ? absUrl(s, base) : null;
    if (u) return u;
  }
  return null;
};
const allUrls = (v, base) => {
  const out = [];
  for (const x of [].concat(v == null ? [] : v).slice(0, 6)) {
    const s = typeof x === 'string' ? x : x && typeof x === 'object' ? (x.url || x.contentUrl) : null;
    const u = typeof s === 'string' ? absUrl(s, base) : null;
    if (u && !out.includes(u)) out.push(u);
  }
  return out;
};
// VideoObjects / ImageObjects of all LD roots: arrays, @graph, mainEntity and nested objects up to depth 6, <= 20 objects.
// Organization/Person/WebSite subtrees (logos, avatars) are not entered.
function walkLd(roots, collected, pageUrl) {
  const vos = [], ios = [];
  const pages = new Set([normPage(pageUrl), normPage(collected && collected.canonical), normPage(collected && collected.ogUrl)].filter(Boolean));
  let visited = 0;
  const walk = (o, depth, main) => {
    if (!o || typeof o !== 'object' || depth > 6 || visited > 400 || vos.length + ios.length >= 20) return;
    if (Array.isArray(o)) { for (const x of o.slice(0, 50)) walk(x, depth + 1, main); return; }
    visited++;
    const types = typesOf(o);
    if (types.some((t) => ORG_TYPES.test(t))) return;
    const idUrl = typeof o.url === 'string' ? o.url : typeof o['@id'] === 'string' ? o['@id'] : '';
    const isMain = main || (!!idUrl && pages.has(normPage(absUrl(idUrl, pageUrl))));
    if (types.includes('VideoObject')) {
      const contents = allUrls(o.contentUrl, pageUrl), embeds = allUrls(o.embedUrl, pageUrl);
      const fmt = lower(typeof o.encodingFormat === 'string' ? o.encodingFormat : '');
      const files = [], players = [];
      for (const u of contents) (fileKind(u, fmt) ? files : players).push({ url: u, prop: 'contentUrl' });
      for (const u of embeds) (fileKind(u, fmt) ? files : players).push({ url: u, prop: 'embedUrl' });
      vos.push({
        files, players, fmt, main: isMain,
        thumb: firstUrl(o.thumbnailUrl, pageUrl) || firstUrl(o.thumbnail, pageUrl),
        w: toInt(o.width), h: toInt(o.height),
      });
    } else if (types.includes('ImageObject')) {
      const cu = firstUrl(o.contentUrl, pageUrl);
      if (cu) ios.push({ url: cu, main: isMain, w: toInt(o.width), h: toInt(o.height) });
    }
    for (const k of Object.keys(o).slice(0, 80)) {
      const v = o[k];
      if (k === '@context' || !v || typeof v !== 'object') continue;
      walk(v, depth + 1, k === 'mainEntity');
    }
  };
  for (const r of (roots || []).slice(0, MAX_LD_BLOCKS * 2)) walk(r, 0, false);
  // a VideoObject reached twice (as @graph item and nested) counts once
  const seen = new Set();
  const uniq = vos.filter((v) => { const k = JSON.stringify([v.files.map((f) => f.url), v.players.map((p) => p.url), v.thumb]); if (seen.has(k)) return false; seen.add(k); return true; });
  return { vos: uniq, ios };
}

/* ------------------------------------------------------------------ candidate scoring */

const GENERIC = new Set(['videos', 'thumbnails', 'previews', 'large', 'small', 'horizontal', 'vertical', 'files', 'images', 'media',
  'static', 'system', 'resources', 'watermarked', 'uploads', 'video', 'thumb']);
const SLUG_STOP = new Set([...GENERIC, 'stock', 'free', 'premium', 'footage', 'photo', 'photos', 'image', 'html', 'clip', 'clips',
  'with', 'from', 'that', 'this', 'into', 'over', 'your', 'the', 'and']);
const SIZE_SUFFIX_RE = /(?:[_-](?:\d{2,5}x\d{2,5}|\d{2,4}p?|small|medium|large|thumb|tiny|xl|sm|md|lg|[a-z])|@\dx)+$/i;
function stemsOf(url) {
  const out = [];
  const segs = lower(pathOf(url)).split('/').filter(Boolean);
  segs.forEach((seg, i) => {
    let s = seg;
    if (i === segs.length - 1) s = s.replace(/\.[a-z0-9]{2,5}$/, '').replace(SIZE_SUFFIX_RE, '');
    if (!s || GENERIC.has(s)) return;
    if (/^[0-9a-f-]{8,}$/.test(s) && /[0-9]/.test(s)) out.push(s);
    else if (s.length >= 12 && /[a-z]/.test(s) && /^[a-z0-9._~-]+$/.test(s)) out.push(s);
  });
  return out;
}
function slugTokens(pageUrl) {
  const segs = lower(pathOf(pageUrl)).split('/').filter(Boolean);
  const last = segs.length ? segs[segs.length - 1].replace(/\.[a-z0-9]{2,5}$/, '') : '';
  return [...new Set(last.split(/[^a-z0-9]+/).filter((t) => t.length >= 4 && !/^\d+$/.test(t) && !SLUG_STOP.has(t)))];
}
const VARIANT_PLUS = /(^|[^0-9])(360|480|540|640|720)p?([^0-9]|$)|small|sd_|_tiny|P360|preview|watermark/i;
const VARIANT_MINUS = /uhd|2160|4k|original|hd_1920|_large\./i;
function variantScore(url) {
  const p = lower(pathOf(url)) + lower((() => { try { return new URL(url).search; } catch { return ''; } })());
  return (VARIANT_PLUS.test(p) ? 3 : 0) - (VARIANT_MINUS.test(p) ? 3 : 0);
}
function resolutionOf(url) {
  const m = /(?:^|[^0-9])(144|240|360|392|480|540|576|640|720|960|1080|1280|1440|1920|2160|3840)(?:p|_|-|\.|x|$)/i.exec(lower(pathOf(url)));
  return m ? Number(m[1]) : null;
}

// collected (parseHead [+ scanBody] or collectFromScrape) -> chosen media.
// opts.imageMedia: an adapter says the page's image is the content (Tumblr).
export function extractMedia(collected, pageUrl, opts = {}) {
  const c = collected || {};
  const nowS = opts.nowS || Math.floor(Date.now() / 1000);
  const { vos, ios } = walkLd(c.ld, c, pageUrl);
  const voCount = vos.length;
  const ogType = c.ogType || '';
  const itemId = itemIdOf(pageUrl);
  const mainVos = vos.filter((v) => v.main || voCount === 1);
  const mainIos = ios.filter((i) => i.main || ios.length === 1);
  let image = c.image && !isExpiringUrl(c.image, nowS) ? c.image : null;
  const stemSrc = [image, ...mainVos.map((v) => v.thumb), ...mainIos.map((i) => i.url)].filter(Boolean);
  const stems = [...new Set(stemSrc.flatMap(stemsOf))];
  const tokens = slugTokens(pageUrl);
  const anchors = c.anchors || [];
  const near = (pos) => pos != null && anchors.some((a) => Math.abs(a - pos) <= 2000);

  const cands = [];
  let order = 0;
  const add = (x) => { x.order = order++; cands.push(x); };
  for (const v of c.ogVideos || []) {
    const kind = /^text\/html/.test(v.type || '') ? null : fileKind(v.url, v.type);
    if (kind) add({ url: v.url, kind, src: 'og', base: 100, type: v.type, w: v.w, h: v.h });
    else add({ url: v.url, kind: 'player', src: 'og', base: 100, w: v.w, h: v.h });
  }
  vos.forEach((vo) => {
    for (const f of vo.files) add({ url: f.url, kind: fileKind(f.url, vo.fmt), src: 'ld', base: 90, vo, type: vo.fmt, w: vo.w, h: vo.h });
    for (const p of vo.players) add({ url: p.url, kind: 'player', src: 'ld', base: 90, vo, w: vo.w, h: vo.h });
  });
  if (c.twStream) {
    const kind = fileKind(c.twStream.url, c.twStream.type);
    if (kind) add({ url: c.twStream.url, kind, src: 'stream', base: 80, type: c.twStream.type });
  }
  let firstTag = true;
  for (const t of c.videoTags || []) {
    const kind = fileKind(t.src, t.type);
    if (!kind) continue;
    add({ url: t.src, kind, src: 'html', base: 60, type: t.type, poster: t.poster, w: t.w, h: t.h, pos: t.pos, firstTag });
    firstTag = false;
  }
  for (const i of c.inline || []) {
    const kind = fileKind(i.url, null);
    if (kind) add({ url: i.url, kind, src: 'inline', base: 40, pos: i.pos });
  }
  if (c.twPlayer) add({ url: c.twPlayer.url, kind: 'player', src: 'og', base: 70, w: c.twPlayer.w, h: c.twPlayer.h });
  if (opts.oembedPlayer) add({ url: opts.oembedPlayer, kind: 'player', src: 'oembed', base: 50 });

  for (const x of cands) {
    if (x.kind === 'video' && isExpiringUrl(x.url, nowS)) {
      const st = stableVariantFor(x.url);
      if (st) { x.url = st; x.derived = true; }
    }
    const u = lower(x.url);
    const up = lower(pathOf(x.url));
    let rel = 0;
    if (itemId && u.includes(itemId)) rel += 10;
    if (stems.some((s) => up.includes(s))) rel += 8;
    if (x.vo && (x.vo.main || voCount === 1)) rel += 6;
    if (tokens.filter((t) => u.includes(t)).length >= 2) rel += 4;
    if (near(x.pos)) rel += 3;
    if (x.firstTag && /^video/.test(ogType)) rel += 3;
    x.rel = rel;
    x.main = !!(x.vo && x.vo.main);
    x.pass = x.src === 'og' || x.src === 'ld' || x.src === 'stream' || x.src === 'oembed'
      ? (voCount <= 1 || x.main || rel >= 6)
      : rel >= 6;
    x.variant = x.kind === 'player' ? 0 : variantScore(x.url);
    x.expiring = isExpiringUrl(x.url, nowS);
    if (x.kind === 'player') {
      const p = parseLink(x.url);
      x.embedOk = !!(p && p.embed && p.platform !== 'web' && p.platform !== 'video' && p.platform !== 'image');
      if (x.embedOk) x.playerUrl = p.canonical;
    }
  }
  const files = cands.filter((x) => x.kind !== 'player' && x.pass);
  const rank = (a, b) => (b.variant - a.variant) || ((b.base + b.rel) - (a.base + a.rel)) ||
    (((resolutionOf(a.url) || 99999) - (resolutionOf(b.url) || 99999))) || (a.order - b.order);
  files.sort(rank);
  let media = null, playAtSource = false;
  const best = files.find((x) => !x.expiring) || null;
  if (!best && files.length) playAtSource = true;   // the item's video exists but only as an expiring signed URL
  if (best) {
    const same = cands.filter((x) => x.url === best.url);
    const ogSame = same.find((x) => x.src === 'og' && (x.w || x.h));
    const voSame = best.vo || (same.find((x) => x.vo) || {}).vo || mainVos[0] || null;
    const tagSame = (c.videoTags || []).find((t) => t.src === best.url);
    const pick = (...vals) => { for (const v of vals) if (v != null) return v; return null; };
    let w = null, h = null;
    for (const src of [ogSame, voSame, tagSame, { w: c.imageW, h: c.imageH }]) {
      if (src && dims(src.w) && dims(src.h)) { w = src.w; h = src.h; break; }
    }
    let poster = pick(voSame && voSame.thumb, tagSame && tagSame.poster, best.poster, image);
    if (poster && isExpiringUrl(poster, nowS)) poster = null;
    const vf = variantsFor(best.url);
    const pv = poster ? variantsFor(poster) : {};
    media = {
      mv: MEDIA_V, kind: best.kind, url: vf.url || best.url,
      poster: pv.poster || poster || null,
      ...(vf.small ? { small: vf.small } : {}),
      ...(w && h ? { w, h } : {}),
      ...(mimeFor(best.url, best.kind, best.type) ? { mime: mimeFor(best.url, best.kind, best.type) } : {}),
      autoplay: best.kind === 'video',
      verified: false,
      source: best.src === 'stream' ? 'og' : best.src,
    };
    if (pv.poster && poster && pv.poster !== poster) media._posterFallback = poster;
  } else if (!playAtSource) {
    const players = cands.filter((x) => x.kind === 'player' && x.pass && x.embedOk).sort((a, b) => ((b.base + b.rel) - (a.base + a.rel)) || (a.order - b.order));
    if (players.length) media = { mv: MEDIA_V, kind: 'player', url: players[0].playerUrl, autoplay: false, verified: true, source: players[0].src === 'ld' ? 'ld' : players[0].src === 'oembed' ? 'oembed' : 'og' };
  }

  // Image media: a natural-aspect preview instead of the cropped card visual.
  let imageMedia = null;
  const photoLike = PHOTO_PATH_RE.test(pathOf(pageUrl)) && !!image && (c.imageW == null || c.imageW >= 400);
  const io = mainIos.find((i) => !isExpiringUrl(i.url, nowS) && fileKindImage(i.url));
  if (opts.imageMedia && image) imageMedia = { mv: MEDIA_V, kind: 'image', url: image, ...(dims(c.imageW) && dims(c.imageH) ? { w: c.imageW, h: c.imageH } : {}), autoplay: false, verified: false, source: 'og' };
  else if (io) imageMedia = { mv: MEDIA_V, kind: 'image', url: io.url, ...(dims(io.w) && dims(io.h) ? { w: io.w, h: io.h } : io.url === image && dims(c.imageW) && dims(c.imageH) ? { w: c.imageW, h: c.imageH } : {}), autoplay: false, verified: false, source: 'ld' };
  else if (photoLike) imageMedia = { mv: MEDIA_V, kind: 'image', url: image, ...(dims(c.imageW) && dims(c.imageH) ? { w: c.imageW, h: c.imageH } : {}), autoplay: false, verified: false, source: 'og' };
  if (imageMedia) { const m = mimeFor(imageMedia.url, 'image'); if (m) imageMedia.mime = m; }
  // play at source: no usable file; also the fallback when the chosen file is a derived twin (its probe may fail)
  if (playAtSource || (best && best.derived && !imageMedia)) {
    const exp = playAtSource ? files[0] : best;
    const voSame = exp.vo || mainVos[0] || null;
    let poster = (voSame && voSame.thumb) || exp.poster || image;
    if (poster && isExpiringUrl(poster, nowS)) poster = null;
    if (poster) {
      const pv = variantsFor(poster);
      imageMedia = { mv: MEDIA_V, kind: 'image', url: pv.poster || poster, ...(voSame && dims(voSame.w) && dims(voSame.h) ? { w: voSame.w, h: voSame.h } : {}), autoplay: false, verified: false, play_at_source: true, source: exp.src === 'stream' ? 'og' : exp.src };
    }
  }
  return {
    media, image, imageMedia, playAtSource,
    candidates: cands.map((x) => ({ url: x.url, kind: x.kind, src: x.src, base: x.base, rel: x.rel, variant: x.variant, pass: x.pass, expiring: x.expiring })),
  };
}
function fileKindImage(url) { return mediaKindOf(url) === 'image' || !/\.[a-z0-9]{2,5}$/i.test(pathOf(url)); }

/* ------------------------------------------------------------------ blocks, expiry, variants */

const hdr = (headers, k) => {
  if (!headers) return null;
  if (typeof headers.get === 'function') return headers.get(k);
  for (const key of Object.keys(headers)) if (key.toLowerCase() === k) return headers[key];
  return null;
};
// Bot wall / challenge page? (status + headers before the body; title + small-body markers after the head parse)
export function isBlocked({ status, headers, html, title } = {}) {
  const st = Number(status) || 0;
  if ([401, 403, 429, 503].includes(st)) return true;
  if (lower(hdr(headers, 'cf-mitigated')) === 'challenge') return true;
  if (hdr(headers, 'x-datadome') != null) return true;
  if (st === 202 && hdr(headers, 'x-amzn-waf-action') != null) return true;
  const small = typeof html === 'string' && html.length < 3072;
  if (small && /awswaf/i.test(html)) return true;
  if (title && BLOCK_TITLE_RE.test(title)) return true;
  if (small && /captcha-delivery\.com|challenges\.cloudflare\.com|\/cdn-cgi\/challenge-platform|px-captcha/i.test(html)) return true;
  return false;
}
// Signed URLs that stop working within 7 days are never stored (Freepik token=exp=, S3 presigned, CloudFront Expires/Policy,
// Facebook oe=, Reddit packaged-media). Signatures without expiry (iStock k=20&c=...) are fine.
export function isExpiringUrl(url, nowS = Math.floor(Date.now() / 1000)) {
  let u;
  try { u = new URL(String(url)); } catch { return false; }
  if (u.hostname.toLowerCase() === 'packaged-media.redd.it') return true;
  if (!u.search) return false;
  const limit = nowS + 7 * 86400;
  let q;
  try { q = decodeURIComponent(u.search); } catch { q = u.search; }
  const params = new Map();
  for (const [k, v] of u.searchParams) params.set(k.toLowerCase(), v);
  if (params.has('x-amz-expires')) { const d = Number(params.get('x-amz-expires')); return !Number.isFinite(d) || d < 7 * 86400 + 1; }
  if (params.has('x-amz-date') || params.has('x-amz-signature')) return true;
  if (params.has('policy')) return true;
  const epochs = [];
  const ex = params.get('expires');
  if (ex && /^\d{9,11}$/.test(ex)) epochs.push(Number(ex));
  const exp2 = params.get('expire');
  if (exp2 && /^\d{9,11}$/.test(exp2)) epochs.push(Number(exp2));
  const re = /(?:^|[?&~=;,])exp=(\d{9,11})/gi;
  let m;
  while ((m = re.exec(q))) epochs.push(Number(m[1]));
  const oe = params.get('oe');
  if (oe && /^[0-9a-f]{6,10}$/i.test(oe)) epochs.push(parseInt(oe, 16));
  return epochs.some((e) => e < limit);
}
// An expiring signed video URL with a stable public twin (used instead of it, and probed like any candidate):
// Magnific free videos only list .../previews/clear/large.mp4?token=exp=... (minutes); the same clip is public, watermarked,
// at .../previews/magnific_watermarked/large.mp4 (Phase D acceptance: 206, ACAO *, 7.9 MB). -> url | null
export function stableVariantFor(url) {
  let u;
  try { u = new URL(String(url)); } catch { return null; }
  if (u.hostname.toLowerCase() === 'videocdn.cdnpk.net') {
    const m = /^(\/videos\/[0-9a-f-]{8,64}\/(?:[a-z]+\/)?previews)\/clear\/(?:large|small)\.mp4$/i.exec(u.pathname);
    if (m) return `${u.origin}${m[1]}/magnific_watermarked/large.mp4`;
  }
  return null;
}
// Known CDN variants: {small} (lighter video, must pass a probe), {poster} (poster rewrite), {url} (replacement url).
export function variantsFor(url) {
  let u;
  try { u = new URL(String(url)); } catch { return {}; }
  const host = u.hostname.toLowerCase(), p = u.pathname;
  if (host === 'videocdn.cdnpk.net') {
    if (/\/previews\/[^/]+\/large\.mp4$/.test(p)) return { small: `${u.origin}${p.replace(/large\.mp4$/, 'small.mp4')}` };
    if (/\/thumbnails\/large\.jpg$/.test(p) && !u.search) return { poster: `${u.origin}${p}?w=740&q=80` };
    return {};
  }
  if (host === 'cdn.coverr.co' && /\/1080p\.mp4$/.test(p)) return { small: `${u.origin}${p.replace(/1080p\.mp4$/, '360p.mp4')}` };
  if (host === 'cdn.pixabay.com' && /_(large|medium|small)\.mp4$/.test(p)) return { url: `${u.origin}${p.replace(/_(large|medium|small)\.mp4$/, '_tiny.mp4')}` };
  return {};
}

/* ------------------------------------------------------------------ site adapters */

const GETTY_RE = /^https?:\/\/(?:www\.)?gettyimages\.[a-z.]+\/detail\/(?:[a-z-]+\/)?(?:[^/?#]+\/)?(\d{6,})/i;
const ISTOCK_RE = /^https?:\/\/(?:www\.)?istockphoto\.com\/(?:[a-z]{2}(?:-[a-z]{2})?\/)?(?:photo|vector|illustration|video)\/[^?#]*-gm(\d{6,})-\d+/i;
const ADAPTERS = [
  {
    name: 'shutterstock_video', skipPage: true,
    re: /^https?:\/\/(?:www\.)?shutterstock\.com\/(?:[a-z]{2}(?:-[a-z]{2})?\/)?video\/clip-(\d+)/i,
    pre: (m) => ({ video: [`https://www.shutterstock.com/shutterstock/videos/${m[1]}/preview/stock-footage-x.mp4`], poster: `https://www.shutterstock.com/shutterstock/videos/${m[1]}/thumb/1.jpg` }),
  },
  {
    name: 'shutterstock_image', skipPage: true,
    re: /^https?:\/\/(?:www\.)?shutterstock\.com\/(?:[a-z]{2}(?:-[a-z]{2})?\/)?image-(photo|vector|illustration|generated)\/(?:[^/?#]*-)?(\d{5,})(?:[/?#]|$)/i,
    pre: (m) => ({ image: `https://www.shutterstock.com/image-${m[1].toLowerCase()}/x-600nw-${m[2]}.jpg`, probeImage: true }),
  },
  {
    name: 'dreamstime_video', skipPage: true,
    re: /^https?:\/\/(?:www\.)?dreamstime\.com\/[^?#]*?video(\d{5,})(?:[/?#.]|$)/i,
    pre: (m) => ({ video: [`https://thumbs.dreamstime.com/videothumb_large${m[1].slice(0, -4)}/${m[1]}.mp4`], poster: `https://thumbs.dreamstime.com/b/x-${m[1]}.jpg` }),
  },
  {
    name: 'pexels_photo',
    re: /^https?:\/\/(?:www\.)?pexels\.com\/(?:[a-z]{2}-[a-z]{2}\/)?photo\/(?:[^/?#]*-)?(\d+)\/?(?:[?#]|$)/i,
    pre: (m) => ({ image: `https://images.pexels.com/photos/${m[1]}/pexels-photo-${m[1]}.jpeg?auto=compress&cs=tinysrgb&w=1200` }),
  },
  {
    name: 'mixkit',
    re: /^https?:\/\/(?:www\.)?mixkit\.co\/free-stock-video\/[^/?#]*-(\d+)\/?/i,
    pre: (m) => ({ video: [`https://assets.mixkit.co/videos/${m[1]}/${m[1]}-360.mp4`], poster: `https://assets.mixkit.co/videos/${m[1]}/${m[1]}-thumb-720-0.jpg` }),
  },
  {
    name: 'giphy',
    re: /^https?:\/\/(?:www\.)?giphy\.com\/(?:gifs|stickers|clips)\/(?:[^/?#]*-)?([A-Za-z0-9]{10,})\/?(?:[?#]|$)|^https?:\/\/(?:media\d?|i)\.giphy\.com\/(?:media\/(?:v1\.[^/]+\/)?)?([A-Za-z0-9]{10,})(?:\/|\.)/i,
    pre: (m) => { const id = m[1] || m[2]; return { video: [`https://media.giphy.com/media/${id}/giphy.mp4`], poster: `https://i.giphy.com/${id}.webp` }; },
  },
  {
    name: 'imgur_gifv', skipPage: true,
    re: /^https?:\/\/i\.imgur\.com\/([A-Za-z0-9]{5,8})\.gifv/i,
    pre: (m) => ({ video: [`https://i.imgur.com/${m[1]}.mp4`], poster: `https://i.imgur.com/${m[1]}.jpg` }),
  },
  {
    name: 'reddit', fullPage: true,
    re: /^https?:\/\/(?:(?:www|old|new|np)\.)?reddit\.com\/r\/([A-Za-z0-9_]{2,21})\/comments\/([a-z0-9]{5,10})/i,
    pageUrl: (m) => `https://embed.reddit.com/r/${m[1]}/comments/${m[2]}/?embed=true`,
    extract: extractReddit,
  },
  {
    name: 'behance',
    re: /^https?:\/\/(?:www\.)?behance\.net\/gallery\/(\d+)/i,
    post: (m) => ({ url: `https://www.behance.net/embed/project/${m[1]}?ilo0=1`, type: 'html', maxBytes: MAX_HEAD_BYTES, parse: extractBehance }),
  },
  {
    name: 'getty_photo',
    re: GETTY_RE,
    post: (m) => ({ url: `https://embed.gettyimages.com/oembed?url=${encodeURIComponent('https://www.gettyimages.com/detail/' + m[1])}`, type: 'json', maxBytes: 64 * 1024, parse: gettyOembed }),
  },
  {
    name: 'getty_photo',
    re: ISTOCK_RE,
    post: (m) => ({ url: `https://embed.gettyimages.com/oembed?url=${encodeURIComponent('https://www.gettyimages.com/detail/' + m[1])}`, type: 'json', maxBytes: 64 * 1024, parse: gettyOembed }),
  },
  {
    name: 'tumblr', imageMedia: true,
    re: /^https?:\/\/(?!www\.)([a-z0-9-]+)\.tumblr\.com\/post\/(\d+)/i,
    pageUrl: (m) => `https://www.tumblr.com/${m[1]}/${m[2]}`,
  },
  {
    name: 'tumblr', imageMedia: true,
    re: /^https?:\/\/www\.tumblr\.com\/([a-z0-9-]+)\/(\d{6,})/i,
  },
];
// Adapter for a link, or null: {name, skipPage?, fullPage?, imageMedia?, pageUrl?, pre?, post?, extract?}
//   pre      deterministic media (no page needed): {video?: [urls in probe order], poster?, image?, probeImage?}
//   pageUrl  the page to fetch instead of the link (official embed page / www host)
//   extract  (html) -> {video?: [urls], poster?, image?} from that page (Reddit)
//   post     one extra official fetch when the page gave no media: {url, type:'html'|'json', maxBytes, parse(textOrJson)}
export function adapterFor(url) {
  const s = String(url || '');
  for (const a of ADAPTERS) {
    const m = a.re.exec(s);
    if (!m) continue;
    const out = { name: a.name };
    if (a.skipPage) out.skipPage = true;
    if (a.fullPage) out.fullPage = true;
    if (a.imageMedia) out.imageMedia = true;
    if (a.pre) out.pre = a.pre(m);
    if (a.pageUrl) out.pageUrl = a.pageUrl(m);
    if (a.extract) out.extract = a.extract;
    if (a.post) out.post = a.post(m);
    return out;
  }
  return null;
}
export function extractReddit(html) {
  const t = String(html || '');
  const out = {};
  const v = /https:\/\/v\.redd\.it\/([a-z0-9]{8,16})\//i.exec(t);
  if (v) out.video = ['CMAF_480', 'CMAF_360', 'CMAF_720'].map((q) => `https://v.redd.it/${v[1]}/${q}.mp4`);
  const p = /poster="(https:\/\/external-preview\.redd\.it\/[^"]+)"/i.exec(t);
  if (p) out.poster = absUrl(p[1]);
  const i = /https:\/\/i\.redd\.it\/[a-z0-9]+\.(?:jpe?g|png|gif|webp)/i.exec(t);
  if (i) out.image = i[0];
  const tt = /<title\b[^>]*>([\s\S]*?)<\/title/i.exec(t);
  const title = tt ? inspireMetaText(tt[1], 200) : null;
  if (title && !/^reddit\b/i.test(title)) out.title = title;
  return out;
}
export function extractBehance(html) {
  const t = String(html || '');
  const out = {};
  let best = null, rank = 99;
  const re = /https:\/\/mir-s3-cdn-cf\.behance\.net\/projects\/(max_808|808|404)(?:_webp)?\/[^"'\s\\)]+/gi;
  let m, n = 0;
  while ((m = re.exec(t)) && n < 200) {
    n++;
    const r = { max_808: 0, '808': 1, '404': 2 }[m[1].toLowerCase()];
    const webp = /_webp\//i.test(m[0]) ? 0.5 : 0;
    if (r + webp < rank) { rank = r + webp; best = m[0]; }
  }
  if (best) out.image = absUrl(best);
  const tt = /<title\b[^>]*>([\s\S]*?)<\/title/i.exec(t);
  const title = tt ? inspireMetaText(tt[1].replace(/\s*::\s*Behance\s*$/i, ''), 200) : null;
  if (title) out.title = title;
  return out;
}
function gettyOembed(d) {
  const out = {};
  if (!d || typeof d !== 'object') return out;
  const title = inspireMetaText(d.title, 200);
  if (title) out.title = title;
  const thumb = absUrl(d.thumbnail_url);
  if (thumb) out.thumb = thumb;
  return out;
}
// oEmbed JSON -> {imageMedia?, playerUrl?, thumb?, title?}
export function oembedMedia(d) {
  const out = {};
  if (!d || typeof d !== 'object' || Array.isArray(d)) return out;
  const type = lower(d.type);
  if (type === 'photo') {
    const u = absUrl(d.url);
    if (u && !isSvg(u) && fileKindImage(u)) {
      out.imageMedia = { mv: MEDIA_V, kind: 'image', url: u, ...(dims(toInt(d.width)) && dims(toInt(d.height)) ? { w: toInt(d.width), h: toInt(d.height) } : {}), autoplay: false, verified: false, source: 'oembed' };
    }
  } else if (type === 'video' || type === 'rich') {
    const m = /<iframe\b[^>]*\bsrc\s*=\s*["']([^"']+)["']/i.exec(String(d.html || ''));
    const src = m ? absUrl(m[1], 'https://x.invalid/') : null;
    const p = src ? parseLink(src) : null;
    if (p && p.embed && !['web', 'image', 'video'].includes(p.platform)) out.playerUrl = p.canonical;
  }
  const thumb = absUrl(d.thumbnail_url);
  if (thumb) out.thumb = thumb;
  const title = inspireMetaText(d.title, 200);
  if (title) out.title = title;
  return out;
}
// Same registrable domain (last 2 labels, or 3 when the second-level label has <= 3 chars: com.tr, co.uk).
export function siteOf(host) {
  const labels = lower(host).replace(/\.+$/, '').split('.').filter(Boolean);
  if (labels.length <= 2) return labels.join('.');
  const n = labels[labels.length - 2].length <= 3 && labels.length >= 3 ? 3 : 2;
  return labels.slice(-n).join('.');
}
export function sameSite(a, b) {
  const ha = (() => { try { return new URL(a).hostname; } catch { return a; } })();
  const hb = (() => { try { return new URL(b).hostname; } catch { return b; } })();
  return !!ha && !!hb && siteOf(ha) === siteOf(hb);
}

/* ------------------------------------------------------------------ sanitizer + magic bytes */

function cleanMediaUrl(v, allowFiles, nowS) {
  if (typeof v !== 'string') return null;
  const s = v.trim();
  if (!s || s.length > 2048) return null;
  if (s.startsWith('/')) return allowFiles && FILES_PATH_RE.test(s) ? s : null;
  if (!/^https?:\/\//i.test(s)) return null;
  let u;
  try { u = new URL(s); } catch { return null; }
  if ((u.protocol !== 'https:' && u.protocol !== 'http:') || u.username || u.password) return null;
  if (!/^[a-z0-9._-]+$/i.test(u.hostname) || !u.hostname.includes('.')) return null;
  if (u.href.length > 2048 || isExpiringUrl(u.href, nowS)) return null;
  return u.href;
}
const isSvg = (url) => /\.svgz?$/i.test(pathOf(url.startsWith('/') ? 'https://x.invalid' + url : url));
// Media object -> clean copy (unknown keys dropped) or null. Runs on input AND output.
export function sanitizeMedia(obj, { allowFiles = false, nowS } = {}) {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return null;
  if (!MEDIA_KINDS.has(obj.kind)) return null;
  const url = cleanMediaUrl(obj.url, allowFiles, nowS);
  if (!url || isSvg(url)) return null;
  if (obj.kind === 'player') {
    const p = parseLink(url);
    if (!p || !p.embed) return null;
  }
  const out = { mv: MEDIA_V, kind: obj.kind, url };
  if (obj.kind === 'video' || obj.kind === 'hls') {
    const poster = cleanMediaUrl(obj.poster, allowFiles, nowS);
    out.poster = poster && !isSvg(poster) ? poster : null;
  }
  if (obj.kind === 'video') {
    const small = cleanMediaUrl(obj.small, allowFiles, nowS);
    if (small && !isSvg(small)) out.small = small;
  }
  const clamp = (v) => { const n = Math.round(Number(v)); return Number.isFinite(n) ? Math.min(10000, Math.max(1, n)) : null; };
  if (obj.w != null && obj.h != null) { const w = clamp(obj.w), h = clamp(obj.h); if (w && h) { out.w = w; out.h = h; } }
  if (typeof obj.mime === 'string' && MEDIA_MIMES.has(obj.mime.toLowerCase())) out.mime = obj.mime.toLowerCase();
  if (typeof obj.mime === 'string' && /svg/i.test(obj.mime)) return null;
  const bytes = Number(obj.bytes);
  if (obj.bytes != null && Number.isSafeInteger(bytes) && bytes >= 0) out.bytes = bytes;
  out.autoplay = obj.kind === 'video' ? obj.autoplay !== false && !(out.bytes > AUTOPLAY_MAX_BYTES) : false;
  out.verified = obj.verified === true;
  if (obj.play_at_source === true) out.play_at_source = true;
  if (typeof obj.source === 'string' && SOURCE_RE.test(obj.source)) out.source = obj.source;
  // R2 copy of a platform's post (worker/index.js inspireCopy): credit + caption for the card (plain text, rendered as text)
  if (COPY_SOURCES.has(out.source)) {
    const byRe = out.source === 'instagram' ? COPY_BY_RE.instagram : COPY_BY_RE.other;
    if (typeof obj.by === 'string' && byRe.test(obj.by)) out.by = obj.by;
    const cap = typeof obj.caption === 'string' ? Array.from(obj.caption.replace(/[\u0000-\u0008\u000B-\u001F\u007F\u200E\u200F\u202A-\u202E\u2066-\u2069]/g, '').trim()) : [];
    if (cap.length) out.caption = cap.slice(0, COPY_CAPTION_MAX).join('');
    if (typeof obj.audio === 'boolean') out.audio = obj.audio;
  }
  let json = JSON.stringify(out);
  // a long caption (emoji, quotes and line breaks take 2 JSON characters each) gives way before the media would be lost
  if (json.length > MAX_MEDIA_JSON && out.caption) {
    const cps = Array.from(out.caption);
    let n = cps.length;
    while (json.length > MAX_MEDIA_JSON && n > 0) {
      n = Math.max(0, n - Math.ceil((json.length - MAX_MEDIA_JSON) / 2) - 1);
      if (n) out.caption = cps.slice(0, n).join('').trimEnd() + '…'; else delete out.caption;
      json = JSON.stringify(out);
    }
  }
  return json.length <= MAX_MEDIA_JSON ? out : null;
}
const MP4_BRANDS = new Set(['isom', 'iso2', 'iso4', 'iso5', 'iso6', 'mp41', 'mp42', 'avc1', 'M4V ', 'M4VH', 'M4VP', 'dash', 'MSNV']);
// First bytes of an upload -> {mime, ext, kind} for the allowlist, else null (svg/html/xml/pdf/zip/heic/avif/3gp/short).
export function sniffMagic(bytes) {
  const b = bytes instanceof Uint8Array ? bytes : bytes ? new Uint8Array(bytes) : null;
  if (!b || b.length < 12) return null;
  const ascii = (i, n) => String.fromCharCode(...b.subarray(i, i + n));
  if (b[0] === 0xFF && b[1] === 0xD8 && b[2] === 0xFF) return { mime: 'image/jpeg', ext: 'jpg', kind: 'image' };
  if (b[0] === 0x89 && ascii(1, 3) === 'PNG' && b[4] === 0x0D && b[5] === 0x0A && b[6] === 0x1A && b[7] === 0x0A) return { mime: 'image/png', ext: 'png', kind: 'image' };
  if (ascii(0, 6) === 'GIF87a' || ascii(0, 6) === 'GIF89a') return { mime: 'image/gif', ext: 'gif', kind: 'image' };
  if (ascii(0, 4) === 'RIFF' && ascii(8, 4) === 'WEBP') return { mime: 'image/webp', ext: 'webp', kind: 'image' };
  if (ascii(4, 4) === 'ftyp') {
    const brand = ascii(8, 4);
    if (brand === 'qt  ') return { mime: 'video/quicktime', ext: 'mov', kind: 'video' };
    if (MP4_BRANDS.has(brand)) return { mime: 'video/mp4', ext: 'mp4', kind: 'video' };
    return null;
  }
  if (b[0] === 0x1A && b[1] === 0x45 && b[2] === 0xDF && b[3] === 0xA3 && ascii(0, Math.min(64, b.length)).includes('webm')) return { mime: 'video/webm', ext: 'webm', kind: 'video' };
  return null;
}
