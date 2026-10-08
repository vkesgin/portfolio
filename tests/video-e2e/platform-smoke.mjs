// platform-smoke.mjs: one-click downloads of real posts of every platform against a local `wrangler dev`
// (VIDEO_E2E_SCRIPT=platform-smoke.mjs tests/video-e2e/run-smoke.sh). Posts are created through the API as a guest, then
// download-info + download (files saved to VIDEO_E2E_DL, checked: magic bytes, Content-Length = size, MP4 tracks,
// Content-Disposition file name), an Instagram R2 copy, cache reuse (worker log), rate-limit buckets, invalid ids, text
// posts and a missing reel. Talks to the real Instagram (3 page fetches + the post-creation previews), X, Pinterest,
// TikTok, Facebook, Reddit, YouTube/Vimeo (previews only): opt-in with VIDEO_E2E_REAL=1. Requests are spaced out.
// usage: VIDEO_E2E_REAL=1 node tests/video-e2e/platform-smoke.mjs <base=http://127.0.0.1:8841>
//   env: VIDEO_E2E_STATE (--persist-to dir), VIDEO_E2E_LOG (worker log file), VIDEO_E2E_DL (download dir),
//        VIDEO_E2E_FX (fixture server), VIDEO_E2E_CONFIG / VIDEO_E2E_DB, VIDEO_E2E_SKIP_IG=1 (no Instagram posts / copy)
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { children } from '../../worker/cmaf-mux.js';

const BASE = process.argv[2] || 'http://127.0.0.1:8841';
const FXB = process.env.VIDEO_E2E_FX || 'http://127.0.0.1:4741';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const WORKER = path.join(HERE, '../../worker');
const STATE = process.env.VIDEO_E2E_STATE;
const LOG = process.env.VIDEO_E2E_LOG;
const DLDIR = process.env.VIDEO_E2E_DL || path.join(STATE || '.', '../dl');
const CONFIG = process.env.VIDEO_E2E_CONFIG || 'wrangler.toml';
const DB = process.env.VIDEO_E2E_DB || 'vk-portfolio';
if (process.env.VIDEO_E2E_REAL !== '1') { console.log('# skipped: set VIDEO_E2E_REAL=1 (talks to the real platforms)'); process.exit(0); }
if (!/^http:\/\/127\.0\.0\.1:\d+$/.test(BASE)) throw new Error('local worker only');
if (!STATE || !LOG) throw new Error('VIDEO_E2E_STATE and VIDEO_E2E_LOG are required');
fs.mkdirSync(DLDIR, { recursive: true });

