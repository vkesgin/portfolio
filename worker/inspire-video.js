// Fikir Havuzu downloads + Instagram copies (worker/index.js routes /posts/:id/download, /download-info, /ig-copy,
// /ig-blocked and the cron). This module holds the pure helpers (Instagram page/embed parsing, the platform adapters for
// X / Pinterest / TikTok / Facebook / Reddit, filenames, the cheap download hint) and the network pieces that need no D1
// quota logic (Instagram page fetch, adapter fetches, guarded media open, Reddit mux). The D1 cache helpers at the end
// take the database handle; rate limits, quotas and Browser Run admission stay in index.js.
//
// Instagram (verified 2026-10-08, see scratchpad phase-f/ig-feasibility.md): a plain GET of
// https://www.instagram.com/{reel|p|tv}/{code}/ with a desktop Chrome UA and browser navigation headers returns ~0.7-1 MB
// of HTML whose <script type="application/json"> blocks carry the post (xig_polaris_media.if_not_gated_logged_out):
// video_versions (720p progressive MP4 with AAC audio), image_versions2 (poster), original_width/height, has_audio,
// caption, user.username. A mobile UA or missing Sec-Fetch-* headers get an empty shell. CDN links expire (oe= hex
// unix time, 33-107 h), so the board copies the files into R2 instead of linking them.
// Embed check: /{kind}/{code}/embed/ of a reel whose owner disabled embedded playback renders a poster with
// class="WatchOnInstagram" ("Instagram'da İzle") and its gql_data has is_video:true without video_url; playable embeds
// carry video_url. The embed iframe's postMessages (LOADING / MEASURE / MOUNTED) are identical in both cases.
import { sniffMagic } from './inspire-media.js';
import { muxCmafStream, muxedLength } from './cmaf-mux.js';

export const IG_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36';
export const IG_CODE_RE = /^[A-Za-z0-9_-]{5,40}$/;
export const IG_KINDS = new Set(['reel', 'p', 'tv']);
export const IG_PAGE_MAX_BYTES = 3 * 1024 * 1024;
export const IG_EMBED_MAX_BYTES = 1024 * 1024;
export const IG_FETCH_TIMEOUT_MS = 8000;
const ACCEPT_LANG = 'tr-TR,tr;q=0.9,en-US;q=0.8,en;q=0.7';
const CH_UA = '"Chromium";v="141", "Google Chrome";v="141", "Not?A_Brand";v="99"';

// Headers that make www.instagram.com server-render the post (a top-level navigation from the address bar).
export function igNavHeaders() {
  return {
    'User-Agent': IG_UA,
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': ACCEPT_LANG,
    'Sec-Fetch-Mode': 'navigate', 'Sec-Fetch-Dest': 'document', 'Sec-Fetch-Site': 'none', 'Sec-Fetch-User': '?1',
    'Upgrade-Insecure-Requests': '1',
    'sec-ch-ua': CH_UA, 'sec-ch-ua-mobile': '?0', 'sec-ch-ua-platform': '"macOS"',
  };
}
// The embed page as the board's iframe loads it (cross-site iframe navigation from the board origin).
export function igEmbedHeaders(referer) {
  const h = {
    'User-Agent': IG_UA,
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': ACCEPT_LANG,
    'Sec-Fetch-Mode': 'navigate', 'Sec-Fetch-Dest': 'iframe', 'Sec-Fetch-Site': 'cross-site',
    'Upgrade-Insecure-Requests': '1',
    'sec-ch-ua': CH_UA, 'sec-ch-ua-mobile': '?0', 'sec-ch-ua-platform': '"macOS"',
  };
  if (typeof referer === 'string' && /^https:\/\/[a-z0-9.-]+\/?$/i.test(referer)) h.Referer = referer.replace(/\/?$/, '/');
  return h;
}

/* ------------------------------------------------------------------ Instagram: ids */

// parseLink() result -> {code, kind} for an Instagram post/reel/tv link, else null
export function igRef(parsed) {
  if (!parsed || parsed.platform !== 'instagram' || !IG_KINDS.has(parsed.subtype)) return null;
  const code = typeof parsed.id === 'string' ? parsed.id : '';
  return IG_CODE_RE.test(code) ? { code, kind: parsed.subtype } : null;
}
export const igPageUrl = (ref) => `https://www.instagram.com/${ref.kind}/${ref.code}/`;
export const igEmbedUrl = (ref) => `https://www.instagram.com/${ref.kind}/${ref.code}/embed/`;

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
// Media pk of a shortcode (private-post codes are longer: their first 11 characters are the pk)
export function igShortcodeToPk(code) {
  if (typeof code !== 'string' || !IG_CODE_RE.test(code)) return null;
  let n = 0n;
  for (const ch of code.slice(0, 11)) n = n * 64n + BigInt(B64.indexOf(ch));
  return n.toString();
}
// oe= query value (hex unix seconds) of a Meta CDN link -> unix seconds, or null
export function decodeOe(url) {
  try {
    const oe = new URL(url).searchParams.get('oe');
    if (!oe || !/^[0-9a-fA-F]{6,10}$/.test(oe)) return null;
    const s = parseInt(oe, 16);
    return s > 1.5e9 && s < 4.2e9 ? s : null;
  } catch { return null; }
}
// Only Instagram/Facebook CDN files are ever taken from an Instagram page.
export function igCdnUrl(v) {
  if (typeof v !== 'string' || v.length > 4096) return null;
  let u;
  try { u = new URL(v); } catch { return null; }
  if (u.protocol !== 'https:' || u.username || u.password || u.port) return null;
  const h = u.hostname.toLowerCase();
  return /^[a-z0-9.-]+$/.test(h) && /(^|\.)(cdninstagram\.com|fbcdn\.net)$/.test(h) ? u.href : null;
}

/* ------------------------------------------------------------------ Instagram: page parsing */

const int = (v) => { const n = Math.round(Number(v)); return Number.isFinite(n) && n >= 1 && n <= 20000 ? n : null; };
// Text for card captions: no control / bidi-override characters, whitespace runs collapsed, <= max code points.
export function cleanCaption(v, max = 500) {
  if (typeof v !== 'string') return null;
  const s = v.replace(/[\u0000-\u0008\u000B-\u001F\u007F‎‏‪-‮⁦-⁩]/g, '')
    .replace(/[ \t]+/g, ' ').replace(/\s*\n\s*\n\s*/g, '\n\n').trim();
  if (!s) return null;
  const cps = Array.from(s);
  return cps.length > max ? cps.slice(0, max - 1).join('').trimEnd() + '…' : s;
}
function igVideoList(o) {
  const out = [];
  const seen = new Set();
  for (const v of Array.isArray(o && o.video_versions) ? o.video_versions : []) {
    const url = v && igCdnUrl(v.url);
    if (!url || seen.has(url)) continue;
    seen.add(url);
    out.push({ url, w: int(v.width), h: int(v.height), type: Number.isFinite(Number(v.type)) ? Number(v.type) : null });
  }
  return out.sort((a, b) => (b.w || 0) * (b.h || 0) - (a.w || 0) * (a.h || 0));
}
function igImageBest(o) {
  const c = o && o.image_versions2 && Array.isArray(o.image_versions2.candidates) ? o.image_versions2.candidates : [];
  let best = null;
  for (const x of c) {
    const url = x && igCdnUrl(x.url);
    if (!url) continue;
    const w = int(x.width), h = int(x.height);
    if (!best || (w || 0) > (best.w || 0)) best = { url, w, h };
  }
  return best;
}
const hasMedia = (o) => Array.isArray(o.video_versions) || (o.image_versions2 && typeof o.image_versions2 === 'object') || Array.isArray(o.carousel_media);
// The post object: code/shortcode equal to `code` (or, without a code field, pk equal to its pk) and media fields; one
// with video_versions / carousel_media wins over an image-only stub of the same post. Iterative walk with a node budget;
// a timeline of the same user (other codes) never matches.
function igFindItem(root, code, pk) {
  const stack = [root];
  let n = 0, stub = null;
  while (stack.length && n++ < 400000) {
    const o = stack.pop();
    if (!o || typeof o !== 'object') continue;
    if (Array.isArray(o)) { for (let i = o.length - 1; i >= 0; i--) stack.push(o[i]); continue; }
    const c = typeof o.code === 'string' ? o.code : typeof o.shortcode === 'string' ? o.shortcode : null;
    if ((c === code || (c === null && pk && String(o.pk || '') === pk)) && hasMedia(o)) {
      if (Array.isArray(o.video_versions) || Array.isArray(o.carousel_media)) return o;
      if (!stub) stub = o;
    }
    for (const k in o) { const v = o[k]; if (v && typeof v === 'object') stack.push(v); }
  }
  return stub;
}
function igNormalize(item, code) {
  const kids = Array.isArray(item.carousel_media) ? item.carousel_media.filter((k) => k && typeof k === 'object') : [];
  let vsrc = igVideoList(item).length ? item : null;
  if (!vsrc) vsrc = kids.find((k) => igVideoList(k).length) || null;
  const videos = vsrc ? igVideoList(vsrc) : [];
  let image = igImageBest(vsrc || item);
  if (!image) image = igImageBest(item) || (kids.map(igImageBest).find(Boolean) || null);
  if (!videos.length && !image) return null;
  const src = vsrc || item;
  const w = int(src.original_width) || (videos[0] && videos[0].w) || (image && image.w) || null;
  const h = int(src.original_height) || (videos[0] && videos[0].h) || (image && image.h) || null;
  const user = item.user && typeof item.user.username === 'string' && /^[A-Za-z0-9._]{1,30}$/.test(item.user.username) ? item.user.username : null;
  const exps = [videos[0] && decodeOe(videos[0].url), image && decodeOe(image.url)].filter(Boolean);
  const dur = Number(src.video_duration);
  return {
    code, user,
    caption: cleanCaption(item.caption && typeof item.caption === 'object' ? item.caption.text : null),
    has_audio: src.has_audio === true ? true : src.has_audio === false ? false : null,
    w: w && h ? w : null, h: w && h ? h : null,
    duration: Number.isFinite(dur) && dur > 0 ? Math.round(dur * 10) / 10 : null,
    media_type: Number.isFinite(Number(item.media_type)) ? Number(item.media_type) : null,
    product_type: typeof item.product_type === 'string' ? item.product_type.slice(0, 40) : null,
    video: videos[0] || null, videos, image,
    expires_at: exps.length ? Math.min(...exps) : null,
  };
}
// Reel/post page HTML -> normalized item {code, user, caption, has_audio, w, h, duration, video: {url,w,h}|null,
// videos: [...best first], image: {url,w,h}|null, expires_at} or null. Only <script> blocks that contain
// "video_versions" / "image_versions2" and the code (or pk) are JSON-parsed (one ~45 KB block on a 0.7-1 MB page).
export function igExtract(html, code, { maxBlocks = 40, maxParseBytes = 4 * 1024 * 1024 } = {}) {
  if (typeof html !== 'string' || !html || typeof code !== 'string' || !IG_CODE_RE.test(code)) return null;
  const pk = igShortcodeToPk(code);
  const seen = new Set();
  let parsedBytes = 0, fallback = null;
  for (const needle of ['"video_versions"', '"image_versions2"', '"carousel_media"']) {
    let i = html.indexOf(needle);
    while (i !== -1 && seen.size < maxBlocks) {
      const s = html.lastIndexOf('<script', i);
      const gt = s === -1 ? -1 : html.indexOf('>', s);
      const e = html.indexOf('</script', i);
      if (s === -1 || gt === -1 || gt > i || e === -1) break;
      if (!seen.has(s)) {
        seen.add(s);
        const text = html.slice(gt + 1, e);
        parsedBytes += text.length;
        if (parsedBytes > maxParseBytes) return fallback;
        if (text.includes(code) || (pk && text.includes(pk))) {
          let root = null;
          try { root = JSON.parse(text); } catch { root = null; }
          const item = root && igFindItem(root, code, pk);
          const out = item && igNormalize(item, code);
          if (out && out.video) return out;
          if (out && !fallback) fallback = out;
        }
      }
      i = html.indexOf(needle, e);
    }
  }
  return fallback;
}
// Login wall / challenge / empty shell (no post data): what went wrong, for the error code.
export function igPageProblem(html) {
  if (typeof html !== 'string' || !html) return 'empty';
  const title = ((/<title[^>]*>([^<]*)/i.exec(html) || [])[1] || '').trim().toLowerCase();
  if (/challenge|checkpoint|captcha/.test(title)) return 'challenge';
  if (html.includes('"if_not_gated_logged_out":null')) return 'gated';
  if (/id="loginForm"|name="username"/.test(html)) return 'login';
  return 'no_data';
}
// Embed page HTML -> 'blocked' (poster + "Instagram'da İzle": owner disabled embedded playback) | 'ok' (plays in the
// embed) | 'photo' (not a video) | 'unknown'. gql_data sits in an escaped JS string (\"is_video\":true).
export function igEmbedStatus(html) {
  if (typeof html !== 'string' || !html) return 'unknown';
  const ui = /class="WatchOnInstagram(?:Container)?"/.test(html);
  const isVideo = /\\*"is_video\\*"\s*:\s*(true|false)/.exec(html);
  const hasUrl = /\\*"video_url\\*"\s*:\s*\\*"https?:/.test(html);
  if (ui) return 'blocked';
  if (isVideo && isVideo[1] === 'true') return hasUrl ? 'ok' : 'blocked';
  if (isVideo && isVideo[1] === 'false') return 'photo';
  return 'unknown';
}

