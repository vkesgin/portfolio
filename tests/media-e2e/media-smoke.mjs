// media-smoke.mjs: end-to-end checks of the media-preview backend against a local `wrangler dev` (see run-smoke.sh):
// meta v2 extraction, the Browser Run fallback (fake), quotas, legacy refresh, PUT/DELETE /media, uploads + /files,
// /preview, the 64 KB precheck and CORS. Third-party sites are fixture-server.mjs on 127.0.0.1:4742; nothing leaves
// the machine. Reads ADMIN_PASSWORD and FIKIR_BOARD_PASSWORD from worker/.dev.vars (TEST values; the board password falls
// back to FIKIR_E2E_BOARD_PASSWORD / 'test-board-pass') and never prints them.
// usage: node tests/media-e2e/media-smoke.mjs <base=http://127.0.0.1:8821> <mode=main|brquota|brlimit>
//   env: MEDIA_E2E_STATE (wrangler --persist-to dir), MEDIA_E2E_CONFIG (wrangler config), MEDIA_E2E_DB (D1 name)
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const BASE = process.argv[2] || 'http://127.0.0.1:8821';
const MODE = process.argv[3] || 'main';
const FXB = process.env.MEDIA_E2E_FX || 'http://127.0.0.1:4742';   // run-smoke.sh: MEDIA_E2E_FXPORT
const HERE = path.dirname(fileURLToPath(import.meta.url));
const WORKER = path.join(HERE, '../../worker');
const FX = path.join(HERE, '../fixtures/media');
const STATE = process.env.MEDIA_E2E_STATE;
const CONFIG = process.env.MEDIA_E2E_CONFIG || 'wrangler.mediatest.toml';
const DB = process.env.MEDIA_E2E_DB || 'vk-portfolio-mediatest';
if (!/^http:\/\/127\.0\.0\.1:\d+$/.test(BASE)) throw new Error('local worker only');
const devVars = Object.fromEntries(fs.readFileSync(path.join(WORKER, '.dev.vars'), 'utf8').split('\n').filter((l) => l.includes('='))
  .map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]));
