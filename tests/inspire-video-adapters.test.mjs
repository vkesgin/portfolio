// Unit tests for the download adapters in worker/inspire-video.js (X, Pinterest, TikTok, Facebook, Reddit; YouTube and
// Vimeo refuse) and the Reddit mux (worker/cmaf-mux.js, openMuxed). No network: synthetic trimmed fixtures in
// tests/fixtures/video (see its README.md), synthetic fragmented MP4s built below, injected fetch stubs.
// Run from the repo root: node --test tests/
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  dlAdapterFor, dlHint, DL_ADAPTERS, adMediaUrl, urlExpiry, adToCache, adFromCache, xToken, xSyndicationUrl, xParse,
  pinResourceUrl, pinParse, pinHlsCandidates, ttPageUrl, ttChainCookie, ttExtract, ttParse, fbExtract, fbParse,
  redditRef, redditRss, redditMpd, openMedia, openMuxed, extraHeaders,
} from '../worker/inspire-video.js';
import { muxCmafBytes, muxCmafStream, muxedLength, children, parseFmp4 } from '../worker/cmaf-mux.js';
import { parseLink } from '../assets/js/fikir-url.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FX = (f) => fs.readFileSync(path.join(HERE, 'fixtures/video', f), 'utf8');
const FJ = (f) => JSON.parse(FX(f));
const CLIP = fs.readFileSync(path.join(HERE, 'fixtures/media/clip.mp4'));
const P = (u) => parseLink(u);

// fetch stub: routes = [[string | RegExp, Response | (url, init) => Response]]; records calls
function stubFetch(routes) {
  const calls = [];
  const fn = async (url, init = {}) => {
    calls.push({ url: String(url), init });
    for (const [k, r] of routes) {
      if (typeof k === 'string' ? k === String(url) : k.test(String(url))) return typeof r === 'function' ? r(String(url), init) : r.clone();
    }
    return new Response('nope', { status: 404, headers: { 'Content-Type': 'text/plain' } });
  };
  fn.calls = calls;
  return fn;
}
const jsonRes = (o, status = 200, headers = {}) => new Response(JSON.stringify(o), { status, headers: { 'Content-Type': 'application/json', ...headers } });
const htmlRes = (s, status = 200, headers = {}) => new Response(s, { status, headers: { 'Content-Type': 'text/html; charset=utf-8', ...headers } });
const redirect = (to) => () => new Response(null, { status: 302, headers: { Location: to } });
const ad = (name) => DL_ADAPTERS.find((a) => a.name === name);

describe('adapter registry + hints', () => {
  test('each platform link finds its adapter; others none', () => {
    const cases = {
      'https://x.com/ornek_studio/status/1900000000000000001': 'x',
      'https://twitter.com/i/web/status/1900000000000000001': 'x',
      'https://tr.pinterest.com/pin/100000000000000001/': 'pinterest',
      'https://www.tiktok.com/@ornek.tiktok/video/7000000000000000001': 'tiktok',
      'https://www.facebook.com/reel/500000000000001': 'facebook',
      'https://www.facebook.com/watch/?v=500000000000001': 'facebook',
      'https://www.reddit.com/r/ornek/comments/1abcdef/ornek_makine/': 'reddit',
      'https://v.redd.it/testvid0001': 'reddit',
      'https://vimeo.com/76979871': 'vimeo',
      'https://www.youtube.com/shorts/dQw4w9WgXcQ': 'youtube',
    };
    for (const [u, name] of Object.entries(cases)) assert.equal(dlAdapterFor(P(u))?.name, name, u);
    for (const u of ['https://x.com/ornek_studio', 'https://pin.it/AbCdE', 'https://vm.tiktok.com/ZMabc/', 'https://www.tiktok.com/@ornek.tiktok/photo/7000000000000000001',
      'https://www.facebook.com/ornek/posts/123456789', 'https://www.reddit.com/r/ornek/', 'https://www.reddit.com/r/ornek/s/AbCdEf12', 'https://example.com/a',
      'https://www.instagram.com/reel/DTestReel01/', 'https://www.youtube.com/playlist?list=PL0123456789']) {
      assert.equal(dlAdapterFor(P(u)), null, u);
    }
  });
  test('download hints per platform (no network)', () => {
    const h = (u, extra = {}) => dlHint({ type: P(u).platform, parsed: P(u), ...extra });
    assert.deepEqual(h('https://www.tiktok.com/@ornek.tiktok/video/7000000000000000001'), { video: true, image: true });
    assert.deepEqual(h('https://www.facebook.com/reel/500000000000001'), { video: true, image: true });
    assert.deepEqual(h('https://www.pinterest.com/pin/100000000000000001/'), { video: null, image: true });
    assert.deepEqual(h('https://x.com/i/status/1900000000000000001'), { video: null, image: false });
    assert.deepEqual(h('https://x.com/i/status/1900000000000000001', { meta: { image: 'https://pbs.twimg.com/media/a.jpg' } }), { video: null, image: true });
    assert.deepEqual(h('https://v.redd.it/testvid0001'), { video: null, image: false });
    assert.deepEqual(h('https://www.youtube.com/watch?v=dQw4w9WgXcQ'), { video: false, image: true, reason: 'not_supported' });
  });
  test('only the platform CDN hosts pass adMediaUrl; signed-link expiry', () => {
    assert.ok(adMediaUrl('x', 'https://video.twimg.com/a.mp4'));
    assert.ok(adMediaUrl('tiktok', 'https://v16-webapp-prime.tiktok.com/video/x/?expire=1'));
    assert.ok(adMediaUrl('tiktok', 'https://p16-sign.tiktokcdn-us.com/obj/x.jpeg'));
    assert.ok(adMediaUrl('facebook', 'https://video.fayt2-4.fna.fbcdn.net/o1/a.mp4'));
    for (const [n, u] of [['x', 'http://video.twimg.com/a.mp4'], ['x', 'https://video.twimg.com.evil.example/a.mp4'], ['pinterest', 'https://v1.pinimg.com:8443/a.mp4'],
      ['facebook', 'https://fbcdn.net.evil.example/a.mp4'], ['reddit', 'https://u:p@v.redd.it/a'], ['youtube', 'https://www.youtube.com/a.jpg'], ['nope', 'https://video.twimg.com/a.mp4'],
      ['x', 'javascript:alert(1)'], ['x', null]]) assert.equal(adMediaUrl(n, u), null, `${n} ${u}`);
    assert.equal(urlExpiry('https://v16-webapp-prime.tiktok.com/v/?expire=1791460000&a=1'), 1791460000);
    assert.equal(urlExpiry('https://p16-sign.tiktokcdn.com/a.jpg?x-expires=1791630000'), 1791630000);
    assert.equal(urlExpiry('https://video.xx.fbcdn.net/a.mp4?oe=6ACD501E'), 0x6ACD501E);
    assert.equal(urlExpiry('https://video.twimg.com/a.mp4'), null);
    assert.equal(urlExpiry('https://a.example/?expire=12'), null);
  });
});

