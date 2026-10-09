// video-smoke.mjs: end-to-end checks of downloads + Instagram copies against a local `wrangler dev` (see run-smoke.sh):
// GET /posts/:id/download (stored media, link-preview media, direct files, refusals, error page, rate limit),
// /download-info, the `dl` hint in GET /posts, /ig-copy and /ig-blocked guards (sessions, blocked embeds only, who may
// make the server re-check an embed). Non-Instagram media come from
// tests/media-e2e/fixture-server.mjs on 127.0.0.1:4741. With VIDEO_E2E_REAL_IG=1 it also talks to the real Instagram
// for two public reels (one whose embed is blocked, one control): embed checks, a download, an R2 copy, removal and
// the cron copy. That is 3 www.instagram.com page requests and ~6 CDN file requests, spaced 3 s apart.
// Reads ADMIN_PASSWORD and FIKIR_BOARD_PASSWORD from worker/.dev.vars (TEST values; the board password falls back to
// FIKIR_E2E_BOARD_PASSWORD / 'test-board-pass', which run-smoke.sh also passes with --var) and never prints them.
// Downloads carry the session's ticket from download-info (?k=), as the board's links do (board password gate).
// usage: node tests/video-e2e/video-smoke.mjs <base=http://127.0.0.1:8841>
//   env: VIDEO_E2E_STATE (wrangler --persist-to dir), VIDEO_E2E_CONFIG (wrangler config), VIDEO_E2E_DB (D1 name),
//        VIDEO_E2E_FX (fixture server base), VIDEO_E2E_REAL_IG=1, VIDEO_E2E_IG_BLOCKED / VIDEO_E2E_IG_OK (reel codes)
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const BASE = process.argv[2] || 'http://127.0.0.1:8841';
const FXB = process.env.VIDEO_E2E_FX || 'http://127.0.0.1:4741';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const WORKER = path.join(HERE, '../../worker');
const STATE = process.env.VIDEO_E2E_STATE;
const CONFIG = process.env.VIDEO_E2E_CONFIG || 'wrangler.toml';
const DB = process.env.VIDEO_E2E_DB || 'vk-portfolio';
const REAL_IG = process.env.VIDEO_E2E_REAL_IG === '1';
const IG_BLOCKED = process.env.VIDEO_E2E_IG_BLOCKED || 'DRUcmHMjeLZ';
const IG_OK = process.env.VIDEO_E2E_IG_OK || 'DW9tQ1fkrBR';
if (!/^http:\/\/127\.0\.0\.1:\d+$/.test(BASE) || !/^http:\/\/127\.0\.0\.1:\d+$/.test(FXB)) throw new Error('local worker + fixture server only');
if (!STATE) throw new Error('VIDEO_E2E_STATE is required (the --persist-to dir of the local worker)');
const CLIP = fs.readFileSync(path.join(HERE, '../fixtures/media/clip.mp4'));
const POSTER = fs.readFileSync(path.join(HERE, '../fixtures/media/poster.jpg'));
const devVars = Object.fromEntries(fs.readFileSync(path.join(WORKER, '.dev.vars'), 'utf8').split('\n').filter((l) => l.includes('='))
  .map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]));
