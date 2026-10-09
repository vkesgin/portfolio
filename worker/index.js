import { parseLink, MAX_URL_LENGTH, mediaKindOf } from '../assets/js/fikir-url.mjs';
import {
  handleStoryboard, sbConfigPayload, sbAttachSummaries, sbStartForNewPost, sbDeleteForPost, sbScheduled, ensureStoryboardSchema,
} from './storyboard/routes.js';
import { ipBucket, utcDay, nextResetIso, isCheckError } from './storyboard/db.js';
import {
  META_V, MAX_HEAD_BYTES, MAX_PAGE_BYTES, AUTOPLAY_MAX_BYTES, FILES_KEY_RE, MEDIA_MIMES,
  inspireDecodeEntities, inspireAttrs, inspireMetaText, parseHead, wantsBody, scanBody, mergeCollected, collectFromScrape,
  extractMedia, isBlocked, isExpiringUrl, stableVariantFor, adapterFor, sanitizeMedia, sniffMagic, oembedMedia, sameSite, COPY_SOURCES,
} from './inspire-media.js';
import {
  IG_UA, igRef, igResolve, igCheckEmbed, openMedia, openMuxed, contentDisposition, titleSlug, dlHint, dlAdapterFor,
  adToCache, adFromCache, VIDEO_CACHE_DDL, vcGet, vcPut, vcFail, vcDefer, vcExtra, vcItemFresh, vcBackingOff, itemToCache, cacheToItem,
  igCacheCaptionCut, copyTargetOf, copyKind, imageDims, COPY_PLATFORM_TR, redditRef,
} from './inspire-video.js';
import { Budget, CRON_BUDGET, CRON_COSTS, CRON_IG, withBudget } from './budget.js';
import {
  boardPv, boardLocked, checkBoardPassword, guestPvOk, dlTicket, dlTicketRole, filesGateOn, filesToken, filesTokenTtl,
  signFilesJson, FILES_GATED_RE,
} from './fikir-gate.js';
// Cloudflare Workflows: the class named in wrangler.toml [[workflows]] class_name must be exported by the main module.
export { StoryboardWorkflow } from './storyboard/workflow.js';

const CORS = (origin) => ({
  'Access-Control-Allow-Origin':  origin || '*',
  'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type,Authorization',
  'Access-Control-Max-Age':       '86400',
});

function json(data, status = 200, origin) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS(origin) }
  });
}

// JWT — Web Crypto API
async function signJWT(payload, secret) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  const header  = btoa(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body    = btoa(JSON.stringify({ ...payload, iat: Date.now() }));
  const sig     = await crypto.subtle.sign('HMAC', key, enc.encode(`${header}.${body}`));
  const sigB64  = btoa(String.fromCharCode(...new Uint8Array(sig)));
  return `${header}.${body}.${sigB64}`;
}

async function verifyJWT(token, secret) {
  try {
    const [header, body, sig] = token.split('.');
    const enc = new TextEncoder();
    const key = await crypto.subtle.importKey(
      'raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']
    );
    const sigBytes = Uint8Array.from(atob(sig), c => c.charCodeAt(0));
    const valid = await crypto.subtle.verify('HMAC', key, sigBytes, enc.encode(`${header}.${body}`));
    if (!valid) return null;
    return JSON.parse(atob(body));
  } catch { return null; }
}

function nanoid() {
  return crypto.randomUUID().replace(/-/g,'').slice(0,16);
}

async function authMiddleware(request, env) {
  const auth = request.headers.get('Authorization') || '';
  const token = auth.replace('Bearer ', '');
  if (!token) return null;
  const p = await verifyJWT(token, env.JWT_SECRET || 'secret');
  return p && p.role === 'admin' && ownerTokenRevoked(p, env) ? null : p;
}

// Owner/admin tokens minted with ADMIN_PASSWORD carry no expiry (KPSS, portfolio admin) or last 30 days (inspire), so
// rotating the password alone does not cut off a token minted with a leaked one. ADMIN_TOKENS_NOT_BEFORE (wrangler.toml
// [vars]: ISO date-time such as "2026-10-06T12:00:00Z", or epoch seconds/ms) rejects every owner/admin token issued
// before it: KPSS 'vkesgin38', portfolio admin {role:'admin'}, inspire admin. Unset/empty = off (no change). A value
// that cannot be parsed rejects them all (fail closed) and logs an error. Other users' tokens are never affected.
function ownerTokenRevoked(payload, env) {
  const v = String(env.ADMIN_TOKENS_NOT_BEFORE || '').trim();
  if (!v) return false;
  const cutoff = /^\d+$/.test(v) ? (Number(v) > 1e12 ? Number(v) : Number(v) * 1000) : Date.parse(v);
  if (!Number.isFinite(cutoff)) { console.error('ADMIN_TOKENS_NOT_BEFORE is not a date; owner/admin tokens rejected'); return true; }
  const iat = Number(payload && payload.iat);
  const iatMs = !Number.isFinite(iat) ? 0 : iat > 1e12 ? iat : iat * 1000;   // portfolio/KPSS/old inspire: ms, inspire: s
  return iatMs < cutoff;
}

// KPSS JWT helpers
async function signKpssJWT(payload, secret) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw', enc.encode(secret + '_kpss'), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  const header = btoa(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body   = btoa(JSON.stringify({ ...payload, iat: Date.now() }));
  const sig    = await crypto.subtle.sign('HMAC', key, enc.encode(`${header}.${body}`));
  return `${header}.${body}.${btoa(String.fromCharCode(...new Uint8Array(sig)))}`;
}
async function verifyKpssJWT(token, secret) {
  try {
    const [header, body, sig] = token.split('.');
    const enc = new TextEncoder();
    const key = await crypto.subtle.importKey(
      'raw', enc.encode(secret + '_kpss'), { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']
    );
    const valid = await crypto.subtle.verify('HMAC', key,
      Uint8Array.from(atob(sig), c => c.charCodeAt(0)),
      enc.encode(`${header}.${body}`)
    );
    if (!valid) return null;
    return JSON.parse(atob(body));
  } catch { return null; }
}
async function kpssAuth(request, env) {
  const token = (request.headers.get('Authorization') || '').replace('Bearer ', '');
  if (!token) return null;
  const p = await verifyKpssJWT(token, env.JWT_SECRET || 'secret');
  return p && p.username === KPSS_OWNER_USERNAME && ownerTokenRevoked(p, env) ? null : p;
}
// KPSS owner account: 'vkesgin38' authenticates with the CURRENT env.ADMIN_PASSWORD only (constant-time compare,
// inspireSafeEqual), never with the password column of its kpss_users row. Older code copied ADMIN_PASSWORD into that
// row and later accepted the stored copy, so a rotated (leaked) password kept working. The row now holds an unusable
// value ('!' + 2 UUIDs, as for inspire_users); this one-time, idempotent migration overwrites any older stored copy.
const KPSS_OWNER_USERNAME = 'vkesgin38';
let kpssOwnerMigrated = null;
function migrateKpssOwnerPassword(env) {
  if (!kpssOwnerMigrated) {
    kpssOwnerMigrated = env.DB.prepare(
      "UPDATE kpss_users SET password=? WHERE username=? AND NOT (substr(password, 1, 1) = '!' AND length(password) = 73)"
    ).bind(inspireUnusablePassword(), KPSS_OWNER_USERNAME).run()
      .catch((e) => { kpssOwnerMigrated = null; throw e; });
  }
  return kpssOwnerMigrated;
}
async function kpssOwnerPasswordOk(env, password) {
  return !!env.ADMIN_PASSWORD && typeof password === 'string' && await inspireSafeEqual(password, env.ADMIN_PASSWORD);
}

// ─── INSPIRE (Fikir Havuzu) HELPERS ───
// Tokens: HMAC-SHA256 with key JWT_SECRET + '_inspire'. New tokens are base64url(UTF-8 JSON) so Turkish
// names (ş, ğ, ı) survive; tokens made by the old btoa() helper (standard base64 of Latin-1 JSON) still verify.
// Payloads: guest {g:1, cid, name, pv, iat, exp}  |  registered/admin {userId, username, iat, exp}
// iat/exp are seconds (JWT NumericDate). Old tokens have no exp (still valid) and a millisecond iat.
// Board password gate (worker/fikir-gate.js): a guest token is valid only while its pv is the current board password's;
// guest tokens without pv (minted before the gate) are rejected.
const INSPIRE_ADMIN_USERNAME = 'vkesgin38';
const INSPIRE_GUEST_USERNAME = '__guest__';           // reserved inspire_users row that owns guest posts/notes
const INSPIRE_GUEST_TTL_S    = 180 * 24 * 60 * 60;
const INSPIRE_USER_TTL_S     = 30 * 24 * 60 * 60;
const INSPIRE_CID_RE         = /^[A-Za-z0-9_-]{16,64}$/;
const INSPIRE_MAX_NAME       = 40;
const INSPIRE_MAX_NOTE       = 1000;
const INSPIRE_MAX_TEXT       = 2000;
const INSPIRE_MAX_DESC       = 2000;
const INSPIRE_MAX_BODY       = 64 * 1024;
// Server-side fetches (short-link resolve, OG metadata)
const INSPIRE_FETCH_TIMEOUT_MS = 5000;   // per hop
const INSPIRE_FETCH_BUDGET_MS  = 8000;   // whole redirect chain
const INSPIRE_MAX_HOPS         = 5;
const INSPIRE_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36';
// Platforms that never embed (or embed poorly) and always need a preview card; other platforms get a
// best-effort background fetch. Direct image/video files need no metadata.
const INSPIRE_CARD_PLATFORMS = new Set(['web', 'behance', 'dribbble', 'linkedin', 'threads', 'figma', 'gdocs']);
// Titles that describe a login wall, consent/challenge page or the bare platform, not the content.
const INSPIRE_GENERIC_TITLES = new Set([
  'instagram', 'tiktok', 'tiktok - make your day', 'x', 'twitter', 'facebook', 'log into facebook', 'facebook - log in or sign up',
  'youtube', 'before you continue to youtube', 'before you continue', 'pinterest', 'linkedin', 'threads', 'vimeo', 'spotify',
  'spotify – web player', 'spotify - web player',
  'soundcloud', 'login', 'log in', 'sign in', 'sign up', 'just a moment...', 'access denied', 'attention required! | cloudflare',
  'error', 'forbidden', 'page not found', '404 not found', 'not found',
]);
// Uploaded previews (POST /posts/:id/media/upload): caps per file; the type comes from the magic bytes only.
const INSPIRE_UP_VIDEO_MB = 25;
const INSPIRE_UP_IMAGE_MB = 10;
const INSPIRE_UP_TYPES = ['video/mp4', 'video/webm', 'video/quicktime', 'image/jpeg', 'image/png', 'image/webp', 'image/gif'];
// Per-isolate cache of POST /preview results (key: canonical URL, 10 min); POST /posts reuses it instead of refetching.
const INSPIRE_PREVIEW_TTL_MS = 10 * 60e3;
// GET /api/inspire/posts page size (newest first, ?before=<id> cursor; X-Fikir-Next names the next cursor)
const INSPIRE_PAGE_SIZE = 200;
// A failed preview fetch is stored as meta '{"failed":1,"at":<s>}' and not retried before this
const INSPIRE_META_RETRY_S = 2 * 24 * 60 * 60;
// Browser Run found the page removed (404/410): that post is not retried before this (owner's ?force=1 still can)
const INSPIRE_BR_GONE_RETRY_S = 30 * 24 * 60 * 60;
// Browser Run calls per post per UTC day (create + retries + owner refreshes): a page that keeps failing costs <= 3 calls a day
const INSPIRE_BR_PER_POST = 3;
// The board shows "Önizleme hazırlanıyor…" (meta_pending) only while the Browser Run attempt is due within this many seconds
const INSPIRE_PENDING_NEAR_S = 120;
// Rate limits: bucket -> [max requests, window seconds]. Counted in D1 (inspire_rate), fixed windows.
const INSPIRE_LIMITS = {
  guest:    [30, 600],    // guest tokens per IP / 10 min (POST /guest with the right password, POST /guest/rename)
  login:    [5, 900],     // FAILED password logins per IP / 15 min
  board_pw: [8, 900],     // WRONG board passwords (POST /guest) per IP / 15 min; the next attempt gets 429 until the window ends
  board_pw_net: [40, 900], //   ... per network (IPv6 /48, IPv4 /24: one tunnel or hosting block holds 65,536 /64s) / 15 min
  board_pw_all: [300, 3600], // ... site-wide (key 'board_pw_all:all') / hour; over it only IPs with a recent board_ok are checked
  board_ok: [0, 30 * 86400], // marker (key 'board_ok:<ip>'): this IP entered the right board password within 30 days
  post:     [30, 3600],   // new posts per guest cid or user / hour
  post_ip:  [60, 3600],   // new posts per IP / hour
  note:     [60, 3600],   // new notes per guest cid or user / hour
  note_ip:  [120, 3600],
  check:    [30, 60],     // duplicate checks per cid or user / minute (may resolve short links)
  check_ip: [60, 60],
  fetch_ip: [30, 60],     // /posts/:id/meta calls that fetch a third-party page, per IP / minute
  sb:       [30, 600],    // storyboard create / redraw / rewrite / resume / delete per cid or user / 10 min
  sb_ip:    [60, 600],    //   (cost is capped separately by the daily sb_quota counters)
  preview:  [20, 60],     // add-modal live previews (POST /preview) per cid or user / minute
  preview_ip: [40, 60],
  media:    [30, 3600],   // PUT/DELETE /posts/:id/media and /meta?force=1 per cid or user / hour
  media_ip: [60, 3600],
  upload:   [12, 3600],   // POST /posts/:id/media/upload per cid or user / hour (bytes are capped by inspire_quota)
  upload_ip: [24, 3600],
  br_slot:  [1, 11],      // site-wide Browser Run slot (key 'br_slot:all'): Free allows 1 Quick Action per 10 s
  br_block: [3, 7 * 86400], // bot-walled Browser Run scrapes per host / 7 days (at most one per post, see br_bpost); at 3 the host
                            // is skipped for the rest of the window (one challenge can be transient: Magnific blocked 1 of 4
                            // scrapes in the Phase D acceptance run). A 404 / empty page is never a strike.
  br_bpost: [1, 7 * 86400], // key '<host>:<post id>': the first bot wall of a post is its host's strike, repeats are not
  // Downloads + Instagram copies (worker/inspire-video.js). The download link is opened as a navigation (no Authorization
  // header): it carries the session's 15-minute ticket from download-info (worker/fikir-gate.js dlTicket).
  dl_ip:    [40, 600],    // GET /posts/:id/download per IP / 10 min
  dl_info_ip: [120, 600], // GET /posts/:id/download-info per IP / 10 min
  ig_fetch: [20, 600],    // site-wide (key 'ig_fetch:all'): Instagram page + embed fetches by the worker / 10 min
  igcopy:   [10, 3600],   // POST /posts/:id/ig-copy per cid or user / hour (bytes count into the upload quotas)
  igcopy_ip: [20, 3600],
  igcopy_lock: [1, 120],  // key '<post id>': one copy of a post at a time (every platform; cron, on view, on request)
  copyview: [60, 3600],   // POST /posts/:id/copy (a card in view asks for its R2 copy) per cid or user / hour; the copies
  copyview_ip: [120, 3600], //   themselves are capped per day by FIKIR_COPY_VIEW_* (inspire_quota)
  igrep:    [10, 3600],   // POST /posts/:id/ig-blocked reports per cid or user / hour
  igrep_ip: [30, 3600],
  ad_fetch: [20, 600],    // site-wide, key '<adapter name>': platform page/API resolves for downloads (X, TikTok, ...) / 10 min
  ad_rss:   [2, 60],      // site-wide (key 'all'): Reddit post feeds (Reddit allows ~1 request / minute / IP)
};
// Guest display names that would pass for the owner (compared after inspireFoldName()).
const INSPIRE_RESERVED_NAMES = ['yonetici', 'admin', 'administrator', 'moderator', 'moderatör', 'site sahibi'];
const INSPIRE_RESERVED_PARTS = ['veli kesgin', 'vkesgin'];

function b64urlFromBytes(bytes) {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x2000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x2000));
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
// Accepts base64url and standard base64, with or without padding.
function bytesFromB64(str) {
  let t = String(str).replace(/-/g, '+').replace(/_/g, '/').replace(/=+$/, '');
  if (t.length % 4 === 1) throw new Error('bad base64');
  t += '='.repeat((4 - (t.length % 4)) % 4);
  const bin = atob(t);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
function inspireLatin1(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x2000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x2000));
  return s;
}
function inspireTokenJSON(part) {
  const bytes = bytesFromB64(part);
  let text;
  try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
  catch { text = inspireLatin1(bytes); }   // legacy btoa() token with Latin-1 characters
  return JSON.parse(text);
}
async function inspireHmacKey(secret, usage) {
  return crypto.subtle.importKey(
    'raw', new TextEncoder().encode(secret + '_inspire'), { name: 'HMAC', hash: 'SHA-256' }, false, [usage]
  );
}
async function signInspireJWT(payload, secret, ttlSeconds) {
  const enc = new TextEncoder();
  const now = Math.floor(Date.now() / 1000);
  const header = b64urlFromBytes(enc.encode(JSON.stringify({ alg: 'HS256', typ: 'JWT' })));
  const body   = b64urlFromBytes(enc.encode(JSON.stringify({ ...payload, iat: now, exp: now + ttlSeconds })));
  const sig    = await crypto.subtle.sign('HMAC', await inspireHmacKey(secret, 'sign'), enc.encode(`${header}.${body}`));
  return `${header}.${body}.${b64urlFromBytes(new Uint8Array(sig))}`;
}
async function verifyInspireJWT(token, secret) {
  try {
    const parts = String(token).split('.');
    if (parts.length !== 3) return null;
    const [header, body, sig] = parts;
    const valid = await crypto.subtle.verify('HMAC', await inspireHmacKey(secret, 'verify'),
      bytesFromB64(sig), new TextEncoder().encode(`${header}.${body}`));
    if (!valid) return null;
    const payload = inspireTokenJSON(body);
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null;
    if (payload.exp != null) {
      const exp = Number(payload.exp);
      const expMs = exp > 1e12 ? exp : exp * 1000;
      if (!Number.isFinite(expMs) || expMs <= Date.now()) return null;
    }
    return payload;
  } catch { return null; }
}
async function inspireAuth(request, env) {
  const token = (request.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '').trim();
  if (!token) return null;
  return verifyInspireJWT(token, env.JWT_SECRET || 'secret');
}
// Verified token -> actor, or null. Guests are identified by their client id (cid), registered users by id.
// Memoized per request (the session gate in handleInspire and the route handlers ask for the same actor).
const inspireActorMemo = new WeakMap();
function inspireActor(request, env) {
  let p = inspireActorMemo.get(request);
  if (!p) { p = inspireActorOf(request, env); inspireActorMemo.set(request, p); }
  return p;
}
async function inspireActorOf(request, env) {
  const p = await inspireAuth(request, env);
  if (!p) return null;
  if (p.g === 1) {
    if (typeof p.cid !== 'string' || !INSPIRE_CID_RE.test(p.cid)) return null;
    if (!(await guestPvOk(env, p))) return null;   // board password gate: no pv / an old password's pv / gate locked
    const name = cleanInspireName(p.name);
    // tokens minted before the reserved-name check still post, but as Anonim
    return { guest: true, cid: p.cid, userId: null, username: null, name: inspireReservedName(name) ? '' : name, isAdmin: false };
  }
  const userId = Number(p.userId);
  if (!Number.isSafeInteger(userId) || userId <= 0) return null;
  const username = typeof p.username === 'string' ? p.username : '';
  if (username === INSPIRE_GUEST_USERNAME) return null;
  if (username === INSPIRE_ADMIN_USERNAME) {
    if (ownerTokenRevoked(p, env)) return null;   // see ADMIN_TOKENS_NOT_BEFORE
    return { guest: false, cid: null, userId, username, name: null, isAdmin: true };
  }
  // Registered (non-admin) users skip the board password, so their token must still stand for a live account: it needs
  // an expiry (POST /login mints 30-day tokens; the d9456ea-era ones had none and never expired, and fikir.html copies the
  // old inspire_token over) and the user row must still exist under that username (a deleted user is out at once).
  // A D1 error throws (500 at the gate), so a hiccup does not end the session.
  if (p.exp == null) return null;
  await ensureInspireSchema(env);
  const row = await env.DB.prepare('SELECT username FROM inspire_users WHERE id=?').bind(userId).first();
  if (!row || row.username !== username) return null;
  return { guest: false, cid: null, userId, username, name: null, isAdmin: false };
}
async function inspireSafeEqual(a, b) {
  const enc = new TextEncoder();
  const [ha, hb] = await Promise.all([
    crypto.subtle.digest('SHA-256', enc.encode(String(a))),
    crypto.subtle.digest('SHA-256', enc.encode(String(b))),
  ]);
  const x = new Uint8Array(ha), y = new Uint8Array(hb);
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x[i] ^ y[i];
  return diff === 0;
}

// Display name: trim, collapse whitespace, drop control / bidi-override characters, max 40 characters.
function cleanInspireName(v) {
  if (typeof v !== 'string') return '';
  let s = v.normalize('NFC')
    .replace(/[\u200B\u200E\u200F\u202A-\u202E\u2060-\u2064\u2066-\u2069\uFEFF]/g, '')
    .replace(/[\u0000-\u001F\u007F-\u009F\u00AD\u2028\u2029]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const chars = Array.from(s);
  if (chars.length > INSPIRE_MAX_NAME) s = chars.slice(0, INSPIRE_MAX_NAME).join('').trim();
  return s;
}
// Free text (notes, text ideas, descriptions): keep newlines/tabs, drop other control characters.
function cleanInspireText(v) {
  if (typeof v !== 'string') return '';
  return v.normalize('NFC')
    .replace(/\r\n?/g, '\n')
    .replace(/[\u2028\u2029]/g, '\n')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F\u202A-\u202E\u2066-\u2069\uFEFF]/g, '')
    .trim();
}
// Fold a display name for impersonation checks: case, Turkish İ/ı, diacritics, common look-alikes
// (l/1/I -> i, 0 -> o, Cyrillic letters) and everything that is not a letter or digit.
const INSPIRE_CONFUSABLES = { 'а': 'a', 'е': 'e', 'о': 'o', 'р': 'p', 'с': 'c', 'у': 'y', 'х': 'x', 'к': 'k', 'і': 'i', 'ѕ': 's', 'ν': 'v' };
function inspireFoldName(s) {
  return String(s || '').normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase()
    .replace(/[аеорсухкіѕν]/g, (c) => INSPIRE_CONFUSABLES[c])
    .replace(/[ı1l|!]/g, 'i').replace(/0/g, 'o')
    .replace(/[^a-z0-9]/g, '');
}
let inspireAdminNameFolded = '';   // owner's full_name from inspire_users (set by the migration)
function inspireReservedName(name) {
  const f = inspireFoldName(name);
  if (!f) return false;
  if (INSPIRE_RESERVED_NAMES.some((r) => inspireFoldName(r) === f)) return true;
  const parts = INSPIRE_RESERVED_PARTS.map(inspireFoldName);
  if (inspireAdminNameFolded.length >= 5) parts.push(inspireAdminNameFolded);
  return parts.some((p) => f.includes(p));
}

// JSON body, read with a byte cap (a huge body is never buffered whole). null = too large / not an object.
async function inspireBody(request) {
  if (Number(request.headers.get('Content-Length') || 0) > INSPIRE_MAX_BODY) return null;
  let text = '';
  if (request.body) {
    const reader = request.body.getReader();
    const chunks = [];
    let size = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > INSPIRE_MAX_BODY) { reader.cancel().catch(() => {}); return null; }
      chunks.push(value);
    }
    const buf = new Uint8Array(size);
    let off = 0;
    for (const c of chunks) { buf.set(c, off); off += c.byteLength; }
    text = new TextDecoder().decode(buf);
  }
  if (!text.trim()) return {};
  try {
    const d = JSON.parse(text);
    return d && typeof d === 'object' && !Array.isArray(d) ? d : null;
  } catch { return null; }
}

// ── Schema (idempotent; runs once per isolate) ──
// A cold isolate first runs one probe (inspireSchemaFast): when every table, added column and index is already there, the
// migration is skipped (1 statement instead of ~27; D1 counts queries per invocation, see worker/budget.js). Cron runs
// never migrate (inspireCronSchemaOk): the board's next request does.
let inspireSchemaReady = null;
let inspireSchemaDone = false;
let inspireGuestId = null;
function ensureInspireSchema(env) {
  if (!inspireSchemaReady) {
    inspireSchemaReady = migrateInspireSchema(env).then(() => { inspireSchemaDone = true; }, (e) => { inspireSchemaReady = null; throw e; });
  }
  return inspireSchemaReady;
}
// Columns added after a table's first release (ALTER TABLE ADD COLUMN in the migration; the probe checks them).
// media: manual preview (Media JSON from PUT /media or an upload) or NULL; meta.media is the automatic one
const INSPIRE_ADDED_COLUMNS = {
  inspire_users: [['is_first_login', 'INTEGER DEFAULT 1']],
  inspire_posts: [['author_name', 'TEXT'], ['client_id', 'TEXT'], ['url_key', 'TEXT'], ['meta', 'TEXT'], ['media', 'TEXT']],
  inspire_notes: [['author_name', 'TEXT'], ['client_id', 'TEXT']],
};
const INSPIRE_TABLES = ['inspire_users', 'inspire_posts', 'inspire_notes', 'inspire_rate', 'inspire_media', 'inspire_quota', 'inspire_video_cache'];
const INSPIRE_INDEXES = ['idx_inspire_posts_url_key', 'idx_inspire_notes_post', 'idx_inspire_media_post'];
// Compiles only when every table and added column exists; LIMIT 0 reads no rows. ?1 = guest username, ?2 = owner username.
const INSPIRE_SCHEMA_PROBE = `SELECT
  (SELECT COUNT(*) FROM sqlite_master WHERE type = 'index' AND name IN (${INSPIRE_INDEXES.map((n) => `'${n}'`).join(', ')})) AS idx,
  (SELECT id FROM inspire_users WHERE username = ?1) AS guest_id,
  (SELECT full_name FROM inspire_users WHERE username = ?2) AS owner_name,
  (SELECT COUNT(*) FROM inspire_users WHERE username = ?2 AND substr(password, 1, 1) <> '!') AS owner_pw,
  EXISTS (SELECT 1 FROM inspire_posts WHERE url_key IS NULL AND url <> '') AS nokey,
  (SELECT COUNT(*) FROM (SELECT 1${INSPIRE_TABLES.map((t, i) => (INSPIRE_ADDED_COLUMNS[t] || []).map(([c]) => `, t${i}.${c}`).join('')).join('')}
     FROM ${INSPIRE_TABLES.map((t, i) => `${t} t${i}`).join(', ')} LIMIT 0)) AS probe`;
// The owner logs in with ADMIN_PASSWORD only. A password stored in the owner's row (a copy written by the old first login,
// or one set through change-password) must not remain a second credential.
const inspireScrubOwnerStmt = (db) => db.prepare("UPDATE inspire_users SET password=?, is_first_login=0 WHERE username=? AND substr(password, 1, 1) <> '!'")
  .bind(inspireUnusablePassword(), INSPIRE_ADMIN_USERNAME);
// -> true when the schema is complete (and the per-isolate values are loaded), false when the migration must run.
// backfill: also key rows still without url_key (requests; the cron leaves that to them).
async function inspireSchemaFast(db, { backfill = true } = {}) {
  let r;
  try { r = await db.prepare(INSPIRE_SCHEMA_PROBE).bind(INSPIRE_GUEST_USERNAME, INSPIRE_ADMIN_USERNAME).first(); }
  catch (e) { return false; }   // a table or column is missing
  if (!r || Number(r.idx) !== INSPIRE_INDEXES.length || r.guest_id == null) return false;
  if (Number(r.owner_pw) > 0) await inspireScrubOwnerStmt(db).run();
  inspireGuestId = r.guest_id;
  inspireAdminNameFolded = inspireFoldName(r.owner_name);
  if (backfill && Number(r.nokey)) await inspireBackfillKeys(db);
  return true;
}
// Cron runs: schema known in this isolate -> 0 statements, else the probe (1). Never the migration (requests keep their
// own memo: a cron probe does not stand in for their backfill).
let inspireCronSchemaSeen = false;
async function inspireCronSchemaOk(env) {
  if (inspireSchemaDone || inspireCronSchemaSeen) return true;
  if (!(await inspireSchemaFast(env.DB, { backfill: false }))) { console.log('inspire cron: schema incomplete, skipped (the board\'s next request migrates it)'); return false; }
  inspireCronSchemaSeen = true;
  return true;
}
async function migrateInspireSchema(env) {
  const db = env.DB;
  if (await inspireSchemaFast(db)) return;
  await db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS inspire_users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      full_name TEXT DEFAULT '',
      created_at TEXT DEFAULT (datetime('now'))
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS inspire_posts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      type TEXT NOT NULL,
      url TEXT NOT NULL,
      description TEXT DEFAULT '',
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY(user_id) REFERENCES inspire_users(id) ON DELETE CASCADE
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS inspire_notes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      post_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      content TEXT NOT NULL,
      is_public INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY(post_id) REFERENCES inspire_posts(id) ON DELETE CASCADE,
      FOREIGN KEY(user_id) REFERENCES inspire_users(id) ON DELETE CASCADE
    )`),
    // Fixed-window request counters (k = bucket + ':' + hashed IP / cid / user id; reset = unix seconds)
    db.prepare(`CREATE TABLE IF NOT EXISTS inspire_rate (
      k TEXT PRIMARY KEY,
      n INTEGER NOT NULL,
      reset INTEGER NOT NULL
    )`),
    // Uploaded preview files in R2 (key fikir/<postId>/<slot>-<32hex>.<ext>); state pending (upload in flight) | live | orphan
    db.prepare(`CREATE TABLE IF NOT EXISTS inspire_media (
      key TEXT PRIMARY KEY,
      post_id INTEGER NOT NULL,
      slot TEXT NOT NULL,
      subject TEXT NOT NULL,
      mime TEXT NOT NULL,
      bytes INTEGER NOT NULL,
      state TEXT NOT NULL DEFAULT 'pending',
      created_at INTEGER NOT NULL
    )`),
    // Atomic daily budgets (same pattern as sb_quota: CHECK(n <= lim) aborts the whole D1 batch)
    db.prepare(`CREATE TABLE IF NOT EXISTS inspire_quota (
      day TEXT NOT NULL,
      scope TEXT NOT NULL,
      subject TEXT NOT NULL DEFAULT '',
      n INTEGER NOT NULL,
      lim INTEGER NOT NULL,
      CONSTRAINT inspire_quota_cap CHECK (n <= lim),
      PRIMARY KEY (day, scope, subject)
    )`),
    // Downloads / R2 copies: resolved media links (kind 'ig' Instagram, 'ad' the other platforms), embed checks
    // ('ig_embed'), copy records ('ig_copy' Instagram, 'ad_copy' the others: failures + backoff, the "removed" marker)
    db.prepare(VIDEO_CACHE_DDL),
  ]);
  for (const [table, cols] of Object.entries(INSPIRE_ADDED_COLUMNS)) {
    let have = null;
    try {
      const { results } = await db.prepare(`PRAGMA table_info(${table})`).all();
      have = new Set((results || []).map((r) => r.name));
    } catch (e) {}
    for (const [col, type] of cols) {
      if (have && have.has(col)) continue;
      try { await db.prepare(`ALTER TABLE ${table} ADD COLUMN ${col} ${type}`).run(); } catch (e) {}
    }
  }
  await db.batch([   // INSPIRE_INDEXES
    db.prepare('CREATE INDEX IF NOT EXISTS idx_inspire_posts_url_key ON inspire_posts(url_key)'),
    db.prepare('CREATE INDEX IF NOT EXISTS idx_inspire_notes_post ON inspire_notes(post_id)'),
    db.prepare('CREATE INDEX IF NOT EXISTS idx_inspire_media_post ON inspire_media(post_id)'),
  ]);
  // Reserved owner row for guest content (user_id is NOT NULL + FK). Its password can never be used:
  // /api/inspire/login rejects this username.
  await db.prepare("INSERT OR IGNORE INTO inspire_users (username, password, full_name) VALUES (?, ?, 'Misafir')")
    .bind(INSPIRE_GUEST_USERNAME, inspireUnusablePassword()).run();
  const guest = await db.prepare('SELECT id FROM inspire_users WHERE username=?').bind(INSPIRE_GUEST_USERNAME).first();
  inspireGuestId = guest.id;
  await inspireScrubOwnerStmt(db).run();
  const owner = await db.prepare('SELECT full_name FROM inspire_users WHERE username=?').bind(INSPIRE_ADMIN_USERNAME).first();
  inspireAdminNameFolded = inspireFoldName(owner && owner.full_name);
  await db.prepare('DELETE FROM inspire_rate WHERE reset < ?').bind(Math.floor(Date.now() / 1000)).run();
  await inspireBackfillKeys(db);
}
// Dedupe keys for legacy rows (old 'reels'/'link'/... types parse like any other link).
async function inspireBackfillKeys(db) {
  let lastId = 0;
  for (let round = 0; round < 100; round++) {
    const { results } = await db.prepare(
      "SELECT id, url FROM inspire_posts WHERE url_key IS NULL AND url <> '' AND id > ? ORDER BY id LIMIT 100"
    ).bind(lastId).all();
    if (!results || !results.length) break;
    const updates = [];
    for (const r of results) {
      lastId = r.id;
      const parsed = parseLink(r.url);
      if (parsed) updates.push(db.prepare('UPDATE inspire_posts SET url_key=? WHERE id=? AND url_key IS NULL').bind(parsed.key, r.id));
    }
    if (updates.length) await db.batch(updates);
    if (results.length < 100) break;
  }
}

// ── Row -> JSON ──
// ?1 = guest cid (or NULL), ?2 = registered user id (or NULL). Never select user_id / client_id into output.
// author_role ('admin' | 'user' | 'guest') lets the board mark the owner's content; a guest can pick any name.
const INSPIRE_ROLE_SQL = (t) => `CASE WHEN ${t}.client_id IS NOT NULL OR u.username = '${INSPIRE_GUEST_USERNAME}' THEN 'guest'
      WHEN u.username = '${INSPIRE_ADMIN_USERNAME}' THEN 'admin' ELSE 'user' END AS author_role`;
const INSPIRE_POST_SELECT = `
  SELECT p.id, p.type, p.url, p.description, p.created_at, p.meta, p.media, p.url_key,
    COALESCE(p.author_name,
      CASE WHEN u.username = '__guest__' THEN '' ELSE COALESCE(NULLIF(u.full_name, ''), u.username) END, '') AS author,
    ${INSPIRE_ROLE_SQL('p')},
    CASE WHEN (?1 IS NOT NULL AND p.client_id = ?1)
           OR (?2 IS NOT NULL AND p.client_id IS NULL AND p.user_id = ?2) THEN 1 ELSE 0 END AS is_mine
  FROM inspire_posts p LEFT JOIN inspire_users u ON u.id = p.user_id`;
const INSPIRE_NOTE_SELECT = `
  SELECT n.id, n.post_id, n.content, n.is_public, n.created_at,
    COALESCE(n.author_name,
      CASE WHEN u.username = '__guest__' THEN '' ELSE COALESCE(NULLIF(u.full_name, ''), u.username) END, '') AS author,
    ${INSPIRE_ROLE_SQL('n')},
    CASE WHEN (?1 IS NOT NULL AND n.client_id = ?1)
           OR (?2 IS NOT NULL AND n.client_id IS NULL AND n.user_id = ?2) THEN 1 ELSE 0 END AS is_mine
  FROM inspire_notes n LEFT JOIN inspire_users u ON u.id = n.user_id`;
const INSPIRE_NOTE_VISIBLE = `(n.is_public = 1
  OR (?1 IS NOT NULL AND n.client_id = ?1)
  OR (?2 IS NOT NULL AND n.client_id IS NULL AND n.user_id = ?2))`;

function inspireOwnerParams(actor) {
  return [actor && actor.guest ? actor.cid : null, actor && !actor.guest ? actor.userId : null];
}
function inspireMetaParse(v) {
  if (!v) return null;
  try { const m = JSON.parse(v); return m && typeof m === 'object' && !Array.isArray(m) ? m : null; } catch { return null; }
}
const inspireMetaFailed = (m) => !!(m && m.failed);
const inspireNowS = () => Math.floor(Date.now() / 1000);
// Link posts that show a preview card (and may carry media): card platforms and legacy 'link' rows.
const inspireCardish = (type) => INSPIRE_CARD_PLATFORMS.has(type) || type === 'link';
// meta v2 (worker/inspire-media.js): {v:2, title, description, image, site_name, provider, image_w?, image_h?, media?, via,
// checked}. Failure / negative cache: '{"failed":1,"at":<s>,"v":2[,"retry_s":<n>][,"pending":"br"]}' (must start with
// {"failed": - the UPDATEs below test it with LIKE). pending:"br" = a Browser Run attempt is queued (it may also sit on a
// client or partial meta). v1 rows (no `v`) stay readable and are refreshed once (meta_stale).
// Negative cache entry still fresh (no new fetch until it expires); v1 failures are retried once.
const inspireMetaFresh = (m) => inspireMetaFailed(m) && (Number(m.v) || 1) >= 2 && !m.pending &&
  inspireNowS() - Number(m.at || 0) < (Number(m.retry_s) || INSPIRE_META_RETRY_S);
const inspireMetaStale = (m, type) => inspireCardish(type) && !!m && (Number(m.v) || 1) < 2;
const inspireMetaPending = (m) => !!(m && m.pending === 'br');
// Pending and due within INSPIRE_PENDING_NEAR_S (or overdue): the board shows "preparing" only then. A post that waits for
// UTC midnight (daily budget spent) or an hour (per-IP cap) looks like a plain card meanwhile; the cron still retries it.
const inspireMetaPendingSoon = (m) => inspireMetaPending(m) &&
  Number(m.at || 0) + Number(m.retry_s || 0) - inspireNowS() <= INSPIRE_PENDING_NEAR_S;
// Output of stored meta/media JSON goes through sanitizeMedia again; results are memoized per stored string (per
// isolate, bounded) so a board of 200 posts does not re-parse every URL on every GET. Callers never mutate them.
const inspireOutCache = new Map();
function inspireOutMemo(kind, v, fn) {
  if (typeof v !== 'string' || !v) return fn();
  const k = kind + v;
  let out = inspireOutCache.get(k);
  if (out === undefined) {
    out = fn();
    if (inspireOutCache.size >= 2000) inspireOutCache.delete(inspireOutCache.keys().next().value);
    inspireOutCache.set(k, out);
  }
  return out;
}
function inspireMetaOut(v) {
  return inspireOutMemo('m', v, () => {
    const m = inspireMetaParse(v);
    if (!m || inspireMetaFailed(m)) return null;
    const { pending, at, retry_s, checked, ...out } = m;
    if (out.media !== undefined) {
      const md = sanitizeMedia(out.media);
      if (md) out.media = md; else delete out.media;
    }
    return out;
  });
}
// Manual media column (owner/admin attach or upload) -> Media or null
function inspireMediaOut(v) {
  return inspireOutMemo('x', v, () => {
    const m = inspireMetaParse(v);
    return m ? sanitizeMedia(m, { allowFiles: true }) : null;
  });
}
// parseLink(url) memoized like the meta/media outputs (GET /posts computes the download hint of every post)
const inspireParsedOut = (url) => (url ? inspireOutMemo('u', url, () => parseLink(url)) : null);
function inspirePostOut(r, isAdmin, notes) {
  const stored = inspireMetaParse(r.meta);
  const meta = inspireMetaOut(r.meta), media = inspireMediaOut(r.media);
  return {
    id: r.id, type: r.type, url: r.url || '', description: r.description || '', created_at: r.created_at,
    author: r.author || '', author_role: r.author_role || 'user', is_mine: !!r.is_mine, can_delete: !!r.is_mine || !!isAdmin,
    meta, meta_failed: inspireMetaFresh(stored), meta_stale: inspireMetaStale(stored, r.type),
    meta_pending: inspireMetaPendingSoon(stored), media,
    can_edit_media: (!!r.is_mine || !!isAdmin) && inspireCardish(r.type),
    // download hint (no network): {video: true|false|null (maybe), image: bool} or null; link = /api/inspire/posts/:id/download
    dl: dlHint({ type: r.type, parsed: inspireParsedOut(r.url), media, meta }),
    notes: notes || [],
  };
}
function inspireNoteOut(n, isAdmin) {
  return {
    id: n.id, content: n.content || '', author: n.author || '', author_role: n.author_role || 'user', is_public: n.is_public === 1,
    is_mine: !!n.is_mine, can_edit: !!n.is_mine || !!isAdmin, created_at: n.created_at,
  };
}

// ── Old fikir.html compatibility (rollout window / cached copies) ──
// The old page builds cards with innerHTML, puts note text into an inline onclick="editNote(id, '…')"
// string, knows only the types below, and decides ownership with user_id. GET /api/inspire/posts
// without "X-Fikir-Client: 2" gets inert text, legacy type names, and (registered users only) the
// caller's OWN user_id on rows that are theirs.
const INSPIRE_LEGACY_TYPES = new Set(['reels', 'link', 'pinterest', 'drive', 'youtube', 'video', 'image']);
function inspireLegacyText(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
    .replace(/'/g, '’').replace(/\\/g, '＼')   // an entity would be decoded back inside onclick="…"
    .replace(/[\r\n]+/g, ' ');
}
function inspireLegacyUrl(s) {
  return String(s || '').replace(/["'<>`\\\s]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase().padStart(2, '0'));
}
function inspireLegacyPost(post, actor) {
  let type = post.type, url = post.url;
  if (!INSPIRE_LEGACY_TYPES.has(type)) {
    const p = type === 'text' ? null : parseLink(url);
    if (p && p.platform === 'instagram' && p.id && ['reel', 'p', 'tv'].includes(p.subtype)) type = 'reels';
    // text: an empty 'pinterest' block is the old page's only media-less card (description = the text)
    else type = type === 'text' ? 'pinterest' : 'link';
  }
  // the old page's own patterns; anything else ends in its <img src=url> / refused-iframe fallback
  if (type === 'youtube' && !/(?:youtu\.be\/|youtube\.com\/(?:embed\/|v\/|shorts\/|watch\?v=|watch\?.+&v=))[\w-]{11}/.test(url)) type = 'link';
  if (type === 'drive' && !/\/d\/[^/]+/.test(url)) type = 'link';
  if (type === 'reels') url = url.replace(/\/+$/, '');   // the old page appends '/embed'
  const ownId = actor && !actor.guest ? actor.userId : undefined;
  const out = {
    ...post, type, url: inspireLegacyUrl(url), description: inspireLegacyText(post.description), author: inspireLegacyText(post.author),
    notes: post.notes.map((n) => ({ ...n, content: inspireLegacyText(n.content), author: inspireLegacyText(n.author), ...(n.is_mine && ownId ? { user_id: ownId } : {}) })),
  };
  // media previews and downloads are current-board only
  delete out.media; delete out.meta_stale; delete out.meta_pending; delete out.can_edit_media; delete out.dl;
  if (post.is_mine && ownId) out.user_id = ownId;
  return out;
}

