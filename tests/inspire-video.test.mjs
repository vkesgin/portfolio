// Unit tests for worker/inspire-video.js (downloads + R2 copies of video posts). No network: synthetic trimmed fixtures in
// tests/fixtures/video (see its README.md) and injected fetch stubs. Run from the repo root: node --test tests/
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  igRef, igPageUrl, igEmbedUrl, igShortcodeToPk, decodeOe, igCdnUrl, cleanCaption, igExtract, igPageProblem, igEmbedStatus,
  igNavHeaders, igEmbedHeaders, igResolve, igCheckEmbed, igEmbedExtract, igEmbedCaptionedUrl, igRedirectKind, igSoftError, igRetryAt,
  igBackingOff, igRetrySql, igEmbedKnown, IG_SOFT_MAX_S, IG_SOFT_LONG_N, IG_SOFT_LONG_S, openMedia, cappedStream, asciiFilePart, unicodeFilePart, dlFilename,
  contentDisposition, titleSlug, dlHint, registerDlAdapter, DL_ADAPTERS, backoffS, vcItemFresh, vcBackingOff, itemToCache,
  cacheToItem, igCacheCaptionCut, VIDEO_CACHE_DDL, vcGet, vcFail, vcDefer, vcExtra, vcExtraJson, vcPut, copyTargetOf, copyKind, imageDims,
  COPY_PLATFORMS, COPY_PLATFORM_TR, adToCache, adFromCache, xParse, ttParse, ttExtract, pinParse, redditRss, igLiveVideo, IG_PLAY_MIMES,
} from '../worker/inspire-video.js';
import { sanitizeMedia, COPY_SOURCES, MAX_MEDIA_JSON } from '../worker/inspire-media.js';
import { parseLink } from '../assets/js/fikir-url.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FX = (f) => fs.readFileSync(path.join(HERE, 'fixtures/video', f), 'utf8');
const CLIP = fs.readFileSync(path.join(HERE, 'fixtures/media/clip.mp4'));
const POSTER = fs.readFileSync(path.join(HERE, 'fixtures/media/poster.jpg'));
const OE_V = 0x6AC94349, OE_P = 0x6ACD0906;

describe('Instagram ids', () => {
  test('igRef accepts reel / p / tv links only', () => {
    assert.deepEqual(igRef(parseLink('https://www.instagram.com/reel/DTestReel01/?igsh=abc')), { code: 'DTestReel01', kind: 'reel' });
    assert.deepEqual(igRef(parseLink('https://instagram.com/ornek.studio/p/DTestPhoto1/')), { code: 'DTestPhoto1', kind: 'p' });
    assert.deepEqual(igRef(parseLink('https://www.instagram.com/tv/DTestTv0001/')), { code: 'DTestTv0001', kind: 'tv' });
    assert.equal(igRef(parseLink('https://www.instagram.com/ornek.studio/')), null);
    assert.equal(igRef(parseLink('https://www.youtube.com/watch?v=dQw4w9WgXcQ')), null);
    assert.equal(igRef({ platform: 'instagram', subtype: 'reel', id: 'bad/../code' }), null);
    assert.equal(igRef(null), null);
    assert.equal(igPageUrl({ code: 'DTestReel01', kind: 'reel' }), 'https://www.instagram.com/reel/DTestReel01/');
    assert.equal(igEmbedUrl({ code: 'DTestPhoto1', kind: 'p' }), 'https://www.instagram.com/p/DTestPhoto1/embed/');
  });
  test('shortcode -> pk (base64url digits, first 11 characters)', () => {
    assert.equal(igShortcodeToPk('AAAAB'), '1');
    assert.equal(igShortcodeToPk('AAABA'), '64');
    assert.equal(igShortcodeToPk('AAAA_'), '63');
    assert.equal(igShortcodeToPk('DTestReel01' + 'PRIVATEtail'), igShortcodeToPk('DTestReel01'));
    assert.equal(igShortcodeToPk('no'), null);
  });
  test('decodeOe reads the hex expiry', () => {
    assert.equal(decodeOe('https://x.cdninstagram.com/a.mp4?oe=6AC94349'), OE_V);
    assert.equal(decodeOe('https://x.cdninstagram.com/a.mp4'), null);
    assert.equal(decodeOe('https://x.cdninstagram.com/a.mp4?oe=zz'), null);
    assert.equal(decodeOe('https://x.cdninstagram.com/a.mp4?oe=00000001'), null);
    assert.equal(decodeOe('not a url'), null);
  });
  test('igCdnUrl takes only https Instagram / Facebook CDN hosts', () => {
    assert.ok(igCdnUrl('https://scontent-ams2-1.cdninstagram.com/o1/v/a.mp4?oe=1'));
    assert.ok(igCdnUrl('https://instagram.fayt2-1.fna.fbcdn.net/v/a.jpg'));
    assert.ok(igCdnUrl('https://scontent.cdninstagram.com/a.jpg'));
    for (const bad of ['http://scontent.cdninstagram.com/a.mp4', 'https://cdninstagram.com.evil.example/a.mp4', 'https://evil.example/a.mp4',
      'https://u:p@scontent.cdninstagram.com/a.mp4', 'https://scontent.cdninstagram.com:8443/a.mp4', 'javascript:alert(1)', 42, null]) {
      assert.equal(igCdnUrl(bad), null, String(bad));
    }
  });
  test('cleanCaption strips control / bidi characters and caps the length', () => {
    assert.equal(cleanCaption('a‮b\u0007c  d\n\n\n\ne'), 'abc d\n\ne');
    assert.equal(cleanCaption('   '), null);
    assert.equal(cleanCaption(null), null);
    const long = cleanCaption('ş'.repeat(600), 500);
    assert.equal(Array.from(long).length, 500);
    assert.ok(long.endsWith('…'));
  });
});

describe('igExtract (reel / post page)', () => {
  const html = FX('ig-reel.html');
  test('finds the post by code, best progressive MP4, largest CDN poster, credit, caption, expiry', () => {
    const it = igExtract(html, 'DTestReel01');
    assert.ok(it);
    assert.equal(it.code, 'DTestReel01');
    assert.equal(it.user, 'ornek.studio');
    assert.equal(it.has_audio, true);
    assert.equal(it.w, 720); assert.equal(it.h, 1280);
    assert.equal(it.video.url, 'https://scontent-ams2-1.cdninstagram.com/o1/v/t2/f2/m86/REEL.mp4?_nc_cat=104&oe=6AC94349&oh=00_v');
    assert.equal(it.videos.length, 1, 'duplicates and the http:// variant are dropped');
    assert.ok(!it.video.url.includes('OTHER'), 'the user timeline decoy is not this post');
    assert.equal(it.image.url, 'https://scontent-ams2-1.cdninstagram.com/v/t51.0-15/poster_720.jpg?oe=6ACD0906&oh=00_p', 'evil.example candidate ignored');
    assert.equal(it.image.w, 720);
    assert.equal(it.caption, 'Şehir ışıkları test 🌙\n\nİkinci satır');
    assert.equal(it.expires_at, Math.min(OE_V, OE_P));
    assert.equal(it.media_type, 2); assert.equal(it.product_type, 'clips');
  });
  test('another code on the same page resolves to that post, an unknown code to nothing', () => {
    const other = igExtract(html, 'ZZotherPost1');
    assert.ok(other && other.video.url.includes('OTHER.mp4'));
    assert.equal(igExtract(html, 'DNotOnPage1'), null);
  });
  test('carousel: the first video child, largest rendition first', () => {
    const it = igExtract(FX('ig-carousel.html'), 'DTestCarou1');
    assert.ok(it && it.video);
    assert.equal(it.video.url, 'https://scontent.cdninstagram.com/o1/v/c2_1080.mp4?oe=6AC94349');
    assert.equal(it.videos.length, 2);
    assert.equal(it.w, 1080); assert.equal(it.h, 1920);
    assert.equal(it.has_audio, false);
    assert.equal(it.image.url, 'https://scontent.cdninstagram.com/v/t51.0-15/c2.jpg?oe=6ACD0906');
    assert.equal(it.user, 'ornek_marka');
    assert.equal(it.caption, null);
  });
  test('lead_video: the reel itself, a carousel whose first item is the video; not one that starts with a photo', () => {
    assert.equal(igExtract(html, 'DTestReel01').lead_video, true);
    assert.equal(igExtract(FX('ig-carousel.html'), 'DTestCarou1').lead_video, false, 'photo first (ig-carousel.html)');
    const kid = (n, video) => ({ pk: String(4000 + n), media_type: video ? 2 : 1,
      image_versions2: { candidates: [{ url: `https://scontent.cdninstagram.com/v/k${n}.jpg`, width: 1080, height: 1920 }] },
      ...(video ? { video_versions: [{ type: 101, width: 720, height: 1280, url: `https://scontent.cdninstagram.com/o1/v/k${n}.mp4` }] } : {}) });
    const page = (kids) => `<script type="application/json">${JSON.stringify({ d: { code: 'DTestCarou2', media_type: 8, carousel_media: kids } })}</script>`;
    const first = igExtract(page([kid(1, true), kid(2, false)]), 'DTestCarou2');
    assert.equal(first.lead_video, true); assert.equal(first.video.url, 'https://scontent.cdninstagram.com/o1/v/k1.mp4');
    assert.equal(igExtract(page([kid(1, false), kid(2, true)]), 'DTestCarou2').lead_video, false);
    assert.equal(igExtract(FX('ig-photo.html'), 'DTestPhoto1').lead_video, false, 'a photo has no video');
  });
  test('an object without a code field matches by pk; image-only posts give an image', () => {
    const pk = igShortcodeToPk('DTestReel01');
    const page = `<script type="application/json">${JSON.stringify({ d: { media: { pk, image_versions2: { candidates: [{ url: 'https://scontent.cdninstagram.com/p.jpg', width: 1080, height: 1080 }] } } } })}</script>`;
    const it = igExtract(page, 'DTestReel01');
    assert.ok(it);
    assert.equal(it.video, null);
    assert.equal(it.image.url, 'https://scontent.cdninstagram.com/p.jpg');
  });
  test('garbage in, null out', () => {
    assert.equal(igExtract('', 'DTestReel01'), null);
    assert.equal(igExtract(null, 'DTestReel01'), null);
    assert.equal(igExtract(html, 'bad code!'), null);
    assert.equal(igExtract('<script>{"video_versions": [ not json DTestReel01</script>', 'DTestReel01'), null);
    assert.equal(igExtract('<html><body>"video_versions" outside a script DTestReel01</body></html>', 'DTestReel01'), null);
  });
  test('igPageProblem names the failure', () => {
    assert.equal(igPageProblem(''), 'empty');
    assert.equal(igPageProblem('<title>Challenge required</title>'), 'challenge');
    assert.equal(igPageProblem('<script>{"if_not_gated_logged_out":null}</script>'), 'gated');
    assert.equal(igPageProblem('<form id="loginForm"><input name="username"></form>'), 'login');
    assert.equal(igPageProblem('<title>Instagram</title><div id="root"></div>'), 'no_data');
  });
});

