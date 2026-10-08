// Unit tests for worker/inspire-media.js (pure extraction module). No network: fixtures in tests/fixtures/media
// (sources and trimming in SOURCES.json). Run from the repo root: node --test tests/
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  parseHead, wantsBody, scanBody, mergeCollected, collectFromScrape, extractMedia, isBlocked, isExpiringUrl, adapterFor,
  variantsFor, stableVariantFor, sanitizeMedia, sniffMagic, oembedMedia, sameSite, siteOf, extractReddit, extractBehance, itemIdOf,
  MAX_HEAD_BYTES, MAX_PAGE_BYTES, AUTOPLAY_MAX_BYTES, FILES_PATH_RE,
} from '../worker/inspire-media.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FX = path.join(HERE, 'fixtures/media');
const read = (f) => fs.readFileSync(path.join(FX, f), 'utf8');
const SOURCES = JSON.parse(read('SOURCES.json'));
const src = (f) => SOURCES.find((s) => s.file === f);
const NOW = 1791300000;   // 2026-10-06

// What index.js does: head phase (up to </head>, <= 512 KB), then the body scan (<= 1 MB) only when wantsBody().
function pipeline(html, url, opts = {}) {
  const end = html.search(/<\/head\s*>/i);
  const headText = html.slice(0, end > 0 ? Math.min(end + 7, MAX_HEAD_BYTES) : MAX_HEAD_BYTES);
  const head = parseHead(headText, url);
  const body = opts.forceBody || wantsBody(head, url);
  const collected = body ? mergeCollected(head, scanBody(html.slice(0, MAX_PAGE_BYTES), url, head)) : head;
  return { head, body, ex: extractMedia(collected, url, { nowS: NOW, ...opts }) };
}

const MAG = 'https://www.magnific.com/premium-video/assembling-burger-beef-burger-ingredients-falling-landing-bun-one-by-one-slow-motion_4720543';
const MAG_MP4 = 'https://videocdn.cdnpk.net/videos/9d0664ea-fc7c-56ee-b566-eb13ffdc1812/horizontal/previews/magnific_watermarked/large.mp4';
const MAG_POSTER = 'https://videocdn.cdnpk.net/videos/9d0664ea-fc7c-56ee-b566-eb13ffdc1812/horizontal/thumbnails/large.jpg?w=740&q=80';
const MAG_SMALL = 'https://videocdn.cdnpk.net/videos/9d0664ea-fc7c-56ee-b566-eb13ffdc1812/horizontal/previews/magnific_watermarked/small.mp4';

describe('fixtures', () => {
  test('every fixture is listed in SOURCES.json, trimmed to <= 64 KB, ~600 KB in all', () => {
    let total = 0;
    for (const f of fs.readdirSync(FX)) {
      const st = fs.statSync(path.join(FX, f));
      if (st.isDirectory() || f === 'SOURCES.json' || f.endsWith('.mjs')) continue;
      assert.ok(src(f), `${f} in SOURCES.json`);
      assert.ok(st.size <= 64 * 1024, `${f} <= 64 KB`);
      total += st.size;
    }
    assert.ok(total < 700 * 1024, `total ${total}`);
    for (const s of SOURCES) for (const k of ['file', 'source_url', 'fetched', 'via', 'trim']) assert.ok(k in s, `${s.file}.${k}`);
  });
});