/* ------------------------------------------------------------------ Instagram: network */

async function readCapped(res, maxBytes) {
  if (!res.body) return '';
  const reader = res.body.getReader();
  const chunks = [];
  let total = 0;
  try {
    while (total < maxBytes) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      total += value.byteLength;
    }
  } finally { reader.cancel().catch(() => {}); }
  const buf = new Uint8Array(Math.min(total, maxBytes));
  let off = 0;
  for (const c of chunks) {
    const take = Math.min(c.byteLength, buf.length - off);
    buf.set(c.subarray(0, take), off);
    off += take;
    if (off >= buf.length) break;
  }
  return new TextDecoder('utf-8').decode(buf);
}
// One GET of a fixed www.instagram.com URL (redirect manual: any 3xx is a login/consent redirect, never followed).
// -> {ok: true, html, status} | {ok: false, error: 'http_<n>'|'redirect'|'not_html'|'timeout'|'fetch_error', status?}
export async function igFetchHtml(url, headers, { fetchImpl = fetch, timeoutMs = IG_FETCH_TIMEOUT_MS, maxBytes = IG_PAGE_MAX_BYTES } = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetchImpl(url, { method: 'GET', redirect: 'manual', signal: ctrl.signal, headers });
    if (res.status >= 300 && res.status < 400) { try { res.body && res.body.cancel(); } catch (e) {} return { ok: false, error: 'redirect', status: res.status }; }
    if (res.status !== 200) { try { res.body && res.body.cancel(); } catch (e) {} return { ok: false, error: 'http_' + res.status, status: res.status }; }
    const ct = (res.headers.get('Content-Type') || '').toLowerCase();
    if (!ct.includes('html')) { try { res.body && res.body.cancel(); } catch (e) {} return { ok: false, error: 'not_html', status: 200 }; }
    return { ok: true, html: await readCapped(res, maxBytes), status: 200 };
  } catch (e) {
    return { ok: false, error: ctrl.signal.aborted ? 'timeout' : 'fetch_error' };
  } finally {
    clearTimeout(timer);
  }
}
// Resolve an Instagram post to its media. Plain fetch first; Browser Run (Quick Action `content`) only through
// opts.brContent(url) -> html | null (failed / unavailable) | {refused: true, retry_s, site} (not admitted right now: the
// Browser Run slot or a budget), which index.js passes when FIKIR_BR is on and admits it under the Browser Run quotas.
// Never loops: at most one plain fetch + one Browser Run call.
// -> {ok: true, item, via: 'plain'|'br'} | {ok: false, error, status?, retry: 'soon'|'later'|'gone'}
//    | {ok: false, error: 'busy', busy: true, retry_s, site, status?}: Browser Run was needed but refused. Not a
//      failure of the post: callers must not record it (no backoff); `site` = refused for every post, not just this one.
export async function igResolve(ref, { fetchImpl = fetch, brContent = null, timeoutMs = IG_FETCH_TIMEOUT_MS } = {}) {
  if (!ref || !IG_CODE_RE.test(ref.code || '') || !IG_KINDS.has(ref.kind)) return { ok: false, error: 'bad_ref', retry: 'gone' };
  const url = igPageUrl(ref);
  const page = await igFetchHtml(url, igNavHeaders(), { fetchImpl, timeoutMs });
  if (page.ok) {
    const item = igExtract(page.html, ref.code);
    if (item) return { ok: true, item, via: 'plain' };
  }
  let error = page.ok ? igPageProblem(page.html) : page.error;
  if (page.status === 404 || page.status === 410) return { ok: false, error: 'gone', status: page.status, retry: 'gone' };
  if (typeof brContent === 'function') {
    let html = null;
    try { html = await brContent(url); } catch (e) { html = null; }
    if (html && typeof html === 'object' && html.refused) {
      return { ok: false, error: 'busy', busy: true, retry_s: Math.max(1, Number(html.retry_s) || 60), site: html.site !== false, status: page.status };
    }
    if (typeof html === 'string' && html) {
      const item = igExtract(html, ref.code);
      if (item) return { ok: true, item, via: 'br' };
      error = 'br_' + igPageProblem(html);
    }
  }
  return { ok: false, error, status: page.status, retry: error === 'gated' ? 'later' : 'soon' };
}
// Embed status of one post (one ~250 KB GET of the embed page). -> {status: 'blocked'|'ok'|'photo'|'unknown', error?}
export async function igCheckEmbed(ref, { fetchImpl = fetch, referer = null, timeoutMs = IG_FETCH_TIMEOUT_MS } = {}) {
  if (!ref) return { status: 'unknown', error: 'bad_ref' };
  const page = await igFetchHtml(igEmbedUrl(ref), igEmbedHeaders(referer), { fetchImpl, timeoutMs, maxBytes: IG_EMBED_MAX_BYTES });
  if (!page.ok) return { status: 'unknown', error: page.error, http: page.status || null };
  return { status: igEmbedStatus(page.html) };
}

/* ------------------------------------------------------------------ guarded media open (download + R2 copy) */