async function inspireAuthorName(db, actor) {
  if (actor.guest) return actor.name;
  const row = await db.prepare('SELECT username, full_name FROM inspire_users WHERE id=?').bind(actor.userId).first();
  if (!row || row.username === INSPIRE_GUEST_USERNAME) return null;
  return row.full_name || row.username;
}
// Dedupe keys of a parsed link: its key and, for a resolved short link, the 'short:' key that rows saved
// unresolved (legacy rows, or a failed lookup) still carry.
function inspireDupKeys(p) {
  return p && p.key ? [p.key, p.shortKey || p.key] : null;
}
async function inspireFindDuplicate(db, keys) {
  if (!keys) return null;
  const r = await db.prepare(`${INSPIRE_POST_SELECT} WHERE p.url_key IN (?3, ?4) ORDER BY p.id ASC LIMIT 1`).bind(null, null, keys[0], keys[1]).first();
  return r ? { id: r.id, author: r.author || '', created_at: r.created_at, url_key: r.url_key } : null;
}
// A short link just resolved: rows that still carry its 'short:' key get the real key (and the duplicate
// check finds them from either form from now on).
function inspireRekeyShort(db, ctx, parsed) {
  if (!parsed || !parsed.shortKey || parsed.shortKey === parsed.key || !ctx || typeof ctx.waitUntil !== 'function') return;
  ctx.waitUntil(db.prepare('UPDATE inspire_posts SET url_key=? WHERE url_key=?').bind(parsed.key, parsed.shortKey).run().catch(() => {}));
}
const inspireDupOut = (d) => ({ id: d.id, author: d.author, created_at: d.created_at });
// Only plain DNS names / IPv4 hosts (a '"' or '<' in a host would survive URL parsing).
function inspireHostOk(href) {
  try { return /^[a-z0-9._-]+$/i.test(new URL(href).hostname); } catch { return false; }
}
function inspireUnusablePassword() {
  return '!' + crypto.randomUUID() + crypto.randomUUID();
}

// Storyboard hooks inside the existing inspire handlers never fail the request they ride on.
async function sbHook(label, fn, fallback) {
  try { return await fn(); } catch (e) { console.error('sb ' + label, e && e.stack || e); return fallback; }
}

// ── Rate limits (D1 fixed windows; fail open if the counter itself errors, except the board password limiter) ──
const INSPIRE_RATE_SQL = `INSERT INTO inspire_rate (k, n, reset) VALUES (?1, 1, ?2)
  ON CONFLICT(k) DO UPDATE SET n = CASE WHEN reset <= ?3 THEN 1 ELSE n + 1 END,
                               reset = CASE WHEN reset <= ?3 THEN ?2 ELSE reset END
  RETURNING n`;
// IPv6 counts per /64 (ipBucket): one client can rotate through a whole /64; IPv4 stays per address.
async function inspireHashedKey(label, value) {
  const d = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(label + ':' + value)));
  return [...d.subarray(0, 12)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
async function inspireIpKey(request) {
  return 'ip:' + await inspireHashedKey('inspire-ip', ipBucket(request.headers.get('CF-Connecting-IP') || 'unknown'));
}
// The network around it (board password limiter): IPv6 /48, IPv4 /24; anything else as is.
async function inspireNetKey(request) {
  const b = ipBucket(request.headers.get('CF-Connecting-IP') || 'unknown');
  const net = b.endsWith('::/64') ? b.split(':').slice(0, 3).join(':') + '::/48'
    : /^\d{1,3}(?:\.\d{1,3}){3}$/.test(b) ? b.split('.').slice(0, 3).join('.') + '.0/24' : b;
  return 'net:' + await inspireHashedKey('inspire-net', net);
}
const inspireActorKey = (actor) => (actor.guest ? 'c:' + actor.cid : 'u:' + actor.userId);
// Counts this request in every [bucket, id] pair; true if any of them is over its limit.
async function inspireOverLimit(db, pairs) {
  return (await inspireOverLimitAt(db, pairs)) != null;
}
// Same, -> the bucket of the first pair over its limit, or null
async function inspireOverLimitAt(db, pairs) {
  try {
    const now = Math.floor(Date.now() / 1000);
    const res = await db.batch(pairs.map(([b, id]) => db.prepare(INSPIRE_RATE_SQL).bind(`${b}:${id}`, now + INSPIRE_LIMITS[b][1], now)));
    const i = res.findIndex((r, j) => { const row = r && r.results && r.results[0]; return !!row && row.n > INSPIRE_LIMITS[pairs[j][0]][0]; });
    return i < 0 ? null : pairs[i][0];
  } catch (e) {
    console.error('inspire rate limit', e && e.message);
    return null;
  }
}
async function inspireRateCount(db, bucket, id) {
  try {
    const r = await db.prepare('SELECT n FROM inspire_rate WHERE k=? AND reset > ?').bind(`${bucket}:${id}`, Math.floor(Date.now() / 1000)).first();
    return r ? r.n : 0;
  } catch (e) { return 0; }
}
// Counts one hit of [bucket, id] (same fixed window as inspireOverLimit) -> {n (this hit included), reset (epoch s)}, or
// null if the counter could not be updated. Unlike inspireOverLimit this does NOT fail open: its caller, the board password
// limiter, refuses the attempt then (an attacker's own flood must not switch the limiter off).
async function inspireRateHit(db, bucket, id) {
  try {
    const now = Math.floor(Date.now() / 1000);
    const r = await db.prepare(INSPIRE_RATE_SQL.replace(/RETURNING n$/, 'RETURNING n, reset')).bind(`${bucket}:${id}`, now + INSPIRE_LIMITS[bucket][1], now).first();
    const n = r ? Number(r.n) : NaN;
    return n >= 1 ? { n, reset: Number(r.reset) || 0 } : null;
  } catch (e) {
    console.error('inspire rate hit', e && e.message);
    return null;
  }
}
// Takes one hit back from every [bucket, id] pair (best effort); `mark` = an IP key that gets the board_ok marker too.
async function inspireRateGiveBack(db, pairs, mark = null) {
  try {
    const now = Math.floor(Date.now() / 1000);
    const stmts = pairs.map(([b, id]) => db.prepare('UPDATE inspire_rate SET n = MAX(0, n - 1) WHERE k=?').bind(`${b}:${id}`));
    if (mark) stmts.push(db.prepare(INSPIRE_RATE_SQL).bind(`board_ok:${mark}`, now + INSPIRE_LIMITS.board_ok[1], now));
    if (stmts.length) await db.batch(stmts);
  } catch (e) { console.error('inspire rate give back', e && e.message); }
}
// Board password limiter (POST /guest), run BEFORE the compare. Wrong passwords are counted per IP (board_pw), per network
// (board_pw_net) and site-wide (board_pw_all), in that order: each counter is one atomic statement, so parallel requests
// cannot slip under a limit together, and a bucket only counts the attempts the previous one let through (an IP that is
// already refused does not use up its network's or the site's budget). Over the site-wide budget only IPs that entered the
// right password within 30 days (board_ok) are still checked. The caller gives the counts back for a right (or empty)
// password, so only wrong ones add up. Fails CLOSED: a counter that cannot be updated refuses the attempt (503).
// -> { res } (refused, nothing compared) | { counted: [[bucket, id], ...], left: wrong attempts left before a 429 }
async function inspireBoardPwLimit(db, request, ipKey, fail) {
  const counted = [];
  const refuse = async (res, retry) => {
    if (counted.length) await inspireRateGiveBack(db, counted);   // not compared: the earlier buckets get it back
    res.headers.set('Retry-After', String(retry));
    return { res };
  };
  const tooMany = (reset, message) => {
    const retry = Math.max(1, reset - inspireNowS());
    return refuse(fail(429, 'too_many_attempts', message(`${Math.max(1, Math.ceil(retry / 60))} dk`), { retry_s: retry }), retry);
  };
  const unavailable = () => refuse(fail(503, 'login_unavailable', 'Giriş şu anda doğrulanamıyor. Biraz sonra tekrar dene.', { retry_s: 30 }), 30);
  const ip = await inspireRateHit(db, 'board_pw', ipKey);
  if (!ip) return unavailable();
  if (ip.n > INSPIRE_LIMITS.board_pw[0]) return tooMany(ip.reset, (w) => `Çok fazla hatalı deneme. ${w} sonra tekrar dene.`);
  counted.push(['board_pw', ipKey]);
  const netKey = await inspireNetKey(request);
  const net = await inspireRateHit(db, 'board_pw_net', netKey);
  if (!net) return unavailable();
  if (net.n > INSPIRE_LIMITS.board_pw_net[0]) return tooMany(net.reset, (w) => `Bu ağdan çok fazla hatalı deneme. ${w} sonra tekrar dene.`);
  counted.push(['board_pw_net', netKey]);
  const all = await inspireRateHit(db, 'board_pw_all', 'all');
  if (!all) return unavailable();
  if (all.n > INSPIRE_LIMITS.board_pw_all[0] && !(await inspireRateCount(db, 'board_ok', ipKey))) {   // count error -> 0: refused
    return tooMany(all.reset, (w) => `Şu an çok fazla hatalı giriş denemesi var. ${w} sonra tekrar dene.`);
  }
  counted.push(['board_pw_all', 'all']);
  return { counted, left: Math.max(0, Math.min(INSPIRE_LIMITS.board_pw[0] - ip.n, INSPIRE_LIMITS.board_pw_net[0] - net.n)) };
}

// ── Safe server-side fetching ──
function inspireIsPrivateIPv4(host) {
  const o = host.split('.').map(Number);
  if (o.length !== 4 || o.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return true;
  const [a, b, c] = o;
  return a === 0 || a === 10 || a === 127 || a >= 224 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 192 && b === 0 && (c === 0 || c === 2)) ||
    (a === 198 && (b === 18 || b === 19)) ||
    (a === 198 && b === 51 && c === 100) ||
    (a === 203 && b === 0 && c === 113);
}
// Local-test hooks (tests/media-e2e). Honoured only when the var is set AND ALLOWED_ORIGIN is a 127.0.0.1 origin, i.e. a
// local `wrangler dev` with worker/wrangler.mediatest.toml; never set in worker/wrangler.toml (a unit test checks it).
//   INSPIRE_TEST_FETCH_ALLOW = "127.0.0.1:<port>"  the SSRF guard lets exactly this host:port through (fixture server)
//   INSPIRE_FAKE_BR = "1"                          Browser Run = POST http://<that host:port>/__br/scrape (fake)
let inspireTestAllow = '';
let inspireFakeBr = false;
function inspireTestHooks(env) {
  const local = /^http:\/\/127\.0\.0\.1(:\d{1,5})?$/.test(String(env.ALLOWED_ORIGIN || ''));
  const allow = String(env.INSPIRE_TEST_FETCH_ALLOW || '').trim();
  inspireTestAllow = local && /^127\.0\.0\.1:\d{1,5}$/.test(allow) ? allow : '';
  inspireFakeBr = !!inspireTestAllow && env.INSPIRE_FAKE_BR === '1';
}
// URL object if it may be fetched server-side, else null. Blocks non-http(s), credentials, odd ports,
// IPv6 literals, private/loopback IPv4, localhost and internal suffixes, and this worker's own hosts.
function inspireSafeURL(href, selfHost) {
  let u;
  try { u = new URL(href); } catch { return null; }
  if (inspireTestAllow && u.protocol === 'http:' && u.host === inspireTestAllow && !u.username && !u.password) return u;
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
  if (u.username || u.password) return null;
  if (u.port && !['80', '443', '8080', '8443'].includes(u.port)) return null;
  const host = u.hostname.toLowerCase().replace(/\.+$/, '');
  if (!host || host.includes(':') || host.startsWith('[')) return null;
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) {
    if (inspireIsPrivateIPv4(host)) return null;
  } else {
    if (!host.includes('.')) return null;
    if (host === 'localhost' || /\.(localhost|local|internal|intranet|lan|home|corp|localdomain|home\.arpa)$/.test(host)) return null;
    if (/(^|\.)(nip\.io|sslip\.io|xip\.io|localtest\.me|lvh\.me|vcap\.me)$/.test(host)) return null;
  }
  if (selfHost && host === selfHost) return null;
  if (host === 'vk-portfolio-api.vkesgin38.workers.dev' || host.endsWith('.vkesgin38.workers.dev')) return null;
  return u;
}
function inspireFetchHeaders(accept) {
  // Fresh headers only: nothing from the incoming request (Authorization, cookies) is ever forwarded.
  return { 'User-Agent': INSPIRE_UA, 'Accept': accept, 'Accept-Language': 'tr-TR,tr;q=0.9,en-US;q=0.8,en;q=0.7' };
}
function inspireDiscard(res) {
  try { if (res.body) res.body.cancel().catch(() => {}); } catch (e) {}
}
function inspireIsLoginURL(u) {
  return u.hostname === 'accounts.google.com' ||
    /\/(accounts\/login|login|signin|sign-in|sign_in|ServiceLogin)(\/|$)/i.test(u.pathname);
}
// Concatenates chunks (at most maxBytes) and decodes them with the declared charset (Content-Type, else <meta charset>).
function inspireDecode(chunks, total, maxBytes, contentType) {
  const buf = new Uint8Array(Math.min(total, maxBytes));
  let off = 0;
  for (const c of chunks) {
    const take = Math.min(c.byteLength, buf.length - off);
    buf.set(c.subarray(0, take), off);
    off += take;
    if (off >= buf.length) break;
  }
  let charset = (/charset\s*=\s*["']?([\w-]+)/i.exec(contentType || '') || [])[1];
  if (!charset) charset = (/<meta[^>]+charset\s*=\s*["']?([\w-]+)/i.exec(inspireLatin1(buf.subarray(0, 4096))) || [])[1];
  let decoder;
  try { decoder = new TextDecoder(charset || 'utf-8'); } catch { decoder = new TextDecoder('utf-8'); }
  return decoder.decode(buf);
}
// Reads at most maxBytes (stops early after </head>) and decodes with the declared charset. Short-link resolution and
// Pinterest oEmbed (64 KB).
async function inspireReadText(res, maxBytes, contentType) {
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
      if (/<\/head\s*>/i.test(inspireLatin1(value))) break;
    }
  } finally {
    reader.cancel().catch(() => {});
  }
  return inspireDecode(chunks, total, maxBytes, contentType);
}
// Reads up to maxBytes without stopping at </head> (adapter pages, oEmbed JSON, Browser Run JSON).
async function inspireReadAll(res, maxBytes, contentType) {
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
  } finally {
    reader.cancel().catch(() => {});
  }
  return inspireDecode(chunks, total, maxBytes, contentType);
}
// HTML reader in two phases: `head` = everything up to the chunk that contains </head> (cap MAX_HEAD_BYTES, as before);
// more(maxTotal) keeps reading to maxTotal bytes in all and decodes every byte once; close() cancels the body.
async function inspireOpenHtml(res, ct) {
  const reader = res.body ? res.body.getReader() : null;
  const chunks = [];
  let total = 0, done = !reader, closed = false, tail = '';
  const close = () => { if (!closed && reader) { closed = true; reader.cancel().catch(() => {}); } };
  try {
    while (!done && total < MAX_HEAD_BYTES) {
      const r = await reader.read();
      if (r.done) { done = true; break; }
      chunks.push(r.value);
      total += r.value.byteLength;
      const s = tail + inspireLatin1(r.value);
      if (/<\/head\s*>/i.test(s)) break;
      tail = s.slice(-16);
    }
  } catch (e) { close(); throw e; }
  const head = inspireDecode(chunks, total, MAX_HEAD_BYTES, ct);
  return {
    head,
    async more(maxTotal) {
      try {
        while (!done && !closed && total < maxTotal) {
          const r = await reader.read();
          if (r.done) { done = true; break; }
          chunks.push(r.value);
          total += r.value.byteLength;
        }
      } finally { close(); }
      return inspireDecode(chunks, total, maxTotal, ct);
    },
    close,
  };
}
// Pinterest pin pages carry their OpenGraph tags ~1.2MB deep in the body (past the read limit); the
// oEmbed endpoint is small. Its thumbnail keeps the pin's aspect ratio, which the board uses to size the embed.
async function inspireFetchPinterestMeta(pinUrl, selfHost) {
  let href = 'https://www.pinterest.com/oembed.json?url=' + encodeURIComponent(pinUrl);
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), INSPIRE_FETCH_TIMEOUT_MS);
  try {
    let res;
    for (let hop = 0; ; hop++) {   // follows only the locale redirect (www -> tr.pinterest.com)
      const u = inspireSafeURL(href, selfHost);
      if (!u || !/(^|\.)pinterest\.com$/.test(u.hostname)) return null;
      res = await fetch(u.href, { method: 'GET', redirect: 'manual', signal: ctrl.signal, headers: inspireFetchHeaders('application/json') });
      const loc = res.status >= 300 && res.status < 400 ? res.headers.get('Location') : null;
      if (!loc) break;
      inspireDiscard(res);
      if (hop >= 2) return null;
      href = new URL(loc, u.href).href;
    }
    const ct = (res.headers.get('Content-Type') || '').toLowerCase();
    if (!res.ok || !ct.includes('json')) { inspireDiscard(res); return null; }
    const d = JSON.parse(await inspireReadText(res, 64 * 1024, ct));
    let image = null;
    try {
      const iu = new URL(String(d.thumbnail_url || ''));
      if (iu.protocol === 'https:' && /(^|\.)pinimg\.com$/.test(iu.hostname)) image = iu.href;
    } catch (e) {}
    const title = inspireMetaText(d.title, 200);
    if (!title && !image) return null;
    return { title, description: inspireMetaText(d.author_name, 400), image, site_name: 'Pinterest', provider: 'pinterest.com' };
  } catch (e) {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
const inspireProviderOf = (href) => { try { return new URL(href).hostname.toLowerCase().replace(/^www\./, ''); } catch { return null; } };
// One page fetch for a link preview: SSRF guard on every hop, <= INSPIRE_MAX_HOPS redirects, INSPIRE_FETCH_BUDGET_MS.
// -> { outcome: 'ok'|'blocked'|'error', meta: {title, description, image, site_name, image_w?, image_h?, login_wall?}|null,
//      collected (parseHead [+ scanBody] structure, only with wantMedia), finalUrl, html (fullPage only), direct (media) }
// outcome 'blocked' = bot wall / challenge (401/403/429/503, cf-mitigated, DataDome, AWS WAF, challenge title/body):
// the Browser Run fallback may try it. The outcome itself is never stored.
async function inspireFetchPage(href, selfHost, { wantMedia = false, deadline = Date.now() + INSPIRE_FETCH_BUDGET_MS, fullPage = false } = {}) {
  const err = (outcome = 'error') => ({ outcome, meta: null, collected: null, finalUrl: href });
  let current = href;
  const end = Math.min(deadline, Date.now() + INSPIRE_FETCH_BUDGET_MS);
  for (let hop = 0; hop <= INSPIRE_MAX_HOPS; hop++) {
    const u = inspireSafeURL(current, selfHost);
    if (!u) return err();
    if (hop > 0 && inspireIsLoginURL(u)) {
      return u.hostname === 'accounts.google.com'
        ? { outcome: 'ok', meta: { title: null, description: null, image: null, site_name: null, login_wall: true }, collected: null, finalUrl: u.href }
        : err();
    }
    const wait = Math.min(INSPIRE_FETCH_TIMEOUT_MS, end - Date.now());
    if (wait <= 0) return err();
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), wait);
    let doc = null;
    try {
      const res = await fetch(u.href, {
        method: 'GET', redirect: 'manual', signal: ctrl.signal,
        headers: inspireFetchHeaders('text/html,application/xhtml+xml;q=0.9,*/*;q=0.8'),
      });
      const loc = res.status >= 300 && res.status < 400 ? res.headers.get('Location') : null;
      if (loc) { inspireDiscard(res); current = new URL(loc, u.href).href; continue; }
      if (!res.ok) { inspireDiscard(res); return err(isBlocked({ status: res.status, headers: res.headers }) ? 'blocked' : 'error'); }
      if (res.status === 202 && res.headers.get('x-amzn-waf-action') != null) { inspireDiscard(res); return err('blocked'); }
      const ct = (res.headers.get('Content-Type') || '').toLowerCase();
      if (ct.startsWith('image/') && !ct.includes('svg')) {
        inspireDiscard(res);
        return { outcome: 'ok', meta: { title: null, description: null, image: u.href, site_name: null }, collected: null, finalUrl: u.href,
          direct: { mv: 1, kind: 'image', url: u.href, mime: ct.split(';')[0].trim(), autoplay: false, verified: true, source: 'inline' } };
      }
      if (ct.startsWith('video/') || /application\/(vnd\.apple|x-)mpegurl/.test(ct)) {
        inspireDiscard(res);
        const kind = ct.startsWith('video/') ? 'video' : 'hls';
        return { outcome: 'ok', meta: { title: null, description: null, image: null, site_name: null }, collected: null, finalUrl: u.href,
          direct: { mv: 1, kind, url: u.href, mime: ct.split(';')[0].trim(), autoplay: kind === 'video', verified: true, source: 'inline' } };
      }
      if (ct && !ct.includes('html') && !ct.includes('xml')) { inspireDiscard(res); return err(); }
      doc = await inspireOpenHtml(res, ct);
      let text = doc.head;
      if (fullPage) text = await doc.more(MAX_HEAD_BYTES);
      const head = parseHead(text, u.href);
      if (isBlocked({ status: res.status, headers: res.headers, html: text, title: head.docTitle || head.title })) return err('blocked');
      if (head.title && INSPIRE_GENERIC_TITLES.has(head.title.toLowerCase())) head.title = null;
      let collected = head;
      if (wantMedia && !fullPage && wantsBody(head, u.href)) collected = mergeCollected(head, scanBody(await doc.more(MAX_PAGE_BYTES), u.href, head));
      const image = head.image && !isExpiringUrl(head.image) ? head.image : null;
      const meta = { title: head.title, description: head.description, image, site_name: head.site_name };
      if (image && head.imageW && head.imageH && head.imageW <= 10000 && head.imageH <= 10000) { meta.image_w = head.imageW; meta.image_h = head.imageH; }
      return { outcome: 'ok', meta: meta.title || meta.description || meta.image ? meta : null, collected: wantMedia ? collected : null, finalUrl: u.href, html: fullPage ? text : undefined };
    } catch (e) {
      return err();
    } finally {
      clearTimeout(timer);
      if (doc) doc.close();
    }
  }
  return err();
}
// Small official fetch (adapter `post` page, oEmbed JSON): SSRF guard on every hop, <= 2 redirects, 4 s, maxBytes.
// -> parsed JSON (json: true; requires a JSON content type) | text | null
async function inspireFetchSmall(href, selfHost, { json = false, maxBytes = 64 * 1024, deadline = Date.now() + 4000 } = {}) {
  let current = href;
  const end = Math.min(deadline, Date.now() + 4000);
  for (let hop = 0; hop <= 2; hop++) {
    const u = inspireSafeURL(current, selfHost);
    if (!u) return null;
    const wait = end - Date.now();
    if (wait <= 0) return null;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), wait);
    try {
      const res = await fetch(u.href, { method: 'GET', redirect: 'manual', signal: ctrl.signal,
        headers: inspireFetchHeaders(json ? 'application/json' : 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.8') });
      const loc = res.status >= 300 && res.status < 400 ? res.headers.get('Location') : null;
      if (loc) { inspireDiscard(res); current = new URL(loc, u.href).href; continue; }
      const ct = (res.headers.get('Content-Type') || '').toLowerCase();
      if (!res.ok || (json ? !ct.includes('json') : !(ct.includes('html') || ct.includes('xml')))) { inspireDiscard(res); return null; }
      const text = await inspireReadAll(res, maxBytes, ct);
      if (!json) return text;
      try { return JSON.parse(text); } catch { return null; }
    } catch (e) {
      return null;
    } finally {
      clearTimeout(timer);
    }
  }
  return null;
}
// Range probe of a media URL: GET bytes=0-0, redirect manual (<= 3 hops, SSRF guard on each), 3 s, body discarded.
// -> { ok: true (media content type; kind/mime/bytes) | false (html, 404/410, svg, unsafe redirect: try the next one)
//          | null (401/403/429/5xx/timeout: keep it unverified, the viewer's browser may still play it), reason, status }
async function inspireProbeMedia(url, selfHost, deadline = Date.now() + 3000) {
  let current = url;
  for (let hop = 0; hop <= 3; hop++) {
    const u = inspireSafeURL(current, selfHost);
    if (!u || !inspireHostOk(u.href)) return { ok: false, reason: 'unsafe' };
    const wait = Math.min(3000, deadline - Date.now());
    if (wait <= 0) return { ok: null, reason: 'timeout' };
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), wait);
    try {
      const res = await fetch(u.href, { method: 'GET', redirect: 'manual', signal: ctrl.signal, headers: { ...inspireFetchHeaders('*/*'), Range: 'bytes=0-0' } });
      inspireDiscard(res);
      const loc = res.status >= 300 && res.status < 400 ? res.headers.get('Location') : null;
      if (loc) { current = new URL(loc, u.href).href; continue; }
      if (res.status === 404 || res.status === 410) return { ok: false, reason: 'gone', status: res.status };
      if (res.status !== 200 && res.status !== 206) return { ok: null, reason: 'denied', status: res.status };
      let ct = (res.headers.get('Content-Type') || '').toLowerCase().split(';')[0].trim();
      if (ct === 'application/mp4') ct = 'video/mp4';   // S3-hosted previews (Envato Elements) are served as application/mp4
      let kind = null;
      if (ct.includes('svg')) return { ok: false, reason: 'svg', status: res.status };
      if (ct.startsWith('video/')) kind = 'video';
      else if (/mpegurl/.test(ct)) kind = 'hls';
      else if (ct.startsWith('image/')) kind = 'image';
      else if (/^(application|binary)\/octet-stream$/.test(ct)) kind = mediaKindOf(u.href);
      if (!kind) return { ok: false, reason: 'not_media', status: res.status };
      let bytes = null;
      const cr = /\/(\d+)\s*$/.exec(res.headers.get('Content-Range') || '');
      if (cr) bytes = Number(cr[1]);
      else if (res.status === 200 && res.headers.get('Content-Length')) bytes = Number(res.headers.get('Content-Length'));
      return { ok: true, kind, mime: ct, bytes: Number.isSafeInteger(bytes) ? bytes : null, status: res.status, finalUrl: u.href };
    } catch (e) {
      return { ok: null, reason: 'timeout' };
    } finally {
      clearTimeout(timer);
    }
  }
  return { ok: false, reason: 'redirects' };
}
function inspireRefreshTarget(html, base) {
  const re = /<meta\b([^>]*)>/gi;
  let m;
  while ((m = re.exec(html))) {
    const a = inspireAttrs(m[1]);
    if ((a['http-equiv'] || '').toLowerCase() !== 'refresh' || !a.content) continue;
    const t = /url\s*=\s*['"]?([^'"\s;]+)/i.exec(inspireDecodeEntities(a.content));
    if (t) { try { return new URL(t[1], base).href; } catch (e) {} }
  }
  return null;
}
function inspireLoginNext(u) {
  for (const k of ['next', 'continue', 'redirect', 'redirect_url', 'return_to', 'returnTo']) {
    const v = u.searchParams.get(k);
    if (!v) continue;
    try {
      const t = new URL(v, u.href);
      const p = parseLink(t.href);
      if (p && !p.needsResolve) return t.href;
    } catch (e) {}
  }
  return null;
}
// Follow a short link (pin.it, vm.tiktok.com, t.co, instagram.com/share/..., bit.ly, ...) without
// fetching the destination page once it is a recognised content URL. Returns the final URL or null.
async function inspireResolveLink(href, selfHost) {
  let current = href;
  const deadline = Date.now() + INSPIRE_FETCH_BUDGET_MS;
  for (let hop = 0; hop <= INSPIRE_MAX_HOPS; hop++) {
    const u = inspireSafeURL(current, selfHost);
    if (!u) return null;
    if (hop > 0) {
      if (inspireIsLoginURL(u)) return inspireLoginNext(u);
      const p = parseLink(u.href);
      if (p && !p.needsResolve && p.id) return u.href;
    }
    if (hop === INSPIRE_MAX_HOPS) return null;
    const wait = Math.min(INSPIRE_FETCH_TIMEOUT_MS, deadline - Date.now());
    if (wait <= 0) return null;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), wait);
    try {
      const res = await fetch(u.href, {
        method: 'GET', redirect: 'manual', signal: ctrl.signal,
        headers: inspireFetchHeaders('text/html,application/xhtml+xml;q=0.9,*/*;q=0.8'),
      });
      const loc = res.status >= 300 && res.status < 400 ? res.headers.get('Location') : null;
      if (loc) { inspireDiscard(res); current = new URL(loc, u.href).href; continue; }
      const ct = (res.headers.get('Content-Type') || '').toLowerCase();
      if (!res.ok || !ct.includes('html')) { inspireDiscard(res); return hop > 0 ? u.href : null; }
      const next = inspireRefreshTarget(await inspireReadText(res, 64 * 1024, ct), u.href);
      if (next && next !== u.href) { current = next; continue; }
      return hop > 0 ? u.href : null;
    } catch (e) {
      return null;
    } finally {
      clearTimeout(timer);
    }
  }
  return null;
}
// Per-isolate caches (best effort; isolates are short-lived).
const inspireResolveCache = new Map();
const inspireMetaAttempts = new Map();
const inspirePreviewCache = new Map();   // canonical -> L1 result {meta, outcome} (POST /preview, reused by POST /posts)
function inspireCacheGet(map, key) {
  const e = map.get(key);
  if (!e) return undefined;
  if (e.exp < Date.now()) { map.delete(key); return undefined; }
  return e.value;
}
function inspireCacheSet(map, key, value, ttlMs) {
  if (map.size >= 500) map.delete(map.keys().next().value);
  map.set(key, { value, exp: Date.now() + ttlMs });
}
// parseLink + server-side short-link resolution. Unresolvable short links are kept as they are.
// A resolved result carries shortKey (the 'short:' key of the input) for the duplicate check.
async function inspireParseInput(raw, selfHost) {
  const parsed = parseLink(raw);
  if (!parsed || !parsed.needsResolve) return parsed;
  let finalUrl = inspireCacheGet(inspireResolveCache, parsed.canonical);
  if (finalUrl === undefined) {
    finalUrl = await inspireResolveLink(parsed.canonical, selfHost);
    inspireCacheSet(inspireResolveCache, parsed.canonical, finalUrl, finalUrl ? 3600e3 : 300e3);
  }
  if (finalUrl) {
    const again = parseLink(finalUrl);
    if (again && !again.needsResolve) return { ...again, shortKey: parsed.key };
  }
  return parsed;
}
function inspireNeedsCard(p) {
  if (p.platform === 'image' || p.platform === 'video') return false;
  return INSPIRE_CARD_PLATFORMS.has(p.platform) || !p.embed;
}
const inspireMetaFailure = (extra) => JSON.stringify({ failed: 1, at: inspireNowS(), v: META_V, ...(extra || {}) });
const INSPIRE_PIPELINE_MS = 10000;   // L1 budget (page + oEmbed/adapter + probes); create stays synchronous within it

