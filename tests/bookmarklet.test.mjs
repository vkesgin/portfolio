// Run from the repo root: node --test tests/
// The "Fikir Havuzu'na ekle" bookmarklet: its single source is the BM_SRC template in fikir.html,
// between /*BM-START*/ and /*BM-END*/. Static checks + behaviour in a small fake DOM (no browser, no network).
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const html = readFileSync(new URL('../fikir.html', import.meta.url), 'utf8');
const m = /\/\*BM-START\*\/([\s\S]*?)\/\*BM-END\*\//.exec(html);
const TEMPLATE = m ? m[1].trim() : '';
const PROD = 'https://velikesgin.com/fikir';
// BM_SRC as fikir.html builds it for a given board URL (the template interpolates JSON.stringify(BM_TARGET))
const build = (target) => new Function('BM_TARGET', `return ${TEMPLATE};`)(target);
const SRC = TEMPLATE ? build(PROD) : '';

describe('bookmarklet source', () => {
  test('BM_SRC is delimited in fikir.html and web-src/public/fikir.html is byte-identical', () => {
    assert.ok(TEMPLATE.startsWith('`') && TEMPLATE.endsWith('`'), 'template literal between the markers');
    assert.equal(readFileSync(new URL('../web-src/public/fikir.html', import.meta.url), 'utf8'), html);
  });
  test('parses as a function body', () => {
    assert.doesNotThrow(() => new Function(SRC));
  });
  test('encoded javascript: href stays short (<= 6000 chars)', () => {
    const href = 'javascript:' + encodeURIComponent(SRC);
    assert.ok(href.length <= 6000, `length ${href.length}`);
  });
  test('reads only: no fetch / XHR / cookies / storage / beacons', () => {
    for (const bad of ['fetch(', 'XMLHttpRequest', 'document.cookie', 'localStorage', 'sessionStorage', 'sendBeacon', 'eval(']) {
      assert.ok(!SRC.includes(bad), bad);
    }
  });
  test('opens the board with a #add? fragment (never a query the server would see)', () => {
    assert.ok(SRC.includes(`T=${JSON.stringify(PROD)}`));
    assert.ok(SRC.includes("T+'#add?'+p.toString()"));
    assert.ok(!/[?&]api=/.test(SRC));
  });
  test('fikir.html sets the href with setAttribute once (h() refuses javascript: URLs)', () => {
    assert.ok(html.includes("$('bm-link').setAttribute('href', 'javascript:' + encodeURIComponent(BM_SRC))"));
  });
});

/* ------------------------------------------------------------------ behaviour */
function rect(x, y, w, h) {
  return () => ({ left: x, top: y, right: x + w, bottom: y + h, width: w, height: h });
}
// Minimal DOM: only what the bookmarklet touches.
function run({ href, metas = {}, ld = [], videos = [], images = [], title = '', canonical = null, popupBlocked = false }) {
  const opened = [];
  const location = { href, hostname: new URL(href).hostname };
  const document = {
    title,
    images,
    querySelector(sel) {
      if (sel === 'link[rel="canonical"]') return canonical ? { href: canonical } : null;
      const mm = /^meta\[property="([^"]+)"\],meta\[name="([^"]+)"\]$/.exec(sel);
      if (mm) return Object.prototype.hasOwnProperty.call(metas, mm[1]) ? { getAttribute: () => metas[mm[1]] } : null;
      throw new Error('unexpected selector ' + sel);
    },
    querySelectorAll(sel) {
      if (sel === 'script[type="application/ld+json"]') return ld.map((o) => ({ textContent: typeof o === 'string' ? o : JSON.stringify(o) }));
      if (sel === 'video') return videos;
      throw new Error('unexpected selector ' + sel);
    },
  };
  const window = { open: (u, name) => { opened.push({ u, name }); return popupBlocked ? null : {}; } };
  vm.runInNewContext(SRC, { document, location, window, innerWidth: 1280, innerHeight: 800, URL, URLSearchParams });
  const target = opened.length ? opened[0].u : location.href;
  assert.ok(target.startsWith(PROD + '#add?'), target);
  return { params: Object.fromEntries(new URLSearchParams(target.slice(target.indexOf('#add?') + 5))), opened };
}
const video = (o) => ({ currentSrc: '', src: '', poster: '', paused: true, videoWidth: 0, videoHeight: 0, getBoundingClientRect: rect(0, 2000, 480, 270), ...o });

