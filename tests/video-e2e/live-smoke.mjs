// live-smoke.mjs: the board (fikir.html) in headless Chrome against a local `wrangler dev` with worker/wrangler.toml as it
// is (FIKIR_IG_LIVE on, R2 copies off): Instagram videos play live in our own player, streamed through
// GET /api/inspire/posts/:id/play. Instagram itself is tests/media-e2e/fixture-server.mjs (/igfx/...): run-smoke.sh starts
// the worker with INSPIRE_TEST_IG=1, so every Instagram / Meta fetch of the worker goes there, and Chrome resolves no host
// name but 127.0.0.1 (--host-resolver-rules), so nothing reaches Instagram or any other site.
// usage: VIDEO_E2E_SCRIPT=live-smoke.mjs VIDEO_E2E_PUPPETEER=<dir with node_modules/puppeteer-core> tests/video-e2e/run-smoke.sh
// Checks (one result line each; every check runs, exit 1 when one failed):
//   A  a reel whose embed is blocked, no R2 copy, resolved by the cron: our player ("@user · Instagram", poster from
//      /play?part=image, caption, "Instagram'da aç"), never an Instagram iframe; the <video> plays (readyState >= 2,
//      currentTime advances); a seek is answered by a 206 Range response of /play
//   B  a reel added through the "Yeni Fikir Ekle" dialog becomes our player without a reload (POST /live), no iframe ever
//      inserted into its card
//   C  an Instagram photo post keeps the embed (iframe of /p/<code>/embed), no player; C2: a reel not resolved yet whose
//      page is gone (404) holds its embed while it asks POST /live, then shows the embed
//   D  a post with an R2 copy (post.media /files/fikir/...) plays from R2
//   E  /play failing (the fixture CDN refuses the reel's video): poster + "Video şu anda oynatılamıyor" + "Tekrar dene" +
//      "Instagram'da aç" in the player's place; "Tekrar dene" tries again (fresh token) and ends in the same box
//   F  İndir on the live post saves the video file (same bytes as the fixture CDN's file)
//   G  FIKIR_IG_LIVE="0" (a second worker on VIDEO_E2E_OFFPORT, fresh state): the old behaviour, the embed iframe
//   H  390 px wide (mobile emulation): the live card fits, no horizontal scroll
//   R  a list refresh (GET /posts) keeps the playing <video> (no rebuild, no new stream) and the failed card's box
// Screenshots: VIDEO_E2E_SHOTS. Browser console errors and page errors are printed at the end (page errors fail the run).
// Board password: the TEST value FIKIR_E2E_BOARD_PASSWORD (run-smoke.sh passes the same with --var). Never reads .dev.vars.
//   env: VIDEO_E2E_STATE, VIDEO_E2E_LOG, VIDEO_E2E_FX, VIDEO_E2E_DL, VIDEO_E2E_SHOTS, VIDEO_E2E_WEBPORT (4743),
//        VIDEO_E2E_OFFPORT (8843), VIDEO_E2E_PUPPETEER, FIXTURE_IG_LONG (the fixture CDN's long MP4, made by run-smoke.sh)
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { execFileSync, spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { sanitizeMedia } from '../../worker/inspire-media.js';

const BASE = process.argv[2] || 'http://127.0.0.1:8841';
const FXB = process.env.VIDEO_E2E_FX || 'http://127.0.0.1:4741';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const R = path.join(HERE, '../..');
const WORKER = path.join(R, 'worker');
const STATE = process.env.VIDEO_E2E_STATE;
const LOG = process.env.VIDEO_E2E_LOG;
const OUTDIR = STATE ? path.dirname(STATE) : null;
const SHOTS = process.env.VIDEO_E2E_SHOTS || (OUTDIR && path.join(OUTDIR, 'shots'));
const DL = process.env.VIDEO_E2E_DL || (OUTDIR && path.join(OUTDIR, 'dl'));
const WEBPORT = Number(process.env.VIDEO_E2E_WEBPORT || 4743);
const OFFPORT = Number(process.env.VIDEO_E2E_OFFPORT || 8843);
const PPT = process.env.VIDEO_E2E_PUPPETEER;
const BOARD_PW = process.env.FIKIR_E2E_BOARD_PASSWORD || 'test-board-pass';
const CHROME = process.env.VIDEO_E2E_CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const LONG = process.env.FIXTURE_IG_LONG && fs.existsSync(process.env.FIXTURE_IG_LONG) ? process.env.FIXTURE_IG_LONG : null;
if (!/^http:\/\/127\.0\.0\.1:\d+$/.test(BASE) || !/^http:\/\/127\.0\.0\.1:\d+$/.test(FXB)) throw new Error('local worker + fixture server only');
if ([WEBPORT, OFFPORT].includes(8765) || /:8765$/.test(BASE) || /:8765$/.test(FXB)) throw new Error('never 8765');
if (!STATE || !LOG) throw new Error('VIDEO_E2E_STATE and VIDEO_E2E_LOG are required (run through run-smoke.sh)');
if (!PPT || !fs.existsSync(path.join(PPT, 'node_modules/puppeteer-core'))) throw new Error('VIDEO_E2E_PUPPETEER: a folder with node_modules/puppeteer-core');
const puppeteer = createRequire(path.join(PPT, 'noop.js'))('puppeteer-core');
for (const d of [SHOTS, DL]) fs.mkdirSync(d, { recursive: true });
const WEB = `http://127.0.0.1:${WEBPORT}`;
const OFF = `http://127.0.0.1:${OFFPORT}`;
const CLIP = fs.readFileSync(path.join(R, 'tests/fixtures/media/clip.mp4'));
const IGFILE = LONG ? fs.readFileSync(LONG) : CLIP;   // what the fixture CDN serves for every reel
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const newCid = () => 'l' + Math.random().toString(36).slice(2) + Date.now().toString(36) + 'xxxxxxxx';
const q = (v) => (v == null ? 'NULL' : `'${String(v).replace(/'/g, "''")}'`);
const hex32 = () => [...Array(32)].map(() => Math.floor(Math.random() * 16).toString(16)).join('');

// ── results ──
const results = [];
async function check(id, name, fn) {
  const t0 = Date.now();
  try {
    const detail = await fn();
    results.push({ id, ok: true });
    console.log(`ok ${id} ${name}${detail ? ' — ' + detail : ''} (${Date.now() - t0} ms)`);
  } catch (e) {
    results.push({ id, ok: false });
    console.log(`not ok ${id} ${name} — ${String(e && e.stack || e).slice(0, 2000)}`);
  }
}

// ── the copy flags of the config the worker runs with stay as the owner set them (off) ──
const toml = fs.readFileSync(path.join(WORKER, 'wrangler.toml'), 'utf8');
const tomlVar = (k) => ((new RegExp(`^${k}\\s*=\\s*"([^"]*)"`, 'm').exec(toml)) || [])[1];
assert.equal(tomlVar('FIKIR_IG_LIVE'), '1');
assert.equal(tomlVar('FIKIR_IG_COPY'), '0');
assert.equal(tomlVar('FIKIR_COPY_VIEW'), '0');

// ── API helpers ──
async function fetchOnce(url, init) {
  try { return await fetch(url, init); }
  catch (e) {
    const code = e && e.cause && e.cause.code;
    if (!['UND_ERR_SOCKET', 'ECONNRESET', 'EPIPE'].includes(code)) throw e;
    return fetch(url, init);
  }
}
async function call(base, method, p, body, token) {
  const h = { 'X-Fikir-Client': '2' };
  if (body != null) h['Content-Type'] = 'application/json';
  if (token) h.Authorization = 'Bearer ' + token;
  const res = await fetchOnce(base + p, { method, headers: h, body: body == null ? undefined : JSON.stringify(body) });
  const text = await res.text();
  let data = null; try { data = JSON.parse(text); } catch (_) { data = text; }
  return { status: res.status, data, headers: res.headers };
}
async function guest(base, name) {
  const r = await call(base, 'POST', '/api/inspire/guest', { name, cid: newCid(), password: BOARD_PW });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  return { token: r.data.token };
}
function wr(args, state) {
  return execFileSync('npx', ['-y', 'wrangler@4', ...args, '--local', '-c', 'wrangler.toml', '--persist-to', state],
    { cwd: WORKER, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}
function d1(sql, state = STATE) {
  const out = wr(['d1', 'execute', 'vk-portfolio', '--json', '--command', sql], state);
  return JSON.parse(out.slice(out.indexOf('[')))[0].results;
}
const guestRow = `(SELECT id FROM inspire_users WHERE username='__guest__')`;
function seedPost(key, url, { media = null, state = STATE } = {}) {
  d1(`INSERT INTO inspire_posts (user_id, type, url, description, author_name, client_id, url_key, meta, media) VALUES (${guestRow}, 'instagram',
    ${q(url)}, '', 'Canlı Test', ${q(newCid())}, ${q('ltest:' + key + ':' + Date.now())}, NULL, ${q(media)})`, state);
  return d1(`SELECT id FROM inspire_posts WHERE url_key LIKE ${q('ltest:' + key + ':%')} ORDER BY id DESC LIMIT 1`, state)[0].id;
}
async function waitFor(fn, ms, label) {
  const t0 = Date.now();
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() - t0 > ms) throw new Error('timeout: ' + label);
    await sleep(400);
  }
}
const igCalls = async () => (await (await fetch(FXB + '/__igfx/calls')).json()).calls;

// ── static server for the board page (repo fikir.html + /assets) ──
const TYPES = { '.html': 'text/html; charset=utf-8', '.mjs': 'text/javascript', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.ico': 'image/x-icon', '.json': 'application/json', '.woff2': 'font/woff2' };
const web = http.createServer((req, res) => {
  let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (p === '/' || p === '/fikir' || p === '/fikir/') p = '/fikir.html';
  if (!(p === '/fikir.html' || p.startsWith('/assets/')) || p.includes('..')) { res.writeHead(404); res.end('nf'); return; }
  fs.readFile(path.join(R, p), (err, buf) => {
    if (err) { res.writeHead(404); res.end('nf'); return; }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(p)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(buf);
  });
});
await new Promise((r) => web.listen(WEBPORT, '127.0.0.1', r));

let browser = null, offProc = null;
const consoleErrors = [], pageErrors = [];
async function cleanup() {
  try { if (browser) await browser.close(); } catch (_) {}
  try { web.close(); } catch (_) {}
  if (offProc) { try { process.kill(-offProc.pid, 'SIGTERM'); } catch (_) {} }
  for (let i = 0; i < 20; i++) {
    let busy = '';
    try { busy = execFileSync('lsof', ['-nP', '-t', `-iTCP:${OFFPORT}`, '-sTCP:LISTEN'], { encoding: 'utf8' }).trim(); } catch (_) { busy = ''; }
    if (!busy) break;
    if (i === 10) for (const pid of busy.split('\n')) { try { process.kill(Number(pid), 'SIGKILL'); } catch (_) {} }
    await sleep(500);
  }
}

try {
  // ── setup: guest, config, posts (seeded straight into D1: no link-preview fetch) ──
  const g = await guest(BASE, 'Canlı Test');
  const cfg = await call(BASE, 'GET', '/api/inspire/config', null, g.token);
  assert.equal(cfg.status, 200);
  assert.equal(cfg.data.media.live, true, 'config.media.live with a session');
  assert.equal(cfg.data.media.ig_copy, false, 'R2 copies off (wrangler.toml)');
  assert.equal(cfg.data.media.copy_view, false);
  assert.equal((await call(BASE, 'GET', '/api/inspire/config')).data.media.live, false, 'no live flag without a session');
  console.log('# config: media.live true, ig_copy / copy_view false; fixture CDN file ' + (LONG ? `${path.basename(LONG)} ${IGFILE.length} bytes` : `clip.mp4 ${CLIP.length} bytes (no ffmpeg)`));

  // an R2 copy as inspireCopy stores it: two R2 objects, live inspire_media rows, post.media source instagram
  const r2Id = seedPost('r2', 'https://www.instagram.com/reel/DLiveR2c01/');
  const vKey = `fikir/${r2Id}/v-${hex32()}.mp4`, pKey = `fikir/${r2Id}/p-${hex32()}.jpg`;
  const tmpPoster = path.join(OUTDIR, 'r2-poster.jpg');
  fs.writeFileSync(tmpPoster, fs.readFileSync(path.join(R, 'tests/fixtures/media/poster.jpg')));
  wr(['r2', 'object', 'put', `vk-portfolio-files/${vKey}`, '--file', path.join(R, 'tests/fixtures/media/clip.mp4'), '--content-type', 'video/mp4'], STATE);
  wr(['r2', 'object', 'put', `vk-portfolio-files/${pKey}`, '--file', tmpPoster, '--content-type', 'image/jpeg'], STATE);
  const r2Media = sanitizeMedia({ kind: 'video', url: '/files/' + vKey, poster: '/files/' + pKey, w: 160, h: 90, mime: 'video/mp4', bytes: CLIP.length,
    verified: true, autoplay: true, source: 'instagram', by: 'ornek.kopya', caption: 'R2 kopyası altyazısı', audio: false }, { allowFiles: true });
  assert.ok(r2Media);
  const nowS = Math.floor(Date.now() / 1000);
  d1(`UPDATE inspire_posts SET media=${q(JSON.stringify(r2Media))} WHERE id=${r2Id}`);
  d1(`INSERT INTO inspire_media (key, post_id, slot, subject, mime, bytes, state, created_at) VALUES (${q(vKey)}, ${r2Id}, 'v', 'ig', 'video/mp4', ${CLIP.length}, 'live', ${nowS}),
    (${q(pKey)}, ${r2Id}, 'p', 'ig', 'image/jpeg', 795, 'live', ${nowS})`);
  const ids = {
    r2: r2Id,
    dead: seedPost('dead', 'https://www.instagram.com/reel/DLiveDead1/'),
    pho: seedPost('pho', 'https://www.instagram.com/p/DPhoLive01/'),
    blk: seedPost('blk', 'https://www.instagram.com/reel/DLiveBlk01/'),
  };
  console.log('# seeded ' + JSON.stringify(ids));

  // ── the cron ("7-59/15") resolves the Instagram backlog (2 per run, newest first; the R2 copy is skipped) ──
  await check('S1', 'cron resolves the Instagram backlog through the fixture; GET /posts: live / live_ask per post', async () => {
    const want = [ids.blk, ids.pho, ids.dead];
    const rows = () => d1(`SELECT post_id, error, url IS NOT NULL AS hv FROM inspire_video_cache WHERE kind='ig'`);
    for (let i = 0; i < 4 && want.some((id) => !rows().some((r) => r.post_id === id)); i++) {
      const before = rows().length;
      assert.equal((await fetchOnce(`${BASE}/__scheduled?cron=7-59/15+*+*+*+*`)).status, 200);
      await waitFor(() => rows().length > before || rows().length >= want.length, 30000, 'cron live resolve');
      await sleep(4000);   // the run paces its resolves 3 s apart
    }
    const got = rows();
    for (const id of want) assert.ok(got.some((r) => r.post_id === id && !r.error), `resolved ${id}: ${JSON.stringify(got)}`);
    assert.ok(!got.some((r) => r.post_id === ids.r2), 'the R2 copy is not resolved');
    const pages = (await igCalls()).filter((c) => c.host === 'www.instagram.com');
    assert.ok(pages.length >= 3, 'page fetches went to the fixture: ' + JSON.stringify(pages));
    const b = Object.fromEntries((await call(BASE, 'GET', '/api/inspire/posts', null, g.token)).data.map((p) => [p.id, p]));
    const L = b[ids.blk].live;
    assert.ok(L, 'blk.live');
    assert.match(L.url, new RegExp(`^/api/inspire/posts/${ids.blk}/play\\?part=video&t=[0-9a-z]+\\.[A-Za-z0-9_-]{22}$`));
    assert.match(L.poster, new RegExp(`^/api/inspire/posts/${ids.blk}/play\\?part=image&t=`));
    assert.deepEqual({ by: L.by, w: L.w, h: L.h, audio: L.audio }, { by: 'ornek.studio', w: 720, h: 1280, audio: true });
    assert.match(L.caption, /^Şehir ışıkları DLiveBlk01/);
    assert.ok(!/cdninstagram|fbcdn/.test(JSON.stringify(b[ids.blk])), 'never a CDN link');
    assert.equal(b[ids.blk].live_ask, false);
    assert.deepEqual([b[ids.pho].live, b[ids.pho].live_ask], [null, false], 'photo: no live, not asked');
    assert.ok(b[ids.dead].live, 'dead.live (the page resolves; only its CDN file fails)');
    assert.deepEqual([b[ids.r2].live, b[ids.r2].live_ask], [null, false], 'R2 copy: plays the copy');
    assert.match(b[ids.r2].media.url, /^\/files\/fikir\/\d+\/v-[0-9a-f]{32}\.mp4\?t=/);
    return `ig rows ${got.length}, fixture page fetches ${pages.length}`;
  });

  // not resolved yet when the board opens (live_ask): its card asks POST /live; the fixture answers 404 (removed post)
  ids.gone = seedPost('gone', 'https://www.instagram.com/reel/DLiveGone1/');

  // ── browser ──
  browser = await puppeteer.launch({ executablePath: CHROME, headless: true,
    args: ['--no-first-run', '--no-default-browser-check', '--autoplay-policy=no-user-gesture-required', '--lang=tr-TR',
      '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1'] });
  const T0 = Date.now();
  // every page: console errors, page errors, /play + /live + POST /posts traffic, iframes inserted (with their card)
  async function preparePage(page, label, api) {
    const net = { play: [], live: [], created: [], navs: 0, lists: 0, external: new Set() };
    page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(`[${label}] ${m.text().slice(0, 300)}`); });
    page.on('pageerror', (e) => pageErrors.push(`[${label}] ${String(e && e.message || e).slice(0, 300)}`));
    page.on('request', (req) => {
      const u = req.url();
      if (/^https?:/.test(u) && !u.startsWith(WEB + '/') && !u.startsWith(api + '/')) { try { net.external.add(new URL(u).host); } catch (_) {} }
      const m = /\/api\/inspire\/posts\/(\d+)\/live$/.exec(u.split('?')[0]);
      if (m && req.method() === 'POST') net.live.push({ id: Number(m[1]), t: Date.now(), body: req.postData() || null });
    });
    page.on('response', async (res) => {
      const u = res.url();
      const m = /\/api\/inspire\/posts\/(\d+)\/play\?part=(video|image)/.exec(u);
      if (m) net.play.push({ id: Number(m[1]), part: m[2], status: res.status(), range: res.request().headers().range || null, ct: res.headers()['content-type'] || '', t: Date.now() });
      if (u === api + '/api/inspire/posts' && res.request().method() === 'POST') { try { net.created.push(await res.json()); } catch (_) {} }
      if (/\/api\/inspire\/posts(\?|$)/.test(u.slice(api.length)) && res.request().method() === 'GET' && u.startsWith(api)) net.lists++;
    });
    page.on('framenavigated', (f) => { if (f === page.mainFrame()) net.navs++; });
    await page.evaluateOnNewDocument(() => {
      window.__ifr = [];
      const seen = (f) => { const c = f.closest('.post-card'); window.__ifr.push({ el: f, card: c ? c.dataset.id : null, modal: !!f.closest('#add-modal'), t: Date.now() }); };
      new MutationObserver((muts) => {
        for (const mu of muts) for (const n of mu.addedNodes) {
          if (n.nodeType !== 1) continue;
          if (n.tagName === 'IFRAME') seen(n);
          else for (const f of n.querySelectorAll('iframe')) seen(f);
        }
      }).observe(document, { subtree: true, childList: true });
    });
    return net;
  }
  const iframes = (page) => page.evaluate(() => window.__ifr.map((x) => ({ src: x.el.src || x.el.getAttribute('src') || '', card: x.card, modal: x.modal, t: x.t })));
  async function login(page, api) {
    await page.goto(`${WEB}/fikir.html?api=${encodeURIComponent(api)}`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('#entry-screen:not([hidden])', { timeout: 20000 });
    await page.type('#guest-pass', BOARD_PW);
    await page.click('#guest-btn');
    await page.waitForSelector('#dashboard:not([hidden])', { timeout: 20000 });
  }
  const card = (id) => `.post-card[data-id="${id}"]`;
  async function shot(page, id, name) {
    const el = id == null ? null : await page.$(card(id));
    if (el) await el.screenshot({ path: path.join(SHOTS, name) });
    else await page.screenshot({ path: path.join(SHOTS, name) });
    return path.join(SHOTS, name);
  }
  async function playing(page, sel, ms = 30000) {
    await page.$eval(sel, (el) => el.scrollIntoView({ block: 'center' }));
    await page.waitForFunction((s) => { const v = document.querySelector(s); return v && v.readyState >= 2 && v.currentTime > 0; }, { timeout: ms, polling: 200 }, sel);
    const t1 = await page.$eval(sel, (v) => v.currentTime);
    await sleep(900);
    const t2 = await page.$eval(sel, (v) => v.currentTime);
    assert.ok(t2 > t1 || t2 < t1 - 0.5, `currentTime advances (${t1} -> ${t2})`);
    return { t1, t2, rs: await page.$eval(sel, (v) => v.readyState), src: await page.$eval(sel, (v) => v.currentSrc || v.src) };
  }
  async function liveCardFacts(page, id) {
    return page.$eval(card(id), (c) => ({
      user: (c.querySelector('.ig-head .ig-user') || {}).textContent || '',
      site: (c.querySelector('.ig-head .ig-site') || {}).textContent || '',
      open: c.querySelector('.ig-head .ig-open') ? [c.querySelector('.ig-head .ig-open').textContent, c.querySelector('.ig-head .ig-open').href] : null,
      cap: (c.querySelector('.ig-cap') || {}).textContent || '',
      igcopy: !!c.querySelector('.media-igcopy'), embed: !!c.querySelector('.media-ig'), iframe: !!c.querySelector('iframe'),
      text: c.innerText,
    }));
  }

  const page = await browser.newPage();
  await page.setViewport({ width: 1360, height: 1000, deviceScaleFactor: 1 });
  const net = await preparePage(page, 'desktop', BASE);
  await login(page, BASE);
  await page.waitForSelector(card(ids.blk), { timeout: 20000 });
  await sleep(1500);
  await shot(page, null, '0-board-desktop.png');

  await check('A', 'blocked reel without R2 copy: our player (@user · Instagram, poster via /play?part=image, caption), plays, seek -> 206 from /play', async () => {
    const vsel = `${card(ids.blk)} .media-igcopy video`;
    await page.$eval(card(ids.blk), (el) => el.scrollIntoView({ block: 'center' }));
    // poster: the <img> of the player box, from /play?part=image
    const poster = await page.waitForFunction((s) => { const i = document.querySelector(s); return i && i.complete && i.naturalWidth > 0 ? i.src : null; },
      { timeout: 20000, polling: 100 }, `${card(ids.blk)} .media-igcopy .facade-thumb`).then((h) => h.jsonValue()).catch(() => null);
    const posterRes = net.play.filter((x) => x.id === ids.blk && x.part === 'image');
    assert.ok(posterRes.some((x) => x.status === 200 && /^image\//.test(x.ct)), 'poster loaded via /play?part=image: ' + JSON.stringify(posterRes));
    const f = await liveCardFacts(page, ids.blk);
    assert.equal(f.igcopy, true, 'our player layout');
    assert.equal(f.embed, false, 'no embed layout');
    assert.equal(f.user, '@ornek.studio');
    assert.equal(f.site, '· Instagram');
    assert.deepEqual(f.open, ["Instagram'da aç ↗", 'https://www.instagram.com/reel/DLiveBlk01/']);
    assert.match(f.cap, /Şehir ışıkları DLiveBlk01/);
    assert.ok(!/Instagram'da İzle/.test(f.text), 'never "Instagram\'da İzle"');
    const p = await playing(page, vsel);
    assert.ok(p.src.startsWith(`${BASE}/api/inspire/posts/${ids.blk}/play?part=video&t=`), p.src);
    assert.ok((await iframes(page)).every((x) => x.card !== String(ids.blk)), 'no iframe ever inserted into the card');
    await shot(page, ids.blk, 'A1-live-card-playing.png');
    // seek near the end: the browser asks /play for that part of the file (a Range request answered 206)
    const t0 = Date.now();
    const dur = await page.$eval(vsel, (v) => v.duration);
    await page.$eval(vsel, (v, d) => { v.currentTime = Math.max(0, d * 0.85); }, dur);
    await page.waitForFunction((s, target) => { const v = document.querySelector(s); return v && !v.seeking && v.currentTime >= target - 0.6 && v.readyState >= 2; },
      { timeout: 30000, polling: 100 }, vsel, dur * 0.85);
    await sleep(700);
    const vids = net.play.filter((x) => x.id === ids.blk && x.part === 'video');
    const after = vids.filter((x) => x.t >= t0 && x.status === 206 && /^bytes=[1-9]\d*-/.test(x.range || ''));
    const all206 = vids.filter((x) => x.status === 206);
    assert.ok(all206.length > 0, 'the video is streamed with Range (206): ' + JSON.stringify(vids));
    if (LONG) assert.ok(after.length > 0, 'a seek sends a Range request from a later byte, answered 206: ' + JSON.stringify(vids.map((x) => [x.status, x.range])));
    const cdn = (await igCalls()).filter((c) => c.path.endsWith('/DLiveBlk01.mp4'));
    assert.ok(cdn.some((c) => c.status === 206 && /^bytes=[1-9]/.test(c.range || '')), 'the Range reached the (fixture) CDN: ' + JSON.stringify(cdn.map((c) => [c.status, c.range])));
    await shot(page, ids.blk, 'A2-live-card-after-seek.png');
    return `poster ${poster ? 'shown' : 'replaced by the playing video'}, rs ${p.rs}, t ${p.t1.toFixed(2)}->${p.t2.toFixed(2)}, /play video responses ${vids.map((x) => `${x.status}${x.range ? ' ' + x.range : ''}`).join(', ')}${LONG ? '' : ' (seek check needs the long clip: ffmpeg missing)'}`;
  });

  await check('C', 'Instagram photo post keeps the embed (iframe /p/<code>/embed), no player', async () => {
    await page.$eval(card(ids.pho), (el) => el.scrollIntoView({ block: 'center' }));
    await page.waitForFunction((s) => !!document.querySelector(s), { timeout: 20000 }, `${card(ids.pho)} iframe`);
    const f = await liveCardFacts(page, ids.pho);
    assert.equal(f.igcopy, false); assert.equal(f.embed, true);
    const fr = (await iframes(page)).filter((x) => x.card === String(ids.pho));
    assert.ok(fr.length >= 1 && fr.every((x) => /^https:\/\/www\.instagram\.com\/p\/DPhoLive01\/embed/.test(x.src)), JSON.stringify(fr));
    assert.ok(!net.play.some((x) => x.id === ids.pho), 'no /play for a photo');
    await shot(page, ids.pho, 'C-photo-embed.png');
    return fr[0].src;
  });

  await check('C2', 'a reel not resolved yet whose page is gone: the card holds its embed while it asks POST /live, then gets the embed', async () => {
    await page.$eval(card(ids.gone), (el) => el.scrollIntoView({ block: 'center' }));
    await page.waitForFunction((s) => !!document.querySelector(s), { timeout: 30000 }, `${card(ids.gone)} iframe`);
    const ask = net.live.filter((x) => x.id === ids.gone);
    assert.equal(ask.length, 1, 'asked once');
    const fr = (await iframes(page)).filter((x) => x.card === String(ids.gone));
    assert.ok(fr[0].t >= ask[0].t, `the iframe came after the ask (${fr[0].t - ask[0].t} ms)`);
    assert.match(fr[0].src, /^https:\/\/www\.instagram\.com\/reel\/DLiveGone1\/embed/);
    assert.equal(await page.$(`${card(ids.gone)} .media-igcopy`), null);
    const b = (await call(BASE, 'GET', '/api/inspire/posts', null, g.token)).data.find((p) => p.id === ids.gone);
    assert.deepEqual([b.live, b.live_ask], [null, false], 'never asked again');
    await shot(page, ids.gone, 'C2-gone-reel-embed.png');
    return `iframe ${fr[0].t - ask[0].t} ms after the ask`;
  });

  await check('D', 'post with an R2 copy plays from R2 (/files/fikir/...)', async () => {
    const vsel = `${card(ids.r2)} .media-igcopy video`;
    await page.$eval(card(ids.r2), (el) => el.scrollIntoView({ block: 'center' }));
    await page.waitForSelector(vsel, { timeout: 20000 });
    const p = await playing(page, vsel);
    assert.ok(p.src.startsWith(`${BASE}/files/fikir/${ids.r2}/v-`) && p.src.includes('?t='), p.src);
    const f = await liveCardFacts(page, ids.r2);
    assert.equal(f.user, '@ornek.kopya'); assert.equal(f.site, '· Instagram'); assert.match(f.cap, /R2 kopyası altyazısı/);
    assert.ok(!net.play.some((x) => x.id === ids.r2), 'never /play');
    await shot(page, ids.r2, 'D-r2-copy-playing.png');
    return p.src.replace(/\?t=.*/, '?t=…');
  });

  await check('E', '/play failing: poster + "Video şu anda oynatılamıyor" + "Tekrar dene" + "Instagram\'da aç", never a broken box or the embed; Tekrar dene retries', async () => {
    const c = card(ids.dead);
    await page.$eval(c, (el) => el.scrollIntoView({ block: 'center' }));
    await page.waitForSelector(`${c} .live-dead-msg`, { timeout: 45000 });
    const facts = async () => page.$eval(c, (el) => {
      const box = el.querySelector('.media-box.live-dead');
      const r = box ? box.getBoundingClientRect() : null;
      const img = box && box.querySelector('.facade-thumb');
      return { msg: (el.querySelector('.live-dead-msg span') || {}).textContent, btn: (el.querySelector('.live-dead-msg [data-action="live-retry"]') || {}).textContent,
        w: r ? Math.round(r.width) : 0, h: r ? Math.round(r.height) : 0, poster: img ? img.complete && img.naturalWidth > 0 : false,
        video: !!el.querySelector('video'), iframe: !!el.querySelector('iframe'), embed: !!el.querySelector('.media-ig'),
        open: el.querySelector('.ig-head .ig-open') ? el.querySelector('.ig-head .ig-open').textContent : null,
        user: (el.querySelector('.ig-head .ig-user') || {}).textContent || '' };
    });
    await sleep(500);
    const f1 = await facts();
    assert.equal(f1.msg, 'Video şu anda oynatılamıyor'); assert.equal(f1.btn, 'Tekrar dene');
    assert.equal(f1.open, "Instagram'da aç ↗"); assert.equal(f1.user, '@ornek.studio');
    assert.ok(f1.w > 150 && f1.h > 150, `the player's size kept: ${f1.w}x${f1.h}`);
    assert.equal(f1.poster, true, 'the poster is shown (dimmed)');
    assert.deepEqual([f1.video, f1.iframe, f1.embed], [false, false, false]);
    const plays = net.play.filter((x) => x.id === ids.dead && x.part === 'video');
    assert.ok(plays.length >= 1 && plays.every((x) => x.status === 502), 'every /play of it failed (502): ' + JSON.stringify(plays.map((x) => x.status)));
    const lives = net.live.filter((x) => x.id === ids.dead);
    assert.ok(lives.some((x) => /"refresh":true/.test(x.body || '')), 'a fresh token was asked for once (POST /live {refresh: true})');
    await shot(page, ids.dead, 'E1-live-dead-box.png');
    // "Tekrar dene": the player again with a fresh token, then the same box
    const n0 = net.live.filter((x) => x.id === ids.dead).length, p0 = plays.length;
    await page.click(`${c} .live-dead-msg [data-action="live-retry"]`);
    await waitFor(() => net.live.filter((x) => x.id === ids.dead).length > n0, 15000, 'retry asks POST /live');
    await page.waitForSelector(`${c} .live-dead-msg`, { timeout: 45000 });
    await sleep(300);
    const f2 = await facts();
    assert.equal(f2.msg, 'Video şu anda oynatılamıyor'); assert.deepEqual([f2.iframe, f2.embed], [false, false]);
    assert.ok(net.play.filter((x) => x.id === ids.dead && x.part === 'video').length > p0, 'the retry tried /play again');
    await shot(page, ids.dead, 'E2-live-dead-after-retry.png');
    return `box ${f1.w}x${f1.h}, /play video statuses ${plays.map((x) => x.status).join(',')}, live asks ${lives.length} -> ${net.live.filter((x) => x.id === ids.dead).length}`;
  });

  await check('F', 'İndir on the live post saves the video (same bytes as the fixture CDN file)', async () => {
    for (const f of fs.readdirSync(DL)) fs.rmSync(path.join(DL, f), { force: true, recursive: true });
    const cdp = await browser.target().createCDPSession();
    await cdp.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: DL, eventsEnabled: true });
    await page.$eval(card(ids.blk), (el) => el.scrollIntoView({ block: 'center' }));
    await page.waitForSelector(`${card(ids.blk)} .dl-btn:not([hidden])`, { timeout: 10000 });
    await page.click(`${card(ids.blk)} .dl-btn`);
    const got = await waitFor(() => fs.readdirSync(DL).find((f) => /\.mp4$/.test(f)), 60000, 'download saved');
    await waitFor(() => fs.statSync(path.join(DL, got)).size === IGFILE.length, 30000, 'download complete');
    assert.ok(fs.readFileSync(path.join(DL, got)).equals(IGFILE), 'same bytes');
    assert.match(got, /DLiveBlk01\.mp4$/);
    await cdp.detach();
    return `${got} ${IGFILE.length} bytes`;
  });

  await check('B', 'a reel added through "Yeni Fikir Ekle" becomes our player without a reload (POST /live), no iframe in its card', async () => {
    const navs0 = net.navs;
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.click('#btn-add');
    await page.waitForSelector('#add-modal:not([hidden])');
    await page.click('#tab-link');
    await page.type('#link-url', 'https://www.instagram.com/reel/DLiveNew01/');
    await page.waitForFunction(() => !document.querySelector('#link-submit').disabled, { timeout: 15000 });
    await sleep(500);
    await shot(page, null, 'B0-add-dialog.png');
    await page.click('#link-submit');
    const created = await waitFor(() => net.created.find((p) => p && /DLiveNew01/.test(p.url || '')), 20000, 'POST /posts answered');
    assert.equal(created.live_ask, true, 'a new Instagram post is asked for');
    assert.equal(created.live, null);
    const id = created.id;
    const vsel = `${card(id)} .media-igcopy video`;
    await page.waitForSelector(card(id), { timeout: 15000 });
    await page.waitForSelector(vsel, { timeout: 30000 });
    const p = await playing(page, vsel);
    assert.ok(p.src.startsWith(`${BASE}/api/inspire/posts/${id}/play?part=video&t=`), p.src);
    assert.ok(net.live.some((x) => x.id === id), 'the card asked POST /live');
    assert.equal(net.navs, navs0, 'no reload');
    const fr = await iframes(page);
    assert.ok(fr.every((x) => x.card !== String(id)), 'no iframe ever inserted into the new card: ' + JSON.stringify(fr.filter((x) => x.card === String(id))));
    const f = await liveCardFacts(page, id);
    assert.equal(f.user, '@ornek.studio'); assert.match(f.cap, /Şehir ışıkları DLiveNew01/);
    await shot(page, id, 'B1-new-reel-live.png');
    const modal = fr.filter((x) => x.modal);
    return `post ${id}, POST /live ${net.live.filter((x) => x.id === id).length}x, t ${p.t1.toFixed(2)}->${p.t2.toFixed(2)}; iframes in the add dialog: ${modal.length ? modal.map((x) => x.src.slice(0, 70)).join(' ') : 'none'}`;
  });

  await check('R', 'a board refresh (GET /posts) leaves the live cards alone: same playing <video>, no new stream, the failed card keeps its box', async () => {
    const vsel = `${card(ids.blk)} .media-igcopy video`;
    await page.$eval(card(ids.blk), (el) => el.scrollIntoView({ block: 'center' }));
    await playing(page, vsel);
    await page.$eval(vsel, (v) => { v.__mark = 'kept'; });
    const t0 = Date.now(), lists0 = net.lists;
    // the board reloads its list when the tab becomes visible again after a while: Date.now jumps an hour for that moment
    await page.evaluate(() => { window.__realNow = Date.now; Date.now = () => window.__realNow() + 3600e3; document.dispatchEvent(new Event('visibilitychange')); });
    await waitFor(() => net.lists > lists0, 15000, 'GET /posts after visibilitychange');
    await sleep(2000);
    await page.evaluate(() => { Date.now = window.__realNow; });
    assert.equal(await page.$eval(vsel, (v) => v.__mark), 'kept', 'the same <video> element');
    const p = await playing(page, vsel);
    const opened = net.play.filter((x) => x.id === ids.blk && x.part === 'video' && x.t >= t0 && /^bytes=0-/.test(x.range || ''));
    assert.equal(opened.length, 0, 'no new stream from byte 0: ' + JSON.stringify(opened));
    assert.ok(await page.$(`${card(ids.dead)} .live-dead-msg`), 'the failed card keeps "Video şu anda oynatılamıyor"');
    assert.equal(await page.$(`${card(ids.dead)} iframe`), null);
    return `lists ${lists0} -> ${net.lists}, t ${p.t1.toFixed(2)}->${p.t2.toFixed(2)}`;
  });

  await check('H', 'mobile 390 px: the live card fits (no horizontal scroll), player + header + caption', async () => {
    const ctx = await browser.createBrowserContext();
    const m = await ctx.newPage();
    await m.emulate({ viewport: { width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
      userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1' });
    await preparePage(m, 'mobile', BASE);
    await login(m, BASE);
    await m.waitForSelector(card(ids.blk), { timeout: 20000 });
    await m.$eval(card(ids.blk), (el) => el.scrollIntoView({ block: 'start' }));
    await m.waitForSelector(`${card(ids.blk)} .media-igcopy video, ${card(ids.blk)} .media-igcopy .facade-thumb`, { timeout: 20000 });
    await sleep(2500);
    const lay = await m.evaluate((s) => {
      const c = document.querySelector(s).getBoundingClientRect();
      const box = document.querySelector(s + ' .media-igcopy .media-box').getBoundingClientRect();
      return { sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth, left: c.left, right: c.right, bw: box.width, bh: box.height,
        head: document.querySelector(s + ' .ig-head').innerText.replace(/\s+/g, ' '), cap: !!document.querySelector(s + ' .ig-cap') };
    }, card(ids.blk));
    assert.ok(lay.sw <= 390, `no horizontal scroll: ${lay.sw}`);
    assert.ok(lay.left >= 0 && lay.right <= 390, `card inside the viewport: ${lay.left}..${lay.right}`);
    assert.ok(lay.bw > 200 && lay.bh > 300, `player box ${lay.bw}x${lay.bh}`);
    assert.match(lay.head, /@ornek\.studio/);
    assert.ok(lay.cap);
    await m.screenshot({ path: path.join(SHOTS, 'H-mobile-390-viewport.png') });
    await shot(m, ids.blk, 'H-mobile-390-card.png');
    await ctx.close();
    return `card ${Math.round(lay.left)}..${Math.round(lay.right)}, box ${Math.round(lay.bw)}x${Math.round(lay.bh)}, head "${lay.head}"`;
  });

  await check('G', 'FIKIR_IG_LIVE="0" (second worker, fresh state): the old embed, no live fields, no /play', async () => {
    const offState = path.join(OUTDIR, 'state-off');
    fs.rmSync(offState, { recursive: true, force: true }); fs.mkdirSync(offState, { recursive: true });
    const logPath = path.join(OUTDIR, 'logs', 'worker-off.log');
    const out = fs.openSync(logPath, 'w');
    const fx = FXB.replace('http://', '');
    offProc = spawn('npx', ['-y', 'wrangler@4', 'dev', '-c', 'wrangler.toml', '--local', '--ip', '127.0.0.1', '--port', String(OFFPORT), '--persist-to', offState,
      '--show-interactive-dev-session=false', '--var', `ALLOWED_ORIGIN:${FXB}`, '--var', `INSPIRE_TEST_FETCH_ALLOW:${fx}`, '--var', 'INSPIRE_TEST_IG:1',
      '--var', 'FIKIR_BR:0', '--var', 'SB_ENABLED:0', '--var', 'FIKIR_IG_CRON_CHECKS:0', '--var', 'FIKIR_IG_LIVE:0', '--var', `FIKIR_BOARD_PASSWORD:${BOARD_PW}`],
    { cwd: WORKER, stdio: ['ignore', out, out], detached: true });
    await waitFor(() => /Ready on/.test(fs.readFileSync(logPath, 'utf8')), 90000, 'second worker ready');
    const g2 = await guest(OFF, 'Kapalı');
    const c2 = await call(OFF, 'GET', '/api/inspire/config', null, g2.token);
    assert.equal(c2.data.media.live, false);
    const offId = seedPost('off', 'https://www.instagram.com/reel/DLiveOff01/', { state: offState });
    const list = await call(OFF, 'GET', '/api/inspire/posts', null, g2.token);
    const p = list.data.find((x) => x.id === offId);
    assert.ok(p && p.live == null && p.live_ask !== true, 'no live fields: ' + JSON.stringify(p && { live: p.live, live_ask: p.live_ask }));
    const ctx = await browser.createBrowserContext();
    const pg = await ctx.newPage();
    await pg.setViewport({ width: 1360, height: 1000, deviceScaleFactor: 1 });
    const n2 = await preparePage(pg, 'live-off', OFF);
    await login(pg, OFF);
    await pg.waitForSelector(card(offId), { timeout: 20000 });
    await pg.waitForFunction((s) => !!document.querySelector(s), { timeout: 20000 }, `${card(offId)} iframe`);
    const fr = (await iframes(pg)).filter((x) => x.card === String(offId));
    assert.ok(fr.length && /^https:\/\/www\.instagram\.com\/reel\/DLiveOff01\/embed/.test(fr[0].src), JSON.stringify(fr));
    assert.equal(await pg.$(`${card(offId)} .media-igcopy`), null);
    await sleep(800);
    assert.equal(n2.play.length + n2.live.length, 0, 'no /play, no /live');
    await shot(pg, offId, 'G-live-off-embed.png');
    await ctx.close();
    return fr[0].src;
  });

  // nothing left the machine from the browser (every other host fails to resolve); list what the board tried
  console.log('# external hosts the board tried (not resolved, nothing sent): ' + ([...net.external].join(', ') || 'none'));
  const igc = await igCalls();
  console.log(`# fixture Instagram traffic: ${igc.length} requests (${[...new Set(igc.map((c) => c.host))].join(', ')})`);
} catch (e) {
  results.push({ id: 'setup', ok: false });
  console.log('not ok setup — ' + String(e && e.stack || e).slice(0, 2000));
} finally {
  await cleanup();
}
const noise = (s) => /ERR_NAME_NOT_RESOLVED|status of 502|status of 404 \(Not Found\)/.test(s);
console.log(`# browser console errors: ${consoleErrors.length} (${consoleErrors.filter((s) => !noise(s)).length} other than failed external lookups / the expected 502s of /play)`);
for (const s of [...new Set(consoleErrors)].slice(0, 40)) console.log('#   ' + s);
console.log(`# page errors: ${pageErrors.length}`);
for (const s of pageErrors) console.log('#   ' + s);
if (pageErrors.length) results.push({ id: 'pageerrors', ok: false });
console.log(`# screenshots: ${SHOTS}`);
const bad = results.filter((r) => !r.ok);
console.log(bad.length ? `# FAILED: ${bad.map((r) => r.id).join(', ')}` : `# all ${results.length} checks passed`);
process.exit(bad.length ? 1 : 0);
