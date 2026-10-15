// fixture-server.mjs: local stand-in for third-party sites, their CDNs and Browser Run, for tests/media-e2e.
// usage: node tests/media-e2e/fixture-server.mjs [port=4742]   (127.0.0.1 only; never port 8765)
//   GET  /page/vecteezy/video/<id>-<slug>   Vecteezy-like page: VideoObject ~672 KB deep, after a ~410 KB head
//   GET  /page/blocked/...                  403 "security filter" page (Magnific); Browser Run gets the scrape fixture
//   GET  /page/datadome|br429|brlimit/...   403 too; the fake Browser Run answers DataDome / 429 / "time limit exceeded"
//   GET  /page/br404|brempty/...            403 too; the fake Browser Run answers a removed page (404) / an empty 200 page
//   GET  /page/plain/...                    article with og:image only (a card, no media)
//   GET  /page/legacy-ok/...                small video page (og:video)       GET /page/legacy-fail/...  500
//   GET  /cdn/...                           Range-capable media: *.mp4 *.webm *.jpg *.png *.svg *.m3u8, plus
//                                           html-as-mp4.mp4 (text/html), 403.mp4, 404.mp4, redirect-169.mp4, big.mp4
//   POST /__br/scrape                       fake Quick Action `scrape` (X-Browser-Ms-Used); GET /__br/calls, POST /__br/reset
//   GET  /igfx/<host><path>                 stand-in for Instagram / its CDN (a worker with INSPIRE_TEST_IG="1" sends every
//                                           Instagram / Meta fetch here, see worker/index.js inspireTestHooks), built from the
//                                           synthetic tests/fixtures/video/ig-*.html with the asked shortcode and links that
//                                           expire in 48 h:
//        www.instagram.com/{reel|p|tv}/<code>/        post page: a reel (video + poster + caption); codes starting with
//                                                     "DPho": a photo post; codes containing "Gone": 404 (removed)
//        www.instagram.com/{reel|p|tv}/<code>/embed/  embed page: blocked ("Instagram'da İzle"), "DPho*": a photo
//        <*.cdninstagram.com|*.fbcdn.net>/.../<code>.mp4   the reel's video (Range-capable; $FIXTURE_IG_LONG if that file
//                                                     exists, else clip.mp4), sent at ~1.3 MB/s so a <video> seeks with
//                                                     Range requests; codes containing "Dead": 403 (CDN refuses the video)
//        <cdn host>/....jpg                           the poster (poster.jpg)
//                                           GET /__igfx/calls lists them ({path, range, status}), POST /__igfx/reset clears
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PORT = Number(process.argv[2] || 4742);
if (PORT === 8765) throw new Error('never 8765');
const FX = path.join(path.dirname(fileURLToPath(import.meta.url)), '../fixtures/media');
const BASE = `http://127.0.0.1:${PORT}`;
const read = (f) => fs.readFileSync(path.join(FX, f));
const CLIP_MP4 = read('clip.mp4'), CLIP_WEBM = read('clip.webm'), POSTER = read('poster.jpg');
const calls = [];
const igCalls = [];
const VFX = path.join(path.dirname(fileURLToPath(import.meta.url)), '../fixtures/video');
const readV = (f) => fs.readFileSync(path.join(VFX, f), 'utf8');