describe('bookmarklet behaviour', () => {
  const PAGE = 'https://www.magnific.com/premium-video/assembling-burger_4720543';
  const MP4 = 'https://videocdn.cdnpk.net/videos/9d0664ea/horizontal/previews/magnific_watermarked/large.mp4';
  const JPG = 'https://videocdn.cdnpk.net/videos/9d0664ea/horizontal/thumbnails/large.jpg';

  test('Magnific-like page: the visible playing video wins over related (src-less / offscreen) ones', () => {
    const { params, opened } = run({
      href: PAGE + '#comments', canonical: PAGE, title: 'Burger | Magnific',
      metas: { 'og:title': '  Assembling a Burger\n - Premium   Stock Video ', 'og:image': JPG, 'og:type': 'video' },
      ld: [{ '@type': 'VideoObject', contentUrl: MP4, thumbnailUrl: JPG, width: '3840', height: '2160' }],
      videos: [
        video({ currentSrc: MP4, paused: false, videoWidth: 1280, videoHeight: 720, getBoundingClientRect: rect(0, 80, 900, 506) }),
        video({ poster: JPG + '?rel=1', getBoundingClientRect: rect(0, 120, 480, 270) }),   // related, no src
        video({ currentSrc: 'https://videocdn.cdnpk.net/videos/other/small.mp4', getBoundingClientRect: rect(0, 1600, 480, 270) }),
      ],
    });
    assert.deepEqual(opened.map((o) => o.name), ['fikir']);
    assert.equal(params.url, PAGE);
    assert.equal(params.title, 'Assembling a Burger - Premium Stock Video');
    assert.equal(params.media, MP4);
    assert.equal(params.mk, 'video');
    assert.equal(params.poster, JPG);    // the video has no poster attribute -> og:image
    assert.equal(params.w, '1280');
    assert.equal(params.h, '720');
    assert.ok(!('api' in params));
  });

  test('empty values never turn into the page URL (poster, src, og:image, canonical)', () => {
    const { params } = run({
      href: 'https://example.com/some/article', title: 'Plain article',
      videos: [video({ getBoundingClientRect: rect(0, 0, 640, 360) })],   // visible, paused, no src
    });
    assert.equal(params.url, 'https://example.com/some/article');
    assert.ok(!('media' in params), JSON.stringify(params));
    assert.ok(!('poster' in params));
    assert.ok(!('mk' in params));
  });

  test('no playing video: og:video file, else the single / main JSON-LD VideoObject', () => {
    const a = run({ href: 'https://site.test/v/1', metas: { 'og:video:secure_url': 'https://cdn.site.test/1.mp4', 'og:image': 'https://cdn.site.test/1.jpg' } });
    assert.equal(a.params.media, 'https://cdn.site.test/1.mp4');
    assert.equal(a.params.poster, 'https://cdn.site.test/1.jpg');
    const b = run({ href: 'https://site.test/v/2', metas: { 'og:video': 'https://site.test/player/2' },   // an HTML player: not a file
      ld: [{ '@graph': [{ '@type': 'WebPage' }, { '@type': 'VideoObject', contentUrl: { url: '/media/2.webm' }, thumbnailUrl: ['/t/2.jpg'], width: 640, height: 360 }] }] });
    assert.equal(b.params.media, 'https://site.test/media/2.webm');
    assert.equal(b.params.poster, 'https://site.test/t/2.jpg');
    assert.equal(b.params.w, '640');
  });

  test('several VideoObjects: only the mainEntity one (url-less objects are not "main")', () => {
    const many = [{ '@type': 'VideoObject', contentUrl: 'https://cdn.test/rel1.mp4' }, { '@type': 'VideoObject', contentUrl: 'https://cdn.test/rel2.mp4' }];
    const none = run({ href: 'https://site.test/v/3', ld: many });
    assert.ok(!('media' in none.params), JSON.stringify(none.params));
    const main = run({ href: 'https://site.test/v/3', ld: [{ '@type': 'WebPage', mainEntity: { '@type': 'VideoObject', contentUrl: 'https://cdn.test/main.mp4' } }, ...many] });
    assert.equal(main.params.media, 'https://cdn.test/main.mp4');
  });

  test('blob: (MSE) video is skipped; a photo page sends its og:image as image media', () => {
    const { params } = run({
      href: 'https://photos.test/p/9', metas: { 'og:image': 'https://img.photos.test/9.jpg' },
      videos: [video({ currentSrc: 'blob:https://photos.test/abc', paused: false, getBoundingClientRect: rect(0, 0, 640, 360) })],
    });
    assert.equal(params.media, 'https://img.photos.test/9.jpg');
    assert.equal(params.mk, 'image');
    assert.ok(!('poster' in params));
  });

  test('no video and no og:image: the largest <img> (often a site graphic) is never sent as media', () => {
    const img = (src, w, hh) => ({ currentSrc: src, src, getBoundingClientRect: rect(0, 0, w, hh) });
    const { params } = run({
      href: 'https://www.reddit.com/r/x/comments/1/clip/', title: 'clip : r/x',
      images: [img('https://i.redd.it/cms/snoo_map.png', 900, 600), img('https://www.redditstatic.com/avatar.png', 40, 40)],
    });
    assert.ok(!('media' in params), JSON.stringify(params));
    assert.ok(!('mk' in params));
    assert.equal(params.title, 'clip : r/x');
  });

  test('canonical on another host is ignored; a blocked popup navigates the tab instead', () => {
    const { params, opened } = run({ href: 'https://a.test/x?id=1', canonical: 'https://evil.test/y', popupBlocked: true });
    assert.equal(params.url, 'https://a.test/x?id=1');
    assert.equal(opened.length, 1);
  });

  test('non-http(s) and over-long values are dropped', () => {
    const { params } = run({
      href: 'https://a.test/x', metas: { 'og:video': 'javascript:alert(1)//.mp4', 'og:image': 'data:image/png;base64,AAAA' },
      ld: [{ '@type': 'VideoObject', contentUrl: 'https://cdn.test/' + 'a'.repeat(2100) + '.mp4' }],
    });
    assert.ok(!('media' in params), JSON.stringify(params));
  });
});