describe('X / Twitter', () => {
  test('token + syndication URL', () => {
    assert.match(xToken('1900000000000000001'), /^[0-9a-z]+$/);
    assert.equal(xSyndicationUrl('20'), `https://cdn.syndication.twimg.com/tweet-result?id=20&lang=en&token=${xToken('20')}`);
  });
  test('video tweet: largest MP4 up to 1080p, poster, credit; foreign hosts and HLS dropped', () => {
    const r = xParse(FJ('x-video.json'), '1900000000000000001');
    assert.equal(r.ok, true);
    assert.match(r.video.url, /\/vid\/1920x1080\/TestFull01\.mp4/);
    assert.deepEqual([r.video.w, r.video.h, r.video.audio, r.video.expires_at], [1920, 1080, true, null]);
    assert.equal(r.image.url, 'https://pbs.twimg.com/ext_tw_video_thumb/1900000000000000001/pu/img/TestPoster01.jpg');
    assert.equal(r.by, 'ornek_studio'); assert.equal(r.duration, 12.3);
    assert.match(xParse(FJ('x-video.json'), '1', { maxShort: 720 }).video.url, /1280x720/);
  });
  test('photo / quoted video / tombstone / empty', () => {
    const p = xParse(FJ('x-photo.json'), '1900000000000000002');
    assert.equal(p.ok, false); assert.equal(p.reason, 'no_video'); assert.equal(p.retry, 'gone');
    assert.equal(p.image.url, 'https://pbs.twimg.com/media/TestPhoto01.jpg');
    const quoted = { id_str: '3', user: { screen_name: 'a' }, mediaDetails: [], quoted_tweet: FJ('x-video.json') };
    assert.match(xParse(quoted, '3').video.url, /TestFull01/);
    const gif = { id_str: '4', mediaDetails: [{ type: 'animated_gif', media_url_https: 'https://pbs.twimg.com/tweet_video_thumb/G.jpg', original_info: { width: 498, height: 280 },
      video_info: { variants: [{ bitrate: 0, content_type: 'video/mp4', url: 'https://video.twimg.com/tweet_video/G.mp4' }] } }] };
    assert.deepEqual([xParse(gif, '4').video.audio, xParse(gif, '4').video.w], [false, 498]);
    assert.equal(xParse({ __typename: 'TweetTombstone' }, '5').reason, 'login_required');
    assert.equal(xParse({}, '6').reason, 'not_found');
  });
  test('resolve: one JSON request, no redirects to other hosts', async () => {
    const f = stubFetch([[/^https:\/\/cdn\.syndication\.twimg\.com\/tweet-result\?id=1900000000000000001&lang=en&token=/, jsonRes(FJ('x-video.json'))]]);
    const r = await ad('x').resolve(P('https://x.com/ornek_studio/status/1900000000000000001'), { fetchImpl: f });
    assert.equal(r.ok, true); assert.equal(f.calls.length, 1);
    assert.equal(f.calls[0].init.redirect, 'manual');
    const g = stubFetch([[/tweet-result/, redirect('http://169.254.169.254/latest')]]);
    assert.equal((await ad('x').resolve(P('https://x.com/i/status/7'), { fetchImpl: g })).reason, 'upstream');
    assert.equal(g.calls.length, 1, 'the foreign redirect is never followed');
    const n = stubFetch([[/tweet-result/, jsonRes({}, 404)]]);
    assert.equal((await ad('x').resolve(P('https://x.com/i/status/7'), { fetchImpl: n })).reason, 'not_found');
    const l = stubFetch([[/tweet-result/, jsonRes({}, 429)]]);
    const lr = await ad('x').resolve(P('https://x.com/i/status/7'), { fetchImpl: l });
    assert.deepEqual([lr.reason, lr.retry], ['blocked', 'soon']);
  });
});