describe('Magnific (the owner\'s link)', () => {
  test('rendered page: the item\'s VideoObject, 4K size, rewritten poster, small variant', () => {
    const { head, body, ex } = pipeline(read('magnific-video.rendered.html'), MAG);
    assert.equal(head.title, 'Assembling a Burger - Beef Burger Ingredients Falling And Landing In The Bun One By One In Slow Motion | Premium Stock Video Footage');
    assert.equal(head.ogType, 'video');
    assert.equal(body, false, 'the head already has the video');
    assert.equal(ex.media.kind, 'video');
    assert.equal(ex.media.url, MAG_MP4);
    assert.equal(ex.media.source, 'ld');
    assert.equal(ex.media.w, 3840);
    assert.equal(ex.media.h, 2160);
    assert.equal(ex.media.poster, MAG_POSTER);
    assert.equal(ex.media.small, MAG_SMALL);
    assert.equal(ex.media.mime, 'video/mp4');
    assert.equal(ex.image, 'https://videocdn.cdnpk.net/videos/9d0664ea-fc7c-56ee-b566-eb13ffdc1812/horizontal/thumbnails/large.jpg');
  });
  test('with the body scanned too, related clips (af75c92b, fee65c49) never win and never pass the gate', () => {
    const { ex } = pipeline(read('magnific-video.rendered.html'), MAG, { forceBody: true });
    assert.equal(ex.media.url, MAG_MP4);
    const related = ex.candidates.filter((c) => /af75c92b|fee65c49/.test(c.url));
    assert.ok(related.length >= 2, 'related clip URLs are seen');
    assert.ok(related.every((c) => !c.pass), JSON.stringify(related));
    assert.ok(ex.candidates.filter((c) => c.pass).every((c) => c.url.includes('9d0664ea')));
  });
  test('security filter page is blocked (status and title)', () => {
    const html = read('magnific-security-filter.html');
    const head = parseHead(html, MAG);
    assert.equal(src('magnific-security-filter.html').status, 403);
    assert.equal(isBlocked({ status: 403, html }), true);
    assert.equal(isBlocked({ status: 200, html, title: head.docTitle }), true, 'title alone');
  });
  test('Browser Run scrape JSON -> the same video', () => {
    const col = collectFromScrape(JSON.parse(read('br-scrape-magnific.json')), MAG);
    assert.equal(col.blocked, false);
    assert.equal(col.status, 200);
    assert.equal(col.finalUrl, MAG);
    const ex = extractMedia(col, col.finalUrl, { nowS: NOW });
    assert.equal(ex.media.url, MAG_MP4);
    assert.equal(ex.media.poster, MAG_POSTER);
    assert.equal(ex.media.small, MAG_SMALL);
    assert.equal(ex.media.w, 3840);
    assert.ok(col.title.startsWith('Assembling a Burger'));
  });
  test('Browser Run scrape of a DataDome wall is blocked (403, title = bare host)', () => {
    const col = collectFromScrape(JSON.parse(read('br-scrape-datadome.json')), 'https://www.shutterstock.com/video/clip-28759981-slow-motion-finishing-fast-food-burger-top');
    assert.equal(col.blocked, true);
    assert.equal(col.status, 403);
    const fake = { success: true, result: [{ selector: 'title', results: [{ text: 'shutterstock.com', attributes: [] }] }, { selector: 'meta[property^="og:"]', results: [{ attributes: [{ name: 'property', value: 'og:title' }, { name: 'content', value: 'x' }] }] }], meta: { status: 200, finalUrl: 'https://www.shutterstock.com/x' } };
    assert.equal(collectFromScrape(fake, 'https://www.shutterstock.com/x').blocked, true, 'title equal to the bare host');
  });
  test('Browser Run scrape: only bot-wall signals count as blocked (a host strike); 404/410/500 and empty pages do not', () => {
    const scrape = (status, extra = {}) => collectFromScrape({ success: true, result: [{ selector: 'title', results: [{ text: extra.title || 'Some page', attributes: [] }] }],
      meta: { status, finalUrl: 'https://www.magnific.com/premium-video/x_999999999', ...(extra.headers ? { headers: extra.headers } : {}) } }, 'https://www.magnific.com/premium-video/x_999999999');
    for (const st of [401, 403, 429, 503]) assert.equal(scrape(st).blocked, true, String(st));
    assert.equal(scrape(200, { title: 'Security filter' }).blocked, true, 'challenge title');
    assert.equal(scrape(200, { headers: { 'cf-mitigated': 'challenge' } }).blocked, true, 'cf-mitigated');
    assert.equal(scrape(200, { headers: { 'X-DataDome': 'protected' } }).blocked, true, 'DataDome header');
    const gone = scrape(404);
    assert.equal(gone.blocked, false); assert.equal(gone.gone, true); assert.equal(gone.status, 404);
    assert.equal(scrape(410).gone, true);
    for (const st of [400, 451, 500, 502]) { const c = scrape(st); assert.equal(c.blocked, false, String(st)); assert.equal(c.gone, false, String(st)); }
    const empty = collectFromScrape({ success: true, result: [], meta: { status: 200 } }, 'https://a.example/x');
    assert.equal(empty.blocked, false, 'nothing found is not a bot wall');
    assert.equal(empty.empty, true);
    assert.equal(collectFromScrape(JSON.parse(read('br-scrape-magnific.json')), MAG).empty, false);
  });
});

