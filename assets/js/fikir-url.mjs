/*
 * fikir-url.mjs - Fikir Havuzu link parser (single source of truth).
 *
 * Pure ES module: no DOM, no Node APIs, no network. Imported by
 *   - the worker:  import { parseLink } from '../assets/js/fikir-url.mjs'
 *   - the browser: <script type="module"> import { parseLink } from '/assets/js/fikir-url.mjs'
 *
 * parseLink(input) -> null | {
 *   platform, id, subtype, canonical, key, needsResolve, embed, thumb
 * }
 *   embed = null | { src, aspect, height, autoHeight, allow, sandbox }
 *     aspect      width/height ratio, or null when a fixed `height` (px) is used
 *     height      fixed px height (or the initial height when autoHeight is set)
 *     autoHeight  'instagram' | 'x' | null  -> the frame reports its own height via
 *                 postMessage; see parseEmbedMessage() below for the exact shapes.
 *
 * Embed URLs were checked from a cross-site page in headless Chrome (2026-10-03).
 * Instagram /{user}/reel/{id}/embed/ is X-Frame-Options: DENY, which is why every
 * Instagram post is rebuilt as /{p|reel|tv}/{code}/embed/.
 */

export const MAX_URL_LENGTH = 2048;

const ALLOW = 'accelerometer; autoplay; clipboard-write; encrypted-media; fullscreen; gyroscope; picture-in-picture; web-share';

/* ------------------------------------------------------------------ tracking */

// Lower-case query parameter names that never identify content.
// An entry ending in '*' is a prefix match.
export const TRACKING_PARAMS = Object.freeze([
  'utm_*',
  'fbclid', 'gclid', 'gclsrc', 'dclid', 'gbraid', 'wbraid', 'msclkid', 'yclid', 'twclid', 'ttclid', 'li_fat_id',
  'mc_cid', 'mc_eid', '_hsenc', '_hsmi', 'mkt_tok',
  'igsh', 'igshid', 'ig_rid', 'si', 'mibextid', 'sfnsn', '__cft__*', '__tn__',
  'feature', 'ref', 'ref_src', 'ref_url', 'share_id', 'ab_channel',
  '_r', '_t', 'is_from_webapp', 'sender_device', 'is_copy_url', 'share_app_id', 'share_item_id', 'share_link_id',
  'trk', 'trackingid', 'lipi', 'rcm', 'wt.mc_id',
]);

// Extra parameters that are tracking only on specific hosts (base host, see baseHost()).
export const HOST_TRACKING_PARAMS = Object.freeze({
  'x.com': Object.freeze(['s', 't']),
  'twitter.com': Object.freeze(['s', 't']),
});

const TRACK_EXACT = new Set(TRACKING_PARAMS.filter((p) => !p.endsWith('*')));
const TRACK_PREFIX = TRACKING_PARAMS.filter((p) => p.endsWith('*')).map((p) => p.slice(0, -1));

function isTrackingParam(name, hostKey) {
  const n = String(name).toLowerCase();
  if (TRACK_EXACT.has(n)) return true;
  for (const p of TRACK_PREFIX) if (n.startsWith(p)) return true;
  const extra = HOST_TRACKING_PARAMS[hostKey];
  return !!(extra && extra.includes(n));
}

/* ------------------------------------------------------------- short links */

// Hosts whose links are redirects that must be resolved server-side first.
// value = best-guess platform before resolving.
export const SHORT_LINK_HOSTS = Object.freeze({
  'pin.it': 'pinterest',
  'vm.tiktok.com': 'tiktok',
  'vt.tiktok.com': 'tiktok',
  't.co': 'web',
  'fb.watch': 'facebook',
  'fb.me': 'facebook',
  'spotify.link': 'spotify',
  'spoti.fi': 'spotify',
  'on.soundcloud.com': 'soundcloud',
  'snd.sc': 'soundcloud',
  'lnkd.in': 'linkedin',
  'forms.gle': 'gdocs',
  'be.net': 'behance',
  'bit.ly': 'web',
  'bitly.com': 'web',
  'tinyurl.com': 'web',
  'goo.gl': 'web',
  'maps.app.goo.gl': 'web',
  'goo.gle': 'web',
  'share.google': 'web',
  'search.app': 'web',
  'g.co': 'web',
  'ow.ly': 'web',
  'buff.ly': 'web',
  'is.gd': 'web',
  'v.gd': 'web',
  'rebrand.ly': 'web',
  'cutt.ly': 'web',
  'shorturl.at': 'web',
  'rb.gy': 'web',
  't.ly': 'web',
  'tiny.cc': 'web',
  's.id': 'web',
  'trib.al': 'web',
  'dlvr.it': 'web',
  'ift.tt': 'web',
  'apple.co': 'web',
  'amzn.to': 'web',
  'amzn.eu': 'web',
  'a.co': 'web',
  'aka.ms': 'web',
  'redd.it': 'web',
});

/* ----------------------------------------------------------------- helpers */

function safeDecode(s) {
  try { return decodeURIComponent(s); } catch (_) { return s; }
}

// www./m./mobile. are ignored for keys and host matching.
function baseHost(host) {
  return String(host).toLowerCase().replace(/^www\./, '').replace(/^(?:m|mobile)\./, '');
}

// SPA hash routes (#/page, #!/page) identify content; other fragments do not.
function keepFragment(hash) {
  return /^#[!/]/.test(hash || '');
}

function filterQuery(search, hostKey) {
  if (!search || search === '?') return '';
  const kept = search.slice(1).split('&').filter((part) => {
    if (!part) return false;
    const rawKey = part.split('=')[0];
    return !isTrackingParam(safeDecode(rawKey.replace(/\+/g, ' ')), hostKey);
  });
  return kept.length ? '?' + kept.join('&') : '';
}

// Copy of `u` without tracking params and without a (non-route) fragment.
// The remaining query keeps its original encoding.
function cleanURL(u) {
  const c = new URL(u.href);
  c.search = filterQuery(c.search, baseHost(c.hostname));
  if (!keepFragment(c.hash)) c.hash = '';
  return c;
}

function cmp(a, b) {
  return a < b ? -1 : a > b ? 1 : 0;
}

