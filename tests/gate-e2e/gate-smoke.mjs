// gate-smoke.mjs: the board password gate end to end against a local `wrangler dev` with worker/wrangler.toml (see
// run-smoke.sh): every /api/inspire/* route from the router source (tests/gate-routes.mjs) without a session, with a
// stale (pre-gate), wrong-pv, expired or foreign token, and with valid guest / admin sessions; POST /guest (password,
// lockout per IP and per IPv6 /48, fail-closed limiter), registered users (live account + expiring token), /guest/rename, download tickets, /files (board files need ?t=, portfolio files public), YouTube
// downloads (422, never the thumbnail), projects / KPSS untouched. Nothing leaves the machine (no link previews).
// Reads ADMIN_PASSWORD, JWT_SECRET (to forge stale tokens) and FIKIR_BOARD_PASSWORD from worker/.dev.vars (TEST values;
// the board password falls back to FIKIR_E2E_BOARD_PASSWORD / 'test-board-pass') and never prints them.
// usage: node tests/gate-e2e/gate-smoke.mjs <base=http://127.0.0.1:8799>   env: GATE_E2E_STATE (--persist-to dir)
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { inspireRoutes, isOpen, isDownload, fill } from '../gate-routes.mjs';

const BASE = process.argv[2] || 'http://127.0.0.1:8799';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const WORKER = path.join(HERE, '../../worker');
const STATE = process.env.GATE_E2E_STATE;
const CONFIG = 'wrangler.toml', DB = 'vk-portfolio', BUCKET = 'vk-portfolio-files';
if (!/^http:\/\/127\.0\.0\.1:\d+$/.test(BASE)) throw new Error('local worker only');
if (!STATE) throw new Error('GATE_E2E_STATE is required (the --persist-to dir of the local worker)');
const devVars = Object.fromEntries(fs.readFileSync(path.join(WORKER, '.dev.vars'), 'utf8').split('\n').filter((l) => l.includes('='))
  .map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]));
const BOARD_PW = process.env.FIKIR_E2E_BOARD_PASSWORD || devVars.FIKIR_BOARD_PASSWORD || 'test-board-pass';
let n = 0;
const ok = (msg) => console.log(`ok ${++n} ${msg}`);
const newCid = () => 'g' + Math.random().toString(36).slice(2) + Date.now().toString(36) + 'xxxxxxxx';
const nowS = () => Math.floor(Date.now() / 1000);