describe('stock sites and media pages', () => {
  test('Vecteezy: VideoObject at ~672 KB after a ~410 KB head is found by the body scan', () => {
    const parts = read('vecteezy-video.parts.html').split(/<!--PART:(?:HEAD|VIDEO|LD)-->\n?/).filter((x) => x.trim());
    assert.equal(parts.length, 3);
    const pad = (s, to, fill) => s + fill.repeat(Math.max(0, Math.ceil((to - s.length) / fill.length))).slice(0, Math.max(0, to - s.length));
    let html = pad(parts[0] + '<style>', 410 * 1024, '.x{color:red}\n') + '</style></head><body>';
    html = pad(html, 565 * 1024, '<div class="filler">lorem ipsum</div>\n') + parts[1];
    html = pad(html, 672 * 1024, '<p>filler text 12345</p>\n') + parts[2] + '</body></html>';
    assert.ok(html.indexOf('<video') > 560 * 1024 && html.indexOf('VideoObject') > 670 * 1024);
    const url = 'https://www.vecteezy.com/video/66110223-incredible-chicago-skyline-at-chicago-illinois-in-united-states-awesome-background';
    const { head, body, ex } = pipeline(html, url);
    assert.equal(head.ld.length, 0, 'no VideoObject in the head');
    assert.equal(body, true, 'wantsBody via /video/');
    assert.equal(ex.media.url, 'https://static.vecteezy.com/system/resources/previews/066/110/223/watermarked/incredible-chicago-skyline-at-chicago-illinois-in-united-states-awesome-background-video.mp4');
    assert.equal(ex.media.source, 'ld');
  });
  test('Envato: the VideoObject contentUrl, not the related <video>s', () => {
    const { ex } = pipeline(read('envato-video.html'), 'https://elements.envato.com/spaceship-flies-over-the-planet-earth-YFQBF4B', { forceBody: true });
    assert.equal(ex.media.url, 'https://video-previews.elements.envatousercontent.com/files/3850d377-a1d0-4637-b096-941ac4b47179/video_preview_h264.mp4');
    assert.equal(ex.media.source, 'ld');
    for (const id of ['9e84e3fe', '4c86b6d1', 'b3155046']) assert.ok(ex.candidates.filter((c) => c.url.includes(id)).every((c) => !c.pass), id);
  });
  test('Mixkit: the -360 embedUrl is preferred over the -720 contentUrl', () => {
    const { ex } = pipeline(read('mixkit-video.html'), 'https://mixkit.co/free-stock-video/going-down-a-curved-highway-through-a-mountain-range-41576/');
    assert.equal(ex.media.url, 'https://assets.mixkit.co/videos/41576/41576-360.mp4');
  });
  test('Coverr: og:video 1080p with the 360p small variant', () => {
    const { ex } = pipeline(read('coverr-video.html'), 'https://coverr.co/videos/a-guy-attaches-his-smartphone-to-an-e-scooter-9wpldqh5k0');
    assert.equal(ex.media.url, 'https://cdn.coverr.co/videos/coverr-a-guy-attaches-his-smartphone-to-an-e-scooter-9169/1080p.mp4');
    assert.equal(ex.media.source, 'og');
    assert.equal(ex.media.small, 'https://cdn.coverr.co/videos/coverr-a-guy-attaches-his-smartphone-to-an-e-scooter-9169/360p.mp4');
  });
  test('Depositphotos: og:video mp4 accepted although og:video:type is "video.other"', () => {
    const { ex } = pipeline(read('depositphotos-video.html'), 'https://depositphotos.com/video/harbor-scene-mykonos-greece-shot-8mm-film-white-structures-lining-844514178.html');
    assert.equal(ex.media.url, 'https://st2.depositphotos.com/12746326/84451/v/600/depositphotos_844514178-stock-video-harbor-scene-mykonos-greece-shot.mp4');
    assert.equal(ex.media.w, 600);
    assert.equal(ex.media.h, 337);
  });
  test('Giphy / Tenor: og:video mp4; their HTML twitter:player (iframe / "undefined?…") is ignored', () => {
    let { ex } = pipeline(read('giphy.html'), 'https://giphy.com/gifs/cat-cute-roll-around-3ohhwijdF7bBRguliw');
    assert.equal(ex.media.kind, 'video');
    assert.match(ex.media.url, /\/3ohhwijdF7bBRguliw\/giphy\.mp4$/);
    ({ ex } = pipeline(read('tenor.html'), 'https://tenor.com/view/imgur-funny-moments-gif-25163619'));
    assert.equal(ex.media.kind, 'video');
    assert.equal(ex.media.url, 'https://media.tenor.com/eX4ypNLcuI0AAAPo/imgur-funny.mp4');
    assert.equal(ex.media.w, 640);
  });
  test('Imgur gallery: og:video', () => {
    const { ex } = pipeline(read('imgur-gallery.html'), 'https://imgur.com/gallery/W2oXv0u');
    assert.equal(ex.media.url, 'https://i.imgur.com/zxWlkmo.mp4');
    assert.equal(ex.media.w, 480);
    assert.equal(ex.media.h, 854);
  });
  test('Flickr photo and Tumblr (www) post: image media', () => {
    let { ex } = pipeline(read('flickr-photo.html'), 'https://www.flickr.com/photos/183785896@N02/53155964113');
    assert.equal(ex.media, null);
    assert.equal(ex.imageMedia.kind, 'image');
    assert.equal(ex.imageMedia.url, 'https://live.staticflickr.com/65535/53155964113_1d00584cd5_b.jpg');
    const turl = 'https://www.tumblr.com/dogpuppy/829462614184706048';
    const ad = adapterFor(turl);
    assert.equal(ad.name, 'tumblr');
    ({ ex } = pipeline(read('tumblr-www.html'), turl, { imageMedia: ad.imageMedia }));
    assert.equal(ex.imageMedia.kind, 'image');
    assert.match(ex.imageMedia.url, /^https:\/\/64\.media\.tumblr\.com\/.+\.jpg$/);
    assert.equal(ex.imageMedia.w, 640);
  });
  test('CNN: the VideoObject (source ld); autoplay is decided later by the probe', () => {
    const { ex } = pipeline(read('cnn-video.html'), 'https://www.cnn.com/2026/09/28/science/video/spacex-starship-unprecedented-test-digvid');
    assert.equal(ex.media.source, 'ld');
    assert.match(ex.media.url, /spacex-starship-unprecedented-test-digvid-2381983-1920x1080_8000k\.mp4$/);
    assert.equal(sanitizeMedia({ ...ex.media, bytes: 197 * 1048576 }).autoplay, false, '> 30 MB never autoplays');
  });
  test('Apple (regression guard): no media, og:image kept, no image media', () => {
    const { ex } = pipeline(read('apple-article.html'), 'https://www.apple.com/iphone/');
    assert.equal(ex.media, null);
    assert.equal(ex.imageMedia, null);
    assert.match(ex.image, /^https:\/\/www\.apple\.com\/v\/iphone\/.+og\.png/);
  });
  test('synthetic Pexels: \\u002F-escaped JSON, the sd_960 rendition beats the UHD contentUrl', () => {
    const { body, ex } = pipeline(read('synthetic-pexels.html'), 'https://www.pexels.com/video/making-a-cheese-burger-sandwich-4139325/');
    assert.equal(body, true);
    assert.equal(ex.media.url, 'https://videos.pexels.com/video-files/4139325/4139325-sd_960_540_25fps.mp4');
    assert.ok(ex.candidates.some((c) => /uhd_3840/.test(c.url) && c.pass), 'UHD seen and related');
  });
  test('synthetic: of 3 VideoObjects the mainEntity wins, related ones fail the gate', () => {
    const { ex } = pipeline(read('synthetic-related-vos.html'), 'https://www.example-stock.com/clips/ocean-waves-at-sunset');
    assert.equal(ex.media.url, 'https://cdn.example-stock.com/v/aaa111/preview.mp4');
    assert.equal(ex.media.poster, 'https://cdn.example-stock.com/v/aaa111/thumb.jpg');
    assert.equal(ex.media.w, 1920);
    assert.equal(ex.media.h, 1080);
    assert.ok(ex.candidates.filter((c) => /bbb222|ccc333/.test(c.url)).every((c) => !c.pass));
  });
  test('synthetic listing (Videvo item -> listing): 20 unrelated <video>s give no media', () => {
    for (const url of ['https://www.videvo.net/video/spider-web-closeup/4568/', 'https://www.videvo.net/stock-video-footage/']) {
      const { ex } = pipeline(read('synthetic-listing.html'), url, { forceBody: true });
      assert.equal(ex.media, null, url);
      assert.ok(ex.candidates.length >= 20);
    }
  });
  test('a signed, expiring item video is never used: play_at_source image preview instead', () => {
    const exp = NOW + 1200;
    const html = `<head><meta property="og:type" content="video"><meta property="og:image" content="https://cdn.example.com/v/abcd1234-ef56/thumb.jpg">
      <script type="application/ld+json">{"@type":"VideoObject","contentUrl":"https://cdn.example.com/v/abcd1234-ef56/clear/large.mp4?token=exp=${exp}~hmac=abc","thumbnailUrl":"https://cdn.example.com/v/abcd1234-ef56/thumb.jpg","width":1280,"height":720}</script></head>`;
    const ex = extractMedia(parseHead(html, 'https://www.magnific.com/free-video/three-friends-eating-home_1712412'), 'https://www.magnific.com/free-video/three-friends-eating-home_1712412', { nowS: NOW });
    assert.equal(ex.media, null);
    assert.equal(ex.playAtSource, true);
    assert.equal(ex.imageMedia.kind, 'image');
    assert.equal(ex.imageMedia.play_at_source, true);
    assert.equal(ex.imageMedia.url, 'https://cdn.example.com/v/abcd1234-ef56/thumb.jpg');
  });
  test('Magnific free video: the expiring clear preview is replaced by its public watermarked twin (+ play-at-source fallback)', () => {
    const exp = NOW + 1200, uuid = '7b1ea3bb-a57d-4717-afee-76db9034e3d0', base = `https://videocdn.cdnpk.net/videos/${uuid}/horizontal`;
    const html = `<head><meta property="og:type" content="video"><meta property="og:image" content="${base}/thumbnails/large.jpg">
      <script type="application/ld+json">{"@type":"VideoObject","contentUrl":"${base}/previews/clear/large.mp4?token=exp=${exp}~hmac=abc","thumbnailUrl":"${base}/thumbnails/large.jpg","width":1920,"height":1080}</script></head>`;
    const page = 'https://www.magnific.com/free-video/three-friends-eating-home_1712412';
    const ex = extractMedia(parseHead(html, page), page, { nowS: NOW });
    assert.equal(ex.media.kind, 'video');
    assert.equal(ex.media.url, `${base}/previews/magnific_watermarked/large.mp4`);
    assert.equal(ex.media.small, `${base}/previews/magnific_watermarked/small.mp4`);
    assert.equal(ex.media.verified, false, 'probed before use');
    assert.equal(ex.playAtSource, false);
    assert.equal(ex.imageMedia.play_at_source, true, 'fallback when the twin fails its probe');
    assert.equal(stableVariantFor(`${base}/previews/clear/small.mp4?token=exp=${exp}~hmac=1`), `${base}/previews/magnific_watermarked/large.mp4`);
    assert.equal(stableVariantFor(`https://videocdn.cdnpk.net/videos/${uuid}/vertical/previews/clear/large.mp4?token=exp=1~hmac=1`),
      `https://videocdn.cdnpk.net/videos/${uuid}/vertical/previews/magnific_watermarked/large.mp4`);
    assert.equal(stableVariantFor(`https://cdn.example.com/videos/${uuid}/horizontal/previews/clear/large.mp4?token=exp=1`), null);
    assert.equal(stableVariantFor(`${base}/thumbnails/large.jpg`), null);
  });
  test('player media only from a recognised embed (og:video text/html)', () => {
    const html = '<head><meta property="og:video" content="https://www.youtube.com/embed/dQw4w9WgXcQ"><meta property="og:video:type" content="text/html"></head>';
    const ex = extractMedia(parseHead(html, 'https://blog.example.com/post/1'), 'https://blog.example.com/post/1');
    assert.equal(ex.media.kind, 'player');
    assert.match(ex.media.url, /youtube\.com/);
    const html2 = '<head><meta property="og:video" content="https://player.example.com/x?id=1"><meta property="og:video:type" content="text/html"></head>';
    assert.equal(extractMedia(parseHead(html2, 'https://blog.example.com/post/1'), 'https://blog.example.com/post/1').media, null);
  });
  test('item id = the last >= 5 digit run of the path', () => {
    assert.equal(itemIdOf(MAG), '4720543');
    assert.equal(itemIdOf('https://www.vecteezy.com/video/66110223-incredible-chicago'), '66110223');
    assert.equal(itemIdOf('https://www.videvo.net/video/spider-web-closeup/4568/'), null);
  });
});