const BOARD_PW = process.env.FIKIR_E2E_BOARD_PASSWORD || devVars.FIKIR_BOARD_PASSWORD || 'test-board-pass';
let n = 0;
const ok = (msg) => console.log(`ok ${++n} ${msg}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const newCid = () => 'v' + Math.random().toString(36).slice(2) + Date.now().toString(36) + 'xxxxxxxx';

// a keep-alive socket that the local dev server closed while idle (or after a seeding command) fails before any
// response: send once more
async function fetchOnce(url, init) {
  try { return await fetch(url, init); }
  catch (e) {
    const code = e && e.cause && e.cause.code;
    if (!['UND_ERR_SOCKET', 'ECONNRESET', 'EPIPE'].includes(code)) throw e;
    console.log(`# ${init && init.method || 'GET'} ${url.slice(BASE.length)}: ${code} on a reused connection, sent again`);
    return fetch(url, init);
  }
}
async function call(method, p, body, token, { legacy = false, headers = {} } = {}) {
  const h = { ...(legacy ? {} : { 'X-Fikir-Client': '2' }), ...headers };
  if (body != null) h['Content-Type'] = 'application/json';
  if (token) h.Authorization = 'Bearer ' + token;
  const res = await fetchOnce(BASE + p, { method, headers: h, body: body == null ? undefined : JSON.stringify(body) });
  const text = await res.text();
  let data = null; try { data = JSON.parse(text); } catch (_) { data = text; }
  return { status: res.status, data, headers: res.headers };
}
// The download ticket (?k=) of a session for a post, from download-info (as the board gets it); kept for 10 minutes
const tickets = new Map();
async function ticketFor(id, token) {
  const key = id + ':' + token;
  const c = tickets.get(key);
  if (c && Date.now() - c.at < 600e3) return c.k;
  const r = await call('GET', `/api/inspire/posts/${id}/download-info`, null, token);
  assert.equal(r.status, 200, JSON.stringify(r.data));
  const k = r.data.url.split('?k=')[1];
  tickets.set(key, { k, at: Date.now() });
  return k;
}
// a download as the browser opens it (navigation: Accept text/html, no session header) with guest g's ticket;
// k: another ticket (null = none)
async function dl(id, q = '', headers = {}, { k } = {}) {
  const kk = k === undefined ? await ticketFor(id, g.token) : k;
  const qs = q + (kk ? (q ? '&' : '?') + 'k=' + kk : '');
  const res = await fetchOnce(`${BASE}/api/inspire/posts/${id}/download${qs}`, { headers: { Accept: 'text/html,application/xhtml+xml,*/*;q=0.8', ...headers } });
  const buf = Buffer.from(await res.arrayBuffer());
  return { status: res.status, headers: res.headers, buf, text: () => buf.toString('utf8') };
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
  return { token: r.data.token };
}
function d1(sql) {
  const out = execFileSync('npx', ['-y', 'wrangler@4', 'd1', 'execute', DB, '--local', '-c', CONFIG, '--persist-to', STATE, '--json', '--command', sql],
    { cwd: WORKER, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  return JSON.parse(out.slice(out.indexOf('[')))[0].results;
}
const q = (v) => (v == null ? 'NULL' : `'${String(v).replace(/'/g, "''")}'`);
async function board(token, legacy = false) {
  const r = await call('GET', '/api/inspire/posts', null, token, { legacy });
  assert.equal(r.status, 200);
  return r.data;
}
async function waitFor(fn, ms = 30000, label = 'condition') {
  const t0 = Date.now();
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() - t0 > ms) throw new Error('timeout: ' + label);
    await sleep(500);
  }
}
const cd = (h) => h.get('content-disposition') || '';
const asciiName = (h) => (/filename="([^"]*)"/.exec(cd(h)) || [])[1];
const utfName = (h) => { const m = /filename\*=UTF-8''(\S+)/.exec(cd(h)); return m ? decodeURIComponent(m[1]) : null; };

// ── setup ──
const g = await guest('Video Test');
const other = await guest('Başka');
const adm = await admin();
const cfg = await call('GET', '/api/inspire/config', null, g.token);
assert.equal(cfg.status, 200);
assert.equal(cfg.data.media.download, true);
assert.equal(cfg.data.media.ig_copy, true);
ok('config: media.download / ig_copy flags');

const FX = (p) => FXB + p;
const meta = (o) => JSON.stringify({ v: 2, via: 'plain', checked: Math.floor(Date.now() / 1000), provider: 'example.com', ...o });
const posts = {
  clip: { type: 'web', url: 'https://example.com/clip-page', meta: meta({ title: 'Gün batımı klibi', media: { mv: 1, kind: 'video', url: FX('/cdn/sunset.mp4'), poster: FX('/cdn/sunset.jpg'), autoplay: true, verified: true, source: 'og' } }) },
  htmlfake: { type: 'web', url: 'https://example.com/fake-video', meta: meta({ title: 'Sahte <video> "x"', media: { mv: 1, kind: 'video', url: FX('/cdn/html-as-mp4.mp4'), poster: null, autoplay: true, verified: false } }) },
  ssrf: { type: 'web', url: 'https://example.com/ssrf', meta: meta({ title: 'ssrf', media: { mv: 1, kind: 'video', url: 'http://169.254.169.254/latest/x.mp4', poster: null, autoplay: true, verified: false } }) },
  redir: { type: 'web', url: 'https://example.com/redir', meta: meta({ title: 'redir', media: { mv: 1, kind: 'video', url: FX('/cdn/redirect-169.mp4'), poster: null, autoplay: true, verified: false } }) },
  imageonly: { type: 'web', url: 'https://example.com/article', meta: meta({ title: 'Makale', image: FX('/cdn/cover.jpg') }) },
  direct: { type: 'video', url: FX('/cdn/direct.mp4'), meta: null },
  text: { type: 'text', url: '', meta: null, description: 'Sadece metin' },
  igBlocked: { type: 'instagram', url: `https://www.instagram.com/reel/${IG_BLOCKED}/`, meta: null, cid: g.cid },
  igOk: { type: 'instagram', url: `https://www.instagram.com/reel/${IG_OK}/`, meta: null },
  r2: { type: 'web', url: 'https://example.com/r2-upload', meta: meta({ title: 'R2 dosyası' }) },
  // never fetched: its 'ig' row is seeded as backing off (budget checks below need no network)
  igBudget: { type: 'instagram', url: 'https://www.instagram.com/reel/DAaaaaaaaa9/', meta: null, cid: g.cid },
  // never fetched either: the ig-blocked / ig-copy guards below (owner: other)
  igRep: { type: 'instagram', url: 'https://www.instagram.com/reel/DAaaaaaaa10/', meta: null },
  // YouTube Shorts: never downloadable (no request is made); only its thumbnail on request
  yt: { type: 'youtube', url: 'https://www.youtube.com/shorts/jNQXAC9IVRw', meta: null },
};
const guestRow = `(SELECT id FROM inspire_users WHERE username='__guest__')`;
const ids = {};
for (const [k, p] of Object.entries(posts)) {
  d1(`INSERT INTO inspire_posts (user_id, type, url, description, author_name, client_id, url_key, meta) VALUES (${guestRow}, ${q(p.type)}, ${q(p.url)}, ${q(p.description || '')}, 'Video Test', ${q(p.cid || other.cid)}, ${q('vtest:' + k + ':' + Date.now())}, ${q(p.meta)})`);
  ids[k] = d1(`SELECT id FROM inspire_posts WHERE url_key LIKE ${q('vtest:' + k + ':%')} ORDER BY id DESC LIMIT 1`)[0].id;
}
ok('seeded ' + Object.keys(ids).length + ' posts: ' + JSON.stringify(ids));

