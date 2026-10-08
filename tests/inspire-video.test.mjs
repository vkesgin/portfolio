// Unit tests for worker/inspire-video.js (downloads + Instagram copies). No network: synthetic trimmed fixtures in
// tests/fixtures/video (see its README.md) and injected fetch stubs. Run from the repo root: node --test tests/
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  igRef, igPageUrl, igEmbedUrl, igShortcodeToPk, decodeOe, igCdnUrl, cleanCaption, igExtract, igPageProblem, igEmbedStatus,
  igNavHeaders, igEmbedHeaders, igResolve, igCheckEmbed, openMedia, cappedStream, asciiFilePart, unicodeFilePart, dlFilename,
  contentDisposition, titleSlug, dlHint, registerDlAdapter, DL_ADAPTERS, backoffS, vcItemFresh, vcBackingOff, itemToCache,
  cacheToItem, VIDEO_CACHE_DDL, vcGet, vcFail, vcDefer, vcExtra,
} from '../worker/inspire-video.js';
import { sanitizeMedia } from '../worker/inspire-media.js';
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
  test('an empty shell falls back to Browser Run once; without it the error is reported', async () => {
    const f = stubFetch({ 'https://www.instagram.com/reel/DTestReel01/': html200('<title>Instagram</title><div id="root"></div>') });
    let brCalls = 0;
    const r = await igResolve(ref, { fetchImpl: f, brContent: async (u) => { brCalls++; assert.equal(u, 'https://www.instagram.com/reel/DTestReel01/'); return FX('ig-reel.html'); } });
    assert.equal(r.ok, true); assert.equal(r.via, 'br'); assert.equal(brCalls, 1);
    const r2 = await igResolve(ref, { fetchImpl: f });
    assert.equal(r2.ok, false); assert.equal(r2.error, 'no_data'); assert.equal(r2.retry, 'soon');
    const r3 = await igResolve(ref, { fetchImpl: f, brContent: async () => { throw new Error('boom'); } });
    assert.equal(r3.ok, false);
    const r4 = await igResolve(ref, { fetchImpl: f, brContent: async () => '<title>Instagram</title>' });
    assert.equal(r4.error, 'br_no_data');
  });
  test('Browser Run refused (slot / budget) is "busy", not a failure of the post', async () => {
    const f = stubFetch({ 'https://www.instagram.com/reel/DTestReel01/': new Response(null, { status: 302, headers: { Location: 'https://www.instagram.com/accounts/login/' } }) });
    const r = await igResolve(ref, { fetchImpl: f, brContent: async () => ({ refused: true, retry_s: 7, site: true }) });
    assert.deepEqual({ ok: r.ok, error: r.error, busy: r.busy, retry_s: r.retry_s, site: r.site, retry: r.retry },
      { ok: false, error: 'busy', busy: true, retry_s: 7, site: true, retry: undefined });
    const p = await igResolve(ref, { fetchImpl: f, brContent: async () => ({ refused: true, retry_s: 5000, site: false }) });
    assert.equal(p.busy, true); assert.equal(p.site, false);
    const n = await igResolve(ref, { fetchImpl: f, brContent: async () => null });
    assert.equal(n.busy, undefined); assert.equal(n.error, 'redirect'); assert.equal(n.retry, 'soon');
  });
  test('login redirect is never followed; 404 is "gone" (no Browser Run)', async () => {
    const f = stubFetch({ 'https://www.instagram.com/reel/DTestReel01/': new Response(null, { status: 302, headers: { Location: 'https://www.instagram.com/accounts/login/' } }) });
    const r = await igResolve(ref, { fetchImpl: f });
    assert.equal(r.ok, false); assert.equal(r.error, 'redirect'); assert.equal(f.calls.length, 1);
    let br = 0;
    const g = stubFetch({});
    const r2 = await igResolve(ref, { fetchImpl: g, brContent: async () => { br++; return null; } });
    assert.equal(r2.error, 'gone'); assert.equal(r2.retry, 'gone'); assert.equal(br, 0);
    assert.equal((await igResolve({ code: 'x', kind: 'reel' }, { fetchImpl: g })).error, 'bad_ref');
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
  test('sanitizeMedia keeps credit/caption/audio for source instagram only', () => {
    const m = sanitizeMedia({ ...base, source: 'instagram', by: 'ornek.studio', caption: 'Merhaba‮ dünya', audio: true }, { allowFiles: true });
    assert.equal(m.source, 'instagram'); assert.equal(m.by, 'ornek.studio'); assert.equal(m.caption, 'Merhaba dünya'); assert.equal(m.audio, true);
    assert.equal(m.url, base.url); assert.equal(m.poster, base.poster);
    const bad = sanitizeMedia({ ...base, source: 'instagram', by: '<img onerror>', caption: 42 }, { allowFiles: true });
    assert.equal(bad.by, undefined); assert.equal(bad.caption, undefined);
    const up = sanitizeMedia({ ...base, source: 'upload', by: 'x', caption: 'y' }, { allowFiles: true });
    assert.equal(up.by, undefined); assert.equal(up.caption, undefined);
    assert.equal(sanitizeMedia({ ...base, source: 'instagram' }), null, '/files paths need allowFiles');
    const capped = sanitizeMedia({ ...base, source: 'instagram', caption: 'ş'.repeat(900) }, { allowFiles: true });
    assert.equal(Array.from(capped.caption).length, 500);
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
    const it = igExtract(FX('ig-reel.html'), 'DTestReel01');
    const c = itemToCache(it);
    const back = cacheToItem({ url: c.url, poster: c.poster, width: c.width, height: c.height, expires_at: c.expires_at, extra: JSON.stringify(c.extra), resolved_at: now }, 'DTestReel01');
    assert.equal(back.video.url, it.video.url); assert.equal(back.image.url, it.image.url);
    assert.equal(back.user, 'ornek.studio'); assert.equal(back.w, 720); assert.equal(back.has_audio, true);
    assert.equal(cacheToItem({ url: 'https://evil.example/a.mp4', poster: null, extra: '{}' }, 'x'), null, 'only CDN links come back out of the cache');
    assert.match(VIDEO_CACHE_DDL, /PRIMARY KEY \(post_id, kind\)/);
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
    assert.deepEqual(vcExtra(row), { removed: 1, deferred: 'busy' }, 'other extra fields stay');
    await vcDefer(db, 6, 'ig_copy', 86400, 'busy');
    assert.ok((await vcGet(db, 6, 'ig_copy')).retry_at > failed.retry_at, 'a later deferral extends it');
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
  });
});