const BOARD_PW = process.env.FIKIR_E2E_BOARD_PASSWORD || devVars.FIKIR_BOARD_PASSWORD || 'test-board-pass';
let n = 0;
const ok = (msg) => console.log(`ok ${++n} ${msg}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const newCid = () => 'm' + Math.random().toString(36).slice(2) + Date.now().toString(36) + 'xxxxxxxx';
const fx = (p) => FXB + p;
const nowS = () => Math.floor(Date.now() / 1000);

async function call(method, p, body, token, { legacy = false, headers = {} } = {}) {
  const h = { ...(legacy ? {} : { 'X-Fikir-Client': '2' }), ...headers };
  if (body != null && !(body instanceof Uint8Array)) h['Content-Type'] = 'application/json';
  if (token) h.Authorization = 'Bearer ' + token;
  const init = { method, headers: h, body: body == null ? undefined : body instanceof Uint8Array ? body : JSON.stringify(body) };
  let res;
  // a keep-alive socket that the local dev server closed or reset while idle fails before any response: send once more
  try { res = await fetch(BASE + p, init); }
  catch (e) {
    const code = e && e.cause && e.cause.code;
    if (!['UND_ERR_SOCKET', 'ECONNRESET', 'EPIPE'].includes(code)) throw e;
    console.log(`# ${method} ${p}: ${code} on a reused connection, sent again`);
    res = await fetch(BASE + p, init);
  }
  const text = await res.text();
  let data = null; try { data = JSON.parse(text); } catch (_) { data = text; }
  return { status: res.status, data, headers: res.headers };
}
async function guest(name) {
  const cid = newCid();
  const r = await call('POST', '/api/inspire/guest', { name, cid, password: BOARD_PW });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  return { token: r.data.token, cid };
}
async function admin() {
  const r = await call('POST', '/api/inspire/login', { username: 'vkesgin38', password: devVars.ADMIN_PASSWORD });
  assert.equal(r.status, 200, 'admin login');
  return { token: r.data.token, cid: null };
}
function d1(sql) {
  const out = execFileSync('npx', ['-y', 'wrangler@4', 'd1', 'execute', DB, '--local', '-c', CONFIG, '--persist-to', STATE, '--json', '--command', sql],
    { cwd: WORKER, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  return JSON.parse(out.slice(out.indexOf('[')))[0].results;
}
// the legacy seed names the fixture server's default host: a moved fixture server (MEDIA_E2E_FX) gets a rewritten copy
function seedFile(file) {
  const host = new URL(FXB).host;
  if (host === '127.0.0.1:4742') return file;
  const out = path.join(STATE, path.basename(file));
  fs.writeFileSync(out, fs.readFileSync(file, 'utf8').replaceAll('127.0.0.1:4742', host));
  return out;
}
function d1File(file) {
  execFileSync('npx', ['-y', 'wrangler@4', 'd1', 'execute', DB, '--local', '-c', CONFIG, '--persist-to', STATE, '--file', file],
    { cwd: WORKER, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}
const brCalls = async () => (await (await fetch(fx('/__br/calls'))).json()).count;
const post = (who, url, extra = {}) => call('POST', '/api/inspire/posts', { url, description: '', ...extra }, who.token);
const meta = (who, id, q = '') => call('POST', `/api/inspire/posts/${id}/meta${q}`, {}, who.token);
async function board(who, legacy = false) {
  const r = await call('GET', '/api/inspire/posts', null, who && who.token, { legacy });
  assert.equal(r.status, 200);
  return r.data;
}
const postById = async (who, id, legacy) => (await board(who, legacy)).find((p) => p.id === id);
async function waitFor(fn, ms = 15000, label = 'condition') {
  const t0 = Date.now();
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() - t0 > ms) throw new Error('timeout: ' + label);
    await sleep(400);
  }
}
const secondsToMidnight = () => { const d = new Date(); d.setUTCHours(24, 0, 0, 0); return Math.ceil((d - Date.now()) / 1000); };
// Raw HTTP for uploads with a lying / missing Content-Length (fetch cannot send those).
function rawRequest(method, p, headers, chunks, { destroyAfterMs = null } = {}) {
  return new Promise((resolve) => {
    const u = new URL(BASE + p);
    const req = http.request({ host: u.hostname, port: u.port, path: u.pathname + u.search, method, headers }, (res) => {
      let t = ''; res.on('data', (c) => { t += c; }); res.on('end', () => { let d = t; try { d = JSON.parse(t); } catch (_) {} resolve({ status: res.statusCode, data: d }); });
    });
    req.on('error', (e) => resolve({ status: 0, error: e.message }));   // ignored once a response arrived
    for (const c of chunks) for (let i = 0; i < c.length; i += 1 << 20) req.write(c.subarray(i, i + (1 << 20)));
    if (destroyAfterMs != null) setTimeout(() => { req.destroy(); resolve({ status: 0, destroyed: true }); }, destroyAfterMs);
    else req.end();
  });
}
// Upload whose body is sent in two parts; `between` runs after the first part (e.g. deletes the post meanwhile).
function splitUpload(p, headers, first, rest, between) {
  return new Promise((resolve) => {
    const u = new URL(BASE + p);
    const req = http.request({ host: u.hostname, port: u.port, path: u.pathname + u.search, method: 'POST', headers }, (res) => {
      let t = ''; res.on('data', (c) => { t += c; }); res.on('end', () => { let d = t; try { d = JSON.parse(t); } catch (_) {} resolve({ status: res.statusCode, data: d, headers: res.headers }); });
    });
    req.on('error', (e) => resolve({ status: 0, error: e.message }));
    req.write(first);
    between().then(() => req.end(rest), (e) => { req.destroy(); resolve({ status: 0, error: String(e && e.message) }); });
  });
}
// Objects in the local R2 bucket (miniflare's sqlite index) whose key starts with `prefix`
function r2Keys(prefix) {
  const dir = path.join(STATE, 'v3', 'r2', 'miniflare-R2BucketObject');
  const out = [];
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.sqlite') && x !== 'metadata.sqlite')) {
    const rows = execFileSync('sqlite3', [path.join(dir, f), `SELECT key FROM _mf_objects WHERE key LIKE '${prefix.replace(/'/g, '')}%'`], { encoding: 'utf8' });
    out.push(...rows.split('\n').filter(Boolean));
  }
  return out;
}
const upload = (who, id, part, buf, type, q = '') => call('POST', `/api/inspire/posts/${id}/media/upload?part=${part}${q}`, new Uint8Array(buf), who.token, { headers: { 'Content-Type': type } });
const file = (f) => fs.readFileSync(path.join(FX, f));

// ---------------------------------------------------------------- shared start
let r = await call('GET', '/api/inspire/config');   // runs the schema migration
assert.equal(r.status, 200);
const ADM = await admin();

if (MODE === 'main') {
  const A = await guest('Ayşe'), B = await guest('Burak');
  r = await call('GET', '/api/inspire/config', null, A.token);
  // download / Instagram-copy flags (worker/inspire-video.js) ride on the same block
  const { download, ig_copy, ig_auto, ...upMedia } = r.data.media;
  assert.deepEqual(upMedia, { attach: true, uploads: true, max_video_mb: 25, max_image_mb: 10,
    types: ['video/mp4', 'video/webm', 'video/quicktime', 'image/jpeg', 'image/png', 'image/webp', 'image/gif'] });
  assert.equal(download, true); assert.equal(ig_copy, true); assert.ok(['off', 'blocked', 'all'].includes(ig_auto), ig_auto);
  r = await call('GET', '/api/inspire/config', null, null, { legacy: true });
  assert.equal(r.data.media, undefined);
  ok('config: media block for the current board only');

  d1File(seedFile(path.join(HERE, 'seed-legacy.sql')));
  const seeded = Object.fromEntries(d1("SELECT id, url FROM inspire_posts WHERE client_id = 'legacyseedcid0000000001'").map((x) => [x.url, x.id]));

  // 10. 64 KB precheck still applies to JSON routes
  r = await call('POST', '/api/inspire/posts', { url: fx('/page/plain/huge'), description: 'x'.repeat(70 * 1024) }, A.token);
  assert.equal(r.status, 413);
  ok('64 KB precheck: 70 KB JSON body -> 413');

  // 12. CORS preflight for the upload path
  const pre = await fetch(BASE + '/api/inspire/posts/1/media/upload?part=video', { method: 'OPTIONS' });
  assert.equal(pre.status, 204);
  assert.equal(pre.headers.get('access-control-allow-headers'), 'Content-Type,Authorization,X-Fikir-Client');
  assert.match(pre.headers.get('access-control-allow-methods'), /PUT/);
  ok('OPTIONS upload path lists Content-Type, Authorization, X-Fikir-Client');

  // 1. a web post whose video sits deep in the body (Vecteezy-like)
  const vecUrl = fx('/page/vecteezy/video/66110223-incredible-chicago-skyline-at-chicago-illinois-in-united-states-awesome-background');
  r = await post(A, vecUrl);
  assert.equal(r.status, 201, JSON.stringify(r.data));
  assert.equal(r.data.meta.v, 2);
  assert.equal(r.data.meta.via, 'plain');
  assert.equal(r.data.meta.media.kind, 'video');
  assert.equal(r.data.meta.media.verified, true);
  assert.equal(r.data.meta.media.url, fx('/cdn/vecteezy/system/resources/previews/066/110/223/watermarked/incredible-chicago-skyline-at-chicago-illinois-in-united-states-awesome-background-video.mp4'));
  assert.equal(r.data.meta.media.mime, 'video/mp4');
  assert.equal(r.data.meta.media.bytes, file('clip.mp4').length);
  assert.ok(r.data.meta.media.poster.startsWith(fx('/cdn/vecteezy/')));
  assert.equal(r.data.meta.checked, undefined, 'internal fields stripped');
  assert.equal(r.data.media, null);
  assert.equal(r.data.meta_stale, false);
  assert.equal(r.data.meta_pending, false);
  assert.equal(r.data.can_edit_media, true);
  const vecId = r.data.id;
  let p = await postById(B, vecId);
  assert.equal(p.can_edit_media, false, 'another guest');
  assert.equal((await postById(ADM, vecId)).can_edit_media, true, 'admin');
  p = await postById(A, vecId, true);
  for (const k of ['media', 'meta_stale', 'meta_pending', 'can_edit_media']) assert.ok(!(k in p), `legacy client never sees ${k}`);
  ok('web post: meta v2 with a verified video from the body scan; PostOut fields; legacy client sees none of them');

  // 11. /preview
  r = await call('POST', '/api/inspire/preview', { url: vecUrl }, A.token);
  assert.equal(r.status, 200);
  assert.equal(r.data.outcome, 'media');
  assert.equal(r.data.kind, 'card');
  assert.equal(r.data.meta.media.kind, 'video');
  const blockedUrl = (s) => fx(`/page/blocked/premium-video/assembling-burger-${s}_4720543`);
  r = await call('POST', '/api/inspire/preview', { url: blockedUrl('preview') }, A.token);
  assert.equal(r.data.outcome, 'blocked');
  assert.equal(r.data.br_possible, true);
  r = await call('POST', '/api/inspire/preview', { url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ' }, A.token);
  assert.equal(r.data.outcome, 'skipped');
  assert.equal(r.data.kind, 'embed');
  assert.equal((await call('POST', '/api/inspire/preview', { url: vecUrl })).status, 401);
  assert.equal((await call('POST', '/api/inspire/preview', { url: 'javascript:alert(1)' }, A.token)).status, 400);
  assert.equal(await brCalls(), 0, '/preview never runs Browser Run');
  const Pv = await guest('Önizleme');
  let codes = [];
  for (let i = 0; i < 21; i++) codes.push((await call('POST', '/api/inspire/preview', { url: vecUrl }, Pv.token)).status);
  assert.deepEqual(codes.slice(0, 20), Array(20).fill(200));
  assert.equal(codes[20], 429);
  ok('/preview: media / blocked + br_possible / skipped; 401, 400; never Browser Run; 429 after 20 per minute');

  // 2. blocked page -> pending -> Browser Run in waitUntil -> video
  r = await post(A, blockedUrl('a1'));
  assert.equal(r.status, 201);
  assert.equal(r.data.meta_pending, true);
  assert.equal(r.data.meta, null);
  assert.equal(r.data.meta_failed, false);
  const a1 = r.data.id;
  const resolved = await waitFor(async () => { const x = await meta(A, a1); return x.data.meta && x.data.meta.media ? x : null; }, 15000, 'Browser Run result');
  assert.equal(resolved.data.meta.via, 'br');
  assert.equal(resolved.data.meta.media.source, 'br');
  assert.equal(resolved.data.meta.media.url, fx('/cdn/videocdn/videos/9d0664ea-fc7c-56ee-b566-eb13ffdc1812/horizontal/previews/magnific_watermarked/large.mp4'));
  assert.equal(resolved.data.meta.media.verified, true);
  assert.equal(resolved.data.meta.media.w, 3840);
  assert.equal(resolved.data.pending, undefined);
  assert.ok(resolved.data.meta.title.startsWith('Assembling a Burger'));
  assert.equal(await brCalls(), 1);
  const calls1 = (await (await fetch(fx('/__br/calls'))).json()).calls;
  assert.match(calls1[0].userAgent, /Chrome\/141/);
  assert.equal(calls1[0].elements, 9);
  let q = d1(`SELECT scope, subject, n, lim FROM inspire_quota ORDER BY scope`);
  const qs = Object.fromEntries(q.map((x) => [x.scope + ':' + x.subject, x]));
  assert.equal(qs['br:'].n, 1);
  assert.equal(qs['br_ms:'].n, 2570, 'reservation 5000 adjusted to X-Browser-Ms-Used');
  assert.equal(qs['br_user:c:' + A.cid].n, 1);
  ok('blocked page: 201 meta_pending -> Browser Run (1 call, realistic UA, 9 selectors) -> verified video; br/br_ms/br_user quota rows');

  // 4b. per-cid cap (FIKIR_BR_PER_CID=2): A's 2nd works, the 3rd is a plain v2 failure (not pending)
  await sleep(12000);
  r = await post(A, blockedUrl('a2'));
  const a2 = r.data.id;
  await waitFor(async () => { const x = await meta(A, a2); return x.data.meta && x.data.meta.media ? x : null; }, 15000, 'a2');
  assert.equal(await brCalls(), 2);
  await sleep(12000);
  r = await post(A, blockedUrl('a3'));
  const a3 = r.data.id;
  await sleep(1500);
  p = await postById(A, a3);
  assert.equal(p.meta_pending, false);
  assert.equal(p.meta_failed, true);
  assert.equal(await brCalls(), 2, 'no call over the per-cid cap');
  assert.equal(d1(`SELECT n FROM inspire_quota WHERE scope='br_user' AND subject='c:${A.cid}'`)[0].n, 2);
  assert.equal(d1(`SELECT n FROM inspire_quota WHERE scope='br' AND subject=''`)[0].n, 2, 'the rejected batch reserved nothing');
  ok('per-cid Browser Run cap: 3rd post of the same guest -> plain v2 failure, no call, nothing reserved');

  // 4c. per-IP cap (FIKIR_BR_PER_IP=3; guest cids are client-chosen): B's 1st works (3rd call from this IP), B's 2nd -> plain failure
  r = await post(B, blockedUrl('b1'));
  const b1 = r.data.id;
  await waitFor(async () => { const x = await meta(B, b1); return x.data.meta && x.data.meta.media ? x : null; }, 15000, 'b1');
  assert.equal(await brCalls(), 3);
  await sleep(12000);
  r = await post(B, blockedUrl('b2'));
  const b2 = r.data.id;
  await sleep(1500);
  p = await postById(B, b2);
  assert.equal(p.meta_pending, false); assert.equal(p.meta_failed, true);
  assert.equal(await brCalls(), 3, 'no call over the per-IP cap');
  q = Object.fromEntries(d1(`SELECT scope, n FROM inspire_quota WHERE scope IN ('br_ip', 'br_ms_ip')`).map((x) => [x.scope, x.n]));
  assert.equal(q.br_ip, 3); assert.equal(q.br_ms_ip, 3 * 2570, 'browser ms per IP = sum of X-Browser-Ms-Used');
  assert.equal(d1(`SELECT n FROM inspire_quota WHERE scope='br_user' AND subject='c:${B.cid}'`)[0].n, 1, 'B: the refused batch reserved nothing');
  ok('per-IP Browser Run cap: a 2nd guest on the same IP gets a plain failure once the IP has 3 calls; br_ms_ip charged');

  // 3. two blocked posts back to back: the second waits for the slot; a /meta poll after it is due runs it (F4: a viewer over
  //    the IP cap leaves it waiting, the admin resolves it)
  await sleep(12000);
  r = await post(ADM, blockedUrl('x1'));
  const x1 = r.data.id;
  r = await post(ADM, blockedUrl('x2'));
  const x2 = r.data.id;
  assert.equal(r.data.meta_pending, true);
  await waitFor(async () => (await meta(ADM, x1)).data.meta, 15000, 'x1');
  await sleep(500);
  r = await meta(ADM, x2);
  assert.equal(r.data.pending, true, JSON.stringify(r.data));
  assert.ok(r.data.retry_after >= 1 && r.data.retry_after <= 15, String(r.data.retry_after));
  assert.equal(await brCalls(), 4, 'slot busy: no second call');
  const bp = d1(`SELECT n FROM inspire_quota WHERE scope='br_post' AND subject='${x2}'`);
  assert.ok(!bp.length || bp[0].n === 0, 'slot busy: the reservation was refunded');
  await sleep((r.data.retry_after + 1) * 1000);
  r = await meta(A, x2);   // A: not the author, over its own br_user cap (not charged here), its IP is over the cap
  assert.equal(r.data.pending, true, JSON.stringify(r.data));
  assert.ok(r.data.retry_after > 500 && r.data.retry_after <= 600, String(r.data.retry_after));
  assert.equal(await brCalls(), 4, 'refused by the per-IP cap: no call');
  assert.equal((await postById(ADM, x2)).meta_pending, false, 'next attempt 10 min away: the board shows no spinner');
  r = await meta(ADM, x2, '?force=1');
  assert.equal(r.data.meta && r.data.meta.media && r.data.meta.media.kind, 'video', JSON.stringify(r.data));
  assert.equal(await brCalls(), 5);
  ok('slot: the 2nd of two back-to-back blocked posts is pending (retry_after <= 15); a viewer over the IP cap keeps it pending (no call, no spinner); the admin resolves it');

  // 3b. the cron resolves a due pending row
  r = await post(ADM, blockedUrl('x3'));   // slot busy (x2 just ran) -> pending 15 s
  const x3 = r.data.id;
  await sleep(1500);
  assert.equal((await postById(ADM, x3)).meta_pending, true);
  await sleep(15000);
  const sch = await fetch(BASE + '/__scheduled?cron=*/15+*+*+*+*');
  assert.equal(sch.status, 200);
  await waitFor(async () => { const x = await postById(ADM, x3); return x.meta && x.meta.media ? x : null; }, 15000, 'cron Browser Run');
  assert.equal(await brCalls(), 6);
  ok('cron: a due pending row is resolved by scheduled()');

  // 6a. Browser Run 429 -> pending with retry >= 60, never a 5xx
  await sleep(12000);
  r = await post(ADM, fx('/page/br429/clip-777001'));
  assert.equal(r.status, 201);
  const r429 = r.data.id;
  await waitFor(async () => await brCalls() === 7, 10000, '429 call');
  await sleep(800);
  r = await meta(ADM, r429);
  assert.equal(r.status, 200);
  assert.equal(r.data.pending, true);
  assert.ok(r.data.retry_after >= 55, String(r.data.retry_after));
  ok('Browser Run 429 -> pending, retry_after >= 60 s, no 5xx');

  // 5a. not a bot wall: Browser Run sees a removed page (404) / an empty page -> no host strike; the 404 post waits 30 days
  await sleep(12000);
  r = await post(ADM, fx('/page/br404/premium-video/removed-clip_999999999'));
  const g404 = r.data.id;
  assert.equal(r.data.meta_pending, true);
  await waitFor(async () => await brCalls() === 8, 10000, '404 call');
  await sleep(800);
  p = await postById(ADM, g404);
  assert.equal(p.meta_pending, false); assert.equal(p.meta_failed, true);
  assert.equal(d1(`SELECT json_extract(meta, '$.retry_s') AS r FROM inspire_posts WHERE id=${Number(g404)}`)[0].r, 30 * 86400);
  await sleep(12000);
  r = await post(ADM, fx('/page/brempty/premium-video/empty-page_999999998'));
  const gEmpty = r.data.id;
  await waitFor(async () => await brCalls() === 9, 10000, 'empty call');
  await sleep(800);
  assert.equal((await postById(ADM, gEmpty)).meta_failed, true);
  assert.equal(d1(`SELECT COUNT(*) AS c FROM inspire_rate WHERE k='br_block:127.0.0.1'`)[0].c, 0, 'no strike for 404 / empty');
  ok('Browser Run 404 -> that post fails for 30 days; empty page -> plain failure; neither is a host strike');

  // 5. DataDome scrape -> a br_block strike for the host (that post: failure retried after 6 h); the same post walled again is
  //    no 2nd strike; at 3 strikes (3 posts) in 7 days the next blocked post on that host makes no call (one challenge can be
  //    transient: real Magnific blocked 1 of 4 scrapes)
  let calls = 9;
  for (let i = 1; i <= 3; i++) {
    await sleep(12000);
    r = await post(ADM, fx(`/page/datadome/video/clip-88800${i}`));
    const dd = r.data.id;
    assert.equal(r.data.meta_pending, true, `strike ${i}: Browser Run still possible`);
    calls++;
    await waitFor(async () => await brCalls() === calls, 10000, 'datadome call ' + i);
    await sleep(800);
    p = await postById(ADM, dd);
    assert.equal(p.meta_pending, false);
    assert.equal(p.meta_failed, true);
    assert.equal(d1(`SELECT json_extract(meta, '$.retry_s') AS r FROM inspire_posts WHERE id=${Number(dd)}`)[0].r, 21600);
    assert.equal(d1(`SELECT n FROM inspire_rate WHERE k='br_block:127.0.0.1'`)[0].n, i);
    r = await call('POST', '/api/inspire/preview', { url: blockedUrl('strike-preview-' + i) }, ADM.token);
    assert.equal(r.data.br_possible, i < 3, 'br_possible after strike ' + i);
    if (i === 1) {   // the owner retries the same post: walled again, still 1 strike
      await sleep(12000);
      r = await meta(ADM, dd, '?force=1');
      assert.equal(r.status, 200);
      calls++;
      assert.equal(await brCalls(), calls);
      assert.equal(d1(`SELECT n FROM inspire_rate WHERE k='br_block:127.0.0.1'`)[0].n, 1, 'one strike per post');
    }
  }
  await sleep(12000);
  r = await post(ADM, blockedUrl('after-block'));
  assert.equal(r.data.meta_pending, false, 'host memo: Browser Run not possible');
  await sleep(1500);
  assert.equal(await brCalls(), calls);
  r = await call('POST', '/api/inspire/preview', { url: blockedUrl('after-block-preview') }, A.token);
  assert.equal(r.data.br_possible, false);
  ok('DataDome scrape -> br_block strike, post retried after 6 h; same post again: no 2nd strike; 3 posts (7 days): same host no new call, br_possible false');

  // 7. legacy v1 rows: refreshed lazily once, never losing an old title
  const L1 = seeded[fx('/page/legacy-ok/video/77001234-legacy-clip')], L2 = seeded[fx('/page/legacy-fail/old-article')], L3 = seeded[fx('/page/plain/legacy-failed')];
  let bl = await board(A);
  const by = (id) => bl.find((x) => x.id === id);
  assert.equal(by(L1).meta_stale, true);
  assert.equal(by(L1).meta.title, 'Old title');
  assert.equal(by(L2).meta_stale, true);
  assert.equal(by(L3).meta_stale, true);
  assert.equal(by(L3).meta_failed, false, 'v1 failure is retried once');
  assert.equal(by(L3).meta, null);
  r = await meta(A, L1);
  assert.equal(r.data.meta.v, 2);
  assert.equal(r.data.meta.title, 'Legacy clip refreshed');
  assert.equal(r.data.meta.media.kind, 'video');
  assert.equal(r.data.meta.media.w, 160);
  r = await meta(A, L2);
  assert.equal(r.data.meta.title, 'Kept title');
  assert.equal(r.data.meta.v, 2);
  r = await meta(A, L3);
  assert.match(r.data.meta.title, /^Plain article/);
  assert.equal(r.data.meta.v, 2);
  bl = await board(A);
  for (const id of [L1, L2, L3]) assert.equal(by(id).meta_stale, false);
  const l2row = d1(`SELECT meta FROM inspire_posts WHERE id=${L2}`)[0];
  const l2 = JSON.parse(l2row.meta);
  assert.equal(l2.v, 2); assert.ok(l2.checked > 0); assert.equal(l2.title, 'Kept title');
  r = await meta(A, L2);
  assert.equal(r.data.meta.title, 'Kept title', 'stored v2 answered without a fetch');
  ok('legacy: v1 good -> v2 with media; v1 good + failing page -> title kept, v:2 + checked; v1 failure retried once');

  // 8. PUT /media (manual attach)
  r = await post(A, fx('/page/plain/manual-attach'));
  const P8 = r.data.id;
  r = await call('PUT', `/api/inspire/posts/${P8}/media`, { url: fx('/cdn/manual/clip.mp4'), poster: fx('/cdn/manual/poster.jpg'), w: 160, h: 90 }, A.token);
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.post.media.kind, 'video');
  assert.equal(r.data.post.media.verified, true);
  assert.equal(r.data.post.media.bytes, file('clip.mp4').length);
  assert.equal(r.data.post.media.poster, fx('/cdn/manual/poster.jpg'));
  assert.equal(r.data.post.media.source, 'manual');
  assert.equal(r.data.post.media.autoplay, true);
  r = await call('PUT', `/api/inspire/posts/${P8}/media`, { url: fx('/cdn/manual/photo.jpg') }, ADM.token);
  assert.equal(r.status, 200);
  assert.equal(r.data.post.media.kind, 'image');
  assert.equal((await call('PUT', `/api/inspire/posts/${P8}/media`, { url: fx('/cdn/manual/clip.mp4') }, B.token)).status, 403);
  assert.equal((await call('PUT', `/api/inspire/posts/${P8}/media`, { url: fx('/cdn/manual/clip.mp4') })).status, 401);
  assert.equal((await call('PUT', '/api/inspire/posts/999999/media', { url: fx('/cdn/manual/clip.mp4') }, A.token)).status, 404);
  r = await call('POST', '/api/inspire/posts', { type: 'text', text: 'metin fikir' }, A.token);
  r = await call('PUT', `/api/inspire/posts/${r.data.id}/media`, { url: fx('/cdn/manual/clip.mp4') }, A.token);
  assert.equal(r.status, 400); assert.equal(r.data.error, 'not_link_post');
  r = await call('PUT', `/api/inspire/posts/${seeded['https://www.youtube.com/watch?v=dQw4w9WgXcQ']}/media`, { url: fx('/cdn/manual/clip.mp4') }, ADM.token);
  assert.equal(r.status, 409); assert.equal(r.data.error, 'has_player');
  for (const url of ['javascript:alert(1)', 'data:video/mp4;base64,AAAA', 'http://10.0.0.1/a.mp4', 'http://localhost/a.mp4', 'http://127.0.0.1:9/a.mp4', 'ftp://x.example/a.mp4', '']) {
    r = await call('PUT', `/api/inspire/posts/${P8}/media`, { url }, A.token);
    assert.equal(r.status, 400, url); assert.equal(r.data.error, 'invalid_media_url', url);
  }
  const bad = [['/cdn/manual/html-as-mp4.mp4', 'not_media'], ['/cdn/manual/x.svg', 'unsupported_type'], [`/cdn/manual/s.mp4?token=exp=${nowS() + 600}~hmac=1`, 'expiring_url'],
    ['/cdn/manual/redirect-169.mp4', 'unverifiable'], ['/cdn/manual/404.mp4', 'unverifiable']];
  for (const [u, code] of bad) {
    r = await call('PUT', `/api/inspire/posts/${P8}/media`, { url: fx(u) }, A.token);
    assert.equal(r.status, 422, u); assert.equal(r.data.error, code, u);
  }
  r = await call('PUT', `/api/inspire/posts/${P8}/media`, { url: fx('/cdn/manual/403.mp4') }, A.token);
  assert.equal(r.status, 200); assert.equal(r.data.post.media.verified, false); assert.equal(r.data.post.media.kind, 'video');
  r = await call('PUT', `/api/inspire/posts/${P8}/media`, { url: fx('/cdn/manual/app-mp4.mp4') }, A.token);
  assert.equal(r.status, 200); assert.equal(r.data.post.media.verified, true); assert.equal(r.data.post.media.mime, 'video/mp4');
  r = await call('PUT', `/api/inspire/posts/${P8}/media`, { url: fx('/cdn/manual/big.mp4') }, A.token);
  assert.equal(r.data.post.media.bytes, 52428800); assert.equal(r.data.post.media.autoplay, false);
  p = await postById(A, P8, true);
  assert.ok(!('media' in p));
  r = await call('DELETE', `/api/inspire/posts/${P8}/media`, null, A.token);
  assert.equal(r.status, 200); assert.equal(r.data.post.media, null);
  ok('PUT /media: owner/admin 200; 403/401/404/400 text/409 embed; 400 bad URLs; 422 html/svg/expiring/redirect/404; 403 -> unverified; application/mp4 -> verified video/mp4; big -> no autoplay; DELETE');

  const Cg = await guest('Cem');
  r = await post(Cg, fx('/page/plain/rate'));
  codes = [];
  for (let i = 0; i < 31; i++) codes.push((await call('PUT', `/api/inspire/posts/${r.data.id}/media`, { url: 'javascript:x' }, Cg.token)).status);
  assert.equal(codes[29], 400); assert.equal(codes[30], 429);
  ok('PUT /media: 429 after 30 per hour');

  // POST /posts with media (bookmarklet / modal) and client meta
  r = await post(A, fx('/page/plain/with-media'), { media: { url: fx('/cdn/bm/clip.mp4'), poster: fx('/cdn/bm/poster.jpg'), kind: 'video', w: 160, h: 90 }, title: 'Yer imi başlığı', via: 'bookmarklet' });
  assert.equal(r.status, 201);
  assert.equal(r.data.media.source, 'bookmarklet');
  assert.equal(r.data.media.w, 160);
  assert.equal(r.data.media_error, undefined);
  r = await post(A, fx('/page/plain/bad-media'), { media: { url: 'javascript:alert(1)' } });
  assert.equal(r.status, 201);
  assert.equal(r.data.media, null);
  assert.equal(r.data.media_error.error, 'invalid_media_url');
  r = await post(A, blockedUrl('client-meta'), { media: { url: fx('/cdn/bm/c.mp4'), poster: fx('/cdn/bm/c.jpg') }, title: '  Sayfa‮ başlığı  ', via: 'modal' });
  assert.equal(r.status, 201);
  assert.equal(r.data.meta.via, 'client');
  assert.equal(r.data.meta.title, 'Sayfa başlığı');
  assert.equal(r.data.meta.image, fx('/cdn/bm/c.jpg'));
  assert.equal(r.data.media.source, 'manual');
  assert.equal(r.data.meta_pending, false, 'host memo: no Browser Run');
  ok('POST /posts: media (bookmarklet) stored; bad media -> media_error, post created; client meta when the page is blocked');

  // force refresh
  assert.equal((await meta(A, vecId, '?force=1')).status, 200);
  r = await meta(B, vecId, '?force=1');
  assert.equal(r.status, 403);
  ok('POST /meta?force=1: owner 200, another guest 403');

  // 9. uploads
  r = await post(A, fx('/page/plain/upload-a'));
  const P9 = r.data.id;
  r = await upload(A, P9, 'video', file('clip.webm'), 'video/webm', '&w=160&h=90');
  assert.equal(r.status, 201, JSON.stringify(r.data));
  const m1 = r.data.post.media;
  assert.match(m1.url, new RegExp(`^/files/fikir/${P9}/v-[0-9a-f]{32}\\.webm\\?t=[0-9a-z]+\\.[A-Za-z0-9_-]{22}$`));
  assert.equal((await fetch(BASE + m1.url.split('?')[0])).status, 403, 'board files need the files token (?t=)');
  assert.equal(m1.mime, 'video/webm'); assert.equal(m1.bytes, file('clip.webm').length); assert.equal(m1.source, 'upload');
  assert.equal(m1.verified, true); assert.equal(m1.w, 160);
  assert.equal(r.data.quota.uploads_left, 2); assert.equal(r.data.quota.mb_left, 2); assert.match(r.data.quota.reset_at, /T00:00:00\.000Z$/);
  let f = await fetch(BASE + m1.url);
  assert.equal(f.status, 200);
  assert.equal(f.headers.get('content-type'), 'video/webm');
  assert.equal(f.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(f.headers.get('content-security-policy'), "default-src 'none'; sandbox");
  assert.equal(f.headers.get('content-disposition'), 'inline');
  assert.equal(f.headers.get('cross-origin-resource-policy'), 'cross-origin');
  assert.match(f.headers.get('cache-control'), /^private, max-age=\d+, immutable$/);
  assert.ok(f.headers.get('etag'));
  const size = Number(f.headers.get('content-length'));
  assert.equal(size, file('clip.webm').length);
  assert.ok(Buffer.from(await f.arrayBuffer()).equals(file('clip.webm')));
  f = await fetch(BASE + m1.url, { headers: { Range: 'bytes=0-99' } });
  assert.equal(f.status, 206); assert.equal(f.headers.get('content-range'), `bytes 0-99/${size}`); assert.equal((await f.arrayBuffer()).byteLength, 100);
  f = await fetch(BASE + m1.url, { headers: { Range: 'bytes=-100' } });
  assert.equal(f.status, 206); assert.equal(f.headers.get('content-range'), `bytes ${size - 100}-${size - 1}/${size}`);
  assert.ok(Buffer.from(await f.arrayBuffer()).equals(file('clip.webm').subarray(size - 100)));
  f = await fetch(BASE + m1.url, { headers: { Range: 'bytes=999999-' } });
  assert.equal(f.status, 416); assert.equal(f.headers.get('content-range'), `bytes */${size}`);
  assert.equal((await fetch(BASE + '/files/fikir/1/v-zz.mp4')).status, 404, 'fikir/ keys must match the server pattern');
  ok('upload webm -> 201; /files: files token, type, nosniff, CSP sandbox, inline, CORP, private immutable, ETag; 206 range + suffix; 416');

  r = await upload(A, P9, 'video', file('clip.mp4'), 'video/mp4');
  assert.equal(r.status, 201);
  const m2 = r.data.post.media;
  assert.match(m2.url, /\.mp4\?t=[^?]+$/); assert.equal(m2.mime, 'video/mp4');
  await waitFor(async () => (await fetch(BASE + m1.url)).status === 404, 5000, 'replaced object deleted');
  r = await upload(A, P9, 'poster', file('poster.png'), 'image/png');
  assert.equal(r.status, 201);
  assert.equal(r.data.post.media.url.split('?')[0], m2.url.split('?')[0]);
  assert.match(r.data.post.media.poster, new RegExp(`^/files/fikir/${P9}/p-[0-9a-f]{32}\\.png\\?t=`));
  const posterPath = r.data.post.media.poster;
  assert.equal((await fetch(BASE + posterPath)).headers.get('content-type'), 'image/png');
  r = await upload(A, P9, 'image', file('poster.jpg'), 'image/jpeg');
  assert.equal(r.status, 429); assert.equal(r.data.error, 'quota_exceeded'); assert.ok(r.data.reset_at);
  ok('upload mp4 replaces webm (old object deleted); poster png; 4th upload of the day -> 429 quota_exceeded');

  r = await call('DELETE', `/api/inspire/posts/${P9}/media`, null, A.token);
  assert.equal(r.status, 200); assert.equal(r.data.post.media, null);
  await waitFor(async () => (await fetch(BASE + m2.url)).status === 404 && (await fetch(BASE + posterPath)).status === 404, 5000, 'DELETE /media objects');
  await waitFor(async () => d1(`SELECT COUNT(*) AS c FROM inspire_media WHERE post_id=${P9}`)[0].c === 0, 8000, 'DELETE /media rows');
  ok('DELETE /media removes the objects and their rows');

  // error paths (guest B on B's own post)
  r = await post(B, fx('/page/plain/upload-b'));
  const PB = r.data.id;
  r = await upload(B, P9, 'video', file('clip.webm'), 'video/webm');
  assert.equal(r.status, 403); assert.equal(r.data.error, 'forbidden');
  r = await upload(B, PB, 'image', fs.readFileSync(path.join(FX, 'sniff/bad.svg')), 'image/svg+xml');
  assert.equal(r.status, 415); assert.equal(r.data.error, 'unsupported_media_type');
  r = await upload(B, PB, 'video', Buffer.concat([fs.readFileSync(path.join(FX, 'sniff/bad.html')), Buffer.alloc(2 * 1048576, 32)]), 'video/mp4');
  assert.equal(r.status, 415);
  r = await upload(B, PB, 'image', fs.readFileSync(path.join(FX, 'sniff/bad-heic.mp4')), 'image/heic');
  assert.equal(r.status, 415);
  r = await upload(B, PB, 'image', file('clip.mp4'), 'image/jpeg');
  assert.equal(r.status, 415, 'a video sent as part=image');
  const stream = new ReadableStream({ start(c) { c.enqueue(new Uint8Array(file('clip.webm'))); c.close(); } });
  const nolen = await fetch(BASE + `/api/inspire/posts/${PB}/media/upload?part=video`, { method: 'POST', body: stream, duplex: 'half', headers: { Authorization: 'Bearer ' + B.token, 'X-Fikir-Client': '2', 'Content-Type': 'video/webm' } });
  assert.equal(nolen.status, 411);
  const big = new Uint8Array(26 * 1048576);
  big.set(file('clip.mp4').subarray(0, 64));
  // over the cap the body is not read: the client gets 413 while it is still sending (raw HTTP; fetch reports EPIPE)
  const H = (type) => ({ Authorization: 'Bearer ' + B.token, 'X-Fikir-Client': '2', 'Content-Type': type });
  r = await rawRequest('POST', `/api/inspire/posts/${PB}/media/upload?part=video`, { ...H('video/mp4'), 'Content-Length': String(big.length) }, [big]);
  assert.equal(r.status, 413, JSON.stringify(r)); assert.equal(r.data.error, 'file_too_large');
  const big2 = new Uint8Array(11 * 1048576);
  r = await rawRequest('POST', `/api/inspire/posts/${PB}/media/upload?part=image`, { ...H('image/jpeg'), 'Content-Length': String(big2.length) }, [big2]);
  assert.equal(r.status, 413, JSON.stringify(r));
  const upN = () => { const x = d1(`SELECT n FROM inspire_quota WHERE scope='up_n' AND subject='c:${B.cid}'`); return x.length ? x[0].n : 0; };
  // client gone before the body completed (Content-Length 30000, 4000 bytes sent): nothing may stay behind. (A local
  // `wrangler dev` may hold the request until the body completes; then the worker never sees it, which is fine too.)
  const before = upN();
  r = await rawRequest('POST', `/api/inspire/posts/${PB}/media/upload?part=video`, { Authorization: 'Bearer ' + B.token, 'X-Fikir-Client': '2', 'Content-Type': 'video/webm', 'Content-Length': '30000' },
    [file('clip.webm').subarray(0, 4000)], { destroyAfterMs: 2500 });
  await sleep(2500);
  assert.equal(d1(`SELECT COUNT(*) AS c FROM inspire_media WHERE post_id=${PB}`)[0].c, 0, 'no row left after a short body');
  assert.equal(upN(), before, 'quota refunded');
  assert.equal((await postById(B, PB)).media, null);
  ok('upload errors: 403 other guest; 415 svg / html-as-mp4 / heic / video-as-image; 411 no length; 413 over cap (video 25 MB, image 10 MB); aborted body -> no row, quota unchanged');

  // the post is deleted while its upload streams: the upload answers 404 JSON (with CORS), no row, no R2 object, quota refunded
  r = await post(B, fx('/page/plain/upload-race'));
  const PR = r.data.id;
  const raceBody = Buffer.alloc(3 * 1048576);
  file('clip.mp4').copy(raceBody, 0);
  const upBefore = upN();
  r = await splitUpload(`/api/inspire/posts/${PR}/media/upload?part=video`,
    { ...H('video/mp4'), 'Content-Length': String(raceBody.length), Origin: 'http://127.0.0.1:4741' }, raceBody.subarray(0, 1048576), raceBody.subarray(1048576),
    async () => {
      await waitFor(async () => d1(`SELECT COUNT(*) AS c FROM inspire_media WHERE post_id=${PR} AND state='pending'`)[0].c === 1, 15000, 'upload row pending (the worker streams the body)');
      const del = await call('DELETE', `/api/inspire/posts/${PR}`, null, B.token);
      assert.equal(del.status, 200);
      await sleep(1500);   // the delete's waitUntil cleanup runs meanwhile
    });
  assert.equal(r.status, 404, JSON.stringify(r)); assert.equal(r.data.error, 'not_found');
  assert.ok(r.headers['access-control-allow-origin'], 'CORS on the error');
  await sleep(500);
  assert.equal(d1(`SELECT COUNT(*) AS c FROM inspire_media WHERE post_id=${PR}`)[0].c, 0, 'no row');
  assert.deepEqual(r2Keys(`fikir/${PR}/`), [], 'no R2 object left behind');
  assert.equal(upN(), upBefore, 'quota refunded');
  ok('post deleted during its upload: 404 JSON + CORS, no row, no R2 object, quota refunded');

  // uploads per IP (FIKIR_UP_PER_IP_N=5): a fresh guest cid on the same IP is refused once the IP's 5 are used
  const upIp = () => { const x = d1(`SELECT n FROM inspire_quota WHERE scope='up_n_ip'`); return x.length ? x[0].n : 0; };
  assert.equal(upIp(), 3, "A's 3 uploads; refused and refunded ones do not count");
  const Cu = await guest('Yeni cihaz');
  r = await post(Cu, fx('/page/plain/upload-ip'));
  const PC = r.data.id;
  for (let i = 0; i < 2; i++) assert.equal((await upload(Cu, PC, 'video', file('clip.webm'), 'video/webm')).status, 201);
  r = await upload(Cu, PC, 'video', file('clip.webm'), 'video/webm');
  assert.equal(r.status, 429); assert.equal(r.data.error, 'quota_exceeded');
  assert.equal(d1(`SELECT n FROM inspire_quota WHERE scope='up_n' AND subject='c:${Cu.cid}'`)[0].n, 2, 'refused by the IP cap, not its own');
  ok('per-IP upload cap: a new guest cid on the same IP -> 429 quota_exceeded after the IP\'s 5 uploads');

  // admin (exempt from every daily upload quota, the site-wide one included) + post delete removes objects; cron sweeps stale rows
  const allBytes = () => { const x = d1(`SELECT n FROM inspire_quota WHERE scope='up_bytes_all'`); return x.length ? x[0].n : 0; };
  const allBefore = allBytes();
  r = await upload(ADM, P9, 'image', file('poster.jpg'), 'image/jpeg');
  assert.equal(r.status, 201); assert.equal(r.data.quota.uploads_left, null); assert.equal(r.data.quota.mb_left, null);
  assert.equal(allBytes(), allBefore, 'admin uploads do not use the site-wide daily bytes');
  const adminImg = r.data.post.media.url;
  assert.equal((await fetch(BASE + adminImg)).status, 200);
  r = await call('DELETE', `/api/inspire/posts/${P9}`, null, A.token);
  assert.equal(r.status, 200);
  await waitFor(async () => (await fetch(BASE + adminImg)).status === 404, 5000, 'post delete removes objects');
  d1(`INSERT INTO inspire_media (key, post_id, slot, subject, mime, bytes, state, created_at) VALUES ('fikir/${PB}/v-${'ab'.repeat(16)}.mp4', ${PB}, 'v', 'c:x', 'video/mp4', 10, 'pending', ${nowS() - 7200})`);
  assert.equal((await fetch(BASE + '/__scheduled?cron=*/15+*+*+*+*')).status, 200);
  await waitFor(async () => d1(`SELECT COUNT(*) AS c FROM inspire_media WHERE post_id=${PB}`)[0].c === 0, 8000, 'cron sweep');
  ok('admin upload (no quota numbers); post delete removes its objects; cron sweeps a stale pending row');

  const toml = fs.readFileSync(path.join(WORKER, CONFIG), 'utf8');
  assert.ok(!/^\s*INSPIRE_FAKE_BR\s*=/m.test(fs.readFileSync(path.join(WORKER, 'wrangler.toml'), 'utf8')));
  ok(`done (${CONFIG})` + (toml.includes('LOCAL TEST ONLY') ? ' [local test config]' : ''));
}

if (MODE === 'brquota') {
  // FIKIR_BR_DAILY=3, FIKIR_MEDIA_UPLOADS=admin
  const G = await guest('Kota');
  r = await call('GET', '/api/inspire/config', null, G.token);
  assert.equal(r.data.media.uploads, false);
  r = await call('GET', '/api/inspire/config', null, ADM.token);
  assert.equal(r.data.media.uploads, true);
  r = await post(G, fx('/page/plain/up-off'));
  r = await upload(G, r.data.id, 'video', file('clip.webm'), 'video/webm');
  assert.equal(r.status, 403); assert.equal(r.data.error, 'uploads_disabled');
  ok('FIKIR_MEDIA_UPLOADS=admin: config uploads false for guests, 403 uploads_disabled');
  const ids = [];
  for (let i = 1; i <= 3; i++) {
    r = await post(ADM, fx(`/page/blocked/premium-video/quota-${i}_${4720600 + i}`));
    ids.push(r.data.id);
    await waitFor(async () => await brCalls() === i, 10000, 'call ' + i);
    await sleep(12000);
  }
  for (const id of ids) assert.equal((await postById(ADM, id)).meta.media.kind, 'video');
  r = await post(ADM, fx('/page/blocked/premium-video/quota-4_4720604'));
  const fourth = r.data.id;
  await sleep(1500);
  r = await meta(ADM, fourth);
  assert.equal(r.data.pending, true);
  assert.ok(Math.abs(r.data.retry_after - secondsToMidnight()) < 120, `${r.data.retry_after} vs ${secondsToMidnight()}`);
  assert.equal(await brCalls(), 3);
  const q = Object.fromEntries(d1('SELECT scope, n, lim FROM inspire_quota').map((x) => [x.scope, x]));
  assert.equal(q.br.n, 3); assert.equal(q.br.lim, 3);
  assert.equal(q.br_ms.n, 3 * 2570);
  ok('global daily cap (FIKIR_BR_DAILY=3): the 4th -> pending until UTC midnight, no call; br_ms = sum of X-Browser-Ms-Used');
}

if (MODE === 'brlimit') {
  r = await post(ADM, fx('/page/brlimit/clip-999001'));
  const id1 = r.data.id;
  await waitFor(async () => await brCalls() === 1, 10000, 'limit call');
  await sleep(800);
  r = await meta(ADM, id1);
  assert.equal(r.status, 200);
  assert.equal(r.data.pending, true);
  assert.ok(Math.abs(r.data.retry_after - secondsToMidnight()) < 120);
  const q = d1("SELECT n, lim FROM inspire_quota WHERE scope='br'")[0];
  assert.equal(q.n, q.lim);
  await sleep(12000);
  r = await post(ADM, fx('/page/blocked/premium-video/after-limit_4720700'));
  const id2 = r.data.id;
  assert.equal(r.data.meta_pending, true, 'just created: Browser Run is about to be tried');
  await sleep(1500);
  assert.equal((await postById(ADM, id2)).meta_pending, false, 'waiting for UTC midnight: the board shows the plain card, no spinner');
  r = await meta(ADM, id2);
  assert.equal(r.data.pending, true);
  assert.ok(Math.abs(r.data.retry_after - secondsToMidnight()) < 120);
  assert.equal(await brCalls(), 1, 'no call after the time limit');
  r = await call('POST', '/api/inspire/preview', { url: fx('/page/blocked/premium-video/after-limit-preview_4720701') }, ADM.token);
  assert.equal(r.data.outcome, 'blocked');
  assert.equal(r.data.br_possible, false, 'daily budget spent: the add dialog promises no automatic retry');
  ok('"time limit exceeded" -> br set to lim, pending until midnight (no spinner in the list); next blocked post waits without a call; /preview br_possible false');
}
console.log(`# ${MODE}: ${n} checks passed`);