const VIDEO_ACCEPT = 'video/mp4,video/webm,video/*;q=0.9,*/*;q=0.5';
const IMAGE_ACCEPT = 'image/avif,image/webp,image/jpeg,image/png,image/*;q=0.9,*/*;q=0.5';
function concatBytes(a, b) {
  const out = new Uint8Array(a.byteLength + b.byteLength);
  out.set(a, 0); out.set(b, a.byteLength);
  return out;
}
// Pull-based stream: the sniffed head, then the rest of `reader`; errors once more than `limit` bytes arrive (or, with a
// known length, when the total differs from it). Cancelling it cancels the upstream body.
export function cappedStream(head, reader, { length = null, limit, onEnd = null } = {}) {
  let sent = 0, first = true, ended = false;
  const end = () => { if (!ended) { ended = true; if (onEnd) try { onEnd(); } catch (e) {} } };
  const max = length != null ? Math.min(length, limit) : limit;
  return new ReadableStream({
    async pull(controller) {
      try {
        if (first) {
          first = false;
          if (head.byteLength) { sent += head.byteLength; if (sent > max) throw new Error('upstream longer than allowed'); controller.enqueue(head); return; }
        }
        const { done, value } = await reader.read();
        if (done) {
          if (length != null && sent !== length) throw new Error('upstream shorter than Content-Length');
          end(); controller.close(); return;
        }
        sent += value.byteLength;
        if (sent > max) throw new Error('upstream longer than allowed');
        controller.enqueue(value);
      } catch (e) {
        end();
        reader.cancel().catch(() => {});
        controller.error(e);
      }
    },
    cancel(reason) { end(); return reader.cancel(reason).catch(() => {}); },
  });
}
// Extra request headers a platform's CDN needs (TikTok: Referer + its anonymous tt_chain_token cookie). Only these names
// pass; they go to the first URL's host only (dropped on a redirect to another host) and never back to the client.
const EXTRA_HEADER_NAMES = new Set(['referer', 'cookie', 'origin']);
export function extraHeaders(h) {
  const out = {};
  if (!h || typeof h !== 'object') return out;
  for (const [k, v] of Object.entries(h)) {
    if (EXTRA_HEADER_NAMES.has(String(k).toLowerCase()) && typeof v === 'string' && v.length <= 4096 && !/[\r\n\0]/.test(v)) out[k] = v;
  }
  return out;
}
// GET a media file for download/copy: SSRF guard (deps.safeURL) on every hop, <= 3 redirects, headers within
// timeoutMs, whole transfer within totalMs, size <= maxBytes, and the first bytes must sniff as `want` (video|image).
// headers: see extraHeaders() (sent to the first URL's host only).
// -> {ok: true, body: ReadableStream, length: n|null, fixed (body already a FixedLengthStream), mime, ext, finalUrl}
//  | {ok: false, error: 'unsafe'|'redirects'|'gone'|'upstream_<n>'|'not_media'|'too_large'|'empty'|'timeout'|'fetch_error'}
export async function openMedia(href, { want, maxBytes, safeURL, fetchImpl = fetch, userAgent = IG_UA, timeoutMs = 10000, totalMs = 15 * 60e3, headers = null } = {}) {
  if (want !== 'video' && want !== 'image') return { ok: false, error: 'bad_request' };
  const ctrl = new AbortController();
  const total = setTimeout(() => ctrl.abort(), totalMs);
  const headersTimer = setTimeout(() => ctrl.abort(), timeoutMs);
  if (total && typeof total.unref === 'function') total.unref();   // Node (tests): an unread body must not keep the process alive
  let handedOff = false;
  const fail = (error, status) => ({ ok: false, error, ...(status ? { status } : {}) });
  const extra = extraHeaders(headers);
  let current = href, firstHost = null;
  try {
    let res = null;
    for (let hop = 0; ; hop++) {
      const u = typeof safeURL === 'function' ? safeURL(current) : null;
      if (!u) return fail('unsafe');
      if (hop === 0) firstHost = u.host;
      res = await fetchImpl(u.href, {
        method: 'GET', redirect: 'manual', signal: ctrl.signal,
        headers: { 'User-Agent': userAgent, 'Accept': want === 'video' ? VIDEO_ACCEPT : IMAGE_ACCEPT, 'Accept-Encoding': 'identity', ...(u.host === firstHost ? extra : {}) },
      });
      const loc = res.status >= 300 && res.status < 400 ? res.headers.get('Location') : null;
      if (!loc) { current = u.href; break; }
      try { res.body && res.body.cancel(); } catch (e) {}
      if (hop >= 3) return fail('redirects');
      current = new URL(loc, u.href).href;
    }
    clearTimeout(headersTimer);
    if (res.status !== 200) {
      try { res.body && res.body.cancel(); } catch (e) {}
      return fail(res.status === 404 || res.status === 410 ? 'gone' : 'upstream_' + res.status, res.status);
    }
    const ct = (res.headers.get('Content-Type') || '').toLowerCase();
    if (/svg|html|xml|json|javascript|text\//.test(ct) || !res.body) { try { res.body && res.body.cancel(); } catch (e) {} return fail('not_media'); }
    const lenH = res.headers.get('Content-Length');
    const length = !res.headers.get('Content-Encoding') && lenH && /^\d{1,12}$/.test(lenH.trim()) ? Number(lenH) : null;
    if (length === 0) { try { res.body.cancel(); } catch (e) {} return fail('empty'); }
    if (length != null && length > maxBytes) { try { res.body.cancel(); } catch (e) {} return fail('too_large'); }
    const reader = res.body.getReader();
    let head = new Uint8Array(0);
    while (head.byteLength < 64) {
      const { done, value } = await reader.read();
      if (done) break;
      head = concatBytes(head, value);
    }
    const sniff = sniffMagic(head.subarray(0, 64));
    if (!sniff || sniff.kind !== want) { reader.cancel().catch(() => {}); return fail(head.byteLength ? 'not_media' : 'empty'); }
    if (length != null && head.byteLength > length) { reader.cancel().catch(() => {}); return fail('not_media'); }
    handedOff = true;
    if (length != null && typeof FixedLengthStream === 'function') {
      // Workers: the sniffed head, then the rest of the upstream body piped natively (no JS per chunk: large files stay
      // cheap on CPU). FixedLengthStream errors on a short or long body and gives the response its Content-Length.
      reader.releaseLock();
      const fixed = new FixedLengthStream(length);
      (async () => {
        const w = fixed.writable.getWriter();
        await w.write(head);
        w.releaseLock();
        await res.body.pipeTo(fixed.writable);
      })().catch(() => {}).finally(() => clearTimeout(total));
      return { ok: true, body: fixed.readable, length, fixed: true, mime: sniff.mime, ext: sniff.ext, finalUrl: current };
    }
    const body = cappedStream(head, reader, { length, limit: maxBytes, onEnd: () => clearTimeout(total) });
    return { ok: true, body, length, fixed: false, mime: sniff.mime, ext: sniff.ext, finalUrl: current };
  } catch (e) {
    return fail(ctrl.signal.aborted ? 'timeout' : 'fetch_error');
  } finally {
    clearTimeout(headersTimer);
    if (!handedOff) clearTimeout(total);
  }
}

/* ------------------------------------------------------------------ filenames */

const TR_ASCII = { 'ç': 'c', 'Ç': 'C', 'ğ': 'g', 'Ğ': 'G', 'ı': 'i', 'İ': 'I', 'ö': 'o', 'Ö': 'O', 'ş': 's', 'Ş': 'S', 'ü': 'u', 'Ü': 'U' };
const clip = (s, n) => Array.from(s).slice(0, n).join('');
const tidy = (s) => s.replace(/-{2,}/g, '-').replace(/^[-.]+|[-.]+$/g, '');
// ASCII part of a filename: Turkish letters transliterated, other accents dropped, anything else -> '-'
export function asciiFilePart(v) {
  return tidy(String(v == null ? '' : v).replace(/[çÇğĞıİöÖşŞüÜ]/g, (c) => TR_ASCII[c]).normalize('NFKD')
    .replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9._-]+/g, '-'));
}
// Unicode part (filename*): letters/digits of any script kept, everything else -> '-'
export function unicodeFilePart(v) {
  return tidy(String(v == null ? '' : v).normalize('NFC').replace(/[^\p{L}\p{N}._-]+/gu, '-'));
}
const EXT_RE = /^(mp4|webm|mov|jpg|png|webp|gif)$/;
// parts (e.g. ['instagram', user, code]) + ext -> {ascii, utf8} file names (<= 100 characters, never empty)
export function dlFilename(parts, ext) {
  const e = EXT_RE.test(ext) ? ext : 'bin';
  const list = (Array.isArray(parts) ? parts : [parts]).filter((p) => p != null && p !== '');
  const a = tidy(list.map(asciiFilePart).filter(Boolean).join('-')) || 'fikir';
  const u = tidy(list.map(unicodeFilePart).filter(Boolean).join('-')) || a;
  return { ascii: `${tidy(clip(a, 90)) || 'fikir'}.${e}`, utf8: `${tidy(clip(u, 90)) || 'fikir'}.${e}` };
}
// RFC 6266 / 5987: ASCII fallback + UTF-8 name (Turkish letters intact in browsers that read filename*)
export function contentDisposition(parts, ext) {
  const { ascii, utf8 } = dlFilename(parts, ext);
  const enc = encodeURIComponent(utf8).replace(/['()*]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase());
  return `attachment; filename="${ascii}"; filename*=UTF-8''${enc}`;
}
// Short title for a filename: first words of the title/description (<= 40 chars)
export function titleSlug(v) {
  const s = typeof v === 'string' ? v.replace(/\s+/g, ' ').trim() : '';
  if (!s) return '';
  const words = s.split(' ');
  let out = '';
  for (const w of words) { if (Array.from(out + ' ' + w).length > 40) break; out = out ? out + ' ' + w : w; }
  return out || clip(s, 40);
}

/* ------------------------------------------------------------------ platform adapters (other platforms' videos) */

// Verified 2026-10-08 from a Mac and from Cloudflare (AMS/FRA/LHR), logged out (phase-g): X (syndication JSON that embeds
// use), Pinterest (PinResource JSON; idea pins through the progressive file next to their HLS playlist), TikTok
// (logged-out page; its CDN wants the Referer + the anonymous tt_chain_token cookie that the same page response sets),
// Facebook (public videos / reels: page JSON) and Reddit (post RSS + v.redd.it DASH: picture and sound are two CMAF
// files, joined by worker/cmaf-mux.js). Not downloadable: YouTube (ciphered / SABR-only streams, bot checks on
// Cloudflare IPs, ToS) and Vimeo (DRM-encrypted HLS/DASH, no progressive files); their adapters answer without a request.
//
// Adapter: {name, support: true|false, reason (support false), match(parsed) -> bool, hint: {video, image},
//   async resolve(parsed, deps) -> AdResult, feed?(parsed, deps) -> bool (Reddit: the resolve reads the rate-limited
//   post feed)}; deps = {fetchImpl, timeoutMs, maxShort, preview: {video, image} (the post's link-preview media URLs)}.
// AdResult: {ok: true, id, by, title, duration, video: AdVideo|null, image: {url}|null}
//         | {ok: false, reason, retry: 'soon'|'gone', image: {url}|null, id?, by?}
//   AdVideo: {url, w, h, bytes, audio: bool|null, expires_at: unix s|null,
//             headers?: {Referer, Cookie} (TikTok), private?: true (headers carry a cookie: never cached, never sent to a
//             browser), audio_url?, mux?: 'cmaf' (Reddit: openMuxed)}
//   reason: no_video | not_found | login_required | drm | not_supported | bad_input (retry 'gone') |
//           blocked | upstream | parse_failed (retry 'soon')
// Every media URL in a result passed adMediaUrl() (https, the platform's own CDN hosts): a second line behind the
// route's SSRF guard.
const AD_LANG = 'en-US,en;q=0.9,tr;q=0.8';
export const adNavHeaders = () => ({ ...igNavHeaders(), 'Accept-Language': AD_LANG });
export const AD_MEDIA_HOSTS = {
  x: /^(video\.twimg\.com|pbs\.twimg\.com)$/,
  pinterest: /^(v1\.pinimg\.com|i\.pinimg\.com)$/,
  tiktok: /^([a-z0-9-]+\.tiktok\.com|[a-z0-9-]+\.tiktokcdn(-[a-z]+)?\.com|[a-z0-9-]+\.tiktokv\.com|[a-z0-9-]+\.byteoversea\.com|[a-z0-9-]+\.ibyteimg\.com)$/,
  facebook: /^([a-z0-9-]+\.)+fbcdn\.net$/,
  reddit: /^(v\.redd\.it|i\.redd\.it|preview\.redd\.it|external-preview\.redd\.it|i\.imgur\.com)$/,
  youtube: /^i\.ytimg\.com$/,
};
export function adMediaUrl(name, v) {
  if (typeof v !== 'string' || v.length > 4096) return null;
  let u;
  try { u = new URL(v); } catch { return null; }
  const re = AD_MEDIA_HOSTS[name];
  return re && u.protocol === 'https:' && !u.username && !u.password && !u.port && re.test(u.hostname.toLowerCase()) ? u.href : null;
}
// Expiry of a signed CDN link (oe= hex, expire= / x-expires= unix seconds) -> unix seconds | null
export function urlExpiry(v) {
  const oe = decodeOe(v);
  if (oe) return oe;
  try {
    const q = new URL(v).searchParams;
    for (const k of ['expire', 'x-expires', 'expires']) {
      const s = q.get(k);
      if (s && /^\d{9,11}$/.test(s) && Number(s) > 1.5e9 && Number(s) < 4.2e9) return Number(s);
    }
  } catch (e) {}
  return null;
}
const AD_GONE = new Set(['no_video', 'not_found', 'login_required', 'drm', 'not_supported', 'bad_input']);
export const adFail = (reason, extra = {}) => ({ ok: false, reason, retry: AD_GONE.has(reason) ? 'gone' : 'soon', image: null, ...extra });
const adOk = (f) => ({ ok: true, id: null, by: null, title: null, duration: null, video: null, image: null, ...f });
const adImg = (name, v) => { const u = adMediaUrl(name, v); return u ? { url: u } : null; };
const pos = (v) => { const n = Number(v); return Number.isFinite(n) && n > 0 ? n : null; };
// Best rendition: largest whose short side is <= maxShort (720p / 1080p in either orientation), then bitrate; else the smallest
function pickBest(list, maxShort = 1080) {
  const short = (v) => (v.w && v.h ? Math.min(v.w, v.h) : v.h || v.w || 0);
  const key = (v) => (v.w || 0) * (v.h || 0) * 1e4 + (v.bitrate || 0) / 1e3;
  const ok = list.filter((v) => short(v) <= maxShort).sort((a, b) => key(b) - key(a));
  return ok[0] || list.slice().sort((a, b) => key(a) - key(b))[0] || null;
}
// GET / HEAD of a platform's own page or API: redirect manual, followed (<= 2 hops) only to https URLs on `hosts`; the
// body (<= maxBytes) is read inside the timeout. -> {ok: true, status, headers, url, text, setCookies}
//  | {ok: false, error: 'redirect' (to another host; location) | 'timeout' | 'fetch_error'}
async function adFetch(deps, url, { headers = {}, method = 'GET', hosts, maxBytes = 3 << 20 }) {
  const f = deps.fetchImpl || fetch;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), deps.timeoutMs || IG_FETCH_TIMEOUT_MS);
  const setCookies = [];
  let current = url;
  try {
    for (let hop = 0; hop <= 2; hop++) {
      const u = new URL(current);
      if (u.protocol !== 'https:' || u.username || u.password || u.port || !hosts.test(u.hostname.toLowerCase())) {
        return { ok: false, error: 'redirect', location: u.href.slice(0, 300) };
      }
      const res = await f(u.href, { method, redirect: 'manual', signal: ctrl.signal, headers });
      setCookies.push(...setCookieList(res.headers));
      const loc = res.status >= 300 && res.status < 400 ? res.headers.get('Location') : null;
      if (loc || method === 'HEAD') { try { res.body && res.body.cancel(); } catch (e) {} }
      if (loc) { current = new URL(loc, u.href).href; continue; }
      const text = method === 'HEAD' ? '' : await readCapped(res, maxBytes);
      return { ok: true, status: res.status, headers: res.headers, url: u.href, text, setCookies };
    }
    return { ok: false, error: 'redirect', location: String(current).slice(0, 300) };
  } catch (e) {
    return { ok: false, error: ctrl.signal.aborted ? 'timeout' : 'fetch_error' };
  } finally {
    clearTimeout(timer);
  }
}
function setCookieList(h) {
  try {
    if (typeof h.getSetCookie === 'function') return h.getSetCookie();
    if (typeof h.getAll === 'function') return h.getAll('Set-Cookie');
    const one = h.get('Set-Cookie');
    return one ? one.split(/,(?=\s*[A-Za-z0-9_-]+=)/) : [];
  } catch (e) { return []; }
}
// JSON of the <script> blocks that contain `needle` (only those are parsed: pages are 0.5-2 MB)
function* scriptJson(html, needle, { max = 40, maxParseBytes = 4 << 20 } = {}) {
  let i = html.indexOf(needle), n = 0, parsed = 0;
  while (i !== -1 && n++ < max) {
    const s = html.lastIndexOf('<script', i);
    const gt = s === -1 ? -1 : html.indexOf('>', s);
    const e = html.indexOf('</script', i);
    if (s === -1 || gt === -1 || gt > i || e === -1) return;
    const text = html.slice(gt + 1, e);
    parsed += text.length;
    if (parsed > maxParseBytes) return;
    let j = null;
    try { j = JSON.parse(text); } catch { j = null; }
    if (j && typeof j === 'object') yield j;
    i = html.indexOf(needle, e);
  }
}
// Objects matching pred (depth first, node budget)
function findObjs(root, pred, { max = 1, limit = 300000 } = {}) {
  const out = [];
  const stack = [root];
  let n = 0;
  while (stack.length && n++ < limit && out.length < max) {
    const o = stack.pop();
    if (!o || typeof o !== 'object') continue;
    if (Array.isArray(o)) { for (let i = o.length - 1; i >= 0; i--) stack.push(o[i]); continue; }
    if (pred(o)) out.push(o);
    for (const k in o) { const v = o[k]; if (v && typeof v === 'object') stack.push(v); }
  }
  return out;
}

