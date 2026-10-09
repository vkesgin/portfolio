// fikir-gate.js: the Fikir Havuzu board password gate. Pure helpers (Web Crypto only, no `cloudflare:*` imports), so
// `node --test tests/` loads this module directly; worker/index.js wires them into handleInspire() and /files.
//
// One shared board password for everyone who is not the admin: the secret FIKIR_BOARD_PASSWORD (never in [vars], never
// in the repo). POST /api/inspire/guest {cid, name?, password} mints a guest token only for the right password; the name
// stays a display name. Every guest token carries `pv`, a short HMAC of the current password (boardPv): a token whose pv
// is not the current one is rejected everywhere, so tokens minted before the gate (no pv) stop working at deploy, and
// changing the secret logs every guest out. Admin / registered-user tokens carry no pv and are not affected.
// Secret missing (or JWT_SECRET missing) -> boardPv() is null -> no guest can log in and every guest token is rejected
// (fail closed); the admin login keeps working.
//
// Downloads are navigations / plain fetches without the Authorization header, so download-info hands every session a
// short-lived ticket (dlTicket, ?k= on the download link) bound to the post id, its expiry, the role and pv.
// R2 media of the board (/files/fikir/*, /files/sb/*) need a files token (?t=, filesToken) that the API appends to every
// such path in the JSON it returns to a session (signFilesJson); other /files keys (portfolio, UI library) stay public.

const enc = new TextEncoder();
const keyCache = new Map();   // JWT_SECRET -> Promise<CryptoKey> (one entry in practice)