let n = 0;
const ok = (msg) => console.log(`ok ${++n} ${msg}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const newCid = () => 'p' + Math.random().toString(36).slice(2) + Date.now().toString(36) + 'xxxxxxxx';
async function fetchOnce(url, init) {
  try { return await fetch(url, init); }
  catch (e) {
    const code = e && e.cause && e.cause.code;
    if (!['UND_ERR_SOCKET', 'ECONNRESET', 'EPIPE'].includes(code)) throw e;
    return fetch(url, init);
  }
}
async function call(method, p, body, token, headers = {}) {
  const h = { 'X-Fikir-Client': '2', ...headers };
  if (body != null) h['Content-Type'] = 'application/json';
  if (token) h.Authorization = 'Bearer ' + token;
  const res = await fetchOnce(BASE + p, { method, headers: h, body: body == null ? undefined : JSON.stringify(body) });
  const text = await res.text();
  let data = null; try { data = JSON.parse(text); } catch (_) { data = text; }
  return { status: res.status, data, headers: res.headers };
}
async function dl(id, q = '', headers = {}) {
  const t0 = Date.now();
  const res = await fetchOnce(`${BASE}/api/inspire/posts/${id}/download${q}`, { headers: { Accept: 'text/html,application/xhtml+xml,*/*;q=0.8', ...headers } });
  const buf = Buffer.from(await res.arrayBuffer());
  return { status: res.status, headers: res.headers, buf, ms: Date.now() - t0, text: () => buf.toString('utf8') };
}
function d1(sql) {
  const out = execFileSync('npx', ['-y', 'wrangler@4', 'd1', 'execute', DB, '--local', '-c', CONFIG, '--persist-to', STATE, '--json', '--command', sql],
    { cwd: WORKER, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  return JSON.parse(out.slice(out.indexOf('[')))[0].results;
}
const logCount = (re) => fs.readFileSync(LOG, 'utf8').split('\n').filter((l) => re.test(l)).length;
const cd = (h) => h.get('content-disposition') || '';
const asciiName = (h) => (/filename="([^"]*)"/.exec(cd(h)) || [])[1];
const utfName = (h) => { const m = /filename\*=UTF-8''(\S+)/.exec(cd(h)); return m ? decodeURIComponent(m[1]) : null; };
function magic(b) {
  if (b.subarray(4, 8).toString('latin1') === 'ftyp') return 'mp4';
  if (b[0] === 0xFF && b[1] === 0xD8 && b[2] === 0xFF) return 'jpg';
  if (b.subarray(1, 4).toString('latin1') === 'PNG') return 'png';
  if (b.subarray(0, 4).toString('latin1') === 'RIFF' && b.subarray(8, 12).toString('latin1') === 'WEBP') return 'webp';
  return null;
}
// handler types of the tracks of an MP4 held in memory (moov anywhere at the top level)
function tracks(b) {
  const u8 = new Uint8Array(b.buffer, b.byteOffset, b.length);
  const moov = children(u8).find((x) => x.type === 'moov');
  if (!moov) return [];
  return children(u8, moov.start + moov.hdr, moov.end).filter((x) => x.type === 'trak').map((t) => {
    const mdia = children(u8, t.start + 8, t.end).find((x) => x.type === 'mdia');
    const hdlr = mdia && children(u8, mdia.start + 8, mdia.end).find((x) => x.type === 'hdlr');
    return hdlr ? String.fromCharCode(...u8.subarray(hdlr.start + 16, hdlr.start + 20)) : '?';
  });
}
const rows = [];
function save(name, r) {
  const ext = magic(r.buf) || 'bin';
  const f = path.join(DLDIR, `${name}.${ext}`);
  fs.writeFileSync(f, r.buf);
  return f;
}

// ── posts through the API as a guest ──
const g = await (async () => { const r = await call('POST', '/api/inspire/guest', { name: 'Platform Test', cid: newCid() }); assert.equal(r.status, 200); return r.data; })();
const POSTS = [
  { key: 'igBlocked', url: 'https://www.instagram.com/reel/DRUcmHMjeLZ/', ig: true, video: true, file: /^instagram-[A-Za-z0-9._]+-DRUcmHMjeLZ\.mp4$/ },
  { key: 'igOk', url: 'https://www.instagram.com/reel/DW9tQ1fkrBR/', ig: true, video: true, file: /^instagram-[A-Za-z0-9._]+-DW9tQ1fkrBR\.mp4$/ },
  { key: 'x', url: 'https://twitter.com/i/web/status/910031516746514432', video: true, file: /^x-[A-Za-z0-9_]+-910031516746514432\.mp4$/ },
  { key: 'pinterest', url: 'https://tr.pinterest.com/pin/654147914671443316/', video: true, file: /^pinterest-([A-Za-z0-9_.-]+-)?654147914671443316\.mp4$/ },
  { key: 'tiktok', url: 'https://www.tiktok.com/@patroxofficial/video/6742501081818877190', video: true, file: /^tiktok-[A-Za-z0-9._-]+-6742501081818877190\.mp4$/ },
  { key: 'facebook', url: 'https://www.facebook.com/reel/930452829785006', video: true, file: /^facebook-930452829785006\.mp4$/ },
  { key: 'reddit', url: 'https://www.reddit.com/r/oddlysatisfying/comments/1wvgywt/jewelry_chain_making_machine/', video: true, file: /^reddit-([A-Za-z0-9_-]+-)?1wvgywt\.mp4$/ },
  { key: 'xPhoto', url: 'https://x.com/NASAKennedy/status/2106096415587840118', video: false, reason: 'no_video', file: /^x-NASAKennedy-2106096415587840118\.jpg$/ },
  { key: 'youtube', url: 'https://www.youtube.com/watch?v=Paj_NkVbYp4', video: false, reason: 'not_supported', file: /^youtube-Paj_NkVbYp4\.jpg$/ },
  { key: 'vimeo', url: 'https://vimeo.com/76979871', video: false, reason: 'drm', q: '?part=video' },
  { key: 'igMissing', url: 'https://www.instagram.com/reel/DZzTestGone0/', ig: true, video: 'fail' },
  { key: 'direct', url: FXB + '/cdn/direct.mp4', video: true, file: /^fikir-\d+-?\.mp4$|^fikir-\d+\.mp4$/ },
];
const SKIP_IG = process.env.VIDEO_E2E_SKIP_IG === '1';
if (SKIP_IG) for (let i = POSTS.length - 1; i >= 0; i--) if (POSTS[i].ig) POSTS.splice(i, 1);
const ids = {};
for (const p of POSTS) {
  const r = await call('POST', '/api/inspire/posts', { url: p.url }, g.token);
  assert.equal(r.status, 201, `${p.key}: ${JSON.stringify(r.data).slice(0, 300)}`);
  ids[p.key] = r.data.id;
  p.dl = r.data.dl;
  if (p.ig) await sleep(2500);
}
const text = await call('POST', '/api/inspire/posts', { type: 'text', text: 'Sadece bir fikir metni' }, g.token);
assert.equal(text.status, 201);
ids.text = text.data.id;
console.log('# posts ' + JSON.stringify(ids));
console.log('# dl hints at creation ' + JSON.stringify(Object.fromEntries(POSTS.map((p) => [p.key, p.dl]))));
assert.equal(text.data.dl, null);
assert.deepEqual(POSTS.find((p) => p.key === 'youtube').dl, { video: false, image: true, reason: 'not_supported' });
assert.deepEqual(POSTS.find((p) => p.key === 'tiktok').dl, { video: true, image: true });
ok('posts of every platform created through the API as a guest; dl hints on the created posts');

// ── download-info + download per platform ──
for (const p of POSTS) {
  const id = ids[p.key];
  const before = (await call('GET', `/api/inspire/posts/${id}/download-info`)).data;
  const igBefore = p.ig ? logCount(new RegExp(`inspire ig resolve ${id} `)) : 0;
  const r = await dl(id, p.q || '');
  const row = { key: p.key, id, info: `${before.video}/${before.image}/${before.from}/${before.adapter || '-'}/${before.reason || '-'}`, status: r.status, ms: r.ms };
  if (p.video === 'fail') {
    assert.notEqual(r.status, 200, 'a missing reel never downloads');
    assert.match(r.headers.get('content-type'), /^text\/html/);
    assert.ok(r.text().includes('İndirilemedi'));
    const j = await dl(id, '?format=json');
    row.reason = JSON.parse(j.text()).reason;
    assert.equal(logCount(new RegExp(`inspire ig resolve ${id} `)), igBefore + 1, 'the failure backs off: the second request fetched nothing');
    row.note = `HTML error page; JSON reason ${row.reason}`;
  } else if (p.video === false && !p.file) {
    assert.equal(r.status, 404, `${p.key}: ${r.text().slice(0, 200)}`);
    const j = JSON.parse((await dl(id, (p.q ? p.q + '&' : '?') + 'format=json')).text());
    assert.equal(j.reason, p.reason);
    row.reason = j.reason;
    row.note = j.message;
  } else {
    assert.equal(r.status, 200, `${p.key}: ${r.status} ${r.text().slice(0, 300)}`);
    const kind = magic(r.buf);
    assert.ok(kind, `${p.key}: unknown magic`);
    assert.equal(Number(r.headers.get('content-length')), r.buf.length, 'Content-Length = bytes received');
    assert.match(cd(r.headers), /^attachment; filename="[A-Za-z0-9._-]+"; filename\*=UTF-8''/);
    if (p.file) assert.match(asciiName(r.headers), p.file, `${p.key}: ${cd(r.headers)}`);
    assert.equal(r.headers.get('cache-control'), 'private, no-store');
    if (p.video === true) {
      assert.equal(kind, 'mp4');
      const tr = tracks(r.buf);
      assert.ok(tr.includes('vide'), `${p.key}: no video track`);
      row.tracks = tr.join('+');
    } else {
      assert.match(kind, /^(jpg|png|webp)$/);
      const j = await call('GET', `/api/inspire/posts/${id}/download-info`);
      assert.equal(j.data.reason, p.reason);
      row.reason = p.reason;
    }
    row.bytes = r.buf.length; row.type = r.headers.get('content-type'); row.file = asciiName(r.headers); row.saved = save(p.key, r);
  }
  const after = (await call('GET', `/api/inspire/posts/${id}/download-info`)).data;
  row.infoAfter = `${after.video}/${after.image}/${after.from}/${after.adapter || '-'}/${after.reason || '-'}`;
  rows.push(row);
  console.log('# ' + JSON.stringify(row));
  await sleep(p.ig ? 3000 : 800);
}
for (const k of [...(SKIP_IG ? [] : ['igBlocked', 'igOk']), 'x', 'pinterest', 'tiktok', 'facebook', 'reddit']) {
  const row = rows.find((r) => r.key === k);
  assert.match(row.tracks, /vide/); assert.match(row.tracks, /soun/, `${k} has sound`);
}
ok('every platform: MP4 with picture + sound (Reddit muxed), magic bytes, Content-Length, file name; refusals carry their reason');

// ── cache reuse (worker log) ──
{
  const igRe = new RegExp(`inspire ig resolve ${ids.igOk} `), xRe = new RegExp(`inspire dl adapter x ${ids.x} `), rdRe = new RegExp(`inspire dl adapter reddit ${ids.reddit} `);
  const [ig0, x0, rd0] = [logCount(igRe), logCount(xRe), logCount(rdRe)];
  assert.equal(ig0, SKIP_IG ? 0 : 1); assert.equal(x0, 1); assert.equal(rd0, 1);
  if (!SKIP_IG) {
    const a = await dl(ids.igOk, '?part=image');
    assert.equal(a.status, 200); assert.match(magic(a.buf), /^(jpg|webp|png)$/);
  }
  const b = await dl(ids.x);
  assert.equal(b.status, 200, b.text().slice(0, 300));
  const c = await dl(ids.reddit, '?part=video');
  assert.equal(c.status, 200, c.text().slice(0, 300)); assert.equal(c.buf.length, rows.find((r) => r.key === 'reddit').bytes);
  await sleep(500);
  assert.deepEqual([logCount(igRe), logCount(xRe), logCount(rdRe)], [SKIP_IG ? 0 : 1, 1, 1], 'second downloads fetched no Instagram page / tweet / Reddit feed');
  const tt0 = logCount(new RegExp(`inspire dl adapter tiktok ${ids.tiktok} `));
  const t = await dl(ids.tiktok, '?part=image');
  assert.equal(t.status, 200, t.status === 200 ? '' : (await dl(ids.tiktok, '?part=image&format=json')).text().slice(0, 300));
  await sleep(300);
  assert.equal(logCount(new RegExp(`inspire dl adapter tiktok ${ids.tiktok} `)), tt0, 'TikTok poster from the cache');
  ok('cache reuse: second Instagram / X / Reddit downloads and the TikTok poster made no platform request');
}

// ── Instagram copy to R2 (local) ──
if (!SKIP_IG) {
  const igRe = new RegExp(`inspire ig resolve ${ids.igBlocked} `);
  const before = logCount(igRe);
  // the board copies only reels whose embed was found blocked: seeded here (video-smoke.mjs checks the real embed page),
  // which spares one Instagram request
  const nowS = Math.floor(Date.now() / 1000);
  d1(`INSERT OR REPLACE INTO inspire_video_cache (post_id, kind, resolved_at, retry_at, extra) VALUES (${ids.igBlocked}, 'ig_embed', ${nowS}, ${nowS + 30 * 86400}, '{"state":"blocked"}')`);
  const c = await call('POST', `/api/inspire/posts/${ids.igBlocked}/ig-copy`, null, g.token);
  assert.equal(c.status, 201, JSON.stringify(c.data));
  const m = c.data.post.media;
  assert.equal(m.source, 'instagram'); assert.equal(m.kind, 'video'); assert.equal(m.mime, 'video/mp4');
  assert.match(m.url, new RegExp(`^/files/fikir/${ids.igBlocked}/v-[0-9a-f]{32}\\.mp4$`));
  assert.match(m.poster, new RegExp(`^/files/fikir/${ids.igBlocked}/p-[0-9a-f]{32}\\.(jpg|webp|png)$`));
  assert.equal(m.bytes, rows.find((r) => r.key === 'igBlocked').bytes);
  assert.equal(logCount(igRe), before, 'the copy reused the cached links');
  const f = await fetchOnce(BASE + m.url);
  assert.equal(f.status, 200); assert.equal(Number(f.headers.get('content-length')), m.bytes);
  await f.arrayBuffer();
  const board = (await call('GET', '/api/inspire/posts', null, g.token)).data.find((p) => p.id === ids.igBlocked);
  assert.equal(board.media.url, m.url); assert.deepEqual(board.dl, { video: true, image: true });
  const info = (await call('GET', `/api/inspire/posts/${ids.igBlocked}/download-info`)).data;
  assert.deepEqual([info.from, info.copied], ['copy', true]);
  const r2 = await dl(ids.igBlocked);
  assert.equal(r2.status, 200); assert.equal(r2.buf.length, m.bytes); assert.match(asciiName(r2.headers), /^instagram-[A-Za-z0-9._]+-DRUcmHMjeLZ\.mp4$/);
  console.log('# ig copy ' + JSON.stringify({ by: m.by, w: m.w, h: m.h, bytes: m.bytes, audio: m.audio, poster: m.poster.split('/').pop(), caption: (m.caption || '').slice(0, 40) }));
  ok('ig-copy of the blocked reel: MP4 + poster in R2, post.media source instagram, board + download-info show it, download from R2');
}

// ── rate-limit buckets (seeded counters: no extra platform traffic) ──
{
  const now = Math.floor(Date.now() / 1000);
  // a second Reddit post while the feed bucket is full: its link preview already knows the v.redd.it id, so the
  // download needs no feed request (picture + sound muxed as before)
  const rd2 = await call('POST', '/api/inspire/posts', { url: 'https://www.reddit.com/r/oddlysatisfying/comments/1wv8wsl/brage_vestavik_riding_in_british_columbia/' }, g.token);
  assert.equal(rd2.status, 201);
  d1(`INSERT INTO inspire_rate (k, n, reset) VALUES ('ad_rss:all', 2, ${now + 60}) ON CONFLICT(k) DO UPDATE SET n=2, reset=${now + 60}`);
  const pre = JSON.parse(d1(`SELECT meta FROM inspire_posts WHERE id=${rd2.data.id}`)[0].meta || '{}');
  const r = await dl(rd2.data.id, '?part=video');
  if (pre.media && /^https:\/\/v\.redd\.it\//.test(pre.media.url || '')) {
    assert.equal(r.status, 200, r.text().slice(0, 200));
    assert.deepEqual(tracks(r.buf), ['vide', 'soun']);
    await sleep(300);
    assert.equal(logCount(new RegExp(`inspire dl adapter reddit ${rd2.data.id} ok split $`)), 1, 'resolved without the feed');
    console.log(`# reddit via preview: ${r.buf.length} bytes, ${asciiName(r.headers)}, ${r.ms} ms`);
    save('reddit2', r);
  } else {
    assert.equal(r.status, 429); assert.equal(JSON.parse((await dl(rd2.data.id, '?part=video&format=json')).text()).reason, 'busy');
    console.log('# reddit 2: no preview video, the full feed bucket answered 429');
  }
  // TikTok links are cookie-bound: every video download resolves again, under the per-platform window
  d1(`INSERT INTO inspire_rate (k, n, reset) VALUES ('ad_fetch:tiktok', 20, ${now + 600}) ON CONFLICT(k) DO UPDATE SET n=20, reset=${now + 600}`);
  const t = await dl(ids.tiktok, '?part=video&format=json');
  assert.equal(t.status, 429); assert.equal(JSON.parse(t.text()).reason, 'busy');
  const timg = await dl(ids.tiktok, '?part=image');
  assert.equal(timg.status, 200, 'the cached poster still downloads');
  assert.equal(d1(`SELECT COUNT(*) AS c FROM inspire_video_cache WHERE post_id=${ids.tiktok} AND kind='ad' AND error IS NOT NULL`)[0].c, 0, 'a refused admission is not cached as a failure');
  ok('rate limits: a full Reddit feed bucket is skipped when the preview knows the video; the TikTok window answers 429 busy (nothing cached, no silent fallback), the cached poster still works');
}