// X / Twitter: GET https://cdn.syndication.twimg.com/tweet-result?id=<id>&lang=en&token=<xToken(id)> -> mediaDetails[]
// (video / animated_gif: video_info.variants[] video/mp4 on video.twimg.com, H.264 + AAC, no expiry, no Referer/cookie).
const X_ID_RE = /^\d{1,20}$/;
export const xToken = (id) => ((Number(id) / 1e15) * Math.PI).toString(36).replace(/(0+|\.)/g, '');
export const xSyndicationUrl = (id) => `https://cdn.syndication.twimg.com/tweet-result?id=${id}&lang=en&token=${xToken(id)}`;
export function xParse(j, id, { maxShort = 1080 } = {}) {
  if (!j || typeof j !== 'object' || !Object.keys(j).length) return adFail('not_found');
  if (j.__typename === 'TweetTombstone') return adFail('login_required');   // age-restricted / protected / removed
  const by = j.user && /^[A-Za-z0-9_]{1,15}$/.test(String(j.user.screen_name || '')) ? j.user.screen_name : null;
  const tid = X_ID_RE.test(String(j.id_str || '')) ? String(j.id_str) : id;
  const list = (d) => (Array.isArray(d) ? d.filter((m) => m && typeof m === 'object') : []);
  const isVid = (m) => m.type === 'video' || m.type === 'animated_gif';
  let medias = list(j.mediaDetails).filter(isVid);
  if (!medias.length && j.quoted_tweet && typeof j.quoted_tweet === 'object') medias = list(j.quoted_tweet.mediaDetails).filter(isVid);
  const photo = list(j.mediaDetails).find((m) => m.type === 'photo');
  if (!medias.length) return adFail('no_video', { id: tid, by, image: photo ? adImg('x', photo.media_url_https) : null });
  const m = medias[0];
  const gif = m.type === 'animated_gif';
  const vi = m.video_info && typeof m.video_info === 'object' ? m.video_info : {};
  const vs = list(vi.variants).filter((v) => v.content_type === 'video/mp4').map((v) => {
    const d = /\/vid\/(?:[a-z0-9]+\/)?(\d{2,5})x(\d{2,5})\//.exec(String(v.url || ''));
    return { url: adMediaUrl('x', v.url), w: d ? int(d[1]) : null, h: d ? int(d[2]) : null, bitrate: pos(v.bitrate) || 0 };
  }).filter((v) => v.url);
  if (vs.length === 1 && !vs[0].h && m.original_info) { vs[0].w = int(m.original_info.width); vs[0].h = int(m.original_info.height); }
  const poster = adImg('x', m.media_url_https);
  if (!vs.length) return adFail('no_video', { id: tid, by, image: poster });   // HLS only (live / broadcast)
  const best = pickBest(vs, maxShort);
  const ms = pos(vi.duration_millis);
  return adOk({
    id: tid, by, title: cleanCaption(j.text, 140), duration: ms ? Math.round(ms / 100) / 10 : null, image: poster,
    video: { url: best.url, w: best.w, h: best.h, bytes: null, audio: !gif, expires_at: null },
  });
}
const X_ADAPTER = {
  name: 'x', support: true, hint: { video: null, image: null },
  match: (p) => p.platform === 'x' && p.subtype === 'post' && X_ID_RE.test(String(p.id || '')),
  async resolve(p, deps = {}) {
    const r = await adFetch(deps, xSyndicationUrl(p.id), { headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'application/json' }, hosts: /^cdn\.syndication\.twimg\.com$/, maxBytes: 1 << 20 });
    if (!r.ok) return adFail('upstream');
    if (r.status === 404) return adFail('not_found');
    if (r.status !== 200) return adFail(r.status === 429 || r.status === 403 ? 'blocked' : 'upstream');
    let j;
    try { j = JSON.parse(r.text); } catch { return adFail('parse_failed'); }
    return xParse(j, p.id, deps);
  },
};