describe('isBlocked', () => {
  for (const f of ['blocked-pexels-just-a-moment.html', 'blocked-storyblocks-awswaf.html', 'blocked-shutterstock-datadome.html', 'blocked-trendyol-empty.html']) {
    test(f, () => {
      const s = src(f);
      const html = read(f);
      const head = parseHead(html, s.source_url);
      assert.equal(isBlocked({ status: s.status, headers: s.headers, html, title: head.docTitle }), true);
    });
  }
  test('markers without a blocking status', () => {
    assert.equal(isBlocked({ status: 202, headers: { 'x-amzn-waf-action': 'challenge' } }), true);
    assert.equal(isBlocked({ status: 200, html: '<html><script src="https://geo.captcha-delivery.com/c.js"></script></html>' }), true);
    assert.equal(isBlocked({ status: 200, html: '<html>…/cdn-cgi/challenge-platform/…</html>' }), true);
    assert.equal(isBlocked({ status: 200, title: 'Pardon Our Interruption' }), true);
    assert.equal(isBlocked({ status: 200, headers: { 'cf-mitigated': 'challenge' } }), true);
    assert.equal(isBlocked({ status: 404 }), false);
    assert.equal(isBlocked({ status: 200, html: '<html><head><title>Normal page</title></head></html>', title: 'Normal page' }), false);
    assert.equal(isBlocked({ status: 200, html: 'x'.repeat(5000) + 'challenges.cloudflare.com' }), false, 'only small bodies');
  });
});