// host/path?sorted-params - used for every key that is not built from a content id.
function keyBody(u) {
  const c = cleanURL(u);
  const host = baseHost(c.host);
  const path = c.pathname.split('/').map(safeDecode).join('/').replace(/\/+$/, '');
  const params = [...new URLSearchParams(c.search)].sort((x, y) => cmp(x[0], y[0]) || cmp(x[1], y[1]));
  // Escape only the delimiters so Turkish/Unicode text stays readable in keys.
  const esc = (s) => s.replace(/[%&=#+\s]/g, encodeURIComponent);
  const q = params.length ? '?' + params.map(([k, v]) => esc(k) + '=' + esc(v)).join('&') : '';
  return host + path + q + (keepFragment(c.hash) ? c.hash : '');
}

const SCHEME_RE = /^([a-z][a-z0-9+.-]*):/i;
const HOSTLIKE_RE = /^[\p{L}\p{N}-]+(?:\.[\p{L}\p{N}-]+)+(?::\d{1,5})?(?:[/?#]|$)/u;

// String -> URL (http/https only) or null.
function toURL(input) {
  if (input instanceof URL) input = input.href;
  if (typeof input !== 'string') return null;
  let s = input.trim();
  if (!s) return null;
  // <https://...> or "https://..." as pasted from chat apps / markdown
  const wrapped = /^(?:<([^<>]*)>|"([^"]*)"|'([^']*)')$/.exec(s);
  if (wrapped) s = (wrapped[1] ?? wrapped[2] ?? wrapped[3]).trim();
  // Share sheets paste "Check this out! https://vm.tiktok.com/xyz/" -> take the first URL.
  if (/\s/.test(s)) {
    const m = /https?:\/\/[^\s<>"']+/i.exec(s);
    if (!m) return null;
    s = m[0].replace(/[.,;:!?]+$/, '');
    if (s.endsWith(')') && !s.includes('(')) s = s.slice(0, -1);
  }
  if (!s || s.length > MAX_URL_LENGTH) return null;
  const sm = SCHEME_RE.exec(s);
  if (!sm || sm[1].includes('.')) {
    if (s.startsWith('//')) s = 'https:' + s;
    else if (HOSTLIKE_RE.test(s)) s = 'https://' + s;
    else return null;
  }
  let u;
  try { u = new URL(s); } catch (_) { return null; }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
  const host = u.hostname.replace(/\.+$/, '');
  if (!host.startsWith('[') && (!host.includes('.') || host.split('.').some((label) => !label))) return null;
  if (host !== u.hostname) u.hostname = host;
  u.username = '';
  u.password = '';
  if (u.href.length > MAX_URL_LENGTH) return null;
  return u;
}

// Known redirect wrappers whose target is in the query (no network needed).
function unwrapRedirector(u) {
  const base = baseHost(u.hostname);
  const q = u.searchParams;
  const p = u.pathname;
  let inner = null;
  if ((base === 'l.facebook.com' || base === 'lm.facebook.com' || base === 'facebook.com') && p === '/l.php') inner = q.get('u');
  else if (base === 'l.instagram.com') inner = q.get('u');
  else if (/^google\.[a-z]{2,3}(?:\.[a-z]{2})?$/.test(base) && p === '/url') inner = q.get('q') || q.get('url');
  else if (/^google\.[a-z]{2,3}(?:\.[a-z]{2})?$/.test(base) && p.startsWith('/amp/')) {
    const rest = p.slice(5);
    inner = (rest.startsWith('s/') ? 'https://' + rest.slice(2) : 'http://' + rest) + u.search;
  } else if (base === 'youtube.com' && p === '/redirect') inner = q.get('q');
  else if (base === 'linkedin.com' && p === '/redir/redirect') inner = q.get('url');
  else if (base === 'w.soundcloud.com' && p.startsWith('/player')) inner = q.get('url');
  else if (base === 'figma.com' && p === '/embed') inner = q.get('url');
  if (!inner) return null;
  return toURL(inner);
}

function makeEmbed(src, { aspect = null, height = null, autoHeight = null, allow = ALLOW, sandbox = null } = {}) {
  return { src, aspect, height, autoHeight, allow, sandbox };
}

function result(platform, { id = null, subtype = null, canonical, key, needsResolve = false, embed = null, thumb = null }) {
  return { platform, id, subtype, canonical, key, needsResolve, embed, thumb };
}

// A recognised platform host but no embeddable content (profile pages, search, ...).
function generic(platform, u, extra = {}) {
  return result(platform, {
    canonical: cleanURL(u).href,
    key: platform + ':' + keyBody(u),
    ...extra,
  });
}

function shortResult(platform, u) {
  return result(platform, {
    canonical: cleanURL(u).href,
    key: 'short:' + keyBody(u),
    needsResolve: true,
  });
}

/* --------------------------------------------------------------- platforms */

// Instagram ------------------------------------------------------------------
const IG_KIND = { p: 'p', reel: 'reel', reels: 'reel', tv: 'tv' };
const IG_CODE = /^[A-Za-z0-9_-]{1,64}$/;
const IG_USER = /^[A-Za-z0-9._]{1,30}$/;
const IG_RESERVED = new Set([
  'p', 'reel', 'reels', 'tv', 'stories', 'explore', 'accounts', 'direct', 'about', 'developer', 'legal', 'web',
  'emails', 'challenge', 'oauth', 'session', 'graphql', 'api', 'static', 'privacy', 'terms', 'directory', 'lite',
  'create', 'your_activity', 'embed.js', 'share', 'ar', 's', 'popular', 'topics', 'locations', 'press', 'help',
  'invites', 'nametag', 'qr', 'download', 'business', 'meta_verified', 'threads', 'm', 'call',
]);
const IG_PROFILE_TABS = new Set(['reels', 'tagged', 'guides', 'embed', 'feed', 'saved', 'channel']);

function parseInstagram(u, base, segs) {
  if (base !== 'instagram.com' && base !== 'instagr.am') return null;
  const [s0, s1, s2] = segs;
  if (s0 === 'share') return shortResult('instagram', u);
  if (s0 === 'reels' && s1 === 'audio' && s2) {
    return generic('instagram', u, { id: s2, subtype: 'audio', key: 'instagram:audio:' + s2 });
  }
  let kind = null;
  let code = null;
  if (s0 && IG_KIND[s0] && s1 && IG_CODE.test(s1)) {
    kind = IG_KIND[s0]; code = s1;
  } else if (s0 && !IG_RESERVED.has(s0.toLowerCase()) && s1 && IG_KIND[s1] && s2 && IG_CODE.test(s2)) {
    kind = IG_KIND[s1]; code = s2; // /{username}/reel/{code}/ - the embed for this form is X-Frame-Options: DENY
  }
  if (code) {
    return result('instagram', {
      id: code,
      subtype: kind,
      canonical: `https://www.instagram.com/${kind}/${code}/`,
      key: 'instagram:' + code,
      embed: makeEmbed(`https://www.instagram.com/${kind}/${code}/embed/`, {
        height: kind === 'reel' ? 700 : 600,
        autoHeight: 'instagram',
      }),
    });
  }
  if (s0 === 'stories') {
    if (s1 === 'highlights' && s2 && /^\d+$/.test(s2)) {
      return result('instagram', {
        id: s2, subtype: 'highlight',
        canonical: `https://www.instagram.com/stories/highlights/${s2}/`,
        key: 'instagram:highlight:' + s2,
      });
    }
    if (s1 && IG_USER.test(s1)) {
      const user = s1.toLowerCase();
      if (s2 && /^\d+$/.test(s2)) {
        return result('instagram', {
          id: s2, subtype: 'story',
          canonical: `https://www.instagram.com/stories/${user}/${s2}/`,
          key: 'instagram:story:' + s2,
        });
      }
      return result('instagram', {
        id: null, subtype: 'story',
        canonical: `https://www.instagram.com/stories/${user}/`,
        key: 'instagram:stories:@' + user,
      });
    }
  }
  if (s0 === 'explore' && s1 === 'tags' && s2) {
    const tag = s2.toLowerCase();
    return result('instagram', {
      id: tag, subtype: 'tag',
      canonical: `https://www.instagram.com/explore/tags/${encodeURIComponent(tag)}/`,
      key: 'instagram:tag:' + tag,
    });
  }
  if (s0 && segs.length <= 2 && IG_USER.test(s0) && !IG_RESERVED.has(s0.toLowerCase()) && (!s1 || IG_PROFILE_TABS.has(s1))) {
    const user = s0.toLowerCase();
    // Profile embeds frame fine (no XFO with cross-site iframe fetch headers) and post MEASURE like posts do.
    return result('instagram', {
      id: user, subtype: 'profile',
      canonical: `https://www.instagram.com/${user}/`,
      key: 'instagram:@' + user,
      embed: makeEmbed(`https://www.instagram.com/${user}/embed/`, { height: 480, autoHeight: 'instagram' }),
    });
  }
  return generic('instagram', u);
}

// YouTube --------------------------------------------------------------------
const YT_ID = /^[A-Za-z0-9_-]{11}$/;

function parseTime(t) {
  if (!t) return 0;
  if (/^\d+$/.test(t)) return Number(t);
  const m = /^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s?)?$/.exec(t);
  if (!m) return 0;
  return (Number(m[1]) || 0) * 3600 + (Number(m[2]) || 0) * 60 + (Number(m[3]) || 0);
}

function parseYouTube(u, base, segs) {
  const isMusic = base === 'music.youtube.com';
  if (!(base === 'youtube.com' || base === 'youtu.be' || base === 'youtube-nocookie.com' || isMusic)) return null;
  const q = u.searchParams;
  const [s0, s1] = segs;
  let id = null;
  let subtype = 'video';
  if (base === 'youtu.be') id = s0 || null;
  else if (s0 === 'watch') id = q.get('v') || s1 || null;
  else if (s0 === 'shorts') { id = s1 || null; subtype = 'short'; }
  else if (s0 === 'live') { id = s1 || null; subtype = 'live'; }
  else if (s0 === 'embed' || s0 === 'v' || s0 === 'e') id = s1 && s1 !== 'videoseries' ? s1 : null;
  else if (s0 === 'attribution_link') {
    try { id = new URL(q.get('u') || '', 'https://www.youtube.com').searchParams.get('v'); } catch (_) { id = null; }
  } else if (!s0) id = q.get('v');

  if (id && YT_ID.test(id)) {
    const start = parseTime(q.get('t') || q.get('start'));
    const origin = isMusic ? 'https://music.youtube.com' : 'https://www.youtube.com';
    const canonical = subtype === 'short'
      ? `https://www.youtube.com/shorts/${id}`
      : `${origin}/watch?v=${id}${start ? `&t=${start}s` : ''}`;
    return result('youtube', {
      id, subtype, canonical,
      key: 'youtube:' + id,
      embed: makeEmbed(`https://www.youtube-nocookie.com/embed/${id}${start ? `?start=${start}` : ''}`, {
        aspect: subtype === 'short' ? 9 / 16 : 16 / 9,
      }),
      thumb: `https://i.ytimg.com/vi/${id}/hqdefault.jpg`,
    });
  }

  const list = q.get('list');
  if (list && /^[A-Za-z0-9_-]{2,64}$/.test(list) &&
      (s0 === 'playlist' || s0 === 'watch' || (s0 === 'embed' && s1 === 'videoseries'))) {
    const origin = isMusic ? 'https://music.youtube.com' : 'https://www.youtube.com';
    return result('youtube', {
      id: list, subtype: 'playlist',
      canonical: `${origin}/playlist?list=${list}`,
      key: 'youtube:list:' + list,
      embed: makeEmbed(`https://www.youtube-nocookie.com/embed/videoseries?list=${list}`, { aspect: 16 / 9 }),
    });
  }

  if (base === 'youtube.com' && s0) {
    if (s0.startsWith('@') && s0.length > 1) {
      const handle = s0.slice(1).toLowerCase();
      return result('youtube', {
        id: handle, subtype: 'channel',
        canonical: `https://www.youtube.com/@${encodeURIComponent(handle)}`,
        key: 'youtube:@' + handle,
      });
    }
    if ((s0 === 'channel' || s0 === 'c' || s0 === 'user') && s1) {
      const cid = s0 === 'channel' ? s1 : s1.toLowerCase();
      return result('youtube', {
        id: cid, subtype: 'channel',
        canonical: `https://www.youtube.com/${s0}/${encodeURIComponent(cid)}`,
        key: `youtube:${s0}:${cid}`,
      });
    }
  }
  return generic('youtube', u);
}

// TikTok ---------------------------------------------------------------------
const TT_ID = /^\d{8,25}$/;
const TT_USER = /^[A-Za-z0-9._-]{1,64}$/;

function parseTikTok(u, base, segs) {
  if (base !== 'tiktok.com') return null;
  const [s0, s1, s2] = segs;
  if (s0 === 't' && s1) return shortResult('tiktok', u);
  let user = '';
  let id = null;
  let subtype = 'video';
  if (s0 && s0.startsWith('@') && (s1 === 'video' || s1 === 'photo') && TT_ID.test(s2 || '')) {
    user = TT_USER.test(s0.slice(1)) ? s0.slice(1) : '';
    id = s2; subtype = s1;
  } else if (s0 === 'embed' && s1 === 'v2' && TT_ID.test(s2 || '')) id = s2;
  else if (s0 === 'embed' && TT_ID.test(s1 || '')) id = s1;
  else if (s0 === 'player' && s1 === 'v1' && TT_ID.test(s2 || '')) id = s2;
  else if (s0 === 'share' && s1 === 'video' && TT_ID.test(s2 || '')) id = s2;
  else if (s0 === 'v' && s1) {
    const m = /^(\d{8,25})(?:\.html)?$/.exec(s1);
    if (m) id = m[1];
  }
  if (id) {
    return result('tiktok', {
      id, subtype,
      canonical: `https://www.tiktok.com/@${user}/${subtype}/${id}`, // '@/video/ID' is accepted by TikTok
      key: 'tiktok:' + id,
      embed: makeEmbed(`https://www.tiktok.com/player/v1/${id}`, { aspect: 9 / 16 }),
    });
  }
  if (s0 && s0.startsWith('@') && segs.length === 1 && TT_USER.test(s0.slice(1))) {
    const handle = s0.slice(1).toLowerCase();
    return result('tiktok', {
      id: handle, subtype: 'profile',
      canonical: `https://www.tiktok.com/@${handle}`,
      key: 'tiktok:@' + handle,
    });
  }
  return generic('tiktok', u);
}

// Pinterest ------------------------------------------------------------------
const PIN_HOST = /^(?:[a-z]{2}\.)?pinterest\.(?:com|co\.[a-z]{2}|com\.[a-z]{2}|[a-z]{2})$/;
const PIN_RESERVED = new Set([
  'search', 'ideas', 'today', 'explore', 'business', 'settings', '_', 'categories', 'topics', 'login', 'pin-builder',
  'pin-creation-tool', 'news_hub', 'notifications', 'inbox', 'shopping', 'about', 'help', 'oauth', 'resource',
]);

function parsePinterest(u, base, segs) {
  if (base === 'api.pinterest.com' && segs[0] === 'url_shortener') return shortResult('pinterest', u);
  if (!PIN_HOST.test(base)) return null;
  const [s0, s1, s2] = segs;
  if (s0 === 'pin' && s1) {
    const id = s1.includes('--') ? s1.slice(s1.lastIndexOf('--') + 2) : s1;
    if (/^\d{5,25}$/.test(id)) {
      return result('pinterest', {
        id, subtype: 'pin',
        canonical: `https://www.pinterest.com/pin/${id}/`,
        key: 'pinterest:' + id,
        // embed.html sends no resize messages; height is a fixed best fit for 236-345px wide cards.
        embed: makeEmbed(`https://assets.pinterest.com/ext/embed.html?id=${id}`, { height: 560 }),
      });
    }
    if (/^[A-Za-z0-9_-]{5,64}$/.test(id)) {
      // non-numeric pin ids are rejected by embed.html -> preview card
      return result('pinterest', {
        id, subtype: 'pin',
        canonical: `https://www.pinterest.com/pin/${id}/`,
        key: 'pinterest:' + id,
      });
    }
  }
  if (s0 && !PIN_RESERVED.has(s0.toLowerCase()) && /^[A-Za-z0-9_.-]{1,64}$/.test(s0)) {
    if (segs.length === 1) {
      const user = s0.toLowerCase();
      return result('pinterest', {
        id: user, subtype: 'profile',
        canonical: `https://www.pinterest.com/${user}/`,
        key: 'pinterest:@' + user,
      });
    }
    if (segs.length === 2 && s1 && !s2) {
      const board = `${s0}/${s1}`.toLowerCase();
      return result('pinterest', {
        id: board, subtype: 'board',
        canonical: `https://www.pinterest.com/${s0.toLowerCase()}/${encodeURIComponent(s1.toLowerCase())}/`,
        key: 'pinterest:board:' + board,
      });
    }
  }
  return generic('pinterest', u);
}

// X / Twitter ----------------------------------------------------------------
const X_HOSTS = new Set(['x.com', 'twitter.com', 'fxtwitter.com', 'vxtwitter.com', 'fixupx.com', 'fixvx.com']);
const X_RESERVED = new Set([
  'home', 'explore', 'search', 'notifications', 'messages', 'settings', 'i', 'intent', 'share', 'hashtag', 'login',
  'signup', 'tos', 'privacy', 'compose', 'logout', 'account', 'jobs', 'download', 'communities', 'lists',
]);
const X_PROFILE_TABS = new Set(['media', 'with_replies', 'likes', 'highlights', 'articles']);

function parseX(u, base, segs) {
  if (!X_HOSTS.has(base)) return null;
  const [s0, s1, s2, s3] = segs;
  let user = null;
  let id = null;
  if (s0 === 'i' && s1 === 'web' && s2 === 'status') id = s3;
  else if (s0 === 'i' && s1 === 'status') id = s2;
  else if (s0 && (s1 === 'status' || s1 === 'statuses')) { user = s0; id = s2; }
  else if (s0 === 'statuses') id = s1;
  if (id && /^\d{1,20}$/.test(id)) {
    const handle = user && user !== 'i' && /^[A-Za-z0-9_]{1,15}$/.test(user) ? user : null;
    return result('x', {
      id, subtype: 'post',
      canonical: handle ? `https://x.com/${handle}/status/${id}` : `https://x.com/i/status/${id}`,
      key: 'x:' + id,
      // the frame also accepts &embedId=<string>; it is echoed as the JSON-RPC "id" of its messages
      embed: makeEmbed(`https://platform.twitter.com/embed/Tweet.html?id=${id}&dnt=true&theme=dark`, {
        height: 320,
        autoHeight: 'x',
      }),
    });
  }
  if (s0 && /^[A-Za-z0-9_]{1,15}$/.test(s0) && !X_RESERVED.has(s0.toLowerCase()) &&
      (segs.length === 1 || (segs.length === 2 && X_PROFILE_TABS.has(s1)))) {
    const handle = s0.toLowerCase();
    return result('x', {
      id: handle, subtype: 'profile',
      canonical: `https://x.com/${s0}`,
      key: 'x:@' + handle,
    });
  }
  return generic('x', u);
}

// Vimeo ----------------------------------------------------------------------
function parseVimeo(u, base, segs) {
  if (base !== 'vimeo.com' && base !== 'player.vimeo.com') return null;
  const D = /^\d{1,15}$/;
  const HASH = /^[0-9a-f]{6,20}$/i;
  const [s0, s1, s2, s3] = segs;
  let id = null;
  let hash = u.searchParams.get('h');
  if (base === 'player.vimeo.com') {
    if (s0 === 'video' && D.test(s1 || '')) id = s1;
  } else if (D.test(s0 || '')) {
    id = s0;
    if (s1 && HASH.test(s1)) hash = s1;
  } else if (s0 === 'channels' && D.test(s2 || '')) id = s2;
  else if (s0 === 'groups' && s2 === 'videos' && D.test(s3 || '')) id = s3;
  else if ((s0 === 'album' || s0 === 'showcase') && s2 === 'video' && D.test(s3 || '')) id = s3;
  else if (s0 === 'video' && D.test(s1 || '')) id = s1;
  else if (s0 === 'manage' && s1 === 'videos' && D.test(s2 || '')) id = s2;
  if (id) {
    hash = hash && HASH.test(hash) ? hash.toLowerCase() : null;
    return result('vimeo', {
      id, subtype: 'video',
      canonical: `https://vimeo.com/${id}${hash ? '/' + hash : ''}`,
      key: 'vimeo:' + id,
      embed: makeEmbed(`https://player.vimeo.com/video/${id}?${hash ? `h=${hash}&` : ''}dnt=1`, { aspect: 16 / 9 }),
    });
  }
  return generic('vimeo', u);
}

// Google Drive ---------------------------------------------------------------
const G_ID = /^[A-Za-z0-9_-]{10,}$/;

function parseDrive(u, base, segs) {
  const isDrive = base === 'drive.google.com' || base === 'drive.usercontent.google.com';
  const isDocs = base === 'docs.google.com';
  if (!isDrive && !isDocs) return null;
  const p = u.pathname;
  const q = u.searchParams;
  let id = null;
  let folder = null;
  const fm = /\/file\/(?:u\/\d+\/)?d\/([A-Za-z0-9_-]{10,})/.exec(p);
  if (fm) id = fm[1];
  else if (isDrive) {
    const dm = /\/folders\/([A-Za-z0-9_-]{10,})/.exec(p);
    if (dm) folder = dm[1];
    else if (/^\/(?:folderview|embeddedfolderview)$/.test(p) && G_ID.test(q.get('id') || '')) folder = q.get('id');
    else if (/^\/(?:open|uc|download|thumbnail)$/.test(p) && G_ID.test(q.get('id') || '')) id = q.get('id');
  } else if (/^\/(?:open|uc)$/.test(p) && G_ID.test(q.get('id') || '')) id = q.get('id');
  if (!id && !folder) return isDrive ? generic('drive', u) : null; // other docs.google.com paths -> parseGDocs
  const rk = q.get('resourcekey');
  const rkq = rk && /^[A-Za-z0-9_-]{1,64}$/.test(rk) ? `?resourcekey=${rk}` : '';
  if (folder) {
    return result('drive', {
      id: folder, subtype: 'folder',
      canonical: `https://drive.google.com/drive/folders/${folder}${rkq}`,
      key: 'drive:' + folder,
      embed: makeEmbed(`https://drive.google.com/embeddedfolderview?id=${folder}${rkq ? '&' + rkq.slice(1) : ''}#grid`, { height: 420 }),
    });
  }
  return result('drive', {
    id, subtype: 'file',
    canonical: `https://drive.google.com/file/d/${id}/view${rkq}`,
    key: 'drive:' + id,
    embed: makeEmbed(`https://drive.google.com/file/d/${id}/preview${rkq}`, { aspect: 4 / 3 }),
    // 302 -> lh3.googleusercontent.com for files shared "anyone with the link"; private files 403 (use onerror)
    thumb: `https://drive.google.com/thumbnail?id=${id}&sz=w800`,
  });
}

// Google Docs / Sheets / Slides / Forms / Drawings ---------------------------
const GDOC_TYPES = { document: 'doc', spreadsheets: 'sheet', presentation: 'slides', forms: 'form', drawings: 'drawing' };

function parseGDocs(u, base, segs) {
  if (base !== 'docs.google.com') return null;
  let s = segs.slice();
  if (s[0] === 'a' && s[1]) s = s.slice(2);
  const seg = s[0];
  const type = GDOC_TYPES[seg];
  if (!type) return generic('gdocs', u);
  s = s.slice(1);
  if (s[0] === 'u' && /^\d+$/.test(s[1] || '')) s = s.slice(2);
  if (s[0] !== 'd') return generic('gdocs', u);
  let pub = false;
  let id = s[1];
  if (id === 'e') { pub = true; id = s[2]; }
  if (!id || !G_ID.test(id)) return generic('gdocs', u);
  const b = `https://docs.google.com/${seg}/d/${pub ? 'e/' : ''}${id}`;
  let canonical;
  let embed = null;
  if (type === 'doc') {
    canonical = pub ? b + '/pub' : b + '/edit';
    embed = makeEmbed(pub ? b + '/pub?embedded=true' : b + '/preview', { height: 480 });
  } else if (type === 'sheet') {
    canonical = pub ? b + '/pubhtml' : b + '/edit';
    embed = makeEmbed(pub ? b + '/pubhtml?widget=true&headers=false' : b + '/preview', { height: 480 });
  } else if (type === 'slides') {
    canonical = pub ? b + '/pub' : b + '/edit';
    embed = makeEmbed(b + '/embed', { aspect: 960 / 569 });
  } else if (type === 'form') {
    canonical = b + '/viewform';
    embed = makeEmbed(b + '/viewform?embedded=true', { height: 640 });
  } else {
    canonical = b + '/edit'; // drawings: embed not verified -> preview card
  }
  return result('gdocs', {
    id, subtype: type, canonical,
    key: 'gdocs:' + (pub ? 'e:' : '') + id,
    embed,
    thumb: pub ? null : `https://drive.google.com/thumbnail?id=${id}&sz=w800`,
  });
}

// Facebook -------------------------------------------------------------------
const FB_DIGITS = /^\d{5,25}$/;
const FB_POST = /^(?:\d{5,25}|pfbid[A-Za-z0-9]{10,80})$/;
const FB_NAME = /^[A-Za-z0-9._-]{1,100}$/;

function isFacebookHost(base) {
  return base === 'facebook.com' || base === 'fb.com' ||
    /^(?:web|mbasic|touch|business|free|mtouch|upload)\.facebook\.com$/.test(base);
}

function fbPluginEmbed(kind, canonical, opts) {
  const href = encodeURIComponent(canonical);
  return kind === 'video'
    ? makeEmbed(`https://www.facebook.com/plugins/video.php?href=${href}&show_text=false`, opts)
    : makeEmbed(`https://www.facebook.com/plugins/post.php?href=${href}&show_text=true&width=500`, opts);
}

function parseFacebook(u, base, segs) {
  if (!isFacebookHost(base)) return null;
  const q = u.searchParams;
  const [s0, s1, s2, s3] = segs;
  if (s0 === 'share') return shortResult('facebook', u);

  let vid = null;
  let sub = 'video';
  if ((s0 === 'watch' || s0 === 'video.php') && FB_DIGITS.test(q.get('v') || '')) vid = q.get('v');
  else if (s0 === 'reel' && FB_DIGITS.test(s1 || '')) { vid = s1; sub = 'reel'; }
  else if (s0 === 'videos' && FB_DIGITS.test(s1 || '')) vid = s1;
  else if (s0 && s1 === 'videos') vid = FB_DIGITS.test(s2 || '') ? s2 : FB_DIGITS.test(s3 || '') ? s3 : null;
  if (vid) {
    const canonical = sub === 'reel' ? `https://www.facebook.com/reel/${vid}` : `https://www.facebook.com/watch/?v=${vid}`;
    return result('facebook', {
      id: vid, subtype: sub, canonical,
      key: 'facebook:' + vid,
      embed: fbPluginEmbed('video', canonical, { aspect: sub === 'reel' ? 9 / 16 : 16 / 9 }),
    });
  }

  let post = null;
  let canonical = null;
  if (s0 === 'permalink.php' || s0 === 'story.php') {
    const sf = q.get('story_fbid');
    const pid = q.get('id');
    if (sf && FB_POST.test(sf)) {
      post = sf;
      canonical = `https://www.facebook.com/permalink.php?story_fbid=${sf}${pid && /^\d+$/.test(pid) ? `&id=${pid}` : ''}`;
    }
  } else if (s0 === 'groups' && s1 && (s2 === 'posts' || s2 === 'permalink') && FB_POST.test(s3 || '')) {
    post = s3;
    canonical = `https://www.facebook.com/groups/${encodeURIComponent(s1)}/posts/${s3}/`;
  } else if (s0 && FB_NAME.test(s0) && s1 === 'posts' && FB_POST.test(s2 || '')) {
    post = s2;
    canonical = `https://www.facebook.com/${s0}/posts/${s2}/`;
  }
  if (post) {
    return result('facebook', {
      id: post, subtype: 'post', canonical,
      key: 'facebook:post:' + post,
      embed: fbPluginEmbed('post', canonical, { height: 560 }),
    });
  }

  let photo = null;
  if ((s0 === 'photo.php' || s0 === 'photo') && FB_DIGITS.test(q.get('fbid') || '')) photo = q.get('fbid');
  else if (s0 && s1 === 'photos' && FB_DIGITS.test(segs[segs.length - 1] || '')) photo = segs[segs.length - 1];
  if (photo) {
    const pc = `https://www.facebook.com/photo/?fbid=${photo}`;
    return result('facebook', {
      id: photo, subtype: 'photo', canonical: pc,
      key: 'facebook:photo:' + photo,
      embed: fbPluginEmbed('post', pc, { height: 560 }),
    });
  }
  return generic('facebook', u);
}

// Spotify --------------------------------------------------------------------
const SP_TYPES = new Set(['track', 'album', 'playlist', 'episode', 'show', 'artist']);

function parseSpotify(u, base, segs) {
  if (base !== 'open.spotify.com' && base !== 'play.spotify.com') return null;
  let s = segs.slice();
  if (s[0] && /^intl-[a-z]{2}(?:-[a-z]{2})?$/i.test(s[0])) s = s.slice(1);
  if (s[0] === 'embed' || s[0] === 'embed-podcast') s = s.slice(1);
  if (s[0] === 'user' && s[2] === 'playlist') s = s.slice(2);
  const [type, id] = s;
  if (SP_TYPES.has(type) && /^[A-Za-z0-9]{22}$/.test(id || '')) {
    return result('spotify', {
      id, subtype: type,
      canonical: `https://open.spotify.com/${type}/${id}`,
      key: `spotify:${type}:${id}`,
      embed: makeEmbed(`https://open.spotify.com/embed/${type}/${id}`, {
        height: type === 'track' || type === 'episode' ? 152 : 352,
      }),
    });
  }
  return generic('spotify', u);
}

// SoundCloud -----------------------------------------------------------------
const SC_RESERVED = new Set([
  'discover', 'stream', 'search', 'upload', 'you', 'settings', 'charts', 'pages', 'terms-of-use', 'mobile', 'jobs',
  'imprint', 'messages', 'notifications', 'people', 'feed', 'tags', 'signin', 'logout', 'home', 'popular', 'connect',
  'oembed', 'widget', 'creators', 'go', 'artists', 'next', 'for-artists', 'community-guidelines', 'apps', 'press',
]);
const SC_USER_TABS = new Set(['tracks', 'albums', 'reposts', 'likes', 'followers', 'following', 'popular-tracks', 'comments', 'spotlight']);
const SC_SLUG = /^[A-Za-z0-9_-]{1,100}$/;
const SC_SECRET = /^s-[A-Za-z0-9]{3,64}$/;

function scEmbed(canonical, subtype) {
  return makeEmbed(`https://w.soundcloud.com/player/?url=${encodeURIComponent(canonical)}&visual=true`, {
    height: subtype === 'track' ? 300 : 450,
  });
}

function parseSoundCloud(u, base, segs) {
  const [s0, s1, s2, s3] = segs;
  if (base === 'api.soundcloud.com') {
    if ((s0 === 'tracks' || s0 === 'playlists') && /^\d+$/.test(s1 || '')) {
      const subtype = s0 === 'tracks' ? 'track' : 'set';
      const canonical = `https://api.soundcloud.com/${s0}/${s1}`;
      return result('soundcloud', { id: `${s0}/${s1}`, subtype, canonical, key: `soundcloud:${s0}/${s1}`, embed: scEmbed(canonical, subtype) });
    }
    return null;
  }
  if (base !== 'soundcloud.com') return null;
  if (!s0 || SC_RESERVED.has(s0.toLowerCase()) || !SC_SLUG.test(s0)) return generic('soundcloud', u);
  let path;
  let subtype;
  if (!s1 || SC_USER_TABS.has(s1) || (s1 === 'sets' && !s2)) {
    subtype = 'user'; path = s0;
  } else if (s1 === 'sets' && SC_SLUG.test(s2 || '')) {
    subtype = 'set'; path = `${s0}/sets/${s2}${s3 && SC_SECRET.test(s3) ? '/' + s3 : ''}`;
  } else if (SC_SLUG.test(s1)) {
    subtype = 'track'; path = `${s0}/${s1}${s2 && SC_SECRET.test(s2) ? '/' + s2 : ''}`;
  } else {
    return generic('soundcloud', u);
  }
  const canonical = `https://soundcloud.com/${path}`;
  return result('soundcloud', {
    id: path.toLowerCase(), subtype, canonical,
    key: 'soundcloud:' + path.toLowerCase(),
    embed: scEmbed(canonical, subtype),
  });
}

// Loom -----------------------------------------------------------------------
function parseLoom(u, base, segs) {
  if (base !== 'loom.com') return null;
  const [s0, s1] = segs;
  if ((s0 === 'share' || s0 === 'embed' || s0 === 'v') && s1) {
    const m = /([0-9a-f]{32})$/i.exec(s1);
    if (m) {
      const id = m[1].toLowerCase();
      return result('loom', {
        id, subtype: 'video',
        canonical: `https://www.loom.com/share/${id}`,
        key: 'loom:' + id,
        embed: makeEmbed(`https://www.loom.com/embed/${id}`, { aspect: 16 / 9 }),
      });
    }
  }
  return generic('loom', u);
}

// Figma ----------------------------------------------------------------------
const FIGMA_TYPES = { file: 'design', design: 'design', proto: 'proto', board: 'board', slides: 'slides' };

function parseFigma(u, base, segs) {
  if (base !== 'figma.com' && base !== 'embed.figma.com') return null;
  const [s0, s1, s2] = segs;
  if (s0 === 'community' && s1 === 'file' && /^\d+$/.test(s2 || '')) {
    return result('figma', {
      id: s2, subtype: 'community',
      canonical: `https://www.figma.com/community/file/${s2}`,
      key: 'figma:community:' + s2,
    });
  }
  const type = FIGMA_TYPES[s0];
  if (type && /^[A-Za-z0-9]{10,64}$/.test(s1 || '')) {
    const name = s2 && s2 !== 'branch' && s2 !== 'duplicate' && s2.length <= 200 ? s2 : null;
    let node = u.searchParams.get('node-id');
    node = node && /^\d+[-:]\d+$/.test(node) ? node.replace(':', '-') : null;
    return result('figma', {
      id: s1, subtype: type,
      canonical: `https://www.figma.com/${type}/${s1}${name ? '/' + encodeURIComponent(name) : ''}${node ? `?node-id=${node}` : ''}`,
      key: 'figma:' + s1 + (node ? ':' + node : ''),
      // embed-host is required (400 without it); redirects via /embed/interstitial to a frameable page
      embed: makeEmbed(`https://embed.figma.com/${type}/${s1}?embed-host=share${node ? `&node-id=${node}` : ''}`, { aspect: 16 / 9 }),
    });
  }
  return generic('figma', u);
}

// Threads (embed requires login -> preview card) ------------------------------
function parseThreads(u, base, segs) {
  if (base !== 'threads.net' && base !== 'threads.com') return null;
  const [s0, s1, s2] = segs;
  const CODE = /^[A-Za-z0-9_-]{5,64}$/;
  const user = s0 && s0.startsWith('@') && /^[A-Za-z0-9._]{1,30}$/.test(s0.slice(1)) ? s0.slice(1).toLowerCase() : null;
  if (user && s1 === 'post' && CODE.test(s2 || '')) {
    return result('threads', {
      id: s2, subtype: 'post',
      canonical: `https://www.threads.com/@${user}/post/${s2}`,
      key: 'threads:' + s2,
    });
  }
  if (s0 === 't' && CODE.test(s1 || '')) {
    return result('threads', {
      id: s1, subtype: 'post',
      canonical: `https://www.threads.com/t/${s1}`,
      key: 'threads:' + s1,
    });
  }
  if (user && segs.length === 1) {
    return result('threads', {
      id: user, subtype: 'profile',
      canonical: `https://www.threads.com/@${user}`,
      key: 'threads:@' + user,
    });
  }
  return generic('threads', u);
}

// LinkedIn -------------------------------------------------------------------
function parseLinkedIn(u, base, segs) {
  if (base !== 'linkedin.com' && !/^[a-z]{2}\.linkedin\.com$/.test(base)) return null;
  const [s0, s1, s2, s3] = segs;
  let type = null;
  let id = null;
  let canonical = null;
  let urn = null;
  if (s0 === 'posts' && s1) {
    const m = /(?:^|[-_])(activity|ugcPost|share)-(\d{10,25})(?:-|$)/.exec(s1);
    if (m) {
      type = m[1]; id = m[2];
      canonical = `https://www.linkedin.com/posts/${encodeURIComponent(s1)}/`;
    }
  } else if (s0 === 'feed' && s1 === 'update' && s2) urn = s2;
  else if (s0 === 'embed' && s1 === 'feed' && s2 === 'update' && s3) urn = s3;
  if (urn) {
    const m = /^urn:li:(activity|ugcPost|share):(\d{10,25})$/.exec(urn);
    if (m) {
      type = m[1]; id = m[2];
      canonical = `https://www.linkedin.com/feed/update/urn:li:${type}:${id}/`;
    }
  }
  if (id) {
    return result('linkedin', {
      id, subtype: type, canonical,
      key: `linkedin:${type}:${id}`,
      // frame-ancestors * ; no resize messages -> fixed height, scrolls inside
      embed: makeEmbed(`https://www.linkedin.com/embed/feed/update/urn:li:${type}:${id}`, { height: 600 }),
    });
  }
  return generic('linkedin', u);
}

// Behance (project embed) / Dribbble (preview card) ----------------------------
function parseBehance(u, base, segs) {
  if (base !== 'behance.net') return null;
  const [s0, s1, s2] = segs;
  if (s0 === 'gallery' && /^\d{4,15}$/.test(s1 || '')) {
    return result('behance', {
      id: s1, subtype: 'project',
      canonical: `https://www.behance.net/gallery/${s1}${s2 ? '/' + encodeURIComponent(s2) : ''}`,
      key: 'behance:' + s1,
      // Behance's own embed code (404x316 cover + title bar); renders cross-site (checked 2026-10-05).
      embed: makeEmbed(`https://www.behance.net/embed/project/${s1}?ilo0=1`, { aspect: 404 / 316 }),
    });
  }
  return generic('behance', u);
}

function parseDribbble(u, base, segs) {
  if (base !== 'dribbble.com') return null;
  const [s0, s1] = segs;
  const m = s0 === 'shots' ? /^(\d{3,15})(?:-.*)?$/.exec(s1 || '') : null;
  if (m) {
    return result('dribbble', {
      id: m[1], subtype: 'shot',
      canonical: `https://dribbble.com/shots/${encodeURIComponent(s1)}`,
      key: 'dribbble:' + m[1],
    });
  }
  return generic('dribbble', u);
}

// Direct files and everything else -------------------------------------------
const IMAGE_EXT = /\.(?:jpe?g|png|gif|webp|avif|svg)$/i;
const VIDEO_EXT = /\.(?:mp4|webm|mov|m4v)$/i;

function parseWeb(u, base) {
  const clean = cleanURL(u);
  const path = safeDecode(clean.pathname);
  const twimgFormat = base === 'pbs.twimg.com' && /^(?:jpe?g|png|webp|gif)$/i.test(clean.searchParams.get('format') || '');
  if (IMAGE_EXT.test(path) || twimgFormat) {
    return result('image', { canonical: clean.href, key: 'image:' + keyBody(clean), thumb: clean.href });
  }
  if (VIDEO_EXT.test(path)) {
    return result('video', { canonical: clean.href, key: 'video:' + keyBody(clean) });
  }
  return result('web', { canonical: clean.href, key: 'web:' + keyBody(clean) });
}

const PARSERS = [
  parseInstagram, parseYouTube, parseTikTok, parsePinterest, parseX, parseVimeo, parseDrive, parseGDocs,
  parseFacebook, parseSpotify, parseSoundCloud, parseLoom, parseFigma, parseThreads, parseLinkedIn,
  parseBehance, parseDribbble,
];

/* ------------------------------------------------------------- public API */

/**
 * Parse a pasted link. Returns null for anything that is not an http(s) URL.
 * Scheme-less input ("instagram.com/reel/X") is accepted as https, and when the
 * input is text containing a URL ("Check this out https://...") the first URL is used.
 */
export function parseLink(input) {
  let u = toURL(input);
  if (!u) return null;
  for (let i = 0; i < 3; i++) {
    const inner = unwrapRedirector(u);
    if (!inner) break;
    u = inner;
  }
  const base = baseHost(u.hostname);
  const segs = u.pathname.split('/').filter(Boolean).map(safeDecode);
  const short = Object.prototype.hasOwnProperty.call(SHORT_LINK_HOSTS, base) ? SHORT_LINK_HOSTS[base] : null;
  if (short && segs.length) return shortResult(short, u);
  for (const parse of PARSERS) {
    const r = parse(u, base, segs);
    if (r) return r;
  }
  return parseWeb(u, base);
}

/**
 * Media kind of a direct file URL from its path extension: 'video' (.mp4 .webm .mov .m4v), 'image' (.jpg .jpeg .png
 * .gif .webp .avif), 'hls' (.m3u8) or null (anything else, including .svg). Accepts absolute http(s) URLs and
 * site-relative paths ("/files/..."); no network, no content sniffing.
 */
export function mediaKindOf(url) {
  if (typeof url !== 'string' || !url) return null;
  let u;
  try { u = new URL(url, url.startsWith('/') ? 'https://media.invalid' : undefined); } catch { return null; }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
  const path = safeDecode(u.pathname);
  if (/\.svgz?$/i.test(path)) return null;
  if (/\.m3u8$/i.test(path)) return 'hls';
  if (VIDEO_EXT.test(path)) return 'video';
  if (IMAGE_EXT.test(path)) return 'image';
  return null;
}

/**
 * Remove tracking parameters (and a non-route #fragment) from a URL.
 * Returns the cleaned absolute URL string, or null if the input is not an http(s) URL.
 * Remaining query parameters keep their original order and encoding.
 */
export function stripTracking(input) {
  const u = toURL(input);
  return u ? cleanURL(u).href : null;
}

/* ------------------------------------------------- embed resize messages */

// Origins that post height messages to the parent window.
export const EMBED_MESSAGE_ORIGINS = Object.freeze({
  instagram: Object.freeze(['https://www.instagram.com']),
  x: Object.freeze(['https://platform.twitter.com']),
});

/**
 * Decode a window 'message' event coming from an autoHeight embed.
 *   parseEmbedMessage(event.origin, event.data)
 *     -> null | { kind: 'instagram'|'x', type: string, id: string|null, height: number|null }
 * `height` is only set for a real resize with a positive height (Instagram sends
 * MEASURE {height: 0} while the frame is hidden/unlaid-out; it must be ignored).
 * Match the frame with event.source === iframe.contentWindow (Instagram messages carry
 * no id); X echoes the &embedId= query value as `id`.
 *
 * Instagram (data is a JSON *string*), sent on load, on window resize and via ResizeObserver:
 *   '{"details":{},"type":"LOADING"}'
 *   '{"details":{"height":608},"type":"MEASURE"}'
 *   '{"details":{"styles":[["boxShadow","none"],...]},"type":"MOUNTED"}'
 * X (data is an *object*), resize is sent once the tweet renders (only when visible):
 *   {"twttr.embed":{"jsonrpc":"2.0","method":"twttr.private.resize","id":"<embedId|embed-0>",
 *                   "params":[{"width":400,"height":225,"data":{"tweet_id":"20"}}]}}
 */
export function parseEmbedMessage(origin, data) {
  let d = data;
  if (typeof d === 'string') {
    if (d.length > 100000) return null;
    try { d = JSON.parse(d); } catch (_) { return null; }
  }
  if (!d || typeof d !== 'object') return null;
  if (EMBED_MESSAGE_ORIGINS.instagram.includes(origin)) {
    if (typeof d.type !== 'string') return null;
    const h = d.type === 'MEASURE' && d.details ? Number(d.details.height) : NaN;
    return { kind: 'instagram', type: d.type, id: null, height: Number.isFinite(h) && h > 0 ? Math.round(h) : null };
  }
  if (EMBED_MESSAGE_ORIGINS.x.includes(origin)) {
    const m = d['twttr.embed'];
    if (!m || typeof m !== 'object' || typeof m.method !== 'string') return null;
    const p = Array.isArray(m.params) && m.params[0] && typeof m.params[0] === 'object' ? m.params[0] : null;
    const h = m.method === 'twttr.private.resize' && p ? Number(p.height) : NaN;
    return {
      kind: 'x',
      type: m.method,
      id: m.id == null ? null : String(m.id),
      height: Number.isFinite(h) && h > 0 ? Math.round(h) : null,
    };
  }
  return null;
}