// ── GET /posts hint ──
{
  const b = await board(g.token);
  const by = Object.fromEntries(b.map((p) => [p.id, p]));
  assert.deepEqual(by[ids.clip].dl, { video: true, image: true });
  assert.deepEqual(by[ids.imageonly].dl, { video: false, image: true });
  assert.deepEqual(by[ids.direct].dl, { video: true, image: false });
  assert.equal(by[ids.text].dl, null);
  assert.deepEqual(by[ids.igBlocked].dl, { video: true, image: true });
  assert.equal(by[ids.ssrf].dl.video, true, 'hint is optimistic; the download itself refuses');
  const legacy = await board(g.token, true);
  assert.ok(legacy.length && legacy.every((p) => !('dl' in p)), 'old cached pages never see dl');
  assert.equal((await call('GET', '/api/inspire/posts', null, null, { legacy: true })).status, 401, 'nor anything without a session');
  ok('GET /posts: dl hints per post; legacy clients get none');
}

// ── downloads from link previews / direct files ──
{
  const r = await dl(ids.clip);
  assert.equal(r.status, 200, r.text().slice(0, 200));
  assert.equal(r.headers.get('content-type'), 'video/mp4');
  assert.equal(Number(r.headers.get('content-length')), CLIP.length);
  assert.ok(r.buf.equals(CLIP));
  assert.match(cd(r.headers), /^attachment; /);
  assert.equal(asciiName(r.headers), `fikir-${ids.clip}-Gun-batimi-klibi.mp4`);
  assert.equal(utfName(r.headers), `fikir-${ids.clip}-Gün-batımı-klibi.mp4`);
  assert.equal(r.headers.get('cache-control'), 'private, no-store');
  assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
  ok('download: link-preview video streamed with length + Turkish-safe filename');
  const im = await dl(ids.clip, '?part=image');
  assert.equal(im.status, 200);
  assert.equal(im.headers.get('content-type'), 'image/jpeg');
  assert.ok(im.buf.equals(POSTER));
  assert.equal(asciiName(im.headers), `fikir-${ids.clip}-Gun-batimi-klibi.jpg`);
  ok('download ?part=image: the video poster');
  const io = await dl(ids.imageonly);
  assert.equal(io.status, 200); assert.equal(io.headers.get('content-type'), 'image/jpeg');
  const iov = await dl(ids.imageonly, '?part=video');
  assert.equal(iov.status, 404);
  ok('auto falls back to the page image; part=video without a video is 404');
  const d = await dl(ids.direct);
  assert.equal(d.status, 200); assert.ok(d.buf.equals(CLIP));
  ok('download: direct video link');
}

// ── refusals + error page ──
{
  const r = await dl(ids.htmlfake);
  assert.equal(r.status, 502);
  assert.match(r.headers.get('content-type'), /^text\/html/);
  assert.match(r.headers.get('content-security-policy'), /default-src 'none'/);
  const t = r.text();
  assert.ok(t.includes('İndirilemedi'));
  assert.ok(t.includes('href="https://example.com/fake-video"'));
  assert.ok(!t.includes('<video>') && !t.includes('<script'), 'nothing unescaped, no scripts');
  const j = await dl(ids.htmlfake, '', { Accept: 'application/json' });
  assert.equal(j.status, 502);
  const jd = JSON.parse(j.text());
  assert.equal(jd.error, 'not_downloadable'); assert.equal(jd.reason, 'not_media'); assert.equal(jd.source, 'https://example.com/fake-video');
  ok('an HTML page served as .mp4 is refused (magic bytes): Turkish HTML page / JSON');
  for (const k of ['ssrf', 'redir']) {
    const s = await dl(ids[k], '?format=json');
    assert.equal(s.status, 502, k);
    assert.equal(JSON.parse(s.text()).reason, 'unsafe', k);
  }
  ok('private address and a redirect to one are never fetched (reason unsafe)');
  const t404 = await dl(ids.text);
  assert.equal(t404.status, 404); assert.ok(t404.text().includes('yalnızca metin'));
  assert.equal((await dl(999999999, '', {}, { k: null })).status, 401, 'unknown post: no ticket can exist for it');
  assert.equal((await fetchOnce(`${BASE}/api/inspire/posts/999999999/download`, { headers: { Authorization: 'Bearer ' + g.token } })).status, 404, 'with the session header: 404');
  assert.equal((await dl(ids.clip, '?part=audio')).status, 400);
  ok('text post / unknown post / bad part');
  // board password gate: no ticket / a ticket of another post / a forged one -> 401 (HTML page or JSON)
  const nt = await dl(ids.clip, '', {}, { k: null });
  assert.equal(nt.status, 401); assert.match(nt.headers.get('content-type'), /^text\/html/); assert.ok(nt.text().includes('süresi doldu'));
  assert.equal((await dl(ids.clip, '?format=json', {}, { k: await ticketFor(ids.direct, g.token) })).status, 401, "another post's ticket");
  const exp = (Math.floor(Date.now() / 1000) + 600).toString(36);
  assert.equal((await dl(ids.clip, '?format=json', {}, { k: `${exp}.a.${'A'.repeat(22)}` })).status, 401, 'forged ticket');
  ok('download links need the ticket of a session (401 without, for another post, forged)');
}