function vecteezyPage() {
  const parts = read('vecteezy-video.parts.html').toString('utf8').replaceAll('https://static.vecteezy.com/', `${BASE}/cdn/vecteezy/`)
    .split(/<!--PART:(?:HEAD|VIDEO|LD)-->\n?/).filter((x) => x.trim());
  const pad = (s, to, fill) => s + fill.repeat(Math.max(0, Math.ceil((to - s.length) / fill.length))).slice(0, Math.max(0, to - s.length));
  let html = pad(parts[0] + '<style>', 410 * 1024, '.x{color:red}\n') + '</style></head><body>';
  html = pad(html, 565 * 1024, '<div class="filler">lorem ipsum</div>\n') + parts[1];
  return pad(html, 672 * 1024, '<p>filler text 12345</p>\n') + parts[2] + '</body></html>';
}
const VECTEEZY = vecteezyPage();
const ARTICLE = (title) => `<!doctype html><html><head><title>${title}</title><meta property="og:title" content="${title}">
<meta property="og:type" content="article"><meta property="og:description" content="Plain article fixture">
<meta property="og:image" content="${BASE}/cdn/article/cover.jpg"></head><body><p>text</p></body></html>`;
const LEGACY_OK = `<!doctype html><html><head><title>Legacy clip</title><meta property="og:title" content="Legacy clip refreshed">
<meta property="og:type" content="video.other"><meta property="og:image" content="${BASE}/cdn/legacy/77001234.jpg">
<meta property="og:video" content="${BASE}/cdn/legacy/77001234.mp4"><meta property="og:video:type" content="video/mp4">
<meta property="og:video:width" content="160"><meta property="og:video:height" content="90"></head><body></body></html>`;

function sendMedia(req, res, body, type) {
  const size = body.length;
  const m = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || '');
  const h = { 'Content-Type': type, 'Accept-Ranges': 'bytes', 'Access-Control-Allow-Origin': '*' };
  if (m && (m[1] !== '' || m[2] !== '')) {
    let start = m[1] === '' ? Math.max(0, size - Number(m[2])) : Number(m[1]);
    let end = m[1] === '' || m[2] === '' ? size - 1 : Math.min(Number(m[2]), size - 1);
    if (start >= size) { res.writeHead(416, { ...h, 'Content-Range': `bytes */${size}` }); return res.end(); }
    res.writeHead(206, { ...h, 'Content-Range': `bytes ${start}-${end}/${size}`, 'Content-Length': end - start + 1 });
    return res.end(req.method === 'HEAD' ? undefined : body.subarray(start, end + 1));
  }
  res.writeHead(200, { ...h, 'Content-Length': size });
  res.end(req.method === 'HEAD' ? undefined : body);
}

function cdn(req, res, p) {
  if (p.endsWith('/html-as-mp4.mp4')) { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); return res.end('<!doctype html><title>not a video</title>'); }
  if (p.endsWith('/403.mp4')) { res.writeHead(403, { 'Content-Type': 'text/plain' }); return res.end('forbidden'); }
  if (p.endsWith('/404.mp4')) { res.writeHead(404, { 'Content-Type': 'text/plain' }); return res.end('nope'); }
  if (p.endsWith('/redirect-169.mp4')) { res.writeHead(302, { Location: 'http://169.254.169.254/latest/x.mp4' }); return res.end(); }
  if (p.endsWith('/big.mp4')) {
    res.writeHead(206, { 'Content-Type': 'video/mp4', 'Content-Range': 'bytes 0-0/52428800', 'Content-Length': 1 });
    return res.end(Buffer.from([0]));
  }
  if (/\.svg$/.test(p)) { res.writeHead(200, { 'Content-Type': 'image/svg+xml' }); return res.end('<svg xmlns="http://www.w3.org/2000/svg"/>'); }
  if (/\.m3u8$/.test(p)) { res.writeHead(200, { 'Content-Type': 'application/vnd.apple.mpegurl' }); return res.end('#EXTM3U\n'); }
  if (p.endsWith('/app-mp4.mp4')) return sendMedia(req, res, CLIP_MP4, 'application/mp4');   // S3 style (Envato Elements previews)
  if (/\.webm$/.test(p)) return sendMedia(req, res, CLIP_WEBM, 'video/webm');
  if (/\.(mp4|m4v|mov)$/.test(p)) return sendMedia(req, res, CLIP_MP4, 'video/mp4');
  if (/\.(jpe?g|png|webp|gif)$/.test(p)) return sendMedia(req, res, POSTER, 'image/jpeg');
  res.writeHead(404); res.end();
}