// Pinterest: PinResource JSON (no login, ~15 KB) -> videos.video_list.V_720P (mp4) or, for idea/story pins,
// story_pin_data...video_list (HLS only) -> the progressive file next to the playlist, HEAD-checked (v1.pinimg.com answers
// 403 for missing ones). Files: H.264 + AAC, no expiry, no Referer/cookie.
const PIN_ID_RE = /^\d{5,25}$/;
const PIN_HOSTS = /^([a-z]{2}\.|www\.)?pinterest\.com$/;
const PIN_MP4_RANK = ['V_720P', 'V_EXP7', 'V_EXP6', 'V_EXP5', 'V_EXP4', 'V_EXP3'];
export function pinResourceUrl(id) {
  const data = JSON.stringify({ options: { id: String(id), field_set_key: 'detailed' }, context: {} });
  return `https://www.pinterest.com/resource/PinResource/get/?source_url=${encodeURIComponent(`/pin/${id}/`)}&data=${encodeURIComponent(data)}`;
}
const pinHeaders = () => ({ 'User-Agent': IG_UA, 'Accept': 'application/json, text/javascript, */*; q=0.01', 'X-Requested-With': 'XMLHttpRequest', 'X-Pinterest-PWS-Handler': 'www/pin/[id].js' });
// PinResource JSON -> {mp4s: [{url, w, h}], hls: [url], duration, image, title, by} | null
export function pinParse(j) {
  const data = j && j.resource_response && j.resource_response.data;
  if (!data || typeof data !== 'object') return null;
  const mp4s = [], hls = [];
  let duration = null, thumb = null;
  for (const o of findObjs(data, (x) => x.video_list && typeof x.video_list === 'object', { max: 50 })) {
    for (const [k, v] of Object.entries(o.video_list)) {
      if (!v || typeof v.url !== 'string') continue;
      if (!duration && pos(v.duration)) duration = Math.round(v.duration / 100) / 10;
      if (!thumb && v.thumbnail) thumb = adMediaUrl('pinterest', v.thumbnail);
      if (/\.m3u8(\?|$)/.test(v.url)) { if (hls.length < 4 && !hls.includes(v.url)) hls.push(v.url); }
      else if (/\.mp4(\?|$)/.test(v.url)) { const url = adMediaUrl('pinterest', v.url); if (url) mp4s.push({ key: k, url, w: int(v.width), h: int(v.height) }); }
    }
  }
  const rank = (k) => { const i = PIN_MP4_RANK.indexOf(k); return i === -1 ? 99 : i; };
  mp4s.sort((a, b) => rank(a.key) - rank(b.key));
  const orig = data.images && data.images.orig;
  const by = [data.native_creator && data.native_creator.username, data.pinner && data.pinner.username]
    .find((u) => typeof u === 'string' && /^[A-Za-z0-9_.-]{1,40}$/.test(u)) || null;
  return { mp4s, hls, duration, image: (orig && adMediaUrl('pinterest', orig.url)) || thumb, title: cleanCaption(data.title || data.grid_title, 140), by };
}
// HLS master URL -> progressive MP4 candidates (HEAD-checked in this order)
export function pinHlsCandidates(hlsUrl) {
  const m = /^https:\/\/v1\.pinimg\.com\/videos\/(?:iht|mc)\/hls\/([0-9a-f]{2})\/([0-9a-f]{2})\/([0-9a-f]{2})\/([0-9a-f]{32})(?:_v\d+)?\.m3u8/i.exec(hlsUrl || '');
  if (!m) return [];
  const p = `${m[1]}/${m[2]}/${m[3]}/${m[4]}`;
  return [`https://v1.pinimg.com/videos/iht/expMp4/${p}_720w.mp4`, `https://v1.pinimg.com/videos/iht/720p/${p}.mp4`,
    `https://v1.pinimg.com/videos/mc/720p/${p}.mp4`, `https://v1.pinimg.com/videos/iht/expMp4/${p}_t5.mp4`];
}
const PIN_ADAPTER = {
  name: 'pinterest', support: true, hint: { video: null, image: true },
  match: (p) => p.platform === 'pinterest' && p.subtype === 'pin' && !p.needsResolve && PIN_ID_RE.test(String(p.id || '')),
  async resolve(p, deps = {}) {
    const r = await adFetch(deps, pinResourceUrl(p.id), { headers: pinHeaders(), hosts: PIN_HOSTS, maxBytes: 2 << 20 });
    if (!r.ok) return adFail(r.error === 'redirect' ? 'blocked' : 'upstream');
    if (r.status === 404) return adFail('not_found');
    let info = null;
    if (r.status === 200) { try { info = pinParse(JSON.parse(r.text)); } catch { info = null; } }
    if (!info) return adFail(r.status === 200 ? 'parse_failed' : r.status === 403 || r.status === 429 ? 'blocked' : 'upstream');
    const base = { id: p.id, by: info.by, title: info.title, duration: info.duration, image: info.image ? { url: info.image } : null };
    if (info.mp4s.length) return adOk({ ...base, video: { url: info.mp4s[0].url, w: info.mp4s[0].w, h: info.mp4s[0].h, bytes: null, audio: null, expires_at: null } });
    if (!info.hls.length) return adFail('no_video', base);   // image pin
    let heads = 0;
    for (const h of info.hls) {
      for (const c of pinHlsCandidates(h)) {
        if (heads++ >= 6) break;
        const hr = await adFetch(deps, c, { method: 'HEAD', headers: { 'User-Agent': IG_UA }, hosts: /^v1\.pinimg\.com$/ });
        if (hr.ok && hr.status === 200 && /video\/mp4/i.test(hr.headers.get('Content-Type') || '')) {
          return adOk({ ...base, video: { url: c, w: null, h: null, bytes: pos(hr.headers.get('Content-Length')), audio: null, expires_at: null } });
        }
      }
    }
    return adFail('not_supported', base);   // HLS only, no progressive file next to it
  },
};