describe('isExpiringUrl', () => {
  test('expiring', () => {
    assert.equal(isExpiringUrl(`https://videocdn.cdnpk.net/videos/x/horizontal/previews/clear/large.mp4?token=exp=${NOW + 1200}~hmac=abc`, NOW), true);
    assert.equal(isExpiringUrl('https://media.canva.com/v2/image/x.png?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Date=20261006T000000Z&X-Amz-Expires=49622&X-Amz-Signature=ab', NOW), true);
    assert.equal(isExpiringUrl('https://packaged-media.redd.it/74zvtk9qolsh1/pb/m2-res_392p.mp4?m=DASHPlaylist.mpd', NOW), true);
    assert.equal(isExpiringUrl(`https://d1.cloudfront.net/a.mp4?Expires=${NOW + 3600}&Signature=x&Key-Pair-Id=K`, NOW), true);
    assert.equal(isExpiringUrl(`https://scontent.cdninstagram.com/v/x.mp4?oe=${(NOW + 3600).toString(16).toUpperCase()}&oh=1`, NOW), true);
    assert.equal(isExpiringUrl('https://d1.cloudfront.net/a.mp4?Policy=eyJ&Signature=x', NOW), true);
  });
  test('not expiring', () => {
    assert.equal(isExpiringUrl('https://media.istockphoto.com/id/1425558874/video/x.mp4?s=mp4-640x640-is&k=20&c=abcdef', NOW), false);
    assert.equal(isExpiringUrl(MAG_MP4, NOW), false);
    assert.equal(isExpiringUrl(`https://cdn.example.com/a.mp4?exp=${NOW + 30 * 86400}`, NOW), false, 'more than 7 days left');
    assert.equal(isExpiringUrl('not a url', NOW), false);
  });
});