// ── Instagram stand-in (/igfx/...) ──
const IG_CODE = /^[A-Za-z0-9_-]{5,40}$/;
const oeHex = () => (Math.floor(Date.now() / 1000) + 48 * 3600).toString(16).toUpperCase();
function igPage(kind, code) {
  const oe = oeHex();
  if (code.startsWith('DPho')) {
    return readV('ig-photo.html').replaceAll('DTestPhoto1', code).replaceAll('oe=6ACD0906', 'oe=' + oe)
      .replaceAll('photo_1080.jpg', `${code}_1080.jpg`).replaceAll('photo_640.jpg', `${code}_640.jpg`);
  }
  return readV('ig-reel.html').replaceAll('DTestReel01', code).replaceAll('oe=6AC94349', 'oe=' + oe).replaceAll('oe=6ACD0906', 'oe=' + oe)
    .replaceAll('/REEL.mp4', `/${code}.mp4`).replaceAll('poster_720.jpg', `${code}_720.jpg`).replaceAll('poster_640.jpg', `${code}_640.jpg`)
    .replaceAll('Şehir ışıkları\u202e test', `Şehir ışıkları ${code}`);
}
function igEmbed(code) {
  if (code.startsWith('DPho')) return readV('ig-embed-photo.html').replaceAll('DTestPhoto1', code);
  return readV('ig-embed-blocked.html').replaceAll('DTestReel01', code);
}
// Range-capable like sendMedia, but the body goes out in 64 KB slices every 50 ms (~1.3 MB/s) and stops when the client goes
function sendSlow(req, res, body, type) {
  const size = body.length;
  const m = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || '');
  const h = { 'Content-Type': type, 'Accept-Ranges': 'bytes' };
  let start = 0, end = size - 1, status = 200;
  if (m && (m[1] !== '' || m[2] !== '')) {
    start = m[1] === '' ? Math.max(0, size - Number(m[2])) : Number(m[1]);
    end = m[1] === '' || m[2] === '' ? size - 1 : Math.min(Number(m[2]), size - 1);
    if (start >= size) { res.writeHead(416, { ...h, 'Content-Range': `bytes */${size}` }); res.end(); return 416; }
    status = 206; h['Content-Range'] = `bytes ${start}-${end}/${size}`;
  }
  res.writeHead(status, { ...h, 'Content-Length': end - start + 1 });
  if (req.method === 'HEAD') { res.end(); return status; }
  let off = start, timer = null;
  const step = () => {
    if (res.destroyed) return;
    const next = Math.min(off + 65536, end + 1);
    res.write(body.subarray(off, next));
    off = next;
    if (off > end) res.end(); else timer = setTimeout(step, 50);
  };
  res.on('close', () => clearTimeout(timer));
  step();
  return status;
}
function igfx(req, res, p) {
  const m = /^\/igfx\/([a-z0-9.-]+)(\/.*)$/.exec(p);
  const host = m ? m[1] : '', rest = m ? m[2] : '';
  const done = (status) => { igCalls.push({ host, path: rest, range: req.headers.range || null, status, at: Date.now() }); };
  if (host === 'www.instagram.com') {
    const pm = /^\/(reel|p|tv)\/([A-Za-z0-9_-]+)\/(embed\/(?:captioned\/)?)?$/.exec(rest);
    if (!pm || !IG_CODE.test(pm[2]) || pm[2].includes('Gone')) { res.writeHead(404, { 'Content-Type': 'text/html' }); res.end('<!doctype html><title>Sayfa bulunamadı</title>'); return done(404); }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(pm[3] ? igEmbed(pm[2]) : igPage(pm[1], pm[2]));
    return done(200);
  }
  if (/(^|\.)(cdninstagram\.com|fbcdn\.net)$/.test(host)) {
    if (/\.mp4$/.test(rest.split('?')[0])) {
      if (/Dead/.test(rest)) { res.writeHead(403, { 'Content-Type': 'text/plain' }); res.end('URL signature expired'); return done(403); }
      const long = process.env.FIXTURE_IG_LONG;
      const body = long && fs.existsSync(long) ? fs.readFileSync(long) : CLIP_MP4;
      return done(sendSlow(req, res, body, 'video/mp4'));
    }
    if (/\.(jpe?g|webp|png)$/.test(rest.split('?')[0])) { sendMedia(req, res, POSTER, 'image/jpeg'); return done(200); }
  }
  res.writeHead(404, { 'Content-Type': 'text/plain' }); res.end('not found');
  return done(404);
}

