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