describe('igEmbedStatus (embed page)', () => {
  test('blocked / ok / photo / unknown', () => {
    assert.equal(igEmbedStatus(FX('ig-embed-blocked.html')), 'blocked');
    assert.equal(igEmbedStatus(FX('ig-embed-ok.html')), 'ok');
    assert.equal(igEmbedStatus(FX('ig-embed-photo.html')), 'photo');
    assert.equal(igEmbedStatus('<html></html>'), 'unknown');
    assert.equal(igEmbedStatus(null), 'unknown');
  });
  test('is_video without video_url counts as blocked even without the overlay markup', () => {
    const html = FX('ig-embed-blocked.html').replace(/<div class="WatchOnInstagramContainer">.*?<\/div>/, '');
    assert.ok(!html.includes('WatchOnInstagram'));
    assert.equal(igEmbedStatus(html), 'blocked');
  });
});

describe('igEmbedExtract (captioned embed page: the fallback of a refused post page)', () => {
  test('escaped contextJSON (the 2026-10 page): video, poster, size, credit, caption, expiry; another code -> null', () => {
    const it = igEmbedExtract(FX('ig-embed-captioned.html'), 'DTestEmbV01');
    assert.deepEqual({ user: it.user, w: it.w, h: it.h, duration: it.duration, media_type: it.media_type, product_type: it.product_type, lead: it.lead_video, audio: it.has_audio },
      { user: 'ornek.kahve', w: 1080, h: 1920, duration: 12.3, media_type: 2, product_type: 'clips', lead: true, audio: null });
    assert.equal(it.video.url, 'https://scontent.cdninstagram.com/o1/v/t2/f2/m86/EMBVIDEO.mp4?_nc_cat=104&_nc_oc=fake&oe=6AC94349&oh=00_AQfakevideo');
    assert.deepEqual([it.video.w, it.video.h], [1080, 1920]);
    assert.deepEqual(it.videos, [it.video]);
    assert.match(it.image.url, /embposter_1080\.jpg/, 'the largest display_resources entry'); assert.deepEqual([it.image.w, it.image.h], [1080, 1920]);
    assert.equal(it.caption, 'Kahve molası ☕ Sabah ışığı test\nİkinci satır #ornek', '\\u escapes decoded');
    assert.equal(it.expires_at, OE_V, 'the earlier of video / poster expiry');
    assert.equal(igEmbedExtract(FX('ig-embed-captioned.html'), 'DOtherPost1'), null);
    // the same shape as the page parser's item (itemToCache / cacheToItem / the live facts read it)
    const page = igExtract(FX('ig-reel.html'), 'DTestReel01');
    assert.deepEqual(Object.keys(it).sort(), Object.keys(page).sort());
    const c = itemToCache(it);
    assert.equal(c.url, it.video.url); assert.equal(c.extra.lv, 1); assert.equal(c.extra.user, 'ornek.kahve');
  });
  test('the unescaped variant (window.__additionalDataLoaded): the post by its code, not the decoy before it', () => {
    const it = igEmbedExtract(FX('ig-embed-plain.html'), 'DTestEmbU01');
    assert.match(it.video.url, /EMBPLAIN\.mp4/); assert.equal(it.has_audio, true);
    assert.equal(igEmbedExtract(FX('ig-embed-plain.html'), 'DOtherPost1').video.url, 'https://scontent.cdninstagram.com/o1/v/DECOY.mp4?oe=6AC94349', 'each object by its own code');
  });
  test('photo -> image only; blocked (WatchOnInstagram / is_video without video_url / copyright_blocked) -> null', () => {
    const ph = igEmbedExtract(FX('ig-embed-captioned-photo.html'), 'DTestEmbP01');
    assert.deepEqual([ph.video, ph.media_type, ph.lead_video, ph.user, ph.w, ph.h], [null, 1, false, 'ornek.foto', 1080, 1350]);
    assert.equal(igEmbedExtract(FX('ig-embed-captioned-blocked.html'), 'DTestEmbB01'), null);
    assert.equal(igEmbedStatus(FX('ig-embed-captioned-blocked.html')), 'blocked');
    const noUi = FX('ig-embed-captioned-blocked.html').replace(/<div class="WatchOnInstagramContainer">.*?<\/div>/, '');
    assert.ok(!noUi.includes('WatchOnInstagram'));
    assert.equal(igEmbedExtract(noUi, 'DTestEmbB01'), null, 'is_video without video_url');
    const cr = FX('ig-embed-captioned.html').replace('copyright_blocked\\":false', 'copyright_blocked\\":true');
    assert.notEqual(cr, FX('ig-embed-captioned.html'));
    assert.equal(igEmbedExtract(cr, 'DTestEmbV01'), null);
    assert.equal(igEmbedExtract(FX('ig-embed-ok.html'), 'DTestReel02').video.url, 'https://scontent.cdninstagram.com/o1/v/clip.mp4?oe=6AC94349', 'the 2026-10-08 layout (gql_data inside context)');
  });
  test('carousel: the first video child; a foreign CDN link is never taken', () => {
    const media = { __typename: 'GraphSidecar', shortcode: 'DTestSide01', is_video: false, owner: { username: 'ornek.kahve' },
      display_url: 'https://scontent.cdninstagram.com/v/side.jpg?oe=6ACD0906', dimensions: { width: 1080, height: 1350 },
      edge_sidecar_to_children: { edges: [
        { node: { __typename: 'GraphImage', is_video: false, display_url: 'https://scontent.cdninstagram.com/v/k1.jpg?oe=6ACD0906' } },
        { node: { __typename: 'GraphVideo', is_video: true, video_url: 'https://evil.example/x.mp4', display_url: 'https://scontent.cdninstagram.com/v/k2.jpg' } },
        { node: { __typename: 'GraphVideo', is_video: true, video_url: 'https://scontent.cdninstagram.com/o1/v/k3.mp4?oe=6AC94349', dimensions: { width: 720, height: 1280 } } }] } };
    const html = `<script>s.handle({"contextJSON":${JSON.stringify(JSON.stringify({ context: {}, gql_data: { shortcode_media: media } }))}})</script>`;
    const it = igEmbedExtract(html, 'DTestSide01');
    assert.match(it.video.url, /k3\.mp4/); assert.equal(it.media_type, 8); assert.equal(it.lead_video, false, 'a carousel that starts with a photo');
    assert.deepEqual([it.w, it.h], [720, 1280]);
  });
  test('garbage in, null out; size and scan bounds', () => {
    for (const x of [null, '', 'x', '<script>"shortcode_media":{</script>', '"shortcode_media":{"shortcode":"DTestEmbV01"', '\\"shortcode_media\\":{"x":1}',
      '"shortcode_media":' + '{'.repeat(5000)]) assert.equal(igEmbedExtract(x, 'DTestEmbV01'), null, String(x).slice(0, 40));
    assert.equal(igEmbedExtract(FX('ig-embed-captioned.html'), 'bad code!'), null);
    assert.equal(igEmbedExtract('x'.repeat(3 * 1024 * 1024) + FX('ig-embed-captioned.html'), 'DTestEmbV01'), null, 'over the size cap');
    // a long run of quotes / backslashes stays linear
    const t0 = performance.now();
    igEmbedExtract('\\"shortcode_media\\"' + '\\'.repeat(200000) + '"'.repeat(200000), 'DTestEmbV01');
    assert.ok(performance.now() - t0 < 500);
  });
});