// ── download-info ──
{
  assert.equal((await call('GET', `/api/inspire/posts/${ids.clip}/download-info`)).status, 401, 'a session only');
  const a = await call('GET', `/api/inspire/posts/${ids.clip}/download-info`, null, g.token);
  assert.equal(a.status, 200);
  assert.deepEqual({ video: a.data.video, image: a.data.image, from: a.data.from, platform: a.data.platform, unsupported: a.data.unsupported },
    { video: true, image: true, from: 'link', platform: 'web', unsupported: false });
  assert.match(a.data.url, new RegExp(`^/api/inspire/posts/${ids.clip}/download\\?k=[0-9a-z]+\\.g\\.[A-Za-z0-9_-]{22}$`));
  assert.equal(a.headers.get('cache-control'), 'private, no-store');
  const b = await call('GET', `/api/inspire/posts/${ids.igBlocked}/download-info`, null, g.token);
  assert.deepEqual({ video: b.data.video, image: b.data.image, from: b.data.from, copied: b.data.copied, embed: b.data.embed },
    { video: true, image: true, from: 'instagram', copied: false, embed: null });
  const t = await call('GET', `/api/inspire/posts/${ids.text}/download-info`, null, g.token);
  assert.deepEqual({ video: t.data.video, image: t.data.image }, { video: false, image: false });
  ok('download-info: no network, from/copied/embed fields, a ticketed link');
  // YouTube Shorts: why not, up front; the download refuses auto / video with 422 (no thumbnail, no budget unit, no fetch)
  const y = await call('GET', `/api/inspire/posts/${ids.yt}/download-info`, null, g.token);
  assert.deepEqual({ video: y.data.video, image: y.data.image, reason: y.data.reason, unsupported: y.data.unsupported, message: y.data.message },
    { video: false, image: true, reason: 'not_supported', unsupported: true, message: 'YouTube videoları siteden indirilemiyor — YouTube buna izin vermiyor.' });
  const yk = y.data.url.split('?k=')[1];
  const yj = await dl(ids.yt, '?format=json', {}, { k: yk });
  assert.equal(yj.status, 422); const yd = JSON.parse(yj.text());
  assert.deepEqual({ error: yd.error, reason: yd.reason, unsupported: yd.unsupported, image: yd.image }, { error: 'not_downloadable', reason: 'not_supported', unsupported: true, image: true });
  assert.equal((await dl(ids.yt, '?part=video&format=json', {}, { k: yk })).status, 422);
  const yh = await dl(ids.yt, '', {}, { k: yk });
  assert.equal(yh.status, 422); assert.match(yh.headers.get('content-type'), /^text\/html/);
  assert.ok(yh.text().includes('Kapak görselini indir') && yh.text().includes(`/api/inspire/posts/${ids.yt}/download?part=image&amp;k=`));
  ok('YouTube Shorts: download-info unsupported + message; auto / video -> 422 (JSON / HTML with the cover link), never the thumbnail');
}

// ── ig-copy / ig-blocked guards ──
{
  assert.equal((await call('POST', `/api/inspire/posts/${ids.igBlocked}/ig-copy`)).status, 401);
  const r = await call('POST', `/api/inspire/posts/${ids.clip}/ig-copy`, null, g.token);
  assert.equal(r.status, 400); assert.equal(r.data.error, 'not_instagram');
  assert.equal((await call('POST', `/api/inspire/posts/${ids.igBlocked}/ig-blocked`)).status, 401);
  assert.equal((await call('POST', `/api/inspire/posts/${ids.clip}/ig-blocked`, null, g.token)).status, 400);
  assert.equal((await call('POST', `/api/inspire/posts/999999999/ig-blocked`, null, g.token)).status, 404);
  ok('ig-copy and ig-blocked need a session and an Instagram post');
}