// ── Media previews (meta v2): L1 = adapters + plain fetch + extraction + oEmbed + probe (worker/inspire-media.js);
// L2 = Browser Run fallback, only when the plain fetch was blocked; L3 = manual media column (PUT /media, uploads).
function inspireMetaV2(base, media, via, provider) {
  const m = {
    v: META_V, title: base.title || null, description: base.description || null, image: base.image || null,
    site_name: base.site_name || null, provider: provider || null,
  };
  if (base.login_wall) m.login_wall = true;
  if (m.image && base.image_w && base.image_h) { m.image_w = base.image_w; m.image_h = base.image_h; }
  const md = media ? sanitizeMedia(media) : null;
  if (md) m.media = md;
  m.via = via;
  m.checked = inspireNowS();
  return m.title || m.description || m.image || m.media || m.login_wall ? m : null;
}
// Probes candidates in priority order (<= 3 probes in all, shared with the `small` / poster variants). A probe that
// rejects (html, 404, unsafe redirect) moves on; an inconclusive one (403, timeout) keeps the candidate unverified.
async function inspireChooseMedia(cands, selfHost, deadline) {
  let probes = 0;
  const canProbe = () => probes < 3 && Date.now() < deadline;
  const probe = (u) => { probes++; return inspireProbeMedia(u, selfHost, Math.min(deadline, Date.now() + 3000)); };
  for (const c of cands) {
    if (!c || !c.url) continue;
    if (c.kind === 'player') return { ...c, autoplay: false, verified: true };
    const m = { ...c, verified: false };
    if (canProbe()) {
      const r = await probe(m.url);
      if (r.ok === false) continue;
      if (r.ok) {
        if (r.kind !== m.kind) continue;   // e.g. an "image" candidate that is really a video file
        m.verified = true;
        if (r.bytes != null) m.bytes = r.bytes;
        if (MEDIA_MIMES.has(r.mime)) m.mime = r.mime;
      }
    }
    if (m.kind === 'video') m.autoplay = !(m.bytes > AUTOPLAY_MAX_BYTES);
    if (m.small) {
      if (!canProbe()) delete m.small;
      else { const r = await probe(m.small); if (r.ok !== true || r.kind !== 'video') delete m.small; }
    }
    if (m._posterFallback) {
      if (!canProbe()) m.poster = m._posterFallback;
      else { const r = await probe(m.poster); if (r.ok === false || (r.ok && r.kind !== 'image')) m.poster = m._posterFallback; }
      delete m._posterFallback;
    }
    return m;
  }
  return null;
}
// L1 for a link: adapter.pre -> plain page fetch (head; body scan for video-looking pages) -> extraction -> oEmbed
// discovery (same site) -> adapter.post -> probe. Never Browser Run.
// -> { meta: v2 object | null, outcome: 'ok' | 'blocked' | 'error' | 'skipped' (adapter without a page fetch) }
async function inspireL1(parsed, selfHost, { deadline = Date.now() + INSPIRE_PIPELINE_MS } = {}) {
  const href = parsed.canonical;
  const provider = inspireProviderOf(href);
  if (parsed.platform === 'pinterest' && parsed.subtype === 'pin' && parsed.id) {
    const pm = await inspireFetchPinterestMeta(parsed.canonical, selfHost);
    return { meta: pm ? inspireMetaV2(pm, null, 'plain', 'pinterest.com') : null, outcome: pm ? 'ok' : 'error' };
  }
  const wantMedia = inspireNeedsCard(parsed);
  const ad = wantMedia ? adapterFor(href) : null;
  const src = ad ? `adapter:${ad.name}` : null;
  const cands = [];
  if (ad && ad.pre) {
    for (const v of ad.pre.video || []) cands.push({ kind: 'video', url: v, poster: ad.pre.poster || null, source: src });
    if (ad.pre.image) cands.push({ kind: 'image', url: ad.pre.image, source: src });
  }
  let page = { outcome: 'skipped', meta: null, collected: null, finalUrl: href };
  if (!(ad && ad.skipPage)) {
    page = await inspireFetchPage((ad && ad.pageUrl) || href, selfHost,
      { wantMedia, deadline: Math.min(deadline, Date.now() + INSPIRE_FETCH_BUDGET_MS), fullPage: !!(ad && ad.fullPage) });
  }
  const base = { title: null, description: null, image: null, site_name: null, ...(page.meta || {}) };
  if (!wantMedia) return { meta: inspireMetaV2(base, null, 'plain', provider), outcome: page.outcome };
  if (page.direct) cands.push(page.direct);
  let ex = null;
  if (page.collected) {
    ex = extractMedia(page.collected, page.finalUrl, { imageMedia: !!(ad && ad.imageMedia) });
    if (ex.media) cands.push(ex.media);
  }
  if (ad && ad.extract && page.html) {
    const r = ad.extract(page.html);
    for (const v of r.video || []) cands.push({ kind: 'video', url: v, poster: r.poster || null, source: src });
    if (r.image) cands.push({ kind: 'image', url: r.image, source: src });
    if (r.title && !base.title) base.title = r.title;
    if (r.poster && !base.image) base.image = r.poster;
  }
  if (ex && ex.imageMedia) cands.push(ex.imageMedia);
  const head = page.collected;
  if (!cands.length && head && head.oembedHref && sameSite(head.oembedHref, page.finalUrl)) {
    const o = oembedMedia(await inspireFetchSmall(head.oembedHref, selfHost, { json: true, maxBytes: 64 * 1024, deadline }));
    if (o.imageMedia) cands.push(o.imageMedia);
    else if (o.playerUrl) cands.push({ kind: 'player', url: o.playerUrl, source: 'oembed' });
    if (o.thumb && !base.image) base.image = o.thumb;
    if (o.title && !base.title) base.title = o.title;
  }
  if (!cands.length && ad && ad.post) {
    const body = await inspireFetchSmall(ad.post.url, selfHost, { json: ad.post.type === 'json', maxBytes: ad.post.maxBytes, deadline });
    const r = body != null ? ad.post.parse(body) : {};
    if (r.image) cands.push({ kind: 'image', url: r.image, source: src });
    if (r.thumb && !base.image) base.image = r.thumb;
    if (r.title && !base.title) base.title = r.title;
  }
  const media = await inspireChooseMedia(cands, selfHost, deadline);
  if (media) {
    const exm = ex && ex.media;
    if (!media.w && exm && exm.w && exm.h && exm.kind === media.kind) { media.w = exm.w; media.h = exm.h; }
    if (!media.w && media.kind === 'image' && media.url === base.image && base.image_w) { media.w = base.image_w; media.h = base.image_h; }
    if ((media.kind === 'video' || media.kind === 'hls') && !media.poster && base.image) media.poster = base.image;
  }
  const via = page.outcome === 'skipped' || (media && String(media.source || '').startsWith('adapter:')) ? 'adapter' : 'plain';
  return { meta: inspireMetaV2(base, media, via, provider), outcome: page.outcome };
}

// ── Atomic daily budgets (inspire_quota; same pattern as sb_quota, independent of the storyboard schema) ──
// One statement per reservation / refund however many counters it touches (D1 counts statements per invocation): the
// items travel as one JSON array [[scope, subject, units, lim], ...] read with json_each.
const inspireQuotaJson = (items) => JSON.stringify(items.map((it) => [it.scope, it.subject || '', it.units, it.lim]));
const INSPIRE_QUOTA_ITEMS = `SELECT json_extract(value, '$[0]') AS scope, json_extract(value, '$[1]') AS subject,
  json_extract(value, '$[2]') AS units, json_extract(value, '$[3]') AS lim FROM json_each(?2)`;
// The upsert of every item: a CHECK(n <= lim) failure of any one aborts the whole statement (WHERE true: SQLite's
// INSERT ... SELECT ... ON CONFLICT parsing rule).
const INSPIRE_RESERVE_SQL = `INSERT INTO inspire_quota (day, scope, subject, n, lim)
  SELECT ?1, scope, subject, units, lim FROM (${INSPIRE_QUOTA_ITEMS}) WHERE true
  ON CONFLICT(day, scope, subject) DO UPDATE SET n = n + excluded.n, lim = excluded.lim`;
// All items or none: {ok: true} | {ok: false, scope} (the first counter that would overflow). Other D1 errors throw (fail closed).
async function inspireReserve(db, day, items) {
  if (!items.length) return { ok: true };
  const list = inspireQuotaJson(items);
  try {
    await db.prepare(INSPIRE_RESERVE_SQL).bind(day, list).run();
    return { ok: true };
  } catch (e) {
    if (!isCheckError(e)) throw e;
    const { results } = await db.prepare(`SELECT scope, subject, n FROM inspire_quota WHERE day = ?1
      AND (scope, subject) IN (SELECT scope, subject FROM (${INSPIRE_QUOTA_ITEMS}))`).bind(day, list).all();
    const have = new Map((results || []).map((r) => [r.scope + '\n' + r.subject, Number(r.n) || 0]));
    for (const it of items) {
      const k = it.scope + '\n' + (it.subject || '');
      if ((have.get(k) || 0) + it.units > it.lim) return { ok: false, scope: it.scope };
      have.set(k, (have.get(k) || 0) + it.units);   // the same counter twice in one reservation
    }
    return { ok: false, scope: items[0].scope };
  }
}
async function inspireRefund(db, day, items) {
  if (!items.length) return;
  try {
    await db.prepare(`UPDATE inspire_quota SET n = MAX(0, n - (SELECT SUM(i.units) FROM (${INSPIRE_QUOTA_ITEMS}) i
        WHERE i.scope = inspire_quota.scope AND i.subject = inspire_quota.subject))
      WHERE day = ?1 AND (scope, subject) IN (SELECT scope, subject FROM (${INSPIRE_QUOTA_ITEMS}))`).bind(day, inspireQuotaJson(items)).run();
  } catch (e) { console.error('inspire quota refund', e && e.message); }
}
async function inspireAdjust(db, day, scope, subject, delta) {
  if (!delta) return;
  try {
    await db.prepare('UPDATE inspire_quota SET n = MAX(0, MIN(lim, n + ?4)) WHERE day=?1 AND scope=?2 AND subject=?3')
      .bind(day, scope, subject || '', Math.round(delta)).run();
  } catch (e) { console.error('inspire quota adjust', e && e.message); }
}
function inspireMediaConfig(env) {
  const int = (v, d) => { const n = Number.parseInt(v, 10); return Number.isFinite(n) && n >= 0 ? n : d; };
  return {
    br: env.FIKIR_BR === '1',
    brDaily: int(env.FIKIR_BR_DAILY, 100),
    brMsDaily: int(env.FIKIR_BR_MS_DAILY, 300000),
    brPerCid: int(env.FIKIR_BR_PER_CID, 15),
    brPerIp: int(env.FIKIR_BR_PER_IP, 20),
    brMsPerCid: int(env.FIKIR_BR_MS_PER_CID, 60000),
    brMsPerIp: int(env.FIKIR_BR_MS_PER_IP, 60000),
    uploads: ['off', 'admin', 'users', 'all'].includes(env.FIKIR_MEDIA_UPLOADS) ? env.FIKIR_MEDIA_UPLOADS : 'off',
    upPerN: int(env.FIKIR_UP_PER_CID_N, 10),
    upPerBytes: int(env.FIKIR_UP_PER_CID_MB, 100) * 1048576,
    upPerIpN: int(env.FIKIR_UP_PER_IP_N, 20),
    upPerIpBytes: int(env.FIKIR_UP_PER_IP_MB, 200) * 1048576,
    upDailyBytes: int(env.FIKIR_UP_DAILY_MB, 1000) * 1048576,
    upTotalBytes: int(env.FIKIR_UP_TOTAL_MB, 6000) * 1048576,
  };
}
const inspireSecondsToMidnight = () => { const d = new Date(); d.setUTCHours(24, 0, 0, 0); return Math.max(60, Math.ceil((d.getTime() - Date.now()) / 1000)); };
const inspireSleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── Stored meta writes (rules: never downgrade good data; failures must keep starting with {"failed":) ──
// Good meta replaces: nothing, a failure, any v1 row, client meta, a row waiting for Browser Run, or anything with force.
// A failure (or pending marker) replaces a failure / nothing; on a good or client row it only stamps v:2 + checked
// (and sets or clears the pending fields), so a refetch can never wipe an old title.
async function inspireWriteMeta(db, id, obj, { force = false } = {}) {
  const text = JSON.stringify(obj);
  if (!obj.failed) {
    return db.prepare(`UPDATE inspire_posts SET meta=?2 WHERE id=?1 AND (meta IS NULL OR meta LIKE '{"failed":%' OR ?3 = 1 OR
      CASE WHEN json_valid(meta) THEN COALESCE(json_extract(meta, '$.v'), 1) < 2 OR json_extract(meta, '$.via') = 'client'
        OR json_extract(meta, '$.pending') = 'br' ELSE 1 END)`).bind(id, text, force ? 1 : 0).run();
  }
  return db.batch([
    db.prepare(`UPDATE inspire_posts SET meta=?2 WHERE id=?1 AND (meta IS NULL OR meta LIKE '{"failed":%' OR NOT json_valid(meta))`).bind(id, text),
    db.prepare(`UPDATE inspire_posts SET meta = CASE WHEN ?3 = 1
        THEN json_set(meta, '$.v', 2, '$.checked', ?2, '$.pending', 'br', '$.at', ?2, '$.retry_s', ?4)
        ELSE json_set(json_remove(meta, '$.pending', '$.retry_s', '$.at'), '$.v', 2, '$.checked', ?2) END
      WHERE id=?1 AND meta IS NOT NULL AND meta NOT LIKE '{"failed":%' AND json_valid(meta)`)
      .bind(id, Number(obj.at) || inspireNowS(), obj.pending === 'br' ? 1 : 0, Number(obj.retry_s) || 0),
  ]);
}

// ── L2: Browser Run fallback (Quick Action `scrape`), only for pages whose plain fetch was blocked ──
const INSPIRE_BR_SKIP = /(^|\.)(shutterstock\.com|adobe\.com|123rf\.com|dreamstime\.com)$/;
const INSPIRE_BR_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36';
const INSPIRE_BR_ELEMENTS = [
  { selector: 'title' }, { selector: 'meta[property^="og:"]' },
  { selector: 'meta[property^="twitter:"]' }, { selector: 'meta[name^="twitter:"]' },
  { selector: 'meta[name="description"]' }, { selector: 'link[rel="canonical"]' },
  { selector: 'video' }, { selector: 'video source' }, { selector: 'script[type="application/ld+json"]' },
];
let inspireBrNoBinding = false;
function inspireBrAvailable(env) {
  if (inspireFakeBr) return true;
  if (env.BROWSER && typeof env.BROWSER.quickAction === 'function') return true;
  if (!inspireBrNoBinding) { inspireBrNoBinding = true; console.log('inspire: env.BROWSER.quickAction is missing; the Browser Run fallback is off'); }
  return false;
}
// Flag + binding + skip list + 7-day "this host challenged Browser Run" memory (3 strikes; no counters are touched).
async function inspireBrPossible(env, db, href) {
  if (env.FIKIR_BR !== '1' || !inspireBrAvailable(env)) return false;
  let host;
  try { host = new URL(href).hostname.toLowerCase(); } catch { return false; }
  if (INSPIRE_BR_SKIP.test(host)) return false;
  return (await inspireRateCount(db, 'br_block', host)) < INSPIRE_LIMITS.br_block[0];
}
// Site-wide Browser Run budget left today? (only for /preview's br_possible; admission itself is inspireReserve)
async function inspireBrBudgetLeft(env, db) {
  const cfg = inspireMediaConfig(env);
  try {
    const { results } = await db.prepare("SELECT scope, n FROM inspire_quota WHERE day=?1 AND subject='' AND scope IN ('br', 'br_ms')").bind(utcDay()).all();
    const by = Object.fromEntries((results || []).map((r) => [r.scope, Number(r.n) || 0]));
    return (by.br || 0) + 1 <= cfg.brDaily && (by.br_ms || 0) + 5000 <= cfg.brMsDaily;
  } catch (e) { return true; }
}
async function inspireBrCall(env, href) {
  const opts = {
    url: href,
    userAgent: INSPIRE_BR_UA,   // required: Browser Run's default UA gets a 403 from Magnific; its signed bot headers stay
    setExtraHTTPHeaders: { 'Accept-Language': 'tr-TR,tr;q=0.9,en-US;q=0.8,en;q=0.7' },
    gotoOptions: { waitUntil: 'domcontentloaded', timeout: 15000 },
    waitForTimeout: 1500,
    rejectResourceTypes: ['image', 'font', 'stylesheet', 'media'],
    elements: INSPIRE_BR_ELEMENTS,
  };
  if (inspireFakeBr) {   // local tests only (see inspireTestHooks)
    const r = await fetch(`http://${inspireTestAllow}/__br/scrape`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(opts) });
    if (r.status === 599) throw new Error((await r.text()) || 'fake Browser Run error');
    return r;
  }
  return env.BROWSER.quickAction('scrape', opts);
}
// Admission (daily quotas, then the slot) + one scrape + the same extraction/probe as L1. Never throws.
// Quotas: site-wide calls + browser ms; calls per post; and, when given, the post author's calls + ms (author = its quota
// subject 'c:<cid>' | 'u:<id>', only when the author makes the request) and the requesting IP's calls + ms (ipKey). The
// cron and the admin pass neither. Browser ms are reserved at 5000 per scope and corrected to X-Browser-Ms-Used.
// -> {status: 'ok', meta} | {status: 'pending', retry_s} | {status: 'failed', retry_s?} | {status: 'blocked', retry_s}
//    | {status: 'refused', scope, retry_s} (a per-post / author / IP cap; nothing was called)
async function inspireBrRun(env, db, href, selfHost, { postId = null, author = null, ipKey = null } = {}) {
  if (!(await inspireBrPossible(env, db, href)) || !inspireSafeURL(href, selfHost)) return { status: 'failed' };
  const host = new URL(href).hostname.toLowerCase();
  const cfg = inspireMediaConfig(env);
  const day = utcDay();
  const items = [
    { scope: 'br', subject: '', lim: cfg.brDaily, units: 1 },
    { scope: 'br_ms', subject: '', lim: cfg.brMsDaily, units: 5000 },
  ];
  if (postId != null) items.push({ scope: 'br_post', subject: String(postId), lim: INSPIRE_BR_PER_POST, units: 1 });
  if (author) items.push({ scope: 'br_user', subject: author, lim: cfg.brPerCid, units: 1 }, { scope: 'br_ms_user', subject: author, lim: cfg.brMsPerCid, units: 5000 });
  if (ipKey) items.push({ scope: 'br_ip', subject: ipKey, lim: cfg.brPerIp, units: 1 }, { scope: 'br_ms_ip', subject: ipKey, lim: cfg.brMsPerIp, units: 5000 });
  const msScopes = items.filter((it) => it.units === 5000);
  let q;
  try { q = await inspireReserve(db, day, items); } catch (e) { console.error('inspire br quota', e && e.message); return { status: 'failed', retry_s: 600 }; }
  // site-wide budget spent: wait for UTC midnight (the cron retries); a per-post / author / IP cap: refused (the caller decides)
  if (!q.ok) {
    if (q.scope === 'br' || q.scope === 'br_ms') return { status: 'pending', retry_s: inspireSecondsToMidnight() };
    return { status: 'refused', scope: q.scope, retry_s: q.scope === 'br_post' ? inspireSecondsToMidnight() : 3600 };
  }
  // the slot after the quotas: a refused request never holds it (Free allows 1 Quick Action per 10 s)
  if (await inspireOverLimit(db, [['br_slot', 'all']])) { await inspireRefund(db, day, items); return { status: 'pending', retry_s: 15 }; }
  let used = 0, data = null;
  try {
    const res = await inspireBrCall(env, href);
    used = Number(res.headers.get('X-Browser-Ms-Used')) || 0;
    if (res.status === 429) { inspireDiscard(res); return { status: 'pending', retry_s: Math.max(60, Number(res.headers.get('Retry-After')) || 0) }; }
    if (!res.ok) { inspireDiscard(res); return { status: 'failed', retry_s: 600 }; }
    try { data = JSON.parse(await inspireReadAll(res, 2 * 1024 * 1024, 'application/json; charset=utf-8')); } catch { data = null; }
  } catch (e) {
    const msg = String(e && e.message || e);
    if (/time limit exceeded/i.test(msg)) {   // the account's daily browser time is gone: stop until UTC midnight
      try { await db.prepare("UPDATE inspire_quota SET n = lim WHERE day=?1 AND scope='br' AND subject=''").bind(day).run(); } catch (_) {}
      return { status: 'pending', retry_s: inspireSecondsToMidnight() };
    }
    if (/\b429\b|too many requests|rate limit/i.test(msg)) return { status: 'pending', retry_s: 60 };
    console.error('inspire br', msg.slice(0, 300));
    return { status: 'failed', retry_s: 600 };
  } finally {
    for (const it of msScopes) await inspireAdjust(db, day, it.scope, it.subject, Math.round(used) - 5000);
  }
  if (!data || data.success === false) return { status: 'failed', retry_s: 600 };
  const col = collectFromScrape(data, href);
  // A bot wall: one strike for the host per post (3 different posts in 7 days turn Browser Run off for that host); this post
  // is retried after 6 h (a later /meta runs L1 + Browser Run again while the host has < 3 strikes).
  if (col.blocked) {
    if (postId == null || !(await inspireOverLimit(db, [['br_bpost', `${host}:${postId}`]]))) await inspireOverLimit(db, [['br_block', host]]);
    return { status: 'blocked', retry_s: 6 * 3600 };
  }
  // Not a strike: a removed page fails this post for 30 days; another 4xx is a plain failure, a 5xx is retried after 6 h.
  if (col.gone) return { status: 'failed', retry_s: INSPIRE_BR_GONE_RETRY_S };
  if (col.status >= 400) return col.status >= 500 ? { status: 'failed', retry_s: 6 * 3600 } : { status: 'failed' };
  const ex = extractMedia(col, col.finalUrl);
  const media = await inspireChooseMedia([ex.media, ex.imageMedia].filter(Boolean), selfHost, Date.now() + 9000);
  if (media) media.source = 'br';
  const base = {
    title: col.title && !INSPIRE_GENERIC_TITLES.has(col.title.toLowerCase()) ? col.title : null,
    description: col.description, image: ex.image, site_name: col.site_name,
  };
  if (base.image && col.imageW && col.imageH && col.imageW <= 10000 && col.imageH <= 10000) { base.image_w = col.imageW; base.image_h = col.imageH; }
  const meta = inspireMetaV2(base, media, 'br', inspireProviderOf(href));
  return meta ? { status: 'ok', meta } : { status: 'failed' };
}
// opts: mode 'create' | 'refresh' | 'cron'; author / ipKey as in inspireBrRun; wasPending = the row was already waiting for
// Browser Run (the cron, or a /meta poll of a due pending row).
async function inspireBrAndStore(env, db, id, href, selfHost, { mode = 'refresh', author = null, ipKey = null, wasPending = false } = {}) {
  let r;
  try { r = await inspireBrRun(env, db, href, selfHost, { postId: id, author, ipKey }); }
  catch (e) { console.error('inspire br run', e && e.stack || e); r = { status: 'failed', retry_s: 600 }; }
  // Refused by a per-post / author / IP cap: a new post gets a plain failure (nobody queues unlimited jobs); a post that was
  // already waiting keeps waiting (the cron, which has no author / IP caps, or another viewer runs it within ~10 min; after
  // its 3 calls of the day: from UTC midnight); any other post is retried later (1 h, or midnight).
  if (r.status === 'refused') {
    if (mode === 'create') r = { status: 'failed' };
    else if (wasPending) r = { status: 'pending', retry_s: r.scope === 'br_post' ? r.retry_s : 600 };
    else r = { status: 'failed', retry_s: r.retry_s };
  }
  const at = inspireNowS();
  try {
    if (r.status === 'ok') await inspireWriteMeta(db, id, r.meta);
    else if (r.status === 'pending') await inspireWriteMeta(db, id, { failed: 1, at, v: META_V, retry_s: r.retry_s, pending: 'br' });
    else await inspireWriteMeta(db, id, { failed: 1, at, v: META_V, ...(r.retry_s ? { retry_s: r.retry_s } : {}) });
  } catch (e) { console.error('inspire br store', e && e.message); }
  return r;
}
// POST /meta refresh (v1 row, failure past its retry time, nothing stored yet, or ?force=1): L1, then Browser Run inline
// when the page was blocked and no media was found. The result is written with the rules of inspireWriteMeta.
async function inspireRefresh(env, db, id, parsed, selfHost, { author = null, ipKey = null, force = false } = {}) {
  const l1 = await inspireL1(parsed, selfHost);
  const blocked = inspireNeedsCard(parsed) && !(l1.meta && l1.meta.media) && l1.outcome === 'blocked';
  if (blocked && await inspireBrPossible(env, db, parsed.canonical)) {
    const at = inspireNowS();
    if (l1.meta) await inspireWriteMeta(db, id, { ...l1.meta, pending: 'br', at, retry_s: 15 }, { force });
    else await inspireWriteMeta(db, id, { failed: 1, at, v: META_V, retry_s: 15, pending: 'br' });
    return inspireBrAndStore(env, db, id, parsed.canonical, selfHost, { mode: 'refresh', author, ipKey });
  }
  if (l1.meta) await inspireWriteMeta(db, id, l1.meta, { force });
  else await inspireWriteMeta(db, id, { failed: 1, at: inspireNowS(), v: META_V });
  return null;
}

// ── L3: manual media (owner/admin): a direct media URL (PUT /media, or `media` with a new post) ──
const INSPIRE_MEDIA_ERR = {
  invalid_media_url: [400, 'Geçerli bir http(s) video/görsel linki girin'],
  not_media: [422, 'Bu link bir video/görsel dosyasına gitmiyor. Sayfa linki yerine doğrudan .mp4/.jpg linkini yapıştır'],
  unsupported_type: [422, 'Bu dosya türü desteklenmiyor (SVG vb.)'],
  expiring_url: [422, 'Bu link kısa süre sonra geçersiz olacak (süreli imzalı link). Dosyayı indirip yükle'],
  unverifiable: [422, 'Bu linke ulaşılamadı. Linki kontrol et veya dosyayı yükle'],
};
const inspireMediaErr = (code) => ({ status: INSPIRE_MEDIA_ERR[code][0], error: code, message: INSPIRE_MEDIA_ERR[code][1] });
function inspireCleanInputUrl(v, selfHost) {
  if (typeof v !== 'string') return { error: 'invalid_media_url' };
  const s = v.trim();
  if (!s || s.length > 2048 || !/^https?:\/\//i.test(s)) return { error: 'invalid_media_url' };
  const u = inspireSafeURL(s, selfHost);
  if (!u || !inspireHostOk(u.href) || u.href.length > 2048) return { error: 'invalid_media_url' };
  if (/\.svgz?$/i.test(u.pathname)) return { error: 'unsupported_type' };
  // an expiring signed link with a stable public twin (Magnific free-video preview from the bookmarklet): the twin, probed next
  if (isExpiringUrl(u.href)) { const st = stableVariantFor(u.href); return st ? { url: st } : { error: 'expiring_url' }; }
  return { url: u.href };
}
// d = {url, poster?, kind?, w?, h?} -> {media} | {status, error, message}. The URL is probed (Range 0-0).
async function inspireCheckMediaInput(d, selfHost, source, deadline = Date.now() + 6000) {
  if (!d || typeof d !== 'object' || Array.isArray(d)) return inspireMediaErr('invalid_media_url');
  const c = inspireCleanInputUrl(d.url, selfHost);
  if (c.error) return inspireMediaErr(c.error);
  let poster = null;
  if (d.poster != null && d.poster !== '') {
    const p = inspireCleanInputUrl(d.poster, selfHost);
    if (p.error) return inspireMediaErr(p.error === 'expiring_url' ? 'expiring_url' : p.error);
    const pk = mediaKindOf(p.url);
    if (pk && pk !== 'image') return inspireMediaErr('invalid_media_url');
    poster = p.url;
  }
  const given = ['video', 'image', 'hls'].includes(d.kind) ? d.kind : null;
  const r = await inspireProbeMedia(c.url, selfHost, deadline);
  if (r.ok === false) return inspireMediaErr(r.reason === 'not_media' ? 'not_media' : r.reason === 'svg' ? 'unsupported_type' : 'unverifiable');
  const kind = r.ok ? r.kind : (mediaKindOf(c.url) || given);
  if (!kind) return inspireMediaErr('unverifiable');
  const bytes = r.ok && r.bytes != null ? r.bytes : undefined;
  const media = sanitizeMedia({
    kind, url: c.url, poster, w: d.w, h: d.h, mime: r.ok ? r.mime : undefined, bytes,
    autoplay: kind === 'video' && !(bytes > AUTOPLAY_MAX_BYTES), verified: r.ok === true, source,
  });
  return media ? { media } : inspireMediaErr('invalid_media_url');
}
const inspireUploadsAllowed = (env, actor) => {
  const mode = inspireMediaConfig(env).uploads;
  return !!actor && (mode === 'all' || (mode === 'users' && !actor.guest) || (mode === 'admin' && actor.isAdmin));
};
// /files/<key> paths of a Media object (url, poster, small) that point at our uploads
const inspireMediaKeys = (m) => (m ? [m.url, m.poster, m.small] : []).filter((u) => typeof u === 'string' && u.startsWith('/files/'))
  .map((u) => u.slice('/files/'.length)).filter((k) => FILES_KEY_RE.test(k));
// Deletes this post's orphaned upload objects (after the D1 update that orphaned them succeeded).
async function inspireDeleteOrphans(env, db, postId) {
  const { results } = await db.prepare("SELECT key FROM inspire_media WHERE post_id=?1 AND state='orphan' LIMIT 100").bind(postId).all();
  const keys = (results || []).map((r) => r.key).filter((k) => FILES_KEY_RE.test(k));
  if (!keys.length) return;
  await env.STORAGE.delete(keys);
  await db.batch(keys.map((k) => db.prepare("DELETE FROM inspire_media WHERE key=?1 AND state='orphan'").bind(k)));
}

// POST /api/inspire/posts/:id/media/upload?part=video|image|poster[&w=&h=] (raw body, Content-Length required).
// Check order: auth, uploads flag vs role, post + ownership + card platform, length/caps, rate limits, daily quotas +
// total storage, magic bytes, streamed R2 put (FixedLengthStream: a short or long body fails), then one D1 batch.
// Any failure after the reservation refunds it and removes the object and its row.
async function inspireUpload(request, env, ctx, db, id, { fail, limited, origin }) {
  // A refusal of a body of allowed size reads (discards) the rest of it first, so the client gets the JSON error instead
  // of a connection reset mid-upload (the upload modal shows the message). Bodies over the 25 MB cap are not read.
  const declared = Number(request.headers.get('Content-Length'));
  const drain = async (reader) => {
    if (!request.body || !(declared > 0 && declared <= INSPIRE_UP_VIDEO_MB * 1048576)) return;
    let r = reader;
    try {
      if (!r) r = request.body.getReader();
      for (;;) { const { done } = await r.read(); if (done) break; }
    } catch (e) {}
  };
  const refuse = async (...a) => { await drain(); return fail(...a); };
  const actor = await inspireActor(request, env);
  if (!actor) return refuse(401, 'unauthorized', 'Önce giriş yapın');
  if (!inspireUploadsAllowed(env, actor)) return refuse(403, 'uploads_disabled', 'Dosya yükleme şu anda kapalı');
  const q = new URL(request.url).searchParams;
  const part = q.get('part');
  if (!['video', 'image', 'poster'].includes(part)) return refuse(400, 'bad_request', 'Geçersiz istek');
  const [cid, uid] = inspireOwnerParams(actor);
  const row = await db.prepare(`${INSPIRE_POST_SELECT} WHERE p.id = ?3`).bind(cid, uid, id).first();
  if (!row) return refuse(404, 'not_found', 'Fikir bulunamadı');
  if (!(row.is_mine || actor.isAdmin)) return refuse(403, 'forbidden', 'Bu fikrin önizlemesini değiştirme yetkin yok');
  if (row.type === 'text') return refuse(400, 'not_link_post', 'Metin fikirlere önizleme eklenemez');
  if (!inspireCardish(row.type)) return refuse(409, 'has_player', 'Bu link zaten kendi oynatıcısıyla gösteriliyor');
  const lenHeader = request.headers.get('Content-Length');
  const len = Number(lenHeader);
  if (!lenHeader || !/^\d{1,12}$/.test(lenHeader.trim()) || !Number.isSafeInteger(len) || len <= 0 || !request.body) {
    return refuse(411, 'length_required', 'Dosya boyutu (Content-Length) gerekli');
  }
  const cap = (part === 'video' ? INSPIRE_UP_VIDEO_MB : INSPIRE_UP_IMAGE_MB) * 1048576;
  if (len > cap) return refuse(413, 'file_too_large', 'Video en fazla 25 MB, görsel en fazla 10 MB olabilir');
  const current = inspireMediaOut(row.media);
  if (part === 'poster' && !(current && current.kind === 'video')) return refuse(409, 'no_video', 'Kapak görseli yalnızca yüklenmiş/eklenmiş bir videoya eklenebilir');
  const ipKey = await inspireIpKey(request);
  if (await inspireOverLimit(db, [['upload', inspireActorKey(actor)], ['upload_ip', ipKey]])) { await drain(); return limited(); }
  const cfg = inspireMediaConfig(env);
  const day = utcDay();
  const subject = actor.isAdmin ? 'admin' : inspireActorKey(actor);
  // Daily quotas: per guest cid / user, per IP (cids are client-chosen) and site-wide. The admin is exempt from all of
  // them (guests cannot use up the owner's uploads); the total-storage check below applies to everyone.
  const items = actor.isAdmin ? [] : [
    { scope: 'up_bytes_all', subject: '', lim: cfg.upDailyBytes, units: len },
    { scope: 'up_n', subject, lim: cfg.upPerN, units: 1 }, { scope: 'up_bytes', subject, lim: cfg.upPerBytes, units: len },
    { scope: 'up_n_ip', subject: ipKey, lim: cfg.upPerIpN, units: 1 }, { scope: 'up_bytes_ip', subject: ipKey, lim: cfg.upPerIpBytes, units: len },
  ];
  let q1;
  try { q1 = await inspireReserve(db, day, items); }
  catch (e) { console.error('inspire upload quota', e && e.message); return refuse(503, 'upload_unavailable', 'Yükleme şu anda yapılamıyor, biraz sonra tekrar dene'); }
  if (!q1.ok) return refuse(429, 'quota_exceeded', 'Bugünkü yükleme hakkın doldu', { reset_at: nextResetIso() });
  let reader = null, key = null, rowInserted = false;
  const undo = async () => {
    await inspireRefund(db, day, items);
    if (key) { try { await env.STORAGE.delete(key); } catch (e) {} }
    if (rowInserted) { try { await db.prepare('DELETE FROM inspire_media WHERE key=?').bind(key).run(); } catch (e) {} }
  };
  try {
    const used = await db.prepare("SELECT COALESCE(SUM(bytes), 0) AS b FROM inspire_media WHERE state <> 'orphan'").first();
    if (Number(used && used.b) + len > cfg.upTotalBytes) { await undo(); return refuse(507, 'storage_full', 'Depolama alanı dolu, şimdilik dosya yüklenemiyor'); }
    reader = request.body.getReader();
    let head = new Uint8Array(0);
    while (head.length < 64) {
      const { done, value } = await reader.read();
      if (done) break;
      const merged = new Uint8Array(head.length + value.byteLength);
      merged.set(head); merged.set(value, head.length);
      head = merged;
    }
    const sniff = sniffMagic(head.subarray(0, 64));
    const wantKind = part === 'video' ? 'video' : 'image';
    if (!sniff || sniff.kind !== wantKind) {
      await drain(reader);
      await undo();
      return fail(415, 'unsupported_media_type', 'Desteklenmeyen dosya türü. MP4, WebM, MOV, JPG, PNG, WebP veya GIF yükle');
    }
    const hex = [...crypto.getRandomValues(new Uint8Array(16))].map((b) => b.toString(16).padStart(2, '0')).join('');
    const slot = part === 'video' ? 'v' : part === 'image' ? 'i' : 'p';
    key = `fikir/${id}/${slot}-${hex}.${sniff.ext}`;
    await db.prepare("INSERT INTO inspire_media (key, post_id, slot, subject, mime, bytes, state, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, 'pending', ?7)")
      .bind(key, id, slot, subject, sniff.mime, len, inspireNowS()).run();
    rowInserted = true;
    const { readable, writable } = new FixedLengthStream(len);
    const w = writable.getWriter();
    const pump = (async () => {
      let n = head.length;
      if (n > len) throw new Error('upload longer than Content-Length');
      await w.write(head);
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        n += value.byteLength;
        if (n > len) throw new Error('upload longer than Content-Length');
        await w.write(value);
      }
      await w.close();
    })();
    pump.catch((e) => { try { w.abort(e).catch(() => {}); } catch (_) {} });
    await Promise.all([pump, env.STORAGE.put(key, readable, {
      httpMetadata: { contentType: sniff.mime, cacheControl: 'public, max-age=31536000, immutable', contentDisposition: 'inline' },
      customMetadata: { post: String(id) },
    })]);
  } catch (e) {
    if (reader) reader.cancel().catch(() => {});
    await undo();
    return fail(400, 'upload_incomplete', 'Yükleme yarıda kesildi, tekrar dene');
  }
  const path = '/files/' + key;
  const dimsQ = (v) => { const n = Number.parseInt(v, 10); return Number.isFinite(n) && n >= 1 && n <= 10000 ? n : null; };
  const w = dimsQ(q.get('w')), h = dimsQ(q.get('h'));
  const sniffMime = key.endsWith('.mp4') ? 'video/mp4' : key.endsWith('.webm') ? 'video/webm' : key.endsWith('.mov') ? 'video/quicktime'
    : key.endsWith('.jpg') ? 'image/jpeg' : key.endsWith('.png') ? 'image/png' : key.endsWith('.webp') ? 'image/webp' : 'image/gif';
  let media;
  if (part === 'video') {
    media = { kind: 'video', url: path, poster: current && current.kind === 'video' ? current.poster || null : null, w, h, mime: sniffMime, bytes: len,
      verified: true, autoplay: len <= AUTOPLAY_MAX_BYTES, source: 'upload' };
  } else if (part === 'image') {
    media = { kind: 'image', url: path, w, h, mime: sniffMime, bytes: len, verified: true, autoplay: false, source: 'upload' };
  } else {
    media = { ...current, poster: path };
  }
  media = sanitizeMedia(media, { allowFiles: true });
  // One transaction, all conditional on this upload's row still being 'pending' and the post still existing: a post deleted
  // (or a row swept by the cron) while the body streamed changes nothing here, and the object is removed below.
  const liveSql = "EXISTS (SELECT 1 FROM inspire_media WHERE key=?3 AND state='live')";
  let committed = false;
  try {
    const res = await db.batch([
      db.prepare("UPDATE inspire_media SET state='live' WHERE key=?1 AND state='pending' AND EXISTS (SELECT 1 FROM inspire_posts WHERE id=?2)").bind(key, id),
      db.prepare(`UPDATE inspire_posts SET media=?2 WHERE id=?1 AND ${liveSql}`).bind(id, JSON.stringify(media), key),
      db.prepare(`UPDATE inspire_media SET state='orphan' WHERE post_id=?1 AND state='live' AND key NOT IN (SELECT value FROM json_each(?2)) AND ${liveSql}`)
        .bind(id, JSON.stringify(inspireMediaKeys(media)), key),
    ]);
    committed = !!(res[1] && res[1].meta && res[1].meta.changes);
  } catch (e) {
    console.error('inspire upload commit', e && e.message);
    await undo();
    return fail(500, 'server_error', 'Sunucu hatası, lütfen tekrar deneyin');
  }
  if (!committed) {
    await undo();
    const still = await db.prepare('SELECT 1 FROM inspire_posts WHERE id=?').bind(id).first();
    return still ? fail(400, 'upload_incomplete', 'Yükleme yarıda kesildi, tekrar dene') : fail(404, 'not_found', 'Fikir bulunamadı');
  }
  if (ctx && typeof ctx.waitUntil === 'function') ctx.waitUntil(inspireDeleteOrphans(env, db, id).catch((e) => console.error('inspire media cleanup', e && e.message)));
  let quota = { uploads_left: null, mb_left: null, reset_at: nextResetIso() };
  if (!actor.isAdmin) {
    const rows = await db.prepare("SELECT scope, n, lim FROM inspire_quota WHERE day=?1 AND subject=?2 AND scope IN ('up_n', 'up_bytes')").bind(day, subject).all();
    const by = Object.fromEntries((rows.results || []).map((r) => [r.scope, r]));
    if (by.up_n) quota.uploads_left = Math.max(0, by.up_n.lim - by.up_n.n);
    if (by.up_bytes) quota.mb_left = Math.max(0, Math.floor((by.up_bytes.lim - by.up_bytes.n) / 1048576));
  }
  const after = await db.prepare(`${INSPIRE_POST_SELECT} WHERE p.id = ?3`).bind(cid, uid, id).first();
  if (!after) return fail(404, 'not_found', 'Fikir bulunamadı');   // deleted right after the commit (its delete removes the object)
  return json({ post: inspirePostOut(after, actor.isAdmin, []), quota }, 201, origin);
}