describe('soft backoff (Instagram-side failures heal within the hour)', () => {
  test('schedule: soft 10, 20, 40, 60 min then 60 min, 6 h after 8 in a row; the others unchanged', () => {
    assert.deepEqual([1, 2, 3, 4, 5, 8, 9, 12].map((n) => backoffS(n, 'soft')), [600, 1200, 2400, 3600, 3600, 3600, 21600, 21600]);
    assert.deepEqual([IG_SOFT_MAX_S, IG_SOFT_LONG_N, IG_SOFT_LONG_S], [3600, 8, 21600]);
    assert.deepEqual([1, 5].map((n) => backoffS(n, 'later')), [600, 86400]);
    assert.equal(backoffS(1, 'gone'), 7 * 86400);
  });
  test('igSoftError: redirect / login / challenge / 403 / 429 / 5xx / timeout ... yes; gone, gated, embed_gone no', () => {
    for (const e of ['redirect', 'login', 'challenge', 'no_data', 'empty', 'timeout', 'fetch_error', 'http_403', 'http_429', 'http_500', 'http_503', 'br_no_data', 'br_login'])
      assert.equal(igSoftError(e), true, e);
    for (const e of ['gone', 'gated', 'br_gated', 'embed_gone', 'bad_ref', 'http_404', 'http_5000', null, undefined]) assert.equal(igSoftError(e), false, String(e));
  });
  test('legacy rows backed off for 24 h count as capped (computed on read, JS and SQL agree)', async () => {
    const now = 1_800_000_000;
    const legacy = { error: 'redirect', fail_count: 5, retry_at: now + 20 * 3600, resolved_at: now - 4 * 3600 };
    assert.equal(igRetryAt(legacy), now - 3 * 3600); assert.equal(igBackingOff(legacy, now), false, 'healed: due again');
    const recent = { error: 'redirect', retry_at: now + 86400, resolved_at: now - 600 };
    assert.equal(igRetryAt(recent), now + 3000); assert.equal(igBackingOff(recent, now), true);
    const gone = { error: 'gone', retry_at: now + 5 * 86400, resolved_at: now - 86400 };
    assert.equal(igRetryAt(gone), now + 5 * 86400, 'a removed post keeps its week');
    assert.equal(igRetryAt({ error: null, retry_at: now + 500 }), now + 500, 'a deferral without an error is kept');
    assert.equal(igRetryAt(null), 0);
    const { DatabaseSync } = await import('node:sqlite');
    const db = new DatabaseSync(':memory:');
    db.exec(VIDEO_CACHE_DDL);
    // past IG_SOFT_LONG_N failures in a row the cap is 6 h
    const many = { error: 'redirect', fail_count: 9, retry_at: now + 20 * 3600, resolved_at: now - 4 * 3600 };
    assert.equal(igRetryAt(many), now + 2 * 3600); assert.equal(igBackingOff(many, now), true);
    // a vcDefer deferral since the failure (Browser Run refused: until UTC midnight) is kept whole, an expired one is not
    const deferred = { error: 'redirect', fail_count: 1, retry_at: now + 10 * 3600, resolved_at: now - 7200, extra: JSON.stringify({ deferred: 'br_post', du: now + 10 * 3600 }) };
    assert.equal(igRetryAt(deferred), now + 10 * 3600); assert.equal(igBackingOff(deferred, now), true, 'deferred: not picked again');
    assert.equal(igRetryAt({ ...deferred, extra: undefined, du: now + 10 * 3600 }), now + 10 * 3600, 'du as a column (GET /posts)');
    const oldDefer = { error: 'redirect', fail_count: 5, retry_at: now + 20 * 3600, resolved_at: now - 7200, extra: JSON.stringify({ deferred: 'br', du: now - 3600 }) };
    assert.equal(igRetryAt(oldDefer), now - 3600, 'a deferral that is over: the soft cap again');
    const legacyNote = { ...legacy, extra: JSON.stringify({ deferred: 'br_post' }) };
    assert.equal(igRetryAt(legacyNote), now - 3 * 3600, 'a note without du (before 2026-10-23) does not keep 24 h');
    const rows = [[1, legacy], [2, recent], [3, gone], [4, { error: 'http_502', retry_at: now + 86400, resolved_at: now - 7200 }], [5, { error: null, retry_at: now + 500, resolved_at: now }],
      [6, many], [7, deferred], [8, oldDefer], [9, legacyNote], [10, { ...deferred, extra: '{bad' }]];
    for (const [id, r] of rows) db.prepare("INSERT INTO inspire_video_cache (post_id, kind, error, fail_count, retry_at, resolved_at, extra) VALUES (?, 'ig', ?, ?, ?, ?, ?)")
      .run(id, r.error, r.fail_count || 0, r.retry_at, r.resolved_at, r.extra || null);
    const sql = db.prepare(`SELECT post_id, ${igRetrySql('c')} AS ra FROM inspire_video_cache c ORDER BY post_id`).all();
    assert.deepEqual(sql.map((x) => x.ra), rows.map(([, r]) => igRetryAt(r)));
  });
  test('igEmbedKnown: the resolver\'s embed state before the embed check\'s; only ok / blocked', () => {
    assert.equal(igEmbedKnown('ok', 'blocked'), 'ok'); assert.equal(igEmbedKnown('blocked', 'ok'), 'blocked');
    assert.equal(igEmbedKnown(null, 'ok'), 'ok'); assert.equal(igEmbedKnown(undefined, 'photo'), null); assert.equal(igEmbedKnown('x', null), null);
  });
  test('vcFail merge keeps the row\'s credit / links, records why, drops a deferral note and its du (node:sqlite stand-in for D1)', async () => {
    const { DatabaseSync } = await import('node:sqlite');
    const raw = new DatabaseSync(':memory:');
    raw.exec(VIDEO_CACHE_DDL);
    const d1 = { prepare: (q) => { const st = raw.prepare(q); let args = []; const o = { bind: (...a) => { args = a; return o; }, first: async () => st.get(...args) || null, run: async () => st.run(...args) }; return o; } };
    await vcPut(d1, 7, 'ig', { url: 'https://scontent.cdninstagram.com/o1/v/a.mp4?oe=1', expires_at: 2e9, extra: { cv: 3, user: 'ornek.kahve', lv: 1, deferred: 'br', du: 2e9 } });
    await vcFail(d1, 7, 'ig', 'redirect', { retry: 'soft', merge: { em: 'ok', why: { page: 'redirect', loc: 'login', embed: 'http_429' } } });
    const row = await vcGet(d1, 7, 'ig');
    assert.equal(row.error, 'redirect'); assert.equal(row.fail_count, 1); assert.ok(row.url, 'the links stay');
    assert.ok(Number(row.retry_at) - Number(row.resolved_at) === 600);
    assert.deepEqual(vcExtra(row), { cv: 3, user: 'ornek.kahve', lv: 1, em: 'ok', why: { page: 'redirect', loc: 'login', embed: 'http_429' } });
  });
});