// ── budgets: the daily download budget skips R2 files and the admin's ticket; ig-copy daily budgets per caller ──
{
  const today = new Date().toISOString().slice(0, 10);
  const nowS = Math.floor(Date.now() / 1000);
  const quota = (scope, subject = '') => (d1(`SELECT n FROM inspire_quota WHERE day=${q(today)} AND scope=${q(scope)} AND subject=${q(subject)}`)[0] || { n: 0 }).n;
  const fill = (scope, subject, n) => d1(`INSERT INTO inspire_quota (day, scope, subject, n, lim) VALUES (${q(today)}, ${q(scope)}, ${q(subject)}, ${n}, ${n})
    ON CONFLICT(day, scope, subject) DO UPDATE SET n=${n}, lim=${n}`);
  // download-info: every session's link carries a 15-minute ticket (never cached); the admin's (role a) skips the budget
  const ia = await call('GET', `/api/inspire/posts/${ids.clip}/download-info`, null, adm.token);
  assert.match(ia.data.url, new RegExp(`^/api/inspire/posts/${ids.clip}/download\\?k=[0-9a-z]+\\.a\\.[A-Za-z0-9_-]{22}$`));
  assert.equal(ia.headers.get('cache-control'), 'private, no-store');
  const ig = await call('GET', `/api/inspire/posts/${ids.clip}/download-info`, null, g.token);
  assert.match(ig.data.url, new RegExp(`^/api/inspire/posts/${ids.clip}/download\\?k=[0-9a-z]+\\.g\\.[A-Za-z0-9_-]{22}$`));
  const io = await call('GET', `/api/inspire/posts/${ids.direct}/download-info`, null, adm.token);
  assert.notEqual(io.data.url.split('?k=')[1], ia.data.url.split('?k=')[1], 'a ticket is bound to its post');
  ok('download-info: admin link with an admin ticket, guests with a guest ticket');
  // an R2 file (admin upload) downloads without touching the daily budget; an upstream download takes one unit
  const up = await fetchOnce(`${BASE}/api/inspire/posts/${ids.r2}/media/upload?part=video`, { method: 'POST', body: CLIP,
    headers: { Authorization: 'Bearer ' + adm.token, 'X-Fikir-Client': '2', 'Content-Type': 'video/mp4' } });
  assert.equal(up.status, 201, await up.text());
  const n0 = quota('dl');
  const r2 = await dl(ids.r2);
  assert.equal(r2.status, 200); assert.ok(r2.buf.equals(CLIP));
  assert.equal(quota('dl'), n0, 'R2 download: no unit');
  assert.equal((await dl(ids.clip)).status, 200);
  assert.equal(quota('dl'), n0 + 1, 'upstream download: one unit');
  assert.equal((await dl(ids.text)).status, 404);
  assert.equal(quota('dl'), n0 + 1, 'refused before any fetch: no unit');
  // the day's budget spent by others: anonymous upstream downloads 429, R2 files and the admin's ticket still work
  fill('dl', '', 1500);
  const ex = await dl(ids.clip, '?format=json');
  assert.equal(ex.status, 429); assert.equal(JSON.parse(ex.text()).error, 'quota_exceeded');
  assert.equal((await dl(ids.r2)).status, 200, 'R2 file despite the spent budget');
  const tk = ia.data.url.split('?k=')[1];
  const adm1 = await dl(ids.clip, '', {}, { k: tk });
  assert.equal(adm1.status, 200); assert.ok(adm1.buf.equals(CLIP));
  assert.equal((await dl(ids.direct, '?format=json', {}, { k: tk })).status, 401, 'an admin ticket of another post opens nothing');
  assert.equal((await dl(ids.clip, '?format=json', {}, { k: '0.a.AAAAAAAAAAAAAAAAAAAAAA' })).status, 401, 'forged ticket');
  assert.equal(quota('dl'), 1500, 'the admin download took no unit');
  fill('dl', '', 0);
  ok('daily download budget: R2 files never count, the admin ticket is exempt, others get 429 when it is spent');

  // ig-copy: no network here (the post's resolve is seeded as backing off -> 502 resolve_failed once past the budgets)
  d1(`INSERT INTO inspire_video_cache (post_id, kind, error, fail_count, retry_at, resolved_at) VALUES (${ids.igBudget}, 'ig', 'redirect', 1, ${nowS + 3600}, ${nowS})`);
  d1(`INSERT INTO inspire_video_cache (post_id, kind, resolved_at, retry_at, extra) VALUES (${ids.igBudget}, 'ig_embed', ${nowS}, ${nowS + 30 * 86400}, '{"state":"blocked"}')`);
  const copy = (who) => call('POST', `/api/inspire/posts/${ids.igBudget}/ig-copy`, null, who.token);
  fill('ig_copy', 'guests', 20);
  const gq = await copy(g);
  assert.equal(gq.status, 429, JSON.stringify(gq.data)); assert.equal(gq.data.error, 'quota_exceeded');
  fill('ig_copy', '', 40);
  const aq = await copy(adm);
  assert.equal(aq.status, 502, JSON.stringify(aq.data)); assert.equal(aq.data.reason, 'redirect');
  fill('ig_copy', 'guests', 0); fill('ig_copy', '', 0);
  fill('up_n', 'c:' + g.cid, 10);
  assert.equal((await copy(g)).status, 429, "the guest's own daily upload count");
  fill('up_n', 'c:' + g.cid, 0);
  assert.equal((await copy(g)).status, 502, 'within the budgets: on to the resolve');
  assert.equal(quota('ig_copy', 'guests'), 0, 'a failed copy refunds its units');
  assert.equal(quota('up_n', 'c:' + g.cid), 0);
  ok("ig-copy budgets: guests' share + per-cid quota refuse (429), the admin is exempt; failures refund");
  d1(`INSERT INTO inspire_video_cache (post_id, kind, resolved_at, extra) VALUES (${ids.igBudget}, 'ig_copy', ${nowS}, '{"removed":1}')
    ON CONFLICT(post_id, kind) DO UPDATE SET extra='{"removed":1}', retry_at=NULL, error=NULL`);
  const rm = await copy(other);
  assert.equal(rm.status, 403); assert.equal(rm.data.error, 'copy_removed');
  assert.equal((await copy(g)).status, 502, 'the post owner may copy it again');
  ok('a removed copy can be made again only by the post owner / admin');

  // ig-blocked: who makes the server fetch the embed page. No network: the day's Instagram fetch budget is spent, so an
  // attempted check stops at its admission; every attempt shows in the site-wide 10-minute counter 'ig_fetch:all'.
  const watcher = await guest('Gözlemci');
  const tries = () => (d1(`SELECT n FROM inspire_rate WHERE k='ig_fetch:all'`)[0] || { n: 0 }).n;
  const embed = (state, age, error = null) => d1(`INSERT INTO inspire_video_cache (post_id, kind, resolved_at, retry_at, error, extra)
    VALUES (${ids.igRep}, 'ig_embed', ${nowS - age}, ${error ? nowS - 1 : nowS + 30 * 86400 - age}, ${q(error)}, ${q(JSON.stringify({ state }))})
    ON CONFLICT(post_id, kind) DO UPDATE SET resolved_at=excluded.resolved_at, retry_at=excluded.retry_at, error=excluded.error, extra=excluded.extra`);
  const report = async (who) => {
    const t0 = tries();
    const r = await call('POST', `/api/inspire/posts/${ids.igRep}/ig-blocked`, null, who.token);
    assert.equal(r.status, 200, JSON.stringify(r.data));
    return { state: r.data.state, queued: r.data.queued, fetched: tries() > t0 };
  };
  fill('ig_fetch', '', 300);
  assert.deepEqual(await report(watcher), { state: 'unknown', queued: false, fetched: true }, 'never checked: anyone may make the server check it');
  embed('ok', 2 * 86400);
  assert.deepEqual(await report(watcher), { state: 'ok', queued: false, fetched: false }, 'checked: a guest gets the stored state');
  assert.deepEqual(await report(other), { state: 'ok', queued: false, fetched: true }, 'the post owner: a re-check of a day-old "ok"');
  assert.deepEqual(await report(adm), { state: 'ok', queued: false, fetched: true }, 'the admin too');
  embed('ok', 3600);
  assert.deepEqual(await report(other), { state: 'ok', queued: false, fetched: false }, 'at most once a day');
  embed('blocked', 2 * 86400);
  assert.deepEqual(await report(other), { state: 'blocked', queued: true, fetched: false }, 'a block is never re-checked by a report');
  embed('blocked', 2 * 86400, 'upstream');
  assert.deepEqual(await report(watcher), { state: 'blocked', queued: true, fetched: false }, 'a failed re-check keeps the last known state');
  fill('ig_fetch', '', 0);
  ok('ig-blocked: only an unchecked post (anyone) or a day-old "ok" (post owner / admin) makes the server fetch the embed page');

  // ig-copy: guests / users copy only a reel whose embed was found blocked; the admin copies any post. igRep's resolve is
  // seeded as backing off, so a copy that gets past the guard ends in 502 resolve_failed without any network.
  d1(`INSERT INTO inspire_video_cache (post_id, kind, error, fail_count, retry_at, resolved_at) VALUES (${ids.igRep}, 'ig', 'redirect', 1, ${nowS + 3600}, ${nowS})`);
  const copyRep = (who) => call('POST', `/api/inspire/posts/${ids.igRep}/ig-copy`, null, who.token);
  const ig0 = quota('ig_copy', 'guests');
  for (const [state, who] of [['ok', watcher], ['ok', other], ['photo', watcher]]) {
    embed(state, 3600);
    const r = await copyRep(who);
    assert.equal(r.status, 409, JSON.stringify(r.data)); assert.equal(r.data.error, 'not_blocked'); assert.equal(r.data.state, state);
  }
  d1(`DELETE FROM inspire_video_cache WHERE post_id=${ids.igRep} AND kind='ig_embed'`);
  const un = await copyRep(watcher);
  assert.equal(un.status, 409); assert.equal(un.data.state, 'unknown'); assert.match(un.data.message, /Oynamıyor mu/);
  assert.equal(quota('ig_copy', 'guests'), ig0, 'refused before any budget');
  assert.equal((await copyRep(adm)).status, 502, 'the admin copies any Instagram post');
  embed('blocked', 2 * 86400, 'upstream');
  assert.equal((await copyRep(watcher)).status, 502, 'blocked (kept after a failed re-check): on to the copy');
  ok('ig-copy: guests / users only for a blocked embed (409 not_blocked otherwise, before any budget); the admin for any post');
}