async function fetchOnce(url, init) {
  try { return await fetch(url, init); }
  catch (e) {
    const code = e && e.cause && e.cause.code;
    if (!['UND_ERR_SOCKET', 'ECONNRESET', 'EPIPE'].includes(code)) throw e;
    return fetch(url, init);
  }
}
async function call(method, p, body, token, { headers = {}, legacy = false, ip = null, raw = null } = {}) {
  const h = { ...(legacy ? {} : { 'X-Fikir-Client': '2' }), ...headers };
  if (ip) h['CF-Connecting-IP'] = ip;
  if (body != null && !raw) h['Content-Type'] = 'application/json';
  if (token) h.Authorization = 'Bearer ' + token;
  const res = await fetchOnce(BASE + p, { method, headers: h, body: raw || (body == null ? undefined : JSON.stringify(body)) });
  const buf = Buffer.from(await res.arrayBuffer());
  let data = null; try { data = JSON.parse(buf.toString('utf8')); } catch (_) { data = buf.toString('utf8'); }
  return { status: res.status, data, headers: res.headers, buf };
}
const wr = (args) => execFileSync('npx', ['-y', 'wrangler@4', ...args, '--local', '-c', CONFIG, '--persist-to', STATE], { cwd: WORKER, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
function d1(sql) {
  const out = wr(['d1', 'execute', DB, '--json', '--command', sql]);
  return JSON.parse(out.slice(out.indexOf('[')))[0].results;
}
function r2put(key, file) { wr(['r2', 'object', 'put', `${BUCKET}/${key}`, '--file', file]); }
const q = (v) => (v == null ? 'NULL' : `'${String(v).replace(/'/g, "''")}'`);
const b64u = (v) => Buffer.from(v).toString('base64url');
async function signInspire(payload, secret) {
  const header = b64u(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = b64u(JSON.stringify(payload));
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret + '_inspire'), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return `${header}.${body}.${b64u(new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${header}.${body}`))))}`;
}

// ── open routes + POST /guest ──
let r = await call('GET', '/api/inspire/config');
assert.equal(r.status, 200); assert.equal(r.data.gate, true); assert.equal(r.data.locked, false); assert.equal(r.data.session, 'none');
assert.ok(!('posts' in r.data));
ok('GET /config: open, gate flags, no board content');
r = await call('POST', '/api/inspire/guest', { cid: newCid(), name: 'Ayşe' });
assert.equal(r.status, 400); assert.equal(r.data.error, 'password_required');
r = await call('POST', '/api/inspire/guest', { cid: newCid(), name: 'Ayşe', password: BOARD_PW + 'x' }, null, { ip: '198.51.100.70' });
assert.equal(r.status, 401); assert.equal(r.data.error, 'bad_password'); assert.equal(r.data.attempts_left, 7);
const gCid = newCid();
r = await call('POST', '/api/inspire/guest', { cid: gCid, name: 'Ayşe', password: BOARD_PW });
assert.equal(r.status, 200, JSON.stringify(r.data));
const G = r.data.token;
const pv = JSON.parse(Buffer.from(G.split('.')[1], 'base64url')).pv;
assert.match(pv, /^[0-9a-f]{8}$/);
r = await call('POST', '/api/inspire/guest', { cid: newCid(), name: '', password: BOARD_PW });
assert.equal(r.data.user.display_name, 'Anonim');
const ADM = (await call('POST', '/api/inspire/login', { username: 'vkesgin38', password: devVars.ADMIN_PASSWORD })).data.token;
assert.ok(ADM, 'admin login');
ok('POST /guest: password required (400), wrong (401 + attempts left), right (token with pv), anonymous = empty name; admin login as before');

// ── seeds: a link post with an admin upload (R2), a text post with a storyboard frame (R2), a note, a YouTube Short ──
const guestRow = `(SELECT id FROM inspire_users WHERE username='__guest__')`;
const insPost = (type, url, extra = '') => {
  d1(`INSERT INTO inspire_posts (user_id, type, url, description, author_name, client_id, url_key, meta) VALUES (${guestRow}, ${q(type)}, ${q(url)}, ${q(extra)}, 'Sahip', 'gateownercid0000001', ${q('gate:' + type + ':' + Date.now())}, NULL)`);
  return d1(`SELECT id FROM inspire_posts WHERE client_id='gateownercid0000001' ORDER BY id DESC LIMIT 1`)[0].id;
};
const link = insPost('web', 'https://example.com/gate-e2e');
d1(`UPDATE inspire_posts SET meta=${q(JSON.stringify({ v: 2, via: 'plain', title: 'Kapı', provider: 'example.com', checked: nowS() }))} WHERE id=${link}`);
const jpg = fs.readFileSync(path.join(HERE, '../fixtures/media/poster.jpg'));
r = await call('POST', `/api/inspire/posts/${link}/media/upload?part=image`, null, ADM, { headers: { 'Content-Type': 'image/jpeg' }, raw: jpg });
assert.equal(r.status, 201, JSON.stringify(r.data));
const upUrl = r.data.post.media.url;
assert.match(upUrl, new RegExp(`^/files/fikir/${link}/i-[0-9a-f]{32}\\.jpg\\?t=[0-9a-z]+\\.[A-Za-z0-9_-]{22}$`));
const text = insPost('text', '', 'Bir fikir');
const sbId = 'sb_' + 'd'.repeat(32), frameKey = `sb/${sbId}/frame_1.r0.jpg`;
d1(`INSERT INTO sb_storyboards (id, post_id, version, status, stage, input_json, draft_json, title, aspect, seed, day, created_at, updated_at)
  VALUES (${q(sbId)}, ${text}, 1, 'done', 'done', '{"format":"9:16"}', ${q(JSON.stringify({ title: 'T', aspect_ratio: '9:16', scenes: [{ n: 1, title: 'Sahne' }] }))}, 'T', '9:16', 1, '2026-10-09', ${Date.now()}, ${Date.now()})`);
d1(`INSERT INTO sb_images (sb_id, job, kind, n, status, rev, r2_key, updated_at) VALUES (${q(sbId)}, 'frame_1', 'frame', 1, 'done', 0, ${q(frameKey)}, ${Date.now()})`);
r2put(frameKey, path.join(HERE, '../fixtures/media/poster.jpg'));
r2put('images/gatee2e0000001.jpg', path.join(HERE, '../fixtures/media/poster.jpg'));   // a portfolio upload
d1(`INSERT INTO inspire_notes (post_id, user_id, content, is_public, author_name, client_id) VALUES (${link}, ${guestRow}, 'not', 1, 'Sahip', 'gateownercid0000001')`);
const note = d1(`SELECT id FROM inspire_notes WHERE post_id=${link} ORDER BY id DESC LIMIT 1`)[0].id;
const yt = insPost('youtube', 'https://www.youtube.com/shorts/jNQXAC9IVRw');
d1(`CREATE TABLE IF NOT EXISTS projects (id TEXT PRIMARY KEY, title TEXT NOT NULL, category TEXT NOT NULL, description TEXT DEFAULT '', tags TEXT DEFAULT '', year TEXT DEFAULT '',
  image_url TEXT DEFAULT '', video_url TEXT DEFAULT '', thumbnail_url TEXT DEFAULT '', is_featured INTEGER DEFAULT 0, featured_order INTEGER DEFAULT 0, created_at TEXT DEFAULT (datetime('now')))`);
d1(`CREATE TABLE IF NOT EXISTS kpss_users (id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT UNIQUE NOT NULL, password TEXT NOT NULL, full_name TEXT DEFAULT '',
  exam_name TEXT DEFAULT 'KPSS', exam_date TEXT NOT NULL, xp INTEGER DEFAULT 0, created_at TEXT DEFAULT (datetime('now')))`);
const ids = { post: link, note, sb: sbId };
ok(`seeded posts ${JSON.stringify({ link, text, yt, note, sb: sbId })}`);

// ── every route: no session / bad tokens -> 401; valid sessions pass ──
const routes = inspireRoutes();
assert.ok(routes.length >= 30, routes.length + ' routes');
const S = devVars.JWT_SECRET;
const bad = {
  stale: await signInspire({ g: 1, cid: 'gatestalecid0000001', name: 'Eski', iat: nowS() - 86400, exp: nowS() + 86400 }, S),
  wrongPv: await signInspire({ g: 1, cid: 'gatewrongpvcid00001', name: 'W', pv: pv === '00000000' ? '00000001' : '00000000', iat: nowS(), exp: nowS() + 3600 }, S),
  expired: await signInspire({ g: 1, cid: 'gateexpiredcid00001', name: 'X', pv, iat: nowS() - 7200, exp: nowS() - 60 }, S),
  foreign: await signInspire({ g: 1, cid: 'gateforeigncid00001', name: 'Y', pv, iat: nowS(), exp: nowS() + 3600 }, 'not-the-secret'),
};
assert.equal((await call('GET', '/api/inspire/posts', null, await signInspire({ g: 1, cid: 'gateforgedcid000001', name: 'F', pv, iat: nowS(), exp: nowS() + 3600 }, S))).status, 200, 'sanity: forged-right token works');
let gated = 0;
for (const rt of routes) {
  const p = fill(rt.path, ids);
  const none = await call(rt.method, p);
  if (isOpen(rt)) { assert.ok(!(none.status === 401 && none.data && ['unauthorized', 'session_expired'].includes(none.data.error)), `${rt.method} ${rt.path} open`); continue; }
  assert.equal(none.status, 401, `${rt.method} ${rt.path}: ${none.status}`);
  for (const [label, t] of Object.entries(bad)) {
    const x = await call(rt.method, p, null, t);
    assert.equal(x.status, 401, `${rt.method} ${rt.path} ${label}: ${x.status} ${JSON.stringify(x.data).slice(0, 120)}`);
    if (!isDownload(rt)) assert.equal(x.data.error, 'session_expired');
  }
  gated++;
}
ok(`${gated} gated routes: 401 without a session and with stale / wrong-pv / expired / foreign tokens; ${routes.length - gated} open`);
const reads = ['GET /api/inspire/init', 'GET /api/inspire/posts', 'GET /api/inspire/posts/{post}/download-info', 'GET /api/inspire/storyboards/{sb}', 'GET /api/inspire/posts/{post}/download'];
for (const rt of routes) {
  if (isOpen(rt)) continue;
  const x = await call(rt.method, fill(rt.path, ids), null, G);   // guest: not the owner of the seeds
  assert.notEqual(x.status, 401, `guest ${rt.method} ${rt.path}: ${JSON.stringify(x.data).slice(0, 160)}`);
  if (reads.includes(rt.method + ' ' + rt.path)) assert.equal(x.status, 200, `guest ${rt.method} ${rt.path}: ${x.status} ${JSON.stringify(x.data).slice(0, 160)}`);
}
for (const rt of routes.filter((x) => x.method === 'GET' && !isOpen(x))) {
  const x = await call('GET', fill(rt.path, ids), null, ADM);
  assert.equal(x.status, 200, `admin GET ${rt.path}: ${x.status}`);
}
assert.equal((await call('GET', '/api/inspire/sb-admin/usage', null, G)).status, 403);
assert.equal((await call('GET', '/api/inspire/posts', null, G, { legacy: true })).status, 200, 'a current token works for the old page shape too');
assert.equal((await call('GET', '/api/inspire/posts', null, bad.stale, { legacy: true })).status, 401, 'an old cached page with its old token: 401');
ok('valid guest: every gated route passes (reads 200); admin: every GET 200 (sb-admin included); old pages with old tokens 401');

// ── rename, lockout ──
r = await call('POST', '/api/inspire/guest/rename', { name: 'Ayşe K.' }, G);
assert.equal(r.status, 200); const P = JSON.parse(Buffer.from(r.data.token.split('.')[1], 'base64url'));
assert.deepEqual([P.cid, P.pv, P.name], [gCid, pv, 'Ayşe K.']);
assert.equal((await call('POST', '/api/inspire/guest/rename', { name: 'x' }, ADM)).status, 403);
ok('POST /guest/rename: same cid + pv, no password; not for the admin');
const ip = '198.51.100.77';
for (let i = 1; i <= 8; i++) {
  const x = await call('POST', '/api/inspire/guest', { cid: newCid(), name: '', password: 'nope-' + i }, null, { ip });
  assert.equal(x.status, 401, 'attempt ' + i);
}
r = await call('POST', '/api/inspire/guest', { cid: newCid(), name: '', password: BOARD_PW }, null, { ip });
assert.equal(r.status, 429); assert.equal(r.data.error, 'too_many_attempts'); assert.ok(Number(r.headers.get('retry-after')) > 0);
assert.match(r.data.message, /dk sonra tekrar dene/);
assert.equal((await call('POST', '/api/inspire/guest', { cid: newCid(), name: '', password: BOARD_PW }, null, { ip: '198.51.100.78' })).status, 200);
ok('8 wrong passwords per IP -> 429 too_many_attempts with Retry-After (the right password waits too); other IPs unaffected');
{
  // a parallel burst cannot slip under the limit (each attempt is counted before its compare)
  const burst = await Promise.all(Array.from({ length: 20 }, (_, i) => call('POST', '/api/inspire/guest', { cid: newCid(), name: '', password: 'burst-' + i }, null, { ip: '198.51.100.79' })));
  const by = burst.reduce((m, x) => ({ ...m, [x.status]: (m[x.status] || 0) + 1 }), {});
  assert.ok((by[401] || 0) <= 8 && (by[401] || 0) + (by[429] || 0) === 20, JSON.stringify(by));
  // a right password gives its count back: 7 right + 1 wrong on a fresh IP, then the right one still works
  for (let i = 0; i < 7; i++) assert.equal((await call('POST', '/api/inspire/guest', { cid: newCid(), name: '', password: BOARD_PW }, null, { ip: '198.51.100.80' })).status, 200);
  assert.equal((await call('POST', '/api/inspire/guest', { cid: newCid(), name: '', password: 'x' }, null, { ip: '198.51.100.80' })).data.attempts_left, 7);
  ok(`parallel burst of 20 wrong passwords: ${JSON.stringify(by)} (at most 8 compared); right passwords never count`);
}

// ── wrong passwords per network (IPv6 /48, IPv4 /24) and a limiter that cannot count (fails closed) ──
{
  const by = {};
  for (let sub = 1; sub <= 6; sub++) for (let i = 1; i <= 9; i++) {
    const x = await call('POST', '/api/inspire/guest', { cid: newCid(), name: '', password: `net-${sub}-${i}` }, null, { ip: `2001:db8:abcd:${sub}::${i}` });
    by[x.status] = (by[x.status] || 0) + 1;
  }
  assert.deepEqual(by, { 401: 40, 429: 14 }, JSON.stringify(by));
  r = await call('POST', '/api/inspire/guest', { cid: newCid(), name: '', password: BOARD_PW }, null, { ip: '2001:db8:abcd:ff::1' });
  assert.equal(r.status, 429); assert.match(r.data.message, /^Bu ağdan çok fazla hatalı deneme/);
  assert.equal((await call('POST', '/api/inspire/guest', { cid: newCid(), name: '', password: BOARD_PW }, null, { ip: '2001:db8:abce:1::1' })).status, 200);
  ok(`one IPv6 /48 shares 40 wrong passwords / 15 min across its /64s: ${JSON.stringify(by)}; another /48 unaffected`);
}
d1("CREATE TRIGGER gate_smoke_fail BEFORE INSERT ON inspire_rate WHEN NEW.k LIKE 'board_pw%' BEGIN SELECT RAISE(ABORT, 'overloaded'); END");
try {
  for (const password of [BOARD_PW, 'wrong']) {
    r = await call('POST', '/api/inspire/guest', { cid: newCid(), name: '', password }, null, { ip: '198.51.100.140' });
    assert.equal(r.status, 503, JSON.stringify(r.data)); assert.equal(r.data.error, 'login_unavailable'); assert.equal(r.headers.get('retry-after'), '30');
  }
  assert.equal((await call('GET', '/api/inspire/posts', null, G)).status, 200, 'the rest of the board unaffected');
} finally { d1('DROP TRIGGER gate_smoke_fail'); }
assert.equal((await call('POST', '/api/inspire/guest', { cid: newCid(), name: '', password: BOARD_PW }, null, { ip: '198.51.100.140' })).status, 200);
ok('the board password limiter fails closed: counter error -> 503 login_unavailable (right or wrong password, nothing compared)');

// ── registered (non-admin) users: a live account and an expiring token only ──
{
  d1("INSERT OR IGNORE INTO inspire_users (username, password, full_name, is_first_login) VALUES ('gate-smoke-user', 'gate-smoke-user-pass', 'Kayıtlı', 0)");
  const uid = d1("SELECT id FROM inspire_users WHERE username='gate-smoke-user'")[0].id;
  const legacySign = async (payload) => {   // d9456ea-era signInspireJWT: standard base64, iat in ms, no exp
    const h = btoa(JSON.stringify({ alg: 'HS256', typ: 'JWT' })), b = btoa(JSON.stringify(payload));
    const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(S + '_inspire'), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    return `${h}.${b}.${btoa(String.fromCharCode(...new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${h}.${b}`)))))}`;
  };
  const live = await signInspire({ userId: uid, username: 'gate-smoke-user', iat: nowS(), exp: nowS() + 3600 }, S);
  assert.equal((await call('GET', '/api/inspire/posts', null, live)).status, 200);
  for (const t of [await legacySign({ userId: 987654, username: 'deleted-user', iat: Date.now() - 20 * 86400e3 }),
    await legacySign({ userId: uid, username: 'gate-smoke-user', iat: Date.now() }),
    await signInspire({ userId: 987654, username: 'deleted-user', iat: nowS(), exp: nowS() + 3600 }, S)]) {
    assert.equal((await call('GET', '/api/inspire/posts', null, t)).status, 401);
    assert.equal((await call('GET', '/api/inspire/config', null, t)).data.session, 'expired');
    assert.equal((await call('GET', `/api/inspire/posts/${link}/download-info`, null, t)).status, 401);
  }
  d1(`DELETE FROM inspire_users WHERE id=${uid}`);
  assert.equal((await call('GET', '/api/inspire/posts', null, live)).status, 401, 'deleted account');
  assert.equal((await call('GET', '/api/inspire/posts', null, ADM)).status, 200, 'admin unaffected');
  ok('registered users: an expiring token of a live account passes; no-exp (d9456ea-era) tokens, unknown or deleted users -> 401');
}

// ── downloads: tickets ──
const info = await call('GET', `/api/inspire/posts/${link}/download-info`, null, G);
assert.match(info.data.url, new RegExp(`^/api/inspire/posts/${link}/download\\?k=[0-9a-z]+\\.g\\.[A-Za-z0-9_-]{22}$`));
const k = info.data.url.split('?k=')[1];
r = await call('GET', info.data.url, null, null, { headers: { Accept: 'text/html' } });
assert.equal(r.status, 200); assert.equal(r.headers.get('content-type'), 'image/jpeg'); assert.ok(r.buf.equals(jpg));
r = await call('GET', `/api/inspire/posts/${link}/download`, null, null, { headers: { Accept: 'text/html' } });
assert.equal(r.status, 401); assert.match(r.headers.get('content-type'), /^text\/html/);
assert.equal((await call('GET', `/api/inspire/posts/${text}/download?format=json&k=${k}`)).status, 401, "another post's ticket");
ok('download: the ticket of download-info works as a navigation; no ticket / another post -> 401');

// ── /files ──
const board = (await call('GET', '/api/inspire/posts', null, G)).data;
const lp = board.find((p) => p.id === link), tp = board.find((p) => p.id === text);
assert.equal(lp.media.url.split('?')[0], upUrl.split('?')[0]); assert.match(lp.media.url, /\?t=/);
assert.match(tp.storyboard.thumbs[0].path, new RegExp(`^/files/${frameKey}\\?t=`));
r = await call('GET', lp.media.url);
assert.equal(r.status, 200); assert.ok(r.buf.equals(jpg)); assert.match(r.headers.get('cache-control'), /^private, max-age=\d+, immutable$/);
r = await call('GET', lp.media.url, null, null, { headers: { Range: 'bytes=0-9' } });
assert.equal(r.status, 206); assert.equal(r.buf.length, 10);
assert.equal((await call('GET', tp.storyboard.thumbs[0].path)).status, 200);
for (const p of [lp.media.url.split('?')[0], '/files/' + frameKey, lp.media.url.replace(/\?t=.*$/, '?t=0.' + 'A'.repeat(22))]) {
  assert.equal((await call('GET', p)).status, 403, p);
}
r = await call('GET', '/files/images/gatee2e0000001.jpg');
assert.equal(r.status, 200); assert.equal(r.headers.get('cache-control'), 'public, max-age=31536000');
ok('/files: board uploads + storyboard frames only with the files token (200 / 206; 403 without or forged); portfolio files public');

// ── YouTube Shorts ──
const yi = await call('GET', `/api/inspire/posts/${yt}/download-info`, null, G);
assert.deepEqual({ video: yi.data.video, image: yi.data.image, reason: yi.data.reason, unsupported: yi.data.unsupported, message: yi.data.message },
  { video: false, image: true, reason: 'not_supported', unsupported: true, message: 'YouTube videoları siteden indirilemiyor — YouTube buna izin vermiyor.' });
r = await call('GET', yi.data.url + '&format=json');
assert.equal(r.status, 422); assert.equal(r.data.error, 'not_downloadable'); assert.equal(r.data.unsupported, true); assert.equal(r.data.image, true);
r = await call('GET', yi.data.url, null, null, { headers: { Accept: 'text/html' } });
assert.equal(r.status, 422); assert.ok(r.buf.toString().includes('Kapak görselini indir'));
ok('YouTube Shorts: download-info unsupported + message; auto -> 422 (JSON, HTML with the cover link), never the thumbnail');

// ── the rest of the site ──
assert.equal((await call('GET', '/api/projects')).status, 200);
r = await call('POST', '/api/kpss/login', { username: 'vkesgin38', password: devVars.ADMIN_PASSWORD });
assert.equal(r.status, 200, JSON.stringify(r.data));
const pre = await fetchOnce(BASE + '/api/inspire/posts', { method: 'OPTIONS' });
assert.equal(pre.status, 204);
ok('projects, KPSS login and the CORS preflight are not gated');
console.log(`# all ${n} checks passed`);
