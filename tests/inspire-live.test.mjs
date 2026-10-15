// Live Instagram playback (FIKIR_IG_LIVE; production: R2 copies off, nothing stored): the worker in Node (tests/cron-harness.mjs:
// in-memory D1 / R2, a fake network; nothing leaves the machine) with production's video settings (H.liveVars).
//   GET /posts        post.live (our play paths with the post's play token, never a CDN URL) / post.live_ask
//   GET /posts/:id/play   the post's own CDN file streamed through: Range 200 / 206 / 416, fresh headers only, play token or
//                     session, no URL parameter, CDN hosts only, one re-resolve of a dead cached link, budgets
//   POST /posts/:id/live  resolve-only asks of the board (video / photo / later / never), rate limit, never Browser Run
//   GET /config       media.live
// TEST values only (harness-board-pass, harness-secret).
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { webcrypto } from 'node:crypto';
import * as H from './cron-harness.mjs';
import { PLAY_PATH_RE } from '../assets/js/fikir-url.mjs';
import { FILES_WINDOW_S } from '../worker/fikir-gate.js';
import { igExtract, itemToCache } from '../worker/inspire-video.js';
import { ipBucket } from '../worker/storyboard/db.js';

const IP = '203.0.113.7';   // runRequest's default CF-Connecting-IP
const N = 300000;           // the harness CDN video's size
const VIDEO = Buffer.from(H.harnessVideo(N));
const POSTER = fs.readFileSync(new URL('./fixtures/media/poster.jpg', import.meta.url));
const FXV = (f) => fs.readFileSync(new URL('./fixtures/video/' + f, import.meta.url), 'utf8');
const LIVE_FETCH = { cdnRange: 'exact', oeAhead: 2 * 86400 };
const live = (opts = {}) => H.readyWorld({ vars: { ...H.liveVars, ...(opts.vars || {}) }, fetchOpts: { ...LIVE_FETCH, ...(opts.fetchOpts || {}) } });
async function ipKeyOf(ip = IP) {
  const d = new Uint8Array(await webcrypto.subtle.digest('SHA-256', new TextEncoder().encode('inspire-ip:' + ipBucket(ip))));
  return 'ip:' + [...d.subarray(0, 12)].map((x) => x.toString(16).padStart(2, '0')).join('');
}
const list = async (w, worker, token, opts = {}) => (await H.runRequest(w, worker, 'GET', '/api/inspire/posts', { token, ...opts }));
const byId = (arr, id) => arr.find((p) => p.id === id);
// GET of a play path as a <video> / <img> sends it: no session header, no X-Fikir-Client
const play = (w, worker, path, opts = {}) => H.runRequest(w, worker, 'GET', path, { legacy: true, ...opts });
const igPageFetches = (m) => m.urls.filter((u) => u.startsWith('https://www.instagram.com/')).length;
const nonCdn = (m) => m.urls.filter((u) => !/^https:\/\/(www\.instagram\.com|[a-z0-9.-]+\.(cdninstagram\.com|fbcdn\.net))\//.test(u));

describe('live Instagram playback (worker, Node harness)', { skip: !H.HARNESS_SUPPORTED && 'needs node:module registerHooks (Node >= 22.15)' }, () => {
  test('GET /posts: post.live for a cached video, live_ask for an unknown post, nothing for photos / carousels starting with a photo', async () => {
    const { w, warm } = await live();
    const tok = await H.guestToken(w, warm);
    const [reel, unknown, photo, carousel, copied, copiedBare] = H.seedIgPosts(w, ['Lreel00001', 'Lunkn00001', 'Lphot00001', 'Lcaro00001', 'Lcopy00001', 'Lcopy00002']);
    const [text] = [Number(H.sqlRun(w, "INSERT INTO inspire_posts (user_id, type, url, description) VALUES ((SELECT id FROM inspire_users WHERE username='__guest__'), 'text', '', 'x')").lastInsertRowid)];
    H.seedIgCache(w, [reel, copied]);
    const now = H.nowS();
    H.sqlRun(w, "INSERT INTO inspire_video_cache (post_id, kind, url, poster, width, height, expires_at, resolved_at, extra) VALUES (?, 'ig', NULL, ?, 1080, 1350, ?, ?, ?)",
      photo, 'https://scontent-ams2-1.cdninstagram.com/v/t51.0-15/photo_1080.jpg?oe=1', now + 86400, now, JSON.stringify({ cv: 3, media_type: 1, lv: 0 }));
    const c = itemToCache(igExtract(FXV('ig-carousel.html'), 'DTestCarou1'));
    H.sqlRun(w, "INSERT INTO inspire_video_cache (post_id, kind, url, poster, width, height, expires_at, resolved_at, extra) VALUES (?, 'ig', ?, ?, ?, ?, ?, ?, ?)",
      carousel, c.url, c.poster, c.width, c.height, now + 86400, now, JSON.stringify(c.extra));
    const copy = { kind: 'video', url: `/files/fikir/${copied}/v-${'a'.repeat(32)}.mp4`, poster: `/files/fikir/${copied}/p-${'b'.repeat(32)}.jpg`, w: 720, h: 1280,
      mime: 'video/mp4', bytes: 10, verified: true, source: 'instagram', by: 'ornek.studio', audio: true };
    for (const id of [copied, copiedBare]) H.sqlRun(w, 'UPDATE inspire_posts SET media=? WHERE id=?', JSON.stringify({ ...copy, url: copy.url.replace(String(copied), String(id)), poster: copy.poster.replace(String(copied), String(id)) }), id);
    const r = await list(w, warm, tok);
    assert.equal(r.result.status, 200);
    const posts = r.result.json;
    const p = byId(posts, reel);
    assert.ok(p.live, JSON.stringify(p));
    const m = PLAY_PATH_RE.exec(p.live.url);
    assert.ok(m && m[1] === String(reel) && m[2] === 'video', p.live.url);
    const pm = PLAY_PATH_RE.exec(p.live.poster);
    assert.ok(pm && pm[1] === String(reel) && pm[2] === 'image' && pm[3] === m[3], 'poster: the same token, part=image');
    assert.deepEqual({ kind: p.live.kind, source: p.live.source, w: p.live.w, h: p.live.h, by: p.live.by, audio: p.live.audio },
      { kind: 'video', source: 'instagram', w: 720, h: 1280, by: 'ornek.studio', audio: true });
    assert.equal(p.live_ask, false);
    assert.deepEqual([byId(posts, unknown).live, byId(posts, unknown).live_ask], [null, true], 'unknown: the board asks');
    assert.deepEqual([byId(posts, photo).live, byId(posts, photo).live_ask], [null, false], 'photo');
    assert.deepEqual([byId(posts, carousel).live, byId(posts, carousel).live_ask], [null, false], 'carousel that starts with a photo');
    const cp = byId(posts, copied);
    assert.equal(cp.media.url.split('?')[0], copy.url, 'the R2 copy stays the media');
    assert.ok(cp.live && PLAY_PATH_RE.test(cp.live.url), 'live as the fallback of a copy');
    assert.deepEqual([cp.live.by, cp.live.caption], [null, null], 'the fallback without credit / caption (the copy has them)');
    assert.equal(cp.live_ask, false);
    assert.deepEqual([byId(posts, copiedBare).live, byId(posts, copiedBare).live_ask], [null, false], 'a copy is never asked for');
    assert.deepEqual([byId(posts, text).live, byId(posts, text).live_ask], [null, false]);
    assert.ok(!/cdninstagram|fbcdn/.test(r.result.text()), 'no CDN link in the list');
    // a failure backing off: not asked; once it is over: asked again; a removed post: never
    H.sqlRun(w, "INSERT INTO inspire_video_cache (post_id, kind, error, fail_count, retry_at, resolved_at) VALUES (?, 'ig', 'redirect', 1, ?, ?)", unknown, H.nowS() + 600, H.nowS());
    assert.equal(byId((await list(w, warm, tok)).result.json, unknown).live_ask, false);
    H.sqlRun(w, "UPDATE inspire_video_cache SET retry_at=? WHERE post_id=? AND kind='ig'", H.nowS() - 1, unknown);
    assert.equal(byId((await list(w, warm, tok)).result.json, unknown).live_ask, true);
    H.sqlRun(w, "UPDATE inspire_video_cache SET error='gone' WHERE post_id=? AND kind='ig'", reel);
    const gone = byId((await list(w, warm, tok)).result.json, reel);
    assert.deepEqual([gone.live, gone.live_ask], [null, false], 'removed');
    // a resolved row whose later re-resolve failed (url + extra kept): still our player
    H.sqlRun(w, "UPDATE inspire_video_cache SET error='redirect', retry_at=? WHERE post_id=? AND kind='ig'", H.nowS() + 600, reel);
    assert.ok(byId((await list(w, warm, tok)).result.json, reel).live);
    // the old board page (no X-Fikir-Client) never sees the field
    const legacy = await list(w, warm, tok, { legacy: true });
    assert.equal(legacy.result.status, 200);
    assert.ok(legacy.result.json.every((x) => !('live' in x) && !('live_ask' in x)));
  });

  test('GET /posts: FIKIR_IG_LIVE="0" -> no live objects; on: one more statement, no subrequest', async () => {
    const on = await live();
    const off = await live({ vars: { FIKIR_IG_LIVE: '0' } });
    for (const x of [on, off]) {
      const ids = H.seedIgPosts(x.w, ['Lstat00001', 'Lstat00002']);
      H.seedIgCache(x.w, [ids[0]]);
      x.tok = await H.guestToken(x.w, x.warm);
      x.ids = ids;
    }
    const a = await list(on.w, on.warm, on.tok), b = await list(off.w, off.warm, off.tok);
    assert.ok(byId(a.result.json, on.ids[0]).live);
    assert.ok(b.result.json.every((p) => p.live === null && p.live_ask === false));
    assert.equal(a.d1 - b.d1, 1, `one more statement (${a.d1} vs ${b.d1})`);
    assert.ok(a.d1 <= 8, `GET /posts statements: ${a.d1}`);
    assert.equal(a.sub, 0);
  });

  test('GET /posts with the copy hints on too (copies switched back on): live objects next to copy_view', async () => {
    const { w, warm } = await H.readyWorld({ fetchOpts: LIVE_FETCH });   // makeWorld's defaults: copies on, FIKIR_IG_LIVE from the toml
    assert.equal(w.env.FIKIR_IG_LIVE, '1');
    const tok = await H.guestToken(w, warm);
    const [a, b] = H.seedIgPosts(w, ['Lhint00001', 'Lhint00002']);
    H.seedIgCache(w, [a]);
    const r = await list(w, warm, tok);
    const pa = byId(r.result.json, a), pb = byId(r.result.json, b);
    assert.ok(pa.live && PLAY_PATH_RE.test(pa.live.url)); assert.equal(typeof pa.copy_view, 'boolean');
    assert.deepEqual([pb.live, pb.live_ask], [null, true]);
    assert.ok(r.sql.some((q) => /kind IN \('ig_copy', 'ad_copy'/.test(q)) && r.sql.some((q) => /AS hv/.test(q)), 'both extra statements in the batch');
  });

  test('play: Range 206 / 200 / 416, fresh headers only (no upstream CORP, no Set-Cookie), the exact bytes', async () => {
    const { w, warm } = await live();
    const tok = await H.guestToken(w, warm);
    const [reel] = H.seedIgPosts(w, ['Lrange0001']);
    H.seedIgCache(w, [reel]);
    const p = byId((await list(w, warm, tok)).result.json, reel);
    const r0 = (await play(w, warm, p.live.url, { headers: { Range: 'bytes=0-' } })).result;
    assert.equal(r0.status, 206);
    assert.equal(r0.headers['content-range'], `bytes 0-${N - 1}/${N}`);
    assert.equal(r0.headers['accept-ranges'], 'bytes');
    assert.equal(r0.headers['content-type'], 'video/mp4');
    assert.equal(r0.headers['content-disposition'], 'inline');
    assert.equal(r0.headers['cross-origin-resource-policy'], 'cross-origin');
    assert.equal(r0.headers['x-content-type-options'], 'nosniff');
    assert.equal(r0.headers['access-control-allow-origin'], '*');
    assert.match(r0.headers['cache-control'], /^private, max-age=\d+$/);
    assert.ok(!('set-cookie' in r0.headers) && !('timing-allow-origin' in r0.headers), 'no upstream header forwarded');
    assert.ok(VIDEO.equals(r0.body), 'the whole file, byte for byte');
    const r1 = (await play(w, warm, p.live.url, { headers: { Range: 'bytes=1000-1999' } })).result;
    assert.equal(r1.status, 206); assert.equal(r1.bytes, 1000); assert.equal(r1.headers['content-length'], '1000');
    assert.equal(r1.headers['content-range'], `bytes 1000-1999/${N}`);
    assert.ok(VIDEO.subarray(1000, 2000).equals(r1.body), 'a slice in the middle (no sniff)');
    const probe = (await play(w, warm, p.live.url, { headers: { Range: 'bytes=0-1' } })).result;
    assert.equal(probe.status, 206); assert.equal(probe.bytes, 2);
    const tail = (await play(w, warm, p.live.url, { headers: { Range: 'bytes=-500' } })).result;
    assert.equal(tail.status, 206); assert.ok(VIDEO.subarray(N - 500).equals(tail.body));
    const whole = (await play(w, warm, p.live.url)).result;
    assert.equal(whole.status, 200); assert.equal(whole.headers['content-length'], String(N)); assert.ok(VIDEO.equals(whole.body));
    assert.equal(whole.headers['accept-ranges'], 'bytes');
    const multi = await play(w, warm, p.live.url, { headers: { Range: 'bytes=0-10,20-30' } });
    assert.equal(multi.result.status, 200, 'a multi-range is ignored'); assert.equal(multi.result.bytes, N);
    for (const junk of ['bytes=abc', 'items=0-10', 'bytes=10-5']) assert.equal((await play(w, warm, p.live.url, { headers: { Range: junk } })).result.status, 200, junk);
    const past = (await play(w, warm, p.live.url, { headers: { Range: 'bytes=999999999-' } })).result;
    assert.equal(past.status, 416); assert.equal(past.headers['content-range'], `bytes */${N}`); assert.equal(past.json.error, 'range');
    assert.equal(past.headers['cross-origin-resource-policy'], 'cross-origin'); assert.equal(past.headers['cache-control'], 'no-store');
    const img = (await play(w, warm, p.live.poster)).result;
    assert.equal(img.status, 200); assert.equal(img.headers['content-type'], 'image/jpeg'); assert.equal(img.headers['content-disposition'], 'inline');
    assert.ok(POSTER.equals(img.body));
  });

  test('play: the post\'s play token (or a session header); another post\'s, an expired one, an old password\'s -> 401', async () => {
    const { w, warm } = await live();
    const tok = await H.guestToken(w, warm);
    const [a, b] = H.seedIgPosts(w, ['Lauth00001', 'Lauth00002']);
    H.seedIgCache(w, [a, b]);
    const posts = (await list(w, warm, tok)).result.json;
    const pa = byId(posts, a).live.url, pb = byId(posts, b).live.url;
    const bare = pa.replace(/&t=.*$/, '');
    const none = (await play(w, warm, bare)).result;
    assert.equal(none.status, 401); assert.equal(none.json.error, 'unauthorized'); assert.equal(none.headers['cross-origin-resource-policy'], 'cross-origin');
    assert.equal((await play(w, warm, bare, { token: 'abc.def.ghi' })).result.json.error, 'session_expired');
    assert.equal((await play(w, warm, bare + '&t=' + pb.split('&t=')[1])).result.status, 401, "another post's token");
    assert.equal((await play(w, warm, bare, { token: tok, headers: { Range: 'bytes=0-99' } })).result.status, 206, 'a session header (no token)');
    assert.equal((await play(w, warm, pa, { headers: { Range: 'bytes=0-99' } })).result.status, 206);
    w.env.FIKIR_BOARD_PASSWORD = 'changed-board-pass';
    assert.equal((await play(w, warm, pa)).result.status, 401, 'a new board password');
    w.env.FIKIR_BOARD_PASSWORD = 'harness-board-pass';
    assert.equal((await play(w, warm, pa, { headers: { Range: 'bytes=0-99' } })).result.status, 206);
    H.advanceClock(2 * FILES_WINDOW_S + 61);
    assert.equal((await play(w, warm, pa)).result.status, 401, 'expired');
  });

  test('play: only the post\'s own media (no URL parameter, a planted link is never fetched, CDN hosts only)', async () => {
    const { w, warm } = await live();
    const tok = await H.guestToken(w, warm);
    const [a, b] = H.seedIgPosts(w, ['Lown000001', 'Lown000002']);
    H.seedIgCache(w, [a, b]);
    const x = H.seedPlatformPosts(w, ['x']).x;
    const posts = (await list(w, warm, tok)).result.json;
    const pa = byId(posts, a).live.url;
    const evil = await play(w, warm, pa + '&url=' + encodeURIComponent('https://evil.example/x.mp4'), { headers: { Range: 'bytes=0-99' } });
    assert.equal(evil.result.status, 206); assert.ok(VIDEO.subarray(0, 100).equals(evil.result.body));
    assert.deepEqual(nonCdn(evil), [], 'only the CDN');
    // a link planted in the cache row is dropped (not an Instagram CDN link): the post is resolved afresh instead
    H.sqlRun(w, "UPDATE inspire_video_cache SET url='https://evil.example/a.mp4' WHERE post_id=? AND kind='ig'", b);
    const pb = byId(posts, b).live.url;
    const planted = await play(w, warm, pb, { headers: { Range: 'bytes=0-99' } });
    assert.equal(planted.result.status, 206);
    assert.deepEqual(nonCdn(planted), []); assert.equal(igPageFetches(planted), 1);
    // a text / X post has no play path
    const tokX = byId(posts, a).live.url.split('&t=')[1];
    assert.equal((await play(w, warm, `/api/inspire/posts/${x}/play?part=video`, { token: tok })).result.status, 404);
    assert.equal((await play(w, warm, `/api/inspire/posts/${x}/play?part=video&t=${tokX}`)).result.status, 401, 'tokens are per post');
    assert.equal((await play(w, warm, `/api/inspire/posts/${a}/play?part=audio`, { token: tok })).result.status, 400);
    // a CDN redirect off the CDN: refused before it is fetched
    const r = await live({ fetchOpts: { redirectHost: 'evil.example' } });
    const t2 = await H.guestToken(r.w, r.warm);
    const [c] = H.seedIgPosts(r.w, ['Lredir0001']);
    H.seedIgCache(r.w, [c]);
    const pc = byId((await list(r.w, r.warm, t2)).result.json, c).live.url;
    const red = await play(r.w, r.warm, pc);
    assert.equal(red.result.status, 502); assert.equal(red.result.json.error, 'fetch_failed');
    assert.ok(!red.urls.some((u) => u.includes('evil.example')), 'the other host is never fetched');
    // a photo post: part=video 404 not_video, part=image plays
    const ph = await live({ fetchOpts: { ig: 'photo' } });
    const t3 = await H.guestToken(ph.w, ph.warm);
    const [q] = H.seedIgPosts(ph.w, ['Lphoto0001'], { kind: 'p' });
    const nv = (await play(ph.w, ph.warm, `/api/inspire/posts/${q}/play?part=video`, { token: t3 })).result;
    assert.equal(nv.status, 404); assert.equal(nv.json.error, 'not_video');
    assert.equal((await play(ph.w, ph.warm, `/api/inspire/posts/${q}/play?part=image`, { token: t3 })).result.status, 200);
  });

  test('play: a dead cached link is resolved once; expired links resolve; Instagram busy -> 503; no daily unit, no storage', async () => {
    const { w, warm } = await live({ fetchOpts: { deadCached: true } });
    const tok = await H.guestToken(w, warm);
    const [a, b, c] = H.seedIgPosts(w, ['Ldead00001', 'Lexpd00001', 'Lbusy00001']);
    H.seedIgCache(w, [a, b, c]);
    const posts = (await list(w, warm, tok)).result.json;
    const r2Before = w.r2.objs.size;
    const first = await play(w, warm, byId(posts, a).live.url, { headers: { Range: 'bytes=0-' } });
    assert.equal(first.result.status, 206, JSON.stringify(first.result.json));
    assert.equal(igPageFetches(first), 1, 'one fresh resolve');
    assert.ok(first.urls.some((u) => u.includes('/CACHED-')) && first.urls.some((u) => u.includes('/REEL.mp4')));
    const again = await play(w, warm, byId(posts, a).live.url, { headers: { Range: 'bytes=0-99' } });
    assert.equal(again.result.status, 206); assert.equal(igPageFetches(again), 0, 'served from the new cache row');
    H.sqlRun(w, "UPDATE inspire_video_cache SET expires_at=? WHERE post_id=? AND kind='ig'", H.nowS() - 1, b);
    const exp = await play(w, warm, byId(posts, b).live.url, { headers: { Range: 'bytes=0-99' } });
    assert.equal(exp.result.status, 206); assert.equal(igPageFetches(exp), 1);
    H.sqlRun(w, "UPDATE inspire_video_cache SET expires_at=? WHERE post_id=? AND kind='ig'", H.nowS() - 1, c);
    H.sqlRun(w, 'INSERT OR REPLACE INTO inspire_rate (k, n, reset) VALUES (?, ?, ?)', 'ig_fetch:all', 20, H.nowS() + 600);
    const busy = await play(w, warm, byId(posts, c).live.url);
    assert.equal(busy.result.status, 503); assert.equal(busy.result.json.error, 'ig_busy'); assert.ok(Number(busy.result.headers['retry-after']) > 0);
    assert.equal(igPageFetches(busy), 0);
    for (let i = 0; i < 20; i++) assert.equal((await play(w, warm, byId(posts, a).live.url, { headers: { Range: `bytes=${i * 1000}-${i * 1000 + 999}` } })).result.status, 206);
    assert.equal(H.sqlAll(w, "SELECT COUNT(*) AS n FROM inspire_quota WHERE scope='dl'")[0].n, 0, 'no daily download unit');
    assert.equal(w.r2.objs.size, r2Before, 'nothing written to R2');
    assert.equal(H.sqlAll(w, 'SELECT COUNT(*) AS n FROM inspire_media')[0].n, 0);
    // a video's opening requests (no Range / from byte 0) and its poster / continuations are counted apart
    H.sqlRun(w, 'INSERT OR REPLACE INTO inspire_rate (k, n, reset) VALUES (?, ?, ?)', 'play_ip:' + (await ipKeyOf()), 1200, H.nowS() + 600);
    const lim = await play(w, warm, byId(posts, a).live.url);
    assert.equal(lim.result.status, 429); assert.equal(lim.result.headers['retry-after'], '60'); assert.equal(lim.result.json.retry_s, 60);
    assert.match(lim.result.headers['access-control-expose-headers'], /Retry-After/, 'the board can read Retry-After');
    assert.equal((await play(w, warm, byId(posts, a).live.url, { headers: { Range: 'bytes=0-9' } })).result.status, 429, 'bytes=0-: an opening request');
    assert.equal((await play(w, warm, byId(posts, a).live.url, { headers: { Range: 'bytes=1000-1999' } })).result.status, 206, 'a continuation');
    assert.equal((await play(w, warm, byId(posts, a).live.poster)).result.status, 200, 'the poster');
    H.sqlRun(w, 'INSERT OR REPLACE INTO inspire_rate (k, n, reset) VALUES (?, ?, ?)', 'play_more_ip:' + (await ipKeyOf()), 6000, H.nowS() + 600);
    assert.equal((await play(w, warm, byId(posts, a).live.url, { headers: { Range: 'bytes=1000-1999' } })).result.status, 429);
    assert.equal((await play(w, warm, byId(posts, a).live.url, { ip: '198.51.100.9', headers: { Range: 'bytes=0-9' } })).result.status, 206, 'another IP');
  });

  test('play: per-request cost (cached: 2 statements, <= 4 hops; cold, dead link + Browser Run re-resolve: bounded)', async () => {
    const { w, warm } = await live({ fetchOpts: { ig: 'login', deadCached: true, redirects: 3 } });
    const tok = await H.guestToken(w, warm);
    const [a, b] = H.seedIgPosts(w, ['Lcost00001', 'Lcost00002']);
    H.seedIgCache(w, [a, b]);
    const posts = (await list(w, warm, tok)).result.json;
    const cold = await play(w, await H.loadIsolate(), byId(posts, a).live.url, { headers: { Range: 'bytes=0-' } });
    assert.equal(cold.result.status, 206, JSON.stringify(cold.result.json));
    assert.equal(cold.br, 1, 'Browser Run re-resolve');
    assert.ok(cold.d1 <= 20 && cold.sub <= 12, H.fmt('cold dead link', cold));
    assert.ok(!cold.sql.some((q) => /^(CREATE|ALTER)\b/i.test(q)), 'no migration');
    const cached = await play(w, warm, byId(posts, a).live.url, { headers: { Range: 'bytes=0-99' } });
    assert.equal(cached.result.status, 206);
    assert.ok(cached.d1 <= 3 && cached.fetch <= 4, H.fmt('cached', cached));
    assert.equal(cached.d1, 2, 'limiter + one join');
    assert.ok(cached.cpuMs < 50, `~${cached.cpuMs.toFixed(1)} ms CPU in Node`);
  });

  test('POST /live: video / photo / later / never; answered from the cache once known; rate-limited; never Browser Run', async () => {
    const { w, warm } = await live();
    const tok = await H.guestToken(w, warm, 'harness-cid-0021');
    const [reel] = H.seedIgPosts(w, ['Lask000001']);
    const x = H.seedPlatformPosts(w, ['x']).x;
    const ask = (world, worker, id, t = tok) => H.runRequest(world, worker, 'POST', `/api/inspire/posts/${id}/live`, { token: t, body: { refresh: true } });
    const a = await ask(w, warm, reel);
    assert.equal(a.result.json.state, 'video', JSON.stringify(a.result.json));
    assert.ok(PLAY_PATH_RE.test(a.result.json.live.url)); assert.equal(a.result.json.live.by, 'ornek.studio');
    assert.equal(a.result.headers['cache-control'], 'no-store');
    assert.ok(!/cdninstagram|fbcdn/.test(a.result.text()));
    assert.equal(igPageFetches(a), 1); assert.equal(a.br, 0);
    const b = await ask(w, warm, reel);
    assert.equal(b.result.json.state, 'video'); assert.equal(b.fetch, 0, 'known: no fetch');
    assert.equal(byId((await list(w, warm, tok)).result.json, reel).live_ask, false, 'GET /posts knows it now');
    assert.deepEqual((await ask(w, warm, x)).result.json, { state: 'never', reason: 'not_instagram' });
    assert.equal((await ask(w, warm, 999999)).result.status, 404);
    // photo
    const ph = await live({ fetchOpts: { ig: 'photo' } });
    const t2 = await H.guestToken(ph.w, ph.warm);
    const [q] = H.seedIgPosts(ph.w, ['Laskph0001'], { kind: 'p' });
    assert.deepEqual((await ask(ph.w, ph.warm, q, t2)).result.json, { state: 'photo' });
    assert.deepEqual((await ask(ph.w, ph.warm, q, t2)).result.json, { state: 'photo' });
    // a login wall (Browser Run needed): later, the failure recorded, never Browser Run here
    const lg = await live({ fetchOpts: { ig: 'login' } });
    const t3 = await H.guestToken(lg.w, lg.warm);
    const [z] = H.seedIgPosts(lg.w, ['Lasklg0001']);
    const l = await ask(lg.w, lg.warm, z, t3);
    assert.equal(l.result.json.state, 'later'); assert.ok(l.result.json.retry_s >= 60); assert.equal(l.br, 0, 'no Browser Run');
    const row = H.sqlAll(lg.w, "SELECT error, retry_at FROM inspire_video_cache WHERE post_id=? AND kind='ig'", z)[0];
    assert.ok(row && row.error && row.retry_at > H.nowS(), 'backoff recorded');
    const l2 = await ask(lg.w, lg.warm, z, t3);
    assert.equal(l2.result.json.state, 'later'); assert.equal(l2.fetch, 0, 'backing off: no fetch');
    // live off; rate limit
    const off = await live({ vars: { FIKIR_IG_LIVE: '0' } });
    const t4 = await H.guestToken(off.w, off.warm);
    const [o] = H.seedIgPosts(off.w, ['Laskof0001']);
    assert.deepEqual((await ask(off.w, off.warm, o, t4)).result.json, { state: 'never', reason: 'disabled' });
    H.sqlRun(w, 'INSERT OR REPLACE INTO inspire_rate (k, n, reset) VALUES (?, ?, ?)', 'live:c:harness-cid-0021', 120, H.nowS() + 3600);
    assert.equal((await ask(w, warm, reel)).result.status, 429);
    assert.equal((await H.runRequest(w, warm, 'POST', `/api/inspire/posts/${reel}/live`)).result.status, 401, 'session required');
  });

  test('play: a dead link never drains the Instagram budget (backoff honoured, one re-resolve per post / 10 min, CDN 429 never)', async () => {
    const igFetchAll = (w) => (H.sqlAll(w, "SELECT n FROM inspire_rate WHERE k='ig_fetch:all'")[0] || { n: 0 }).n;
    const range = { headers: { Range: 'bytes=0-' } };
    // (1) the cached link died and the re-resolve fails (login wall, no Browser Run): later requests serve the row in
    // backoff (stale) and never resolve again
    {
      const { w, warm } = await live({ vars: { FIKIR_BR: '0' }, fetchOpts: { ig: 'login', deadCached: true } });
      const tok = await H.guestToken(w, warm);
      const [a] = H.seedIgPosts(w, ['Lrr0000001']);
      H.seedIgCache(w, [a]);
      const p = byId((await list(w, warm, tok)).result.json, a);
      const fetches = [];
      for (let i = 0; i < 6; i++) {
        const r = await play(w, i % 2 ? warm : await H.loadIsolate(), p.live.url, range);
        assert.equal(r.result.status, 502, JSON.stringify(r.result.json));
        fetches.push(igPageFetches(r));
      }
      assert.deepEqual(fetches, [1, 0, 0, 0, 0, 0], 'only the first request fetches Instagram');
      assert.equal(igFetchAll(w), 1, 'one unit of the site-wide window');
      const row = H.sqlAll(w, "SELECT error, fail_count FROM inspire_video_cache WHERE post_id=? AND kind='ig'", a)[0];
      assert.equal(row.fail_count, 1, 'one failure recorded, the backoff honoured');
      // the backoff over: the next request may resolve once more (resolve(false) after the backoff, not a re-resolve)
      H.advanceClock(601);
      const later = await play(w, warm, p.live.url, range);
      assert.ok(igPageFetches(later) <= 1);
    }
    // (2) the CDN refuses fresh links too (403): one re-resolve per post per 10 minutes, whatever the number of requests
    {
      const { w, warm } = await live({ vars: { FIKIR_BR: '0' }, fetchOpts: { cdnStatus: 403 } });
      const tok = await H.guestToken(w, warm);
      const [a, b] = H.seedIgPosts(w, ['Lrr0000002', 'Lrr0000003']);
      H.seedIgCache(w, [a, b]);
      const posts = (await list(w, warm, tok)).result.json;
      const fetches = [];
      for (let i = 0; i < 8; i++) {
        const r = await play(w, i % 2 ? warm : await H.loadIsolate(), i % 3 === 2 ? byId(posts, a).live.poster : byId(posts, a).live.url, range);
        assert.equal(r.result.status, 502);
        fetches.push(igPageFetches(r));
      }
      assert.deepEqual(fetches, [1, 0, 0, 0, 0, 0, 0, 0], 'one re-resolve for the post');
      assert.equal(igPageFetches(await play(w, warm, byId(posts, b).live.url, range)), 1, 'another post has its own');
      H.advanceClock(601);
      assert.equal(igPageFetches(await play(w, warm, byId(posts, a).live.url, range)), 1, 'the next window: once more');
      assert.equal(igFetchAll(w), 1, 'the new window counts from zero');
    }
    // (3) a CDN 429 (our egress throttled): no re-resolve at all
    {
      const { w, warm } = await live({ fetchOpts: { cdnStatus: 429 } });
      const tok = await H.guestToken(w, warm);
      const [a] = H.seedIgPosts(w, ['Lrr0000004']);
      H.seedIgCache(w, [a]);
      const p = byId((await list(w, warm, tok)).result.json, a);
      for (let i = 0; i < 3; i++) {
        const r = await play(w, warm, p.live.url, range);
        assert.equal(r.result.status, 502); assert.equal(igPageFetches(r), 0); assert.equal(r.br, 0);
      }
    }
  });

  test('POST /posts: a new Instagram post carries live: null + live_ask: true (the board asks at once); other links never', async () => {
    const { w, warm } = await live();
    const tok = await H.guestToken(w, warm);
    const add = (url) => H.runRequest(w, warm, 'POST', '/api/inspire/posts', { token: tok, body: { url, description: 'x' } });
    const ig = await add('https://www.instagram.com/reel/Lnew000001/');
    assert.equal(ig.result.status, 201, JSON.stringify(ig.result.json));
    assert.deepEqual([ig.result.json.live, ig.result.json.live_ask], [null, true]);
    const x = await add(H.PLATFORM_POSTS.x[1]);
    assert.equal(x.result.status, 201);
    assert.deepEqual([x.result.json.live, x.result.json.live_ask], [null, false]);
    const off = await live({ vars: { FIKIR_IG_LIVE: '0' } });
    const t2 = await H.guestToken(off.w, off.warm);
    const o = await H.runRequest(off.w, off.warm, 'POST', '/api/inspire/posts', { token: t2, body: { url: 'https://www.instagram.com/reel/Lnew000002/', description: 'x' } });
    assert.equal(o.result.status, 201); assert.equal(o.result.json.live_ask, false);
    const legacy = await H.runRequest(w, warm, 'POST', '/api/inspire/posts', { token: tok, legacy: true, body: { url: 'https://www.instagram.com/reel/Lnew000003/', description: 'x' } });
    assert.equal(legacy.result.status, 201); assert.ok(!('live_ask' in legacy.result.json), 'the old board page never sees the field');
  });

  test('cron: links that expire within 12 h are refreshed (new posts first); a Browser Run refusal defers that post, the run goes on', async () => {
    const { w, warm } = await live();
    const [soon, later, fresh] = H.seedIgPosts(w, ['Lref000001', 'Lref000002', 'Lref000003']);
    H.seedIgCache(w, [soon, later]);
    H.sqlRun(w, "UPDATE inspire_video_cache SET expires_at=? WHERE post_id=? AND kind='ig'", H.nowS() + 3600, soon);
    H.sqlRun(w, "UPDATE inspire_video_cache SET expires_at=? WHERE post_id=? AND kind='ig'", H.nowS() + 2 * 86400, later);
    const run = await H.runScheduled(w, warm, H.CRON_IG);
    assert.ok(run.lines.some((l) => /inspire live cron/.test(l[1]) && / new ok/.test(l[1])), 'the unresolved post first');
    const rows = Object.fromEntries(H.sqlAll(w, "SELECT post_id, url, expires_at FROM inspire_video_cache WHERE kind='ig'").map((r) => [r.post_id, r]));
    assert.ok(rows[fresh] && rows[fresh].url, 'resolved');
    assert.ok(Number(rows[soon].expires_at) > H.nowS() + 86400 && !rows[soon].url.includes('/CACHED-'), 'refreshed: new links');
    assert.ok(rows[later].url.includes('/CACHED-'), 'links with days left are not touched');
    assert.equal(run.r2, 0); assert.ok(!run.urls.some((u) => /cdninstagram|fbcdn/.test(u)), 'resolve only');
    // a photo row and a carousel starting with a photo are never refreshed
    H.sqlRun(w, "UPDATE inspire_video_cache SET expires_at=?, extra=? WHERE kind='ig'", H.nowS() + 3600, JSON.stringify({ cv: 3, media_type: 8, lv: 0 }));
    H.advanceClock(900);
    assert.equal(igPageFetches(await H.runScheduled(w, warm, H.CRON_IG)), 0);
    // Browser Run refused for the newest post (the site's daily budget is spent): it is deferred and the next post still resolves
    const br = await live({ fetchOpts: { ig: 'login' } });
    const [old, newest] = H.seedIgPosts(br.w, ['Lbrq000001', 'Lbrq000002']);
    const day = new Date(H.nowS() * 1000).toISOString().slice(0, 10);
    H.sqlRun(br.w, "INSERT OR REPLACE INTO inspire_quota (day, scope, subject, n, lim) VALUES (?, 'br', '', 999, 999)", day);
    const r1 = await H.runScheduled(br.w, br.warm, H.CRON_IG);
    assert.equal(igPageFetches(r1), 2, 'both posts tried (plain fetch)'); assert.equal(r1.br, 0);
    const recs = Object.fromEntries(H.sqlAll(br.w, "SELECT post_id, error, retry_at, extra FROM inspire_video_cache WHERE kind='ig'").map((r) => [r.post_id, r]));
    assert.ok(recs[newest] && Number(recs[newest].retry_at) > H.nowS() && /deferred/.test(recs[newest].extra || ''), 'the newest deferred');
    assert.ok(recs[old] && recs[old].error && Number(recs[old].retry_at) > H.nowS(), 'the next one resolved plain-only (failure recorded)');
    H.advanceClock(900);
    const r2 = await H.runScheduled(br.w, br.warm, H.CRON_IG);
    assert.ok(!r2.urls.some((u) => u.includes('Lbrq000002')), 'the deferred post waits (until UTC midnight: the budget\'s)');
    assert.equal(igPageFetches(r2), 1, 'the other one again once its 10-minute backoff is over');
  });

  test('GET /config: media.live with a session; off with FIKIR_IG_LIVE="0"', async () => {
    const { w, warm } = await live();
    const tok = await H.guestToken(w, warm);
    assert.equal((await H.runRequest(w, warm, 'GET', '/api/inspire/config', { token: tok })).result.json.media.live, true);
    assert.equal((await H.runRequest(w, warm, 'GET', '/api/inspire/config')).result.json.media.live, false, 'no session');
    const off = await live({ vars: { FIKIR_IG_LIVE: '0' } });
    assert.equal((await H.runRequest(off.w, off.warm, 'GET', '/api/inspire/config', { token: await H.guestToken(off.w, off.warm) })).result.json.media.live, false);
  });
  test('INSPIRE_TEST_IG (tests/video-e2e/live-smoke.mjs): Instagram fetches go to the fixture server only on a local test worker', async () => {
    const hook = { INSPIRE_TEST_IG: '1', INSPIRE_TEST_FETCH_ALLOW: '127.0.0.1:4741' };
    const urlsOf = async (vars) => {
      const { w, warm } = await live({ vars });
      const tok = await H.guestToken(w, warm);
      const [id] = H.seedIgPosts(w, ['Lhook00001']);
      const r = await H.runRequest(w, warm, 'POST', `/api/inspire/posts/${id}/live`, { token: tok });
      return r.urls.filter((u) => /instagram|cdninstagram|fbcdn|127\.0\.0\.1/.test(u));
    };
    // production origin: the vars are ignored (nothing rerouted)
    assert.deepEqual(await urlsOf(hook), ['https://www.instagram.com/reel/Lhook00001/']);
    // without INSPIRE_TEST_FETCH_ALLOW, or another value than "1": ignored too
    assert.deepEqual(await urlsOf({ INSPIRE_TEST_IG: '1', ALLOWED_ORIGIN: 'http://127.0.0.1:4741' }), ['https://www.instagram.com/reel/Lhook00001/']);
    assert.deepEqual(await urlsOf({ ...hook, INSPIRE_TEST_IG: 'true', ALLOWED_ORIGIN: 'http://127.0.0.1:4741' }), ['https://www.instagram.com/reel/Lhook00001/']);
    // a local test worker: the page fetch goes to the fixture server's /igfx/<host><path>
    assert.deepEqual(await urlsOf({ ...hook, ALLOWED_ORIGIN: 'http://127.0.0.1:4741' }), ['http://127.0.0.1:4741/igfx/www.instagram.com/reel/Lhook00001/']);
  });
});
