import { parseLink, MAX_URL_LENGTH } from '../assets/js/fikir-url.mjs';

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
  return await verifyJWT(token, env.JWT_SECRET || 'secret');
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
  return verifyKpssJWT(token, env.JWT_SECRET || 'secret');
}

// ─── INSPIRE (Fikir Havuzu) HELPERS ───
// Tokens: HMAC-SHA256 with key JWT_SECRET + '_inspire'. New tokens are base64url(UTF-8 JSON) so Turkish
// names (ş, ğ, ı) survive; tokens made by the old btoa() helper (standard base64 of Latin-1 JSON) still verify.
// Payloads: guest {g:1, cid, name, iat, exp}  |  registered/admin {userId, username, iat, exp}
// iat/exp are seconds (JWT NumericDate). Old tokens have no exp (still valid) and a millisecond iat.
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
const INSPIRE_MAX_HTML_BYTES   = 512 * 1024;
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
// GET /api/inspire/posts page size (newest first, ?before=<id> cursor; X-Fikir-Next names the next cursor)
const INSPIRE_PAGE_SIZE = 200;
// A failed preview fetch is stored as meta '{"failed":1,"at":<s>}' and not retried before this
const INSPIRE_META_RETRY_S = 2 * 24 * 60 * 60;
// Rate limits: bucket -> [max requests, window seconds]. Counted in D1 (inspire_rate), fixed windows.
const INSPIRE_LIMITS = {
  guest:    [30, 600],    // guest tokens per IP / 10 min
  login:    [5, 900],     // FAILED password logins per IP / 15 min
  post:     [30, 3600],   // new posts per guest cid or user / hour
  post_ip:  [60, 3600],   // new posts per IP / hour
  note:     [60, 3600],   // new notes per guest cid or user / hour
  note_ip:  [120, 3600],
  check:    [30, 60],     // duplicate checks per cid or user / minute (may resolve short links)
  check_ip: [60, 60],
  fetch_ip: [30, 60],     // /posts/:id/meta calls that fetch a third-party page, per IP / minute
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
async function inspireActor(request, env) {
  const p = await inspireAuth(request, env);
  if (!p) return null;
  if (p.g === 1) {
    if (typeof p.cid !== 'string' || !INSPIRE_CID_RE.test(p.cid)) return null;
    const name = cleanInspireName(p.name);
    // tokens minted before the reserved-name check still post, but as Anonim
    return { guest: true, cid: p.cid, userId: null, username: null, name: inspireReservedName(name) ? '' : name, isAdmin: false };
  }
  const userId = Number(p.userId);
  if (!Number.isSafeInteger(userId) || userId <= 0) return null;
  const username = typeof p.username === 'string' ? p.username : '';
  if (username === INSPIRE_GUEST_USERNAME) return null;
  return { guest: false, cid: null, userId, username, name: null, isAdmin: username === INSPIRE_ADMIN_USERNAME };
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
let inspireSchemaReady = null;
let inspireGuestId = null;
function ensureInspireSchema(env) {
  if (!inspireSchemaReady) {
    inspireSchemaReady = migrateInspireSchema(env).catch((e) => { inspireSchemaReady = null; throw e; });
  }
  return inspireSchemaReady;
}
async function migrateInspireSchema(env) {
  const db = env.DB;
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
  ]);
  const columns = {
    inspire_users: [['is_first_login', 'INTEGER DEFAULT 1']],
    inspire_posts: [['author_name', 'TEXT'], ['client_id', 'TEXT'], ['url_key', 'TEXT'], ['meta', 'TEXT']],
    inspire_notes: [['author_name', 'TEXT'], ['client_id', 'TEXT']],
  };
  for (const [table, cols] of Object.entries(columns)) {
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
  await db.batch([
    db.prepare('CREATE INDEX IF NOT EXISTS idx_inspire_posts_url_key ON inspire_posts(url_key)'),
    db.prepare('CREATE INDEX IF NOT EXISTS idx_inspire_notes_post ON inspire_notes(post_id)'),
  ]);
  // Reserved owner row for guest content (user_id is NOT NULL + FK). Its password can never be used:
  // /api/inspire/login rejects this username.
  await db.prepare("INSERT OR IGNORE INTO inspire_users (username, password, full_name) VALUES (?, ?, 'Misafir')")
    .bind(INSPIRE_GUEST_USERNAME, inspireUnusablePassword()).run();
  const guest = await db.prepare('SELECT id FROM inspire_users WHERE username=?').bind(INSPIRE_GUEST_USERNAME).first();
  inspireGuestId = guest.id;
  // The owner logs in with ADMIN_PASSWORD only. A password stored in the owner's row (a copy written by
  // the old first login, or one set through change-password) must not remain a second credential.
  await db.prepare("UPDATE inspire_users SET password=?, is_first_login=0 WHERE username=? AND substr(password, 1, 1) <> '!'")
    .bind(inspireUnusablePassword(), INSPIRE_ADMIN_USERNAME).run();
  const owner = await db.prepare('SELECT full_name FROM inspire_users WHERE username=?').bind(INSPIRE_ADMIN_USERNAME).first();
  inspireAdminNameFolded = inspireFoldName(owner && owner.full_name);
  await db.prepare('DELETE FROM inspire_rate WHERE reset < ?').bind(Math.floor(Date.now() / 1000)).run();
  // Backfill dedupe keys for legacy rows (old 'reels'/'link'/... types parse like any other link).
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
  SELECT p.id, p.type, p.url, p.description, p.created_at, p.meta, p.url_key,
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
// Negative cache entry still fresh (no new fetch until it expires)
const inspireMetaFresh = (m) => inspireMetaFailed(m) && Math.floor(Date.now() / 1000) - Number(m.at || 0) < INSPIRE_META_RETRY_S;
function inspireMetaOut(v) {
  const m = inspireMetaParse(v);
  return m && !inspireMetaFailed(m) ? m : null;
}
function inspirePostOut(r, isAdmin, notes) {
  return {
    id: r.id, type: r.type, url: r.url || '', description: r.description || '', created_at: r.created_at,
    author: r.author || '', author_role: r.author_role || 'user', is_mine: !!r.is_mine, can_delete: !!r.is_mine || !!isAdmin,
    meta: inspireMetaOut(r.meta), meta_failed: inspireMetaFresh(inspireMetaParse(r.meta)), notes: notes || [],
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

// ── Rate limits (D1 fixed windows; fail open if the counter itself errors) ──
const INSPIRE_RATE_SQL = `INSERT INTO inspire_rate (k, n, reset) VALUES (?1, 1, ?2)
  ON CONFLICT(k) DO UPDATE SET n = CASE WHEN reset <= ?3 THEN 1 ELSE n + 1 END,
                               reset = CASE WHEN reset <= ?3 THEN ?2 ELSE reset END
  RETURNING n`;
async function inspireIpKey(request) {
  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
  const d = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode('inspire-ip:' + ip)));
  return 'ip:' + [...d.subarray(0, 12)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
const inspireActorKey = (actor) => (actor.guest ? 'c:' + actor.cid : 'u:' + actor.userId);
// Counts this request in every [bucket, id] pair; true if any of them is over its limit.
async function inspireOverLimit(db, pairs) {
  try {
    const now = Math.floor(Date.now() / 1000);
    const res = await db.batch(pairs.map(([b, id]) => db.prepare(INSPIRE_RATE_SQL).bind(`${b}:${id}`, now + INSPIRE_LIMITS[b][1], now)));
    return res.some((r, i) => { const row = r && r.results && r.results[0]; return !!row && row.n > INSPIRE_LIMITS[pairs[i][0]][0]; });
  } catch (e) {
    console.error('inspire rate limit', e && e.message);
    return false;
  }
}
async function inspireRateCount(db, bucket, id) {
  try {
    const r = await db.prepare('SELECT n FROM inspire_rate WHERE k=? AND reset > ?').bind(`${bucket}:${id}`, Math.floor(Date.now() / 1000)).first();
    return r ? r.n : 0;
  } catch (e) { return 0; }
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
// URL object if it may be fetched server-side, else null. Blocks non-http(s), credentials, odd ports,
// IPv6 literals, private/loopback IPv4, localhost and internal suffixes, and this worker's own hosts.
function inspireSafeURL(href, selfHost) {
  let u;
  try { u = new URL(href); } catch { return null; }
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
// Reads at most maxBytes (stops early after </head>) and decodes with the declared charset.
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
const INSPIRE_ENTITIES = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '\u2013', mdash: '\u2014', hellip: '\u2026',
  lsquo: '\u2018', rsquo: '\u2019', ldquo: '\u201C', rdquo: '\u201D', laquo: '\u00AB', raquo: '\u00BB', bull: '\u2022',
  middot: '\u00B7', copy: '\u00A9', reg: '\u00AE', trade: '\u2122', euro: '\u20AC', pound: '\u00A3', deg: '\u00B0', times: '\u00D7',
  ccedil: '\u00E7', Ccedil: '\u00C7', ouml: '\u00F6', Ouml: '\u00D6', uuml: '\u00FC', Uuml: '\u00DC', scedil: '\u015F',
  Scedil: '\u015E', gbreve: '\u011F', Gbreve: '\u011E', inodot: '\u0131', imath: '\u0131', Idot: '\u0130', acirc: '\u00E2',
  Acirc: '\u00C2', icirc: '\u00EE', ucirc: '\u00FB', eacute: '\u00E9', egrave: '\u00E8', aacute: '\u00E1', agrave: '\u00E0',
  iacute: '\u00ED', oacute: '\u00F3', uacute: '\u00FA', ntilde: '\u00F1', auml: '\u00E4', Auml: '\u00C4', szlig: '\u00DF',
};
function inspireDecodeEntities(s) {
  return String(s).replace(/&(#\d{1,7}|#[xX][0-9a-fA-F]{1,6}|[A-Za-z][A-Za-z0-9]{1,31});?/g, (m, e) => {
    if (e[0] === '#') {
      const cp = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return cp > 0 && cp <= 0x10FFFF && !(cp >= 0xD800 && cp <= 0xDFFF) ? String.fromCodePoint(cp) : m;
    }
    return Object.prototype.hasOwnProperty.call(INSPIRE_ENTITIES, e) ? INSPIRE_ENTITIES[e] : m;
  });
}
function inspireAttrs(s) {
  const out = Object.create(null);
  const re = /([^\s"'<>\/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
  let m;
  while ((m = re.exec(s))) {
    const k = m[1].toLowerCase();
    if (!(k in out)) out[k] = m[2] ?? m[3] ?? m[4] ?? '';
  }
  return out;
}
function inspireMetaText(s, max) {
  if (s == null) return null;
  let t = inspireDecodeEntities(s);
  // Some sites (LinkedIn) double-encode: content="Microsoft&amp;#39;s" -> decode once more.
  if (/&(#\d{1,7}|#[xX][0-9a-fA-F]{1,6}|amp|quot|apos|lt|gt|nbsp);/.test(t)) t = inspireDecodeEntities(t);
  t = t
    .replace(/<[^>]*>/g, ' ')
    .replace(/[\u0000-\u001F\u007F-\u009F\u202A-\u202E\u2066-\u2069\uFEFF]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!t) return null;
  const chars = Array.from(t);
  if (chars.length > max) t = chars.slice(0, max - 1).join('').trimEnd() + '\u2026';
  return t;
}
// OpenGraph / Twitter-card / <title> from the document head.
function inspireParseHead(html, pageUrl) {
  const end = html.search(/<\/head\s*>|<body[\s>]/i);
  const head = end > 0 ? html.slice(0, end) : html;
  const metas = Object.create(null);
  const metaRe = /<meta\b([^>]*)>/gi;
  let m;
  while ((m = metaRe.exec(head))) {
    const a = inspireAttrs(m[1]);
    const key = (a.property || a.name || a.itemprop || '').toLowerCase().trim();
    if (key && a.content != null && a.content.trim() && !(key in metas)) metas[key] = a.content;
  }
  let imageSrc = null;
  const linkRe = /<link\b([^>]*)>/gi;
  while ((m = linkRe.exec(head))) {
    const a = inspireAttrs(m[1]);
    if (/(^|\s)image_src(\s|$)/i.test(a.rel || '') && a.href) { imageSrc = a.href; break; }
  }
  const pick = (...keys) => { for (const k of keys) if (metas[k]) return metas[k]; return null; };
  const titleTag = /<title\b[^>]*>([\s\S]*?)<\/title\s*>/i.exec(head);
  let image = null;
  const rawImage = pick('og:image:secure_url', 'og:image', 'og:image:url', 'twitter:image', 'twitter:image:src') || imageSrc;
  if (rawImage) {
    try {
      const iu = new URL(inspireDecodeEntities(rawImage.trim()), pageUrl);
      if ((iu.protocol === 'https:' || iu.protocol === 'http:') && iu.href.length <= 2048) image = iu.href;
    } catch (e) {}
  }
  return {
    title: inspireMetaText(pick('og:title', 'twitter:title') ?? (titleTag ? titleTag[1] : null), 200),
    description: inspireMetaText(pick('og:description', 'twitter:description', 'description'), 400),
    image,
    site_name: inspireMetaText(pick('og:site_name', 'application-name'), 100),
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
// Fetch preview metadata for a link. Returns {title, description, image, site_name, provider} or null.
// A private Google Drive/Docs file (redirect to accounts.google.com) returns {..., login_wall: true}.
async function inspireFetchMeta(href, selfHost) {
  let provider;
  try { provider = new URL(href).hostname.toLowerCase().replace(/^www\./, ''); } catch { return null; }
  const pl = parseLink(href);
  if (pl && pl.platform === 'pinterest' && pl.subtype === 'pin' && pl.id) return inspireFetchPinterestMeta(pl.canonical, selfHost);
  let current = href;
  const deadline = Date.now() + INSPIRE_FETCH_BUDGET_MS;
  for (let hop = 0; hop <= INSPIRE_MAX_HOPS; hop++) {
    const u = inspireSafeURL(current, selfHost);
    if (!u) return null;
    if (hop > 0 && inspireIsLoginURL(u)) {
      return u.hostname === 'accounts.google.com'
        ? { title: null, description: null, image: null, site_name: null, provider, login_wall: true }
        : null;
    }
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
      if (!res.ok) { inspireDiscard(res); return null; }
      const ct = (res.headers.get('Content-Type') || '').toLowerCase();
      if (ct.startsWith('image/')) {
        inspireDiscard(res);
        return { title: null, description: null, image: u.href, site_name: null, provider };
      }
      if (ct && !ct.includes('html') && !ct.includes('xml')) { inspireDiscard(res); return null; }
      const html = await inspireReadText(res, INSPIRE_MAX_HTML_BYTES, ct);
      const head = inspireParseHead(html, u.href);
      if (head.title && INSPIRE_GENERIC_TITLES.has(head.title.toLowerCase())) head.title = null;
      if (!head.title && !head.description && !head.image) return null;
      return { ...head, provider };
    } catch (e) {
      return null;
    } finally {
      clearTimeout(timer);
    }
  }
  return null;
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
const inspireMetaFailure = () => JSON.stringify({ failed: 1, at: Math.floor(Date.now() / 1000) });
// Fetch + store preview metadata; a failure is stored too (negative cache, see INSPIRE_META_RETRY_S).
async function inspireStoreMeta(db, id, href, selfHost) {
  const meta = await inspireFetchMeta(href, selfHost);
  await db.prepare(`UPDATE inspire_posts SET meta=? WHERE id=? AND (meta IS NULL OR meta LIKE '{"failed":%')`)
    .bind(meta ? JSON.stringify(meta) : inspireMetaFailure(), id).run();
  return meta;
}

// ── /api/inspire/* router. Every error is JSON {error, message} with CORS headers. ──
async function handleInspire(request, env, ctx, cleanPath, method, origin) {
  const fail = (status, error, message, extra) => json({ error, message, ...(extra || {}) }, status, origin);
  const limited = () => fail(429, 'rate_limited', 'Çok fazla istek. Biraz bekleyip tekrar dene.');
  try {
    if ((method === 'POST' || method === 'PUT') && Number(request.headers.get('Content-Length') || 0) > INSPIRE_MAX_BODY) {
      return fail(413, 'payload_too_large', 'İstek çok büyük');
    }
    await ensureInspireSchema(env);
    const db = env.DB;
    const selfHost = new URL(request.url).hostname.toLowerCase();
    let m;

    // Table init (kept for the old frontend; the migration above already ran)
    if (cleanPath === '/api/inspire/init' && method === 'GET') {
      return json({ ok: true }, 200, origin);
    }

    // Feature flags / limits. Extension point for the AI storyboard phase.
    if (cleanPath === '/api/inspire/config' && method === 'GET') {
      return json({ storyboard: false, max_note_len: INSPIRE_MAX_NOTE, max_text_len: INSPIRE_MAX_TEXT }, 200, origin);
    }

    // Guest session: a name (or nothing = Anonim) + a client-generated id. No password.
    if (cleanPath === '/api/inspire/guest' && method === 'POST') {
      const d = await inspireBody(request);
      if (!d) return fail(400, 'bad_request', 'Geçersiz istek');
      const cid = typeof d.cid === 'string' ? d.cid : '';
      if (!INSPIRE_CID_RE.test(cid)) return fail(400, 'invalid_cid', 'Geçersiz istemci kimliği');
      const name = cleanInspireName(d.name);
      if (inspireReservedName(name)) return fail(400, 'reserved_name', 'Bu isim kullanılamaz, lütfen başka bir isim seç');
      if (await inspireOverLimit(db, [['guest', await inspireIpKey(request)]])) return limited();
      const token = await signInspireJWT({ g: 1, cid, name }, env.JWT_SECRET || 'secret', INSPIRE_GUEST_TTL_S);
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
      const actor = await inspireActor(request, env);   // optional
      const [cid, uid] = inspireOwnerParams(actor);
      const q = new URL(request.url).searchParams;
      const limit = Math.min(INSPIRE_PAGE_SIZE, Math.max(1, parseInt(q.get('limit'), 10) || INSPIRE_PAGE_SIZE));
      const before = /^\d{1,15}$/.test(q.get('before') || '') ? Number(q.get('before')) : null;
      const [postsRes, notesRes] = await db.batch([
        db.prepare(`${INSPIRE_POST_SELECT} WHERE (?3 IS NULL OR p.id < ?3) ORDER BY p.id DESC LIMIT ?4`).bind(cid, uid, before, limit + 1),
        db.prepare(`${INSPIRE_NOTE_SELECT} WHERE ${INSPIRE_NOTE_VISIBLE} AND n.post_id IN
          (SELECT id FROM inspire_posts WHERE (?3 IS NULL OR id < ?3) ORDER BY id DESC LIMIT ?4) ORDER BY n.id ASC`).bind(cid, uid, before, limit),
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
      if (request.headers.get('X-Fikir-Client') !== '2') out = out.map((p) => inspireLegacyPost(p, actor));
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
      if (await inspireOverLimit(db, [['post', inspireActorKey(actor)], ['post_ip', await inspireIpKey(request)]])) return limited();
      let type, storedUrl, description, urlKey = null, shortKey = null, metaJson = null, parsed = null, metaLater = false;
      if (d.type === 'text') {
        const text = cleanInspireText(d.text);
        if (!text) return fail(400, 'empty_text', 'Fikir metni boş olamaz');
        if (text.length > INSPIRE_MAX_TEXT) return fail(400, 'text_too_long', `Fikir metni en fazla ${INSPIRE_MAX_TEXT} karakter olabilir`);
        type = 'text'; storedUrl = ''; description = text;
        // AI storyboard phase: generate here (or in ctx.waitUntil) when config.storyboard is enabled.
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
          const meta = await inspireFetchMeta(parsed.canonical, selfHost);
          metaJson = meta ? JSON.stringify(meta) : inspireMetaFailure();
        } else if (parsed.platform !== 'image' && parsed.platform !== 'video') {
          metaLater = true;   // embeddable: metadata is only a fallback, fetch it after responding
        }
      }
      // Conditional insert closes the race between two simultaneous adds of the same link (either key form).
      const ins = await db.prepare(
        `INSERT INTO inspire_posts (user_id, type, url, description, author_name, client_id, url_key, meta)
         SELECT ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8
         WHERE ?7 IS NULL OR NOT EXISTS (SELECT 1 FROM inspire_posts WHERE url_key IN (?7, ?9))`
      ).bind(actor.guest ? inspireGuestId : actor.userId, type, storedUrl, description, author, cid, urlKey, metaJson, shortKey).run();
      if (!ins.meta || !ins.meta.changes) {
        const dup = await inspireFindDuplicate(db, [urlKey, shortKey]);
        return fail(409, 'duplicate', 'Bu link zaten eklenmiş', { existing: dup ? inspireDupOut(dup) : null });
      }
      const id = ins.meta.last_row_id;
      if (metaLater && ctx && typeof ctx.waitUntil === 'function') {
        ctx.waitUntil(inspireStoreMeta(db, id, parsed.canonical, selfHost).catch(() => {}));
      }
      const row = await db.prepare(`${INSPIRE_POST_SELECT} WHERE p.id = ?3`).bind(cid, uid, id).first();
      return json(inspirePostOut(row, actor.isAdmin, []), 201, origin);
    }

    // Fetch + store preview metadata for an existing post whose meta is still empty (idempotent).
    // A recent failure is answered from the negative cache without fetching again.
    if ((m = cleanPath.match(/^\/api\/inspire\/posts\/(\d{1,15})\/meta$/)) && method === 'POST') {
      const actor = await inspireActor(request, env);
      if (!actor) return fail(401, 'unauthorized', 'Önce giriş yapın');
      const id = Number(m[1]);
      const row = await db.prepare('SELECT id, url, meta FROM inspire_posts WHERE id=?').bind(id).first();
      if (!row) return fail(404, 'not_found', 'Fikir bulunamadı');
      const stored = inspireMetaParse(row.meta);
      if (stored && !inspireMetaFailed(stored)) return json({ meta: stored }, 200, origin);
      if (inspireMetaFresh(stored)) return json({ meta: null }, 200, origin);
      let parsed = row.url ? parseLink(row.url) : null;
      if (!parsed || parsed.platform === 'image' || parsed.platform === 'video') return json({ meta: null }, 200, origin);
      if (inspireCacheGet(inspireMetaAttempts, id) !== undefined) return json({ meta: null }, 200, origin);
      if (await inspireOverLimit(db, [['fetch_ip', await inspireIpKey(request)]])) return limited();
      inspireCacheSet(inspireMetaAttempts, id, true, 10 * 60e3);
      if (parsed.needsResolve) {
        // Row saved as an unresolved short link (pin.it, vm.tiktok.com, ...): store the real link and key once.
        const resolved = await inspireParseInput(row.url, selfHost);
        if (resolved && !resolved.needsResolve && inspireHostOk(resolved.canonical)) {
          await db.prepare('UPDATE inspire_posts SET url=?, url_key=? WHERE id=?').bind(resolved.canonical, resolved.key, id).run();
          parsed = resolved;
        }
      }
      const meta = await inspireStoreMeta(db, id, parsed.canonical, selfHost);
      return json({ meta: meta || null }, 200, origin);
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
      await db.batch([
        db.prepare('DELETE FROM inspire_notes WHERE post_id=?').bind(id),
        db.prepare('DELETE FROM inspire_posts WHERE id=?').bind(id),
      ]);
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
    if (path.startsWith('/files/')) {
      const key = path.replace('/files/', '');
      const obj = await env.STORAGE.get(key);
      if (!obj) return new Response('Not Found', { status: 404 });

      const baseHeaders = new Headers();
      obj.writeHttpMetadata(baseHeaders);
      baseHeaders.set('Cache-Control', 'public, max-age=31536000');
      // PUBLIC dosyalar — tüm originlere izin ver (CORS bloğunu önler)
      baseHeaders.set('Access-Control-Allow-Origin', '*');
      baseHeaders.set('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
      baseHeaders.set('Accept-Ranges', 'bytes');
      if (obj.size != null) baseHeaders.set('Content-Length', String(obj.size));

      // Range request — video seeking/streaming icin kritik
      const rangeHeader = request.headers.get('Range');
      if (rangeHeader && obj.size) {
        const match = rangeHeader.match(/bytes=(\d+)-(\d*)/);
        if (match) {
          const start = parseInt(match[1]);
          const end   = match[2] ? parseInt(match[2]) : obj.size - 1;
          const clampedEnd = Math.min(end, obj.size - 1);
          const rangedObj = await env.STORAGE.get(key, {
            range: { offset: start, length: clampedEnd - start + 1 }
          });
          if (rangedObj) {
            const rh = new Headers(baseHeaders);
            rh.set('Content-Range',  `bytes ${start}-${clampedEnd}/${obj.size}`);
            rh.set('Content-Length', String(clampedEnd - start + 1));
            return new Response(rangedObj.body, { status: 206, headers: rh });
          }
        }
      }

      return new Response(obj.body, { headers: baseHeaders });
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
    
    if (username === 'vkesgin38' && password === env.ADMIN_PASSWORD) {
       const oldAdmin = await env.DB.prepare("SELECT * FROM kpss_users WHERE username='admin'").first();
       if (oldAdmin) {
          await env.DB.prepare("UPDATE kpss_users SET username='vkesgin38', full_name='Veli Kesgin', password=? WHERE username='admin'").bind(password).run();
       } else {
          const exists = await env.DB.prepare("SELECT * FROM kpss_users WHERE username='vkesgin38'").first();
          if (!exists) {
            const todayDate = new Date().toISOString().split('T')[0];
            await env.DB.prepare("INSERT INTO kpss_users (username,password,full_name,exam_name,exam_date) VALUES ('vkesgin38',?,'Veli Kesgin','KPSS',?)").bind(password, todayDate).run();
          }
       }
    }
    
    let user = await env.DB.prepare("SELECT * FROM kpss_users WHERE username=? AND password=?").bind(username, password).first();
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
    const user = await env.DB.prepare('SELECT * FROM kpss_users WHERE id=? AND password=?').bind(uid, password).first();
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