describe('adapters', () => {
  const A = (u) => adapterFor(u);
  test('Shutterstock video / image (no page fetch)', () => {
    let a = A('https://www.shutterstock.com/video/clip-28759981-slow-motion-finishing-fast-food-burger-top');
    assert.equal(a.name, 'shutterstock_video');
    assert.equal(a.skipPage, true);
    assert.deepEqual(a.pre.video, ['https://www.shutterstock.com/shutterstock/videos/28759981/preview/stock-footage-x.mp4']);
    assert.equal(a.pre.poster, 'https://www.shutterstock.com/shutterstock/videos/28759981/thumb/1.jpg');
    assert.equal(A('https://www.shutterstock.com/tr/video/clip-1104381001-raindrops').pre.video[0], 'https://www.shutterstock.com/shutterstock/videos/1104381001/preview/stock-footage-x.mp4');
    a = A('https://www.shutterstock.com/image-photo/mountain-lake-reflex-mirror-beautiful-background-1164242995');
    assert.equal(a.name, 'shutterstock_image');
    assert.equal(a.pre.image, 'https://www.shutterstock.com/image-photo/x-600nw-1164242995.jpg');
    assert.equal(A('https://www.shutterstock.com/search/burger'), null);
  });
  test('Dreamstime video', () => {
    const a = A('https://www.dreamstime.com/waves-crashing-against-seashore-high-quality-k-footage-video365138464');
    assert.equal(a.name, 'dreamstime_video');
    assert.equal(a.skipPage, true);
    assert.deepEqual(a.pre.video, ['https://thumbs.dreamstime.com/videothumb_large36513/365138464.mp4']);
    assert.equal(a.pre.poster, 'https://thumbs.dreamstime.com/b/x-365138464.jpg');
    assert.equal(A('https://www.dreamstime.com/photos-images/burger.html'), null);
  });
  test('Pexels photo, Mixkit, Giphy, Imgur .gifv', () => {
    let a = A('https://www.pexels.com/photo/lake-and-mountain-under-white-sky-443446/');
    assert.equal(a.name, 'pexels_photo');
    assert.ok(!a.skipPage, 'the page is still tried for the title');
    assert.equal(a.pre.image, 'https://images.pexels.com/photos/443446/pexels-photo-443446.jpeg?auto=compress&cs=tinysrgb&w=1200');
    assert.equal(A('https://www.pexels.com/video/making-a-cheese-burger-sandwich-4139325/'), null, 'no /download adapter');
    a = A('https://mixkit.co/free-stock-video/going-down-a-curved-highway-through-a-mountain-range-41576/');
    assert.deepEqual(a.pre.video, ['https://assets.mixkit.co/videos/41576/41576-360.mp4']);
    assert.equal(a.pre.poster, 'https://assets.mixkit.co/videos/41576/41576-thumb-720-0.jpg');
    a = A('https://giphy.com/gifs/cat-cute-roll-around-3ohhwijdF7bBRguliw');
    assert.deepEqual(a.pre.video, ['https://media.giphy.com/media/3ohhwijdF7bBRguliw/giphy.mp4']);
    assert.equal(a.pre.poster, 'https://i.giphy.com/3ohhwijdF7bBRguliw.webp');
    assert.equal(A('https://media3.giphy.com/media/v1.Y2lkPTc5MGI3NjEx/3ohhwijdF7bBRguliw/giphy.gif').pre.video[0], 'https://media.giphy.com/media/3ohhwijdF7bBRguliw/giphy.mp4');
    a = A('https://i.imgur.com/zxWlkmo.gifv');
    assert.equal(a.name, 'imgur_gifv');
    assert.deepEqual(a.pre.video, ['https://i.imgur.com/zxWlkmo.mp4']);
    assert.equal(A('https://i.imgur.com/zxWlkmo.jpg'), null);
  });
  test('Reddit (official embed page)', () => {
    const a = A('https://www.reddit.com/r/oddlysatisfying/comments/1wtxix8/the_way_he_spreads_the_spaghetti_for_boiling/');
    assert.equal(a.name, 'reddit');
    assert.equal(a.pageUrl, 'https://embed.reddit.com/r/oddlysatisfying/comments/1wtxix8/?embed=true');
    const r = extractReddit(read('reddit-embed.html'));
    assert.deepEqual(r.video, ['https://v.redd.it/74zvtk9qolsh1/CMAF_480.mp4', 'https://v.redd.it/74zvtk9qolsh1/CMAF_360.mp4', 'https://v.redd.it/74zvtk9qolsh1/CMAF_720.mp4']);
    assert.match(r.poster, /^https:\/\/external-preview\.redd\.it\/.+\?width=640&crop=smart&format=pjpg&auto=webp&s=/);
    assert.ok(!r.poster.includes('&amp;'));
    assert.equal(r.title, undefined, '"Reddit - The heart of the internet" is not a title');
    const img = extractReddit(read('reddit-embed-img.html'));
    assert.equal(img.video, undefined);
    assert.equal(img.image, 'https://i.redd.it/s46jxaxsv5th1.jpeg');
    assert.equal(A('https://old.reddit.com/r/EarthPorn/comments/1wwbnul/x/').name, 'reddit');
    assert.equal(A('https://www.reddit.com/r/EarthPorn/'), null);
  });
  test('Behance (official embed page), Getty/iStock (official oEmbed), Tumblr', () => {
    let a = A('https://www.behance.net/gallery/118046015/Digital-markets-Motion-design-video');
    assert.equal(a.name, 'behance');
    assert.equal(a.post.url, 'https://www.behance.net/embed/project/118046015?ilo0=1');
    const b = extractBehance(read('behance-embed.html'));
    assert.match(b.image, /^https:\/\/mir-s3-cdn-cf\.behance\.net\/projects\/max_808(_webp)?\//);
    assert.equal(b.title, 'Digital markets | Motion design video');
    a = A('https://www.gettyimages.com/detail/photo/matterhorn-peak-at-sunset-reflected-in-stellisee-royalty-free-image/1203119783');
    assert.equal(a.name, 'getty_photo');
    assert.equal(a.post.url, 'https://embed.gettyimages.com/oembed?url=https%3A%2F%2Fwww.gettyimages.com%2Fdetail%2F1203119783');
    assert.deepEqual(a.post.parse({ title: 'Matterhorn &amp; lake', thumbnail_url: 'https://media.gettyimages.com/id/1203119783/photo/x.jpg?s=170x170' }),
      { title: 'Matterhorn & lake', thumb: 'https://media.gettyimages.com/id/1203119783/photo/x.jpg?s=170x170' });
    a = A('https://www.istockphoto.com/video/super-slow-motion-of-stacking-hamburger-pieces-gm1425558874-469992644');
    assert.equal(a.post.url, 'https://embed.gettyimages.com/oembed?url=https%3A%2F%2Fwww.gettyimages.com%2Fdetail%2F1425558874');
    a = A('https://nature-travel-photography.tumblr.com/post/816066130794921984');
    assert.equal(a.name, 'tumblr');
    assert.equal(a.pageUrl, 'https://www.tumblr.com/nature-travel-photography/816066130794921984');
    assert.equal(a.imageMedia, true);
  });
  test('dropped adapters stay dropped (Unsplash, Artgrid, Amazon, Pexels video)', () => {
    for (const u of ['https://unsplash.com/photos/landscape-photography-of-mountain-hit-by-sun-rays-78A265wPiO4',
      'https://artgrid.io/clip/17712/chef-flipping-burger', 'https://www.amazon.com/dp/B00ABC1234',
      'https://www.magnific.com/premium-video/x_4720543', 'https://stock.adobe.com/video/x/449047278']) assert.equal(A(u), null, u);
  });
});

describe('variantsFor', () => {
  test('CDN rewrites', () => {
    assert.deepEqual(variantsFor(MAG_MP4), { small: MAG_SMALL });
    assert.deepEqual(variantsFor('https://videocdn.cdnpk.net/videos/9d0664ea-fc7c-56ee-b566-eb13ffdc1812/horizontal/thumbnails/large.jpg'), { poster: MAG_POSTER });
    assert.deepEqual(variantsFor(MAG_POSTER), {}, 'already has a query');
    assert.deepEqual(variantsFor('https://cdn.coverr.co/videos/x-9169/1080p.mp4'), { small: 'https://cdn.coverr.co/videos/x-9169/360p.mp4' });
    assert.deepEqual(variantsFor('https://cdn.pixabay.com/video/2024/01/01/12345-123_large.mp4'), { url: 'https://cdn.pixabay.com/video/2024/01/01/12345-123_tiny.mp4' });
    assert.deepEqual(variantsFor('https://example.com/a.mp4'), {});
  });
});

describe('oEmbed', () => {
  test('photo -> image media; video iframe -> player; thumbnail -> card image', () => {
    const p = oembedMedia({ type: 'photo', url: 'https://live.staticflickr.com/65535/1_b.jpg', width: 1024, height: 931, title: 'Peyzaj' });
    assert.equal(p.imageMedia.kind, 'image');
    assert.equal(p.imageMedia.w, 1024);
    assert.equal(p.title, 'Peyzaj');
    const v = oembedMedia({ type: 'video', html: '<iframe width="480" src="https://www.youtube.com/embed/dQw4w9WgXcQ?feature=oembed"></iframe>', thumbnail_url: 'https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg' });
    assert.match(v.playerUrl, /youtube\.com\/watch\?v=dQw4w9WgXcQ|youtu/);
    assert.equal(v.thumb, 'https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg');
    assert.equal(oembedMedia({ type: 'video', html: '<iframe src="https://evil.example/x"></iframe>' }).playerUrl, undefined);
    assert.equal(oembedMedia({ type: 'photo', url: 'javascript:alert(1)' }).imageMedia, undefined);
    assert.equal(oembedMedia({ type: 'photo', url: 'https://a.example/x.svg' }).imageMedia, undefined);
    assert.deepEqual(oembedMedia(null), {});
  });
  test('same registrable domain', () => {
    assert.equal(siteOf('api.imgur.com'), 'imgur.com');
    assert.equal(siteOf('www.hepsiburada.com.tr'), 'hepsiburada.com.tr');
    assert.equal(siteOf('news.bbc.co.uk'), 'bbc.co.uk');
    assert.equal(sameSite('https://api.imgur.com/oembed.json?url=x', 'https://imgur.com/gallery/W2oXv0u'), true);
    assert.equal(sameSite('https://www.tumblr.com/oembed/1.0?url=x', 'https://www.tumblr.com/dogpuppy/1'), true);
    assert.equal(sameSite('https://evil.example/oembed', 'https://imgur.com/gallery/x'), false);
    assert.equal(sameSite('https://a.com.tr/x', 'https://b.com.tr/y'), false);
  });
});

describe('sanitizeMedia', () => {
  const ok = { kind: 'video', url: 'https://cdn.example.com/a.mp4', poster: 'https://cdn.example.com/a.jpg', w: 1280, h: 720, mime: 'video/mp4', bytes: 1000, autoplay: true, verified: true, source: 'og' };
  test('keeps a valid object and drops unknown keys', () => {
    const m = sanitizeMedia({ ...ok, evil: '<script>', _posterFallback: 'x' });
    assert.deepEqual(Object.keys(m).sort(), ['autoplay', 'bytes', 'h', 'kind', 'mime', 'mv', 'poster', 'source', 'url', 'verified', 'w']);
    assert.equal(m.mv, 1);
  });
  test('rejects bad URLs and kinds', () => {
    for (const url of ['javascript:alert(1)', 'data:video/mp4;base64,AAAA', 'blob:https://x/1', 'ftp://x.example/a.mp4', 'https://user:pw@x.example/a.mp4',
      'https://x.example/' + 'a'.repeat(2100) + '.mp4', '/files/sb/x.jpg', '/files/fikir/1/v-abc.mp4', '/files/fikir/1/x-0123456789abcdef0123456789abcdef.mp4',
      'https://x.example/a.svg', `https://x.example/a.mp4?token=exp=${Math.floor(Date.now() / 1000) + 60}~hmac=1`, 'https://x"y.example/a.mp4', '//x.example/a.mp4']) {
      assert.equal(sanitizeMedia({ ...ok, url }, { allowFiles: true }), null, url);
    }
    assert.equal(sanitizeMedia({ ...ok, kind: 'audio' }), null);
    assert.equal(sanitizeMedia({ ...ok, mime: 'image/svg+xml' }), null);
    assert.equal(sanitizeMedia([ok]), null);
    assert.equal(sanitizeMedia({ ...ok, kind: 'player', url: 'https://example.com/page' }), null, 'player needs a recognised embed');
  });
  test('/files/ paths only with allowFiles and only the server key pattern', () => {
    const f = '/files/fikir/42/v-0123456789abcdef0123456789abcdef.mp4';
    assert.ok(FILES_PATH_RE.test(f));
    assert.equal(sanitizeMedia({ ...ok, url: f }), null);
    assert.equal(sanitizeMedia({ ...ok, url: f }, { allowFiles: true }).url, f);
  });
  test('clamps w/h, autoplay rules, bad optional fields dropped, 6 KB cap', () => {
    const m = sanitizeMedia({ ...ok, w: 99999, h: 0.2, bytes: AUTOPLAY_MAX_BYTES + 1, source: 'evil source', mime: 'text/html', poster: 'javascript:x' });
    assert.equal(m.w, 10000);
    assert.equal(m.h, 1);
    assert.equal(m.autoplay, false);
    assert.equal(m.source, undefined);
    assert.equal(m.mime, undefined);
    assert.equal(m.poster, null);
    assert.equal(sanitizeMedia({ kind: 'hls', url: 'https://x.example/a.m3u8', autoplay: true }).autoplay, false);
    assert.equal(sanitizeMedia({ kind: 'image', url: 'https://x.example/a.jpg', poster: 'https://x.example/p.jpg' }).poster, undefined);
    assert.equal(sanitizeMedia({ kind: 'image', url: 'https://x.example/a.jpg', play_at_source: true }).play_at_source, true);
    const big = sanitizeMedia({ ...ok, url: 'https://x.example/' + 'a'.repeat(2000) + '.mp4', poster: 'https://x.example/' + 'b'.repeat(2000) + '.jpg', small: 'https://x.example/' + 'c'.repeat(2000) + '.mp4' });
    assert.equal(big, null, '> 6 KB');
  });
});

describe('sniffMagic', () => {
  const S = (f) => new Uint8Array(fs.readFileSync(path.join(FX, 'sniff', f)));
  test('accepted types', () => {
    const exp = { 'ok.jpg': 'image/jpeg', 'ok.png': 'image/png', 'ok.gif': 'image/gif', 'ok.webp': 'image/webp', 'ok-isom.mp4': 'video/mp4', 'ok-qt.mov': 'video/quicktime', 'ok.webm': 'video/webm' };
    for (const [f, mime] of Object.entries(exp)) assert.equal((sniffMagic(S(f)) || {}).mime, mime, f);
    assert.equal(sniffMagic(S('ok-isom.mp4')).ext, 'mp4');
    assert.equal(sniffMagic(S('ok.webm')).kind, 'video');
    assert.equal(sniffMagic(S('ok.jpg')).ext, 'jpg');
    assert.equal(sniffMagic(new Uint8Array(fs.readFileSync(path.join(FX, 'clip.webm')).subarray(0, 64))).mime, 'video/webm');
  });
  test('rejected types', () => {
    for (const f of fs.readdirSync(path.join(FX, 'sniff')).filter((x) => x.startsWith('bad'))) assert.equal(sniffMagic(S(f)), null, f);
    assert.equal(sniffMagic(null), null);
  });
});

describe('performance (proxy for the Free plan 10 ms CPU limit)', () => {
  test('parseHead + wantsBody + scanBody + extractMedia on a 1 MB page: median < 5 ms', { skip: process.env.SLOW_CI === '1' }, () => {
    const url = 'https://www.example-stock.com/video/12345678-ocean-waves-at-sunset';
    let head = '<!doctype html><html><head><title>Ocean waves</title><meta property="og:type" content="video.other"><meta property="og:image" content="https://cdn.example-stock.com/thumbs/12345678/ocean-waves-at-sunset.jpg">';
    for (let i = 0; i < 300; i++) head += `<meta name="x-${i}" content="value ${i}"><link rel="preload" href="/a/${i}.js">`;
    head += '<style>' + '.c{color:#123456;margin:0 auto}\n'.repeat(500) + '</style></head><body>';
    let body = '';
    let i = 0;
    while (head.length + body.length < MAX_PAGE_BYTES - 4000) {
      body += `<div class="card" data-id="${i}"><a href="/video/${1000 + i}-clip-${i}">Clip ${i}</a><img src="https://cdn.example-stock.com/t/${i}.jpg" alt="clip"></div>\n`;
      if (i % 40 === 0) body += `<video src="https://cdn.example-stock.com/previews/${9000 + i}/preview.mp4" poster="https://cdn.example-stock.com/t/${i}.jpg"></video>`;
      if (i % 25 === 0) body += `<script>window.__d${i}={"u":"https:\\u002F\\u002Fcdn.example-stock.com\\u002Fp\\u002F${8000 + i}\\u002Fclip.mp4","n":${i}}</script>`;
      i++;
    }
    body += '<script type="application/ld+json">{"@type":"VideoObject","contentUrl":"https://cdn.example-stock.com/previews/12345678/ocean-waves-at-sunset.mp4","thumbnailUrl":"https://cdn.example-stock.com/thumbs/12345678/ocean-waves-at-sunset.jpg"}</script></body></html>';
    const html = head + body;
    assert.ok(html.length > 1000 * 1000);
    const runs = [];
    let ex;
    for (let r = 0; r < 20; r++) {
      const t0 = performance.now();
      const h = parseHead(html.slice(0, html.indexOf('</head>') + 7), url);
      const col = wantsBody(h, url) ? mergeCollected(h, scanBody(html, url, h)) : h;
      ex = extractMedia(col, url);
      runs.push(performance.now() - t0);
    }
    runs.sort((a, b) => a - b);
    const median = runs[10];
    assert.equal(ex.media.url, 'https://cdn.example-stock.com/previews/12345678/ocean-waves-at-sunset.mp4');
    assert.ok(median < 5, `median ${median.toFixed(2)} ms`);
  });
});

describe('config guard', () => {
  test('worker/wrangler.toml never sets the local test hooks', () => {
    const toml = fs.readFileSync(path.join(HERE, '../worker/wrangler.toml'), 'utf8');
    const live = toml.split('\n').map((l) => l.replace(/#.*$/, '')).join('\n');
    for (const k of ['INSPIRE_TEST_FETCH_ALLOW', 'INSPIRE_FAKE_BR', 'SB_FAKE_']) assert.ok(!live.includes(k), `${k} set in wrangler.toml`);
    assert.match(live, /^\s*FIKIR_BR\s*=\s*"[01]"/m, 'FIKIR_BR is "0" or "1"');
    assert.match(live, /^\[browser\]\s*\n\s*binding\s*=\s*"BROWSER"/m);
    assert.match(live, /^compatibility_date\s*=\s*"2024-09-23"/m, 'compatibility_date unchanged');
  });
});