// Cron "*/15" after sbScheduled (same invocation and budget, see cronMain): upload cleanup, quota + rate-counter pruning, then
// due Browser Run retries of link previews (<= 3, 11 s apart: Free allows 1 Quick Action / 10 s), each only while its worst
// case still fits the run's budget. Fixed part: probe (cold only) + 1 select + 1 R2 delete + 1 delete + 1 batch of 2.
// A retry (inspireBrAndStore, mode cron): CRON_COSTS.brRetry (worker/budget.js).
const INSPIRE_BR_RETRY_COST = CRON_COSTS.brRetry;
async function inspireScheduled(env, budget = new Budget('inspire cron', {})) {
  inspireTestHooks(env);
  if (!(await inspireCronSchemaOk(env))) return;
  const db = env.DB;
  const nowS = inspireNowS();
  const { results } = await db.prepare(`SELECT key FROM inspire_media WHERE state = 'orphan' OR (state = 'pending' AND created_at < ?1)
    OR post_id NOT IN (SELECT id FROM inspire_posts) LIMIT 100`).bind(nowS - 3600).all();
  const keys = (results || []).map((r) => r.key);
  const r2keys = keys.filter((k) => FILES_KEY_RE.test(k));
  if (r2keys.length) await env.STORAGE.delete(r2keys);   // one call (<= 1000 keys)
  if (keys.length) await db.prepare('DELETE FROM inspire_media WHERE key IN (SELECT value FROM json_each(?1))').bind(JSON.stringify(keys)).run();
  // expired rate counters: here instead of in every cold isolate's migration
  await db.batch([
    db.prepare('DELETE FROM inspire_quota WHERE day < ?1').bind(utcDay(Date.now() - 7 * 86400e3)),
    db.prepare('DELETE FROM inspire_rate WHERE reset < ?1').bind(nowS),
  ]);
  if (env.FIKIR_BR !== '1' || !budget.fits({ d1: 1 + INSPIRE_BR_RETRY_COST.d1, sub: INSPIRE_BR_RETRY_COST.sub })) return;
  // due rows only (rows waiting for UTC midnight must not crowd the due ones out of the LIMIT)
  const { results: rows } = await db.prepare(`SELECT id, url, meta FROM inspire_posts WHERE meta LIKE '%"pending":"br"%' AND json_valid(meta)
    AND COALESCE(json_extract(meta, '$.at'), 0) + COALESCE(json_extract(meta, '$.retry_s'), 0) <= ?1 ORDER BY id DESC LIMIT 10`).bind(nowS).all();
  const due = (rows || []).filter((r) => {
    const mm = inspireMetaParse(r.meta);
    return inspireMetaPending(mm) && Number(mm.at || 0) + Number(mm.retry_s || 0) <= nowS;
  });
  let ran = 0;
  for (const r of due) {
    if (ran >= 3 || !budget.fits(INSPIRE_BR_RETRY_COST)) break;
    const parsed = r.url ? parseLink(r.url) : null;
    if (!parsed || !inspireNeedsCard(parsed)) continue;
    if (ran > 0) await inspireSleep(11000);   // Free: 1 Quick Action per 10 s
    ran++;
    await inspireBrAndStore(env, db, r.id, parsed.canonical, null, { mode: 'cron', wasPending: true });
  }
}

// ── Downloads + Instagram copies (worker/inspire-video.js) ──
// GET /posts/:id/download streams the post's own media (never an arbitrary URL): our R2 copy/upload, the Instagram post
// (resolved from its page, links cached in inspire_video_cache until they expire), a platform adapter, the link
// preview's media (meta.media / meta.image) or a direct file link, each through the SSRF guard and a magic-byte check.
// R2 copies (inspireCopy): the video + poster of an Instagram / X / TikTok / Facebook / Pinterest / Reddit post go into R2
// (post.media, source = the platform) and the board plays our copy with the post's credit and caption. The cron copies the
// backlog (CRON_IG), cards in view ask for theirs (POST /posts/:id/copy), POST /posts/:id/ig-copy copies an Instagram
// post on request ("Oynamıyor mu?", reels whose embed only shows "Instagram'da İzle").
function inspireVideoConfig(env) {
  const int = (v, d) => { const n = Number.parseInt(v, 10); return Number.isFinite(n) && n >= 0 ? n : d; };
  return {
    dl: env.FIKIR_DL !== '0',
    dlDaily: int(env.FIKIR_DL_DAILY, 1500),
    dlMaxBytes: int(env.FIKIR_DL_MAX_MB, 200) * 1048576,
    igCopy: env.FIKIR_IG_COPY !== '0',
    igAuto: ['off', 'blocked', 'all'].includes(env.FIKIR_IG_AUTO) ? env.FIKIR_IG_AUTO : 'off',
    igCopyDaily: int(env.FIKIR_IG_COPY_DAILY, 40),
    igCopyMaxBytes: int(env.FIKIR_IG_COPY_MB, 40) * 1048576,
    igFetchDaily: int(env.FIKIR_IG_FETCH_DAILY, 300),
    igCronCopies: int(env.FIKIR_IG_CRON_COPIES, 1),   // per "7-59/15" run, each also gated by the run's budget
    igCronChecks: int(env.FIKIR_IG_CRON_CHECKS, 2),
    // platform adapters the downloads may use (YouTube / Vimeo never download: their adapters only say why)
    adapters: new Set(String(env.FIKIR_DL_ADAPTERS == null ? 'x,pinterest,tiktok,facebook,reddit' : env.FIKIR_DL_ADAPTERS).split(',').map((x) => x.trim()).filter(Boolean)),
    adFetchDaily: int(env.FIKIR_DL_AD_DAILY, 400),
    // R2 copies of the other platforms' video posts (cron, on view, on request), through the same adapters
    copyAdapters: new Set(String(env.FIKIR_COPY_ADAPTERS == null ? 'x,pinterest,tiktok,facebook,reddit' : env.FIKIR_COPY_ADAPTERS).split(',').map((x) => x.trim()).filter(Boolean)),
    // on-view copies: POST /posts/:id/copy from a card that came into view (any board session)
    copyView: env.FIKIR_COPY_VIEW !== '0',
    copyViewDaily: int(env.FIKIR_COPY_VIEW_DAILY, 100),         // on-view copies per UTC day, whole site (admin exempt)
    copyViewPerSession: int(env.FIKIR_COPY_VIEW_PER_SESSION, 20), // ... per guest cid / user
    copyViewPerIp: int(env.FIKIR_COPY_VIEW_PER_IP, 40),          // ... per IP
  };
}
// Platforms whose video posts are copied without anyone asking (cron, on view): Instagram while FIKIR_IG_AUTO is on (copies
// on), the others while their adapter is on for downloads AND for copies.
const COPY_PLATFORMS_ALL = ['instagram', 'x', 'tiktok', 'facebook', 'pinterest', 'reddit'];
function inspireAutoCopyOn(cfg, platform) {
  if (platform === 'instagram') return cfg.igCopy && cfg.igAuto !== 'off';
  return cfg.copyAdapters.has(platform) && cfg.adapters.has(platform);
}
const INSPIRE_IG_POSTER_MAX = 10 * 1048576;
const INSPIRE_IG_SQL = `(p.type IN ('instagram', 'reels') OR p.url LIKE '%instagram.com/%')`;
// links that can be an Instagram post (/p/, /reel/, /reels/, /tv/, also after a /<user>/); igRef() decides
const INSPIRE_IG_POST_SQL = `(p.url LIKE '%/p/%' OR p.url LIKE '%/reel/%' OR p.url LIKE '%/reels/%' OR p.url LIKE '%/tv/%')`;
const inspireHex32 = () => [...crypto.getRandomValues(new Uint8Array(16))].map((b) => b.toString(16).padStart(2, '0')).join('');
// SSRF guard for downloads: the usual one plus plain DNS/IPv4 hosts only
const inspireDlSafe = (selfHost) => (href) => { const u = inspireSafeURL(href, selfHost); return u && inspireHostOk(u.href) ? u : null; };
const inspireBoardOrigin = (env) => (/^https:\/\/[a-z0-9.-]+$/i.test(String(env.ALLOWED_ORIGIN || '')) ? env.ALLOWED_ORIGIN : null);

// Takes the site-wide Browser Run slot (1 call per 11 s, INSPIRE_LIMITS.br_slot). -> 0 (ours) | seconds until it frees up
async function inspireBrSlot(db) {
  const now = Math.floor(Date.now() / 1000);
  try {
    const row = await db.prepare(INSPIRE_RATE_SQL.replace(/RETURNING n$/, 'RETURNING n, reset')).bind('br_slot:all', now + INSPIRE_LIMITS.br_slot[1], now).first();
    return row && row.n > INSPIRE_LIMITS.br_slot[0] ? Math.max(1, Number(row.reset) - now) : 0;
  } catch (e) {
    console.error('inspire br slot', e && e.message);
    return 0;   // like inspireOverLimit: a rate-limit table error never blocks
  }
}
// Browser Run Quick Action `content` (page HTML) for an Instagram page whose plain fetch had no post data. Same admission as
// inspireBrRun: site-wide calls + ms, calls per post, the requesting IP's calls + ms, then the 1-per-10-s slot; a taken
// slot is waited for once when it frees up within slotWaitMs.
// -> html | null (Browser Run off / failed) | {refused: true, retry_s, site, scope?} (not admitted now; see igResolve;
//    scope: the budget that refused: br_post = this post's own, br_ip / br_ms_ip = the requesting IP's)
async function inspireBrContent(env, db, url, { postId = null, ipKey = null, slotWaitMs = 0 } = {}) {
  if (env.FIKIR_BR !== '1' || !inspireBrAvailable(env)) return null;
  const cfg = inspireMediaConfig(env);
  const day = utcDay();
  const items = [
    { scope: 'br', subject: '', lim: cfg.brDaily, units: 1 },
    { scope: 'br_ms', subject: '', lim: cfg.brMsDaily, units: 5000 },
  ];
  if (postId != null) items.push({ scope: 'br_post', subject: String(postId), lim: INSPIRE_BR_PER_POST, units: 1 });
  if (ipKey) items.push({ scope: 'br_ip', subject: ipKey, lim: cfg.brPerIp, units: 1 }, { scope: 'br_ms_ip', subject: ipKey, lim: cfg.brMsPerIp, units: 5000 });
  let q;
  try { q = await inspireReserve(db, day, items); }
  catch (e) { console.error('inspire ig br quota', e && e.message); return { refused: true, retry_s: 600, site: true }; }
  if (!q.ok) {
    // the site's daily Browser Run budget: until UTC midnight for every post; this post's / this IP's own: just them
    const site = q.scope === 'br' || q.scope === 'br_ms';
    return { refused: true, retry_s: site || q.scope === 'br_post' ? inspireSecondsToMidnight() : 3600, site, scope: q.scope };
  }
  let wait = await inspireBrSlot(db);
  if (wait && wait * 1000 <= slotWaitMs) { await inspireSleep(wait * 1000 + 250); wait = await inspireBrSlot(db); }
  if (wait) { await inspireRefund(db, day, items); return { refused: true, retry_s: wait, site: true }; }
  let used = 0;
  try {
    const opts = {
      url, userAgent: IG_UA, setExtraHTTPHeaders: { 'Accept-Language': 'tr-TR,tr;q=0.9,en-US;q=0.8,en;q=0.7' },
      gotoOptions: { waitUntil: 'domcontentloaded', timeout: 15000 }, rejectResourceTypes: ['image', 'font', 'stylesheet', 'media'],
    };
    const res = inspireFakeBr   // local tests only (see inspireTestHooks)
      ? await fetch(`http://${inspireTestAllow}/__br/content`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(opts) })
      : await env.BROWSER.quickAction('content', opts);
    used = Number(res.headers.get('X-Browser-Ms-Used')) || 0;
    if (res.status === 429) { inspireDiscard(res); return { refused: true, retry_s: Math.max(60, Number(res.headers.get('Retry-After')) || 0), site: true }; }
    if (!res.ok) { inspireDiscard(res); return null; }
    const ct = (res.headers.get('Content-Type') || '').toLowerCase();
    const text = await inspireReadAll(res, 4 * 1024 * 1024, ct.includes('charset') ? ct : 'text/html; charset=utf-8');
    if (!ct.includes('json')) return text;
    const d = JSON.parse(text);
    return d && d.success !== false && typeof d.result === 'string' ? d.result : null;
  } catch (e) {
    const msg = String(e && e.message || e);
    if (/time limit exceeded/i.test(msg)) {   // the account's daily browser time is gone: stop until UTC midnight
      try { await db.prepare("UPDATE inspire_quota SET n = lim WHERE day=?1 AND scope='br' AND subject=''").bind(day).run(); } catch (_) {}
      return { refused: true, retry_s: inspireSecondsToMidnight(), site: true };
    }
    if (/\b429\b|too many requests|rate limit/i.test(msg)) return { refused: true, retry_s: 60, site: true };
    console.error('inspire ig br', msg.slice(0, 300));
    return null;
  } finally {
    for (const it of items.filter((x) => x.units === 5000)) await inspireAdjust(db, day, it.scope, it.subject, Math.round(used) - 5000);
  }
}
// Instagram fetches by the worker (page or embed): site-wide 10-minute window + daily quota. -> null (ok) | error code
async function inspireIgAdmit(env, db) {
  if (await inspireOverLimit(db, [['ig_fetch', 'all']])) return 'busy';
  try {
    const q = await inspireReserve(db, utcDay(), [{ scope: 'ig_fetch', subject: '', lim: inspireVideoConfig(env).igFetchDaily, units: 1 }]);
    return q.ok ? null : 'daily_limit';
  } catch (e) { return 'quota_unavailable'; }
}
// The post's Instagram media: cached links while they last (>= 15 min left), else one resolve (plain fetch, then Browser Run
// when allowed; a taken Browser Run slot is waited for up to slotWaitMs). Failures back off (10 min .. 24 h; removed posts
// 7 days) so repeated clicks never hammer Instagram. "Busy" (Instagram fetch window / daily budget, Browser Run slot or
// budget) is no failure of the post: never recorded, the caller says "try again later".
// fresh: ignore a cached item (its CDN link just failed). wantPost (R2 copies): a cached caption the old 300-code-point cap
// cut is resolved again once (igCacheCaptionCut).
// -> {ok: true, item, cached} | {ok: false, error} | {ok: false, error: 'busy', busy: true, retry_s, site, scope?}
async function inspireIgItem(env, db, postId, ref, { ipKey = null, allowBR = true, fresh = false, slotWaitMs = 12000, wantPost = false } = {}) {
  const row = await vcGet(db, postId, 'ig');
  if (!fresh && row && vcItemFresh(row) && !(wantPost && igCacheCaptionCut(row))) {
    const it = cacheToItem(row, ref.code);
    if (it) return { ok: true, item: it, cached: true };
  }
  if (!fresh && vcBackingOff(row)) return { ok: false, error: row.error || 'backoff', backoff: true };
  const admit = await inspireIgAdmit(env, db);
  if (admit) return { ok: false, error: 'busy', busy: true, retry_s: admit === 'busy' ? 600 : admit === 'daily_limit' ? inspireSecondsToMidnight() : 600, site: true, why: admit };
  const r = await igResolve(ref, { brContent: allowBR ? (url) => inspireBrContent(env, db, url, { postId, ipKey, slotWaitMs }) : null });
  console.log('inspire ig resolve', postId, r.ok ? 'ok via ' + r.via : r.busy ? `busy (Browser Run refused, retry in ${r.retry_s} s)` : 'failed ' + r.error);   // one Instagram page fetch (+ Browser Run)
  if (r.busy) return { ok: false, error: 'busy', busy: true, retry_s: r.retry_s, site: r.site, scope: r.scope || null, why: 'br' };
  try {
    if (r.ok) {
      const c = itemToCache(r.item);
      await vcPut(db, postId, 'ig', { ...c, extra: { ...c.extra, via: r.via } });
    } else await vcFail(db, postId, 'ig', r.error, { retry: r.retry });
  } catch (e) { console.error('inspire ig cache', e && e.message); }
  return r.ok ? { ok: true, item: r.item, cached: false, via: r.via } : { ok: false, error: r.error };
}
// Embed check of one post (cron, ig-blocked report): stores state blocked|ok|photo (re-checked after 30 days) or backs off.
async function inspireIgEmbed(env, db, postId, ref) {
  const prev = await vcGet(db, postId, 'ig_embed');
  const keep = vcExtra(prev);
  const admit = await inspireIgAdmit(env, db);
  if (admit) return { state: keep.state || null, error: admit };
  const r = await igCheckEmbed(ref, { referer: inspireBoardOrigin(env) });
  try {
    // a failed re-check keeps the last known state (a blocked reel stays queued for its copy)
    if (r.status === 'unknown') await vcFail(db, postId, 'ig_embed', r.error || 'unknown', { extra: { ...keep, state: keep.state || 'unknown' } });
    else await vcPut(db, postId, 'ig_embed', { retry_at: inspireNowS() + 30 * 86400, extra: { ...keep, state: r.status } });
  } catch (e) { console.error('inspire ig embed store', e && e.message); }
  return { state: r.status, error: r.error };
}

// Platform adapter fetches by the worker (X, Pinterest, TikTok, Facebook, Reddit): per-platform site-wide 10-minute
// window (Reddit feeds also 2 / minute) + a daily quota. -> null (ok) | {why, retry_s} (when to ask again at the earliest)
async function inspireAdAdmit(env, db, name, { feed = false } = {}) {
  const pairs = [['ad_fetch', name]];
  if (feed) pairs.push(['ad_rss', 'all']);
  const over = await inspireOverLimitAt(db, pairs);
  if (over) return { why: over === 'ad_rss' ? 'feed_busy' : 'busy', retry_s: INSPIRE_LIMITS[over][1] };
  try {
    const q = await inspireReserve(db, utcDay(), [{ scope: 'ad_fetch', subject: '', lim: inspireVideoConfig(env).adFetchDaily, units: 1 }]);
    return q.ok ? null : { why: 'daily_limit', retry_s: inspireSecondsToMidnight() };
  } catch (e) { return { why: 'quota_unavailable', retry_s: 600 }; }
}
// The post's media through its platform adapter: a cached result while its links last (kind 'ad'; links without expiry
// 7 days; TikTok's cookie-bound links are never cached, so a video download resolves again), else one resolve. Failures
// back off like Instagram's (removed / private / no video: 7 days). YouTube / Vimeo answer without a request.
// needVideo: a cached row that only knows "there is a video" is not enough. fresh: ignore the cache (a link just failed).
// meta: the post's link-preview meta (its media URLs can spare a platform request: Reddit's v.redd.it id).
// -> AdResult (worker/inspire-video.js) + {cached} (+ retry_s when reason is 'busy': the platform's window / budget)
// wantPost (R2 copies): the post's author / caption matter: a cached result without them is resolved again once (a row
// cached before captions were kept has no caption key; one from a download may lack the author), and the adapter may spend
// a request on them (Reddit: the post feed even when the link preview knows the video).
async function inspireAdItem(env, db, postId, ad, parsed, { needVideo = false, fresh = false, meta = null, wantPost = false } = {}) {
  if (ad.support === false) return { ...(await ad.resolve(parsed, {})), cached: false };
  if (!inspireVideoConfig(env).adapters.has(ad.name)) return { ok: false, reason: 'disabled', image: null, cached: false };
  const row = await vcGet(db, postId, 'ad');
  const x = vcExtra(row);
  const mine = row && x.ad === ad.name;
  if (!fresh && mine && vcItemFresh(row)) {
    const c = adFromCache(ad.name, row);
    const thin = wantPost && c && c.ok && !x.post && (!c.by || !('caption' in x));   // the post's details were never asked for
    if (c && !(needVideo && c.ok && c.video && !c.video.url) && !thin) return { ...c, cached: true };
  }
  if (!fresh && mine && vcBackingOff(row)) return { ok: false, reason: row.error || 'backoff', image: null, cached: true, backoff: true };
  const mm = meta && meta.media;
  const deps = { timeoutMs: 8000, maxShort: 1080, wantPost,
    preview: { video: mm && mm.kind === 'video' ? mm.url : null, image: (mm && mm.poster) || (meta && meta.image) || null, title: (meta && meta.title) || null } };
  const feed = typeof ad.feed === 'function' && ad.feed(parsed, deps);
  const admit = await inspireAdAdmit(env, db, ad.name, { feed });
  if (admit) return { ok: false, reason: 'busy', image: null, cached: false, retry_s: admit.retry_s };
  let r;
  try { r = await ad.resolve(parsed, deps); }
  catch (e) { console.error('inspire dl adapter', ad.name, e && e.message); r = { ok: false, reason: 'error', retry: 'soon', image: null }; }
  try {
    if (r.ok || r.reason === 'no_video') { const c = adToCache(ad.name, r); await vcPut(db, postId, 'ad', wantPost ? { ...c, extra: { ...c.extra, post: 1 } } : c); }
    else await vcFail(db, postId, 'ad', r.reason, { retry: r.retry, extra: { ad: ad.name } });
  } catch (e) { console.error('inspire ad cache', e && e.message); }
  console.log('inspire dl adapter', ad.name, postId, r.ok ? 'ok' : r.reason, r.ok && r.video ? (r.video.mux ? 'split' : 'progressive') : '', feed ? 'feed' : '');
  return { ...r, cached: false };
}
// Turkish text for a reason a post's video cannot be downloaded (download-info, error page). YouTube / Vimeo
// (adapter support:false): their own text (INSPIRE_DL_PLATFORM_TR), never the generic one.
const INSPIRE_DL_PLATFORM_TR = {
  youtube: 'YouTube videoları siteden indirilemiyor — YouTube buna izin vermiyor.',
  vimeo: 'Vimeo videoları siteden indirilemiyor — Vimeo bu videoları şifreli (DRM) yayınlıyor.',
};
const INSPIRE_DL_REASON_TR = {
  not_supported: 'Bu videonun biçimi siteden indirilemiyor. Kaynağında açabilirsin.',
  drm: 'Bu video şifreli (DRM) yayınlanıyor; siteden indirilemiyor. Kaynağında açabilirsin.',
  login_required: 'Bu video herkese açık değil (giriş gerekiyor); buradan indirilemiyor.',
  not_found: 'Gönderi kaldırılmış ya da bulunamadı.',
  no_video: 'Bu gönderide video yok.',
  disabled: 'Bu platformdan indirme şu anda kapalı.',
  busy: 'Bu platforma şu anda çok fazla istek yapıldı. Birkaç dakika sonra tekrar dene.',
};
const inspireDlReasonText = (reason, adName) =>
  (adName && INSPIRE_DL_PLATFORM_TR[adName]) || (reason && INSPIRE_DL_REASON_TR[reason]) || null;
// YouTube / Vimeo: the platform never lets the worker download the video (ciphered / SABR streams, bot checks, DRM).
// -> {name, reason} of that adapter, or null
function inspireDlUnsupported(parsed) {
  const ad = parsed && !igRef(parsed) ? dlAdapterFor(parsed) : null;
  return ad && ad.support === false ? { name: ad.name, reason: ad.reason || 'not_supported' } : null;
}
const INSPIRE_DL_AUTH_TR = 'İndirme bağlantısının süresi doldu ya da oturum yok. Fikir Havuzu’na dönüp yeniden “İndir”e bas.';