// ── invalid ids, text posts, bad parts ──
{
  for (const p of ['/api/inspire/posts/abc/download', '/api/inspire/posts/1234567890123456/download', '/api/inspire/posts/-1/download']) {
    assert.equal((await fetchOnce(BASE + p)).status, 404, p);
  }
  const missing = await dl(999999999);
  assert.equal(missing.status, 404); assert.ok(missing.text().includes('Fikir bulunamadı'));
  assert.equal((await call('GET', '/api/inspire/posts/999999999/download-info')).status, 404);
  const t = await dl(ids.text);
  assert.equal(t.status, 404); assert.ok(t.text().includes('yalnızca metin'));
  const ti = (await call('GET', `/api/inspire/posts/${ids.text}/download-info`)).data;
  assert.deepEqual([ti.video, ti.image], [false, false]);
  assert.equal((await dl(ids.x, '?part=audio')).status, 400);
  ok('invalid / unknown ids 404, text posts 404 (nothing to download), bad part 400');
}

// ── per-IP download limit (last: blocks this IP for 10 minutes) ──
{
  let status = 0, i = 0;
  for (; i < 60 && status !== 429; i++) status = (await dl(ids.text)).status;
  assert.equal(status, 429);
  ok(`per-IP download limit: 429 after ${i} more requests`);
}
fs.writeFileSync(path.join(DLDIR, 'results.json'), JSON.stringify(rows, null, 2));
console.log(`# all ${n} checks passed; files in ${DLDIR}`);