// TikTok: logged-out video page with browser navigation headers -> <script id="__UNIVERSAL_DATA_FOR_REHYDRATION__">
// __DEFAULT_SCOPE__['webapp.video-detail'].itemInfo.itemStruct.video.bitrateInfo[] (H.264 preferred). The CDN answers 403
// unless the request carries BOTH Referer https://www.tiktok.com/ and the tt_chain_token cookie from the page response
// (an anonymous token every logged-out page view gets, not a login). Links expire after ~48 h (expire=).
const TT_ID_RE = /^\d{8,25}$/;
const TT_HOSTS = /^(www\.|m\.)?tiktok\.com$/;
export function ttPageUrl(p) {
  const m = /tiktok\.com\/@([A-Za-z0-9._-]*)\//.exec(p.canonical || '');
  return `https://www.tiktok.com/@${m ? m[1] : ''}/video/${p.id}`;
}
// Set-Cookie values -> "tt_chain_token=..." (only that cookie is ever replayed) | null
export function ttChainCookie(list) {
  for (const c of Array.isArray(list) ? list : []) {
    const m = /^\s*tt_chain_token=([A-Za-z0-9+/=._-]{1,512})(;|$)/.exec(String(c));
    if (m) return `tt_chain_token=${m[1]}`;
  }
  return null;
}
export function ttExtract(html) {
  const m = /<script[^>]*id="__UNIVERSAL_DATA_FOR_REHYDRATION__"[^>]*>([\s\S]*?)<\/script>/.exec(html || '');
  if (!m) return { error: 'no_data' };
  let d;
  try { d = JSON.parse(m[1]); } catch { return { error: 'parse_failed' }; }
  const vd = d && d.__DEFAULT_SCOPE__ && d.__DEFAULT_SCOPE__['webapp.video-detail'];
  if (!vd || typeof vd !== 'object') return { error: 'no_detail' };
  if (vd.statusCode && vd.statusCode !== 0) return { error: 'status', statusCode: Number(vd.statusCode) || -1 };
  const it = vd.itemInfo && vd.itemInfo.itemStruct;
  return it && typeof it === 'object' ? { item: it } : { error: 'no_item' };
}
export function ttParse(it, id, cookie, { maxShort = 1080 } = {}) {
  const v = it.video && typeof it.video === 'object' ? it.video : {};
  const by = it.author && /^[A-Za-z0-9._-]{1,40}$/.test(String(it.author.uniqueId || '')) ? it.author.uniqueId : null;
  const tid = TT_ID_RE.test(String(it.id || '')) ? String(it.id) : id;
  const image = adImg('tiktok', v.originCover || v.cover);
  if (it.imagePost) return adFail('no_video', { id: tid, by, image });   // photo slideshow
  const list = [];
  for (const b of Array.isArray(v.bitrateInfo) ? v.bitrateInfo : []) {
    const pa = (b && b.PlayAddr) || {};
    const urls = Array.isArray(pa.UrlList) ? pa.UrlList.filter((u) => typeof u === 'string') : [];
    const url = adMediaUrl('tiktok', urls.find((u) => /^https:\/\/v\d+-webapp/.test(u)) || urls[0]);
    if (url) list.push({ url, w: int(pa.Width), h: int(pa.Height), bitrate: pos(b.Bitrate) || 0, bytes: pos(pa.DataSize), h264: !b.CodecType || /h264/i.test(b.CodecType) });
  }
  if (!list.length && v.playAddr) {
    const url = adMediaUrl('tiktok', v.playAddr);
    if (url) list.push({ url, w: int(v.width), h: int(v.height), bitrate: pos(v.bitrate) || 0, bytes: pos(v.size), h264: !v.codecType || /h264/i.test(v.codecType) });
  }
  if (!list.length) return adFail('no_video', { id: tid, by, image });
  const h264 = list.filter((x) => x.h264);
  const best = pickBest(h264.length ? h264 : list, maxShort);
  const ds = it.author && it.author.downloadSetting != null ? it.author.downloadSetting : it.downloadSetting;
  return adOk({
    id: tid, by, title: cleanCaption(it.desc, 140), duration: pos(v.duration), image,
    video: { url: best.url, w: best.w, h: best.h, bytes: best.bytes, audio: true, expires_at: urlExpiry(best.url),
      headers: { Referer: 'https://www.tiktok.com/', ...(cookie ? { Cookie: cookie } : {}) }, private: true },
    creator_download: ds == null ? null : Number(ds) === 0,   // TikTok's own download button (0 = on)
  });
}
const TT_ADAPTER = {
  name: 'tiktok', support: true, hint: { video: true, image: true },
  match: (p) => p.platform === 'tiktok' && p.subtype === 'video' && !p.needsResolve && TT_ID_RE.test(String(p.id || '')),
  async resolve(p, deps = {}) {
    const r = await adFetch(deps, ttPageUrl(p), { headers: adNavHeaders(), hosts: TT_HOSTS, maxBytes: 3 << 20 });
    if (!r.ok) return adFail(r.error === 'redirect' ? 'login_required' : 'upstream');
    if (r.status === 404) return adFail('not_found');
    if (r.status !== 200) return adFail('blocked');
    if (/\/login/.test(new URL(r.url).pathname)) return adFail('login_required');
    const ex = ttExtract(r.text);
    if (ex.error === 'status') return adFail(ex.statusCode === 10204 ? 'not_found' : 'login_required');
    if (ex.error) return adFail(/captcha|verify/i.test(r.text.slice(0, 5000)) ? 'blocked' : 'parse_failed');
    return ttParse(ex.item, p.id, ttChainCookie(r.setCookies), deps);
  },
};

// Facebook public videos / reels: GET /reel/<id> | /watch/?v=<id> with navigation headers -> the <script
// type="application/json"> object whose id is the video: videoDeliveryLegacyFields.browser_native_hd_url | _sd_url
// (progressive MP4 + AAC on *.fbcdn.net, signed, oe= ~4-5 days), thumbnailImage.uri, length_in_second.
// Friends-only / group / age-gated videos get the login wall.
const FB_ID_RE = /^\d{5,25}$/;
const FB_HOSTS = /^(www|web|m)\.facebook\.com$/;
export const fbPageUrl = (p) => (p.subtype === 'reel' ? `https://www.facebook.com/reel/${p.id}` : `https://www.facebook.com/watch/?v=${p.id}`);
export function fbExtract(html, vid) {
  for (const j of scriptJson(html || '', 'browser_native')) {
    const [o] = findObjs(j, (x) => x.id === vid && ((x.videoDeliveryLegacyFields && typeof x.videoDeliveryLegacyFields === 'object') || x.browser_native_hd_url || x.browser_native_sd_url));
    if (o) return o.videoDeliveryLegacyFields ? o : { id: vid, videoDeliveryLegacyFields: o };
  }
  return null;
}
export function fbParse(o, vid) {
  const L = o.videoDeliveryLegacyFields || {};
  const url = adMediaUrl('facebook', L.browser_native_hd_url) || adMediaUrl('facebook', L.browser_native_sd_url);
  const image = adImg('facebook', (o.thumbnailImage && o.thumbnailImage.uri) || (o.preferred_thumbnail && o.preferred_thumbnail.image && o.preferred_thumbnail.image.uri));
  if (!url) return adFail('no_video', { id: vid, image });
  return adOk({ id: vid, duration: pos(o.length_in_second), image, video: { url, w: null, h: null, bytes: null, audio: true, expires_at: urlExpiry(url) } });
}
const FB_ADAPTER = {
  name: 'facebook', support: true, hint: { video: true, image: true },
  match: (p) => p.platform === 'facebook' && (p.subtype === 'video' || p.subtype === 'reel') && !p.needsResolve && FB_ID_RE.test(String(p.id || '')),
  async resolve(p, deps = {}) {
    const r = await adFetch(deps, fbPageUrl(p), { headers: adNavHeaders(), hosts: FB_HOSTS, maxBytes: 3 << 20 });
    if (!r.ok) return adFail(r.error === 'redirect' ? 'login_required' : 'upstream');
    if (r.status === 404) return adFail('not_found');
    if (r.status !== 200) return adFail('blocked');
    if (/\/login(\.php|\/|$)/.test(new URL(r.url).pathname)) return adFail('login_required');
    const o = fbExtract(r.text, p.id);
    if (o) return fbParse(o, p.id);
    return adFail(/id="login_form"|name="login"|Log in to Facebook|Log into Facebook/i.test(r.text) ? 'login_required' : 'parse_failed');
  },
};