// Failure page of a download link (opened as a navigation): tiny Turkish HTML, no scripts, every value escaped.
// extra: {href (same-origin path), text} for one more link (e.g. "Kapak görselini indir" for a YouTube post)
function inspireDlErrorPage(env, status, message, source, extra = null) {
  const esc = (v) => String(v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const src = typeof source === 'string' && /^https?:\/\//i.test(source) && inspireHostOk(source) ? source : null;
  const board = inspireBoardOrigin(env);
  const more = extra && typeof extra.href === 'string' && /^\/api\/inspire\/[A-Za-z0-9/_.?=&-]+$/.test(extra.href) ? extra : null;
  const html = `<!doctype html><html lang="tr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex"><title>İndirilemedi</title><style>body{font:16px/1.5 system-ui,-apple-system,sans-serif;margin:0;padding:40px 16px;background:#0b0b0b;color:#eee}
main{max-width:560px;margin:0 auto}h1{font-size:22px;margin:0 0 12px}a{color:#7cc4ff;overflow-wrap:anywhere}p{margin:0 0 12px}</style></head>
<body><main><h1>İndirilemedi</h1><p>${esc(message)}</p>${more ? `<p><a href="${esc(more.href)}" rel="nofollow">${esc(more.text)}</a></p>` : ''}${src ? `<p>Kaynağında aç: <a href="${esc(src)}" rel="noopener noreferrer nofollow">${esc(src)}</a></p>` : ''}${board ? `<p><a href="${esc(board + '/fikir')}">Fikir Havuzu’na dön</a></p>` : ''}</main></body></html>`;
  return new Response(html, { status, headers: {
    'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer',
    'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
  } });
}
function inspireDlResponse(body, { length = null, fixed = false, mime, ext, parts }) {
  const h = new Headers({
    'Content-Type': mime, 'Content-Disposition': contentDisposition(parts, ext), 'Cache-Control': 'private, no-store',
    'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'none'; sandbox", 'Referrer-Policy': 'no-referrer',
    'Access-Control-Allow-Origin': '*', 'Access-Control-Expose-Headers': 'Content-Disposition, Content-Length',
  });
  let out = body;
  if (length != null) {
    h.set('Content-Length', String(length));
    // a stream of known length goes through FixedLengthStream so the browser shows download progress
    if (!fixed && body instanceof ReadableStream && typeof FixedLengthStream === 'function') out = body.pipeThrough(new FixedLengthStream(length));
  }
  return new Response(out, { status: 200, headers: h });
}
// Download ticket (?k= on the download link, worker/fikir-gate.js dlTicket): a download is a navigation / plain fetch
// without the Authorization header, so download-info hands every session a link with a 15-minute ticket for that post.
// Role 'a' (the admin) also skips the site-wide daily download budget (guests cannot use up the owner's downloads).
// A download needs a valid ticket or a session header; anything else is 401 (inspireDlAuth).
// -> {admin: bool} | null
async function inspireDlAuth(request, env, id) {
  const role = await dlTicketRole(env, id, new URL(request.url).searchParams.get('k'));
  if (role) return { admin: role === 'a' };
  const actor = request.headers.get('Authorization') ? await inspireActor(request, env) : null;
  return actor ? { admin: !!actor.isAdmin } : null;
}
const inspireDlAsJson = (request) => {
  const accept = request.headers.get('Accept') || '';
  return new URL(request.url).searchParams.get('format') === 'json' || (/application\/json/i.test(accept) && !/text\/html/i.test(accept));
};
const INSPIRE_DL_FILE_MIMES = { mp4: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime', jpg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif' };
// GET /api/inspire/posts/:id/download?part=video|image|auto&k=<ticket> (default auto = the video, else the image; for
// YouTube / Vimeo auto = the video only: 422 not_downloadable, never the thumbnail in its place; part=image gives it).
// auth: inspireDlAuth() of this request (the session gate in handleInspire already refused requests without one).
async function inspireDownload(request, env, ctx, db, id, { selfHost, origin, auth }) {
  const reqUrl = new URL(request.url);
  const qp = reqUrl.searchParams.get('part');
  const part = qp == null || qp === '' ? 'auto' : ['video', 'image', 'auto'].includes(qp) ? qp : null;
  const asJson = inspireDlAsJson(request);
  let source = null;
  const fail = (status, error, message, extra, link = null) => (asJson
    ? json({ error, message, ...(source ? { source } : {}), ...(extra || {}) }, status, origin)
    : inspireDlErrorPage(env, status, message, source, link));
  if (!auth) return fail(401, 'unauthorized', INSPIRE_DL_AUTH_TR);
  if (!part) return fail(400, 'bad_request', 'Geçersiz istek (part=video|image)');
  const cfg = inspireVideoConfig(env);
  if (!cfg.dl) return fail(503, 'downloads_disabled', 'İndirme şu anda kapalı.');
  const ipKey = await inspireIpKey(request);
  if (await inspireOverLimit(db, [['dl_ip', ipKey]])) return fail(429, 'rate_limited', 'Çok fazla indirme isteği. Biraz bekleyip tekrar dene.');
  const row = await db.prepare('SELECT id, type, url, description, media, meta FROM inspire_posts WHERE id=?').bind(id).first();
  if (!row) return fail(404, 'not_found', 'Fikir bulunamadı.');
  let parsed = row.url ? parseLink(row.url) : null;
  source = parsed && inspireHostOk(parsed.canonical) ? parsed.canonical : null;
  if (row.type === 'text') return fail(404, 'nothing_to_download', 'Bu fikir yalnızca metin; indirilecek video ya da görsel yok.');
  if (parsed && parsed.needsResolve) {
    // a short link the board could not resolve when it was added (pin.it, vm.tiktok.com, fb.watch, ...): once more
    const again = await inspireParseInput(row.url, selfHost);
    if (again && !again.needsResolve && inspireHostOk(again.canonical)) { parsed = again; source = again.canonical; }
  }
  const media = inspireMediaOut(row.media), meta = inspireMetaOut(row.meta);
  const ig = igRef(parsed);
  // YouTube / Vimeo: no video from the platform. Without a video from elsewhere (an upload, a link-preview file) auto and
  // video are refused at once (no budget unit, no platform request): 422 + the reason, never the thumbnail in its place.
  const unsupported = inspireDlUnsupported(parsed);
  if (unsupported && part !== 'image') {
    const otherVideo = (media && media.kind === 'video') || (meta && meta.media && meta.media.kind === 'video') || (parsed && parsed.platform === 'video');
    if (!otherVideo) {
      const hint = dlHint({ type: row.type, parsed, media, meta });
      const image = !!(hint && hint.image);
      const k = reqUrl.searchParams.get('k');
      const coverHref = `/api/inspire/posts/${id}/download?part=image` + (k ? '&k=' + encodeURIComponent(k) : '');
      return fail(422, 'not_downloadable', inspireDlReasonText(unsupported.reason, unsupported.name),
        { reason: unsupported.reason, unsupported: true, platform: unsupported.name, image },
        image ? { href: coverHref, text: 'Kapak görselini indir' } : null);
    }
  }
  // Site-wide daily budget (FIKIR_DL_DAILY) of downloads that fetch from elsewhere: taken before the first upstream request
  // (Instagram / platform resolve, CDN or linked file) and refunded when nothing is served. Our own R2 files (copies,
  // uploads) never count, nor does the admin's download (admin ticket or admin session).
  const day = utcDay();
  const dayItem = [{ scope: 'dl', subject: '', lim: cfg.dlDaily, units: 1 }];
  let dayState = auth.admin ? 'exempt' : null;   // taken | exceeded | error
  const takeDay = async () => {
    if (dayState === null) {
      try { dayState = (await inspireReserve(db, day, dayItem)).ok ? 'taken' : 'exceeded'; } catch (e) { dayState = 'error'; }
    }
    return dayState === 'taken' || dayState === 'exempt';
  };
  const titleParts = ['fikir', id, titleSlug((meta && meta.title) || row.description || '')];
  const safeURL = inspireDlSafe(selfHost);
  let lastError = null, opens = 0, igRes = null, igRetried = false, adRes = null, adRetried = false, adReason = null;
  const igParts = (it) => ['instagram', it && it.user, ig.code];
  // R2 object (our upload / Instagram copy) of the wanted kind
  const fromFiles = async (path, want, parts) => {
    const key = path.slice('/files/'.length);
    if (!FILES_KEY_RE.test(key)) return null;
    const ext = key.slice(key.lastIndexOf('.') + 1);
    const mime = INSPIRE_DL_FILE_MIMES[ext];
    if (!mime || !mime.startsWith(want + '/')) return null;
    const obj = await env.STORAGE.get(key);
    if (!obj) { lastError = 'gone'; return null; }
    return inspireDlResponse(obj.body, { length: obj.size, fixed: true, mime, ext, parts });
  };
  // headers: a platform CDN's Referer / cookie (TikTok), sent to that host only and never back to the client
  const fromUrl = async (u, want, parts, headers = null) => {
    if (typeof u !== 'string' || !u) return null;
    if (u.startsWith('/files/')) return fromFiles(u, want, parts);
    if (opens >= 4 || !(await takeDay())) return null;
    opens++;
    const r = await openMedia(u, { want, maxBytes: cfg.dlMaxBytes, safeURL, totalMs: 30 * 60e3, headers });
    if (!r.ok) { lastError = r.error; return null; }
    return inspireDlResponse(r.body, { length: r.length, fixed: r.fixed, mime: r.mime, ext: r.ext, parts });
  };
  // Reddit: picture + sound files joined into one MP4 on the fly (exact length known up front)
  const fromMux = async (v, parts) => {
    if (opens >= 4 || !(await takeDay())) return null;
    opens++;
    const r = await openMuxed(v.url, v.audio_url, { safeURL, maxBytes: cfg.dlMaxBytes });
    if (!r.ok) { lastError = r.error; return null; }
    return inspireDlResponse(r.body, { length: r.length, fixed: r.fixed, mime: r.mime, ext: r.ext, parts });
  };
  const tryWant = async (want) => {
    let res;
    // 1. stored media: R2 copy / upload, or a manual direct link
    if (media) {
      const u = want === 'video' ? (media.kind === 'video' ? media.url : null) : (media.kind === 'image' ? media.url : media.kind === 'video' ? media.poster : null);
      // our copy: "<platform>-<user>-<the platform's post id>.mp4", like a download straight from the platform
      const rr = parsed && !ig && !parsed.id ? redditRef(parsed.canonical) : null;
      const parts = COPY_SOURCES.has(media.source) ? [media.source, media.by, (ig && ig.code) || (parsed && parsed.id) || (rr && (rr.postId || rr.vid)) || id] : titleParts;
      if (u && (res = await fromUrl(u, want, parts))) return res;
    }
    // 2. Instagram post (resolved once; a cached CDN link that fails is resolved again once). Instagram busy for a moment:
    //    say so (429) rather than serve the poster in place of the video.
    if (ig && (igRes || (await takeDay()))) {
      if (!igRes) igRes = await inspireIgItem(env, db, id, ig, { ipKey });
      for (;;) {
        if (!igRes.ok) { lastError = 'ig_' + igRes.error; if (igRes.busy && want === 'video') return null; break; }
        const it = igRes.item;
        const u = want === 'video' ? (it.video && it.video.url) : (it.image && it.image.url);
        if (!u) break;
        if ((res = await fromUrl(u, want, igParts(it)))) return res;
        if (igRetried || !igRes.cached || !/^(gone|upstream_4\d\d)$/.test(String(lastError))) break;
        igRetried = true;
        igRes = await inspireIgItem(env, db, id, ig, { ipKey, fresh: true });
      }
    }
    // 3. platform adapter: X, Pinterest, TikTok, Facebook, Reddit (YouTube / Vimeo: no video, only why + a poster).
    //    Resolved once (cached in inspire_video_cache 'ad'); a cached link that fails is resolved again once.
    const ad = !ig ? dlAdapterFor(parsed) : null;
    if (ad && (await takeDay())) {
      const needVideo = want === 'video';
      if (!adRes || (needVideo && adRes.ok && adRes.video && !adRes.video.url)) adRes = await inspireAdItem(env, db, id, ad, parsed, { needVideo, meta });
      for (;;) {
        if (!adRes.ok) adReason = adRes.reason;
        const parts = [ad.name, adRes.by, adRes.id || parsed.id];
        if (needVideo) {
          const v = adRes.ok ? adRes.video : null;
          if (!v || !v.url) break;
          if ((res = v.mux === 'cmaf' && v.audio_url ? await fromMux(v, parts) : await fromUrl(v.url, 'video', parts, v.headers))) return res;
        } else {
          if (!adRes.image) break;
          if ((res = await fromUrl(adRes.image.url, 'image', parts))) return res;
        }
        if (adRetried || !adRes.cached || !/^(gone|upstream_4\d\d)$/.test(String(lastError))) break;
        adRetried = true;
        adRes = await inspireAdItem(env, db, id, ad, parsed, { needVideo, fresh: true, meta });
      }
      // a platform busy for a few minutes: say so (429) rather than serve a lesser file (Reddit's preview is silent)
      if (needVideo && adReason === 'busy') return null;
    }
    // 4. link preview media (meta.media; its poster / meta.image for images)
    const mm = meta && meta.media;
    if (mm) {
      const u = want === 'video' ? (mm.kind === 'video' ? mm.url : null) : (mm.kind === 'image' ? mm.url : mm.kind === 'video' ? mm.poster : null);
      if (u && (res = await fromUrl(u, want, titleParts))) return res;
    }
    // 5. the post link itself is a file / the page image
    if (parsed && parsed.platform === want && (res = await fromUrl(parsed.canonical, want, titleParts))) return res;
    if (want === 'image' && meta && meta.image && (res = await fromUrl(meta.image, want, titleParts))) return res;
    return null;
  };
  try {
    // auto: the video, else the image; never the image of a platform whose video cannot be downloaded (YouTube / Vimeo)
    for (const want of part === 'auto' ? (unsupported ? ['video'] : ['video', 'image']) : [part]) {
      const res = await tryWant(want);
      if (res) return res;
      if (want === 'video' && ((igRes && igRes.busy) || adReason === 'busy')) break;   // 429 below, not the poster
    }
  } catch (e) {
    console.error('inspire download', id, e && e.stack || e);
    lastError = 'error';
  }
  if (dayState === 'taken') await inspireRefund(db, day, dayItem);
  console.log('inspire download failed', id, part, lastError || '-', adReason || '-', dayState || '-');
  if (dayState === 'exceeded') return fail(429, 'quota_exceeded', 'Bugünkü indirme sınırı doldu. Yarın tekrar dene ya da kaynağında aç.', { reset_at: nextResetIso() });
  if (dayState === 'error') return fail(503, 'download_unavailable', 'İndirme şu anda yapılamıyor, biraz sonra tekrar dene.');
  const what = part === 'video' ? 'videosu' : part === 'image' ? 'görseli' : 'videosu ya da görseli';
  if (lastError === 'too_large') return fail(413, 'too_large', `Bu dosya çok büyük (en fazla ${Math.round(cfg.dlMaxBytes / 1048576)} MB).`);
  if (igRes && igRes.busy) {
    const s = igRes.retry_s, when = s <= 60 ? 'Birkaç saniye sonra tekrar dene' : s <= 1800 ? 'Birkaç dakika sonra tekrar dene' : 'Yarın tekrar dene';
    return fail(429, 'busy', `Instagram’dan şu anda çok fazla istek yapıldı. ${when} ya da kaynağında aç.`, { reason: 'ig_busy', retry_s: s });
  }
  // platform adapter: why its video is not downloadable (YouTube, Vimeo, private / removed posts, ...)
  if (adReason === 'busy') return fail(429, 'busy', INSPIRE_DL_REASON_TR.busy + ' Ya da kaynağında aç.', { reason: 'busy' });
  if (adReason && part !== 'image' && INSPIRE_DL_REASON_TR[adReason]) {
    const text = inspireDlReasonText(adReason, unsupported ? unsupported.name : null);
    return fail(adReason === 'disabled' ? 503 : unsupported ? 422 : 404, 'not_downloadable', text, { reason: adReason, ...(unsupported ? { unsupported: true } : {}) });
  }
  if (adReason && !lastError) lastError = adReason;
  return fail(lastError ? 502 : 404, 'not_downloadable', `Bu fikrin ${what} buradan indirilemedi.`, lastError ? { reason: String(lastError).slice(0, 40) } : null);
}

// ── R2 copies of video posts: Instagram, X, TikTok, Facebook, Pinterest, Reddit ──
// Copies the post's video (+ poster) into R2 and stores it as post.media {kind 'video', source: <platform>, by, caption,
// audio}: the board plays our copy with the post's credit and caption. Never replaces a manual media; a post that already
// has a copy keeps it. target: copyTargetOf(parsed) (worker/inspire-video.js) plus {parsed}.
// Daily budgets by caller (`by`); every copy but the admin's counts into the site-wide copies (FIKIR_IG_COPY_DAILY, scope
// 'ig_copy' for every platform) and the site-wide daily upload bytes:
//   'cron'                     nothing more
//   'admin'                    none at all (guests cannot use up the owner's copies)
//   {subject, ip}              a guest / user asking for it (POST ig-copy): at most half of the copies for all guests
//                              together (the cron and the admin keep the rest) + the per-cid/user and per-IP upload quotas
//   {view: true, subject, ip}  a card in view (POST /copy): the on-view copies of the whole site, of this session and of
//                              this IP (FIKIR_COPY_VIEW_*); its bytes are not the viewer's uploads (site-wide bytes only)
// The total storage cap (FIKIR_UP_TOTAL_MB) applies to everyone.
// -> {status: 'copied'|'exists'|'manual'|'busy'|'ig_busy'|'ad_busy'|'quota'|'storage_full'|'disabled'|'no_video'|'too_large'|
//    'resolve_failed'|'fetch_failed'|'not_found'|'error', media?, error?, retry?, via?, retry_s?, site?}
// busy: another request holds this post's copy lock. ig_busy / ad_busy: Instagram / Browser Run / the platform's fetch
// window or daily budget refused for now: not a failure of the post (site: refused for every post of that platform).
// retryStale: a cached link that died is resolved again and reopened at once (requests); the cron (false) instead marks it
// stale and fails softly, so the next run resolves it: one copy then stays within its CRON_COSTS.
async function inspireCopy(env, db, id, target, { selfHost = null, ipKey = null, allowBR = true, slotWaitMs = 12000, by = 'cron', retryStale = true } = {}) {
  const cfg = inspireVideoConfig(env);
  if (target.platform === 'instagram' ? !cfg.igCopy : !(cfg.copyAdapters.has(target.platform) && cfg.adapters.has(target.platform))) return { status: 'disabled' };
  const cur = await db.prepare('SELECT media, meta FROM inspire_posts WHERE id=?').bind(id).first();
  if (!cur) return { status: 'not_found' };
  if (cur.media) {
    const m = inspireMediaOut(cur.media);
    return m && COPY_SOURCES.has(m.source) ? { status: 'exists', media: m } : { status: 'manual' };
  }
  // one copy of a post at a time: the counter row is the lock (expires after 120 s if this request dies), released below
  if (await inspireOverLimit(db, [['igcopy_lock', String(id)]])) return { status: 'busy' };
  try { return await inspireCopyLocked(env, db, id, target, { selfHost, ipKey, allowBR, slotWaitMs, by, retryStale, meta: inspireMetaOut(cur.meta) }); }
  finally { try { await db.prepare('DELETE FROM inspire_rate WHERE k=?').bind('igcopy_lock:' + id).run(); } catch (e) {} }
}
// A copy started by a request (POST /copy, POST ig-copy) runs under ctx.waitUntil: Cloudflare cancels a request's pending
// work when its client goes away (a reload, a closed tab), which would skip inspireCopy's lock release, refunds and undo
// halfway through a stream. waitUntil keeps it running up to 30 s past a disconnect; one cut even later leaves its lock to
// expire (120 s) and its pending rows to the cleanup cron. -> p
function inspireCopyKept(ctx, p) {
  if (ctx && typeof ctx.waitUntil === 'function') ctx.waitUntil(p.catch((e) => console.error('inspire copy kept', e && e.message)));
  return p;
}
// The media of a copy target: Instagram through its page (inspireIgItem: cached links while they last), the others through
// their adapter (inspireAdItem with needVideo: TikTok's cookie-bound links are never cached, so they resolve again).
// -> {ok: true, video: {url, headers?, mux?, audio_url?}, image: {url}|null, w, h, by, caption, audio, via, cached}
//  | {ok: false, status: 'ig_busy'|'ad_busy'|'no_video'|'resolve_failed'|'disabled', error?, retry?, retry_s?, site?, scope?}
const INSPIRE_AD_GONE = new Set(['not_found', 'login_required', 'drm', 'not_supported', 'bad_input']);
async function inspireCopySource(env, db, id, target, { ipKey, allowBR, slotWaitMs, meta, fresh = false }) {
  if (target.platform === 'instagram') {
    const r = await inspireIgItem(env, db, id, target.ref, { ipKey, allowBR, fresh, slotWaitMs, wantPost: true });
    if (!r.ok) {
      return r.busy ? { ok: false, status: 'ig_busy', retry_s: r.retry_s, site: r.site, scope: r.scope || null }
        : { ok: false, status: 'resolve_failed', error: r.error, retry: r.error === 'gone' ? 'gone' : 'soon' };
    }
    const it = r.item;
    if (!it.video) return { ok: false, status: 'no_video' };
    return { ok: true, video: { url: it.video.url }, image: it.image ? { url: it.image.url } : null, w: it.w, h: it.h, by: it.user,
      caption: it.caption, audio: it.has_audio, via: r.via || 'cache', cached: !!r.cached };
  }
  const r = await inspireAdItem(env, db, id, target.ad, target.parsed, { needVideo: true, fresh, meta, wantPost: true });
  if (!r.ok) {
    if (r.reason === 'busy') return { ok: false, status: 'ad_busy', retry_s: r.retry_s || 600, site: true };
    if (r.reason === 'disabled') return { ok: false, status: 'disabled' };
    if (r.reason === 'no_video') return { ok: false, status: 'no_video' };
    return { ok: false, status: 'resolve_failed', error: r.reason || 'error', retry: INSPIRE_AD_GONE.has(r.reason) ? 'gone' : 'soon' };
  }
  const v = r.video;
  if (!v || !v.url) return { ok: false, status: 'no_video' };
  return { ok: true, video: v, image: r.image || null, w: v.w || null, h: v.h || null, by: r.by || null, caption: r.caption || null,
    audio: typeof v.audio === 'boolean' ? v.audio : null, via: r.cached ? 'cache' : target.platform, cached: !!r.cached };
}
async function inspireCopyLocked(env, db, id, target, { selfHost, ipKey, allowBR, slotWaitMs, by, retryStale, meta }) {
  const cfg = inspireVideoConfig(env);
  const mcfg = inspireMediaConfig(env);
  const day = utcDay();
  const view = by && typeof by === 'object' && by.view ? by : null;
  const guest = by && typeof by === 'object' && !by.view ? by : null;
  const items = by === 'admin' ? [] : [{ scope: 'ig_copy', subject: '', lim: cfg.igCopyDaily, units: 1 }];
  if (guest) {
    items.push({ scope: 'ig_copy', subject: 'guests', lim: Math.ceil(cfg.igCopyDaily / 2), units: 1 },
      { scope: 'up_n', subject: guest.subject, lim: mcfg.upPerN, units: 1 }, { scope: 'up_n_ip', subject: guest.ip, lim: mcfg.upPerIpN, units: 1 });
  }
  if (view) {
    items.push({ scope: 'ig_copy', subject: 'view', lim: cfg.copyViewDaily, units: 1 },
      { scope: 'copy_view', subject: view.subject, lim: cfg.copyViewPerSession, units: 1 }, { scope: 'copy_view_ip', subject: view.ip, lim: cfg.copyViewPerIp, units: 1 });
  }
  let bytesItems = [], keys = [], rows = false;
  const undo = async () => {
    await inspireRefund(db, day, [...items, ...bytesItems]);
    if (keys.length) { try { await env.STORAGE.delete(keys); } catch (e) {} }
    if (rows) { try { await db.prepare('DELETE FROM inspire_media WHERE key IN (SELECT value FROM json_each(?1))').bind(JSON.stringify(keys)).run(); } catch (e) {} }
  };
  let q;
  try { q = await inspireReserve(db, day, items); } catch (e) { return { status: 'error', error: 'quota_unavailable' }; }
  if (!q.ok) return { status: 'quota', scope: q.scope };
  const safeURL = inspireDlSafe(selfHost);
  const failed = ({ ok, ...rest }) => rest;   // a failed source -> the copy's result
  const dead = (e) => /^(audio_)?(gone|upstream_4\d\d)$/.test(String(e || ''));
  // Reddit: picture + sound joined into one MP4 on the fly (exact length known up front); TikTok: its CDN's Referer + cookie
  const openVideo = (s) => (s.video.mux === 'cmaf' && s.video.audio_url
    ? openMuxed(s.video.url, s.video.audio_url, { safeURL, maxBytes: cfg.igCopyMaxBytes, totalMs: 120000 })
    : openMedia(s.video.url, { want: 'video', maxBytes: cfg.igCopyMaxBytes, safeURL, totalMs: 120000, headers: s.video.headers || null }));
  const meta2 = { cacheControl: 'public, max-age=31536000, immutable', contentDisposition: 'inline' };
  let v = null;
  try {
    let src = await inspireCopySource(env, db, id, target, { ipKey, allowBR, slotWaitMs, meta });
    if (!src.ok) { await undo(); return failed(src); }
    v = await openVideo(src);
    if (!v.ok && src.cached && dead(v.error)) {
      if (!retryStale) {
        try { await db.prepare('UPDATE inspire_video_cache SET expires_at = 1 WHERE post_id=?1 AND kind=?2').bind(id, target.platform === 'instagram' ? 'ig' : 'ad').run(); } catch (e) {}
      } else {
        src = await inspireCopySource(env, db, id, target, { ipKey, allowBR, slotWaitMs, meta, fresh: true });
        if (!src.ok) { await undo(); return failed(src); }
        v = await openVideo(src);
      }
    }
    if (!v.ok) { await undo(); return { status: /too_large$/.test(v.error) ? 'too_large' : 'fetch_failed', error: v.error }; }
    let vBody = v.body, vLen = v.length;
    if (vLen == null) { const buf = await new Response(v.body).arrayBuffer(); vBody = buf; vLen = buf.byteLength; }   // capped by openMedia
    let pBuf = null, pExt = null, pMime = null;
    if (src.image && src.image.url) {
      const p = await openMedia(src.image.url, { want: 'image', maxBytes: INSPIRE_IG_POSTER_MAX, safeURL, totalMs: 30000 });
      if (p.ok) { try { pBuf = await new Response(p.body).arrayBuffer(); pExt = p.ext; pMime = p.mime; } catch (e) { pBuf = null; } }
    }
    // no size from the platform (Facebook, some pins): the poster's, so the card reserves the right box before the video loads
    let w = src.w, h = src.h;
    if (!(w && h) && pBuf) { const d = imageDims(new Uint8Array(pBuf)); if (d) { w = d.w; h = d.h; } }
    const total = vLen + (pBuf ? pBuf.byteLength : 0);
    const bi = by === 'admin' ? [] : [{ scope: 'up_bytes_all', subject: '', lim: mcfg.upDailyBytes, units: total }];
    if (guest) bi.push({ scope: 'up_bytes', subject: guest.subject, lim: mcfg.upPerBytes, units: total }, { scope: 'up_bytes_ip', subject: guest.ip, lim: mcfg.upPerIpBytes, units: total });
    const q2 = await inspireReserve(db, day, bi);
    if (!q2.ok) { if (vBody instanceof ReadableStream) vBody.cancel().catch(() => {}); await undo(); return { status: 'quota', scope: q2.scope }; }
    bytesItems = bi;
    const used = await db.prepare("SELECT COALESCE(SUM(bytes), 0) AS b FROM inspire_media WHERE state <> 'orphan'").first();
    if (Number(used && used.b) + total > mcfg.upTotalBytes) { if (vBody instanceof ReadableStream) vBody.cancel().catch(() => {}); await undo(); return { status: 'storage_full' }; }
    const vKey = `fikir/${id}/v-${inspireHex32()}.${v.ext}`;
    const pKey = pBuf ? `fikir/${id}/p-${inspireHex32()}.${pExt}` : null;
    keys = [vKey, pKey].filter(Boolean);
    const nowS = inspireNowS();
    const subject = target.platform === 'instagram' ? 'ig' : target.platform;   // inspire_media.subject: who made the file
    await db.batch([
      db.prepare("INSERT INTO inspire_media (key, post_id, slot, subject, mime, bytes, state, created_at) VALUES (?1, ?2, 'v', ?3, ?4, ?5, 'pending', ?6)").bind(vKey, id, subject, v.mime, vLen, nowS),
      ...(pKey ? [db.prepare("INSERT INTO inspire_media (key, post_id, slot, subject, mime, bytes, state, created_at) VALUES (?1, ?2, 'p', ?3, ?4, ?5, 'pending', ?6)").bind(pKey, id, subject, pMime, pBuf.byteLength, nowS)] : []),
    ]);
    rows = true;
    const custom = { post: String(id), source: target.platform };
    const vPut = vBody instanceof ReadableStream && !v.fixed && typeof FixedLengthStream === 'function' ? vBody.pipeThrough(new FixedLengthStream(vLen)) : vBody;
    await env.STORAGE.put(vKey, vPut, { httpMetadata: { contentType: v.mime, ...meta2 }, customMetadata: custom });
    if (pKey) await env.STORAGE.put(pKey, pBuf, { httpMetadata: { contentType: pMime, ...meta2 }, customMetadata: custom });
    const media = sanitizeMedia({
      kind: 'video', url: '/files/' + vKey, poster: pKey ? '/files/' + pKey : null, w, h, mime: v.mime, bytes: vLen,
      verified: true, autoplay: vLen <= AUTOPLAY_MAX_BYTES, source: target.platform, by: src.by, caption: src.caption, audio: src.audio,
    }, { allowFiles: true });
    if (!media) { await undo(); return { status: 'error', error: 'media_invalid' }; }
    const mediaJson = JSON.stringify(media), keysJson = JSON.stringify(keys);
    // One transaction: rows live only while the post exists, media set only while it is still empty (a manual media set
    // meanwhile wins), and rows whose post did not take the media are orphaned (the cron removes them).
    const out = await db.batch([
      db.prepare("UPDATE inspire_media SET state='live' WHERE key IN (SELECT value FROM json_each(?1)) AND state='pending' AND EXISTS (SELECT 1 FROM inspire_posts WHERE id=?2)").bind(keysJson, id),
      db.prepare(`UPDATE inspire_posts SET media=?2 WHERE id=?1 AND media IS NULL AND
        (SELECT COUNT(*) FROM inspire_media WHERE key IN (SELECT value FROM json_each(?3)) AND state='live') = ?4`).bind(id, mediaJson, keysJson, keys.length),
      db.prepare("UPDATE inspire_media SET state='orphan' WHERE key IN (SELECT value FROM json_each(?1)) AND NOT EXISTS (SELECT 1 FROM inspire_posts WHERE id=?2 AND media=?3)").bind(keysJson, id, mediaJson),
    ]);
    if (!(out[1] && out[1].meta && out[1].meta.changes)) {
      await undo();
      const still = await db.prepare('SELECT media FROM inspire_posts WHERE id=?').bind(id).first();
      return { status: still ? 'manual' : 'not_found' };
    }
    try { await vcPut(db, id, copyKind(target.platform), { url: media.url, poster: media.poster, width: media.w, height: media.h, bytes: vLen, extra: { via: src.via || 'cache' } }); } catch (e) {}
    return { status: 'copied', media, via: src.via || 'cache' };
  } catch (e) {
    console.error('inspire copy', target.platform, id, e && e.stack || e);
    if (v && v.ok && v.body instanceof ReadableStream) v.body.cancel().catch(() => {});
    await undo();
    return { status: 'error', error: 'copy_failed' };
  }
}
// What a copy that did not happen leaves in the post's copy record (kind ig_copy / ad_copy), so neither the cron nor the
// cards in view ask for it again too soon: a post's own failure backs off (10 min .. 24 h; removed / private 7 days; no
// video in the post or a file over the copy cap 30 days); a refusal for this post only (its own Browser Run budget,
// br_post) defers it without counting a failure; site-wide refusals (budgets, quotas, a busy platform), a caller's own
// budgets (an IP's Browser Run calls) and races leave nothing.
async function inspireCopyRecord(db, id, kind, res) {
  const s = res.status;
  if (['copied', 'exists', 'manual', 'busy', 'quota', 'storage_full', 'disabled', 'not_found'].includes(s)) return;
  if (s === 'ig_busy' || s === 'ad_busy') {
    if (!res.site && res.scope === 'br_post') await vcDefer(db, id, kind, res.retry_s, 'br_post');
    return;
  }
  const retry = s === 'no_video' || s === 'too_large' ? 'never' : res.retry === 'gone' ? 'gone' : 'soon';
  await vcFail(db, id, kind, res.error && s !== 'too_large' ? res.error : s, { retry });
}
// Turkish error of a copy request (POST ig-copy) -> [HTTP status, message]
const INSPIRE_TR_FROM = { instagram: '’dan', x: '’ten', tiktok: '’tan', facebook: '’tan', pinterest: '’ten', reddit: '’ten' };
function inspireCopyErr(status, platform) {
  const n = COPY_PLATFORM_TR[platform] || 'Platform';
  const from = n + (INSPIRE_TR_FROM[platform] || '’dan');
  const t = {
    disabled: [503, `${n} kopyalama şu anda kapalı`],
    manual: [409, `Bu fikre elle bir önizleme eklenmiş; ${n} kopyası onun yerine geçmez`],
    busy: [409, 'Bu gönderi şu anda kopyalanıyor, biraz sonra tekrar bak'],
    ig_busy: [429, `${from} şu anda çok fazla istek yapıldı, biraz sonra tekrar dene`],
    ad_busy: [429, `${from} şu anda çok fazla istek yapıldı, biraz sonra tekrar dene`],
    quota: [429, 'Bugünkü kopyalama sınırı doldu'],
    storage_full: [507, 'Depolama alanı dolu, şimdilik kopyalanamıyor'],
    no_video: [422, `Bu ${n} gönderisinde video yok`],
    too_large: [413, 'Video kopyalamak için çok büyük'],
    resolve_failed: [502, `${n} gönderisine şu anda ulaşılamadı, biraz sonra tekrar dene`],
    fetch_failed: [502, `Video ${from} alınamadı, biraz sonra tekrar dene`],
    not_found: [404, 'Fikir bulunamadı'],
    error: [500, 'Sunucu hatası, lütfen tekrar deneyin'],
  };
  return t[status] || t.error;
}
// GET /posts (current board): copy_view = the board asks for this post's R2 copy once its card comes into view (POST
// /posts/:id/copy). False for a post with media, a platform not copied automatically, a removed copy, a copy record still
// backing off (a failure, no video, deferred), an Instagram photo (embed state), and in FIKIR_IG_AUTO=blocked for an
// Instagram embed not found blocked. recs: the post's inspire_video_cache rows of kinds ig_copy / ad_copy / ig_embed.
function inspireCopyView(cfg, parsed, media, recs, nowS) {
  if (!cfg.copyView || media) return false;
  const t = copyTargetOf(parsed, (pf) => inspireAutoCopyOn(cfg, pf));
  if (!t) return false;
  const kind = copyKind(t.platform);
  let embed = null;
  for (const r of recs || []) {
    if (r.kind === kind && (vcExtra(r).removed || Number(r.retry_at) > nowS)) return false;
    if (r.kind === 'ig_embed') embed = vcExtra(r).state || null;
  }
  if (t.platform === 'instagram' && (embed === 'photo' || (cfg.igAuto === 'blocked' && embed !== 'blocked'))) return false;
  return true;
}

// Cron "7-59/15" (its own invocation; budget CRON_BUDGET, see cronIg): R2 copies (<= igCronCopies, default 2) of video
// posts of every copy platform: Instagram while FIKIR_IG_AUTO is on (=blocked: reels whose embed is blocked; =all: every
// Instagram post, /p/ links too, photos drop out through their embed state 'photo' or the resolver's no_video, 30 days),
// X / TikTok / Facebook / Pinterest / Reddit while FIKIR_COPY_ADAPTERS names them (image pins, photo tweets ... drop out
// the same way); blocked Instagram embeds first, then newest first. Then Instagram embed checks (<= igCronChecks, default
// 2). Each starts only when its worst case still fits the run's budget (CRON_COSTS igCopy / igCopyPlain / adCopyBy: a
// second copy in the same run never uses Browser Run). Platform requests 3 s apart; the first Instagram copy that needs Browser Run
// waits for its 1-per-11-s slot (inspireIgItem). Every row a loop passes over is recorded (failure backoff or vcDefer)
// so it leaves the LIMIT window and cannot stall the queue. On-view copies (POST /copy) drain the same queue between runs.
// Worst cases: CRON_COSTS (worker/budget.js; measured by tests/cron-budget.test.mjs). A cron copy never resolves a second
// time in the same run (inspireCopy retryStale), which keeps it within its cost.
const INSPIRE_IG_CHECK_COST = CRON_COSTS.igCheck;
// candidate links of each adapter platform (copyTargetOf() decides; a match that is no post is deferred 30 days)
const INSPIRE_AD_URL_SQL = {
  x: "(p.url LIKE '%://x.com/%' OR p.url LIKE '%.x.com/%' OR p.url LIKE '%twitter.com/%')",
  tiktok: "p.url LIKE '%tiktok.com/%'",
  facebook: "(p.url LIKE '%facebook.com/%' OR p.url LIKE '%fb.watch/%')",
  pinterest: "(p.url LIKE '%pinterest.%' OR p.url LIKE '%pin.it/%')",
  reddit: "(p.url LIKE '%reddit.com/%' OR p.url LIKE '%redd.it/%')",
};
const inspireCopyCost = (platform, second) => (platform === 'instagram' ? (second ? CRON_COSTS.igCopyPlain : CRON_COSTS.igCopy)
  : CRON_COSTS.adCopyBy[platform] || CRON_COSTS.adCopy);
async function inspireIgScheduled(env, budget = new Budget('ig cron', {})) {
  const cfg = inspireVideoConfig(env);
  const igOn = inspireAutoCopyOn(cfg, 'instagram');
  const adOn = Object.keys(INSPIRE_AD_URL_SQL).filter((pf) => inspireAutoCopyOn(cfg, pf));
  if (!igOn && !adOn.length) return;
  inspireTestHooks(env);
  if (!(await inspireCronSchemaOk(env))) return;
  const db = env.DB;
  const nowS = inspireNowS();
  await db.prepare('DELETE FROM inspire_video_cache WHERE post_id NOT IN (SELECT id FROM inspire_posts)').run();
  let calls = 0;
  const pace = async () => { if (calls++ > 0) await inspireSleep(3000); };
  const costs = [igOn && CRON_COSTS.igCopy, ...adOn.map((pf) => inspireCopyCost(pf, false))].filter(Boolean);
  const least = { d1: Math.min(...costs.map((c) => c.d1)), sub: Math.min(...costs.map((c) => c.sub)) };
  if (costs.length && cfg.igCronCopies > 0 && budget.fits({ d1: 1 + least.d1, sub: least.sub })) {
    const embedIs = (st) => `EXISTS (SELECT 1 FROM inspire_video_cache e WHERE e.post_id = p.id AND e.kind = 'ig_embed' AND json_extract(e.extra, '$.state') = '${st}')`;
    const want = [];
    if (igOn) want.push(`(${INSPIRE_IG_SQL} AND ${INSPIRE_IG_POST_SQL} AND ${cfg.igAuto === 'all' ? `NOT ${embedIs('photo')}` : embedIs('blocked')})`);
    if (adOn.length) want.push(`(NOT ${INSPIRE_IG_SQL} AND (${adOn.map((pf) => INSPIRE_AD_URL_SQL[pf]).join(' OR ')}))`);
    const { results } = await db.prepare(`SELECT p.id, p.url FROM inspire_posts p WHERE p.media IS NULL AND (${want.join(' OR ')})
      AND NOT EXISTS (SELECT 1 FROM inspire_video_cache c WHERE c.post_id = p.id AND c.kind IN ('ig_copy', 'ad_copy')
        AND (COALESCE(c.retry_at, 0) > ?1 OR json_extract(c.extra, '$.removed') = 1))
      ORDER BY ${igOn ? `${embedIs('blocked')} DESC, ` : ''}p.id DESC LIMIT 10`).bind(nowS).all();
    let done = 0;
    const busy = new Set();   // platforms that refused for now (their fetch window / daily budget): the next run
    for (const r of results || []) {
      if (done >= cfg.igCronCopies) break;
      const parsed = r.url ? parseLink(r.url) : null;
      const target = copyTargetOf(parsed, (pf) => inspireAutoCopyOn(cfg, pf));
      if (!target) {
        if (!budget.fits({ d1: 1 })) break;
        try { await vcDefer(db, r.id, /instagram\.com\//i.test(r.url || '') ? 'ig_copy' : 'ad_copy', 30 * 86400, 'not_post'); } catch (e) {}
        continue;
      }
      if (busy.has(target.platform)) continue;
      const second = done > 0;
      if (!budget.fits(inspireCopyCost(target.platform, second))) break;
      await pace();
      done++;
      const res = await inspireCopy(env, db, r.id, { ...target, parsed }, { allowBR: !second, by: 'cron', retryStale: false });
      console.log('inspire copy cron', target.platform, r.id, res.status, res.error || (res.via ? 'via ' + res.via : '') || (res.retry_s ? `retry in ${res.retry_s} s` : ''));
      if (['quota', 'storage_full'].includes(res.status)) break;
      // not this post's failure: refused for every post of the platform (Instagram window / budget, Browser Run, the
      // adapter's window) -> the next run; only this post's own Browser Run budget is spent -> it is deferred until then
      if ((res.status === 'ig_busy' || res.status === 'ad_busy') && res.site) busy.add(target.platform);
      try { await inspireCopyRecord(db, r.id, copyKind(target.platform), res); } catch (e) {}
    }
  }
  if (igOn && cfg.igCronChecks > 0 && budget.fits({ d1: 1 + INSPIRE_IG_CHECK_COST.d1, sub: INSPIRE_IG_CHECK_COST.sub })) {
    const { results } = await db.prepare(`SELECT p.id, p.url FROM inspire_posts p WHERE p.media IS NULL AND ${INSPIRE_IG_SQL} AND ${INSPIRE_IG_POST_SQL}
      AND NOT EXISTS (SELECT 1 FROM inspire_video_cache e WHERE e.post_id = p.id AND e.kind = 'ig_embed' AND COALESCE(e.retry_at, 0) > ?1)
      ORDER BY p.id DESC LIMIT 20`).bind(nowS).all();
    let done = 0;
    for (const r of results || []) {
      if (done >= cfg.igCronChecks) break;
      const ref = igRef(r.url ? parseLink(r.url) : null);
      if (!ref) {
        if (!budget.fits({ d1: 1 })) break;
        try { await vcDefer(db, r.id, 'ig_embed', 30 * 86400, 'not_post'); } catch (e) {}
        continue;
      }
      if (!budget.fits(INSPIRE_IG_CHECK_COST)) break;
      await pace();
      done++;
      const res = await inspireIgEmbed(env, db, r.id, ref);
      if (res.error === 'busy' || res.error === 'daily_limit') break;
    }
  }
}

// Cron Triggers (wrangler.toml [triggers]). Each fires its own invocation with its own Free-plan limits, so the work is split
// by controller.cron and every run is metered (worker/budget.js: D1 statements and subrequests charged, hard caps
// CRON_BUDGET). CRON_IG -> cronIg; CRON_MAIN and anything else (a manual /__scheduled run) -> cronMain.
const SB_CRON_CAP = CRON_COSTS.sbShare;   // the storyboard reconcile's share of a main run (it goes first)
async function cronMain(env, budget) {
  try { await sbScheduled(env, { budget, cap: SB_CRON_CAP }); } catch (e) { console.error('sb cron', e && e.stack || e); }
  try { await inspireScheduled(env, budget); } catch (e) { console.error('inspire cron', e && e.stack || e); }
}
async function cronIg(env, budget) {
  try { await inspireIgScheduled(env, budget); } catch (e) { console.error('inspire ig cron', e && e.stack || e); }
}

// ── Session gate of /api/inspire/* (board password, worker/fikir-gate.js) ──
// Open without a session: GET /config (flags only), POST /guest (board password), POST /login (admin / legacy users);
// the CORS preflight is answered before this. GET /posts/:id/download takes a download ticket (?k=) or a session header.
// Everything else, unknown paths included, needs a session: a guest token with the current pv, or an admin / registered
// user token (DELETE /posts/:id also accepts the portfolio admin JWT, as before). No session -> 401 before any D1 work.
const INSPIRE_OPEN_ROUTES = new Set(['GET /api/inspire/config', 'POST /api/inspire/guest', 'POST /api/inspire/login']);
const INSPIRE_DOWNLOAD_RE = /^\/api\/inspire\/posts\/(\d{1,15})\/download$/;
const INSPIRE_UPLOAD_RE = /^\/api\/inspire\/posts\/\d{1,15}\/media\/upload$/;
// -> 'open' | 'download' | 'session'
function inspireGateKind(cleanPath, method) {
  if (INSPIRE_OPEN_ROUTES.has(`${method} ${cleanPath}`)) return 'open';
  if (method === 'GET' && INSPIRE_DOWNLOAD_RE.test(cleanPath)) return 'download';
  return 'session';
}
// Reads (discards) an upload body of allowed size before a refusal, so the client gets the JSON instead of a reset.
async function inspireDrain(request) {
  const declared = Number(request.headers.get('Content-Length'));
  if (!request.body || !(declared > 0 && declared <= INSPIRE_UP_VIDEO_MB * 1048576)) return;
  try { const r = request.body.getReader(); for (;;) { const { done } = await r.read(); if (done) break; } } catch (e) {}
}
async function handleInspire(request, env, ctx, cleanPath, method, origin) {
  const kind = inspireGateKind(cleanPath, method);
  let dlAuth = null;
  try {
    if (kind === 'download') {
      dlAuth = await inspireDlAuth(request, env, Number(INSPIRE_DOWNLOAD_RE.exec(cleanPath)[1]));
      if (!dlAuth) {
        return inspireDlAsJson(request)
          ? json({ error: 'unauthorized', message: INSPIRE_DL_AUTH_TR }, 401, origin)
          : inspireDlErrorPage(env, 401, INSPIRE_DL_AUTH_TR, null);
      }
    } else if (kind === 'session') {
      let ok = !!(await inspireActor(request, env));
      // the portfolio admin panel deletes posts with its own JWT (see DELETE /posts/:id)
      if (!ok && method === 'DELETE' && /^\/api\/inspire\/posts\/\d{1,15}$/.test(cleanPath)) {
        const siteAdmin = await authMiddleware(request, env);
        ok = !!(siteAdmin && siteAdmin.role === 'admin');
      }
      if (!ok) {
        if (method === 'POST' && INSPIRE_UPLOAD_RE.test(cleanPath)) await inspireDrain(request);
        const hadToken = /^Bearer\s+\S/i.test(request.headers.get('Authorization') || '');
        return hadToken
          ? json({ error: 'session_expired', message: 'Oturumun sona erdi, şifreyle tekrar gir.' }, 401, origin)
          : json({ error: 'unauthorized', message: 'Önce giriş yapın' }, 401, origin);
      }
    }
  } catch (e) {
    console.error('inspire gate', cleanPath, e && e.stack || e);
    return json({ error: 'server_error', message: 'Sunucu hatası, lütfen tekrar deneyin' }, 500, origin);
  }
  const res = await handleInspireRoutes(request, env, ctx, cleanPath, method, origin, dlAuth);
  // Board files in the JSON (/files/fikir/…, /files/sb/…) get the files token (?t=) that /files asks for.
  if (kind === 'session' && filesGateOn(env) && /^application\/json/i.test(res.headers.get('Content-Type') || '')) {
    try {
      const text = await res.text();
      const token = text.includes('"/files/') ? await filesToken(env) : null;
      return new Response(signFilesJson(text, token), { status: res.status, statusText: res.statusText, headers: res.headers });
    } catch (e) {
      console.error('inspire files sign', cleanPath, e && e.stack || e);
      return json({ error: 'server_error', message: 'Sunucu hatası, lütfen tekrar deneyin' }, 500, origin);
    }
  }
  return res;
}

// ── /api/inspire/* routes. Every error is JSON {error, message} with CORS headers. ──
async function handleInspireRoutes(request, env, ctx, cleanPath, method, origin, dlAuth) {
  const fail = (status, error, message, extra) => json({ error, message, ...(extra || {}) }, status, origin);
  const limited = () => fail(429, 'rate_limited', 'Çok fazla istek. Biraz bekleyip tekrar dene.');
  inspireTestHooks(env);
  // Raw file uploads stream past the 64 KB JSON cap (their own Content-Length caps apply); every other route keeps it.
  const isUpload = method === 'POST' && /^\/api\/inspire\/posts\/\d{1,15}\/media\/upload$/.test(cleanPath);
  try {
    if (!isUpload && (method === 'POST' || method === 'PUT') && Number(request.headers.get('Content-Length') || 0) > INSPIRE_MAX_BODY) {
      return fail(413, 'payload_too_large', 'İstek çok büyük');
    }
    await ensureInspireSchema(env);
    // Storyboard tables (idempotent, memoized like the inspire schema). If this fails, the rest of the board keeps
    // working: the storyboard hooks below fall back to "no storyboards" and the storyboard routes answer 503.
    const sbReady = await ensureStoryboardSchema(env).then(() => true, (e) => { console.error('sb schema', e && e.message); return false; });
    const db = env.DB;
    const selfHost = new URL(request.url).hostname.toLowerCase();
    let m;
    // Only the current board (fikir.html sends "X-Fikir-Client: 2") gets storyboard fields; old cached pages never see them.
    const sbClient = request.headers.get('X-Fikir-Client') === '2';
    // AI storyboards (worker/storyboard/routes.js): same JSON/CORS/error shape, actor, post select and rate limiter as below.
    const sbDeps = {
      db, fail, ok: (data, status = 200) => json(data, status, origin),
      getActor: () => inspireActor(request, env), readBody: () => inspireBody(request),
      cleanText: cleanInspireText, postSelect: INSPIRE_POST_SELECT, ownerParams: inspireOwnerParams, maxText: INSPIRE_MAX_TEXT,
      overLimit: async (actor) => inspireOverLimit(db, [['sb', inspireActorKey(actor)], ['sb_ip', await inspireIpKey(request)]]),
      limited,
    };

    // Table init (kept for the old frontend; the migration above already ran)
    if (cleanPath === '/api/inspire/init' && method === 'GET') {
      return json({ ok: true }, 200, origin);
    }

    // Feature flags / limits (no board content: open without a session). `storyboard` = the storyboard creation UI may be
    // shown to this caller; `sb` carries the limits and (with a session) today's remaining quota. Auth is optional here and
    // an invalid token is ignored (never 401). Clients without "X-Fikir-Client: 2" get the Phase A answer (no `sb`).
    // gate: true = the board needs the board password (POST /guest); locked: the secret is missing (nobody but the admin
    // can enter); session: what the sent token is worth now ('none' | 'expired' | 'guest' | 'user' | 'admin').
    if (cleanPath === '/api/inspire/config' && method === 'GET') {
      const gate = { gate: true, locked: boardLocked(env) };
      if (!sbClient) return json({ storyboard: false, max_note_len: INSPIRE_MAX_NOTE, max_text_len: INSPIRE_MAX_TEXT, ...gate }, 200, origin);
      const actor = await inspireActor(request, env);
      const hadToken = /^Bearer\s+\S/i.test(request.headers.get('Authorization') || '');
      const session = actor ? (actor.isAdmin ? 'admin' : actor.guest ? 'guest' : 'user') : hadToken ? 'expired' : 'none';
      const sb = sbReady ? await sbHook('config', () => sbConfigPayload(env, db, actor), null) : null;
      const vcfg = inspireVideoConfig(env);
      const media = {
        attach: true, uploads: inspireUploadsAllowed(env, actor), max_video_mb: INSPIRE_UP_VIDEO_MB, max_image_mb: INSPIRE_UP_IMAGE_MB,
        types: INSPIRE_UP_TYPES,
        download: vcfg.dl, ig_copy: vcfg.igCopy && !!actor, ig_auto: vcfg.igAuto,   // GET /posts/:id/download, POST /posts/:id/ig-copy
        // POST /posts/:id/copy from cards in view (posts with copy_view), and the platforms copied without anyone asking
        copy_view: vcfg.copyView && !!actor, copy: COPY_PLATFORMS_ALL.filter((pf) => inspireAutoCopyOn(vcfg, pf)),
      };
      return json({ storyboard: !!(sb && sb.can_create), max_note_len: INSPIRE_MAX_NOTE, max_text_len: INSPIRE_MAX_TEXT, sb, media, ...gate, session }, 200, origin);
    }

    // Guest session: the board password + a client-generated id (+ a display name; nothing = Anonim). The name is only a
    // display name, never a username. Same cid = same guest (the device code restore sends a cid from another device and
    // needs the password too). The password: constant-time compare against FIKIR_BOARD_PASSWORD; secret missing -> 503
    // board_locked (never open); wrong -> 401 bad_password, counted per IP (8 / 15 min), per network (40 / 15 min) and
    // site-wide (300 / hour), then 429 too_many_attempts; limiter unavailable -> 503 login_unavailable (nothing compared).
    if (cleanPath === '/api/inspire/guest' && method === 'POST') {
      const d = await inspireBody(request);
      if (!d) return fail(400, 'bad_request', 'Geçersiz istek');
      const cid = typeof d.cid === 'string' ? d.cid : '';
      if (!INSPIRE_CID_RE.test(cid)) return fail(400, 'invalid_cid', 'Geçersiz istemci kimliği');
      if (boardLocked(env)) return fail(503, 'board_locked', 'Pano şu anda kilitli; şifreyle giriş kapalı. Daha sonra tekrar dene.');
      const ipKey = await inspireIpKey(request);
      // Counted BEFORE the compare (inspireBoardPwLimit: per IP, per network, site-wide; fails closed); a right (or empty)
      // password gives its counts back, so only wrong ones add up.
      const lim = await inspireBoardPwLimit(db, request, ipKey, fail);
      if (lim.res) return lim.res;
      const pw = await checkBoardPassword(env, d.password);
      if (pw !== 'bad') await inspireRateGiveBack(db, lim.counted, pw === 'ok' ? ipKey : null);
      if (pw === 'missing') return fail(400, 'password_required', 'Giriş şifresini yaz.');
      if (pw !== 'ok') return fail(401, 'bad_password', 'Şifre yanlış.', { attempts_left: lim.left });
      const name = cleanInspireName(d.name);
      if (inspireReservedName(name)) return fail(400, 'reserved_name', 'Bu isim kullanılamaz, lütfen başka bir isim seç');
      if (await inspireOverLimit(db, [['guest', ipKey]])) return limited();
      const token = await signInspireJWT({ g: 1, cid, name, pv: await boardPv(env) }, env.JWT_SECRET, INSPIRE_GUEST_TTL_S);
      return json({ token, user: { guest: true, name, display_name: name || 'Anonim', is_admin: false } }, 200, origin);
    }

    // "İsmi değiştir": a new guest token with the same cid and pv, without the password (a valid guest session only;
    // the session gate above already refused anything else). {name} -> same answer as POST /guest.
    if (cleanPath === '/api/inspire/guest/rename' && method === 'POST') {
      const actor = await inspireActor(request, env);
      if (!actor || !actor.guest) return fail(403, 'not_guest', 'Yalnızca misafir oturumunun ismi buradan değiştirilir');
      const d = await inspireBody(request);
      if (!d) return fail(400, 'bad_request', 'Geçersiz istek');
      const name = cleanInspireName(d.name);
      if (inspireReservedName(name)) return fail(400, 'reserved_name', 'Bu isim kullanılamaz, lütfen başka bir isim seç');
      if (await inspireOverLimit(db, [['guest', await inspireIpKey(request)]])) return limited();
      const token = await signInspireJWT({ g: 1, cid: actor.cid, name, pv: await boardPv(env) }, env.JWT_SECRET, INSPIRE_GUEST_TTL_S);
      return json({ token, user: { guest: true, name, display_name: name || 'Anonim', is_admin: false } }, 200, origin);
    }

    // Password login (owner/admin 'vkesgin38' and legacy registered users)
    if (cleanPath === '/api/inspire/login' && method === 'POST') {
      const ipKey = await inspireIpKey(request);
      if (await inspireRateCount(db, 'login', ipKey) >= INSPIRE_LIMITS.login[0]) return limited();
      const d = (await inspireBody(request)) || {};
      const username = typeof d.username === 'string' ? d.username.trim() : '';
      const password = typeof d.password === 'string' ? d.password : '';
      if (!username || !password) return fail(401, 'missing_credentials', 'Kullanıcı adı ve şifre gereklidir');
      const denied = async () => {
        await inspireOverLimit(db, [['login', ipKey]]);   // only failures count
        return fail(401, 'invalid_credentials', 'Hatalı kullanıcı adı veya şifre');
      };
      if (username === INSPIRE_GUEST_USERNAME) return denied();
      let row = null;
      if (username === INSPIRE_ADMIN_USERNAME) {
        // The owner account is gated by ADMIN_PASSWORD alone, never by the password column of its row.
        if (!env.ADMIN_PASSWORD || !(await inspireSafeEqual(password, env.ADMIN_PASSWORD))) return denied();
        row = await db.prepare('SELECT * FROM inspire_users WHERE username=?').bind(INSPIRE_ADMIN_USERNAME).first();
        if (!row) {
          await db.prepare("INSERT OR IGNORE INTO inspire_users (username, password, full_name, is_first_login) VALUES (?, ?, 'Veli Kesgin', 0)")
            .bind(INSPIRE_ADMIN_USERNAME, inspireUnusablePassword()).run();
          row = await db.prepare('SELECT * FROM inspire_users WHERE username=?').bind(INSPIRE_ADMIN_USERNAME).first();
          if (row) inspireAdminNameFolded = inspireFoldName(row.full_name);
        }
      } else {
        row = await db.prepare('SELECT * FROM inspire_users WHERE username=? AND password=?').bind(username, password).first();
      }
      if (!row) return denied();
      const token = await signInspireJWT({ userId: row.id, username: row.username }, env.JWT_SECRET || 'secret', INSPIRE_USER_TTL_S);
      const name = row.full_name || row.username;
      const isAdmin = row.username === INSPIRE_ADMIN_USERNAME;
      return json({ token, user: {
        id: row.id, username: row.username, full_name: row.full_name, is_first_login: isAdmin ? 0 : row.is_first_login,
        guest: false, name, display_name: name, is_admin: isAdmin,
      } }, 200, origin);
    }

    // Legacy: password change for registered users (never for the owner: see /login)
    if (cleanPath === '/api/inspire/change-password' && method === 'POST') {
      const actor = await inspireActor(request, env);
      if (!actor) return fail(401, 'unauthorized', 'Yetkisiz');
      if (actor.guest) return fail(403, 'forbidden', 'Misafir hesabının şifresi yok');
      if (actor.isAdmin) return fail(403, 'forbidden', 'Yönetici şifresi buradan değiştirilemez');
      const d = (await inspireBody(request)) || {};
      const newPassword = typeof d.newPassword === 'string' ? d.newPassword : '';
      if (newPassword.length < 4) return fail(400, 'invalid_password', 'Gecerli bir sifre giriniz');
      await db.prepare('UPDATE inspire_users SET password=?, is_first_login=0 WHERE id=?').bind(newPassword, actor.userId).run();
      return json({ ok: true }, 200, origin);
    }

    // Board: newest first, INSPIRE_PAGE_SIZE per request (?before=<id>; X-Fikir-Next = next cursor).
    // Private notes only reach their author (filtered in SQL).
    if (cleanPath === '/api/inspire/posts' && method === 'GET') {
      const actor = await inspireActor(request, env);   // the session gate already required one
      const [cid, uid] = inspireOwnerParams(actor);
      const q = new URL(request.url).searchParams;
      const limit = Math.min(INSPIRE_PAGE_SIZE, Math.max(1, parseInt(q.get('limit'), 10) || INSPIRE_PAGE_SIZE));
      const before = /^\d{1,15}$/.test(q.get('before') || '') ? Number(q.get('before')) : null;
      // current board: the copy records of the page's posts too (copy_view hints, inspireCopyView); one more statement
      const cfgV = inspireVideoConfig(env);
      const hints = sbClient && cfgV.copyView;
      const [postsRes, notesRes, recsRes] = await db.batch([
        db.prepare(`${INSPIRE_POST_SELECT} WHERE (?3 IS NULL OR p.id < ?3) ORDER BY p.id DESC LIMIT ?4`).bind(cid, uid, before, limit + 1),
        db.prepare(`${INSPIRE_NOTE_SELECT} WHERE ${INSPIRE_NOTE_VISIBLE} AND n.post_id IN
          (SELECT id FROM inspire_posts WHERE (?3 IS NULL OR id < ?3) ORDER BY id DESC LIMIT ?4) ORDER BY n.id ASC`).bind(cid, uid, before, limit),
        ...(hints ? [db.prepare(`SELECT post_id, kind, retry_at, extra FROM inspire_video_cache WHERE kind IN ('ig_copy', 'ad_copy', 'ig_embed')
          AND post_id IN (SELECT id FROM inspire_posts WHERE (?1 IS NULL OR id < ?1) ORDER BY id DESC LIMIT ?2)`).bind(before, limit)] : []),
      ]);
      const rows = postsRes.results || [];
      const more = rows.length > limit;
      if (more) rows.length = limit;
      const isAdmin = !!(actor && actor.isAdmin);
      const notesByPost = new Map();
      for (const n of notesRes.results || []) {
        if (!notesByPost.has(n.post_id)) notesByPost.set(n.post_id, []);
        notesByPost.get(n.post_id).push(inspireNoteOut(n, isAdmin));
      }
      let out = rows.map((r) => inspirePostOut(r, isAdmin, notesByPost.get(r.id)));
      if (sbClient) {   // copy_view: ask for this post's R2 copy when its card comes into view (POST /posts/:id/copy)
        const recs = new Map();
        for (const x of (recsRes && recsRes.results) || []) { if (!recs.has(x.post_id)) recs.set(x.post_id, []); recs.get(x.post_id).push(x); }
        const nowS = inspireNowS();
        for (let i = 0; i < out.length; i++) out[i].copy_view = hints && inspireCopyView(cfgV, inspireParsedOut(rows[i].url), out[i].media, recs.get(rows[i].id), nowS);
      }
      if (sbClient) {   // text posts: `storyboard` = summary of the latest version, or null
        if (!sbReady || !(await sbHook('summaries', () => sbAttachSummaries(env, db, out), null))) {
          for (const p of out) if (p.type === 'text') p.storyboard = null;
        }
      } else out = out.map((p) => inspireLegacyPost(p, actor));
      const res = json(out, 200, origin);
      if (more) {
        res.headers.set('X-Fikir-Next', String(rows[rows.length - 1].id));
        res.headers.set('Access-Control-Expose-Headers', 'X-Fikir-Next');
      }
      return res;
    }

    // Live duplicate/platform check for the add modal
    if (cleanPath === '/api/inspire/posts/check' && method === 'POST') {
      const actor = await inspireActor(request, env);
      if (!actor) return fail(401, 'unauthorized', 'Önce giriş yapın');
      const d = await inspireBody(request);
      if (!d) return fail(400, 'bad_request', 'Geçersiz istek');
      const raw = typeof d.url === 'string' ? d.url.trim() : '';
      if (!raw) return fail(400, 'url_required', 'Link gerekli');
      if (raw.length > MAX_URL_LENGTH) return fail(400, 'url_too_long', 'Link çok uzun');
      if (await inspireOverLimit(db, [['check', inspireActorKey(actor)], ['check_ip', await inspireIpKey(request)]])) return limited();
      const parsed = await inspireParseInput(raw, selfHost);
      if (!parsed || !inspireHostOk(parsed.canonical)) return fail(400, 'invalid_url', 'Geçerli bir http(s) linki girin');
      const dup = await inspireFindDuplicate(db, inspireDupKeys(parsed));
      if (dup) inspireRekeyShort(db, ctx, parsed);
      return json({ duplicate: !!dup, ...(dup ? { existing: inspireDupOut(dup) } : {}), platform: parsed.platform, canonical: parsed.canonical }, 200, origin);
    }

    // Create a link idea {url, description?} or a text idea {type:'text', text}
    if (cleanPath === '/api/inspire/posts' && method === 'POST') {
      const actor = await inspireActor(request, env);
      if (!actor) return fail(401, 'unauthorized', 'Önce giriş yapın');
      const d = await inspireBody(request);
      if (!d) return fail(400, 'bad_request', 'Geçersiz istek');
      const author = await inspireAuthorName(db, actor);
      if (author === null) return fail(401, 'unauthorized', 'Oturum geçersiz, tekrar giriş yapın');
      const [cid, uid] = inspireOwnerParams(actor);
      const ipKey = await inspireIpKey(request);
      if (await inspireOverLimit(db, [['post', inspireActorKey(actor)], ['post_ip', ipKey]])) return limited();
      let type, storedUrl, description, urlKey = null, shortKey = null, metaJson = null, parsed = null, metaLater = false;
      let mediaJson = null, mediaError = null, brPending = false;
      if (d.type === 'text') {
        const text = cleanInspireText(d.text);
        if (!text) return fail(400, 'empty_text', 'Fikir metni boş olamaz');
        if (text.length > INSPIRE_MAX_TEXT) return fail(400, 'text_too_long', `Fikir metni en fazla ${INSPIRE_MAX_TEXT} karakter olabilir`);
        type = 'text'; storedUrl = ''; description = text;
        // An optional `storyboard` object starts an AI storyboard after the insert (see below).
      } else {
        const raw = typeof d.url === 'string' ? d.url.trim() : '';
        if (!raw) return fail(400, 'url_required', 'Link gerekli');
        if (raw.length > MAX_URL_LENGTH) return fail(400, 'url_too_long', 'Link çok uzun');
        description = cleanInspireText(d.description);
        if (description.length > INSPIRE_MAX_DESC) return fail(400, 'description_too_long', `Açıklama en fazla ${INSPIRE_MAX_DESC} karakter olabilir`);
        parsed = await inspireParseInput(raw, selfHost);
        if (!parsed || !inspireHostOk(parsed.canonical)) return fail(400, 'invalid_url', 'Geçerli bir http(s) linki girin');
        const keys = inspireDupKeys(parsed);
        const dup = await inspireFindDuplicate(db, keys);
        if (dup) {
          inspireRekeyShort(db, ctx, parsed);
          return fail(409, 'duplicate', 'Bu link zaten eklenmiş', { existing: inspireDupOut(dup) });
        }
        type = parsed.platform; storedUrl = parsed.canonical; urlKey = keys[0]; shortKey = keys[1];
        if (inspireNeedsCard(parsed)) {
          // Optional manual media (add modal / bookmarklet): validated + probed like PUT /media. A rejected one is
          // reported as media_error and never fails the post. Ignored for embeds and direct image/video posts.
          let clientImage = null;
          if (inspireCardish(type) && d.media != null) {
            const r = await inspireCheckMediaInput(d.media, selfHost, d.via === 'bookmarklet' ? 'bookmarklet' : 'manual');
            if (r.media) {
              mediaJson = JSON.stringify(r.media);
              clientImage = r.media.kind === 'image' ? r.media.url : r.media.poster || null;
            } else mediaError = { error: r.error, message: r.message };
          }
          // L1 synchronously (the add modal's /preview result is reused); Browser Run never runs on the response path.
          let l1 = inspireCacheGet(inspirePreviewCache, parsed.canonical);
          if (!l1) {
            l1 = await inspireL1(parsed, selfHost);
            inspireCacheSet(inspirePreviewCache, parsed.canonical, l1, INSPIRE_PREVIEW_TTL_MS);
          }
          const meta = l1.meta;
          brPending = !(meta && meta.media) && l1.outcome === 'blocked' && await inspireBrPossible(env, db, parsed.canonical);
          const pend = brPending ? { pending: 'br', at: inspireNowS(), retry_s: 20 } : null;
          const clientTitle = inspireMetaText(typeof d.title === 'string' ? d.title.slice(0, 1000) : null, 200);
          if (meta) metaJson = JSON.stringify(pend ? { ...meta, ...pend } : meta);
          else if (clientTitle || clientImage) {
            metaJson = JSON.stringify({ v: META_V, via: 'client', title: clientTitle, image: clientImage, provider: inspireProviderOf(parsed.canonical), ...(pend || {}) });
          } else metaJson = pend ? inspireMetaFailure({ retry_s: 20, pending: 'br' }) : inspireMetaFailure();
        } else if (parsed.platform !== 'image' && parsed.platform !== 'video') {
          metaLater = true;   // embeddable: metadata is only a fallback, fetch it after responding
        }
      }
      // Conditional insert closes the race between two simultaneous adds of the same link (either key form).
      const ins = await db.prepare(
        `INSERT INTO inspire_posts (user_id, type, url, description, author_name, client_id, url_key, meta, media)
         SELECT ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?10
         WHERE ?7 IS NULL OR NOT EXISTS (SELECT 1 FROM inspire_posts WHERE url_key IN (?7, ?9))`
      ).bind(actor.guest ? inspireGuestId : actor.userId, type, storedUrl, description, author, cid, urlKey, metaJson, shortKey, mediaJson).run();
      if (!ins.meta || !ins.meta.changes) {
        const dup = await inspireFindDuplicate(db, [urlKey, shortKey]);
        return fail(409, 'duplicate', 'Bu link zaten eklenmiş', { existing: dup ? inspireDupOut(dup) : null });
      }
      const id = ins.meta.last_row_id;
      if (metaLater && ctx && typeof ctx.waitUntil === 'function') {
        ctx.waitUntil(inspireL1(parsed, selfHost)
          .then((r) => inspireWriteMeta(db, id, r.meta || { failed: 1, at: inspireNowS(), v: META_V })).catch(() => {}));
      }
      if (brPending && ctx && typeof ctx.waitUntil === 'function') {
        ctx.waitUntil(inspireBrAndStore(env, db, id, parsed.canonical, selfHost,
          { mode: 'create', author: actor.isAdmin ? null : inspireActorKey(actor), ipKey: actor.isAdmin ? null : ipKey }));
      }
      const row = await db.prepare(`${INSPIRE_POST_SELECT} WHERE p.id = ?3`).bind(cid, uid, id).first();
      // Text ideas (current board only) always carry a `storyboard` key; starting one never fails the post itself.
      let sbExtra = type === 'text' && sbClient ? { storyboard: null } : {};
      if (type === 'text' && sbClient && d.storyboard && typeof d.storyboard === 'object' && !Array.isArray(d.storyboard)) {
        try {
          if (!sbReady) throw new Error('storyboard schema unavailable');
          sbExtra = await sbStartForNewPost(env, ctx, sbDeps, request, actor, id, d.storyboard);
        }
        catch (e) {
          console.error('sb start (new post)', id, e && e.stack || e);
          sbExtra = { storyboard: null, storyboard_error: { error: 'sb_unavailable', message: 'Storyboard başlatılamadı. Karttaki düğmeyle tekrar dene.' } };
        }
      }
      const created = inspirePostOut(row, actor.isAdmin, []);
      if (sbClient) created.copy_view = inspireCopyView(inspireVideoConfig(env), inspireParsedOut(row.url), created.media, [], inspireNowS());
      return json({ ...created, ...sbExtra, ...(mediaError ? { media_error: mediaError } : {}) }, 201, origin);
    }

    // Preview metadata for an existing post: returns a stored good v2 meta as is; otherwise (nothing yet, v1 row, failure
    // past its retry time, Browser Run due) fetches once more. ?force=1 (owner/admin) refetches regardless of the
    // negative cache and may replace a good meta, but never bypasses the Browser Run quotas.
    // -> {meta: MetaV2|null, media: Media|null, pending?: true, retry_after?: s}
    if ((m = cleanPath.match(/^\/api\/inspire\/posts\/(\d{1,15})\/meta$/)) && method === 'POST') {
      const actor = await inspireActor(request, env);
      if (!actor) return fail(401, 'unauthorized', 'Önce giriş yapın');
      const id = Number(m[1]);
      const force = new URL(request.url).searchParams.get('force') === '1';
      const [cid, uid] = inspireOwnerParams(actor);
      const row = await db.prepare(`${INSPIRE_POST_SELECT} WHERE p.id = ?3`).bind(cid, uid, id).first();
      if (!row) return fail(404, 'not_found', 'Fikir bulunamadı');
      const nowS = inspireNowS();
      const answer = (r, extra) => json({ meta: inspireMetaOut(r.meta), media: inspireMediaOut(r.media), ...(extra || {}) }, 200, origin);
      const pendingExtra = (mm) => ({ pending: true, retry_after: Math.max(1, Number(mm.at || 0) + Number(mm.retry_s || 0) - nowS) });
      const stored = inspireMetaParse(row.meta);
      if (force) {
        if (!(row.is_mine || actor.isAdmin)) return fail(403, 'forbidden', 'Bu fikrin önizlemesini değiştirme yetkin yok');
        if (await inspireOverLimit(db, [['media', inspireActorKey(actor)], ['media_ip', await inspireIpKey(request)]])) return limited();
      } else {
        if (stored && !inspireMetaFailed(stored) && !inspireMetaPending(stored) && !inspireMetaStale(stored, row.type)) return answer(row);
        if (inspireMetaFresh(stored)) return answer(row);
        if (inspireMetaPending(stored) && Number(stored.at || 0) + Number(stored.retry_s || 0) > nowS) return answer(row, pendingExtra(stored));
      }
      let parsed = row.url ? parseLink(row.url) : null;
      if (!parsed || parsed.platform === 'image' || parsed.platform === 'video') return answer(row);
      if (!force) {
        if (inspireCacheGet(inspireMetaAttempts, id) !== undefined) return answer(row, inspireMetaPending(stored) ? { pending: true, retry_after: 15 } : null);
        if (await inspireOverLimit(db, [['fetch_ip', await inspireIpKey(request)]])) return limited();
      }
      inspireCacheSet(inspireMetaAttempts, id, true, 10 * 60e3);
      if (parsed.needsResolve) {
        // Row saved as an unresolved short link (pin.it, vm.tiktok.com, ...): store the real link and key once.
        const resolved = await inspireParseInput(row.url, selfHost);
        if (resolved && !resolved.needsResolve && inspireHostOk(resolved.canonical)) {
          await db.prepare('UPDATE inspire_posts SET url=?, url_key=? WHERE id=?').bind(resolved.canonical, resolved.key, id).run();
          parsed = resolved;
        }
      }
      // Browser Run quotas: the requesting IP always (admin exempt); the per-user caps only when the author asks (a viewer's
      // own posts never block someone else's preview, and a viewer never spends the author's allowance)
      const brWho = { author: row.is_mine && !actor.isAdmin ? inspireActorKey(actor) : null, ipKey: actor.isAdmin ? null : await inspireIpKey(request) };
      if (!force && inspireMetaPending(stored)) {
        // L1 already found the page blocked: only the Browser Run attempt is due (inline when admitted)
        await inspireBrAndStore(env, db, id, parsed.canonical, selfHost, { mode: 'refresh', ...brWho, wasPending: true });
      } else {
        await inspireRefresh(env, db, id, parsed, selfHost, { ...brWho, force });
      }
      const after = await db.prepare('SELECT meta, media FROM inspire_posts WHERE id=?').bind(id).first();
      if (!after) return fail(404, 'not_found', 'Fikir bulunamadı');
      const am = inspireMetaParse(after.meta);
      if (inspireMetaPending(am)) {
        inspireMetaAttempts.delete(id);   // the client polls again after retry_after
        return answer(after, pendingExtra(am));
      }
      return answer(after);
    }

    // Add-modal live preview: L1 only (adapters, plain fetch, oEmbed, probe), never Browser Run. Results are cached per
    // canonical URL for 10 minutes and reused by POST /posts.
    if (cleanPath === '/api/inspire/preview' && method === 'POST') {
      const actor = await inspireActor(request, env);
      if (!actor) return fail(401, 'unauthorized', 'Önce giriş yapın');
      const d = await inspireBody(request);
      if (!d) return fail(400, 'bad_request', 'Geçersiz istek');
      const raw = typeof d.url === 'string' ? d.url.trim() : '';
      if (!raw || raw.length > MAX_URL_LENGTH) return fail(400, 'invalid_url', 'Geçerli bir http(s) linki girin');
      if (await inspireOverLimit(db, [['preview', inspireActorKey(actor)], ['preview_ip', await inspireIpKey(request)]])) return limited();
      const parsed = await inspireParseInput(raw, selfHost);
      if (!parsed || !inspireHostOk(parsed.canonical)) return fail(400, 'invalid_url', 'Geçerli bir http(s) linki girin');
      const kind = parsed.platform === 'image' ? 'image' : parsed.platform === 'video' ? 'video' : inspireNeedsCard(parsed) ? 'card' : 'embed';
      const out = { platform: parsed.platform, canonical: parsed.canonical, kind, outcome: 'skipped', meta: null, br_possible: false };
      if (kind !== 'card') return json(out, 200, origin);
      let l1 = inspireCacheGet(inspirePreviewCache, parsed.canonical);
      if (!l1) {
        l1 = await inspireL1(parsed, selfHost);
        inspireCacheSet(inspirePreviewCache, parsed.canonical, l1, INSPIRE_PREVIEW_TTL_MS);
      }
      const meta = l1.meta ? inspireMetaOut(JSON.stringify(l1.meta)) : null;
      out.meta = meta;
      if (meta && meta.media) out.outcome = 'media';
      else if (l1.outcome === 'blocked') {
        out.outcome = 'blocked';
        out.br_possible = await inspireBrPossible(env, db, parsed.canonical) && await inspireBrBudgetLeft(env, db);
      } else out.outcome = meta ? 'card' : 'none';
      return json(out, 200, origin);
    }

    // Manual preview media for a link post (owner or inspire admin): PUT = attach/replace a direct media URL,
    // DELETE = remove it (uploaded objects are deleted after the D1 update).
    if ((m = cleanPath.match(/^\/api\/inspire\/posts\/(\d{1,15})\/media$/)) && (method === 'PUT' || method === 'DELETE')) {
      const actor = await inspireActor(request, env);
      if (!actor) return fail(401, 'unauthorized', 'Önce giriş yapın');
      const id = Number(m[1]);
      const [cid, uid] = inspireOwnerParams(actor);
      const row = await db.prepare(`${INSPIRE_POST_SELECT} WHERE p.id = ?3`).bind(cid, uid, id).first();
      if (!row) return fail(404, 'not_found', 'Fikir bulunamadı');
      if (!(row.is_mine || actor.isAdmin)) return fail(403, 'forbidden', 'Bu fikrin önizlemesini değiştirme yetkin yok');
      if (row.type === 'text') return fail(400, 'not_link_post', 'Metin fikirlere önizleme eklenemez');
      if (!inspireCardish(row.type)) return fail(409, 'has_player', 'Bu link zaten kendi oynatıcısıyla gösteriliyor');
      if (await inspireOverLimit(db, [['media', inspireActorKey(actor)], ['media_ip', await inspireIpKey(request)]])) return limited();
      let media = null;
      if (method === 'PUT') {
        const d = await inspireBody(request);
        if (!d) return fail(400, 'bad_request', 'Geçersiz istek');
        const r = await inspireCheckMediaInput(d, selfHost, 'manual');
        if (!r.media) return fail(r.status, r.error, r.message);
        media = r.media;
      }
      const keep = inspireMediaKeys(media);
      await db.batch([
        db.prepare('UPDATE inspire_posts SET media=?2 WHERE id=?1').bind(id, media ? JSON.stringify(media) : null),
        db.prepare(`UPDATE inspire_media SET state='orphan' WHERE post_id=?1 AND state='live' AND key NOT IN (SELECT value FROM json_each(?2))`)
          .bind(id, JSON.stringify(keep)),
      ]);
      if (ctx && typeof ctx.waitUntil === 'function') ctx.waitUntil(inspireDeleteOrphans(env, db, id).catch((e) => console.error('inspire media cleanup', e && e.message)));
      const after = await db.prepare(`${INSPIRE_POST_SELECT} WHERE p.id = ?3`).bind(cid, uid, id).first();
      return json({ post: inspirePostOut(after, actor.isAdmin, []) }, 200, origin);
    }

    // Download the post's own video / image as a file (opened as a link without the session header: the ticket ?k= from
    // download-info, checked by the session gate; rate-limited per IP + per day). ?part=video|image|auto (default auto).
    // Failure: a small Turkish HTML page (JSON with Accept: application/json or ?format=json) that links the source.
    if ((m = cleanPath.match(/^\/api\/inspire\/posts\/(\d{1,15})\/download$/)) && method === 'GET') {
      return await inspireDownload(request, env, ctx, db, Number(m[1]), { selfHost, origin, auth: dlAuth });
    }
    // What a download would give, without fetching anything (cached resolutions only):
    // {id, platform, source, enabled, video, image, from, adapter, reason, message, unsupported, copied, embed, url}
    // copied: the post plays from our R2 copy (any platform; from 'copy')
    // url: the download link to open, with this session's 15-minute ticket (?k=, worker/fikir-gate.js dlTicket; the
    // admin's also skips the site-wide daily download budget), so the response is never cached.
    // unsupported: true = YouTube / Vimeo (video false, reason not_supported / drm, message = why): the board shows the
    // message and offers the thumbnail (part=image) as a separate action instead of downloading it in the video's place.
    if ((m = cleanPath.match(/^\/api\/inspire\/posts\/(\d{1,15})\/download-info$/)) && method === 'GET') {
      if (await inspireOverLimit(db, [['dl_info_ip', await inspireIpKey(request)]])) return limited();
      const id = Number(m[1]);
      const row = await db.prepare('SELECT id, type, url, media, meta FROM inspire_posts WHERE id=?').bind(id).first();
      if (!row) return fail(404, 'not_found', 'Fikir bulunamadı');
      const cfgV = inspireVideoConfig(env);
      const actor = await inspireActor(request, env);   // the session gate already required one
      const ticket = await dlTicket(env, id, actor && actor.isAdmin ? 'a' : 'g');
      const parsed = row.url ? parseLink(row.url) : null;
      const media = inspireMediaOut(row.media), meta = inspireMetaOut(row.meta);
      const hint = dlHint({ type: row.type, parsed, media, meta });
      let video = hint ? hint.video : false, image = hint ? hint.image : false, reason = hint && hint.reason ? hint.reason : null;
      let from = media ? (COPY_SOURCES.has(media.source) ? 'copy' : media.source === 'upload' ? 'upload' : 'manual') : null;
      // a video from somewhere other than the platform adapter (stored media, link preview, direct file)
      const otherVideo = !!((media && media.kind === 'video') || (meta && meta.media && meta.media.kind === 'video') || (parsed && parsed.platform === 'video'));
      const ig = igRef(parsed);
      const ad = !ig && parsed ? dlAdapterFor(parsed) : null;
      let embed = null;
      if (ig) {
        const [igRow, emRow] = await Promise.all([vcGet(db, id, 'ig'), vcGet(db, id, 'ig_embed')]);
        if (igRow && !igRow.error && igRow.resolved_at) { if (!(media && media.kind === 'video')) video = !!igRow.url; image = true; }
        const st = emRow ? vcExtra(emRow).state : null;
        embed = ['blocked', 'ok', 'photo'].includes(st) ? st : null;
        if (embed === 'photo' && video === null) video = false;
        if (!from) from = 'instagram';
      } else if (ad && ad.support !== false) {
        const stable = (r) => ['no_video', 'not_found', 'login_required', 'drm', 'not_supported', 'bad_input', 'disabled'].includes(r);
        if (!cfgV.adapters.has(ad.name)) reason = 'disabled';
        else {
          const adRow = await vcGet(db, id, 'ad');
          const x = adRow ? vcExtra(adRow) : {};
          if (adRow && x.ad === ad.name && !adRow.error && adRow.resolved_at) {
            if (!x.has_video) reason = 'no_video';
            else if (!(media && media.kind === 'video')) video = true;
            if (adRow.poster) image = true;
          } else if (adRow && x.ad === ad.name && adRow.error && stable(adRow.error)) reason = adRow.error;
        }
        if (reason && stable(reason) && !otherVideo) video = false;
        if (!from && video !== false) from = 'adapter';
      }
      if (!from) {
        from = meta && meta.media ? 'link' : parsed && (parsed.platform === 'video' || parsed.platform === 'image') ? 'direct'
          : ad && image ? 'adapter' : meta && meta.image ? 'link' : null;
      }
      // YouTube / Vimeo without a video from elsewhere: never downloadable here (the download refuses auto / video with 422)
      const unsupported = !otherVideo ? inspireDlUnsupported(parsed) : null;
      if (unsupported) { video = false; reason = unsupported.reason; }
      if (video === true) reason = null;   // another source gives the video
      const res = json({
        id, platform: parsed ? parsed.platform : row.type, source: parsed && inspireHostOk(parsed.canonical) ? parsed.canonical : null,
        enabled: cfgV.dl, video, image, from, adapter: ad ? ad.name : null, reason: reason || null,
        message: reason ? inspireDlReasonText(reason, unsupported ? unsupported.name : null) : null,
        unsupported: !!unsupported,
        copied: !!(media && COPY_SOURCES.has(media.source)), embed,
        url: `/api/inspire/posts/${id}/download` + (ticket ? '?k=' + ticket : ''),
      }, 200, origin);
      res.headers.set('Cache-Control', 'private, no-store');
      res.headers.set('Vary', 'Authorization');
      return res;
    }

    // R2 copy of a post's video (Instagram, X, TikTok, Facebook, Pinterest, Reddit; see inspireCopy).
    // POST /copy: a card in view asks for its copy (any board session; the board asks only for posts whose copy_view was
    // true in GET /posts, once per page load). Idempotent; one copy of a post at a time (202 while another request copies
    // it). Limits: requests per session / IP per hour (copyview, copyview_ip), copies per session / IP / whole site per UTC
    // day (FIKIR_COPY_VIEW_*; the admin is exempt), plus every copy's site-wide caps. A copy that does not happen is
    // recorded like the cron's (inspireCopyRecord), so a post that cannot be copied stops being asked for.
    // -> 201 {state: 'copied', post} | 200 {state: 'exists', post} | 202 {state: 'copying', retry_s}
    //  | 200 {state: 'later', reason, retry_s} (try again after retry_s at the earliest; nothing changed. reason quota /
    //    storage_full: every copy; busy: every post of the platform; anything else: this post)
    //  | 200 {state: 'never', reason} (no video, removed, manual media, platform not copied, ...: the card keeps its embed)
    // The copy runs under ctx.waitUntil (inspireCopyKept): a viewer who leaves mid-copy does not cancel it.
    // DELETE /copy (and DELETE /ig-copy, its old name): the post owner or the admin removes the copy of any platform: the
    // card shows the platform's embed / link card again and neither the cron nor cards in view copy it again (only the post
    // owner or the admin can, POST /ig-copy for Instagram).
    if ((m = cleanPath.match(/^\/api\/inspire\/posts\/(\d{1,15})\/(copy|ig-copy)$/)) && (method === 'DELETE' || (method === 'POST' && m[2] === 'copy'))) {
      const actor = await inspireActor(request, env);
      if (!actor) return fail(401, 'unauthorized', 'Önce giriş yapın');
      const id = Number(m[1]);
      const [cid, uid] = inspireOwnerParams(actor);
      const ipKey = await inspireIpKey(request);
      const postOut = async () => {
        const after = await db.prepare(`${INSPIRE_POST_SELECT} WHERE p.id = ?3`).bind(cid, uid, id).first();
        return after ? inspirePostOut(after, actor.isAdmin, []) : null;
      };
      if (method === 'DELETE') {
        if (await inspireOverLimit(db, [['igcopy', inspireActorKey(actor)], ['igcopy_ip', ipKey]])) return limited();
        const row = await db.prepare(`${INSPIRE_POST_SELECT} WHERE p.id = ?3`).bind(cid, uid, id).first();
        if (!row) return fail(404, 'not_found', 'Fikir bulunamadı');
        const cur = inspireMediaOut(row.media);
        const isCopy = !!(cur && COPY_SOURCES.has(cur.source));
        const target = copyTargetOf(row.url ? parseLink(row.url) : null);
        const platform = isCopy ? cur.source : target ? target.platform : null;
        if (!platform) return fail(400, 'not_copyable', 'Bu fikrin videosu kopyalanmıyor');
        if (!(row.is_mine || actor.isAdmin)) return fail(403, 'forbidden', 'Bu kopyayı kaldırma yetkin yok');
        if (isCopy) {
          await db.batch([
            db.prepare("UPDATE inspire_posts SET media=NULL WHERE id=?1 AND json_valid(media) AND json_extract(media, '$.source') = ?2").bind(id, platform),
            db.prepare("UPDATE inspire_media SET state='orphan' WHERE post_id=?1 AND state='live' AND NOT EXISTS (SELECT 1 FROM inspire_posts WHERE id=?1 AND media IS NOT NULL)").bind(id),
          ]);
          if (ctx && typeof ctx.waitUntil === 'function') ctx.waitUntil(inspireDeleteOrphans(env, db, id).catch((e) => console.error('inspire media cleanup', e && e.message)));
        }
        try { await vcPut(db, id, copyKind(platform), { extra: { removed: 1 } }); } catch (e) {}
        const post = await postOut();
        if (post && sbClient) post.copy_view = false;
        return json({ post, removed: isCopy }, 200, origin);
      }
      if (await inspireOverLimit(db, [['copyview', inspireActorKey(actor)], ['copyview_ip', ipKey]])) return limited();
      const row = await db.prepare('SELECT id, url, media FROM inspire_posts WHERE id=?').bind(id).first();
      if (!row) return fail(404, 'not_found', 'Fikir bulunamadı');
      const answer = (state, extra, status = 200) => json({ state, ...extra }, status, origin);
      const never = (reason) => answer('never', { reason: String(reason || 'not_copyable').slice(0, 40) });
      const later = (reason, s) => answer('later', { reason: String(reason || 'later').slice(0, 40), retry_s: Math.max(1, Math.round(Number(s) || 600)) });
      const withPost = async (state, status) => {
        const post = await postOut();
        if (!post) return fail(404, 'not_found', 'Fikir bulunamadı');
        if (sbClient) post.copy_view = false;
        return answer(state, { post }, status);
      };
      const cfgV = inspireVideoConfig(env);
      const media = inspireMediaOut(row.media);
      if (media) return COPY_SOURCES.has(media.source) ? withPost('exists', 200) : never('manual');
      if (!cfgV.copyView) return never('disabled');
      const parsed = row.url ? parseLink(row.url) : null;
      const target = copyTargetOf(parsed, (pf) => inspireAutoCopyOn(cfgV, pf));
      if (!target) return never(copyTargetOf(parsed) ? 'disabled' : 'not_video');
      const kind = copyKind(target.platform);
      const { results: recs } = await db.prepare("SELECT kind, error, retry_at, extra FROM inspire_video_cache WHERE post_id=?1 AND kind IN (?2, 'ig_embed')").bind(id, kind).all();
      const rec = (recs || []).find((r) => r.kind === kind) || null;
      const embed = target.platform === 'instagram' ? vcExtra((recs || []).find((r) => r.kind === 'ig_embed')).state || null : null;
      const nowS = inspireNowS();
      if (rec && vcExtra(rec).removed) return never('removed');
      if (embed === 'photo') return never('no_video');
      if (target.platform === 'instagram' && cfgV.igAuto === 'blocked' && embed !== 'blocked') return embed === 'ok' ? never('plays') : later('not_checked', 3600);
      if (rec && Number(rec.retry_at) > nowS) {
        const why = String(rec.error || vcExtra(rec).deferred || 'backoff');
        return /^(no_video|too_large|not_post|gone|not_found|login_required|drm|not_supported|bad_input)$/.test(why) ? never(why) : later(why, Number(rec.retry_at) - nowS);
      }
      // Browser Run is charged to the site and the post only (ipKey null, like the cron): a copy nobody asked for spends
      // none of the viewer's own per-IP allowance (their link previews need it), and one IP's spent allowance cannot defer
      // the post for everyone. The copy record is written inside the kept promise (inspireCopyKept).
      const r = await inspireCopyKept(ctx, inspireCopy(env, db, id, { ...target, parsed }, { selfHost, ipKey: null, allowBR: true, slotWaitMs: 0,
        by: actor.isAdmin ? 'admin' : { view: true, subject: inspireActorKey(actor), ip: ipKey } }).then(async (res) => {
        console.log('inspire copy view', target.platform, id, res.status, res.error || res.scope || '');
        try { await inspireCopyRecord(db, id, kind, res); } catch (e) {}
        return res;
      }));
      if (r.status === 'copied') return withPost('copied', 201);
      if (r.status === 'exists') return withPost('exists', 200);
      if (r.status === 'busy') return answer('copying', { retry_s: 20 }, 202);
      if (r.status === 'not_found') return fail(404, 'not_found', 'Fikir bulunamadı');
      if (['manual', 'disabled', 'no_video', 'too_large'].includes(r.status)) return never(r.status);
      if (r.status === 'quota') return later('quota', inspireSecondsToMidnight());
      if (r.status === 'storage_full') return later('storage_full', 86400);
      // busy: the platform refuses every post for retry_s (the board holds or skips that platform); deferred: this post only
      if (r.status === 'ig_busy' || r.status === 'ad_busy') return later(r.site ? 'busy' : 'deferred', r.retry_s || 600);
      if (r.status === 'resolve_failed' && r.retry === 'gone') return never(r.error || 'gone');
      return later(r.error || r.status, 600);
    }

    // Copy an Instagram post's video + poster into R2 on request ("Oynamıyor mu?"; any board session; idempotent; guests
    // within their daily upload quotas, see inspireCopy). Guests and users copy only a reel whose embed was found blocked
    // (stored by ig-blocked / the cron); the admin copies any post, the post owner too while FIKIR_IG_AUTO=all (the cron
    // copies every Instagram video then). A removed copy (DELETE /copy) can be made again only by the post owner or the admin.
    if ((m = cleanPath.match(/^\/api\/inspire\/posts\/(\d{1,15})\/ig-copy$/)) && method === 'POST') {
      const actor = await inspireActor(request, env);
      if (!actor) return fail(401, 'unauthorized', 'Önce giriş yapın');
      const id = Number(m[1]);
      const [cid, uid] = inspireOwnerParams(actor);
      const row = await db.prepare(`${INSPIRE_POST_SELECT} WHERE p.id = ?3`).bind(cid, uid, id).first();
      if (!row) return fail(404, 'not_found', 'Fikir bulunamadı');
      const parsed = row.url ? parseLink(row.url) : null;
      const ref = igRef(parsed);
      if (!ref) return fail(400, 'not_instagram', 'Bu fikir bir Instagram gönderisi değil');
      const ipKey = await inspireIpKey(request);
      if (await inspireOverLimit(db, [['igcopy', inspireActorKey(actor)], ['igcopy_ip', ipKey]])) return limited();
      if (!(row.is_mine || actor.isAdmin) && !row.media && vcExtra(await vcGet(db, id, 'ig_copy')).removed) {
        return fail(403, 'copy_removed', 'Bu fikrin Instagram kopyası kaldırılmış; yalnızca fikrin sahibi ya da yönetici yeniden kopyalayabilir');
      }
      if (!row.media && !actor.isAdmin && !(row.is_mine && inspireVideoConfig(env).igAuto === 'all')) {
        const st = vcExtra(await vcGet(db, id, 'ig_embed')).state;   // a failed re-check keeps the last known state
        if (st !== 'blocked') {
          return fail(409, 'not_blocked', st === 'ok' ? 'Instagram bu videoyu burada oynatabiliyor; kopyalamaya gerek yok'
            : st === 'photo' ? 'Bu gönderi bir fotoğraf; kopyalanacak bir video yok'
            : 'Bu videonun burada oynayıp oynamadığı henüz kontrol edilmedi; önce “Oynamıyor mu?” ile kontrol et', { state: st || 'unknown' });
        }
      }
      const r = await inspireCopyKept(ctx, inspireCopy(env, db, id, { platform: 'instagram', ref, parsed }, { selfHost, ipKey: actor.isAdmin ? null : ipKey,
        by: actor.isAdmin ? 'admin' : { subject: inspireActorKey(actor), ip: ipKey } }));
      if (r.status === 'copied' || r.status === 'exists') {
        const after = await db.prepare(`${INSPIRE_POST_SELECT} WHERE p.id = ?3`).bind(cid, uid, id).first();
        if (!after) return fail(404, 'not_found', 'Fikir bulunamadı');
        const post = inspirePostOut(after, actor.isAdmin, []);
        if (sbClient) post.copy_view = false;
        return json({ post, copied: r.status === 'copied', already: r.status === 'exists' }, r.status === 'copied' ? 201 : 200, origin);
      }
      const e = inspireCopyErr(r.status, 'instagram');
      const errCode = r.status === 'manual' ? 'has_manual_media' : r.status === 'busy' ? 'in_progress' : r.status === 'quota' ? 'quota_exceeded' : r.status;
      return fail(e[0], errCode, e[1], r.status === 'quota' ? { reset_at: nextResetIso() } : r.status === 'ig_busy' ? { retry_s: r.retry_s }
        : r.error ? { reason: String(r.error).slice(0, 40) } : null);
    }

    // "This reel does not play here" report from the board (a board session, like the ig-copy it leads to): answers the
    // stored embed state (the cron re-checks every 30 days; a failed re-check keeps the last known state). The server
    // fetches the embed page only for a post never checked (failures back off), or, at most once a day, when the post's
    // owner or the admin reports a reel the last check found playable, so reports cannot spend the Instagram fetch budget
    // that downloads and copies share. A confirmed block is copied by the board (POST ig-copy) or the cron (FIKIR_IG_AUTO).
    // -> {state: 'blocked'|'ok'|'photo'|'unknown'|'copied', queued: bool}
    if ((m = cleanPath.match(/^\/api\/inspire\/posts\/(\d{1,15})\/ig-blocked$/)) && method === 'POST') {
      const actor = await inspireActor(request, env);
      if (!actor) return fail(401, 'unauthorized', 'Önce giriş yapın');
      if (await inspireOverLimit(db, [['igrep', inspireActorKey(actor)], ['igrep_ip', await inspireIpKey(request)]])) return limited();
      const id = Number(m[1]);
      const [cid, uid] = inspireOwnerParams(actor);
      const row = await db.prepare(`${INSPIRE_POST_SELECT} WHERE p.id = ?3`).bind(cid, uid, id).first();
      if (!row) return fail(404, 'not_found', 'Fikir bulunamadı');
      const ref = igRef(row.url ? parseLink(row.url) : null);
      if (!ref) return fail(400, 'not_instagram', 'Bu fikir bir Instagram gönderisi değil');
      const media = inspireMediaOut(row.media);
      if (media && media.source === 'instagram') return json({ state: 'copied', queued: false, media }, 200, origin);
      const prev = await vcGet(db, id, 'ig_embed');
      const last = vcExtra(prev).state;
      let state = ['blocked', 'ok', 'photo'].includes(last) ? last : null;
      const recheck = !state || (state === 'ok' && (row.is_mine || actor.isAdmin) && inspireNowS() - Number(prev.resolved_at || 0) > 86400);
      if (recheck && !vcBackingOff(prev)) {
        const r = await inspireIgEmbed(env, db, id, ref);
        if (r.state && r.state !== 'unknown') state = r.state;
      }
      try {
        await db.prepare(`UPDATE inspire_video_cache SET extra = json_set(CASE WHEN json_valid(extra) THEN extra ELSE '{}' END,
          '$.reports', COALESCE(json_extract(CASE WHEN json_valid(extra) THEN extra ELSE '{}' END, '$.reports'), 0) + 1, '$.reported_at', ?2)
          WHERE post_id=?1 AND kind='ig_embed'`).bind(id, inspireNowS()).run();
      } catch (e) {}
      const cfgV = inspireVideoConfig(env);
      return json({ state: state || 'unknown', queued: state === 'blocked' && cfgV.igAuto !== 'off' && cfgV.igCopy && !media }, 200, origin);
    }

    // Upload a preview file (raw body, streamed to R2; type from the magic bytes): ?part=video|image|poster[&w=&h=]
    if (isUpload) {
      return await inspireUpload(request, env, ctx, db, Number(cleanPath.split('/')[4]), { fail, limited, origin });   // await: errors reach the catch below
    }

    // Add a note to a post
    if ((m = cleanPath.match(/^\/api\/inspire\/posts\/(\d{1,15})\/notes$/)) && method === 'POST') {
      const actor = await inspireActor(request, env);
      if (!actor) return fail(401, 'unauthorized', 'Önce giriş yapın');
      const d = await inspireBody(request);
      if (!d) return fail(400, 'bad_request', 'Geçersiz istek');
      const content = cleanInspireText(d.content);
      if (!content) return fail(400, 'empty_note', 'Not boş olamaz');
      if (content.length > INSPIRE_MAX_NOTE) return fail(400, 'note_too_long', `Not en fazla ${INSPIRE_MAX_NOTE} karakter olabilir`);
      const isPublic = d.is_public === true || d.is_public === 1 || d.is_public === '1' || d.is_public === 'true' ? 1 : 0;
      const author = await inspireAuthorName(db, actor);
      if (author === null) return fail(401, 'unauthorized', 'Oturum geçersiz, tekrar giriş yapın');
      if (await inspireOverLimit(db, [['note', inspireActorKey(actor)], ['note_ip', await inspireIpKey(request)]])) return limited();
      const [cid, uid] = inspireOwnerParams(actor);
      const postId = Number(m[1]);
      const ins = await db.prepare(
        `INSERT INTO inspire_notes (post_id, user_id, content, is_public, author_name, client_id)
         SELECT ?1, ?2, ?3, ?4, ?5, ?6 WHERE EXISTS (SELECT 1 FROM inspire_posts WHERE id = ?1)`
      ).bind(postId, actor.guest ? inspireGuestId : actor.userId, content, isPublic, author, cid).run();
      if (!ins.meta || !ins.meta.changes) return fail(404, 'not_found', 'Fikir bulunamadı');
      const row = await db.prepare(`${INSPIRE_NOTE_SELECT} WHERE n.id = ?3`).bind(cid, uid, ins.meta.last_row_id).first();
      return json(inspireNoteOut(row, actor.isAdmin), 201, origin);
    }

    // Delete a post: its owner, the inspire admin, or a portfolio-admin JWT (as before)
    if ((m = cleanPath.match(/^\/api\/inspire\/posts\/(\d{1,15})$/)) && method === 'DELETE') {
      const actor = await inspireActor(request, env);
      const siteAdmin = actor ? null : await authMiddleware(request, env);
      if (!actor && !(siteAdmin && siteAdmin.role === 'admin')) return fail(401, 'unauthorized', 'Önce giriş yapın');
      const id = Number(m[1]);
      const [cid, uid] = inspireOwnerParams(actor);
      const row = await db.prepare(`${INSPIRE_POST_SELECT} WHERE p.id = ?3`).bind(cid, uid, id).first();
      if (!row) return fail(404, 'not_found', 'Fikir bulunamadı');
      if (!(siteAdmin || actor.isAdmin || row.is_mine)) return fail(403, 'forbidden', 'Bu fikri silme yetkin yok');
      // Its storyboards go in the same batch; Workflow instances + R2 objects are cleaned up after it succeeded.
      const sbDel = sbReady ? await sbHook('delete', () => sbDeleteForPost(env, db, id), null) : null;   // null: the cron sweeps orphans
      await db.batch([
        ...(sbDel ? sbDel.stmts : []),
        db.prepare('DELETE FROM inspire_notes WHERE post_id=?').bind(id),
        // uploaded previews (R2 below). An upload still streaming keeps its 'pending' row: its commit finds no post and
        // removes the object itself; the cron sweeps the row if that request died.
        db.prepare("UPDATE inspire_media SET state='orphan' WHERE post_id=? AND state='live'").bind(id),
        db.prepare('DELETE FROM inspire_posts WHERE id=?').bind(id),
      ]);
      if (sbDel && ctx && typeof ctx.waitUntil === 'function') ctx.waitUntil(sbDel.cleanup().catch((e) => console.error('sb cleanup', e && e.message)));
      if (ctx && typeof ctx.waitUntil === 'function') ctx.waitUntil(inspireDeleteOrphans(env, db, id).catch((e) => console.error('inspire media cleanup', e && e.message)));
      return json({ ok: true }, 200, origin);
    }

    // Edit / delete a note: its owner or the inspire admin
    if ((m = cleanPath.match(/^\/api\/inspire\/notes\/(\d{1,15})$/)) && (method === 'PUT' || method === 'DELETE')) {
      const actor = await inspireActor(request, env);
      if (!actor) return fail(401, 'unauthorized', 'Önce giriş yapın');
      const id = Number(m[1]);
      const [cid, uid] = inspireOwnerParams(actor);
      const row = await db.prepare(`${INSPIRE_NOTE_SELECT} WHERE n.id = ?3`).bind(cid, uid, id).first();
      if (!row) return fail(404, 'not_found', 'Not bulunamadı');
      if (!(actor.isAdmin || row.is_mine)) return fail(403, 'forbidden', 'Bu notu değiştirme yetkin yok');
      if (method === 'DELETE') {
        await db.prepare('DELETE FROM inspire_notes WHERE id=?').bind(id).run();
        return json({ ok: true }, 200, origin);
      }
      const d = await inspireBody(request);
      if (!d) return fail(400, 'bad_request', 'Geçersiz istek');
      const content = cleanInspireText(d.content);
      if (!content) return fail(400, 'empty_note', 'Not boş olamaz');
      if (content.length > INSPIRE_MAX_NOTE) return fail(400, 'note_too_long', `Not en fazla ${INSPIRE_MAX_NOTE} karakter olabilir`);
      const isPublic = typeof d.is_public === 'boolean' ? (d.is_public ? 1 : 0) : null;   // optional
      await db.prepare('UPDATE inspire_notes SET content=?, is_public=COALESCE(?, is_public) WHERE id=?').bind(content, isPublic, id).run();
      const updated = await db.prepare(`${INSPIRE_NOTE_SELECT} WHERE n.id = ?3`).bind(cid, uid, id).first();
      return json(inspireNoteOut(updated, actor.isAdmin), 200, origin);
    }

    // AI storyboards (worker/storyboard/routes.js): /posts/:id/storyboards, /storyboards/:sbId[/…], /sb-admin/usage
    if (sbReady) {
      const sbRes = await handleStoryboard(request, env, ctx, cleanPath, method, sbDeps);
      if (sbRes) return sbRes;
    } else if (/^\/api\/inspire\/(?:storyboards\/|sb-admin\/|posts\/\d{1,15}\/storyboards$)/.test(cleanPath)) {
      return fail(503, 'sb_unavailable', 'Storyboard servisi şu an kullanılamıyor. Biraz sonra tekrar dene.');
    }

    return fail(404, 'not_found', 'Bulunamadı');
  } catch (e) {
    console.error('inspire error', cleanPath, e && e.stack || e);
    return fail(500, 'server_error', 'Sunucu hatası, lütfen tekrar deneyin');
  }
}

// UI JWT helpers
async function signUiJWT(payload, secret) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw', enc.encode(secret + '_ui'), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  const header = btoa(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body   = btoa(JSON.stringify({ ...payload, iat: Date.now() }));
  const sig    = await crypto.subtle.sign('HMAC', key, enc.encode(`${header}.${body}`));
  return `${header}.${body}.${btoa(String.fromCharCode(...new Uint8Array(sig)))}`;
}
async function verifyUiJWT(token, secret) {
  try {
    const [header, body, sig] = token.split('.');
    const enc = new TextEncoder();
    const key = await crypto.subtle.importKey(
      'raw', enc.encode(secret + '_ui'), { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']
    );
    const valid = await crypto.subtle.verify('HMAC', key,
      Uint8Array.from(atob(sig), c => c.charCodeAt(0)),
      enc.encode(`${header}.${body}`)
    );
    if (!valid) return null;
    return JSON.parse(atob(body));
  } catch { return null; }
}
async function uiAuth(request, env) {
  const authHeader = request.headers.get('Authorization') || '';
  if (!authHeader.toLowerCase().startsWith('bearer ')) return null;
  const token = authHeader.split(' ')[1];
  if (!token) return null;
  try {
    return await verifyUiJWT(token, env.JWT_SECRET || 'secret');
  } catch (e) {
    return null;
  }
}

export default {
  // Cron Triggers (wrangler.toml [triggers]): CRON_MAIN = stale storyboard jobs, orphan sweep, quota/ledger/rate pruning, upload
  // cleanup, due Browser Run retries of link previews; CRON_IG = R2 copies of video posts (Instagram, X, TikTok, Facebook,
  // Pinterest, Reddit) + Instagram embed checks. One budget per run.
  async scheduled(controller, env, ctx) {
    const task = controller && controller.cron === CRON_IG ? 'ig' : 'main';
    const budget = new Budget('cron ' + task, CRON_BUDGET);
    ctx.waitUntil(withBudget(budget, env, (menv) => (task === 'ig' ? cronIg(menv, budget) : cronMain(menv, budget)))
      .catch((e) => console.error('cron ' + task, e && e.stack || e))
      .finally(() => console.log(`cron ${task}: ${budget.describe()}`)));
  },
  async fetch(request, env, ctx) {
    const url    = new URL(request.url);
    const path   = url.pathname;
    const method = request.method;
    const origin = request.headers.get('Origin') || env.ALLOWED_ORIGIN;

    // CORS preflight
    if (method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
          // fikir.html marks itself with X-Fikir-Client (old pages get escaped text, see inspireLegacyPost)
          'Access-Control-Allow-Headers': path.startsWith('/api/inspire/') ? 'Content-Type,Authorization,X-Fikir-Client' : 'Content-Type,Authorization',
          'Access-Control-Max-Age': '86400',
        }
      });
    }

    // === AUTH ===
    if (path === '/api/auth/login' && method === 'POST') {
      const { password } = await request.json().catch(() => ({}));
      if (!env.ADMIN_PASSWORD || !password || password !== env.ADMIN_PASSWORD) {
        return json({ error: 'Geçersiz şifre' }, 401, origin);
      }
      const token = await signJWT({ role: 'admin' }, env.JWT_SECRET);
      return json({ token }, 200, origin);
    }

    // === PUBLIC: Proje listesi ===
    if (path === '/api/projects' && method === 'GET') {
      const featured = url.searchParams.get('featured');
      const category = url.searchParams.get('category');
      const params = [];
      let query;

      if (category) {
        // Belirli bir kategori isteniyorsa sadece onu döndür
        query = 'SELECT * FROM projects WHERE category=?';
        params.push(category);
        if (featured === '1') query += ' AND is_featured=1 ORDER BY featured_order ASC';
        else query += ' ORDER BY created_at DESC';
      } else {
        // Genel liste: uilib ve 3dcube özel kategorileri hariç tut
        query = "SELECT * FROM projects WHERE category NOT IN ('uilib','3dcube')";
        if (featured === '1') query += ' AND is_featured=1 ORDER BY featured_order ASC';
        else query += ' ORDER BY created_at DESC';
      }

      const { results } = await env.DB.prepare(query).bind(...params).all();
      return json(results, 200, origin);
    }

    // === PUBLIC: Tek proje ===
    if (path.match(/^\/api\/projects\/[^/]+$/) && method === 'GET') {
      const id = path.split('/').pop();
      const project = await env.DB.prepare('SELECT * FROM projects WHERE id=?').bind(id).first();
      if (!project) return json({ error: 'Bulunamadı' }, 404, origin);
      return json(project, 200, origin);
    }

    // === PUBLIC: Dosya serve ===
    // R2 objects, Range-capable (video seeking). fikir/ keys (Fikir Havuzu uploads) must match the server-generated
    // pattern and are served sandboxed (CSP sandbox, nosniff, inline) so an uploaded file can never run as a page.
    // Board files (fikir/* uploads + Instagram copies, sb/* storyboard frames) also need the files token ?t= that the
    // inspire API appends to their paths for a session (worker/fikir-gate.js; FIKIR_FILES_GATE="0" turns this off);
    // without a valid one -> 403, before R2 is touched. Every other key (portfolio, UI library) stays public as before.
    if (path.startsWith('/files/')) {
      try {
        const key = path.replace('/files/', '');
        const isFikir = key.startsWith('fikir/');
        if (isFikir && !FILES_KEY_RE.test(key)) return new Response('Not Found', { status: 404 });
        const gated = FILES_GATED_RE.test(key) && filesGateOn(env);
        const ttl = gated ? await filesTokenTtl(env, url.searchParams.get('t')) : 0;
        if (gated && !ttl) {
          return new Response('Bu dosyanın bağlantısının süresi doldu; Fikir Havuzu’nu yenile.', { status: 403, headers: {
            'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff',
            'Access-Control-Allow-Origin': '*', 'Cross-Origin-Resource-Policy': 'cross-origin',
          } });
        }
        const rangeHeader = request.headers.get('Range');
        const range = rangeHeader ? /^bytes=(\d*)-(\d*)$/.exec(rangeHeader.trim()) : null;
        const head = range ? await env.STORAGE.head(key) : null;
        if (range && !head) return new Response('Not Found', { status: 404 });
        const headers = (obj) => {
          const h = new Headers();
          obj.writeHttpMetadata(h);
          h.set('Cache-Control', 'public, max-age=31536000');
          // PUBLIC dosyalar — tüm originlere izin ver (CORS bloğunu önler)
          h.set('Access-Control-Allow-Origin', '*');
          h.set('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
          h.set('Accept-Ranges', 'bytes');
          h.set('X-Content-Type-Options', 'nosniff');
          if (obj.httpEtag) h.set('ETag', obj.httpEtag);
          if (isFikir) {
            h.set('Content-Security-Policy', "default-src 'none'; sandbox");
            h.set('Content-Disposition', 'inline');
            h.set('Cross-Origin-Resource-Policy', 'cross-origin');
            h.set('Cache-Control', 'public, max-age=31536000, immutable');
          }
          // a gated file is cached by the browser only (private) and never past its token
          if (gated) h.set('Cache-Control', `private, max-age=${Math.min(ttl, 86400)}, immutable`);
          return h;
        };
        if (range && head.size > 0 && (range[1] !== '' || range[2] !== '')) {
          const size = head.size;
          let start, end;
          if (range[1] === '') {   // bytes=-N: the last N bytes
            const n = Number(range[2]);
            if (!(n > 0)) return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${size}`, 'Access-Control-Allow-Origin': '*' } });
            start = Math.max(0, size - n); end = size - 1;
          } else {
            start = Number(range[1]);
            end = range[2] !== '' ? Math.min(Number(range[2]), size - 1) : size - 1;
          }
          if (!Number.isSafeInteger(start) || start >= size || end < start) {
            return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${size}`, 'Access-Control-Allow-Origin': '*' } });
          }
          const rangedObj = await env.STORAGE.get(key, range[1] === '' ? { range: { suffix: end - start + 1 } } : { range: { offset: start, length: end - start + 1 } });
          if (!rangedObj) return new Response('Not Found', { status: 404 });
          const rh = headers(rangedObj);
          rh.set('Content-Range', `bytes ${start}-${end}/${size}`);
          rh.set('Content-Length', String(end - start + 1));
          return new Response(rangedObj.body, { status: 206, headers: rh });
        }
        const obj = await env.STORAGE.get(key);
        if (!obj) return new Response('Not Found', { status: 404 });
        const bh = headers(obj);
        if (obj.size != null) bh.set('Content-Length', String(obj.size));
        return new Response(obj.body, { headers: bh });
      } catch (e) {
        console.error('files', e && e.message);
        return new Response('Server Error', { status: 500 });
      }
    }

    // === PUBLIC: Key-Value (Ayarlar) ===
    if (path === '/api/fitness' && method === 'GET') {
      const { results } = await env.DB.prepare('SELECT * FROM fitness_store').all();
      return json(results, 200, origin);
    }

    const cleanPath = path.replace(/\/$/, '');

    // === ADMIN: KPSS KULLANICI YÖNETİMİ ===
    if (cleanPath === '/api/admin/kpss-users' && method === 'GET') {
      const admin = await authMiddleware(request, env);
      if (!admin) return json({ error: 'Yetkisiz' }, 401, origin);
      const { results } = await env.DB.prepare('SELECT id, username, full_name, created_at FROM kpss_users ORDER BY id DESC').all();
      return json(results, 200, origin);
    }
    if (cleanPath === '/api/admin/kpss-users' && method === 'POST') {
      const admin = await authMiddleware(request, env);
      if (!admin) return json({ error: 'Yetkisiz' }, 401, origin);
      const d = await request.json();
      if (!d.username || !d.password) return json({ error: 'Kullanıcı adı ve şifre zorunlu' }, 400, origin);
      const todayDate = new Date().toISOString().split('T')[0];
      try {
        await env.DB.prepare('INSERT INTO kpss_users (username, password, full_name, exam_name, exam_date) VALUES (?, ?, ?, ?, ?)').bind(d.username, d.password, d.full_name || '', 'KPSS', todayDate).run();
          await env.DB.prepare(`
          CREATE TABLE IF NOT EXISTS inspire_notes (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            post_id INTEGER NOT NULL,
            user_id INTEGER NOT NULL,
            content TEXT NOT NULL,
            is_public INTEGER DEFAULT 0,
            created_at TEXT DEFAULT (datetime('now')),
            FOREIGN KEY(post_id) REFERENCES inspire_posts(id) ON DELETE CASCADE,
            FOREIGN KEY(user_id) REFERENCES inspire_users(id) ON DELETE CASCADE
          )
        `).run();
        return json({ ok: true }, 201, origin);
      } catch(e) {
        return json({ error: 'Kullanıcı zaten var veya DB hatası' }, 400, origin);
      }
    }
    if (cleanPath.match(/^\/api\/admin\/kpss-users\/\d+$/) && method === 'DELETE') {
      const admin = await authMiddleware(request, env);
      if (!admin) return json({ error: 'Yetkisiz' }, 401, origin);
      const id = cleanPath.split('/').pop();
      await env.DB.prepare('DELETE FROM kpss_users WHERE id=?').bind(id).run();
      return json({ ok: true }, 200, origin);
    }