describe('Pinterest', () => {
  test('PinResource: 720p MP4 first; idea pin HLS -> progressive candidates; image pin', () => {
    const v = pinParse(FJ('pin-video.json'));
    assert.equal(v.mp4s[0].url, 'https://v1.pinimg.com/videos/mc/720p/aa/bb/cc/aabbcc0011223344556677889900aabb.mp4');
    assert.deepEqual([v.mp4s[0].w, v.mp4s[0].h, v.duration, v.by], [720, 1280, 17, 'ornekpinner']);
    assert.match(v.image, /^https:\/\/i\.pinimg\.com\/originals\//);
    const s = pinParse(FJ('pin-story.json'));
    assert.equal(s.mp4s.length, 0); assert.equal(s.hls.length, 1); assert.equal(s.by, 'ornek.creator'); assert.equal(s.title, 'Fikir pini');
    assert.deepEqual(pinHlsCandidates(s.hls[0]), [
      'https://v1.pinimg.com/videos/iht/expMp4/dd/ee/ff/ddeeff00112233445566778899aabbcc_720w.mp4',
      'https://v1.pinimg.com/videos/iht/720p/dd/ee/ff/ddeeff00112233445566778899aabbcc.mp4',
      'https://v1.pinimg.com/videos/mc/720p/dd/ee/ff/ddeeff00112233445566778899aabbcc.mp4',
      'https://v1.pinimg.com/videos/iht/expMp4/dd/ee/ff/ddeeff00112233445566778899aabbcc_t5.mp4']);
    assert.deepEqual(pinHlsCandidates('https://evil.example/videos/iht/hls/dd/ee/ff/x.m3u8'), []);
    const i = pinParse(FJ('pin-image.json'));
    assert.equal(i.mp4s.length + i.hls.length, 0);
    assert.equal(pinParse({}), null);
    assert.match(pinResourceUrl('100000000000000001'), /^https:\/\/www\.pinterest\.com\/resource\/PinResource\/get\/\?source_url=%2Fpin%2F100000000000000001%2F&data=/);
  });
  test('resolve: XHR headers, locale redirect followed, HEAD-checked idea-pin file, image pin', async () => {
    const f = stubFetch([
      [/^https:\/\/www\.pinterest\.com\/resource\/PinResource\/get\//, (u) => redirect(u.replace('www.', 'tr.'))()],
      [/^https:\/\/tr\.pinterest\.com\/resource\/PinResource\/get\/.*100000000000000002/, jsonRes(FJ('pin-story.json'))],
      [/_720w\.mp4$/, new Response(null, { status: 403 })],
      [/iht\/720p\/.*\.mp4$/, new Response(null, { status: 200, headers: { 'Content-Type': 'video/mp4', 'Content-Length': '2255385' } })],
    ]);
    const r = await ad('pinterest').resolve(P('https://www.pinterest.com/pin/100000000000000002/'), { fetchImpl: f });
    assert.equal(r.ok, true);
    assert.equal(r.video.url, 'https://v1.pinimg.com/videos/iht/720p/dd/ee/ff/ddeeff00112233445566778899aabbcc.mp4');
    assert.equal(r.video.bytes, 2255385); assert.equal(r.by, 'ornek.creator');
    assert.equal(f.calls[0].init.headers['X-Requested-With'], 'XMLHttpRequest');
    assert.equal(f.calls[0].init.headers['X-Pinterest-PWS-Handler'], 'www/pin/[id].js');
    assert.equal(f.calls.filter((c) => c.init.method === 'HEAD').length, 2);
    const g = stubFetch([[/PinResource/, jsonRes(FJ('pin-image.json'))]]);
    const im = await ad('pinterest').resolve(P('https://www.pinterest.com/pin/100000000000000003/'), { fetchImpl: g });
    assert.deepEqual([im.ok, im.reason, im.image.url], [false, 'no_video', 'https://i.pinimg.com/originals/11/22/33/112233aabbccddeeff00112233445566.jpg']);
    const v = stubFetch([[/PinResource/, jsonRes(FJ('pin-video.json'))]]);
    assert.match((await ad('pinterest').resolve(P('https://www.pinterest.com/pin/100000000000000001/'), { fetchImpl: v })).video.url, /mc\/720p\//);
    const none = stubFetch([[/PinResource/, jsonRes(FJ('pin-story.json'))], [/\.mp4$/, new Response(null, { status: 403 })]]);
    assert.equal((await ad('pinterest').resolve(P('https://www.pinterest.com/pin/100000000000000002/'), { fetchImpl: none })).reason, 'not_supported');
  });
});

describe('TikTok', () => {
  test('page data -> H.264 up to 1080p, cookie-bound private link, cover, creator setting', () => {
    const ex = ttExtract(FX('tiktok-video.html'));
    const r = ttParse(ex.item, '7000000000000000001', 'tt_chain_token=AbC1==');
    assert.equal(r.ok, true);
    assert.match(r.video.url, /h264_1080/, 'H.264 1080p (not H.265, not 1440p)');
    assert.deepEqual([r.video.w, r.video.h, r.video.bytes, r.video.expires_at], [1080, 1920, 7100000, 1791460000]);
    assert.deepEqual(r.video.headers, { Referer: 'https://www.tiktok.com/', Cookie: 'tt_chain_token=AbC1==' });
    assert.equal(r.video.private, true);
    assert.match(r.image.url, /^https:\/\/p16-sign\.tiktokcdn\.com\/obj\/test-origin/);
    assert.equal(r.by, 'ornek.tiktok'); assert.equal(r.creator_download, false);
    assert.deepEqual(ttExtract(FX('tiktok-removed.html')), { error: 'status', statusCode: 10204 });
    assert.deepEqual(ttExtract('<html></html>'), { error: 'no_data' });
    assert.equal(ttPageUrl(P('https://www.tiktok.com/@ornek.tiktok/video/7000000000000000001')), 'https://www.tiktok.com/@ornek.tiktok/video/7000000000000000001');
    assert.equal(ttParse({ id: '7000000000000000009', imagePost: { images: [] }, video: {} }, 'x', null).reason, 'no_video');
  });
  test('tt_chain_token is the only cookie replayed', () => {
    assert.equal(ttChainCookie(['ttwid=1|abc; Path=/', 'tt_chain_token=XYZ==; path=/; secure; httponly', 'sessionid=nope']), 'tt_chain_token=XYZ==');
    assert.equal(ttChainCookie(['tt_chain_token=bad value\r\nX: 1']), null);
    assert.equal(ttChainCookie([]), null);
  });
  test('resolve: navigation headers, cookie from the page response (also across a same-site redirect), removed video', async () => {
    const f = stubFetch([
      ['https://www.tiktok.com/@/video/7000000000000000001', () => new Response(null, { status: 301, headers: { Location: '/@ornek.tiktok/video/7000000000000000001', 'Set-Cookie': 'tt_chain_token=Q1; path=/' } })],
      ['https://www.tiktok.com/@ornek.tiktok/video/7000000000000000001', () => htmlRes(FX('tiktok-video.html'), 200, { 'Set-Cookie': 'ttwid=x; path=/' })],
    ]);
    const r = await ad('tiktok').resolve(P('https://www.tiktok.com/embed/v2/7000000000000000001'), { fetchImpl: f });
    assert.equal(r.ok, true);
    assert.equal(r.video.headers.Cookie, 'tt_chain_token=Q1');
    assert.equal(f.calls[0].init.headers['Sec-Fetch-Mode'], 'navigate');
    assert.match(f.calls[0].init.headers['User-Agent'], /Macintosh.*Chrome/);
    const g = stubFetch([[/tiktok\.com\/@/, htmlRes(FX('tiktok-removed.html'))]]);
    const rr = await ad('tiktok').resolve(P('https://www.tiktok.com/@ornek.tiktok/video/7000000000000000001'), { fetchImpl: g });
    assert.deepEqual([rr.reason, rr.retry], ['not_found', 'gone']);
    const l = stubFetch([[/tiktok\.com\/@/, redirect('https://www.tiktok.com/login?redirect_url=x')], [/tiktok\.com\/login/, htmlRes('<title>Log in</title>')]]);
    assert.equal((await ad('tiktok').resolve(P('https://www.tiktok.com/@a/video/7000000000000000001'), { fetchImpl: l })).reason, 'login_required');
  });
});

describe('Facebook', () => {
  test('page JSON: the object of this id (not a related video), HD first, signed expiry', () => {
    const o = fbExtract(FX('fb-reel.html'), '500000000000001');
    const r = fbParse(o, '500000000000001');
    assert.equal(r.ok, true);
    assert.match(r.video.url, /TestReel01_hd\.mp4/);
    assert.equal(r.video.expires_at, 0x6ACD501E); assert.equal(r.duration, 65.3);
    assert.match(r.image.url, /TestReel01_n\.jpg/);
    assert.match(fbParse(fbExtract(FX('fb-reel.html'), '500000000000002'), '500000000000002').video.url, /TestDecoy_hd/);
    assert.equal(fbExtract(FX('fb-reel.html'), '500000000000009'), null);
    assert.equal(fbParse({ videoDeliveryLegacyFields: { browser_native_hd_url: 'https://evil.example/a.mp4' } }, '1').reason, 'no_video');
  });
  test('resolve: reel page; login wall / login redirect -> login_required', async () => {
    const f = stubFetch([['https://www.facebook.com/reel/500000000000001', htmlRes(FX('fb-reel.html'))]]);
    const r = await ad('facebook').resolve(P('https://www.facebook.com/reel/500000000000001'), { fetchImpl: f });
    assert.equal(r.ok, true); assert.equal(f.calls[0].init.headers['Sec-Fetch-Dest'], 'document');
    const g = stubFetch([[/watch/, redirect('https://www.facebook.com/login/?next=x')], [/\/login\//, htmlRes('<form id="login_form"></form>')]]);
    assert.equal((await ad('facebook').resolve(P('https://www.facebook.com/watch/?v=500000000000003'), { fetchImpl: g })).reason, 'login_required');
    const h = stubFetch([[/reel/, htmlRes('<title>Facebook</title><div>Log in to Facebook</div>')]]);
    assert.equal((await ad('facebook').resolve(P('https://www.facebook.com/reel/500000000000004'), { fetchImpl: h })).reason, 'login_required');
    const k = stubFetch([[/reel/, htmlRes('<title>Facebook</title><script type="application/json">{"browser_native":1}</script>')]]);
    assert.deepEqual(await ad('facebook').resolve(P('https://www.facebook.com/reel/500000000000005'), { fetchImpl: k }).then((x) => [x.reason, x.retry]), ['parse_failed', 'soon']);
  });
});

describe('Reddit', () => {
  test('link forms, feed, DASH playlist', () => {
    assert.deepEqual(redditRef('https://www.reddit.com/r/ornek/comments/1AbCdEf/x/'), { sub: 'ornek', postId: '1abcdef', vid: null });
    assert.deepEqual(redditRef('https://old.reddit.com/comments/1abcdef'), { sub: null, postId: '1abcdef', vid: null });
    assert.deepEqual(redditRef('https://v.redd.it/testvid0001'), { sub: null, postId: null, vid: 'testvid0001' });
    for (const u of ['https://www.reddit.com/r/ornek/s/AbCdEf12', 'https://reddit.com.evil.example/r/a/comments/abc/', 'nope']) assert.equal(redditRef(u), null, u);
    const post = redditRss(FX('reddit-post.rss'));
    assert.deepEqual([post.vid, post.author, post.title], ['testvid0001', 'ornek_user', 'Örnek makine & test']);
    assert.equal(post.thumb, 'https://external-preview.redd.it/TestThumb01.png?width=320&crop=smart&s=abc');
    const m = redditMpd(FX('reddit-dash.mpd'));
    assert.deepEqual(m.video.map((x) => x.file), ['CMAF_270.mp4', 'CMAF_720.mp4', 'CMAF_1080.mp4', 'CMAF_1440.mp4'], '../escape.mp4 dropped');
    assert.deepEqual(m.audio.map((x) => x.file), ['CMAF_AUDIO_64.mp4', 'CMAF_AUDIO_128.mp4']);
    assert.equal(m.duration, 16.1);
  });
  test('resolve: descriptive UA on the feed, then DASH -> picture + sound to mux', async () => {
    const f = stubFetch([
      ['https://www.reddit.com/r/ornek/comments/1abcdef/.rss', () => new Response(FX('reddit-post.rss'), { headers: { 'Content-Type': 'application/atom+xml' } })],
      ['https://v.redd.it/testvid0001/DASHPlaylist.mpd', () => new Response(FX('reddit-dash.mpd'), { headers: { 'Content-Type': 'application/dash+xml' } })],
    ]);
    const r = await ad('reddit').resolve(P('https://www.reddit.com/r/ornek/comments/1abcdef/ornek_makine/'), { fetchImpl: f });
    assert.equal(r.ok, true);
    assert.deepEqual([r.video.url, r.video.audio_url, r.video.mux, r.video.audio], ['https://v.redd.it/testvid0001/CMAF_1080.mp4', 'https://v.redd.it/testvid0001/CMAF_AUDIO_128.mp4', 'cmaf', true]);
    assert.deepEqual([r.id, r.by, r.image.url.startsWith('https://external-preview.redd.it/')], ['1abcdef', 'ornek_user', true]);
    assert.match(f.calls[0].init.headers['User-Agent'], /^web:fikir-board:/);
    const g = stubFetch([[/\.rss$/, new Response('', { status: 429 })]]);
    assert.equal((await ad('reddit').resolve(P('https://www.reddit.com/r/ornek/comments/1zzzzzz/'), { fetchImpl: g })).reason, 'blocked');
    const d = stubFetch([[/DASHPlaylist/, new Response(FX('reddit-dash.mpd'))]]);
    const direct = await ad('reddit').resolve(P('https://v.redd.it/testvid0001'), { fetchImpl: d, maxShort: 720 });
    assert.equal(direct.video.url, 'https://v.redd.it/testvid0001/CMAF_720.mp4');
  });
  test('a link preview that knows the v.redd.it video spares the (rate-limited) feed', async () => {
    const post = P('https://www.reddit.com/r/ornek/comments/1abcdef/ornek_makine/');
    const preview = { video: 'https://v.redd.it/testvid0001/CMAF_480.mp4', image: 'https://external-preview.redd.it/TestThumb01.png?s=1' };
    assert.equal(ad('reddit').feed(post, {}), true);
    assert.equal(ad('reddit').feed(post, { preview }), false);
    assert.equal(ad('reddit').feed(P('https://v.redd.it/testvid0001'), {}), false);
    assert.equal(ad('reddit').feed(post, { preview: { video: 'https://cdn.example/v.mp4' } }), true);
    const f = stubFetch([['https://v.redd.it/testvid0001/DASHPlaylist.mpd', () => new Response(FX('reddit-dash.mpd'))]]);
    const r = await ad('reddit').resolve(post, { fetchImpl: f, preview });
    assert.deepEqual([r.ok, r.id, r.video.mux, r.image.url], [true, '1abcdef', 'cmaf', preview.image]);
    assert.deepEqual(f.calls.map((c) => c.url), ['https://v.redd.it/testvid0001/DASHPlaylist.mpd'], 'no feed request');
  });
});

describe('YouTube / Vimeo refuse without a request', () => {
  test('reasons + YouTube poster', async () => {
    const f = stubFetch([]);
    const y = await ad('youtube').resolve(P('https://www.youtube.com/watch?v=dQw4w9WgXcQ'), { fetchImpl: f });
    assert.deepEqual([y.ok, y.reason, y.retry, y.image.url], [false, 'not_supported', 'gone', 'https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg']);
    const v = await ad('vimeo').resolve(P('https://vimeo.com/76979871'), { fetchImpl: f });
    assert.deepEqual([v.ok, v.reason], [false, 'drm']);
    assert.equal(f.calls.length, 0);
    assert.equal(ad('youtube').support, false); assert.equal(ad('vimeo').support, false);
  });
});

describe('adapter cache rows', () => {
  const row = (c) => ({ ...c, extra: JSON.stringify(c.extra), resolved_at: 1, error: null });
  test('round trip; TikTok links are never cached; foreign URLs never come back out', () => {
    const x = xParse(FJ('x-video.json'), '1900000000000000001');
    const c = adToCache('x', x, 1_800_000_000);
    assert.equal(c.expires_at, 1_800_000_000 + 7 * 86400, 'no expiry: 7 days');
    const back = adFromCache('x', row(c));
    assert.deepEqual([back.ok, back.video.url, back.image.url, back.by, back.id], [true, x.video.url, x.image.url, 'ornek_studio', '1900000000000000001']);
    assert.equal(adFromCache('pinterest', row(c)), null, 'another adapter');
    const t = ttParse(ttExtract(FX('tiktok-video.html')).item, '7000000000000000001', 'tt_chain_token=S');
    const tc = adToCache('tiktok', t, 1_800_000_000);
    assert.equal(tc.url, null); assert.ok(!JSON.stringify(tc).includes('tt_chain_token'));
    assert.equal(tc.expires_at, 1791460000, 'the earliest signed-link expiry');
    const tb = adFromCache('tiktok', row(tc));
    assert.deepEqual([tb.ok, tb.video.url, tb.video.private], [true, null, true]);
    const nv = adFromCache('pinterest', row(adToCache('pinterest', pinParse(FJ('pin-image.json')) && { ok: false, reason: 'no_video', id: '1', image: { url: 'https://i.pinimg.com/originals/a.jpg' } })));
    assert.deepEqual([nv.ok, nv.reason, nv.image.url], [false, 'no_video', 'https://i.pinimg.com/originals/a.jpg']);
    const evil = adFromCache('x', row({ ...c, url: 'https://evil.example/a.mp4' }));
    assert.equal(evil, null);
    const rd = adToCache('reddit', { ok: true, id: '1abcdef', video: { url: 'https://v.redd.it/v/CMAF_720.mp4', audio_url: 'https://v.redd.it/v/CMAF_AUDIO_128.mp4', mux: 'cmaf', audio: true } });
    const rb = adFromCache('reddit', row(rd));
    assert.deepEqual([rb.video.mux, rb.video.audio_url], ['cmaf', 'https://v.redd.it/v/CMAF_AUDIO_128.mp4']);
  });
});

describe('openMedia extra headers (TikTok)', () => {
  const safe = (href) => { try { const u = new URL(href); return u.protocol === 'https:' && /\.example$|tiktok\.com$/.test(u.hostname) ? u : null; } catch { return null; } };
  const mp4 = () => new Response(CLIP, { status: 200, headers: { 'Content-Type': 'video/mp4', 'Content-Length': String(CLIP.length) } });
  test('sent to the first host only, dropped after a cross-host redirect; only Referer / Cookie / Origin pass', async () => {
    const f = stubFetch([
      ['https://v16-webapp-prime.tiktok.com/v/1', mp4],
      ['https://v16-webapp-prime.tiktok.com/v/2', redirect('https://cdn.other.example/v/2')],
      ['https://cdn.other.example/v/2', mp4],
    ]);
    const headers = { Referer: 'https://www.tiktok.com/', Cookie: 'tt_chain_token=S', Authorization: 'Bearer nope', Host: 'evil' };
    const a = await openMedia('https://v16-webapp-prime.tiktok.com/v/1', { want: 'video', maxBytes: 1e6, safeURL: safe, fetchImpl: f, headers });
    assert.equal(a.ok, true); await a.body.cancel();
    assert.equal(f.calls[0].init.headers.Cookie, 'tt_chain_token=S'); assert.equal(f.calls[0].init.headers.Referer, 'https://www.tiktok.com/');
    assert.equal(f.calls[0].init.headers.Authorization, undefined); assert.equal(f.calls[0].init.headers.Host, undefined);
    const b = await openMedia('https://v16-webapp-prime.tiktok.com/v/2', { want: 'video', maxBytes: 1e6, safeURL: safe, fetchImpl: f, headers });
    assert.equal(b.ok, true); await b.body.cancel();
    assert.equal(f.calls[1].init.headers.Cookie, 'tt_chain_token=S');
    assert.equal(f.calls[2].init.headers.Cookie, undefined, 'never to another host');
    assert.equal(f.calls[2].init.headers.Referer, undefined);
    assert.deepEqual(extraHeaders({ Cookie: 'a\r\nX-Evil: 1', referer: 'https://www.tiktok.com/' }), { referer: 'https://www.tiktok.com/' });
  });
});

/* ---------------------------------------------------------------- Reddit mux: synthetic fragmented MP4s */

const u32b = (v) => [(v >>> 24) & 255, (v >>> 16) & 255, (v >>> 8) & 255, v & 255];
const u64b = (v) => [...u32b(Math.floor(v / 2 ** 32)), ...u32b(v >>> 0)];
const str = (s) => [...s].map((c) => c.charCodeAt(0));
const mk = (type, ...body) => { const b = body.flat(); return [...u32b(8 + b.length), ...str(type), ...b]; };
const full = (type, version, flags, ...body) => mk(type, [version, (flags >> 16) & 255, (flags >> 8) & 255, flags & 255], ...body);
const zeros = (n) => new Array(n).fill(0);
// One single-track fragmented MP4 (CMAF layout: ftyp, moov(mvhd, trak, mvex), sidx, then moof/mdat pairs)
function fmp4({ handler, timescale, movieTimescale, frags, elst = null, baseOffset = false, trackId = 1 }) {
  const mvhd = full('mvhd', 0, 0, zeros(8), u32b(movieTimescale), u32b(0), zeros(76), u32b(trackId + 1));
  const tkhd = full('tkhd', 0, 3, zeros(8), u32b(trackId), zeros(64));
  const mdhd = full('mdhd', 0, 0, zeros(8), u32b(timescale), u32b(0), zeros(4));
  const hdlr = full('hdlr', 0, 0, zeros(4), str(handler), zeros(12), [0]);
  const edts = elst ? mk('edts', full('elst', 0, 0, u32b(1), u32b(elst), u32b(0), u32b(0x10000))) : [];
  const trak = mk('trak', tkhd, edts, mk('mdia', mdhd, hdlr, mk('minf')));
  const mvex = mk('mvex', full('trex', 0, 0, u32b(trackId), u32b(1), zeros(12)));
  const moov = mk('moov', mvhd, trak, mvex);
  const pairs = frags.map(([t, n], i) => {
    const payload = Array.from({ length: n }, (_, k) => (k * 7 + i * 13 + handler.charCodeAt(0)) & 255);
    const tfhd = full('tfhd', 0, baseOffset ? 0x000001 : 0x020000, u32b(trackId), baseOffset ? u64b(0) : []);
    const moof = mk('moof', full('mfhd', 0, 0, u32b(i + 1)), mk('traf', tfhd, full('tfdt', 1, 0, u64b(t)), full('trun', 0, 1, u32b(1), u32b(0))));
    return [...moof, ...mk('mdat', payload)];
  });
  const sidx = full('sidx', 0, 0, u32b(trackId), u32b(timescale), u32b(0), u32b(0), [0, 0], [0, frags.length],
    ...pairs.map((p) => [...u32b(p.length), ...u32b(timescale), ...u32b(0x90000000)]));
  const ftyp = mk('ftyp', str('mp41'), u32b(0), str('iso8isommp41dashcmfc'));
  return new Uint8Array([...ftyp, ...moov, ...sidx, ...pairs.flat()]);
}
const VIDEO = fmp4({ handler: 'vide', timescale: 15360, movieTimescale: 1000, frags: [[0, 3000], [30720, 5000], [61440, 4000]] });
const AUDIO = fmp4({ handler: 'soun', timescale: 48000, movieTimescale: 48000, elst: 96000, frags: [[0, 300], [48000, 310], [96000, 320], [144000, 330], [192000, 340], [240000, 350]] });
const chunked = (bytes, size) => new ReadableStream({ start(c) { for (let i = 0; i < bytes.length; i += size) c.enqueue(bytes.slice(i, i + size)); c.close(); } });
const readAll = async (s) => new Uint8Array(await new Response(s).arrayBuffer());

describe('CMAF mux (worker/cmaf-mux.js)', () => {
  test('two single-track files -> one file, two tracks, fragments interleaved by time, payloads untouched', () => {
    const out = muxCmafBytes(VIDEO, AUDIO);
    const top = children(out);
    assert.deepEqual(top.slice(0, 2).map((b) => b.type), ['ftyp', 'moov']);
    assert.ok(!top.some((b) => b.type === 'sidx'), 'sidx dropped');
    const f = parseFmp4(out);
    const order = f.frags.map((fr) => { const tf = out.subarray(fr.start, fr.end); const traf = children(tf, 8 + 16, tf.length)[0]; return tf[traf.start + 8 + 8 + 4 + 3]; });
    // a0 v0 | a1 a2 v1 | a3 a4 v2 | a5   (audio at 0..5 s, video at 0, 2, 4 s)
    assert.deepEqual(order, [2, 1, 2, 2, 1, 2, 2, 1, 2]);
    const seqs = f.frags.map((fr) => { const v = new DataView(out.buffer, out.byteOffset + fr.start); return v.getUint32(8 + 8 + 4); });
    assert.deepEqual(seqs, [1, 2, 3, 4, 5, 6, 7, 8, 9]);
    const moov = top.find((b) => b.type === 'moov');
    const traks = children(out, moov.start + 8, moov.end).filter((b) => b.type === 'trak');
    assert.equal(traks.length, 2);
    const ids = traks.map((t) => { const tk = children(out, t.start + 8, t.end)[0]; return new DataView(out.buffer, out.byteOffset + tk.start).getUint32(20); });
    assert.deepEqual(ids, [1, 2]);
    const elst = (() => { const s = Buffer.from(out).indexOf('elst'); return new DataView(out.buffer, out.byteOffset + s - 4).getUint32(16); })();
    assert.equal(elst, 2000, 'audio edit list rescaled to the video movie timescale (2 s)');
    const mdats = top.filter((b) => b.type === 'mdat').map((b) => b.end - b.start - 8);
    assert.deepEqual(mdats, [300, 3000, 310, 320, 5000, 330, 340, 4000, 350]);
  });
  test('streaming = in-memory = planned length, for any chunking', async () => {
    const mem = muxCmafBytes(VIDEO, AUDIO);
    assert.equal(muxedLength(VIDEO.subarray(0, 65536), AUDIO), mem.length);
    for (const size of [1, 3, 7, 64, 1000, 1 << 20]) {
      const s = await readAll(muxCmafStream(chunked(VIDEO, size), AUDIO));
      assert.ok(Buffer.from(s).equals(Buffer.from(mem)), `chunk ${size}`);
    }
  });
  test('unsupported layouts and truncation fail loudly', async () => {
    const abs = fmp4({ handler: 'vide', timescale: 15360, movieTimescale: 1000, frags: [[0, 100]], baseOffset: true });
    assert.equal(muxedLength(abs, AUDIO), null, 'absolute data offsets');
    assert.equal(muxedLength(VIDEO.subarray(0, 60), AUDIO), null, 'no moov in the head');
    await assert.rejects(readAll(muxCmafStream(chunked(VIDEO.subarray(0, VIDEO.length - 10), 512), AUDIO)), /truncated/);
    assert.throws(() => muxCmafBytes(VIDEO, new Uint8Array([0, 0, 0, 8, 102, 114, 101, 101])), /no moov/);
  });
  test('openMuxed: guarded fetches (Range head), exact length, same bytes', async () => {
    const safe = (href) => { try { const u = new URL(href); return u.protocol === 'https:' && u.hostname === 'v.redd.it' ? u : null; } catch { return null; } };
    const file = (bytes) => (u, init) => {
      const range = init.headers && init.headers.Range;
      const m = range && /bytes=0-(\d+)/.exec(range);
      const body = m ? bytes.subarray(0, Number(m[1]) + 1) : bytes;
      return new Response(body, { status: m ? 206 : 200, headers: { 'Content-Type': 'video/mp4', 'Content-Length': String(body.length) } });
    };
    const f = stubFetch([['https://v.redd.it/t/CMAF_720.mp4', file(VIDEO)], ['https://v.redd.it/t/CMAF_AUDIO_128.mp4', file(AUDIO)], ['https://v.redd.it/t/bad.mp4', redirect('http://10.0.0.1/a.mp4')]]);
    const r = await openMuxed('https://v.redd.it/t/CMAF_720.mp4', 'https://v.redd.it/t/CMAF_AUDIO_128.mp4', { safeURL: safe, maxBytes: 1e6, fetchImpl: f });
    assert.equal(r.ok, true); assert.equal(r.mime, 'video/mp4');
    const bytes = await readAll(r.body);
    assert.equal(bytes.length, r.length);
    assert.ok(Buffer.from(bytes).equals(Buffer.from(muxCmafBytes(VIDEO, AUDIO))));
    assert.ok(f.calls.some((c) => c.init.headers.Range === 'bytes=0-65535'));
    assert.ok(f.calls.every((c) => c.init.redirect === 'manual'));
    assert.equal((await openMuxed('https://v.redd.it/t/CMAF_720.mp4', 'https://v.redd.it/t/bad.mp4', { safeURL: safe, maxBytes: 1e6, fetchImpl: f })).error, 'audio_unsafe');
    assert.equal((await openMuxed('https://v.redd.it/t/CMAF_720.mp4', 'https://v.redd.it/t/CMAF_AUDIO_128.mp4', { safeURL: safe, maxBytes: 1000, fetchImpl: f })).error, 'too_large');
    assert.equal((await openMuxed('https://evil.example/a.mp4', 'https://v.redd.it/t/CMAF_AUDIO_128.mp4', { safeURL: safe, maxBytes: 1e6, fetchImpl: f })).error, 'fetch_error');
  });
});
