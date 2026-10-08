// make-clip.mjs: regenerates clip.webm (and clip.mp4 when Chrome's MediaRecorder can write MP4): a 2 s, 160x90 test clip
// drawn on a canvas in headless Chrome. Committed outputs are used by tests/media-e2e (fixture CDN + uploads) and the
// sniff tests; run this only to rebuild them.
// usage: PUPPETEER_DIR=/path/to/folder/with/node_modules node tests/fixtures/media/make-clip.mjs
//        (needs puppeteer-core there and Google Chrome at /Applications/Google Chrome.app)
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(path.join(process.env.PUPPETEER_DIR || process.cwd(), 'noop.js'));
const puppeteer = require('puppeteer-core');
const browser = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: 'new', args: ['--no-first-run'] });
try {
  const page = await browser.newPage();
  await page.setContent('<canvas id="c" width="160" height="90"></canvas>');
  for (const [file, mime] of [['clip.webm', 'video/webm;codecs=vp8'], ['clip.mp4', 'video/mp4;codecs=avc1.42E01E']]) {
    const b64 = await page.evaluate(async (mime) => {
      if (!MediaRecorder.isTypeSupported(mime)) return null;
      const c = document.getElementById('c'), g = c.getContext('2d');
      const stream = c.captureStream(30);
      const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 150000 });
      const parts = [];
      rec.ondataavailable = (e) => { if (e.data.size) parts.push(e.data); };
      const done = new Promise((r) => { rec.onstop = r; });
      rec.start(100);
      const t0 = performance.now();
      await new Promise((resolve) => {
        const draw = () => {
          const t = (performance.now() - t0) / 2000;
          g.fillStyle = `hsl(${Math.round(t * 360)},70%,50%)`; g.fillRect(0, 0, 160, 90);
          g.fillStyle = '#fff'; g.fillRect(10 + t * 120, 35, 20, 20);
          g.font = '14px sans-serif'; g.fillText('fikir test', 50, 80);
          if (t < 1) requestAnimationFrame(draw); else resolve();
        };
        draw();
      });
      rec.stop();
      await done;
      const buf = new Uint8Array(await new Blob(parts, { type: mime }).arrayBuffer());
      let s = ''; for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode.apply(null, buf.subarray(i, i + 0x8000));
      return btoa(s);
    }, mime);
    if (!b64) { console.log(`${file}: ${mime} not supported, skipped`); continue; }
    fs.writeFileSync(path.join(HERE, file), Buffer.from(b64, 'base64'));
    console.log(`${file}: ${Buffer.from(b64, 'base64').length} bytes`);
  }
} finally {
  await browser.close();
}