function fakeScrape(req, res) {
  let raw = '';
  req.on('data', (c) => { raw += c; });
  req.on('end', () => {
    let opts = {};
    try { opts = JSON.parse(raw); } catch (e) {}
    const url = String(opts.url || '');
    calls.push({ url, userAgent: opts.userAgent, elements: (opts.elements || []).length, at: Date.now() });
    const h = { 'Content-Type': 'application/json', 'X-Browser-Ms-Used': '2569.7' };
    if (url.includes('/brlimit')) { res.writeHead(599, { 'Content-Type': 'text/plain' }); return res.end('Error: Browser time limit exceeded for today'); }
    if (url.includes('/br429')) { res.writeHead(429, { ...h, 'Retry-After': '61' }); return res.end('{"success":false,"errors":[{"message":"Rate limit exceeded"}]}'); }
    if (url.includes('/datadome')) { res.writeHead(200, h); return res.end(read('br-scrape-datadome.json')); }
    if (url.includes('/br404')) {
      res.writeHead(200, h);
      return res.end(JSON.stringify({ success: true, result: [{ selector: 'title', results: [{ attributes: [], text: 'Sayfa bulunamadı | Magnific' }] }],
        meta: { status: 404, title: '', finalUrl: url, headers: { 'content-type': 'text/html' } } }));
    }
    if (url.includes('/brempty')) { res.writeHead(200, h); return res.end(JSON.stringify({ success: true, result: [], meta: { status: 200, finalUrl: url } })); }
    const j = JSON.parse(read('br-scrape-magnific.json').toString('utf8').replaceAll('https://videocdn.cdnpk.net/', `${BASE}/cdn/videocdn/`));
    j.meta.finalUrl = url;
    res.writeHead(200, h);
    res.end(JSON.stringify(j));
  });
}

const server = http.createServer((req, res) => {
  const u = new URL(req.url, BASE);
  const p = u.pathname;
  try {
    if (p === '/__br/scrape' && req.method === 'POST') return fakeScrape(req, res);
    if (p === '/__br/calls') { res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ count: calls.length, calls })); }
    if (p === '/__br/reset' && req.method === 'POST') { calls.length = 0; res.writeHead(204); return res.end(); }
    if (p.startsWith('/cdn/')) return cdn(req, res, p);
    if (p.startsWith('/igfx/')) return igfx(req, res, p);
    if (p === '/__igfx/calls') { res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ count: igCalls.length, calls: igCalls })); }
    if (p === '/__igfx/reset' && req.method === 'POST') { igCalls.length = 0; res.writeHead(204); return res.end(); }
    if (p.startsWith('/page/vecteezy/')) { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); return res.end(VECTEEZY); }
    if (/^\/page\/(blocked|datadome|br429|brlimit|br404|brempty)\//.test(p)) {
      res.writeHead(403, { 'Content-Type': 'text/html' });
      return res.end(read('magnific-security-filter.html'));
    }
    if (p.startsWith('/page/plain/')) { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); return res.end(ARTICLE('Plain article ' + (u.search || p))); }
    if (p.startsWith('/page/legacy-ok/')) { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); return res.end(LEGACY_OK); }
    if (p.startsWith('/page/legacy-fail/')) { res.writeHead(500, { 'Content-Type': 'text/plain' }); return res.end('server error'); }
    res.writeHead(404, { 'Content-Type': 'text/plain' }); res.end('not found');
  } catch (e) {
    res.writeHead(500); res.end(String(e && e.message));
  }
});
server.listen(PORT, '127.0.0.1', () => console.log(`fixture server on ${BASE}`));