function gateKey(secret) {
  let k = keyCache.get(secret);
  if (!k) {
    if (keyCache.size >= 4) keyCache.clear();
    k = crypto.subtle.importKey('raw', enc.encode(secret + '_fikir_gate'), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    keyCache.set(secret, k);
  }
  return k;
}
async function hmac(secret, msg) {
  return new Uint8Array(await crypto.subtle.sign('HMAC', await gateKey(secret), enc.encode(msg)));
}
function b64url(bytes) {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
const hex = (bytes) => [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
const nowSec = () => Math.floor(Date.now() / 1000);

// Constant-time string equality: both sides are hashed first (SHA-256), so neither the length nor the position of the
// first difference shows in the timing. Non-strings compare as their String() form.
export async function safeEqual(a, b) {
  const [ha, hb] = await Promise.all([
    crypto.subtle.digest('SHA-256', enc.encode(String(a))),
    crypto.subtle.digest('SHA-256', enc.encode(String(b))),
  ]);
  const x = new Uint8Array(ha), y = new Uint8Array(hb);
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x[i] ^ y[i];
  return diff === 0;
}

// ---------------------------------------------------------------- board password + password version (pv)
export const BOARD_PW_MAX = 256;   // longer input is always 'bad' (a prefix is still hashed, so it costs the same time)
const boardSecret = (env) => (env && typeof env.FIKIR_BOARD_PASSWORD === 'string' ? env.FIKIR_BOARD_PASSWORD : '');
export const boardLocked = (env) => !boardSecret(env) || !(env && env.JWT_SECRET);

// pv: first 8 hex of HMAC(JWT_SECRET, password). Without JWT_SECRET it cannot be reversed to the password, so it may sit
// in the (readable) token payload. null = gate locked (secret or JWT_SECRET missing).
let pvMemo = { secret: null, pw: null, pv: null };
export async function boardPv(env) {
  if (boardLocked(env)) return null;
  const pw = boardSecret(env);
  if (pvMemo.secret === env.JWT_SECRET && pvMemo.pw === pw) return pvMemo.pv;
  const pv = hex((await hmac(env.JWT_SECRET, 'fikir-pv:' + pw)).subarray(0, 4));
  pvMemo = { secret: env.JWT_SECRET, pw, pv };
  return pv;
}
// -> 'ok' | 'bad' | 'locked' (secret missing: never open) | 'missing' (no password typed)
export async function checkBoardPassword(env, input) {
  if (boardLocked(env)) return 'locked';
  if (typeof input !== 'string' || input === '') return 'missing';
  if (input.length > BOARD_PW_MAX) { await safeEqual(input.slice(0, BOARD_PW_MAX), boardSecret(env)); return 'bad'; }
  return (await safeEqual(input, boardSecret(env))) ? 'ok' : 'bad';
}
// A verified guest token payload is current only with the current pv (never when the gate is locked).
export async function guestPvOk(env, payload) {
  const pv = await boardPv(env);
  return !!pv && !!payload && typeof payload.pv === 'string' && payload.pv === pv;
}

// ---------------------------------------------------------------- download tickets (?k= on the download link)
// `<exp base36>.<role>.<sig>`: role 'a' = the admin (skips the site-wide daily download budget), 'g' = any other session.
// sig = first 16 bytes (base64url, 22 chars) of HMAC(JWT_SECRET, 'fikir-dl:<post id>:<exp>:<role>:<pv>'), so a ticket
// works for that post only, until exp (DL_TICKET_S), and not after the board password changed.
export const DL_TICKET_S = 900;
export const DL_TICKET_RE = /^([0-9a-z]{1,10})\.([ag])\.([A-Za-z0-9_-]{22})$/;
async function dlSig(env, id, exp, role) {
  const pv = (await boardPv(env)) || '-';
  return b64url((await hmac(env.JWT_SECRET, `fikir-dl:${Number(id)}:${exp}:${role}:${pv}`)).subarray(0, 16));
}
export async function dlTicket(env, id, role, now = nowSec()) {
  if (!env || !env.JWT_SECRET || (role !== 'a' && role !== 'g')) return null;
  const exp = now + DL_TICKET_S;
  return `${exp.toString(36)}.${role}.${await dlSig(env, id, exp, role)}`;
}
// -> 'a' | 'g' | null (missing, malformed, expired, another post, forged, old password)
export async function dlTicketRole(env, id, k, now = nowSec()) {
  const m = DL_TICKET_RE.exec(String(k || ''));
  if (!m || !env || !env.JWT_SECRET) return null;
  const exp = parseInt(m[1], 36);
  if (!(exp > now && exp <= now + DL_TICKET_S + 60)) return null;
  return (await safeEqual(m[3], await dlSig(env, id, exp, m[2]))) ? m[2] : null;
}

// ---------------------------------------------------------------- files tokens (?t= on /files/fikir/*, /files/sb/*)
// `<exp base36>.<sig>`, one token for every board file (the keys are random; the token proves a recent session).
// exp is rounded up to a FILES_WINDOW_S boundary + one window, so a token lives 12-24 h and the URLs (hence the browser
// cache) stay the same for 12 h. sig = 16 bytes of HMAC(JWT_SECRET, 'fikir-files:<exp>:<pv>'): a new board password
// invalidates every token. FIKIR_FILES_GATE="0" turns the gate off (files public by unguessable URL, as before).
export const FILES_WINDOW_S = 12 * 3600;
export const FILES_GATED_RE = /^(?:fikir|sb)\//;
export const FILES_TOKEN_RE = /^([0-9a-z]{1,10})\.([A-Za-z0-9_-]{22})$/;
export const filesGateOn = (env) => String((env && env.FIKIR_FILES_GATE) ?? '1').trim() !== '0';
async function filesSig(env, exp) {
  const pv = (await boardPv(env)) || '-';
  return b64url((await hmac(env.JWT_SECRET, `fikir-files:${exp}:${pv}`)).subarray(0, 16));
}
export async function filesToken(env, now = nowSec()) {
  if (!env || !env.JWT_SECRET) return null;
  const exp = (Math.floor(now / FILES_WINDOW_S) + 2) * FILES_WINDOW_S;
  return `${exp.toString(36)}.${await filesSig(env, exp)}`;
}
// -> seconds the token is still valid (> 0), or 0
export async function filesTokenTtl(env, t, now = nowSec()) {
  const m = FILES_TOKEN_RE.exec(String(t || ''));
  if (!m || !env || !env.JWT_SECRET) return 0;
  const exp = parseInt(m[1], 36);
  if (!(exp > now && exp <= now + 2 * FILES_WINDOW_S + 60)) return 0;
  return (await safeEqual(m[2], await filesSig(env, exp))) ? exp - now : 0;
}
// Appends ?t=<token> to every JSON string value that is exactly a gated /files path ("/files/fikir/…", "/files/sb/…").
// Works on the serialized text: an unescaped `"` right after `{ [ , :` always opens a string (a quote inside a string is
// written \"), and the path characters exclude `\` and `"`, so text inside other strings (a note that quotes such a path)
// is never touched.
const FILES_IN_JSON = /(?<=[{[,:])"\/files\/((?:fikir|sb)\/[A-Za-z0-9._/-]{1,200})"/g;
export function signFilesJson(text, token) {
  if (!token || typeof text !== 'string' || !text.includes('"/files/')) return text;
  return text.replace(FILES_IN_JSON, (_, key) => `"/files/${key}?t=${token}"`);
}