// ── real Instagram (opt-in) ──
if (REAL_IG) {
  const igRow = (id, kind) => d1(`SELECT * FROM inspire_video_cache WHERE post_id=${Number(id)} AND kind=${q(kind)}`)[0];
  const eb = await call('POST', `/api/inspire/posts/${ids.igBlocked}/ig-blocked`, null, g.token);
  assert.equal(eb.status, 200, JSON.stringify(eb.data));
  console.log(`# embed check ${IG_BLOCKED}: ${JSON.stringify(eb.data)}`);
  assert.equal(eb.data.state, 'blocked');
  assert.equal(eb.data.queued, true);
  await sleep(3000);
  const eo = await call('POST', `/api/inspire/posts/${ids.igOk}/ig-blocked`, null, g.token);
  console.log(`# embed check ${IG_OK}: ${JSON.stringify(eo.data)}`);
  assert.equal(eo.data.state, 'ok');
  assert.equal(eo.data.queued, false);
  assert.equal(JSON.parse(igRow(ids.igBlocked, 'ig_embed').extra).reports, 1);
  ok('ig-blocked: the server checks the embed page (blocked vs ok) and records the report');
  await sleep(3000);

  const t0 = Date.now();
  const v = await dl(ids.igBlocked, '?part=video');
  const ms = Date.now() - t0;
  assert.equal(v.status, 200, v.text().slice(0, 300));
  assert.equal(v.headers.get('content-type'), 'video/mp4');
  assert.equal(v.buf.subarray(4, 8).toString('latin1'), 'ftyp');
  assert.equal(Number(v.headers.get('content-length')), v.buf.length);
  assert.match(asciiName(v.headers), new RegExp(`^instagram-[A-Za-z0-9._]+-${IG_BLOCKED}\\.mp4$`));
  const row = igRow(ids.igBlocked, 'ig');
  assert.ok(row && row.url && row.expires_at > Date.now() / 1000 + 3600 && !row.error, 'resolved links cached with their expiry');
  console.log(`# ${IG_BLOCKED}: ${v.buf.length} bytes in ${ms} ms, file ${asciiName(v.headers)}, links valid ${Math.round((row.expires_at - Date.now() / 1000) / 3600)} h`);
  ok('download of a blocked-embed reel: MP4 streamed straight from the Instagram CDN');
  await sleep(3000);
  const im = await dl(ids.igBlocked, '?part=image');
  assert.equal(im.status, 200); assert.match(im.headers.get('content-type'), /^image\//);
  assert.equal(igRow(ids.igBlocked, 'ig').resolved_at, row.resolved_at, 'second download used the cache (no page fetch)');
  ok('poster download reuses the cached resolution');
  await sleep(3000);

  const c = await call('POST', `/api/inspire/posts/${ids.igBlocked}/ig-copy`, null, g.token);
  assert.equal(c.status, 201, JSON.stringify(c.data));
  const m = c.data.post.media;
  assert.equal(m.source, 'instagram'); assert.equal(m.kind, 'video'); assert.equal(m.mime, 'video/mp4');
  assert.match(m.url, new RegExp(`^/files/fikir/${ids.igBlocked}/v-[0-9a-f]{32}\\.mp4\\?t=[0-9a-z]+\\.[A-Za-z0-9_-]{22}$`));
  assert.match(m.poster, new RegExp(`^/files/fikir/${ids.igBlocked}/p-[0-9a-f]{32}\\.(jpg|webp|png)\\?t=`));
  assert.equal((await fetchOnce(BASE + m.url.split('?')[0])).status, 403, 'our copy needs the files token');
  assert.ok(m.by && m.w && m.h && m.bytes === v.buf.length, JSON.stringify(m));
  assert.equal(c.data.post.can_edit_media, false);
  const f = await fetchOnce(BASE + m.url);
  const fb = Buffer.from(await f.arrayBuffer());
  assert.equal(f.status, 200); assert.equal(fb.length, m.bytes); assert.equal(f.headers.get('content-type'), 'video/mp4');
  const rows = d1(`SELECT key, state, bytes, subject FROM inspire_media WHERE post_id=${ids.igBlocked}`);
  assert.equal(rows.length, 2); assert.ok(rows.every((r) => r.state === 'live' && r.subject === 'ig'));
  console.log(`# copy: ${JSON.stringify({ by: m.by, w: m.w, h: m.h, bytes: m.bytes, audio: m.audio, caption: (m.caption || '').slice(0, 30) })}`);
  ok('ig-copy: MP4 + poster in R2, post.media source instagram, rows live, /files serves it');
  const again = await call('POST', `/api/inspire/posts/${ids.igBlocked}/ig-copy`, null, other.token);
  assert.equal(again.status, 200); assert.equal(again.data.already, true); assert.equal(again.data.post.media.url, m.url);
  ok('ig-copy is idempotent');
  const fromR2 = await dl(ids.igBlocked);
  assert.equal(fromR2.status, 200); assert.equal(fromR2.buf.length, m.bytes);
  const b = (await board(g.token)).find((p) => p.id === ids.igBlocked);
  assert.equal(b.media.source, 'instagram'); assert.deepEqual(b.dl, { video: true, image: true });
  const info = await call('GET', `/api/inspire/posts/${ids.igBlocked}/download-info`, null, g.token);
  assert.deepEqual({ from: info.data.from, copied: info.data.copied, embed: info.data.embed }, { from: 'copy', copied: true, embed: 'blocked' });
  ok('download after the copy comes from R2; board + download-info show the copy');

  assert.equal((await call('DELETE', `/api/inspire/posts/${ids.igBlocked}/ig-copy`, null, other.token)).status, 403);
  const del = await call('DELETE', `/api/inspire/posts/${ids.igBlocked}/ig-copy`, null, g.token);
  assert.equal(del.status, 200); assert.equal(del.data.removed, true); assert.equal(del.data.post.media, null);
  await waitFor(async () => (await fetchOnce(BASE + m.url)).status === 404, 15000, 'R2 objects removed');
  ok('DELETE ig-copy: owner only; media cleared, R2 objects removed');

  // Instagram work runs on its own Cron Trigger ("7-59/15 * * * *", worker/budget.js CRON_IG); the "*/15" run never copies
  const before = igRow(ids.igBlocked, 'ig').resolved_at;
  await fetchOnce(`${BASE}/__scheduled?cron=7-59/15+*+*+*+*`);
  await sleep(4000);
  assert.equal(d1(`SELECT media FROM inspire_posts WHERE id=${ids.igBlocked}`)[0].media, null, 'a removed copy is not re-copied by the cron');
  d1(`DELETE FROM inspire_video_cache WHERE post_id=${ids.igBlocked} AND kind='ig_copy'`);
  await fetchOnce(`${BASE}/__scheduled?cron=*/15+*+*+*+*`);
  await sleep(4000);
  assert.equal(d1(`SELECT media FROM inspire_posts WHERE id=${ids.igBlocked}`)[0].media, null, 'the "*/15" cron does no Instagram copies');
  await fetchOnce(`${BASE}/__scheduled?cron=7-59/15+*+*+*+*`);
  const media = await waitFor(() => { const r = d1(`SELECT media FROM inspire_posts WHERE id=${ids.igBlocked}`)[0]; return r && r.media && JSON.parse(r.media); }, 60000, 'cron copy');
  assert.equal(media.source, 'instagram');
  assert.equal(igRow(ids.igBlocked, 'ig').resolved_at, before, 'cron copy reused the cached links');
  assert.equal(d1(`SELECT media FROM inspire_posts WHERE id=${ids.igOk}`)[0].media, null, 'the control reel (embed plays) is not copied');
  ok('cron copies the blocked reel (once its removal marker is gone), never the playable one');
}

// ── Cron Triggers: one invocation per trigger, dispatched on controller.cron, each metered under the Free limits ──
// (worker/budget.js: every run logs "cron <task>: D1 n/40 statements in c calls, subrequests s/35 ..."). No Instagram
// traffic: run-smoke.sh sets FIKIR_IG_CRON_CHECKS=0 and no post is queued for a copy at this point.
if (process.env.VIDEO_E2E_LOG) {
  const budgets = (task) => fs.readFileSync(process.env.VIDEO_E2E_LOG, 'utf8').split('\n')
    .map((l) => new RegExp(`cron ${task}: D1 (\\d+)/(\\d+) statements in (\\d+) calls, subrequests (\\d+)/(\\d+)[^\\n]*`).exec(l)).filter(Boolean);
  const before = { main: budgets('main').length, ig: budgets('ig').length };
  for (const cron of ['*/15+*+*+*+*', '7-59/15+*+*+*+*']) assert.equal((await fetchOnce(`${BASE}/__scheduled?cron=${cron}`)).status, 200);
  const got = await waitFor(() => {
    const m = budgets('main'), i = budgets('ig');
    return m.length > before.main && i.length > before.ig ? { main: m[m.length - 1], ig: i[i.length - 1] } : null;
  }, 30000, 'cron budget log lines');
  for (const [task, m] of Object.entries(got)) {
    assert.ok(Number(m[1]) <= Number(m[2]) && Number(m[2]) === 40 && Number(m[4]) <= Number(m[5]) && Number(m[5]) === 35, `${task}: ${m[0]}`);
    assert.ok(!/refused/.test(m[0]), `${task}: ${m[0]}`);
  }
  ok(`cron triggers: ${got.main[0]} | ${got.ig[0]}`);
}

// ── per-IP download rate limit (last: it blocks this IP for 10 minutes) ──
{
  let status = 0, i = 0;
  for (; i < 60 && status !== 429; i++) status = (await dl(ids.text)).status;
  assert.equal(status, 429);
  const last = await dl(ids.text);
  assert.equal(last.status, 429); assert.ok(last.text().includes('Çok fazla'));
  ok(`per-IP limit: 429 after ${i} more requests (40 per 10 min in all)`);
}
console.log(`# all ${n} checks passed`);