// Reddit (reddit.com links are platform 'web'): the post's public Atom feed GET /r/<sub>/comments/<id>/.rss (the JSON API
// and the post page need OAuth / a proof-of-work bot check) -> v.redd.it/<vid> -> DASHPlaylist.mpd -> the tallest
// CMAF_<h>.mp4 (picture only) + CMAF_AUDIO_<kbps>.mp4 (sound only): joined by openMuxed(). No expiry, ACAO *.
// Reddit asks for a descriptive User-Agent and rate-limits the feed (~1 request / minute / IP: index.js admits it).
const REDDIT_UA = 'web:fikir-board:v0.1 (internal moodboard)';
export function redditRef(href) {
  let u;
  try { u = new URL(href); } catch { return null; }
  const host = u.hostname.toLowerCase();
  if (host === 'v.redd.it') { const vid = u.pathname.split('/')[1]; return /^[a-z0-9]{5,20}$/i.test(vid || '') ? { sub: null, postId: null, vid } : null; }
  if (!/(^|\.)reddit\.com$/.test(host)) return null;
  let m = /^\/r\/([A-Za-z0-9_]{2,32})\/comments\/([a-z0-9]{3,12})(?:\/|$)/i.exec(u.pathname);
  if (m) return { sub: m[1], postId: m[2].toLowerCase(), vid: null };
  m = /^\/comments\/([a-z0-9]{3,12})(?:\/|$)/i.exec(u.pathname);
  if (m) return { sub: null, postId: m[1].toLowerCase(), vid: null };
  return null;   // share links (/r/x/s/...) and listings
}
const xmlText = (s) => String(s).replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#0?39;|&#x27;/g, "'")
  .replace(/&#(\d{1,7});/g, (_, n) => (Number(n) <= 0x10FFFF ? String.fromCodePoint(Number(n)) : '')).replace(/&amp;/g, '&');
// Post feed -> {link, vid, thumb, title, author} of its first <entry> | null
export function redditRss(xml) {
  const s = String(xml || '');
  const i = s.indexOf('<entry>');
  if (i === -1) return null;
  const e = s.slice(i, s.indexOf('</entry>', i) + 8);
  const content = xmlText(((/<content[^>]*>([\s\S]*?)<\/content>/.exec(e) || [])[1]) || '');
  const link = (/<a href="([^"]+)">\[link\]<\/a>/.exec(content) || [])[1] || null;
  const vid = link ? ((/^https:\/\/v\.redd\.it\/([a-z0-9]{5,20})/i.exec(link) || [])[1] || null) : null;
  const thumb = (/<media:thumbnail url="([^"]+)"/.exec(e) || [])[1];
  const author = ((/<name>\/u\/([A-Za-z0-9_-]{3,20})<\/name>/.exec(e) || [])[1]) || null;
  return { link, vid, thumb: thumb ? xmlText(thumb) : null, title: cleanCaption(xmlText((/<title>([\s\S]*?)<\/title>/.exec(e) || [])[1] || ''), 140), author };
}
// DASHPlaylist.mpd -> {video: [{file, width, height, bandwidth}], audio: [{file, bandwidth}], duration}
export function redditMpd(mpd) {
  const reps = [...String(mpd || '').matchAll(/<Representation\b([^>]*)>([\s\S]*?)<\/Representation>/g)].map((m) => {
    const a = (k) => (new RegExp(`\\b${k}="([^"]*)"`).exec(m[1]) || [])[1];
    return { mime: a('mimeType') || '', width: int(a('width')), height: int(a('height')), bandwidth: pos(a('bandwidth')) || 0, file: (/<BaseURL>([^<]+)<\/BaseURL>/.exec(m[2]) || [])[1] };
  }).filter((r) => r.file && /^[A-Za-z0-9_.-]{1,80}\.mp4$/.test(r.file));
  const d = /mediaPresentationDuration="PT(?:(\d+)H)?(?:(\d+)M)?([\d.]+)S"/.exec(String(mpd || ''));
  return {
    video: reps.filter((r) => /^video\//.test(r.mime) || (!r.mime && r.height)),
    audio: reps.filter((r) => /^audio\//.test(r.mime)),
    duration: d ? Math.round(((+d[1] || 0) * 3600 + (+d[2] || 0) * 60 + +d[3]) * 10) / 10 : null,
  };
}
async function redditDash(deps, vid, meta) {
  const base = `https://v.redd.it/${vid}/`;
  const r = await adFetch(deps, base + 'DASHPlaylist.mpd', { headers: { 'User-Agent': IG_UA }, hosts: /^v\.redd\.it$/, maxBytes: 256 << 10 });
  if (!r.ok) return adFail('upstream', meta);
  if (r.status === 404 || r.status === 403) return adFail('not_found', meta);
  if (r.status !== 200) return adFail('upstream', meta);
  const mpd = redditMpd(r.text);
  if (!mpd.video.length) return adFail('no_video', meta);
  const best = pickBest(mpd.video.map((x) => ({ url: base + x.file, w: x.width, h: x.height, bitrate: x.bandwidth })), deps.maxShort || 1080);
  const au = mpd.audio.sort((a, b) => b.bandwidth - a.bandwidth)[0];
  return adOk({ ...meta, duration: mpd.duration,
    video: { url: best.url, w: best.w, h: best.h, bytes: null, audio: !!au, expires_at: null, ...(au ? { audio_url: base + au.file, mux: 'cmaf' } : {}) } });
}
// v.redd.it id of the post's link-preview video (the board's preview often found CMAF_<h>.mp4: picture only)
const redditPreviewVid = (deps) => {
  const m = /^https:\/\/v\.redd\.it\/([a-z0-9]{5,20})\//i.exec(String((deps && deps.preview && deps.preview.video) || ''));
  return m ? m[1] : null;
};
const REDDIT_ADAPTER = {
  name: 'reddit', support: true, hint: { video: null, image: null },
  match: (p) => (p.platform === 'web' || p.platform === 'video') && !p.needsResolve && !!redditRef(p.canonical),
  feed(p, deps = {}) { const ref = redditRef(p.canonical); return !!(ref && !ref.vid && ref.postId && !redditPreviewVid(deps)); },
  async resolve(p, deps = {}) {
    const ref = redditRef(p.canonical);
    if (!ref) return adFail('bad_input');
    if (ref.vid) return redditDash(deps, ref.vid, { id: ref.vid });
    // the link preview already knows the video: no feed request (Reddit rate-limits feeds hard)
    const pv = ref.postId ? redditPreviewVid(deps) : null;
    if (pv) return redditDash(deps, pv, { id: ref.postId, image: adImg('reddit', deps.preview.image) });
    const feed = `https://www.reddit.com/${ref.sub ? `r/${ref.sub}/` : ''}comments/${ref.postId}/.rss`;
    const r = await adFetch(deps, feed, { headers: { 'User-Agent': REDDIT_UA, 'Accept': 'application/atom+xml' }, hosts: /^(www|old)\.reddit\.com$/, maxBytes: 1 << 20 });
    if (!r.ok) return adFail('upstream');
    if (r.status === 404) return adFail('not_found');
    if (r.status !== 200) return adFail(r.status === 403 || r.status === 429 ? 'blocked' : 'upstream');
    const post = redditRss(r.text);
    if (!post) return adFail('parse_failed');
    const meta = { id: ref.postId, by: post.author, title: post.title, image: adImg('reddit', post.thumb) };
    if (post.vid) return redditDash(deps, post.vid, meta);
    const gifv = post.link && /^https:\/\/i\.imgur\.com\/([A-Za-z0-9]{5,10})\.(gifv|mp4)$/.exec(post.link);
    if (gifv) return adOk({ ...meta, video: { url: `https://i.imgur.com/${gifv[1]}.mp4`, w: null, h: null, bytes: null, audio: null, expires_at: null } });
    const pic = post.link && /^https:\/\/i\.redd\.it\/[A-Za-z0-9]{5,20}\.(jpe?g|png|webp|gif)$/i.test(post.link) ? adImg('reddit', post.link) : null;
    return adFail('no_video', { ...meta, image: pic || meta.image });
  },
};

// Not downloadable (no request is made): the reason goes to download-info / the error page. The worker never falls back
// to their thumbnail for a video download (auto / video -> 422 not_downloadable); part=image gives the thumbnail.
const VIMEO_ADAPTER = {
  name: 'vimeo', support: false, reason: 'drm', hint: { video: false, image: null },
  match: (p) => p.platform === 'vimeo' && p.subtype === 'video',
  async resolve() { return adFail('drm'); },
};
// YouTube: ciphered / SABR streams and bot checks; videos, Shorts and (past) live streams alike
const YT_ADAPTER = {
  name: 'youtube', support: false, reason: 'not_supported', hint: { video: false, image: true },
  match: (p) => p.platform === 'youtube' && ['video', 'short', 'live'].includes(p.subtype) && /^[A-Za-z0-9_-]{11}$/.test(String(p.id || '')),
  async resolve(p) { return adFail('not_supported', { id: p.id, image: { url: `https://i.ytimg.com/vi/${p.id}/hqdefault.jpg` } }); },
};

// Registry: built-ins first; registerDlAdapter() appends (tests, future platforms).
export const DL_ADAPTERS = [X_ADAPTER, PIN_ADAPTER, TT_ADAPTER, FB_ADAPTER, REDDIT_ADAPTER, VIMEO_ADAPTER, YT_ADAPTER];
export function registerDlAdapter(adapter) {
  if (adapter && typeof adapter.name === 'string' && typeof adapter.match === 'function' && typeof adapter.resolve === 'function') DL_ADAPTERS.push(adapter);
}
export function dlAdapterFor(parsed) {
  if (!parsed) return null;
  for (const a of DL_ADAPTERS) { try { if (a.match(parsed)) return a; } catch (e) {} }
  return null;
}

/* ------------------------------------------------------------------ adapter results <-> cache rows (kind 'ad') */

// Success / no-video results are cached (links until they expire, else 7 days); private (cookie) links never are: the
// row then only records that a video exists.
export function adToCache(name, r, now = Math.floor(Date.now() / 1000)) {
  const v = r.video, img = r.image;
  const exps = [v && v.expires_at, img && urlExpiry(img.url)].filter(Boolean);
  return {
    url: v && !v.private ? v.url : null, poster: img ? img.url : null, width: (v && v.w) || null, height: (v && v.h) || null,
    bytes: (v && v.bytes) || null, expires_at: exps.length ? Math.min(...exps) : now + 7 * 86400,
    extra: { ad: name, id: r.id || null, by: r.by || null, has_video: !!v, private: !!(v && v.private), audio: v ? v.audio : null,
      audio_url: v && v.audio_url ? v.audio_url : null, mux: v && v.mux === 'cmaf' ? 'cmaf' : null, duration: r.duration || null },
  };
}
export function adFromCache(name, row) {
  const x = vcExtra(row);
  if (x.ad !== name) return null;
  const image = adImg(name, row.poster);
  const by = typeof x.by === 'string' && /^[A-Za-z0-9._-]{1,40}$/.test(x.by) ? x.by : null;
  const id = typeof x.id === 'string' && /^[A-Za-z0-9_-]{1,40}$/.test(x.id) ? x.id : null;
  if (!x.has_video) return adFail('no_video', { id, by, image });
  let video;
  if (x.private) video = { url: null, private: true };
  else {
    const url = adMediaUrl(name, row.url);
    if (!url) return null;
    video = { url, w: row.width || null, h: row.height || null, bytes: row.bytes || null, audio: typeof x.audio === 'boolean' ? x.audio : null, expires_at: Number(row.expires_at) || null };
    const au = x.mux === 'cmaf' ? adMediaUrl(name, x.audio_url) : null;
    if (au) { video.audio_url = au; video.mux = 'cmaf'; }
  }
  return adOk({ id, by, duration: Number(x.duration) || null, video, image });
}

/* ------------------------------------------------------------------ download hint (no network) */

const httpOrFiles = (u) => typeof u === 'string' && (/^https?:\/\//i.test(u) || u.startsWith('/files/'));
// Cheap per-post hint for GET /posts: {video: true|false|null (maybe), image: true|false, reason?} or null (nothing to
// download). reason: why there is no video for platforms that never give one ('drm' Vimeo, 'not_supported' YouTube).
// `media` / `meta` are the sanitized PostOut values; `parsed` = parseLink(post.url).
export function dlHint({ type, parsed, media, meta } = {}) {
  if (type === 'text') return null;
  let video = false, image = false, reason = null;
  const take = (m) => {
    if (!m || !httpOrFiles(m.url)) return;
    if (m.kind === 'video') { video = true; if (httpOrFiles(m.poster)) image = true; }
    else if (m.kind === 'image') image = true;
  };
  take(media);
  take(meta && meta.media);
  if (meta && httpOrFiles(meta.image)) image = true;
  if (parsed) {
    if (parsed.platform === 'video') video = true;
    if (parsed.platform === 'image') image = true;
    const ig = igRef(parsed);
    if (ig) {
      image = true;
      if (!video) video = ig.kind === 'p' ? null : true;
    } else {
      const ad = dlAdapterFor(parsed);
      if (ad && ad.hint) {
        if (!video && ad.hint.video !== false) video = ad.hint.video === true ? true : null;
        if (!image && ad.hint.image === true) image = true;
        if (ad.support === false && video === false) reason = ad.reason || 'not_supported';
      }
    }
  }
  if (video === false && !image) return null;
  return reason ? { video, image, reason } : { video, image };
}

/* ------------------------------------------------------------------ Reddit: picture + sound -> one MP4 */

// Range GET of the first bytes of a file (no redirects): the video head for muxedLength(). -> Uint8Array | null
async function headBytes(href, { safeURL, fetchImpl = fetch, n = 65536, timeoutMs = 10000 }) {
  const u = typeof safeURL === 'function' ? safeURL(href) : null;
  if (!u) return null;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetchImpl(u.href, { method: 'GET', redirect: 'manual', signal: ctrl.signal,
      headers: { 'User-Agent': IG_UA, 'Accept': VIDEO_ACCEPT, 'Accept-Encoding': 'identity', 'Range': `bytes=0-${n - 1}` } });
    if ((res.status !== 206 && res.status !== 200) || !res.body) { try { res.body && res.body.cancel(); } catch (e) {} return null; }
    const reader = res.body.getReader();
    let head = new Uint8Array(0);
    try {
      while (head.byteLength < n) {
        const { done, value } = await reader.read();
        if (done) break;
        head = concatBytes(head, value);
      }
    } finally { reader.cancel().catch(() => {}); }
    return head.subarray(0, n);
  } catch (e) {
    return null;
  } finally { clearTimeout(timer); }
}
// Reddit's picture-only + sound-only CMAF files as ONE MP4 with sound (worker/cmaf-mux.js, lossless). The sound
// (<= maxAudioBytes) is read into memory, the first 64 KB of the picture give the exact output length, then the picture
// streams through the muxer. Same guards as openMedia (SSRF guard on every hop, sizes, MP4 magic on both files).
// -> {ok: true, body, length, fixed, mime: 'video/mp4', ext: 'mp4'} | {ok: false, error}
export async function openMuxed(videoUrl, audioUrl, { safeURL, maxBytes, maxAudioBytes = 32 << 20, fetchImpl = fetch, totalMs = 15 * 60e3 } = {}) {
  const a = await openMedia(audioUrl, { want: 'video', maxBytes: maxAudioBytes, safeURL, fetchImpl, totalMs: 60000 });
  if (!a.ok) return { ok: false, error: 'audio_' + a.error };
  let audio;
  try { audio = new Uint8Array(await new Response(a.body).arrayBuffer()); } catch (e) { return { ok: false, error: 'audio_fetch_error' }; }
  const head = await headBytes(videoUrl, { safeURL, fetchImpl });
  if (!head) return { ok: false, error: 'fetch_error' };
  let length = null;
  try { length = muxedLength(head, audio); } catch (e) { length = null; }
  if (length == null) return { ok: false, error: 'mux_unsupported' };
  if (length > maxBytes) return { ok: false, error: 'too_large' };
  const v = await openMedia(videoUrl, { want: 'video', maxBytes, safeURL, fetchImpl, totalMs });
  if (!v.ok) return v;
  let body;
  try { body = muxCmafStream(v.body, audio); } catch (e) { v.body.cancel().catch(() => {}); return { ok: false, error: 'mux_unsupported' }; }
  if (typeof FixedLengthStream === 'function') return { ok: true, body: body.pipeThrough(new FixedLengthStream(length)), length, fixed: true, mime: 'video/mp4', ext: 'mp4' };
  return { ok: true, body, length, fixed: false, mime: 'video/mp4', ext: 'mp4' };
}

/* ------------------------------------------------------------------ D1 cache (inspire_video_cache) */

// One row per (post, kind): kind 'ig' = resolved Instagram media (CDN links valid until expires_at), 'ig_embed' = embed
// check (extra.state blocked|ok|photo|unknown), 'ig_copy' = R2 copy attempts (error/backoff only). fail_count + retry_at
// implement the backoff; a success resets them.
export const VIDEO_CACHE_DDL = `CREATE TABLE IF NOT EXISTS inspire_video_cache (
  post_id INTEGER NOT NULL,
  kind TEXT NOT NULL,
  url TEXT,
  poster TEXT,
  width INTEGER,
  height INTEGER,
  bytes INTEGER,
  expires_at INTEGER,
  resolved_at INTEGER,
  error TEXT,
  fail_count INTEGER NOT NULL DEFAULT 0,
  retry_at INTEGER,
  extra TEXT,
  PRIMARY KEY (post_id, kind)
)`;
const nowS = () => Math.floor(Date.now() / 1000);
// Backoff after the n-th consecutive failure: 10 min, 30 min, 2 h, 6 h, then 24 h; a removed post 7 days.
export function backoffS(n, retry) {
  if (retry === 'gone') return 7 * 86400;
  return [600, 1800, 7200, 21600][Math.max(0, n - 1)] || 86400;
}
export async function vcGet(db, postId, kind) {
  try { return await db.prepare('SELECT * FROM inspire_video_cache WHERE post_id=?1 AND kind=?2').bind(postId, kind).first(); }
  catch (e) { return null; }
}
export function vcExtra(row) {
  if (!row || !row.extra) return {};
  try { const x = JSON.parse(row.extra); return x && typeof x === 'object' && !Array.isArray(x) ? x : {}; } catch { return {}; }
}
export async function vcPut(db, postId, kind, rec = {}) {
  const extra = rec.extra ? JSON.stringify(rec.extra).slice(0, 4000) : null;
  await db.prepare(`INSERT INTO inspire_video_cache (post_id, kind, url, poster, width, height, bytes, expires_at, resolved_at, error, fail_count, retry_at, extra)
    VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, NULL, 0, ?10, ?11)
    ON CONFLICT(post_id, kind) DO UPDATE SET url=excluded.url, poster=excluded.poster, width=excluded.width, height=excluded.height,
      bytes=excluded.bytes, expires_at=excluded.expires_at, resolved_at=excluded.resolved_at, error=NULL, fail_count=0,
      retry_at=excluded.retry_at, extra=excluded.extra`)
    .bind(postId, kind, rec.url || null, rec.poster || null, rec.width || null, rec.height || null, rec.bytes || null,
      rec.expires_at || null, rec.resolved_at || nowS(), rec.retry_at || null, extra).run();
}
// Records a failure; returns the new retry_at.
export async function vcFail(db, postId, kind, error, { retry = 'soon', extra = undefined } = {}) {
  const prev = await vcGet(db, postId, kind);
  const n = (prev ? Number(prev.fail_count) || 0 : 0) + 1;
  const retryAt = nowS() + backoffS(n, retry);
  const ex = extra !== undefined ? JSON.stringify(extra).slice(0, 4000) : prev ? prev.extra : null;
  await db.prepare(`INSERT INTO inspire_video_cache (post_id, kind, error, fail_count, retry_at, resolved_at, extra) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
    ON CONFLICT(post_id, kind) DO UPDATE SET error=excluded.error, fail_count=excluded.fail_count, retry_at=excluded.retry_at,
      resolved_at=excluded.resolved_at, extra=excluded.extra`)
    .bind(postId, kind, String(error || 'error').slice(0, 60), n, retryAt, nowS(), ex).run();
  return retryAt;
}
// Keeps a post out of the cron's queue for `kind` until now + seconds without counting a failure (one statement; an
// existing error / fail_count / later retry_at stays): a link that is not an Instagram post, a post whose own Browser Run
// budget is spent for today. Returns the new retry_at.
export async function vcDefer(db, postId, kind, seconds, note) {
  const until = nowS() + Math.max(60, Math.round(Number(seconds) || 0));
  const why = String(note || 'deferred').slice(0, 40);
  await db.prepare(`INSERT INTO inspire_video_cache (post_id, kind, resolved_at, retry_at, extra) VALUES (?1, ?2, ?3, ?4, json_object('deferred', ?5))
    ON CONFLICT(post_id, kind) DO UPDATE SET retry_at = MAX(COALESCE(retry_at, 0), excluded.retry_at),
      extra = json_set(CASE WHEN json_valid(extra) THEN extra ELSE '{}' END, '$.deferred', ?5)`)
    .bind(postId, kind, nowS(), until, why).run();
  return until;
}
// Cached Instagram item still usable for a download that may take a while (>= 15 min of link lifetime left)
export function vcItemFresh(row, now = nowS()) {
  if (!row || row.error || !row.resolved_at) return false;
  const exp = Number(row.expires_at) || (Number(row.resolved_at) + 3600);
  return exp - now >= 900;
}
// Cached failure still in its backoff window
export function vcBackingOff(row, now = nowS()) {
  return !!(row && row.error && Number(row.retry_at) > now);
}
// Item (igExtract shape) <-> cache row
export function itemToCache(item) {
  return {
    url: item.video ? item.video.url : null, poster: item.image ? item.image.url : null, width: item.w, height: item.h,
    expires_at: item.expires_at, extra: { user: item.user, caption: item.caption ? cleanCaption(item.caption, 300) : null,
      has_audio: item.has_audio, duration: item.duration, media_type: item.media_type },
  };
}
export function cacheToItem(row, code) {
  const x = vcExtra(row);
  const video = igCdnUrl(row.url) ? { url: row.url, w: row.width || null, h: row.height || null } : null;
  const image = igCdnUrl(row.poster) ? { url: row.poster, w: null, h: null } : null;
  if (!video && !image) return null;
  return {
    code, user: typeof x.user === 'string' && /^[A-Za-z0-9._]{1,30}$/.test(x.user) ? x.user : null,
    caption: cleanCaption(x.caption, 300), has_audio: typeof x.has_audio === 'boolean' ? x.has_audio : null,
    w: row.width || null, h: row.height || null, duration: Number(x.duration) || null, media_type: Number(x.media_type) || null,
    video, videos: video ? [video] : [], image, expires_at: Number(row.expires_at) || null,
  };
}