// ─── KPSS ROUTES ───
if (path.startsWith('/api/kpss')) {

  // GİRİŞ YAP
  if (path === '/api/kpss/login' && method === 'POST') {
    const { username, password } = await request.json().catch(() => ({}));
    if (!username || !password) return json({ error: 'Kullanıcı adı ve şifre gereklidir' }, 401, origin);
    // Defense in depth (the owner branch below never reads the stored password); a failure is retried next time.
    await migrateKpssOwnerPassword(env).catch((e) => console.error('kpss owner migration', e && e.message));

    let user = null;
    if (username === KPSS_OWNER_USERNAME) {
      // Owner: current ADMIN_PASSWORD only (401 when it is not set); the password is never written into the row.
      if (!(await kpssOwnerPasswordOk(env, password))) return json({ error: 'Hatalı kullanıcı adı veya şifre' }, 401, origin);
      user = await env.DB.prepare('SELECT * FROM kpss_users WHERE username=?').bind(KPSS_OWNER_USERNAME).first();
      if (!user) {
        // First owner login: take over the legacy 'admin' row, or create the owner row, with an unusable password.
        const oldAdmin = await env.DB.prepare("SELECT id FROM kpss_users WHERE username='admin'").first();
        if (oldAdmin) {
          await env.DB.prepare("UPDATE kpss_users SET username=?, full_name='Veli Kesgin', password=? WHERE username='admin'")
            .bind(KPSS_OWNER_USERNAME, inspireUnusablePassword()).run();
        } else {
          const todayDate = new Date().toISOString().split('T')[0];
          await env.DB.prepare("INSERT INTO kpss_users (username,password,full_name,exam_name,exam_date) VALUES (?,?,'Veli Kesgin','KPSS',?)")
            .bind(KPSS_OWNER_USERNAME, inspireUnusablePassword(), todayDate).run();
        }
        user = await env.DB.prepare('SELECT * FROM kpss_users WHERE username=?').bind(KPSS_OWNER_USERNAME).first();
      }
    } else {
      user = await env.DB.prepare("SELECT * FROM kpss_users WHERE username=? AND password=?").bind(username, password).first();
    }
    if (!user) return json({ error: 'Hatalı kullanıcı adı veya şifre' }, 401, origin);

    if (user.username === 'vkesgin38' && user.full_name === 'Admin') {
       await env.DB.prepare("UPDATE kpss_users SET full_name='Veli Kesgin' WHERE username='vkesgin38'").run();
       user.full_name = 'Veli Kesgin';
    }

    const token = await signKpssJWT({ userId: user.id, username: user.username }, env.JWT_SECRET || 'secret');
    return json({ token, user: { id:user.id, username:user.username, full_name:user.full_name, exam_name:user.exam_name, exam_date:user.exam_date, xp:user.xp } }, 200, origin);
  }

  // Aşağısı auth gerektirir
  const kpssUser = await kpssAuth(request, env);
  if (!kpssUser) return json({ error: 'Yetkisiz' }, 401, origin);
  const uid = kpssUser.userId;

  // ─── GÜNLÜK PLANLAR ───
  if (path === '/api/kpss/plans' && method === 'GET') {
    const date = url.searchParams.get('date');
    let q = 'SELECT * FROM kpss_daily_plans WHERE user_id=?';
    const params = [uid];
    if (date) { q += ' AND date=?'; params.push(date); }
    q += ' ORDER BY date ASC, id ASC';
    const { results } = await env.DB.prepare(q).bind(...params).all();
    return json(results, 200, origin);
  }

  if (path === '/api/kpss/plans' && method === 'POST') {
    const d = await request.json();
    const { meta } = await env.DB.prepare(
      'INSERT INTO kpss_daily_plans (user_id,date,lesson_name,topic_name,target_question_count,solved_question_count,status,is_video_watched) VALUES (?,?,?,?,?,?,?,?)'
    ).bind(uid, d.date, d.lesson_name||'', d.topic_name||'', d.target_question_count||50, 0, 'Planlandı', 0).run();
    const row = await env.DB.prepare('SELECT * FROM kpss_daily_plans WHERE id=?').bind(meta.last_row_id).first();
    return json(row, 201, origin);
  }

  if (path.match(/^\/api\/kpss\/plans\/\d+$/) && method === 'PUT') {
    const id = path.split('/').pop();
    const d = await request.json();
    // XP hesapla
    const existing = await env.DB.prepare('SELECT * FROM kpss_daily_plans WHERE id=? AND user_id=?').bind(id, uid).first();
    let xpGain = 0;
    const wasCompleted = existing?.status === 'Tamamlandı';
    const isNowCompleted = d.is_video_watched && d.solved_question_count >= (existing?.target_question_count || 0);
    if (!wasCompleted && isNowCompleted) xpGain = 50;

    await env.DB.prepare(
      'UPDATE kpss_daily_plans SET lesson_name=?,topic_name=?,target_question_count=?,solved_question_count=?,status=?,is_video_watched=?,date=? WHERE id=? AND user_id=?'
    ).bind(d.lesson_name||'', d.topic_name||'', d.target_question_count||50, d.solved_question_count||0,
      isNowCompleted ? 'Tamamlandı' : 'Planlandı', d.is_video_watched?1:0, d.date||existing?.date, id, uid).run();

    if (xpGain > 0) {
      await env.DB.prepare('UPDATE kpss_users SET xp=xp+? WHERE id=?').bind(xpGain, uid).run();
    }
    const updated = await env.DB.prepare('SELECT * FROM kpss_daily_plans WHERE id=?').bind(id).first();
    const userRow = await env.DB.prepare('SELECT xp FROM kpss_users WHERE id=?').bind(uid).first();
    return json({ plan: updated, xp: userRow?.xp, xpGain }, 200, origin);
  }

  if (path.match(/^\/api\/kpss\/plans\/\d+$/) && method === 'DELETE') {
    const id = path.split('/').pop();
    await env.DB.prepare('DELETE FROM kpss_daily_plans WHERE id=? AND user_id=?').bind(id, uid).run();
    return json({ ok: true }, 200, origin);
  }

  // ─── ÖĞRETMENLER ───
  if (path === '/api/kpss/teachers' && method === 'GET') {
    const { results } = await env.DB.prepare('SELECT * FROM kpss_teachers WHERE user_id=? ORDER BY lesson_name').bind(uid).all();
    return json(results, 200, origin);
  }

  if (path === '/api/kpss/teachers' && method === 'POST') {
    const d = await request.json();
    const { meta } = await env.DB.prepare(
      'INSERT INTO kpss_teachers (user_id,lesson_name,teacher_name,youtube_url) VALUES (?,?,?,?)'
    ).bind(uid, d.lesson_name||'', d.teacher_name||'', d.youtube_url||'').run();
    const row = await env.DB.prepare('SELECT * FROM kpss_teachers WHERE id=?').bind(meta.last_row_id).first();
    return json(row, 201, origin);
  }

  if (path.match(/^\/api\/kpss\/teachers\/\d+$/) && method === 'DELETE') {
    const id = path.split('/').pop();
    await env.DB.prepare('DELETE FROM kpss_teachers WHERE id=? AND user_id=?').bind(id, uid).run();
    return json({ ok: true }, 200, origin);
  }

  if (path.match(/^\/api\/kpss\/teachers\/\d+$/) && method === 'PUT') {
    const id = path.split('/').pop();
    const d = await request.json();
    await env.DB.prepare(
      'UPDATE kpss_teachers SET lesson_name=?, teacher_name=?, youtube_url=? WHERE id=? AND user_id=?'
    ).bind(d.lesson_name||'', d.teacher_name||'', d.youtube_url||'', id, uid).run();
    return json({ ok: true }, 200, origin);
  }

  // ─── DENEME SINAVLARI ───
  if (path === '/api/kpss/exams' && method === 'GET') {
    const { results } = await env.DB.prepare(
      'SELECT * FROM kpss_trial_exams WHERE user_id=? ORDER BY exam_date DESC, id DESC'
    ).bind(uid).all();
    return json(results, 200, origin);
  }

  if (path === '/api/kpss/exams' && method === 'POST') {
    const d = await request.json();
    const { meta } = await env.DB.prepare(
      'INSERT INTO kpss_trial_exams (user_id,lesson,exam_name,exam_date,correct_count,incorrect_count) VALUES (?,?,?,?,?,?)'
    ).bind(uid, d.lesson||'GENEL DENEME', d.exam_name||'', d.exam_date||new Date().toISOString().split('T')[0], d.correct_count||0, d.incorrect_count||0).run();
    const row = await env.DB.prepare('SELECT * FROM kpss_trial_exams WHERE id=?').bind(meta.last_row_id).first();
    return json(row, 201, origin);
  }

  if (path.match(/^\/api\/kpss\/exams\/\d+$/) && method === 'DELETE') {
    const id = path.split('/').pop();
    await env.DB.prepare('DELETE FROM kpss_trial_exams WHERE id=? AND user_id=?').bind(id, uid).run();
    return json({ ok: true }, 200, origin);
  }

  // ─── YAPIŞKAN NOT ───
  if (path === '/api/kpss/note' && method === 'GET') {
    const row = await env.DB.prepare('SELECT * FROM kpss_sticky_notes WHERE user_id=?').bind(uid).first();
    return json({ content: row?.content || '' }, 200, origin);
  }

  if (path === '/api/kpss/note' && method === 'PUT') {
    const { content } = await request.json();
    const exists = await env.DB.prepare('SELECT id FROM kpss_sticky_notes WHERE user_id=?').bind(uid).first();
    if (exists) {
      await env.DB.prepare('UPDATE kpss_sticky_notes SET content=?,updated_at=datetime(\'now\') WHERE user_id=?').bind(content||'', uid).run();
    } else {
      await env.DB.prepare('INSERT INTO kpss_sticky_notes (user_id,content) VALUES (?,?)').bind(uid, content||'').run();
    }
    return json({ ok: true }, 200, origin);
  }

  // ─── STATS (Dashboard için) ───
  if (path === '/api/kpss/stats' && method === 'GET') {
    const user = await env.DB.prepare('SELECT * FROM kpss_users WHERE id=?').bind(uid).first();
    const totalSolved = await env.DB.prepare('SELECT SUM(solved_question_count) as total FROM kpss_daily_plans WHERE user_id=?').bind(uid).first();
    const completed   = await env.DB.prepare('SELECT COUNT(*) as cnt FROM kpss_daily_plans WHERE user_id=? AND status=\'Tamamlandı\'').bind(uid).first();
    const totalPlans  = await env.DB.prepare('SELECT COUNT(*) as cnt FROM kpss_daily_plans WHERE user_id=?').bind(uid).first();
    const today = new Date().toISOString().split('T')[0];
    const { results: todayPlans } = await env.DB.prepare('SELECT * FROM kpss_daily_plans WHERE user_id=? AND date=?').bind(uid, today).all();
    const { results: teachers }   = await env.DB.prepare('SELECT * FROM kpss_teachers WHERE user_id=?').bind(uid).all();
    const note = await env.DB.prepare('SELECT content FROM kpss_sticky_notes WHERE user_id=?').bind(uid).first();

    // Heatmap — son 28 gün
    const heatmap = [];
    for (let i = 27; i >= 0; i--) {
      const d = new Date(); d.setDate(d.getDate() - i);
      const dateStr = d.toISOString().split('T')[0];
      const act = await env.DB.prepare(
        'SELECT COUNT(*) as cnt FROM kpss_daily_plans WHERE user_id=? AND date=? AND (is_video_watched=1 OR solved_question_count>0)'
      ).bind(uid, dateStr).first();
      heatmap.push({ date: dateStr, day: d.getDate(), count: act?.cnt || 0 });
    }

    return json({
      user: { id:user.id, username:user.username, full_name:user.full_name, exam_name:user.exam_name, exam_date:user.exam_date, xp:user.xp },
      totalSolved: totalSolved?.total || 0,
      completedCount: completed?.cnt || 0,
      totalPlans: totalPlans?.cnt || 0,
      todayPlans,
      teachers,
      note: note?.content || '',
      heatmap
    }, 200, origin);
  }

  // ─── AYARLAR ───
  if (path === '/api/kpss/settings' && method === 'PUT') {
    const { exam_name, exam_date } = await request.json();
    await env.DB.prepare('UPDATE kpss_users SET exam_name=?,exam_date=? WHERE id=?').bind(exam_name||'KPSS', exam_date, uid).run();
    const user = await env.DB.prepare('SELECT * FROM kpss_users WHERE id=?').bind(uid).first();
    return json({ user }, 200, origin);
  }

  if (path === '/api/kpss/user' && method === 'DELETE') {
    const { password } = await request.json();
    // The owner's row holds no usable password (see migrateKpssOwnerPassword): confirm with the current ADMIN_PASSWORD.
    const user = kpssUser.username === KPSS_OWNER_USERNAME
      ? ((await kpssOwnerPasswordOk(env, password)) ? await env.DB.prepare('SELECT * FROM kpss_users WHERE id=? AND username=?').bind(uid, KPSS_OWNER_USERNAME).first() : null)
      : await env.DB.prepare('SELECT * FROM kpss_users WHERE id=? AND password=?').bind(uid, password).first();
    if (!user) return json({ error: 'Hatalı şifre' }, 401, origin);
    await env.DB.prepare('DELETE FROM kpss_daily_plans WHERE user_id=?').bind(uid).run();
    await env.DB.prepare('DELETE FROM kpss_teachers WHERE user_id=?').bind(uid).run();
    await env.DB.prepare('DELETE FROM kpss_trial_exams WHERE user_id=?').bind(uid).run();
    await env.DB.prepare('DELETE FROM kpss_sticky_notes WHERE user_id=?').bind(uid).run();
    await env.DB.prepare('DELETE FROM kpss_users WHERE id=?').bind(uid).run();
    return json({ ok: true }, 200, origin);
  }
}
// ─── KPSS ROUTES SONU ───
// === INSPIRE ROUTES ===
    // Inspire user management (portfolio admin JWT). The reserved '__guest__' row owns every guest
    // post/note (ON DELETE CASCADE), so it is hidden from the list and cannot be deleted here.
    if (cleanPath === '/api/admin/inspire-users' && method === 'GET') {
      const admin = await authMiddleware(request, env);
      if (!admin) return json({ error: 'Yetkisiz' }, 401, origin);
      const { results } = await env.DB.prepare("SELECT id, username, full_name, created_at, password FROM inspire_users WHERE username <> '__guest__' ORDER BY id DESC").all();
      return json(results, 200, origin);
    }
    if (cleanPath === '/api/admin/inspire-users' && method === 'POST') {
      const admin = await authMiddleware(request, env);
      if (!admin) return json({ error: 'Yetkisiz' }, 401, origin);
      const d = await request.json();
      if (!d.username || !d.password) return json({ error: 'Kullanıcı adı ve şifre zorunlu' }, 400, origin);
      try {
        await env.DB.prepare('INSERT INTO inspire_users (username, password, full_name) VALUES (?, ?, ?)').bind(d.username, d.password, d.full_name || '').run();
        return json({ ok: true }, 201, origin);
      } catch(e) {
        return json({ error: 'Kullanıcı zaten var veya DB hatası' }, 400, origin);
      }
    }
    if (cleanPath.match(/^\/api\/admin\/inspire-users\/\d+$/) && method === 'DELETE') {
      const admin = await authMiddleware(request, env);
      if (!admin) return json({ error: 'Yetkisiz' }, 401, origin);
      const id = cleanPath.split('/').pop();
      const target = await env.DB.prepare('SELECT username FROM inspire_users WHERE id=?').bind(id).first();
      if (target && target.username === '__guest__') return json({ error: 'reserved_user', message: 'Misafir sistem kullanıcısı silinemez' }, 400, origin);
      await env.DB.prepare('DELETE FROM inspire_users WHERE id=?').bind(id).run();
      return json({ ok: true }, 200, origin);
    }

    // Fikir Havuzu API (/api/inspire/*): see handleInspire() above
    if (cleanPath === '/api/inspire' || cleanPath.startsWith('/api/inspire/')) {
      return handleInspire(request, env, ctx, cleanPath, method, origin);
    }

    // === PROTECTED: Auth gerekli ===
    const user = await authMiddleware(request, env);

    // === UI ROUTES ===
    // 1. Table Init
    if (path === '/api/ui/init' && method === 'GET') {
      try {
        await env.DB.prepare(`
          CREATE TABLE IF NOT EXISTS ui_users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            email TEXT UNIQUE NOT NULL,
            password TEXT NOT NULL,
            full_name TEXT DEFAULT '',
            plan TEXT DEFAULT 'FREE', -- FREE, PRO
            subscription_end TEXT,
            is_email_verified INTEGER DEFAULT 0,
            created_at TEXT DEFAULT (datetime('now'))
          )
        `).run();
        
        await env.DB.prepare(`
          CREATE TABLE IF NOT EXISTS ui_auth_tokens (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            token TEXT NOT NULL,
            type TEXT NOT NULL, -- 'ACTIVATION' or 'RESET'
            expires_at TEXT NOT NULL,
            created_at TEXT DEFAULT (datetime('now'))
          )
        `).run();

        await env.DB.prepare(`
          CREATE TABLE IF NOT EXISTS ui_downloads (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            component_id TEXT NOT NULL,
            download_type TEXT DEFAULT 'riv', -- 'riv' or 'code'
            created_at TEXT DEFAULT (datetime('now')),
            FOREIGN KEY(user_id) REFERENCES ui_users(id) ON DELETE CASCADE
          )
        `).run();
        
        try { await env.DB.prepare("ALTER TABLE ui_users ADD COLUMN is_email_verified INTEGER DEFAULT 1").run(); } catch(e){}

        return json({ ok: true }, 200, origin);
      } catch (e) {
        return json({ error: e.message }, 500, origin);
      }
    }

    // -- EMAIL SENDER HELPER --
    async function sendResendEmail(to, subject, html) {
      if (!env.RESEND_API_KEY) return false;
      try {
        const res = await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${env.RESEND_API_KEY}` },
          body: JSON.stringify({
            from: 'VK UI <noreply@velikesgin.com>',
            to: [to],
            subject: subject,
            html: html
          })
        });
        return res.ok;
      } catch(e) { return false; }
    }

    // 2. Register
    if (path === '/api/ui/auth/register' && method === 'POST') {
      const { email, password, full_name } = await request.json().catch(() => ({}));
      if (!email || !password) return json({ error: 'E-posta ve şifre gereklidir' }, 400, origin);
      
      try {
        const isVerifiedDefault = env.RESEND_API_KEY ? 0 : 1; // If no API key, skip verification
        const { meta } = await env.DB.prepare(
          'INSERT INTO ui_users (email, password, full_name, is_email_verified) VALUES (?, ?, ?, ?)'
        ).bind(email, password, full_name || '', isVerifiedDefault).run();
        
        const userId = meta.last_row_id;

        if (env.RESEND_API_KEY) {
          const code = Math.floor(100000 + Math.random() * 900000).toString();
          const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString(); // 1 hour
          await env.DB.prepare('INSERT INTO ui_auth_tokens (user_id, token, type, expires_at) VALUES (?, ?, ?, ?)')
                      .bind(userId, code, 'ACTIVATION', expiresAt).run();
          
          await sendResendEmail(email, 'Hesabınızı Aktive Edin', `
            <div style="font-family:sans-serif;max-width:500px;margin:0 auto;padding:20px;border:1px solid #eee;border-radius:10px;">
              <h2 style="color:#ff2b73;">Hoş Geldiniz!</h2>
              <p>Hesabınızı aktive etmek için aşağıdaki 6 haneli kodu kullanın:</p>
              <div style="background:#f4f4f5;padding:15px;font-size:24px;font-weight:bold;letter-spacing:5px;text-align:center;border-radius:8px;margin:20px 0;">
                ${code}
              </div>
              <p>Bu kod 1 saat geçerlidir.</p>
            </div>
          `);
          return json({ needsVerification: true, email }, 201, origin);
        } else {
          // Fallback if no email provider configured
          const token = await signUiJWT({ userId, email }, env.JWT_SECRET || 'secret');
          return json({ token, user: { id: userId, email, full_name, plan: 'FREE' } }, 201, origin);
        }
      } catch (e) {
        return json({ error: 'Bu e-posta adresi zaten kullanımda olabilir' }, 400, origin);
      }
    }

    // 2.5 Verify Email
    if (path === '/api/ui/auth/verify' && method === 'POST') {
      const { email, code } = await request.json().catch(() => ({}));
      if (!email || !code) return json({ error: 'Eksik bilgi' }, 400, origin);
      
      const user = await env.DB.prepare("SELECT id FROM ui_users WHERE email=?").bind(email).first();
      if (!user) return json({ error: 'Kullanıcı bulunamadı' }, 404, origin);
      
      const tokenRow = await env.DB.prepare("SELECT * FROM ui_auth_tokens WHERE user_id=? AND token=? AND type='ACTIVATION' ORDER BY id DESC").bind(user.id, code).first();
      if (!tokenRow) return json({ error: 'Geçersiz doğrulama kodu' }, 400, origin);
      
      if (new Date(tokenRow.expires_at) < new Date()) {
        return json({ error: 'Kodun süresi dolmuş' }, 400, origin);
      }
      
      await env.DB.prepare("UPDATE ui_users SET is_email_verified=1 WHERE id=?").bind(user.id).run();
      await env.DB.prepare("DELETE FROM ui_auth_tokens WHERE id=?").bind(tokenRow.id).run();
      
      return json({ ok: true }, 200, origin);
    }

    // 3. Login
    if (path === '/api/ui/auth/login' && method === 'POST') {
      const { email, password } = await request.json().catch(() => ({}));
      if (!email || !password) return json({ error: 'E-posta ve şifre gereklidir' }, 400, origin);
      
      const uiUser = await env.DB.prepare("SELECT * FROM ui_users WHERE email=? AND password=?").bind(email, password).first();
      if (!uiUser) return json({ error: 'Hatalı e-posta veya şifre' }, 401, origin);
      
      if (uiUser.is_email_verified === 0) {
        return json({ error: 'Hesabınız onaylanmamış. Lütfen e-postanıza gelen kodu girin.', unverified: true, email }, 403, origin);
      }

      const token = await signUiJWT({ userId: uiUser.id, email: uiUser.email }, env.JWT_SECRET || 'secret');
      return json({ token, user: { id: uiUser.id, email: uiUser.email, full_name: uiUser.full_name, plan: uiUser.plan, subscription_end: uiUser.subscription_end } }, 200, origin);
    }

    // 3.5 Forgot Password Request
    if (path === '/api/ui/auth/forgot-password' && method === 'POST') {
      const { email } = await request.json().catch(() => ({}));
      if (!email) return json({ error: 'E-posta gereklidir' }, 400, origin);
      
      if (!env.RESEND_API_KEY) {
        return json({ error: 'E-posta servisi şu an yapılandırılmamış. Lütfen yönetici ile iletişime geçin.' }, 500, origin);
      }

      const user = await env.DB.prepare("SELECT id FROM ui_users WHERE email=?").bind(email).first();
      if (user) {
        const code = Math.floor(100000 + Math.random() * 900000).toString();
        const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();
        await env.DB.prepare('INSERT INTO ui_auth_tokens (user_id, token, type, expires_at) VALUES (?, ?, ?, ?)')
                    .bind(user.id, code, 'RESET', expiresAt).run();
        
        await sendResendEmail(email, 'Şifre Sıfırlama Kodu', `
          <div style="font-family:sans-serif;max-width:500px;margin:0 auto;padding:20px;border:1px solid #eee;border-radius:10px;">
            <h2 style="color:#ff2b73;">Şifre Sıfırlama</h2>
            <p>Şifrenizi sıfırlamak için aşağıdaki 6 haneli kodu kullanın:</p>
            <div style="background:#f4f4f5;padding:15px;font-size:24px;font-weight:bold;letter-spacing:5px;text-align:center;border-radius:8px;margin:20px 0;">
              ${code}
            </div>
            <p>Eğer bu işlemi siz talep etmediyseniz, bu mesajı yoksayabilirsiniz.</p>
          </div>
        `);
      }
      // Her halükarda başarılı dönüyoruz ki kullanıcı olup olmadığı anlaşılarak brute-force yapılmasın.
      return json({ ok: true }, 200, origin);
    }

    // 3.6 Reset Password
    if (path === '/api/ui/auth/reset-password' && method === 'POST') {
      const { email, code, newPassword } = await request.json().catch(() => ({}));
      if (!email || !code || !newPassword) return json({ error: 'Tüm alanları doldurun' }, 400, origin);
      
      const user = await env.DB.prepare("SELECT id FROM ui_users WHERE email=?").bind(email).first();
      if (!user) return json({ error: 'Geçersiz kod veya e-posta' }, 400, origin);
      
      const tokenRow = await env.DB.prepare("SELECT * FROM ui_auth_tokens WHERE user_id=? AND token=? AND type='RESET' ORDER BY id DESC").bind(user.id, code).first();
      if (!tokenRow) return json({ error: 'Geçersiz veya kullanılmış kod' }, 400, origin);
      
      if (new Date(tokenRow.expires_at) < new Date()) {
        return json({ error: 'Kodun süresi dolmuş' }, 400, origin);
      }
      
      await env.DB.prepare("UPDATE ui_users SET password=? WHERE id=?").bind(newPassword, user.id).run();
      await env.DB.prepare("DELETE FROM ui_auth_tokens WHERE id=?").bind(tokenRow.id).run();
      
      return json({ ok: true }, 200, origin);
    }

    // 4. Me (Get current user)
    
    // ---------------- UI COMMENTS ----------------
    if (path === '/api/ui/comments' && method === 'GET') {
      const compId = url.searchParams.get('component_id');
      if (!compId) return json({ error: 'component_id required' }, 400, origin);
      
      const authData = await uiAuth(request, env);
      const isAdmin = authData?.email === 'vkesgin38@gmail.com';
      
      // Herkese açık olanlar (approved=1) + Yapanın kendisi veya Admin ise diğerleri (0,2)
      const { results } = await env.DB.prepare(`
        SELECT c.id, c.content, c.created_at, u.full_name, u.plan, c.is_approved, c.user_id
        FROM ui_comments c 
        JOIN ui_users u ON c.user_id = u.id 
        WHERE c.component_id = ? AND (c.is_approved = 1 OR c.user_id = ? OR ?)
        ORDER BY c.created_at DESC
      `).bind(compId, authData?.userId || -1, isAdmin ? 1 : 0).all();
      return json(results, 200, origin);
    }

    if (path === '/api/ui/comments' && method === 'POST') {
      const authData = await uiAuth(request, env);
      if (!authData) return json({ error: 'Yetkisiz (Lütfen tekrar giriş yapın)' }, 401, origin);
      
      const { component_id, content } = await request.json().catch(() => ({}));
      if (!component_id || !content) return json({ error: 'Eksik veri' }, 400, origin);
      
      // Admin kontrolü: Sadece vkesgin38@gmail.com direkt yayınlar
      const is_admin = authData.email === 'vkesgin38@gmail.com';
      const is_approved = is_admin ? 1 : 0;

      await env.DB.prepare(
        "INSERT INTO ui_comments (component_id, user_id, content, is_approved) VALUES (?, ?, ?, ?)"
      ).bind(component_id, authData.userId, content, is_approved).run();
      
      return json({ message: is_approved ? 'Yorum eklendi' : 'Yorum onay bekliyor' }, 200, origin);
    }

    if (cleanPath === '/api/admin/comments' && method === 'GET') {
      const authData = await uiAuth(request, env);
      if (!authData || authData.email !== 'vkesgin38@gmail.com') return json({ error: 'Yetkisiz' }, 401, origin);

      const { results } = await env.DB.prepare(`
        SELECT c.id, c.content, c.is_approved, c.created_at, u.full_name, u.email, c.component_id
        FROM ui_comments c
        JOIN ui_users u ON c.user_id = u.id
        ORDER BY c.is_approved ASC, c.created_at DESC
      `).all();
      return json(results, 200, origin);
    }

    if (cleanPath.match(/^\/api\/admin\/comments\/\d+$/) && method === 'PUT') {
      const authData = await uiAuth(request, env);
      if (!authData || authData.email !== 'vkesgin38@gmail.com') return json({ error: 'Yetkisiz' }, 401, origin);

      const id = cleanPath.split('/').pop();
      const { status } = await request.json().catch(() => ({})); // 0, 1, 2
      await env.DB.prepare("UPDATE ui_comments SET is_approved = ? WHERE id = ?").bind(status, id).run();
      return json({ message: 'Güncellendi' }, 200, origin);
    }
    
    if (cleanPath.match(/^\/api\/admin\/comments\/\d+$/) && method === 'DELETE') {
      const authData = await uiAuth(request, env);
      if (!authData || authData.email !== 'vkesgin38@gmail.com') return json({ error: 'Yetkisiz' }, 401, origin);

      const id = cleanPath.split('/').pop();
      await env.DB.prepare("DELETE FROM ui_comments WHERE id = ?").bind(id).run();
      return json({ message: 'Silindi' }, 200, origin);
    }
    // ---------------------------------------------
if (path === '/api/ui/auth/me' && method === 'GET') {
      const authData = await uiAuth(request, env);
      if (!authData) return json({ error: 'Yetkisiz' }, 401, origin);
      
      const uiUser = await env.DB.prepare("SELECT id, email, full_name, plan, subscription_end FROM ui_users WHERE id=?").bind(authData.userId).first();
      if (!uiUser) return json({ error: 'Kullanıcı bulunamadı' }, 404, origin);
      
      // Kalan indirme hakkını hesapla (FREE: 5/ay, PRO: sınırsız)
      let remaining_downloads = -1; // -1 = sınırsız (PRO)
      if (uiUser.plan !== 'PRO') {
        const now = new Date();
        const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
        const dlCount = await env.DB.prepare(
          "SELECT COUNT(*) as cnt FROM ui_downloads WHERE user_id=? AND created_at >= ?"
        ).bind(uiUser.id, monthStart).first();
        remaining_downloads = Math.max(0, 5 - (dlCount?.cnt || 0));
      }
      
      return json({ user: { ...uiUser, remaining_downloads } }, 200, origin);
    }

    // 4.1 Update Me (Profile & Password)
    if (path === '/api/ui/auth/me' && method === 'PUT') {
      const authData = await uiAuth(request, env);
      if (!authData) return json({ error: 'Yetkisiz' }, 401, origin);
      
      const { full_name, currentPassword, newPassword } = await request.json().catch(() => ({}));
      
      let query = 'UPDATE ui_users SET ';
      const updates = [];
      const params = [];
      
      if (full_name !== undefined) {
        updates.push('full_name=?');
        params.push(full_name);
      }
      
      if (newPassword) {
        const user = await env.DB.prepare("SELECT password FROM ui_users WHERE id=?").bind(authData.userId).first();
        if (!user || user.password !== currentPassword) {
           return json({ error: 'Mevcut şifreniz hatalı' }, 400, origin);
        }
        updates.push('password=?');
        params.push(newPassword);
      }
      
      if (updates.length > 0) {
        query += updates.join(', ') + ' WHERE id=?';
        params.push(authData.userId);
        await env.DB.prepare(query).bind(...params).run();
      }
      
      const updatedUser = await env.DB.prepare("SELECT id, email, full_name, plan, subscription_end FROM ui_users WHERE id=?").bind(authData.userId).first();
      return json({ ok: true, user: updatedUser }, 200, origin);
    }

    // 4.5 Download endpoint — indirme hakkı kontrolü ve sayaç
    if (path === '/api/ui/download' && method === 'POST') {
      const authData = await uiAuth(request, env);
      if (!authData) return json({ error: 'Bu içeriğe erişmek için giriş yapmalısınız' }, 401, origin);
      
      const { component_id, download_type } = await request.json().catch(() => ({}));
      if (!component_id) return json({ error: 'component_id gerekli' }, 400, origin);
      
      const uiUser = await env.DB.prepare("SELECT id, plan FROM ui_users WHERE id=?").bind(authData.userId).first();
      if (!uiUser) return json({ error: 'Kullanıcı bulunamadı' }, 404, origin);
      
      // PRO bileşen kontrolü
      const comp = await env.DB.prepare("SELECT is_featured FROM projects WHERE id=?").bind(component_id).first();
      if (comp && comp.is_featured && uiUser.plan !== 'PRO') {
        return json({ error: 'Bu bileşen PRO üyelere özeldir' }, 403, origin);
      }
      
      // FREE kullanıcı limit kontrolü
      if (uiUser.plan !== 'PRO') {
        const now = new Date();
        const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
        const dlCount = await env.DB.prepare(
          "SELECT COUNT(*) as cnt FROM ui_downloads WHERE user_id=? AND created_at >= ?"
        ).bind(uiUser.id, monthStart).first();
        const used = dlCount?.cnt || 0;
        if (used >= 5) {
          return json({ error: 'Aylık indirme limitiniz doldu (5/5). PRO pakete geçerek sınırsız indirme yapabilirsiniz.', limit_reached: true }, 403, origin);
        }
      }
      
      // İndirmeyi kaydet
      await env.DB.prepare(
        'INSERT INTO ui_downloads (user_id, component_id, download_type) VALUES (?, ?, ?)'
      ).bind(uiUser.id, component_id, download_type || 'riv').run();
      
      // Güncel kalan hakkı döndür
      let remaining = -1;
      if (uiUser.plan !== 'PRO') {
        const now2 = new Date();
        const ms2 = new Date(now2.getFullYear(), now2.getMonth(), 1).toISOString();
        const c2 = await env.DB.prepare("SELECT COUNT(*) as cnt FROM ui_downloads WHERE user_id=? AND created_at >= ?").bind(uiUser.id, ms2).first();
        remaining = Math.max(0, 5 - (c2?.cnt || 0));
      }
      
      return json({ ok: true, remaining_downloads: remaining }, 200, origin);
    }

    // 5. Lemon Squeezy Webhook
    if (path === '/api/ui/webhook/lemonsqueezy' && method === 'POST') {
      try {
        const signature = request.headers.get('X-Signature');
        // İdealde burada crypto.subtle ile secret key doğrulaması yapılır.
        // Şimdilik gelen payload'u alıp DB'yi güncelleyeceğiz.
        
        const payload = await request.json();
        const eventName = payload.meta.event_name;
        const customData = payload.meta.custom_data;
        const userId = customData?.user_id;
        
        if (!userId) return json({ error: 'Missing user_id in custom_data' }, 400);

        if (eventName === 'subscription_created' || eventName === 'subscription_updated') {
          const status = payload.data.attributes.status; // active, past_due, unpaid, canceled, expired
          const endsAt = payload.data.attributes.renews_at || payload.data.attributes.ends_at;
          
          if (status === 'active') {
            const user = await env.DB.prepare("SELECT subscription_end FROM ui_users WHERE id=?").bind(userId).first();
            let finalEndsAt = endsAt;

            if (eventName === 'subscription_created' && user && user.subscription_end) {
              const currentEnd = new Date(user.subscription_end);
              const now = new Date();
              if (currentEnd > now) {
                const newEnd = new Date(endsAt);
                const addedMs = newEnd.getTime() - payload.data.attributes.created_at ? new Date(payload.data.attributes.created_at).getTime() : now.getTime();
                // To be safer, just calculate the difference between the given endsAt and now
                const durationMs = newEnd.getTime() - now.getTime();
                if (durationMs > 0) {
                  finalEndsAt = new Date(currentEnd.getTime() + durationMs).toISOString();
                }
              }
            }
            
            await env.DB.prepare("UPDATE ui_users SET plan='PRO', subscription_end=? WHERE id=?").bind(finalEndsAt, userId).run();
          } else if (status === 'expired' || status === 'canceled' || status === 'unpaid') {
            await env.DB.prepare("UPDATE ui_users SET plan='FREE' WHERE id=?").bind(userId).run();
          }
        }
        
        return json({ received: true }, 200);
      } catch (err) {
        return json({ error: 'Webhook processing failed' }, 500);
      }
    }

    // === PROTECTED: Admin Auth Gerekli Olanlar ===
    if (!user) return json({ error: 'Yetkisiz' }, 401, origin);

    // === UI USERS (ADMIN) ===
    if (path === '/api/admin/ui-users' && method === 'GET') {
      const { results } = await env.DB.prepare('SELECT id, email, full_name, plan, password, subscription_end, created_at FROM ui_users ORDER BY created_at DESC').all();
      return json(results, 200, origin);
    }
    
    if (path.match(/^\/api\/admin\/ui-users\/\d+$/) && method === 'DELETE') {
      const id = path.split('/').pop();
      await env.DB.prepare('DELETE FROM ui_users WHERE id=?').bind(id).run();
      return json({ ok: true }, 200, origin);
    }

    if (path.match(/^\/api\/admin\/ui-users\/\d+$/) && method === 'PUT') {
      const id = path.split('/').pop();
      const { password, plan } = await request.json().catch(() => ({}));
      
      let query = 'UPDATE ui_users SET ';
      const updates = [];
      const params = [];
      
      if (password) { updates.push('password=?'); params.push(password); }
      if (plan) { updates.push('plan=?'); params.push(plan); }
      
      if (updates.length > 0) {
        query += updates.join(', ') + ' WHERE id=?';
        params.push(id);
        await env.DB.prepare(query).bind(...params).run();
      }
      return json({ ok: true }, 200, origin);
    }

    // === FITNESS / SETTINGS API (POST/DELETE) ===

    if (path === '/api/fitness' && method === 'POST') {
      const body = await request.json();
      const { key, value } = body;
      if (!key || !value) return json({ error: 'Eksik veri' }, 400, origin);
      
      await env.DB.prepare(`
        INSERT INTO fitness_store (key, value) VALUES (?, ?)
        ON CONFLICT(key) DO UPDATE SET value=excluded.value
      `).bind(key, value).run();
      
      return json({ ok: true }, 200, origin);
    }

    if (path === '/api/fitness' && method === 'DELETE') {
      const body = await request.json();
      const { key } = body;
      if (!key) return json({ error: 'Key gerekli' }, 400, origin);
      await env.DB.prepare('DELETE FROM fitness_store WHERE key=?').bind(key).run();
      return json({ ok: true }, 200, origin);
    }

    // Proje ekle
    if (path === '/api/projects' && method === 'POST') {
      const data = await request.json();
      const id   = nanoid();
      await env.DB.prepare(`
        INSERT INTO projects (id,title,category,description,tags,year,image_url,video_url,thumbnail_url,is_featured,featured_order)
        VALUES (?,?,?,?,?,?,?,?,?,?,?)
      `).bind(
        id, data.title, data.category,
        data.description || '', data.tags || '', data.year || new Date().getFullYear().toString(),
        data.image_url || '', data.video_url || '', data.thumbnail_url || '',
        data.is_featured ? 1 : 0, data.featured_order || 0
      ).run();
      const project = await env.DB.prepare('SELECT * FROM projects WHERE id=?').bind(id).first();
      return json(project, 201, origin);
    }

    // Proje güncelle
    if (path.match(/^\/api\/projects\/[^/]+$/) && method === 'PUT') {
      const id   = path.split('/').pop();
      const data = await request.json();
      await env.DB.prepare(`
        UPDATE projects SET
          title=?, category=?, description=?, tags=?, year=?,
          image_url=?, video_url=?, thumbnail_url=?,
          is_featured=?, featured_order=?
        WHERE id=?
      `).bind(
        data.title, data.category,
        data.description || '', data.tags || '', data.year || '',
        data.image_url || '', data.video_url || '', data.thumbnail_url || '',
        data.is_featured ? 1 : 0, data.featured_order || 0,
        id
      ).run();
      const project = await env.DB.prepare('SELECT * FROM projects WHERE id=?').bind(id).first();
      return json(project, 200, origin);
    }

    // Proje sil
    if (path.match(/^\/api\/projects\/[^/]+$/) && method === 'DELETE') {
      const id = path.split('/').pop();
      const project = await env.DB.prepare('SELECT * FROM projects WHERE id=?').bind(id).first();
      if (project) {
        // R2'den dosyaları sil
        if (project.image_url)   await env.STORAGE.delete(project.image_url.replace('/files/',''));
        if (project.video_url)   await env.STORAGE.delete(project.video_url.replace('/files/',''));
        if (project.thumbnail_url) await env.STORAGE.delete(project.thumbnail_url.replace('/files/',''));
      }
      await env.DB.prepare('DELETE FROM projects WHERE id=?').bind(id).run();
      return json({ ok: true }, 200, origin);
    }

    // Dosya yükle
    if (path === '/api/upload' && method === 'POST') {
      const form     = await request.formData();
      const file     = form.get('file');
      const fileType = form.get('type') || 'image';
      if (!file) return json({ error: 'Dosya yok' }, 400, origin);

      const ext      = file.name.split('.').pop().toLowerCase();
      // 'file' türü için prefix ekleme — sadece images/videos için alt klasör
      const prefix   = (fileType === 'image' || fileType === 'video') ? `${fileType}s/` : '';
      const key      = `${prefix}${nanoid()}.${ext}`;
      const buffer   = await file.arrayBuffer();

      await env.STORAGE.put(key, buffer, {
        httpMetadata: { contentType: file.type },
      });

      const fileUrl = `/files/${key}`;
      return json({ url: fileUrl, key }, 201, origin);
    }


    
  }
};
