// firma-smoke.mjs: company tags ("Firma") on the board (fikir.html) in headless Chrome against a local `wrangler dev`.
// usage: FIRMA_E2E_PUPPETEER=<dir with node_modules/puppeteer-core> tests/firma-e2e/run-smoke.sh
// Text ideas only (nothing is fetched by the worker); Chrome resolves no host name but 127.0.0.1 (--host-resolver-rules).
// Checks (one result line each; every check runs; exit 1 when one failed; page errors fail the run):
//   A  add dialog: "Sayın" created from the picker ("+ Yeni firma"), "gayri" finds the seeded "Gayrimenkul", "SAYIN" offers no
//      second "Sayın"; the shared card shows both chips
//   B  bar counts match the board; a chip filters (others hidden, ?firma=sayin); a reload keeps it; the bare URL restores it
//      from localStorage
//   C  two companies: "Herhangi biri" vs "Hepsi"; "Firmasız"; "Tümü" clears
//   D  add while filtered: the picker starts with the filter's company; without it the new card is hidden and the toast
//      "… seçili filtrede görünmüyor" + "Filtreyi temizle" shows it
//   E  the owner edits a card's companies (✎, #tag-modal): the card leaves the filter at once with a toast; another guest's
//      card has no ✎ / "Firma ekle"
//   F  admin "Firmaları yönet": rename (chips + the URL slug follow), recolor, a rename onto another name merges, delete
//      (chips gone, ideas kept)
//   G  a company named <img src=x onerror=…> renders as text
//   H  390 px wide: the chip row scrolls sideways, the page does not
//   I  keyboard: one tab stop in the chip row, arrows move; combobox arrows / Enter / Backspace; Esc closes only the list
//   J  a list refresh keeps the filter and the very same card elements
//   K  a filter without matches: "Bu filtreyle eşleşen fikir yok." + "«X» için fikir ekle" + clearing it
// env: FIRMA_E2E_WEBPORT (4751), FIRMA_E2E_SHOTS, FIRMA_E2E_PUPPETEER, FIKIR_E2E_BOARD_PASSWORD, FIRMA_E2E_ADMIN_PASSWORD (TEST values)
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const BASE = process.argv[2] || 'http://127.0.0.1:8851';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const R = path.join(HERE, '../..');
const WEBPORT = Number(process.env.FIRMA_E2E_WEBPORT || 4751);
const SHOTS = process.env.FIRMA_E2E_SHOTS || path.join(process.env.TMPDIR || '/tmp', 'fikir-firma-e2e/shots');
const PPT = process.env.FIRMA_E2E_PUPPETEER || process.env.VIDEO_E2E_PUPPETEER;
const BOARD_PW = process.env.FIKIR_E2E_BOARD_PASSWORD || 'test-board-pass';
const ADMIN_PW = process.env.FIRMA_E2E_ADMIN_PASSWORD || 'firma-e2e-admin';
const CHROME = process.env.FIRMA_E2E_CHROME || process.env.VIDEO_E2E_CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
if (!/^http:\/\/127\.0\.0\.1:\d+$/.test(BASE)) throw new Error('local worker only');
if (WEBPORT === 8765 || /:8765$/.test(BASE)) throw new Error('never 8765');
if (!PPT || !fs.existsSync(path.join(PPT, 'node_modules/puppeteer-core'))) throw new Error('FIRMA_E2E_PUPPETEER: a folder with node_modules/puppeteer-core');
const puppeteer = createRequire(path.join(PPT, 'noop.js'))('puppeteer-core');
fs.mkdirSync(SHOTS, { recursive: true });
const WEB = `http://127.0.0.1:${WEBPORT}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const newCid = () => 'f' + Math.random().toString(36).slice(2) + Date.now().toString(36) + 'xxxxxxxx';

const results = [];
async function check(id, name, fn) {
  const t0 = Date.now();
  try {
    const detail = await fn();
    results.push({ id, ok: true });
    console.log(`ok ${id} ${name}${detail ? ' — ' + detail : ''} (${Date.now() - t0} ms)`);
  } catch (e) {
    results.push({ id, ok: false });
    console.log(`not ok ${id} ${name} — ${String(e && e.stack || e).slice(0, 2000)}`);
  }
}

async function call(method, p, body, token) {
  const h = { 'X-Fikir-Client': '2' };
  if (body != null) h['Content-Type'] = 'application/json';
  if (token) h.Authorization = 'Bearer ' + token;
  const res = await fetch(BASE + p, { method, headers: h, body: body == null ? undefined : JSON.stringify(body) });
  const text = await res.text();
  let data = null; try { data = JSON.parse(text); } catch (_) { data = text; }
  return { status: res.status, data };
}

// ── static server for the board page ──
const TYPES = { '.html': 'text/html; charset=utf-8', '.mjs': 'text/javascript', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.ico': 'image/x-icon' };
const web = http.createServer((req, res) => {
  let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (p === '/' || p === '/fikir') p = '/fikir.html';
  if (!(p === '/fikir.html' || p.startsWith('/assets/')) || p.includes('..')) { res.writeHead(404); res.end('nf'); return; }
  fs.readFile(path.join(R, p), (err, buf) => {
    if (err) { res.writeHead(404); res.end('nf'); return; }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(p)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(buf);
  });
});
await new Promise((r) => web.listen(WEBPORT, '127.0.0.1', r));

let browser = null;
const consoleErrors = [], pageErrors = [];
try {
  // ── seeds (another guest): companies + text ideas ──
  const other = await call('POST', '/api/inspire/guest', { cid: newCid(), name: 'Diğer', password: BOARD_PW });
  assert.equal(other.status, 200, JSON.stringify(other.data));
  const OT = other.data.token;
  const mkTag = async (name, color) => { const r = await call('POST', '/api/inspire/tags', { name, ...(color ? { color } : {}) }, OT); assert.ok(r.status === 201, JSON.stringify(r.data)); return r.data.tag; };
  const mkPost = async (text, tags = []) => { const r = await call('POST', '/api/inspire/posts', { type: 'text', text, tag_ids: tags.map((t) => t.id) }, OT); assert.equal(r.status, 201, JSON.stringify(r.data)); return r.data.id; };
  const gay = await mkTag('Gayrimenkul', 'green');
  const beta = await mkTag('Beta Yapı', 'violet');
  const extra = [];
  for (const n of ['Delta Lojistik', 'Epsilon Enerji', 'Zeta Gıda', 'Eta Tekstil', 'Teta Otomotiv', 'Kappa Turizm', 'Lambda Medya']) extra.push(await mkTag(n));
  const ids = {};
  ids.p1 = await mkPost('Gayrimenkul fikri', [gay]);
  ids.p2 = await mkPost('Beta fikri', [beta]);
  ids.p3 = await mkPost('İkisi birden', [gay, beta]);
  ids.p4 = await mkPost('Firmasız fikir bir');
  ids.p5 = await mkPost('Firmasız fikir iki');
  ids.px = await mkPost('Diğer firmalar', extra);
  console.log('# seeded ' + JSON.stringify(ids));

  browser = await puppeteer.launch({ executablePath: CHROME, headless: true,
    args: ['--no-first-run', '--no-default-browser-check', '--lang=tr-TR', '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1'] });
  const prepare = async (page, label) => {
    page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(`[${label}] ${m.text().slice(0, 300)}`); });
    page.on('pageerror', (e) => pageErrors.push(`[${label}] ${String(e && e.message || e).slice(0, 300)}`));
    page.on('dialog', (d) => { pageErrors.push(`[${label}] dialog: ${d.message()}`); d.dismiss().catch(() => {}); });
  };
  const boardUrl = (q = '') => `${WEB}/fikir.html?api=${encodeURIComponent(BASE)}${q}`;
  async function loginGuest(page, name) {
    await page.goto(boardUrl(), { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('#entry-screen:not([hidden])', { timeout: 20000 });
    await page.type('#guest-name', name);
    await page.type('#guest-pass', BOARD_PW);
    await page.click('#guest-btn');
    await page.waitForSelector('#dashboard:not([hidden])', { timeout: 20000 });
    await page.waitForSelector('#firm-bar:not([hidden])', { timeout: 20000 });
  }
  const card = (id) => `.post-card[data-id="${id}"]`;
  const visible = (page) => page.evaluate(() => [...document.querySelectorAll('.post-card')].filter((c) => !c.hidden).map((c) => Number(c.dataset.id)).sort((a, b) => a - b));
  const sorted = (...a) => a.sort((x, y) => x - y);
  const chipCounts = (page) => page.evaluate(() => Object.fromEntries([...document.querySelectorAll('#firm-chips .firm-chip')]
    .map((b) => [b.querySelector('.tc-name').textContent, Number((b.querySelector('.n') || {}).textContent)])));
  const clickChip = (page, name) => page.evaluate((n) => {
    const b = [...document.querySelectorAll('#firm-chips .firm-chip')].find((x) => x.querySelector('.tc-name').textContent === n);
    if (!b) throw new Error('no chip ' + n);
    b.click();
  }, name);
  const pressed = (page) => page.evaluate(() => [...document.querySelectorAll('#firm-chips .firm-chip[aria-pressed="true"]')].map((b) => b.querySelector('.tc-name').textContent));
  const search = (page) => page.evaluate(() => location.search);
  const waitToast = (page, re) => page.waitForFunction((src) => [...document.querySelectorAll('#toasts .toast')].some((t) => new RegExp(src).test(t.textContent)), { timeout: 10000 }, re.source);
  const options = (page, root) => page.$$eval(`${root} .picker-list li`, (ls) => ls.map((l) => l.textContent.trim()));
  const shot = (page, name) => page.screenshot({ path: path.join(SHOTS, name) });

  const page = await browser.newPage();
  await page.setViewport({ width: 1360, height: 1000, deviceScaleFactor: 1 });
  await prepare(page, 'owner');
  await loginGuest(page, 'Firma Test');
  await page.waitForSelector(card(ids.px));
  await shot(page, '0-board.png');

  await check('A', 'add dialog: create "Sayın", pick "Gayrimenkul" by typing, "SAYIN" offers no duplicate; the card shows both chips', async () => {
    await page.click('#btn-add');
    await page.waitForSelector('#add-modal:not([hidden])');
    await sleep(120);   // openModal focuses its first field after 30 ms
    await page.click('#tab-text');
    await page.type('#text-body', 'Sayın ve Gayrimenkul için ortak fikir');
    const inp = '#add-firms input[role="combobox"]';
    assert.equal(await page.$eval('#add-firms', (el) => el.hidden || !el.closest('#text-form')), false, 'picker in the text form');
    await page.click(inp);
    await page.type(inp, 'Sayın');
    await page.waitForSelector('#add-firms .picker-list li.opt-new');
    assert.match((await options(page, '#add-firms')).join('|'), /\+ Yeni firma: «Sayın»/);
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => [...document.querySelectorAll('#add-firms .picker .tag-chip')].some((c) => c.textContent.includes('Sayın')), { timeout: 10000 });
    await page.type(inp, 'gayri');
    await page.waitForFunction(() => { const li = document.querySelector('#add-firms .picker-list li[aria-selected="true"]'); return li && li.textContent.includes('Gayrimenkul'); }, { timeout: 5000 });
    await page.keyboard.press('Enter');
    await page.type(inp, 'SAYIN');
    await sleep(200);
    const opts = await options(page, '#add-firms');
    assert.ok(!opts.some((o) => /Yeni firma/.test(o)), 'no create option for SAYIN: ' + JSON.stringify(opts));
    assert.ok(!opts.some((o) => /^Sayın/.test(o)), 'Sayın is already selected');
    await page.$eval(inp, (el) => { el.value = ''; el.dispatchEvent(new Event('input', { bubbles: true })); });
    await shot(page, 'A-add-dialog.png');
    const created = page.waitForResponse((r) => r.url() === BASE + '/api/inspire/posts' && r.request().method() === 'POST');
    await page.click('#text-submit');
    const post = await (await created).json();
    ids.a = post.id;
    assert.deepEqual(post.tags.map((t) => t.name), ['Gayrimenkul', 'Sayın']);
    await page.waitForSelector(`${card(ids.a)} .post-tags .tag-chip`);
    const chips = await page.$$eval(`${card(ids.a)} .post-tags .tag-chip`, (cs) => cs.map((c) => c.textContent));
    assert.deepEqual(chips, ['Gayrimenkul', 'Sayın']);
    const sayin = await call('POST', '/api/inspire/tags', { name: 'SAYIN' }, OT);
    assert.equal(sayin.status, 200); assert.equal(sayin.data.tag.name, 'Sayın');
    ids.sayin = sayin.data.tag.id;
    return 'chips ' + chips.join(', ');
  });

  await check('B', 'bar counts, a chip filters (?firma=sayin), reload keeps it, the bare URL restores it from localStorage', async () => {
    await page.waitForFunction(() => document.querySelectorAll('#firm-chips .firm-chip').length >= 5);
    const c = await chipCounts(page);
    assert.equal(c['Tümü'], 7); assert.equal(c['Gayrimenkul'], 3); assert.equal(c['Beta Yapı'], 2); assert.equal(c['Sayın'], 1); assert.equal(c['Firmasız'], 2);
    await clickChip(page, 'Sayın');
    assert.deepEqual(await visible(page), [ids.a]);
    assert.match(await search(page), /firma=sayin/);
    assert.match(await page.$eval('#firm-summary', (e) => e.textContent), /1 fikir · Sayın/);
    await shot(page, 'B-filter-sayin.png');
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForSelector(card(ids.a));
    await page.waitForFunction(() => !document.querySelector('#firm-bar').hidden);
    assert.deepEqual(await visible(page), [ids.a], 'after reload');
    assert.deepEqual(await pressed(page), ['Sayın']);
    await page.goto(boardUrl(), { waitUntil: 'domcontentloaded' });
    await page.waitForSelector(card(ids.a));
    await page.waitForFunction(() => /firma=sayin/.test(location.search), { timeout: 10000 });
    assert.deepEqual(await visible(page), [ids.a], 'restored from localStorage');
    return JSON.stringify(c);
  });

  await check('C', 'Herhangi biri vs Hepsi, Firmasız, Tümü', async () => {
    await clickChip(page, 'Tümü');
    assert.equal((await visible(page)).length, 7);
    assert.ok(!/firma=/.test(await search(page)));
    await clickChip(page, 'Gayrimenkul');
    await clickChip(page, 'Beta Yapı');
    assert.deepEqual(await visible(page), sorted(ids.p1, ids.p2, ids.p3, ids.a), 'any');
    assert.equal(await page.$eval('#firm-match', (e) => e.hidden), false, 'match mode with two companies');
    await page.click('#firm-match [data-match="all"]');
    assert.deepEqual(await visible(page), [ids.p3], 'all');
    assert.match(await search(page), /eslesme=hepsi/);
    assert.match(await page.$eval('#firm-summary', (e) => e.textContent), /Gayrimenkul \+ Beta Yapı|Beta Yapı \+ Gayrimenkul/);
    await shot(page, 'C-hepsi.png');
    await page.click('#firm-match [data-match="any"]');
    await clickChip(page, 'Tümü');
    await clickChip(page, 'Firmasız');
    assert.deepEqual(await visible(page), sorted(ids.p4, ids.p5), 'Firmasız');
    assert.match(await search(page), /firma=firmasiz/);
    await clickChip(page, 'Tümü');
    assert.equal((await visible(page)).length, 7);
  });

  await check('D', 'add while filtered: preselected company; removed -> hidden card + toast with "Filtreyi temizle"', async () => {
    await clickChip(page, 'Beta Yapı');
    await page.click('#btn-add');
    await page.waitForSelector('#add-modal:not([hidden])');
    await sleep(120);   // openModal focuses its first field after 30 ms
    const pre = await page.$$eval('#add-firms .picker .tag-chip', (cs) => cs.map((c) => c.textContent.replace('×', '').trim()));
    assert.deepEqual(pre, ['Beta Yapı'], 'preselected from the filter');
    await page.click('#tab-text');
    await page.click('#text-body');
    await page.type('#text-body', 'Filtre dışında kalacak fikir');
    await page.click('#add-firms input[role="combobox"]');
    await page.keyboard.press('Backspace');
    assert.equal((await page.$$('#add-firms .picker .tag-chip')).length, 0, 'Backspace removed the chip');
    const created = page.waitForResponse((r) => r.url() === BASE + '/api/inspire/posts' && r.request().method() === 'POST');
    await page.click('#text-submit');
    ids.d = (await (await created).json()).id;
    await waitToast(page, /seçili filtrede görünmüyor/);
    assert.equal(await page.$eval(card(ids.d), (c) => c.hidden), true, 'the new card is hidden');
    await shot(page, 'D-toast.png');
    await page.evaluate(() => [...document.querySelectorAll('#toasts .toast-action')].find((b) => b.textContent === 'Filtreyi temizle').click());
    await page.waitForFunction((s) => { const c = document.querySelector(s); return c && !c.hidden; }, { timeout: 5000 }, card(ids.d));
    assert.ok(!/firma=/.test(await search(page)));
  });

  await check('E', 'owner edits a card (✎): it leaves the filter at once with a toast; no ✎ / "Firma ekle" on another guest\'s card', async () => {
    assert.equal(await page.$(`${card(ids.p1)} [data-action="tags-edit"]:not([hidden])`), null, 'other guest\'s card: no edit');
    await clickChip(page, 'Sayın');
    assert.deepEqual(await visible(page), [ids.a]);
    await page.click(`${card(ids.a)} .tag-edit`);
    await page.waitForSelector('#tag-modal:not([hidden])');
    const pre = await page.$$eval('#tag-picker .picker .tag-chip', (cs) => cs.map((c) => c.textContent.replace('×', '').trim()));
    assert.deepEqual(pre, ['Gayrimenkul', 'Sayın']);
    await page.evaluate(() => [...document.querySelectorAll('#tag-picker .picker .tag-chip')].find((c) => c.textContent.includes('Sayın')).querySelector('.x').click());
    await shot(page, 'E-tag-modal.png');
    await page.click('#tag-save');
    await waitToast(page, /artık görünmüyor/);
    assert.equal(await page.$eval(card(ids.a), (c) => c.hidden), true);
    assert.equal(await page.$eval('#tag-modal', (m) => m.hidden), true);
    await clickChip(page, 'Tümü');
    const chips = await page.$$eval(`${card(ids.a)} .post-tags .tag-chip`, (cs) => cs.map((c) => c.textContent));
    assert.deepEqual(chips, ['Gayrimenkul']);
    // "Firma ekle" on the owner's untagged card (D)
    assert.ok(await page.$(`${card(ids.d)} [data-action="tags-edit"]:not([hidden])`), 'Firma ekle on the own untagged card');
  });

  await check('G', 'a company named <img …> renders as text', async () => {
    const x = await call('POST', '/api/inspire/tags', { name: '<img src=x onerror=window.__xss=1>' }, OT);
    assert.equal(x.status, 201);
    await call('PUT', `/api/inspire/posts/${ids.p4}/tags`, { tag_ids: [x.data.tag.id] }, OT);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForSelector(`${card(ids.p4)} .post-tags .tag-chip`);
    const r = await page.evaluate((s) => ({ img: document.querySelectorAll(`${s} .post-tags img, #firm-chips img`).length, xss: window.__xss === 1,
      text: document.querySelector(`${s} .post-tags .tag-chip`).textContent }), card(ids.p4));
    assert.deepEqual(r, { img: 0, xss: false, text: '<img src=x onerror=window.__xss=1>' });
    await call('DELETE', `/api/inspire/tags/${x.data.tag.id}`, null, (await call('POST', '/api/inspire/login', { username: 'vkesgin38', password: ADMIN_PW })).data.token);
  });

  await check('I', 'keyboard: one tab stop in the chip row + arrows; combobox Arrow / Enter / Esc (list only) / Backspace', async () => {
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForSelector('#firm-bar:not([hidden])');
    const stops = await page.$$eval('#firm-chips .firm-chip', (bs) => bs.filter((b) => b.tabIndex === 0).length);
    assert.equal(stops, 1, 'one tab stop');
    const start = await page.$$eval('#firm-chips .firm-chip', (bs) => bs.findIndex((b) => b.tabIndex === 0));
    await page.focus('#firm-chips .firm-chip[tabindex="0"]');
    await page.keyboard.press('ArrowRight');
    const f = await page.evaluate(() => ({ idx: [...document.querySelectorAll('#firm-chips .firm-chip')].indexOf(document.activeElement), stop: document.activeElement.tabIndex }));
    assert.deepEqual(f, { idx: start + 1, stop: 0 });
    assert.equal(await page.$$eval('#firm-chips .firm-chip', (bs) => bs.filter((b) => b.tabIndex === 0).length), 1, 'the tab stop moved');
    await page.keyboard.press('End');
    assert.equal(await page.evaluate(() => document.activeElement === [...document.querySelectorAll('#firm-chips .firm-chip')].pop()), true);
    await page.click('#btn-add');
    await page.waitForSelector('#add-modal:not([hidden])');
    await sleep(120);   // openModal focuses its first field after 30 ms
    await page.click('#tab-link');
    const inp = '#add-firms input[role="combobox"]';
    await page.focus(inp);
    await page.type(inp, 'gay');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowUp');
    await page.keyboard.press('Enter');
    assert.equal((await page.$$('#add-firms .picker .tag-chip')).length, 1, 'Enter picked an option');
    await page.type(inp, 'del');
    await page.waitForSelector('#add-firms .picker-list:not([hidden])');
    assert.equal(await page.$eval(inp, (i) => i.getAttribute('aria-expanded')), 'true');
    await page.keyboard.press('Escape');
    assert.equal(await page.$eval('#add-firms .picker-list', (l) => l.hidden), true, 'Esc closed the list');
    assert.equal(await page.$eval('#add-modal', (m) => m.hidden), false, '... not the dialog');
    await page.$eval(inp, (el) => { el.value = ''; });
    await page.keyboard.press('Backspace');
    assert.equal((await page.$$('#add-firms .picker .tag-chip')).length, 0);
    await page.keyboard.press('Escape');
    assert.equal(await page.$eval('#add-modal', (m) => m.hidden), true, 'the second Esc closes the dialog');
  });

  await check('J', 'a list refresh keeps the filter and the same card elements', async () => {
    await clickChip(page, 'Tümü');
    await clickChip(page, 'Gayrimenkul');
    const before = await visible(page);
    await page.evaluate(() => { window.__cards = [...document.querySelectorAll('.post-card')].filter((c) => !c.hidden); });
    const listed = page.waitForResponse((r) => /\/api\/inspire\/posts$/.test(r.url()) && r.request().method() === 'GET', { timeout: 10000 });
    await page.evaluate(() => {   // the focus refresh (older than REFRESH_ON_FOCUS_MS)
      const real = Date.now; Date.now = () => real() + 120000;
      document.dispatchEvent(new Event('visibilitychange'));
      setTimeout(() => { Date.now = real; }, 50);
    });
    await listed;
    await sleep(500);
    assert.deepEqual(await visible(page), before);
    assert.equal(await page.evaluate(() => window.__cards.every((c) => c.isConnected && !c.hidden)), true, 'same elements, still shown');
    assert.match(await search(page), /firma=gayrimenkul/);
  });

  await check('K', 'a filter without matches: empty state + "«X» için fikir ekle" + clear', async () => {
    const empty = await call('POST', '/api/inspire/tags', { name: 'Boş Firma' }, OT);
    assert.equal(empty.status, 201);
    await page.goto(boardUrl('&firma=bos-firma'), { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => /eşleşen fikir yok/.test(document.querySelector('#board-status').textContent), { timeout: 15000 });
    const btns = await page.$$eval('#board-status button', (bs) => bs.map((b) => b.textContent));
    assert.deepEqual(btns, ['Filtreyi temizle', '«Boş Firma» için fikir ekle']);
    await shot(page, 'K-empty.png');
    await page.click('#board-status [data-status-act="add"]');
    await page.waitForSelector('#add-modal:not([hidden])');
    await sleep(120);   // openModal focuses its first field after 30 ms
    const pre = await page.$$eval('#add-firms .picker .tag-chip', (cs) => cs.map((c) => c.textContent.replace('×', '').trim()));
    assert.deepEqual(pre, ['Boş Firma']);
    await page.keyboard.press('Escape');
    await page.click('#board-status [data-status-act="clear"]');
    assert.equal((await visible(page)).length, 8);
  });

  await check('H', '390 px: the chip row scrolls sideways, the page does not', async () => {
    const mctx = await browser.createBrowserContext();
    const m = await mctx.newPage();
    await prepare(m, 'mobile');
    await m.emulate({ viewport: { width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
      userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1' });
    await loginGuest(m, 'Mobil');
    await m.waitForSelector(card(ids.px));
    const r = await m.evaluate(() => {
      const w = document.querySelector('#firm-chips');
      return { page: document.documentElement.scrollWidth, inner: window.innerWidth, rowScroll: w.scrollWidth, rowW: w.clientWidth };
    });
    assert.ok(r.page <= r.inner, JSON.stringify(r));
    assert.ok(r.rowScroll > r.rowW, 'the chip row overflows and scrolls: ' + JSON.stringify(r));
    await m.evaluate(() => { document.querySelector('#firm-chips').scrollLeft = 200; });
    assert.ok(await m.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
    await m.click('#btn-add');
    await m.waitForSelector('#add-modal:not([hidden])');
    await m.click('#tab-text');
    await m.click('#add-firms input[role="combobox"]');
    await sleep(300);
    assert.ok(await m.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), 'add dialog with the picker open');
    await m.screenshot({ path: path.join(SHOTS, 'H-mobile-add.png') });
    await m.keyboard.press('Escape'); await m.keyboard.press('Escape');
    await m.evaluate(() => window.scrollTo(0, 0));
    await m.screenshot({ path: path.join(SHOTS, 'H-mobile.png') });
    await mctx.close();
    return JSON.stringify(r);
  });

  await check('F', 'admin: rename (chips + URL slug), recolor, rename onto another name merges, delete keeps ideas', async () => {
    const ctx = await browser.createBrowserContext();
    const a = await ctx.newPage();
    await a.setViewport({ width: 1360, height: 1000, deviceScaleFactor: 1 });
    await prepare(a, 'admin');
    await a.goto(boardUrl('&firma=beta-yapi'), { waitUntil: 'domcontentloaded' });
    await a.waitForSelector('#entry-screen:not([hidden])');
    await a.click('#admin-toggle');
    await a.type('#admin-user', 'vkesgin38');
    await a.type('#admin-pass', ADMIN_PW);
    await a.click('#admin-btn');
    await a.waitForSelector('#firm-manage:not([hidden])', { timeout: 20000 });
    await a.waitForFunction((s) => !document.querySelector(s).hidden, {}, card(ids.p2));
    assert.deepEqual(await visible(a), sorted(ids.p2, ids.p3));
    // every card of the admin may be tagged: ✎ on another guest's card
    assert.ok(await a.$(`${card(ids.p2)} .tag-edit`));
    await a.click('#firm-manage');
    await a.waitForSelector('#firms-modal:not([hidden])');
    await shot(a, 'F-manage.png');
    const row = (id) => `#firms-list [data-firm="${id}"]`;
    // rename
    await a.click(`${row(beta.id)} .firm-name-input`, { clickCount: 3 });
    await a.keyboard.type('Beta İnşaat');
    await a.keyboard.press('Enter');
    await a.waitForFunction(() => /firma=beta-insaat/.test(location.search), { timeout: 10000 });
    const chip = await a.$eval(`${card(ids.p2)} .post-tags .tag-chip`, (c) => c.textContent);
    assert.equal(chip, 'Beta İnşaat');
    // recolor
    await a.click(`${row(beta.id)} [data-firm-act="colors"]`);
    await a.click(`${row(beta.id)} [data-firm-color="orange"]`);
    await a.waitForFunction((s) => document.querySelector(s).dataset.c === 'orange', { timeout: 10000 }, `${card(ids.p2)} .post-tags .tag-chip`);
    // rename onto an existing name -> merge
    await a.click(`${row(ids.sayin)} .firm-name-input`, { clickCount: 3 });
    await a.keyboard.type('GAYRİMENKUL');
    await a.keyboard.press('Enter');
    await a.waitForSelector('#confirm-modal:not([hidden])');
    assert.match(await a.$eval('#confirm-text', (e) => e.textContent), /«Gayrimenkul» zaten var/);
    await a.click('#confirm-ok');
    await a.waitForFunction((id) => !document.querySelector(`#firms-list [data-firm="${id}"]`), { timeout: 10000 }, ids.sayin);
    // delete
    await a.click(`${row(beta.id)} [data-firm-act="delete"]`);
    await a.waitForSelector('#confirm-modal:not([hidden])');
    assert.match(await a.$eval('#confirm-text', (e) => e.textContent), /Beta İnşaat.*fikirden bu etiket kaldırılır; fikirler silinmez/);
    await a.click('#confirm-ok');
    await a.waitForFunction((id) => !document.querySelector(`#firms-list [data-firm="${id}"]`), { timeout: 10000 }, beta.id);
    await shot(a, 'F-after.png');
    await a.keyboard.press('Escape');
    await a.waitForFunction(() => !/firma=/.test(location.search), { timeout: 5000 });
    assert.equal(await a.$(`${card(ids.p2)} .post-tags .tag-chip`), null, 'chips gone');
    assert.ok(await a.$(card(ids.p2)), 'the idea stays');
    const chips = await chipCounts(a);
    assert.ok(!('Beta İnşaat' in chips) && !('Sayın' in chips), JSON.stringify(chips));
    const list = await call('GET', '/api/inspire/posts', null, OT);
    assert.ok(list.data.some((p) => p.id === ids.p2 && p.tags.length === 0));
    await ctx.close();
    return JSON.stringify(chips);
  });
} catch (e) {
  results.push({ id: 'setup', ok: false });
  console.log('not ok setup — ' + String(e && e.stack || e).slice(0, 2000));
} finally {
  try { if (browser) await browser.close(); } catch (_) {}
  try { web.close(); } catch (_) {}
}
if (consoleErrors.length) console.log('# console errors:\n' + consoleErrors.slice(0, 30).join('\n'));
if (pageErrors.length) { console.log('# page errors:\n' + pageErrors.join('\n')); results.push({ id: 'pageerrors', ok: false }); }
const failed = results.filter((r) => !r.ok);
console.log(`# ${results.length - failed.length}/${results.length} passed; screenshots: ${SHOTS}`);
process.exit(failed.length ? 1 : 0);