// fetch stub: routes[url] = Response | (init) => Response; records calls
function stubFetch(routes) {
  const calls = [];
  const fn = async (url, init = {}) => {
    calls.push({ url, init });
    const r = routes[url];
    if (!r) return new Response('nope', { status: 404, headers: { 'Content-Type': 'text/plain' } });
    return typeof r === 'function' ? r(init) : r.clone();
  };
  fn.calls = calls;
  return fn;
}
const html200 = (body) => new Response(body, { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' } });

describe('igResolve / igCheckEmbed (stubbed network)', () => {
  const ref = { code: 'DTestReel01', kind: 'reel' };
  test('plain fetch with desktop navigation headers, redirect manual', async () => {
    const f = stubFetch({ 'https://www.instagram.com/reel/DTestReel01/': html200(FX('ig-reel.html')) });
    const r = await igResolve(ref, { fetchImpl: f });
    assert.equal(r.ok, true); assert.equal(r.via, 'plain');
    assert.equal(r.item.user, 'ornek.studio');
    const h = f.calls[0].init.headers;
    assert.equal(f.calls[0].init.redirect, 'manual');
    assert.equal(h['Sec-Fetch-Mode'], 'navigate'); assert.equal(h['Sec-Fetch-Dest'], 'document'); assert.equal(h['Sec-Fetch-User'], '?1');
    assert.match(h['User-Agent'], /Macintosh.*Chrome\/\d+/);
    assert.ok(!/Mobile|iPhone/.test(h['User-Agent']));
    assert.equal(f.calls.length, 1);
  });
  test('an empty shell falls back to Browser Run once (after the embed page); without it the error is reported', async () => {
    const shell = html200('<title>Instagram</title><div id="root"></div>');
    const f = stubFetch({ 'https://www.instagram.com/reel/DTestReel01/': shell, 'https://www.instagram.com/reel/DTestReel01/embed/captioned/': shell });
    let brCalls = 0;
    const r = await igResolve(ref, { fetchImpl: f, brContent: async (u) => { brCalls++; assert.equal(u, 'https://www.instagram.com/reel/DTestReel01/'); return FX('ig-reel.html'); } });
    assert.equal(r.ok, true); assert.equal(r.via, 'br'); assert.equal(brCalls, 1);
    assert.deepEqual(r.why, { page: 'no_data', embed: 'no_data' });
    const r2 = await igResolve(ref, { fetchImpl: f });
    assert.equal(r2.ok, false); assert.equal(r2.error, 'no_data'); assert.equal(r2.retry, 'soft');
    const r3 = await igResolve(ref, { fetchImpl: f, brContent: async () => { throw new Error('boom'); } });
    assert.equal(r3.ok, false); assert.equal(r3.why.br, 'failed');
    const r4 = await igResolve(ref, { fetchImpl: f, brContent: async () => '<title>Instagram</title>' });
    assert.equal(r4.error, 'no_data', 'the page\'s error stays the row\'s'); assert.equal(r4.why.br, 'no_data');
    const r5 = await igResolve(ref, { fetchImpl: f, brContent: async () => '<script>{"if_not_gated_logged_out":null}</script>' });
    assert.deepEqual([r5.error, r5.retry], ['br_gated', 'later'], 'logged-out view refused: the long backoff');
    const n = await igResolve(ref, { fetchImpl: f, embed: false });
    assert.equal(f.calls.filter((c) => c.url.includes('/embed/')).length, 5, 'embed: false skips the embed page');
    assert.equal(n.why.embed, undefined);
  });
  test('Browser Run refused (slot / budget) is "busy", not a failure of the post', async () => {
    const f = stubFetch({ 'https://www.instagram.com/reel/DTestReel01/': new Response(null, { status: 302, headers: { Location: 'https://www.instagram.com/accounts/login/' } }) });
    const r = await igResolve(ref, { fetchImpl: f, brContent: async () => ({ refused: true, retry_s: 7, site: true }) });
    assert.deepEqual({ ok: r.ok, error: r.error, busy: r.busy, retry_s: r.retry_s, site: r.site, retry: r.retry },
      { ok: false, error: 'busy', busy: true, retry_s: 7, site: true, retry: undefined });
    const p = await igResolve(ref, { fetchImpl: f, brContent: async () => ({ refused: true, retry_s: 5000, site: false, scope: 'br_post' }) });
    assert.equal(p.busy, true); assert.equal(p.site, false); assert.equal(p.scope, 'br_post', 'the refusing budget is passed on');
    assert.equal(r.scope, null);
    const n = await igResolve(ref, { fetchImpl: f, brContent: async () => null });
    assert.equal(n.busy, undefined); assert.equal(n.error, 'embed_gone', 'the stub answers the embed page 404'); assert.equal(n.retry, 'later');
  });
  test('login redirect is never followed (only its kind is kept); 404 is "gone" without the embed or Browser Run', async () => {
    const login = new Response(null, { status: 302, headers: { Location: 'https://www.instagram.com/accounts/login/?next=%2Freel%2FDTestReel01%2F&tok=SECRET' } });
    const f = stubFetch({ 'https://www.instagram.com/reel/DTestReel01/': login,
      'https://www.instagram.com/reel/DTestReel01/embed/captioned/': new Response(null, { status: 302, headers: { Location: '/challenge/?x=1' } }) });
    const r = await igResolve(ref, { fetchImpl: f });
    assert.equal(r.ok, false); assert.equal(r.error, 'redirect'); assert.equal(r.retry, 'soft');
    assert.deepEqual(r.why, { page: 'redirect', loc: 'login', embed: 'redirect:challenge' });
    assert.ok(!JSON.stringify(r).includes('SECRET') && !JSON.stringify(r).includes('next='), 'never the Location itself');
    assert.deepEqual(f.calls.map((c) => [c.url, c.init.redirect]), [['https://www.instagram.com/reel/DTestReel01/', 'manual'],
      ['https://www.instagram.com/reel/DTestReel01/embed/captioned/', 'manual']]);
    let br = 0;
    const g = stubFetch({});
    const r2 = await igResolve(ref, { fetchImpl: g, brContent: async () => { br++; return null; } });
    assert.equal(r2.error, 'gone'); assert.equal(r2.retry, 'gone'); assert.equal(br, 0);
    assert.equal(g.calls.length, 1, 'a removed post: no embed fetch');
    assert.equal((await igResolve({ code: 'x', kind: 'reel' }, { fetchImpl: g })).error, 'bad_ref');
    assert.deepEqual(['/accounts/login/', 'https://www.instagram.com/accounts/login', '/privacy/checks/?x', '/consent/', '/challenge/1/', '/', null, 'http://[bad']
      .map(igRedirectKind), ['login', 'login', 'consent', 'consent', 'challenge', 'other', 'other', 'other']);
  });
  test('fallback order: page redirect -> embed serves the video (via embed); embed blocked -> Browser Run; both remembered', async () => {
    const R = 'https://www.instagram.com/reel/DTestEmbV01/', E = R + 'embed/captioned/';
    const redirect = () => new Response(null, { status: 302, headers: { Location: 'https://www.instagram.com/accounts/login/' } });
    const eref = { code: 'DTestEmbV01', kind: 'reel' };
    let br = 0;
    const f = stubFetch({ [R]: redirect, [E]: html200(FX('ig-embed-captioned.html')) });
    const r = await igResolve(eref, { fetchImpl: f, referer: 'https://velikesgin.com', brContent: async () => { br++; return null; } });
    assert.deepEqual({ ok: r.ok, via: r.via, embed: r.embed, why: r.why }, { ok: true, via: 'embed', embed: 'ok', why: { page: 'redirect', loc: 'login' } });
    assert.equal(r.item.user, 'ornek.kahve'); assert.match(r.item.video.url, /EMBVIDEO\.mp4/); assert.equal(br, 0, 'no Browser Run');
    const h = f.calls[1].init.headers;
    assert.deepEqual([h['Sec-Fetch-Dest'], h['Sec-Fetch-Site'], h.Referer], ['iframe', 'cross-site', 'https://velikesgin.com/'], 'as the board\'s iframe');
    // 429 / 5xx / timeout of the page: the embed too
    for (const status of [429, 503]) {
      const g = stubFetch({ [R]: new Response('x', { status }), [E]: html200(FX('ig-embed-captioned.html')) });
      const x = await igResolve(eref, { fetchImpl: g });
      assert.deepEqual([x.ok, x.via, x.why.page], [true, 'embed', 'http_' + status]);
    }
    // the embed shows "Instagram'da İzle": remembered as blocked, Browser Run resolves it
    const B = 'https://www.instagram.com/reel/DTestEmbB01/';
    const bl = stubFetch({ [B]: redirect, [B + 'embed/captioned/']: html200(FX('ig-embed-captioned-blocked.html')) });
    const rb = await igResolve({ code: 'DTestEmbB01', kind: 'reel' }, { fetchImpl: bl, brContent: async () => { br++; return FX('ig-reel.html').replaceAll('DTestReel01', 'DTestEmbB01'); } });
    assert.deepEqual({ ok: rb.ok, via: rb.via, embed: rb.embed, embedWhy: rb.why.embed }, { ok: true, via: 'br', embed: 'blocked', embedWhy: 'blocked' });
    assert.equal(br, 1);
    const rb2 = await igResolve({ code: 'DTestEmbB01', kind: 'reel' }, { fetchImpl: bl, brContent: async () => null });
    assert.deepEqual({ ok: rb2.ok, error: rb2.error, retry: rb2.retry, embed: rb2.embed }, { ok: false, error: 'redirect', retry: 'soft', embed: 'blocked' });
    // Browser Run refused after a blocked embed: busy, the embed state still reported
    const busy = await igResolve({ code: 'DTestEmbB01', kind: 'reel' }, { fetchImpl: bl, brContent: async () => ({ refused: true, retry_s: 9 }) });
    assert.deepEqual([busy.busy, busy.embed], [true, 'blocked']);
    // a photo through the embed: resolved (no video)
    const P = 'https://www.instagram.com/p/DTestEmbP01/';
    const ph = await igResolve({ code: 'DTestEmbP01', kind: 'p' }, { fetchImpl: stubFetch({ [P]: redirect, [P + 'embed/captioned/']: html200(FX('ig-embed-captioned-photo.html')) }) });
    assert.deepEqual([ph.ok, ph.via, ph.embed, ph.item.video, !!ph.item.image], [true, 'embed', 'photo', null, true]);
    assert.equal(igEmbedCaptionedUrl({ code: 'DTestEmbP01', kind: 'p' }), P + 'embed/captioned/');
  });
  test('admitEmbed: the embed fetch is admitted on its own; refused (or throwing) -> no embed fetch, Browser Run still tried', async () => {
    const R = 'https://www.instagram.com/reel/DTestEmbV01/', E = R + 'embed/captioned/';
    const redirect = () => new Response(null, { status: 302, headers: { Location: 'https://www.instagram.com/accounts/login/' } });
    const eref = { code: 'DTestEmbV01', kind: 'reel' };
    let asked = 0, br = 0;
    const f = stubFetch({ [R]: redirect, [E]: html200(FX('ig-embed-captioned.html')) });
    const ok = await igResolve(eref, { fetchImpl: f, admitEmbed: async () => { asked++; return null; } });
    assert.deepEqual([ok.ok, ok.via, asked, f.calls.length], [true, 'embed', 1, 2]);
    for (const admitEmbed of [async () => 'daily_limit', async () => { throw new Error('d1 down'); }]) {
      const g = stubFetch({ [R]: redirect, [E]: html200(FX('ig-embed-captioned.html')) });
      const r = await igResolve(eref, { fetchImpl: g, admitEmbed, brContent: async () => { br++; return null; } });
      assert.deepEqual([r.ok, r.error, r.retry, r.why.embed], [false, 'redirect', 'soft', 'busy']);
      assert.deepEqual(g.calls.map((c) => c.url), [R], 'no embed fetch');
    }
    assert.equal(br, 2, 'Browser Run after a refused embed');
    // a page that resolves never asks for the embed's unit
    asked = 0;
    const p = await igResolve(ref, { fetchImpl: stubFetch({ 'https://www.instagram.com/reel/DTestReel01/': html200(FX('ig-reel.html')) }), admitEmbed: async () => { asked++; return null; } });
    assert.deepEqual([p.ok, p.via, asked], [true, 'plain', 0]);
  });
  test('igCheckEmbed fetches /embed/ as a cross-site iframe', async () => {
    const f = stubFetch({ 'https://www.instagram.com/reel/DTestReel01/embed/': html200(FX('ig-embed-blocked.html')) });
    const r = await igCheckEmbed(ref, { fetchImpl: f, referer: 'https://velikesgin.com' });
    assert.equal(r.status, 'blocked');
    const h = f.calls[0].init.headers;
    assert.equal(h['Sec-Fetch-Dest'], 'iframe'); assert.equal(h['Sec-Fetch-Site'], 'cross-site');
    assert.equal(h.Referer, 'https://velikesgin.com/');
    assert.equal(igEmbedHeaders('javascript:x').Referer, undefined);
    const g = stubFetch({});
    assert.deepEqual(await igCheckEmbed(ref, { fetchImpl: g }), { status: 'unknown', error: 'http_404', http: 404 });
  });
  test('navigation headers are a fresh object each time', () => {
    const a = igNavHeaders(); a['User-Agent'] = 'x';
    assert.notEqual(igNavHeaders()['User-Agent'], 'x');
  });
});

describe('openMedia (guarded download/copy fetch)', () => {
  const safe = (href) => { try { const u = new URL(href); return /^(cdn|media)\.example$/.test(u.hostname) && u.protocol === 'https:' ? u : null; } catch { return null; } };
  const media = (body, type, extra = {}) => () => new Response(body, { status: 200, headers: { 'Content-Type': type, 'Content-Length': String(body.length), ...extra } });
  const readAll = async (s) => new Uint8Array(await new Response(s).arrayBuffer());
  test('streams a real MP4 with its length and sniffed type', async () => {
    const f = stubFetch({ 'https://cdn.example/clip.mp4': media(CLIP, 'video/mp4') });
    const r = await openMedia('https://cdn.example/clip.mp4', { want: 'video', maxBytes: 1e6, safeURL: safe, fetchImpl: f });
    assert.equal(r.ok, true); assert.equal(r.mime, 'video/mp4'); assert.equal(r.ext, 'mp4'); assert.equal(r.length, CLIP.length);
    assert.deepEqual(Buffer.from(await readAll(r.body)), CLIP);
    assert.equal(f.calls[0].init.redirect, 'manual');
  });
  test('application/octet-stream is fine when the bytes are a video; html / svg / wrong kind are refused', async () => {
    const f = stubFetch({
      'https://cdn.example/a.bin': media(CLIP, 'application/octet-stream'),
      'https://cdn.example/page.mp4': media(Buffer.from('<!doctype html><title>x</title>' + ' '.repeat(80)), 'text/html'),
      'https://cdn.example/fake.mp4': media(Buffer.from('<!doctype html><title>x</title>' + ' '.repeat(80)), 'video/mp4'),
      'https://cdn.example/p.jpg': media(POSTER, 'image/jpeg'),
      'https://cdn.example/x.svg': media(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'), 'image/svg+xml'),
    });
    const o = async (u, want) => { const r = await openMedia(u, { want, maxBytes: 1e6, safeURL: safe, fetchImpl: f }); if (r.ok) await r.body.cancel(); return r; };
    assert.equal((await o('https://cdn.example/a.bin', 'video')).ok, true);
    assert.equal((await o('https://cdn.example/page.mp4', 'video')).error, 'not_media');
    assert.equal((await o('https://cdn.example/fake.mp4', 'video')).error, 'not_media');
    assert.equal((await o('https://cdn.example/p.jpg', 'video')).error, 'not_media');
    assert.equal((await o('https://cdn.example/p.jpg', 'image')).mime, 'image/jpeg');
    assert.equal((await o('https://cdn.example/x.svg', 'image')).error, 'not_media');
  });
  test('every redirect hop goes through the SSRF guard; <= 3 hops', async () => {
    const redir = (to) => () => new Response(null, { status: 302, headers: { Location: to } });
    const f = stubFetch({
      'https://cdn.example/r1': redir('http://169.254.169.254/latest/meta-data'),
      'https://cdn.example/r2': redir('/r3'), 'https://cdn.example/r3': redir('https://media.example/clip.mp4'),
      'https://media.example/clip.mp4': media(CLIP, 'video/mp4'),
      'https://cdn.example/l1': redir('/l2'), 'https://cdn.example/l2': redir('/l3'), 'https://cdn.example/l3': redir('/l4'), 'https://cdn.example/l4': redir('/l5'),
    });
    const o = (u) => openMedia(u, { want: 'video', maxBytes: 1e6, safeURL: safe, fetchImpl: f });
    assert.equal((await o('https://cdn.example/r1')).error, 'unsafe');
    assert.ok(!f.calls.some((c) => c.url.includes('169.254')), 'the private address is never fetched');
    const ok = await o('https://cdn.example/r2');
    assert.equal(ok.ok, true); assert.equal(ok.finalUrl, 'https://media.example/clip.mp4');
    await ok.body.cancel();
    assert.equal((await o('https://cdn.example/l1')).error, 'redirects');
    assert.equal((await o('http://cdn.example/clip.mp4')).error, 'unsafe');
    assert.equal((await openMedia('https://cdn.example/x', { want: 'video', maxBytes: 1, fetchImpl: f })).error, 'unsafe', 'no guard = no fetch');
  });
  test('size caps: declared length over the cap, and an undeclared body that grows past it', async () => {
    const big = Buffer.concat([CLIP, Buffer.alloc(5000)]);
    const f = stubFetch({
      'https://cdn.example/big.mp4': media(big, 'video/mp4'),
      'https://cdn.example/nolen.mp4': () => new Response(new ReadableStream({ start(c) { c.enqueue(new Uint8Array(big)); c.close(); } }), { status: 200, headers: { 'Content-Type': 'video/mp4' } }),
      'https://cdn.example/gone.mp4': () => new Response('x', { status: 410 }),
      'https://cdn.example/denied.mp4': () => new Response('x', { status: 403 }),
    });
    const o = (u, max) => openMedia(u, { want: 'video', maxBytes: max, safeURL: safe, fetchImpl: f });
    assert.equal((await o('https://cdn.example/big.mp4', CLIP.length)).error, 'too_large');
    const r = await o('https://cdn.example/nolen.mp4', CLIP.length);
    assert.equal(r.ok, true); assert.equal(r.length, null);
    await assert.rejects(readAll(r.body), /longer than allowed/);
    assert.equal((await o('https://cdn.example/gone.mp4', 1e6)).error, 'gone');
    assert.equal((await o('https://cdn.example/denied.mp4', 1e6)).error, 'upstream_403');
    assert.equal((await openMedia('https://cdn.example/x', { want: 'pdf', maxBytes: 1, safeURL: safe, fetchImpl: f })).error, 'bad_request');
  });
  test('cappedStream errors when the body is shorter than its declared length', async () => {
    const src = new ReadableStream({ start(c) { c.enqueue(new Uint8Array([4, 5])); c.close(); } });
    const s = cappedStream(new Uint8Array([1, 2, 3]), src.getReader(), { length: 10, limit: 100 });
    await assert.rejects(readAll(s), /shorter than Content-Length/);
  });
  // live playback (GET /api/inspire/posts/:id/play): one Range passed on, the 206 checked, the slice streamed through
  const slice = (body, type, { start = 0, end = body.length - 1, total = body.length, len = end - start + 1, extra = {} } = {}) => () =>
    new Response(body.subarray(start, end + 1), { status: 206, headers: { 'Content-Type': type, 'Content-Range': `bytes ${start}-${end}/${total}`, ...(len == null ? {} : { 'Content-Length': String(len) }), ...extra } });
  const ranged = (f, u, range, opts = {}) => openMedia(u, { want: 'video', maxBytes: 1e6, safeURL: safe, fetchImpl: f, range, ...opts });
  test('range: the Range header goes out; a 206 from byte 0 is sniffed, a later slice / a tiny probe is not', async () => {
    const big = Buffer.concat([CLIP, Buffer.alloc(3000, 7)]);
    const f = stubFetch({
      'https://cdn.example/a.mp4': (init) => {
        const m = /^bytes=(\d+)-(\d*)$/.exec(init.headers.Range || '');
        if (!m) return media(big, 'video/mp4')();
        const a = Number(m[1]), b = m[2] === '' ? big.length - 1 : Math.min(Number(m[2]), big.length - 1);
        return slice(big, 'video/mp4', { start: a, end: b })();
      },
    });
    const r = await ranged(f, 'https://cdn.example/a.mp4', 'bytes=1000-1999');
    assert.equal(f.calls[0].init.headers.Range, 'bytes=1000-1999');
    assert.equal(r.ok, true, JSON.stringify(r)); assert.equal(r.status, 206);
    assert.deepEqual([r.start, r.end, r.total, r.length, r.mime, r.ext], [1000, 1999, big.length, 1000, 'video/mp4', 'mp4']);
    assert.deepEqual(Buffer.from(await readAll(r.body)), big.subarray(1000, 2000), 'the slice, no sniff of its (non-MP4) bytes');
    const head = await ranged(f, 'https://cdn.example/a.mp4', 'bytes=0-');
    assert.equal(head.status, 206); assert.equal(head.length, big.length);
    assert.deepEqual(Buffer.from(await readAll(head.body)), big);
    const probe = await ranged(f, 'https://cdn.example/a.mp4', 'bytes=0-1');
    assert.equal(probe.ok, true); assert.equal(probe.length, 2);
    assert.deepEqual(Buffer.from(await readAll(probe.body)), big.subarray(0, 2));
    const whole = await ranged(f, 'https://cdn.example/a.mp4', 'bytes=0-10,20-30');
    assert.equal(f.calls[f.calls.length - 1].init.headers.Range, undefined, 'a multi-range is never sent');
    assert.equal(whole.status, 200); await whole.body.cancel();
  });
  test('range: a 206 from byte 0 that is no video, a wrong start, html, a lying length -> refused; 200 is sniffed; 416 -> range', async () => {
    const page = Buffer.from('<!doctype html><title>x</title>' + ' '.repeat(120));
    const f = stubFetch({
      'https://cdn.example/fake.mp4': slice(page, 'video/mp4'),
      'https://cdn.example/shift.mp4': slice(CLIP, 'video/mp4', { start: 10 }),
      'https://cdn.example/html.mp4': slice(CLIP, 'text/html', { start: 100, end: 199 }),
      'https://cdn.example/len.mp4': slice(CLIP, 'video/mp4', { start: 100, end: 199, len: 50 }),
      'https://cdn.example/back.mp4': slice(CLIP, 'video/mp4', { start: 300, end: 200 }),
      'https://cdn.example/huge.mp4': slice(CLIP, 'video/mp4', { start: 100, end: 199, total: 5e6 }),
      'https://cdn.example/full.mp4': media(CLIP, 'video/mp4'),
      'https://cdn.example/fullhtml.mp4': media(page, 'video/mp4'),
      'https://cdn.example/past.mp4': () => new Response('', { status: 416, headers: { 'Content-Range': `bytes */${CLIP.length}` } }),
    });
    assert.equal((await ranged(f, 'https://cdn.example/fake.mp4', 'bytes=0-')).error, 'not_media');
    assert.equal((await ranged(f, 'https://cdn.example/shift.mp4', 'bytes=0-')).error, 'bad_range', 'not the start asked for');
    assert.equal((await ranged(f, 'https://cdn.example/html.mp4', 'bytes=100-199')).error, 'not_media');
    assert.equal((await ranged(f, 'https://cdn.example/len.mp4', 'bytes=100-199')).error, 'bad_range');
    assert.equal((await ranged(f, 'https://cdn.example/back.mp4', 'bytes=300-')).error, 'bad_range');
    assert.equal((await ranged(f, 'https://cdn.example/huge.mp4', 'bytes=100-199')).error, 'too_large');
    const full = await ranged(f, 'https://cdn.example/full.mp4', 'bytes=100-');
    assert.equal(full.ok, true); assert.equal(full.status, 200, 'the upstream ignored the Range'); assert.equal(full.length, CLIP.length);
    await full.body.cancel();
    assert.equal((await ranged(f, 'https://cdn.example/fullhtml.mp4', 'bytes=100-')).error, 'not_media', 'a 200 is sniffed as always');
    assert.deepEqual(await ranged(f, 'https://cdn.example/past.mp4', 'bytes=999999-'), { ok: false, error: 'range', status: 416, total: CLIP.length });
    const img = await openMedia('https://cdn.example/p.jpg', { want: 'image', maxBytes: 1e6, safeURL: safe, range: 'bytes=0-',
      fetchImpl: stubFetch({ 'https://cdn.example/p.jpg': slice(POSTER, 'image/jpeg; charset=binary') }) });
    assert.equal(img.ok, true); assert.equal(img.mime, 'image/jpeg'); await img.body.cancel();
    assert.equal(IG_PLAY_MIMES['video/mp4'][0], 'video/mp4'); assert.equal(IG_PLAY_MIMES['text/html'], undefined);
  });
  test('hostOk: every hop must pass it too (a redirect off the Instagram CDN is never fetched)', async () => {
    const igSafe = (href) => { try { const u = new URL(href); return u.protocol === 'https:' ? u : null; } catch { return null; } };
    const f = stubFetch({
      'https://scontent.cdninstagram.com/o1/v/a.mp4': () => new Response(null, { status: 302, headers: { Location: 'https://evil.example/a.mp4' } }),
      'https://scontent.cdninstagram.com/o1/v/b.mp4': () => new Response(null, { status: 302, headers: { Location: 'https://video.fbcdn.net/b.mp4' } }),
      'https://video.fbcdn.net/b.mp4': media(CLIP, 'video/mp4'),
      'https://evil.example/a.mp4': media(CLIP, 'video/mp4'),
    });
    const o = (u) => openMedia(u, { want: 'video', maxBytes: 1e6, safeURL: igSafe, fetchImpl: f, hostOk: igCdnUrl });
    assert.equal((await o('https://scontent.cdninstagram.com/o1/v/a.mp4')).error, 'unsafe');
    assert.ok(!f.calls.some((c) => c.url.includes('evil.example')), 'the other host is never fetched');
    const ok = await o('https://scontent.cdninstagram.com/o1/v/b.mp4');
    assert.equal(ok.ok, true); await ok.body.cancel();
    assert.equal((await o('https://evil.example/a.mp4')).error, 'unsafe');
  });
});

describe('download filenames', () => {
  test('ASCII fallback transliterates Turkish; filename* keeps it', () => {
    assert.equal(asciiFilePart('Şişli Çarşı Ğ ı İ Ö Ü'), 'Sisli-Carsi-G-i-I-O-U');
    assert.equal(unicodeFilePart('Şişli Çarşı / "test"'), 'Şişli-Çarşı-test');
    assert.equal(contentDisposition(['instagram', 'ornek.studio', 'DTestReel01'], 'mp4'),
      `attachment; filename="instagram-ornek.studio-DTestReel01.mp4"; filename*=UTF-8''instagram-ornek.studio-DTestReel01.mp4`);
    assert.equal(contentDisposition(['fikir', 132, 'Gün batımı'], 'jpg'),
      `attachment; filename="fikir-132-Gun-batimi.jpg"; filename*=UTF-8''fikir-132-G%C3%BCn-bat%C4%B1m%C4%B1.jpg`);
  });
  test('header injection, paths and odd input never reach the header', () => {
    const cd = contentDisposition(['fikir', '"; filename="evil.exe\r\nX-Injected: 1', '../../etc/passwd', "it's (a) *test*"], 'mp4');
    assert.ok(!/[\r\n]/.test(cd));
    const ascii = /filename="([^"]*)"/.exec(cd)[1];
    assert.match(ascii, /^[A-Za-z0-9._-]+$/);
    assert.ok(!ascii.includes('..') || !ascii.includes('/'));
    assert.match(cd, /filename\*=UTF-8''[A-Za-z0-9%._-]+$/, "RFC 5987 attr-chars only ('()* encoded)");
    assert.deepEqual(dlFilename([], 'exe'), { ascii: 'fikir.bin', utf8: 'fikir.bin' });
    assert.deepEqual(dlFilename(['', null, '***'], 'mp4'), { ascii: 'fikir.mp4', utf8: 'fikir.mp4' });
    const long = dlFilename(['fikir', 'ş'.repeat(300)], 'mp4');
    assert.ok(long.ascii.length <= 94 && long.utf8.length <= 94);
    assert.equal(dlFilename(['Ünlü 🎬 klip'], 'webm').utf8, 'Ünlü-klip.webm');
  });
  test('titleSlug keeps whole words up to 40 characters', () => {
    assert.equal(titleSlug('  Sayın Gayrimenkul için STM sokaklarında fil yürüyor ve herkes bakıyor  '), 'Sayın Gayrimenkul için STM sokaklarında');
    assert.equal(titleSlug(''), '');
    assert.equal(titleSlug(null), '');
    assert.equal(titleSlug('x'.repeat(60)).length, 40);
  });
});

describe('dlHint (GET /posts, no network)', () => {
  const p = (u) => parseLink(u);
  test('per platform / media', () => {
    assert.equal(dlHint({ type: 'text', parsed: null }), null);
    assert.deepEqual(dlHint({ type: 'instagram', parsed: p('https://www.instagram.com/reel/DTestReel01/') }), { video: true, image: true });
    assert.deepEqual(dlHint({ type: 'instagram', parsed: p('https://www.instagram.com/p/DTestPhoto1/') }), { video: null, image: true });
    // YouTube / Vimeo never give a video (their adapters say why); YouTube's poster comes from i.ytimg.com
    assert.deepEqual(dlHint({ type: 'youtube', parsed: p('https://www.youtube.com/watch?v=dQw4w9WgXcQ') }), { video: false, image: true, reason: 'not_supported' });
    assert.deepEqual(dlHint({ type: 'youtube', parsed: p('https://www.youtube.com/watch?v=dQw4w9WgXcQ'), meta: { image: 'https://i.ytimg.com/vi/x/hq.jpg' } }), { video: false, image: true, reason: 'not_supported' });
    assert.equal(dlHint({ type: 'vimeo', parsed: p('https://vimeo.com/76979871') }), null, 'nothing to download without a thumbnail');
    assert.deepEqual(dlHint({ type: 'vimeo', parsed: p('https://vimeo.com/76979871'), meta: { image: 'https://i.vimeocdn.com/video/1-d' } }), { video: false, image: true, reason: 'drm' });
    assert.deepEqual(dlHint({ type: 'vimeo', parsed: p('https://vimeo.com/76979871'), media: { kind: 'video', url: '/files/fikir/1/v-0123456789abcdef0123456789abcdef.mp4' } }), { video: true, image: false }, 'an upload wins');
    assert.deepEqual(dlHint({ type: 'web', parsed: p('https://www.magnific.com/free-video/abc_1'), meta: { media: { kind: 'video', url: 'https://cdn.example/a.mp4', poster: 'https://cdn.example/a.jpg' } } }), { video: true, image: true });
    assert.deepEqual(dlHint({ type: 'web', parsed: p('https://example.com/a'), meta: { media: { kind: 'hls', url: 'https://cdn.example/a.m3u8' } } }), null);
    assert.deepEqual(dlHint({ type: 'video', parsed: p('https://cdn.example/a.mp4') }), { video: true, image: false });
    assert.deepEqual(dlHint({ type: 'web', parsed: p('https://example.com/a'), media: { kind: 'video', url: '/files/fikir/1/v-0123456789abcdef0123456789abcdef.mp4', poster: null } }), { video: true, image: false });
    assert.deepEqual(dlHint({ type: 'instagram', parsed: p('https://www.instagram.com/p/DTestPhoto1/'), media: { kind: 'video', url: '/files/fikir/1/v-0123456789abcdef0123456789abcdef.mp4' } }), { video: true, image: true });
  });
  test('registered adapters add a "maybe" video', () => {
    const before = DL_ADAPTERS.length;
    registerDlAdapter({ name: 'clips_test', match: (x) => x.platform === 'web' && /^https:\/\/clips\.example\//.test(x.canonical), hint: { video: null, image: true }, resolve: async () => null });
    registerDlAdapter({ name: 'broken' });   // ignored: no match/resolve
    try {
      assert.equal(DL_ADAPTERS.length, before + 1);
      assert.deepEqual(dlHint({ type: 'web', parsed: p('https://clips.example/v/1') }), { video: null, image: true });
      assert.equal(dlHint({ type: 'web', parsed: p('https://other.example/v/1') }), null);
    } finally { DL_ADAPTERS.splice(before); }
  });
});

describe('Instagram copy media + cache helpers', () => {
  const base = { kind: 'video', url: '/files/fikir/7/v-0123456789abcdef0123456789abcdef.mp4', poster: '/files/fikir/7/p-0123456789abcdef0123456789abcdef.jpg', w: 720, h: 1280, mime: 'video/mp4', bytes: 2468559, verified: true };
  test('sanitizeMedia keeps credit/caption/audio for copy sources only', () => {
    const m = sanitizeMedia({ ...base, source: 'instagram', by: 'ornek.studio', caption: 'Merhaba‮ dünya', audio: true }, { allowFiles: true });
    assert.equal(m.source, 'instagram'); assert.equal(m.by, 'ornek.studio'); assert.equal(m.caption, 'Merhaba dünya'); assert.equal(m.audio, true);
    assert.equal(m.url, base.url); assert.equal(m.poster, base.poster);
    const bad = sanitizeMedia({ ...base, source: 'instagram', by: '<img onerror>', caption: 42 }, { allowFiles: true });
    assert.equal(bad.by, undefined); assert.equal(bad.caption, undefined);
    const up = sanitizeMedia({ ...base, source: 'upload', by: 'x', caption: 'y' }, { allowFiles: true });
    assert.equal(up.by, undefined); assert.equal(up.caption, undefined);
    assert.equal(sanitizeMedia({ ...base, source: 'instagram' }), null, '/files paths need allowFiles');
    const capped = sanitizeMedia({ ...base, source: 'instagram', caption: 'ş'.repeat(2600) }, { allowFiles: true });
    assert.equal(Array.from(capped.caption).length, 2000, 'captions up to 2,000 code points');
    for (const src of ['x', 'tiktok', 'facebook', 'pinterest', 'reddit']) {
      const o = sanitizeMedia({ ...base, source: src, by: 'ornek_user-1', caption: 'Başlık\nikinci satır', audio: false }, { allowFiles: true });
      assert.deepEqual({ source: o.source, by: o.by, caption: o.caption, audio: o.audio }, { source: src, by: 'ornek_user-1', caption: 'Başlık\nikinci satır', audio: false }, src);
    }
    assert.equal(sanitizeMedia({ ...base, source: 'instagram', by: 'with-dash' }, { allowFiles: true }).by, undefined, 'Instagram names have no dash');
    assert.equal(sanitizeMedia({ ...base, source: 'youtube', by: 'a' }, { allowFiles: true }).source, undefined, 'never a YouTube copy');
    assert.deepEqual([...COPY_SOURCES].sort(), [...COPY_PLATFORMS].sort());
  });
  test('a caption that would push the media JSON over its cap is shortened, never the media dropped', () => {
    for (const ch of ['😀', '"', '\n', 'ş']) {
      const m = sanitizeMedia({ ...base, source: 'tiktok', by: 'u', caption: ch.repeat(2000) + 'son' }, { allowFiles: true });
      assert.ok(m && m.url === base.url, JSON.stringify(ch));
      assert.ok(JSON.stringify(m).length <= MAX_MEDIA_JSON);
      assert.ok(m.caption === undefined || m.caption.endsWith('…') || Array.from(m.caption).length <= 2000);
    }
    const short = sanitizeMedia({ ...base, source: 'x', caption: 'kısa' }, { allowFiles: true });
    assert.equal(short.caption, 'kısa');
  });
  test('cache extra JSON: long captions are shortened, the JSON never cut', () => {
    const s1 = vcExtraJson({ user: 'u', caption: '😀'.repeat(5000) }, 8000);
    const o = JSON.parse(s1);
    assert.equal(o.user, 'u'); assert.ok(s1.length <= 8000); assert.ok(o.caption.endsWith('…'));
    assert.equal(vcExtraJson(null), null);
    assert.equal(vcExtraJson({ a: 1 }), '{"a":1}');
  });
  test('cache freshness, backoff and row round trip', () => {
    const now = 1_800_000_000;
    assert.equal(vcItemFresh({ resolved_at: now - 100, expires_at: now + 3600 }, now), true);
    assert.equal(vcItemFresh({ resolved_at: now - 100, expires_at: now + 600 }, now), false, '< 15 min left');
    assert.equal(vcItemFresh({ resolved_at: now - 100, expires_at: null }, now), true, 'no oe: 1 h from resolve');
    assert.equal(vcItemFresh({ resolved_at: now - 4000, expires_at: null }, now), false);
    assert.equal(vcItemFresh({ resolved_at: now, expires_at: now + 9999, error: 'x' }, now), false);
    assert.equal(vcBackingOff({ error: 'no_data', retry_at: now + 5 }, now), true);
    assert.equal(vcBackingOff({ error: 'no_data', retry_at: now - 5 }, now), false);
    assert.deepEqual([1, 2, 3, 4, 5, 9].map((n) => backoffS(n)), [600, 1800, 7200, 21600, 86400, 86400]);
    assert.equal(backoffS(1, 'gone'), 7 * 86400);
    assert.equal(backoffS(1, 'never'), 30 * 86400, 'no video / too large: 30 days');
    const it = igExtract(FX('ig-reel.html'), 'DTestReel01');
    const c = itemToCache(it);
    const back = cacheToItem({ url: c.url, poster: c.poster, width: c.width, height: c.height, expires_at: c.expires_at, extra: JSON.stringify(c.extra), resolved_at: now }, 'DTestReel01');
    assert.equal(back.video.url, it.video.url); assert.equal(back.image.url, it.image.url);
    assert.equal(back.user, 'ornek.studio'); assert.equal(back.w, 720); assert.equal(back.has_audio, true);
    // cv 2 rows keep the caption up to 2,000; a row from before whose caption the 300 cap cut is resolved again for a copy;
    // cv 3 adds lv (the lead item is the video: live playback)
    assert.equal(c.extra.cv, 3); assert.equal(c.extra.lv, 1); assert.equal(back.lead_video, true);
    assert.equal(igCacheCaptionCut({ extra: JSON.stringify(c.extra) }), false);
    assert.equal(igCacheCaptionCut({ extra: JSON.stringify({ user: 'a', caption: 'k'.repeat(299) + '…' }) }), true);
    assert.equal(igCacheCaptionCut({ extra: JSON.stringify({ user: 'a', caption: 'kısa açıklama' }) }), false, 'not cut: whole');
    assert.equal(igCacheCaptionCut({ extra: JSON.stringify({ user: 'a', caption: null }) }), false);
    assert.equal(igCacheCaptionCut({ extra: JSON.stringify({ cv: 2, caption: 'k'.repeat(1999) + '…' }) }), false);
    assert.equal(cacheToItem({ url: 'https://evil.example/a.mp4', poster: null, extra: '{}' }, 'x'), null, 'only CDN links come back out of the cache');
    assert.match(VIDEO_CACHE_DDL, /PRIMARY KEY \(post_id, kind\)/);
  });
  test('lv in the cache (cv 3) and igLiveVideo: a video that is the post or its first carousel item', () => {
    const now = 1_800_000_000;
    const row = (it) => { const c = itemToCache(it); return { url: c.url, poster: c.poster, width: c.width, height: c.height, expires_at: c.expires_at, resolved_at: now, extra: JSON.stringify(c.extra) }; };
    const car = igExtract(FX('ig-carousel.html'), 'DTestCarou1');
    const back = cacheToItem(row(car), 'DTestCarou1');
    assert.equal(itemToCache(car).extra.lv, 0); assert.equal(back.lead_video, false); assert.equal(back.media_type, 8);
    // rows from before cv 3 (no lv): a video is the lead one unless the post is a carousel
    const old = (mt) => cacheToItem({ url: 'https://scontent.cdninstagram.com/o1/v/a.mp4', poster: null, extra: JSON.stringify({ cv: 2, media_type: mt }) }, 'x');
    assert.equal(old(2).lead_video, true); assert.equal(old(8).lead_video, false);
    assert.equal(cacheToItem({ url: null, poster: 'https://scontent.cdninstagram.com/v/p.jpg', extra: '{}' }, 'x').lead_video, false, 'photo');
    const T = [
      [{ hasVideo: true, mediaType: 2, lv: 1 }, true], [{ hasVideo: true, mediaType: 2, lv: null }, true], [{ hasVideo: true, mediaType: null, lv: undefined }, true],
      [{ hasVideo: true, mediaType: 8, lv: 1 }, true], [{ hasVideo: true, mediaType: 8, lv: 0 }, false], [{ hasVideo: true, mediaType: '8', lv: null }, false],
      [{ hasVideo: false, mediaType: 2, lv: 1 }, false], [{ hasVideo: 0, mediaType: 1, lv: 0 }, false], [{ hasVideo: true, mediaType: 1, lv: 0 }, true],
    ];
    for (const [arg, want] of T) assert.equal(igLiveVideo(arg), want, JSON.stringify(arg));
  });
  test('vcDefer keeps a row out of the queue without counting a failure (node:sqlite stand-in for D1)', async () => {
    const { DatabaseSync } = await import('node:sqlite');
    const sq = new DatabaseSync(':memory:');
    sq.exec(VIDEO_CACHE_DDL);
    const stmt = (sql, args = []) => ({
      bind: (...a) => stmt(sql, a),
      first: async () => sq.prepare(sql).get(...args) || null,
      run: async () => sq.prepare(sql).run(...args),
    });
    const db = { prepare: (sql) => stmt(sql) };
    const now = Math.floor(Date.now() / 1000);
    const until = await vcDefer(db, 5, 'ig_copy', 30 * 86400, 'not_post');
    let row = await vcGet(db, 5, 'ig_copy');
    assert.ok(Math.abs(until - (now + 30 * 86400)) <= 2); assert.equal(row.retry_at, until);
    assert.equal(row.error, null); assert.equal(row.fail_count, 0); assert.equal(vcExtra(row).deferred, 'not_post');
    await vcFail(db, 6, 'ig_copy', 'redirect', { extra: { removed: 1 } });
    const failed = await vcGet(db, 6, 'ig_copy');
    await vcDefer(db, 6, 'ig_copy', 60, 'busy');
    row = await vcGet(db, 6, 'ig_copy');
    assert.equal(row.retry_at, failed.retry_at, 'an earlier, longer backoff stays');
    assert.equal(row.fail_count, 1); assert.equal(row.error, 'redirect');
    const du1 = vcExtra(row).du;
    assert.ok(Math.abs(du1 - (now + 60)) <= 2, 'its until (du)');
    assert.deepEqual(vcExtra(row), { removed: 1, deferred: 'busy', du: du1 }, 'other extra fields stay');
    await vcDefer(db, 6, 'ig_copy', 86400, 'busy');
    row = await vcGet(db, 6, 'ig_copy');
    assert.ok(row.retry_at > failed.retry_at, 'a later deferral extends it'); assert.equal(vcExtra(row).du, row.retry_at);
    await vcDefer(db, 6, 'ig_copy', 60, 'br');
    assert.equal(vcExtra(await vcGet(db, 6, 'ig_copy')).du, row.retry_at, 'du: the latest deferral\'s until');
    assert.ok(Math.abs(vcExtra(await vcGet(db, 5, 'ig_copy')).du - until) <= 0, 'a new row: du = its retry_at');
  });
});

describe('config guard (downloads)', () => {
  test('worker/wrangler.toml download / Instagram vars are sane', () => {
    const toml = fs.readFileSync(path.join(HERE, '../worker/wrangler.toml'), 'utf8');
    const live = toml.split('\n').map((l) => l.replace(/#.*$/, '')).join('\n');
    const v = (k) => ((new RegExp(`^\\s*${k}\\s*=\\s*"([^"]*)"`, 'm')).exec(live) || [])[1];
    assert.ok(['off', 'blocked', 'all'].includes(v('FIKIR_IG_AUTO')), 'FIKIR_IG_AUTO');
    assert.ok(Number(v('FIKIR_IG_COPY_MB')) <= 40, 'copies stay small');
    assert.ok(Number(v('FIKIR_IG_CRON_COPIES')) <= 3 && Number(v('FIKIR_IG_CRON_CHECKS')) <= 5, 'cron stays gentle');
    assert.ok(Number(v('FIKIR_IG_FETCH_DAILY')) <= 500);
    assert.ok(Number(v('FIKIR_DL_MAX_MB')) <= 200);
    const ads = String(v('FIKIR_DL_ADAPTERS') || '').split(',').map((x) => x.trim()).filter(Boolean);
    assert.ok(ads.every((a) => ['x', 'pinterest', 'tiktok', 'facebook', 'reddit'].includes(a)), 'known adapters only (YouTube / Vimeo cannot download)');
    assert.ok(Number(v('FIKIR_DL_AD_DAILY')) > 0 && Number(v('FIKIR_DL_AD_DAILY')) <= 1000);
    const copies = String(v('FIKIR_COPY_ADAPTERS') || '').split(',').map((x) => x.trim()).filter(Boolean);
    assert.ok(copies.every((a) => ads.includes(a)), 'copies only through download adapters that are on');
    assert.ok(['0', '1'].includes(v('FIKIR_COPY_VIEW')), 'FIKIR_COPY_VIEW');
    assert.ok(Number(v('FIKIR_COPY_VIEW_PER_SESSION')) <= Number(v('FIKIR_COPY_VIEW_PER_IP')) && Number(v('FIKIR_COPY_VIEW_PER_IP')) <= Number(v('FIKIR_COPY_VIEW_DAILY')));
    assert.ok(Number(v('FIKIR_COPY_VIEW_DAILY')) <= Number(v('FIKIR_IG_COPY_DAILY')) && Number(v('FIKIR_IG_COPY_DAILY')) <= 300, 'daily copies stay bounded');
    assert.ok(Number(v('FIKIR_UP_TOTAL_MB')) > 0 && Number(v('FIKIR_UP_TOTAL_MB')) <= 9000, 'the total storage guard stays under R2 Free 10 GB');
    // live playback (nothing stored): on, its cron share small
    assert.ok(['0', '1'].includes(v('FIKIR_IG_LIVE')), 'FIKIR_IG_LIVE');
    assert.ok(/^\d+$/.test(v('FIKIR_IG_LIVE_CRON') || '') && Number(v('FIKIR_IG_LIVE_CRON')) <= 3, 'FIKIR_IG_LIVE_CRON stays gentle');
  });
});

describe('R2 copies of every platform: targets, captions, sizes', () => {
  const L = (u) => parseLink(u);
  test('copyTargetOf: Instagram posts and the adapters that give a file; never YouTube / Vimeo / short links', () => {
    assert.deepEqual(copyTargetOf(L('https://www.instagram.com/reel/DTestReel01/')), { platform: 'instagram', ref: { code: 'DTestReel01', kind: 'reel' } });
    assert.equal(copyTargetOf(L('https://www.instagram.com/p/DTestPhoto1/')).platform, 'instagram');
    for (const [u, pf] of [['https://x.com/ornek/status/1900000000000000001', 'x'], ['https://www.tiktok.com/@ornek/video/7000000000000000001', 'tiktok'],
      ['https://www.facebook.com/reel/500000000000001', 'facebook'], ['https://tr.pinterest.com/pin/100000000000000001/', 'pinterest'],
      ['https://www.reddit.com/r/ornek/comments/1abcdef/baslik/', 'reddit'], ['https://v.redd.it/testvid0001', 'reddit']]) {
      const t = copyTargetOf(L(u));
      assert.equal(t && t.platform, pf, u); assert.equal(t.ad.name, pf);
    }
    for (const u of ['https://www.youtube.com/watch?v=dQw4w9WgXcQ', 'https://vimeo.com/76979871', 'https://vm.tiktok.com/ZMabc123/', 'https://example.com/a',
      'https://www.instagram.com/ornek.studio/', 'https://pin.it/abc123']) assert.equal(copyTargetOf(L(u)), null, u);
    assert.equal(copyTargetOf(L('https://x.com/ornek/status/1900000000000000001'), (pf) => pf !== 'x'), null, 'a platform switched off');
    assert.equal(copyTargetOf(null), null);
    assert.equal(copyKind('instagram'), 'ig_copy'); assert.equal(copyKind('reddit'), 'ad_copy');
    assert.deepEqual(Object.keys(COPY_PLATFORM_TR).sort(), [...COPY_PLATFORMS].sort());
  });
  test('adapters keep the post text as the copy caption (<= 2,000), the title stays short', () => {
    const x = xParse(JSON.parse(FX('x-video.json')), '1900000000000000001');
    assert.equal(x.caption, 'Örnek klip — test https://t.co/TestLink01'); assert.equal(x.by, 'ornek_studio');
    const t = ttParse(ttExtract(FX('tiktok-video.html')).item, '7000000000000000001', null);
    assert.equal(t.caption, 'Örnek TikTok videosu #test');
    assert.equal(pinParse(JSON.parse(FX('pin-video.json'))).caption, 'Örnek video pini');
    const rr = redditRss(FX('reddit-post.rss'));
    assert.ok(rr.caption && rr.caption.length >= rr.title.length);
    const long = xParse({ ...JSON.parse(FX('x-video.json')), text: 'ç'.repeat(3000) }, '1');
    assert.equal(Array.from(long.caption).length, 2000); assert.equal(Array.from(long.title).length, 140);
    // the cache row keeps it (a copy from a cached resolution still has its caption)
    const back = adFromCache('x', { url: x.video.url, poster: x.image.url, width: x.video.w, height: x.video.h, expires_at: 2e9, extra: JSON.stringify(adToCache('x', x).extra) });
    assert.equal(back.caption, x.caption); assert.equal(back.by, 'ornek_studio');
  });
  test('imageDims: JPEG / PNG / GIF / WebP headers; anything else null', () => {
    assert.deepEqual(imageDims(POSTER), { w: 32, h: 18 }, 'the fixture poster (tests/fixtures/media/poster.jpg)');
    const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]), Buffer.from('IHDR'), Buffer.from([0, 0, 2, 208, 0, 0, 5, 0]), Buffer.alloc(8)]);
    assert.deepEqual(imageDims(png), { w: 720, h: 1280 });
    const gif = Buffer.concat([Buffer.from('GIF89a'), Buffer.from([0x40, 0x01, 0xf0, 0x00]), Buffer.alloc(20)]);
    assert.deepEqual(imageDims(gif), { w: 320, h: 240 });
    const vp8x = Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBPVP8X'), Buffer.alloc(8), Buffer.from([0xcf, 0x02, 0x00, 0xff, 0x04, 0x00])]);
    assert.deepEqual(imageDims(vp8x), { w: 720, h: 1280 });
    // a baseline JPEG: SOI, an APP0 segment, SOF0 (height 1280, width 720)
    const jpg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 16, ...Buffer.from('JFIF\0'), 1, 1, 0, 0, 1, 0, 1, 0, 0, 0xff, 0xc0, 0, 17, 8, 0x05, 0x00, 0x02, 0xd0, 3, ...Array(9).fill(0)]);
    assert.deepEqual(imageDims(jpg), { w: 720, h: 1280 });
    assert.equal(imageDims(CLIP), null); assert.equal(imageDims(Buffer.from('<svg></svg>xxxxxxxxxxxxxxxxxxx')), null); assert.equal(imageDims(null), null);
  });
  test('Reddit for a copy (deps.wantPost): the feed for author + title even when the preview knows the video; preview fallback without its generic title', async () => {
    const ad = DL_ADAPTERS.find((a) => a.name === 'reddit');
    const post = L('https://www.reddit.com/r/ornek/comments/1abcdef/ornek_makine/');
    const calls = [];
    const stub = (feedStatus) => async (url) => {
      calls.push(url);
      if (url.endsWith('/.rss')) return feedStatus === 200 ? new Response(FX('reddit-post.rss'), { headers: { 'Content-Type': 'application/atom+xml' } }) : new Response('x', { status: feedStatus });
      if (url.endsWith('DASHPlaylist.mpd')) return new Response(FX('reddit-dash.mpd'), { headers: { 'Content-Type': 'application/dash+xml' } });
      return new Response('nope', { status: 404 });
    };
    const preview = { video: 'https://v.redd.it/testvid0001/CMAF_480.mp4', image: null, title: 'Reddit - İnternetin kalbi' };
    let r = await ad.resolve(post, { fetchImpl: stub(200), preview });
    assert.equal(calls.filter((u) => u.endsWith('.rss')).length, 0, 'a download keeps skipping the feed');
    assert.equal(r.caption, null, 'the generic page title is no caption');
    assert.equal(ad.feed(post, { preview }), false); assert.equal(ad.feed(post, { preview, wantPost: true }), true);
    r = await ad.resolve(post, { fetchImpl: stub(200), preview, wantPost: true });
    assert.deepEqual({ by: r.by, caption: r.caption, mux: r.video.mux }, { by: 'ornek_user', caption: 'Örnek makine & test', mux: 'cmaf' });
    r = await ad.resolve(post, { fetchImpl: stub(429), preview: { ...preview, title: 'Örnek makine : r/ornek' }, wantPost: true });
    assert.equal(r.ok, true, 'feed refused: the preview video');
    assert.deepEqual({ by: r.by, caption: r.caption }, { by: null, caption: 'Örnek makine : r/ornek' });
    assert.equal((await ad.resolve(post, { fetchImpl: stub(429), preview: { video: null }, wantPost: true })).reason, 'blocked', 'no preview video: the feed result stands');
  });
  test('copy records: vcPut keeps a valid extra for a long caption', async () => {
    const { DatabaseSync } = await import('node:sqlite');
    const sq = new DatabaseSync(':memory:');
    sq.exec(VIDEO_CACHE_DDL);
    const stmt = (sql, args = []) => ({ bind: (...a) => stmt(sql, a), first: async () => sq.prepare(sql).get(...args) || null, run: async () => sq.prepare(sql).run(...args) });
    const db = { prepare: (sql) => stmt(sql) };
    await vcPut(db, 9, 'ad', { url: 'https://video.twimg.com/a.mp4', extra: { ad: 'x', caption: '"'.repeat(5000) } });
    const row = await vcGet(db, 9, 'ad');
    assert.equal(vcExtra(row).ad, 'x', 'still valid JSON');
  });
});
