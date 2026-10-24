// tags-smoke.mjs: acceptance smoke of the company tags ("Firma") on the board (fikir.html) in headless Chrome against a local
// `wrangler dev` (worker/wrangler.toml as it is) + tests/media-e2e/fixture-server.mjs as Instagram.
// usage: TAGS_E2E_PUPPETEER=<dir with node_modules/puppeteer-core> tests/tags-e2e/run-smoke.sh
// Seeds (another guest, through the API): "Sayın", "Beta Yapı" and text ideas tagged Sayın / Beta Yapı / both / none.
// Expected sets and counts are always computed from GET /api/inspire/posts, never from the board itself.
// Checks (one result line each; every check runs; exit 1 when one failed; page errors fail the run):
//   A  "Yeni Fikir Ekle": the existing "Sayın" picked by typing + "Gayrimenkul" created inline ("+ Yeni firma: «…»"); the card
//      shows both chips; a reload keeps them
//   B  Turkish-insensitive dedupe: POST /tags "SAYIN" / "sayın " / "SAYİN" answer the existing "Sayın" (200, created:false);
//      the picker offers no "+ Yeni firma" for them; "sayın " typed and sent as is tags the post with "Sayın" without
//      POST /tags; a stale catalog's "+ Yeni firma: «ÇAĞ LOJİSTİK»" selects the existing "Çağ Lojistik"; one "sayin" in the catalog
//   C  filter bar: counts = the API's; Sayın -> only Sayın; + Gayrimenkul "Herhangi biri" -> union; "Hepsi" -> intersection;
//      URL ?firma=…&eslesme=hepsi and a fresh context loading that URL restores it; "Firmasız" -> untagged only; "Tümü"
//      clears; a filter without matches shows "Bu filtreyle eşleşen fikir yok."; after every step the columns re-flow (no
//      empty column while another has 2+, the first visible card at the top of its column) and the page has no horizontal scroll
//   D  the owner edits a card's companies (✎ -> #tag-modal): chips, bar counts and the filter result follow without a reload;
//      no ✎ / "Firma ekle" on someone else's card; another guest (UI: no edit control) and the owner on someone else's card
//      (API) get 403 from PUT /posts/:id/tags
//   F  existing features: an Instagram reel added with a company plays in the board's own player (live) with its chip and
//      the "İndir" button; a storyboard text idea gets its company at creation and again through ✎ (storyboard card kept)
//   E  admin "Firmaları yönet": rename (card chips, bar, summary, URL slug; another session after a reload), recolor (cards +
//      bar), delete: "Vazgeç" keeps it, "Sil" removes the chips everywhere and keeps the ideas
//   G  390 px (mobile emulation): the filter bar, the picker and a card with chips, without horizontal page scroll
//   H  picker: one human-speed click (press, hold, release) on "Kaydet" / "Paylaş" while the list is open; Enter in the empty
//      field with the list open picks the highlighted first option and sends nothing; a half-typed listed name ("say") is
//      never created and the form is not sent; "Paylaş" while "+ Yeni firma" is still on its way waits and sends with it;
//      a GET /tags answered before that company existed (held, then delivered) does not drop it; hover = active option;
//      focus returns to the card's ✎ after a save
//   J  filter state: "Hepsi" never stays on hidden (Tümü, then one company + Firmasız = union); a pressed Firmasız has ✓;
//      the owner's edit that takes a card out of the filter re-flows the columns; after a rename this browser's own URL
//      (old slug) restores the filter from its saved ids, someone else's old link is dropped
//   K  a link with a file added outside the filter whose upload fails (500, intercepted): the error toast says so and has
//      "Filtreyi temizle"
//   I  overflow (more than MAX_PAGES; GET /posts answered by synthetic pages of 5): the filter's older matches are asked
//      from below the oldest loaded id, also when the catalog arrives after the first fill
//   L  390 px: only the chip row is sticky (the match toggle, "Firmaları yönet" and the summary scroll away); the admin's
//      manage dialog and "Kullanılmayanları sil"
// Screenshots: TAGS_E2E_SHOTS. Console errors are printed; page errors (and any native dialog) fail the run.
// env: TAGS_E2E_WEBPORT (4761), TAGS_E2E_FX, TAGS_E2E_SHOTS, TAGS_E2E_PUPPETEER (or VIDEO_E2E_PUPPETEER), FIKIR_E2E_BOARD_PASSWORD,
//      TAGS_E2E_ADMIN_PASSWORD (TEST values; run-smoke.sh passes the same with --var). Never reads worker/.dev.vars.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const BASE = process.argv[2] || 'http://127.0.0.1:8861';
const FXB = process.env.TAGS_E2E_FX || 'http://127.0.0.1:4762';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const R = path.join(HERE, '../..');
const WEBPORT = Number(process.env.TAGS_E2E_WEBPORT || 4761);
const SHOTS = process.env.TAGS_E2E_SHOTS || path.join(process.env.TMPDIR || '/tmp', 'fikir-tags-e2e/shots');
const PPT = process.env.TAGS_E2E_PUPPETEER || process.env.VIDEO_E2E_PUPPETEER;
const BOARD_PW = process.env.FIKIR_E2E_BOARD_PASSWORD || 'test-board-pass';
const ADMIN_PW = process.env.TAGS_E2E_ADMIN_PASSWORD || 'tags-e2e-admin';
const CHROME = process.env.TAGS_E2E_CHROME || process.env.VIDEO_E2E_CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
if (!/^http:\/\/127\.0\.0\.1:\d+$/.test(BASE) || !/^http:\/\/127\.0\.0\.1:\d+$/.test(FXB)) throw new Error('local worker + fixture server only');
if (WEBPORT === 8765 || /:8765$/.test(BASE) || /:8765$/.test(FXB)) throw new Error('never 8765');
if (!PPT || !fs.existsSync(path.join(PPT, 'node_modules/puppeteer-core'))) throw new Error('TAGS_E2E_PUPPETEER: a folder with node_modules/puppeteer-core');
const puppeteer = createRequire(path.join(PPT, 'noop.js'))('puppeteer-core');
fs.mkdirSync(SHOTS, { recursive: true });
const WEB = `http://127.0.0.1:${WEBPORT}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const newCid = () => 't' + Math.random().toString(36).slice(2) + Date.now().toString(36) + 'xxxxxxxx';
const sorted = (a) => [...a].map(Number).sort((x, y) => x - y);

const results = [];
async function check(id, name, fn) {
  const t0 = Date.now();
  try {
    const detail = await fn();
    results.push({ id, ok: true });
    console.log(`ok ${id} ${name}${detail ? ' — ' + detail : ''} (${Date.now() - t0} ms)`);
  } catch (e) {
    results.push({ id, ok: false });
    console.log(`not ok ${id} ${name} — ${String(e && e.stack || e).slice(0, 2500)}`);
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

// ── static server for the board page (repo fikir.html + /assets) ──
const TYPES = { '.html': 'text/html; charset=utf-8', '.mjs': 'text/javascript', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.ico': 'image/x-icon', '.json': 'application/json', '.woff2': 'font/woff2' };
const web = http.createServer((req, res) => {
  let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (p === '/' || p === '/fikir' || p === '/fikir/') p = '/fikir.html';
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
  // ── seeds: another guest's companies + text ideas ──
  const other = await call('POST', '/api/inspire/guest', { cid: newCid(), name: 'Diğer', password: BOARD_PW });
  assert.equal(other.status, 200, JSON.stringify(other.data));
  const OT = other.data.token;
  const mkTag = async (name, color) => { const r = await call('POST', '/api/inspire/tags', { name, ...(color ? { color } : {}) }, OT); assert.equal(r.status, 201, JSON.stringify(r.data)); return r.data.tag; };
  const mkPost = async (text, tags = []) => { const r = await call('POST', '/api/inspire/posts', { type: 'text', text, tag_ids: tags.map((t) => t.id) }, OT); assert.equal(r.status, 201, JSON.stringify(r.data)); return r.data.id; };
  const T = {};
  T.sayin = await mkTag('Sayın', 'amber');
  T.beta = await mkTag('Beta Yapı', 'violet');
  const ids = {};
  ids.s1 = await mkPost('Sayın için vitrin fikri', [T.sayin]);
  ids.s2 = await mkPost('Sayın için ikinci fikir', [T.sayin]);
  ids.b1 = await mkPost('Beta Yapı fikri', [T.beta]);
  ids.sb = await mkPost('Sayın ve Beta ortak fikir', [T.sayin, T.beta]);
  ids.u1 = await mkPost('Firmasız fikir bir');
  ids.u2 = await mkPost('Firmasız fikir iki');
  console.log('# seeded tags ' + JSON.stringify({ sayin: T.sayin.id, beta: T.beta.id }) + ' posts ' + JSON.stringify(ids));

  // the API's truth: every post with its tag ids
  const apiPosts = async () => {
    const r = await call('GET', '/api/inspire/posts', null, OT);
    assert.equal(r.status, 200);
    return r.data.map((p) => ({ id: Number(p.id), tags: (p.tags || []).map((t) => t.id), names: (p.tags || []).map((t) => t.name) }));
  };
  const expectIds = (list, { ids: f = [], all = false, untagged = false }) => sorted(list.filter((p) => {
    if (!f.length && !untagged) return true;
    if (untagged && !p.tags.length) return true;
    if (!f.length) return false;
    return all ? f.every((id) => p.tags.includes(id)) : f.some((id) => p.tags.includes(id));
  }).map((p) => p.id));
  const expectCounts = (list, catalog) => {
    const out = { 'Tümü': list.length };
    for (const t of catalog) { const n = list.filter((p) => p.tags.includes(t.id)).length; if (n) out[t.name] = n; }
    const u = list.filter((p) => !p.tags.length).length;
    if (u) out['Firmasız'] = u;
    return out;
  };
  const catalog = async () => (await call('GET', '/api/inspire/tags', null, OT)).data.tags;

  browser = await puppeteer.launch({ executablePath: CHROME, headless: true,
    args: ['--no-first-run', '--no-default-browser-check', '--lang=tr-TR', '--autoplay-policy=no-user-gesture-required',
      '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1'] });
  const prepare = (page, label) => {
    page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(`[${label}] ${m.text().slice(0, 300)}`); });
    page.on('pageerror', (e) => pageErrors.push(`[${label}] ${String(e && e.message || e).slice(0, 300)}`));
    page.on('dialog', (d) => { pageErrors.push(`[${label}] native dialog: ${d.message()}`); d.dismiss().catch(() => {}); });
  };
  const boardUrl = (q = '') => `${WEB}/fikir.html?api=${encodeURIComponent(BASE)}${q}`;
  async function loginGuest(page, name, url = boardUrl()) {
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('#entry-screen:not([hidden])', { timeout: 20000 });
    await page.type('#guest-name', name);
    await page.type('#guest-pass', BOARD_PW);
    await page.click('#guest-btn');
    await page.waitForSelector('#dashboard:not([hidden])', { timeout: 20000 });
    await page.waitForSelector('#firm-bar:not([hidden])', { timeout: 20000 });
  }
  const card = (id) => `.post-card[data-id="${id}"]`;
  const visible = (page) => page.evaluate(() => [...document.querySelectorAll('.post-card')].filter((c) => !c.hidden).map((c) => Number(c.dataset.id)).sort((a, b) => a - b));
  const chipCounts = (page) => page.evaluate(() => Object.fromEntries([...document.querySelectorAll('#firm-chips .firm-chip')]
    .map((b) => [b.querySelector('.tc-name').textContent, Number((b.querySelector('.n') || {}).textContent)])));
  const clickChip = (page, name) => page.evaluate((n) => {
    const b = [...document.querySelectorAll('#firm-chips .firm-chip')].find((x) => x.querySelector('.tc-name').textContent === n);
    if (!b) throw new Error('no bar chip ' + n + ' in ' + [...document.querySelectorAll('#firm-chips .tc-name')].map((x) => x.textContent).join('|'));
    b.click();
  }, name);
  const pressed = (page) => page.evaluate(() => [...document.querySelectorAll('#firm-chips .firm-chip[aria-pressed="true"]')].map((b) => b.querySelector('.tc-name').textContent).sort());
  const search = (page) => page.evaluate(() => decodeURIComponent(location.search));
  const summary = (page) => page.$eval('#firm-summary', (e) => (e.hidden ? '' : e.textContent));
  const cardChips = (page, id) => page.$$eval(`${card(id)} .post-tags .tag-chip:not(.more)`, (cs) => cs.map((c) => c.textContent));
  const pickerChips = (page, root) => page.$$eval(`${root} .picker .tag-chip`, (cs) => cs.map((c) => c.querySelector('.tc-name').textContent));
  const options = (page, root) => page.$$eval(`${root} .picker-list li`, (ls) => ls.map((l) => l.textContent.trim()));
  const waitToast = (page, re) => page.waitForFunction((src) => [...document.querySelectorAll('#toasts .toast')].some((t) => new RegExp(src).test(t.textContent)), { timeout: 10000 }, re.source);
  const shot = (page, name) => page.screenshot({ path: path.join(SHOTS, name) });
  const noHScroll = (page) => page.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: window.innerWidth, bw: document.body.scrollWidth }));
  // columns re-flowed: no empty column while another holds 2+ visible cards; each column's first visible card on top
  async function layoutOk(page, label) {
    const r = await page.evaluate(() => {
      const cols = [...document.querySelectorAll('#board .board-col')];
      const per = cols.map((c) => [...c.querySelectorAll(':scope > .post-card')].filter((x) => !x.hidden));
      const tops = per.filter((l) => l.length).map((l, i) => Math.round(l[0].getBoundingClientRect().top - l[0].parentElement.getBoundingClientRect().top));
      const outside = [...document.querySelectorAll('.post-card')].filter((x) => !x.hidden && !x.closest('.board-col')).length;
      return { n: cols.length, counts: per.map((l) => l.length), tops, outside, sw: document.documentElement.scrollWidth, iw: window.innerWidth };
    });
    assert.ok(r.sw <= r.iw, `${label}: no horizontal scroll ${JSON.stringify(r)}`);
    assert.equal(r.outside, 0, `${label}: every visible card in a column`);
    const min = Math.min(...r.counts), max = Math.max(...r.counts);
    assert.ok(!(min === 0 && max > 1), `${label}: balanced columns ${JSON.stringify(r.counts)}`);
    assert.ok(r.tops.every((t) => Math.abs(t) <= 2), `${label}: first visible card at the top of its column ${JSON.stringify(r.tops)}`);
    return r.counts.join('/');
  }
  const inp = (root) => `${root} input[role="combobox"]`;
  async function openAdd(page, tab) {
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.click('#btn-add');
    await waitModal(page, '#add-modal');
    await page.click(tab === 'text' ? '#tab-text' : '#tab-link');
    await page.waitForSelector('#add-firms:not([hidden])');
  }
  const setStoryboard = (page, on) => page.evaluate((v) => { const e = document.querySelector('#sb-enable'); if (e && !e.disabled && e.checked !== v) e.click(); }, on);
  // a dialog slides 20 px for 0.25 s when it opens: clicks wait until it stands still
  const waitModal = async (page, sel) => { await page.waitForSelector(`${sel}.active:not([hidden])`); await sleep(320); };
  async function typePick(page, root, query, name) {
    await page.focus(inp(root));
    await page.type(inp(root), query);
    await page.waitForFunction((r, n) => { const li = document.querySelector(`${r} .picker-list li[aria-selected="true"]`); return li && li.querySelector('.tc-name') && li.querySelector('.tc-name').textContent === n; },
      { timeout: 5000 }, root, name).catch(async (e) => {
      const st = await page.evaluate((r) => ({ value: document.querySelector(`${r} input[role="combobox"]`).value, active: document.activeElement && (document.activeElement.id || document.activeElement.className),
        opts: [...document.querySelectorAll(`${r} .picker-list li`)].map((l) => `${l.getAttribute('aria-selected')}:${l.textContent}`), listHidden: document.querySelector(`${r} .picker-list`).hidden,
        chips: [...document.querySelectorAll(`${r} .picker .tag-chip`)].map((c) => c.textContent) }), root);
      await shot(page, `fail-picker-${root.slice(1)}-${query}.png`);
      throw new Error(`picker ${root} "${query}" -> ${name}: ${JSON.stringify(st)} (${e.message})`);
    });
    await page.keyboard.press('Enter');
    await page.waitForFunction((r, n) => [...document.querySelectorAll(`${r} .picker .tag-chip .tc-name`)].some((c) => c.textContent === n), { timeout: 5000 }, root, name);
  }
  const postCreated = (page) => page.waitForResponse((r) => r.url() === BASE + '/api/inspire/posts' && r.request().method() === 'POST', { timeout: 30000 });

  const page = await browser.newPage();
  await page.setViewport({ width: 1360, height: 1000, deviceScaleFactor: 1 });
  prepare(page, 'owner');
  const tagPosts = [];   // POST /api/inspire/tags requests of the owner page
  page.on('request', (r) => { if (r.url() === BASE + '/api/inspire/tags' && r.method() === 'POST') tagPosts.push(r.postData()); });
  await loginGuest(page, 'Firma Sahibi');
  await page.waitForSelector(card(ids.u2));
  await shot(page, '00-board.png');

  await check('A', 'add an idea with "Sayın" (existing) + "Gayrimenkul" (created inline); the card shows both chips; a reload keeps them', async () => {
    await openAdd(page, 'text');
    await setStoryboard(page, false);
    await page.type('#text-body', 'Sayın ve Gayrimenkul için ortak vitrin fikri');
    await typePick(page, '#add-firms', 'say', 'Sayın');
    await page.type(inp('#add-firms'), 'Gayrimenkul');
    await page.waitForSelector('#add-firms .picker-list li.opt-new');
    const opts = await options(page, '#add-firms');
    assert.deepEqual(opts, ['+ Yeni firma: «Gayrimenkul»'], 'only the create option: ' + JSON.stringify(opts));
    const n0 = tagPosts.length;
    await page.click('#add-firms .picker-list li.opt-new');
    await page.waitForFunction(() => /«Gayrimenkul» eklendi\./.test(document.querySelector('#add-firms .picker-note').textContent), { timeout: 10000 });
    assert.deepEqual(await pickerChips(page, '#add-firms'), ['Sayın', 'Gayrimenkul']);
    assert.equal(tagPosts.length, n0 + 1, 'one POST /tags');
    await shot(page, 'A1-picker-two-companies.png');
    const created = postCreated(page);
    await page.click('#text-submit');
    const post = await (await created).json();
    ids.a = post.id;
    assert.deepEqual(post.tags.map((t) => t.name), ['Gayrimenkul', 'Sayın'], 'saved tags');
    T.gay = post.tags.find((t) => t.name === 'Gayrimenkul');
    assert.equal(post.tags.find((t) => t.name === 'Sayın').id, T.sayin.id, 'the existing Sayın, not a new one');
    await page.waitForSelector(`${card(ids.a)} .post-tags .tag-chip`);
    assert.deepEqual(await cardChips(page, ids.a), ['Gayrimenkul', 'Sayın']);
    await page.$eval(card(ids.a), (c) => c.scrollIntoView({ block: 'center' }));
    await shot(page, 'A2-card-two-chips.png');
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForSelector(`${card(ids.a)} .post-tags .tag-chip`, { timeout: 20000 });
    assert.deepEqual(await cardChips(page, ids.a), ['Gayrimenkul', 'Sayın'], 'after reload');
    const api = (await apiPosts()).find((p) => p.id === ids.a);
    assert.deepEqual(api.names, ['Gayrimenkul', 'Sayın'], 'API');
    return `post ${ids.a}, Gayrimenkul id ${T.gay.id}`;
  });

  await check('B', 'Turkish-insensitive dedupe: "SAYIN" / "sayın " / "SAYİN" reuse "Sayın" (API + picker + send-as-typed + stale catalog)', async () => {
    const before = await catalog();
    for (const name of ['SAYIN', 'sayın ', 'SAYİN', '  Sayin']) {
      const r = await call('POST', '/api/inspire/tags', { name }, OT);
      assert.equal(r.status, 200, `${JSON.stringify(name)}: ${JSON.stringify(r.data)}`);
      assert.deepEqual([r.data.created, r.data.tag.id, r.data.tag.name], [false, T.sayin.id, 'Sayın'], JSON.stringify(name));
    }
    await openAdd(page, 'text');
    await setStoryboard(page, false);
    await page.type('#text-body', 'Büyük harfle yazılmış Sayın fikri');
    for (const q of ['SAYIN', 'sayın ']) {
      await page.click(inp('#add-firms'));
      await page.$eval(inp('#add-firms'), (el) => { el.value = ''; });
      await page.type(inp('#add-firms'), q);
      await sleep(150);
      const opts = await options(page, '#add-firms');
      assert.ok(!opts.some((o) => /Yeni firma/.test(o)), `${JSON.stringify(q)}: no create option ${JSON.stringify(opts)}`);
      assert.match(opts[0] || '', /^Sayın/, `${JSON.stringify(q)}: the existing Sayın first ${JSON.stringify(opts)}`);
    }
    await shot(page, 'B1-picker-SAYIN-no-duplicate.png');
    // "sayın " left typed, not picked: "Paylaş" selects the existing company (no POST /tags)
    const n0 = tagPosts.length;
    const created = postCreated(page);
    await page.click('#text-submit');
    const post = await (await created).json();
    ids.b = post.id;
    assert.deepEqual(post.tags.map((t) => [t.id, t.name]), [[T.sayin.id, 'Sayın']]);
    assert.equal(tagPosts.length, n0, 'no POST /tags for a name that exists');
    await page.waitForSelector(`${card(ids.b)} .post-tags .tag-chip`);
    assert.deepEqual(await cardChips(page, ids.b), ['Sayın']);
    // a company created elsewhere after this page loaded its catalog: the stale picker offers "+ Yeni firma", the server
    // answers the existing one and the picker selects it ("zaten vardı, seçildi")
    const cag = await mkTag('Çağ Lojistik', 'teal');
    await openAdd(page, 'text');
    await page.click(inp('#add-firms'));
    await page.type(inp('#add-firms'), 'ÇAĞ LOJİSTİK');
    await sleep(150);
    let path_ = 'catalog had it';
    if (await page.$('#add-firms .picker-list li.opt-new')) {
      path_ = 'stale catalog: server dedupe';
      await page.click('#add-firms .picker-list li.opt-new');
      await page.waitForFunction(() => /«Çağ Lojistik» zaten vardı, seçildi\./.test(document.querySelector('#add-firms .picker-note').textContent), { timeout: 10000 });
    } else {
      await page.keyboard.press('Enter');
    }
    assert.deepEqual(await pickerChips(page, '#add-firms'), ['Çağ Lojistik']);
    await shot(page, 'B2-picker-existing-reused.png');
    await page.keyboard.press('Escape'); await page.keyboard.press('Escape');
    await page.waitForSelector('#add-modal', { hidden: true });
    const after = await catalog();
    assert.equal(after.filter((t) => t.slug.startsWith('sayin')).length, 1, 'one Sayın: ' + JSON.stringify(after.map((t) => t.name)));
    assert.equal(after.filter((t) => /^cag-lojistik/.test(t.slug)).length, 1);
    assert.equal(after.length, before.length + 1, 'only Çağ Lojistik was added');
    T.cag = cag;
    return path_;
  });

  await check('C', 'filter bar: counts, single, "Herhangi biri" union, "Hepsi" intersection, URL + fresh load, "Firmasız", "Tümü", empty state, re-flow', async () => {
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForSelector(card(ids.b));
    await page.waitForSelector('#firm-bar:not([hidden])');
    const list = await apiPosts();
    const cat = await catalog();
    const want = expectCounts(list, cat);
    await page.waitForFunction((n) => document.querySelectorAll('#firm-chips .firm-chip').length === n, { timeout: 10000 }, Object.keys(want).length);
    assert.deepEqual(await chipCounts(page), want, 'bar counts = API');
    assert.ok(!('Çağ Lojistik' in (await chipCounts(page))), 'a company without ideas is not on the bar');
    const steps = [];
    // one company
    await clickChip(page, 'Sayın');
    assert.deepEqual(await visible(page), expectIds(list, { ids: [T.sayin.id] }), 'Sayın only');
    assert.equal(await search(page).then((s) => /[?&]firma=sayin(&|$)/.test(s) && !/eslesme/.test(s)), true, await search(page));
    assert.match(await summary(page), new RegExp(`^${expectIds(list, { ids: [T.sayin.id] }).length} fikir · Sayın`));
    assert.equal(await page.$eval('#firm-match', (e) => e.hidden), true, 'no match mode with one company');
    steps.push('sayin ' + await layoutOk(page, 'Sayın'));
    await shot(page, 'C1-filter-sayin.png');
    // + Gayrimenkul, "Herhangi biri" (default)
    await clickChip(page, 'Gayrimenkul');
    assert.deepEqual(await pressed(page), ['Gayrimenkul', 'Sayın']);
    assert.equal(await page.$eval('#firm-match', (e) => e.hidden), false, 'match mode with two companies');
    assert.equal(await page.$eval('#firm-match [data-match="any"]', (e) => e.getAttribute('aria-checked')), 'true', 'Herhangi biri by default');
    assert.deepEqual(await visible(page), expectIds(list, { ids: [T.sayin.id, T.gay.id] }), 'union');
    steps.push('any ' + await layoutOk(page, 'any'));
    await shot(page, 'C2-filter-any.png');
    // "Hepsi"
    await page.click('#firm-match [data-match="all"]');
    const inter = expectIds(list, { ids: [T.sayin.id, T.gay.id], all: true });
    assert.deepEqual(await visible(page), inter, 'intersection');
    assert.ok(inter.length >= 1 && inter.length < expectIds(list, { ids: [T.sayin.id, T.gay.id] }).length);
    const q = await search(page);
    assert.match(q, /[?&]firma=(sayin,gayrimenkul|gayrimenkul,sayin)&eslesme=hepsi/, q);
    assert.match(q, /[?&]api=/, '?api= kept');
    assert.match(await summary(page), /Sayın \+ Gayrimenkul \(hepsi\)|Gayrimenkul \+ Sayın \(hepsi\)/);
    steps.push('all ' + await layoutOk(page, 'all'));
    await shot(page, 'C3-filter-hepsi.png');
    // a fresh context (no localStorage) loading that URL gets the same filter
    const href = await page.evaluate(() => location.href);
    const ctx = await browser.createBrowserContext();
    const f = await ctx.newPage();
    await f.setViewport({ width: 1360, height: 1000, deviceScaleFactor: 1 });
    prepare(f, 'fresh-url');
    await loginGuest(f, 'Bağlantıdan Gelen', href);
    await f.waitForSelector(card(inter[0]));
    await f.waitForFunction(() => document.querySelectorAll('#firm-chips .firm-chip[aria-pressed="true"]').length === 2, { timeout: 10000 });
    assert.deepEqual(await pressed(f), ['Gayrimenkul', 'Sayın'], 'restored chips');
    assert.equal(await f.$eval('#firm-match [data-match="all"]', (e) => e.getAttribute('aria-checked')), 'true', 'restored Hepsi');
    assert.deepEqual(await visible(f), inter, 'restored intersection');
    assert.match(await search(f), /eslesme=hepsi/);
    await shot(f, 'C4-fresh-load-of-url.png');
    await ctx.close();
    // "Tümü" clears
    await clickChip(page, 'Tümü');
    assert.equal((await visible(page)).length, list.length, 'Tümü: all');
    assert.ok(!/firma=|eslesme=/.test(await search(page)), 'URL cleared');
    assert.equal(await summary(page), '');
    assert.deepEqual(await pressed(page), ['Tümü']);
    steps.push('all-cleared ' + await layoutOk(page, 'Tümü'));
    // "Firmasız"
    await clickChip(page, 'Firmasız');
    assert.deepEqual(await visible(page), expectIds(list, { untagged: true }), 'untagged only');
    assert.match(await search(page), /firma=firmasiz/);
    steps.push('none ' + await layoutOk(page, 'Firmasız'));
    await shot(page, 'C5-filter-firmasiz.png');
    await clickChip(page, 'Tümü');
    // no matches: Gayrimenkul + Beta Yapı, "Hepsi"
    await clickChip(page, 'Gayrimenkul');
    await clickChip(page, 'Beta Yapı');
    await page.click('#firm-match [data-match="all"]');
    assert.deepEqual(expectIds(list, { ids: [T.gay.id, T.beta.id], all: true }), [], 'the seeds have no Gayrimenkul + Beta idea');
    await page.waitForFunction(() => { const s = document.querySelector('#board-status'); return !s.hidden && /Bu filtreyle eşleşen fikir yok\./.test(s.textContent); }, { timeout: 5000 });
    assert.deepEqual(await visible(page), []);
    assert.deepEqual(await page.$$eval('#board-status button', (bs) => bs.map((b) => b.textContent)), ['Filtreyi temizle']);
    assert.match(await summary(page), /^0 fikir/);
    assert.ok((await noHScroll(page)).sw <= 1360);
    await shot(page, 'C6-empty-state.png');
    await page.click('#board-status [data-status-act="clear"]');
    assert.equal((await visible(page)).length, list.length, 'cleared from the empty state');
    assert.equal(await page.$eval('#board-status', (e) => e.hidden), true);
    // leave "Herhangi biri" for the next checks
    await clickChip(page, 'Gayrimenkul'); await clickChip(page, 'Sayın');
    await page.click('#firm-match [data-match="any"]');
    await clickChip(page, 'Tümü');
    return JSON.stringify(want) + '; columns ' + steps.join(', ');
  });

  await check('D', 'owner edits a card (✎ -> #tag-modal): chips + counts + filter follow without reload; non-owners get no control and 403', async () => {
    await clickChip(page, 'Sayın');
    assert.ok((await visible(page)).includes(ids.a));
    await page.evaluate(() => { window.__noReload = 1; });
    await page.click(`${card(ids.a)} .tag-edit`);
    await waitModal(page, '#tag-modal');
    assert.deepEqual(await pickerChips(page, '#tag-picker'), ['Gayrimenkul', 'Sayın'], 'the card\'s companies');
    await page.evaluate(() => [...document.querySelectorAll('#tag-picker .picker .tag-chip')].find((c) => c.textContent.includes('Sayın')).querySelector('.x').click());
    await typePick(page, '#tag-picker', 'beta', 'Beta Yapı');
    assert.deepEqual(await pickerChips(page, '#tag-picker'), ['Gayrimenkul', 'Beta Yapı']);
    await shot(page, 'D1-tag-modal.png');
    const saved = page.waitForResponse((r) => r.url() === `${BASE}/api/inspire/posts/${ids.a}/tags` && r.request().method() === 'PUT');
    await page.click('#tag-save');
    assert.equal((await saved).status(), 200);
    await waitToast(page, /artık görünmüyor/);
    assert.equal(await page.$eval('#tag-modal', (m) => m.hidden), true, 'modal closed');
    assert.equal(await page.$eval(card(ids.a), (c) => c.hidden), true, 'the card left the Sayın filter at once');
    const list = await apiPosts();
    assert.deepEqual(list.find((p) => p.id === ids.a).names, ['Beta Yapı', 'Gayrimenkul'], 'API');
    assert.deepEqual(await visible(page), expectIds(list, { ids: [T.sayin.id] }), 'Sayın filter result');
    const want = expectCounts(list, await catalog());
    await page.waitForFunction((w) => {
      const got = Object.fromEntries([...document.querySelectorAll('#firm-chips .firm-chip')].map((b) => [b.querySelector('.tc-name').textContent, Number((b.querySelector('.n') || {}).textContent)]));
      return JSON.stringify(Object.keys(w).sort().map((k) => [k, got[k]])) === JSON.stringify(Object.keys(w).sort().map((k) => [k, w[k]]));
    }, { timeout: 10000 }, want).catch(async () => assert.deepEqual(await chipCounts(page), want, 'counts after the edit'));
    assert.match(await summary(page), new RegExp(`^${expectIds(list, { ids: [T.sayin.id] }).length} fikir · Sayın`), 'summary count');
    await shot(page, 'D2-after-edit-filtered.png');
    await clickChip(page, 'Sayın');   // off
    await clickChip(page, 'Beta Yapı');
    assert.deepEqual(await visible(page), expectIds(list, { ids: [T.beta.id] }), 'Beta Yapı filter now has the card');
    assert.ok((await visible(page)).includes(ids.a));
    assert.deepEqual(await cardChips(page, ids.a), ['Beta Yapı', 'Gayrimenkul'], 'card chips');
    assert.equal(await page.evaluate(() => window.__noReload), 1, 'no reload');
    await clickChip(page, 'Tümü');
    // someone else's card: no ✎, no "Firma ekle"
    for (const id of [ids.s1, ids.u1]) {
      assert.equal(await page.$(`${card(id)} .tag-edit`), null, `no ✎ on ${id}`);
      assert.equal(await page.$(`${card(id)} [data-action="tags-edit"]:not([hidden])`), null, `no Firma ekle on ${id}`);
    }
    // the owner's token on someone else's card: 403
    const ownerToken = await page.evaluate(() => localStorage.getItem('fikir_token'));
    assert.ok(ownerToken);
    const own403 = await call('PUT', `/api/inspire/posts/${ids.s1}/tags`, { tag_ids: [T.gay.id] }, ownerToken);
    assert.equal(own403.status, 403, JSON.stringify(own403.data));
    // another guest: no control on the owner's card in the UI, 403 from the API
    const ctx = await browser.createBrowserContext();
    const g = await ctx.newPage();
    await g.setViewport({ width: 1360, height: 1000, deviceScaleFactor: 1 });
    prepare(g, 'guest2');
    await loginGuest(g, 'İkinci Misafir');
    await g.waitForSelector(`${card(ids.a)} .post-tags .tag-chip`);
    assert.deepEqual(await cardChips(g, ids.a), ['Beta Yapı', 'Gayrimenkul'], 'the other guest sees the chips');
    assert.equal(await g.$(`${card(ids.a)} .tag-edit`), null, 'no ✎ for a non-owner');
    assert.equal(await g.$(`${card(ids.a)} [data-action="tags-edit"]:not([hidden])`), null, 'no Firma ekle for a non-owner');
    const gTok = await g.evaluate(() => localStorage.getItem('fikir_token'));
    const g403 = await call('PUT', `/api/inspire/posts/${ids.a}/tags`, { tag_ids: [] }, gTok);
    assert.equal(g403.status, 403, JSON.stringify(g403.data));
    assert.match(g403.data.error && g403.data.error.message || JSON.stringify(g403.data), /yetkin yok|yetki/i);
    await ctx.close();
    assert.deepEqual((await apiPosts()).find((p) => p.id === ids.a).names, ['Beta Yapı', 'Gayrimenkul'], 'unchanged by the 403s');
    // "Firma ekle" on the owner's own untagged card would be the entry point for untagged ideas: the owner has none yet
    return `PUT ${ids.a} 200; owner on ${ids.s1}: ${own403.status}; guest2 on ${ids.a}: ${g403.status}`;
  });

  await check('F', 'existing features: Instagram reel (live player + chip + İndir), storyboard text idea tagged at creation and via ✎', async () => {
    // Instagram reel through the dialog, with a company
    await openAdd(page, 'link');
    await page.type('#link-url', 'https://www.instagram.com/reel/DLiveTag01/');
    await page.waitForFunction(() => !document.querySelector('#link-submit').disabled, { timeout: 20000 });
    await typePick(page, '#add-firms', 'sayın', 'Sayın');
    await sleep(300);
    await shot(page, 'F1-add-reel-with-company.png');
    const created = postCreated(page);
    await page.click('#link-submit');
    const reel = await (await created).json();
    ids.reel = reel.id;
    assert.deepEqual(reel.tags.map((t) => t.name), ['Sayın']);
    assert.equal(reel.type, 'instagram');
    const vsel = `${card(ids.reel)} .media-igcopy video`;
    await page.waitForSelector(vsel, { timeout: 40000 });
    await page.$eval(card(ids.reel), (el) => el.scrollIntoView({ block: 'center' }));
    await page.waitForFunction((s) => { const v = document.querySelector(s); return v && v.readyState >= 2; }, { timeout: 30000 }, vsel);
    assert.ok((await page.$eval(vsel, (v) => v.currentSrc || v.src)).startsWith(`${BASE}/api/inspire/posts/${ids.reel}/play?part=video&t=`), 'our player, streamed through /play');
    assert.equal(await page.$(`${card(ids.reel)} iframe`), null, 'no Instagram iframe');
    assert.deepEqual(await cardChips(page, ids.reel), ['Sayın']);
    await page.waitForSelector(`${card(ids.reel)} .dl-btn:not([hidden])`, { timeout: 10000 });
    assert.match(await page.$eval(`${card(ids.reel)} .dl-btn`, (b) => b.textContent), /İndir/);
    await sleep(500);
    await shot(page, 'F2-reel-live-with-chip.png');
    // storyboard text idea with a company
    await openAdd(page, 'text');
    await page.waitForSelector('#sb-fields:not([hidden])', { timeout: 10000 });
    await setStoryboard(page, true);
    await page.type('#text-body', 'Gayrimenkul için sokakta yürüyen dev maket storyboard fikri');
    await page.type('#sb-brand', 'Gayrimenkul');
    await page.type('#sb-place', 'Kayseri');
    await typePick(page, '#add-firms', 'gay', 'Gayrimenkul');
    const sbCreated = postCreated(page);
    await page.click('#text-submit');
    const sbPost = await (await sbCreated).json();
    ids.story = sbPost.id;
    assert.ok(sbPost.storyboard, 'a storyboard was started: ' + JSON.stringify(sbPost.storyboard_error || null));
    assert.deepEqual(sbPost.tags.map((t) => t.name), ['Gayrimenkul']);
    await page.waitForSelector(`${card(ids.story)} .sb-card`, { timeout: 15000 });
    assert.deepEqual(await cardChips(page, ids.story), ['Gayrimenkul']);
    await page.waitForSelector(`${card(ids.story)} .sb-chip.ok`, { timeout: 120000 });
    await page.$eval(`${card(ids.story)} .sb-card`, (el) => { el.__mark = 'kept'; });
    await page.click(`${card(ids.story)} .tag-edit`);
    await waitModal(page, '#tag-modal');
    await typePick(page, '#tag-picker', 'say', 'Sayın');
    await page.click('#tag-save');
    await waitToast(page, /Firmalar kaydedildi\./);
    await page.waitForFunction((s) => document.querySelectorAll(`${s} .post-tags .tag-chip`).length === 2, { timeout: 10000 }, card(ids.story));
    assert.deepEqual(await cardChips(page, ids.story), ['Gayrimenkul', 'Sayın']);
    assert.equal(await page.$eval(`${card(ids.story)} .sb-card`, (el) => el.__mark), 'kept', 'the storyboard card is not rebuilt');
    assert.ok(await page.$(`${card(ids.story)} .sb-chip.ok`), 'storyboard still done');
    await page.$eval(card(ids.story), (el) => el.scrollIntoView({ block: 'center' }));
    await sleep(300);
    await shot(page, 'F3-storyboard-tagged.png');
    // the filter sees both
    await clickChip(page, 'Sayın');
    const vis = await visible(page);
    assert.ok(vis.includes(ids.reel) && vis.includes(ids.story), 'reel + storyboard in the Sayın filter');
    assert.deepEqual(vis, expectIds(await apiPosts(), { ids: [T.sayin.id] }));
    await clickChip(page, 'Tümü');
    return `reel ${ids.reel} (live, İndir), storyboard ${ids.story}`;
  });

  await check('E', 'admin "Firmaları yönet": rename (everywhere), recolor, delete with confirm (Vazgeç keeps; Sil drops chips, keeps ideas)', async () => {
    const ctx = await browser.createBrowserContext();
    const a = await ctx.newPage();
    await a.setViewport({ width: 1360, height: 1000, deviceScaleFactor: 1 });
    prepare(a, 'admin');
    await a.goto(boardUrl('&firma=beta-yapi'), { waitUntil: 'domcontentloaded' });
    await a.waitForSelector('#entry-screen:not([hidden])');
    await a.click('#admin-toggle');
    await a.type('#admin-user', 'vkesgin38');
    await a.type('#admin-pass', ADMIN_PW);
    await a.click('#admin-btn');
    await a.waitForSelector('#firm-manage:not([hidden])', { timeout: 20000 });
    const list0 = await apiPosts();
    const betaIds = expectIds(list0, { ids: [T.beta.id] });
    await a.waitForFunction((s) => document.querySelector(s) && !document.querySelector(s).hidden, { timeout: 20000 }, card(betaIds[0]));
    assert.deepEqual(await visible(a), betaIds, 'admin opens the Beta Yapı URL');
    assert.ok(await a.$(`${card(ids.s1)} [data-action="tags-edit"], ${card(ids.b1)} .tag-edit`), 'the admin may tag any card');
    await a.click('#firm-manage');
    await waitModal(a, '#firms-modal');
    await shot(a, 'E1-manage.png');
    const row = (id) => `#firms-list [data-firm="${id}"]`;
    // rename Beta Yapı -> Beta İnşaat
    await a.click(`${row(T.beta.id)} .firm-name-input`, { clickCount: 3 });
    await a.keyboard.type('Beta İnşaat');
    await a.keyboard.press('Enter');
    await a.waitForFunction(() => /firma=beta-insaat/.test(location.search), { timeout: 10000 });
    for (const id of betaIds) assert.ok((await cardChips(a, id)).includes('Beta İnşaat') && !(await cardChips(a, id)).includes('Beta Yapı'), `card ${id} chip renamed`);
    assert.ok('Beta İnşaat' in (await chipCounts(a)) && !('Beta Yapı' in (await chipCounts(a))), 'bar chip renamed');
    assert.match(await summary(a), /Beta İnşaat/);
    assert.equal(await a.$eval(`${row(T.beta.id)} .firm-name-input`, (i) => i.value), 'Beta İnşaat');
    // recolor Sayın -> orange
    await a.click(`${row(T.sayin.id)} [data-firm-act="colors"]`);
    await a.click(`${row(T.sayin.id)} [data-firm-color="orange"]`);
    await a.waitForFunction((s) => [...document.querySelectorAll(s)].every((c) => c.dataset.c === 'orange'), { timeout: 10000 },
      `${card(ids.sb)} .post-tags .tag-chip[data-tag="${T.sayin.id}"]`);
    assert.equal(await a.$eval(`#firm-chips .firm-chip[data-tag="${T.sayin.id}"]`, (b) => b.dataset.c), 'orange', 'bar chip recolored');
    assert.equal((await catalog()).find((t) => t.id === T.sayin.id).color, 'orange', 'API color');
    await shot(a, 'E2-renamed-recolored.png');
    // the owner's page after a reload has the new name and color
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForSelector(`${card(ids.a)} .post-tags .tag-chip`, { timeout: 20000 });
    assert.deepEqual(await cardChips(page, ids.a), ['Beta İnşaat', 'Gayrimenkul'], 'owner page: renamed chip');
    assert.equal(await page.$eval(`${card(ids.s1)} .post-tags .tag-chip`, (c) => c.dataset.c), 'orange', 'owner page: recolored chip');
    assert.equal(await page.$eval(`#firm-chips .firm-chip[data-tag="${T.beta.id}"] .tc-name`, (c) => c.textContent), 'Beta İnşaat', 'owner page: bar');
    await shot(page, 'E2b-owner-board-renamed-recolored.png');
    // delete Beta İnşaat: "Vazgeç" keeps it
    await a.click(`${row(T.beta.id)} [data-firm-act="delete"]`);
    await waitModal(a, '#confirm-modal');
    const n = betaIds.length;
    assert.match(await a.$eval('#confirm-text', (e) => e.textContent), new RegExp(`«Beta İnşaat» firması silinsin mi\\? ${n} fikirden bu etiket kaldırılır; fikirler silinmez\\.`));
    await shot(a, 'E3-delete-confirm.png');
    await a.click('#confirm-cancel');
    await a.waitForSelector('#confirm-modal', { hidden: true });
    assert.ok(await a.$(row(T.beta.id)), 'Vazgeç: still there');
    assert.ok((await catalog()).some((t) => t.id === T.beta.id));
    // ... "Sil" removes it
    await a.click(`${row(T.beta.id)} [data-firm-act="delete"]`);
    await waitModal(a, '#confirm-modal');
    await a.click('#confirm-ok');
    await a.waitForFunction((id) => !document.querySelector(`#firms-list [data-firm="${id}"]`), { timeout: 10000 }, T.beta.id);
    await shot(a, 'E4-after-delete.png');
    await a.keyboard.press('Escape');
    await a.waitForSelector('#firms-modal', { hidden: true });
    await a.waitForFunction(() => !/firma=/.test(location.search), { timeout: 5000 });
    const list1 = await apiPosts();
    assert.deepEqual(sorted(list1.map((p) => p.id)), sorted(list0.map((p) => p.id)), 'no idea deleted');
    assert.ok(!list1.some((p) => p.tags.includes(T.beta.id)), 'no idea has the company');
    assert.equal((await visible(a)).length, list1.length, 'filter gone: every card');
    for (const id of betaIds) {
      assert.ok(await a.$(card(id)), `card ${id} stays`);
      assert.ok(!(await cardChips(a, id)).includes('Beta İnşaat'), `card ${id}: chip gone`);
    }
    assert.ok(!('Beta İnşaat' in (await chipCounts(a))), 'bar chip gone');
    assert.deepEqual(await chipCounts(a), expectCounts(list1, await catalog()), 'admin bar counts = API');
    assert.ok(!(await catalog()).some((t) => t.id === T.beta.id), 'catalog');
    await shot(a, 'E5-board-after-delete.png');
    await ctx.close();
    // the owner's page: a refresh drops the chip too
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForSelector(`${card(ids.a)} .post-tags .tag-chip`, { timeout: 20000 });
    assert.deepEqual(await cardChips(page, ids.a), ['Gayrimenkul'], 'owner page after the delete');
    return `${n} ideas lost the chip, ${list1.length} ideas kept`;
  });

  await check('G', '390 px: filter bar, picker and a card with chips without horizontal page scroll (screenshots)', async () => {
    const mctx = await browser.createBrowserContext();
    const m = await mctx.newPage();
    prepare(m, 'mobile');
    await m.emulate({ viewport: { width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
      userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1' });
    await loginGuest(m, 'Mobil');
    await m.waitForSelector(card(ids.a));
    const out = [];
    const assertFits = async (label) => { const r = await noHScroll(m); assert.ok(r.sw <= r.iw && r.bw <= r.iw, `${label}: ${JSON.stringify(r)}`); out.push(`${label} ${r.sw}/${r.iw}`); };
    await assertFits('board');
    await clickChip(m, 'Sayın');
    await clickChip(m, 'Gayrimenkul');
    await m.waitForSelector('#firm-match:not([hidden])');
    await m.evaluate(() => window.scrollTo(0, 0));
    await sleep(200);
    const bar = await m.$eval('#firm-bar', (b) => { const r = b.getBoundingClientRect(); return { l: r.left, r: r.right }; });
    assert.ok(bar.l >= 0 && bar.r <= 390, 'bar inside the viewport ' + JSON.stringify(bar));
    await assertFits('filter bar');
    await m.screenshot({ path: path.join(SHOTS, 'G1-mobile-filter-bar.png') });
    await clickChip(m, 'Tümü');
    // the picker in the add dialog
    await m.click('#btn-add');
    await waitModal(m, '#add-modal');
    await m.click('#tab-text');
    await m.click(inp('#add-firms'));
    await m.type(inp('#add-firms'), 'Sayın');
    await m.keyboard.press('Enter');
    await m.type(inp('#add-firms'), 'g');
    await m.waitForSelector('#add-firms .picker-list:not([hidden])');
    await m.$eval('#add-firms', (el) => el.scrollIntoView({ block: 'center' }));
    await sleep(250);
    await assertFits('picker');
    const pk = await m.$eval('#add-firms', (el) => { const r = el.getBoundingClientRect(); return { l: r.left, r: r.right }; });
    assert.ok(pk.l >= 0 && pk.r <= 390, 'picker inside the viewport ' + JSON.stringify(pk));
    await m.screenshot({ path: path.join(SHOTS, 'G2-mobile-picker.png') });
    await m.keyboard.press('Escape'); await m.keyboard.press('Escape');
    await m.waitForSelector('#add-modal', { hidden: true });
    // a card with chips
    const target = ids.story;
    await m.$eval(card(target), (el) => el.scrollIntoView({ block: 'start' }));
    await m.evaluate(() => window.scrollBy(0, -80));
    await sleep(400);
    const c = await m.$eval(card(target), (el) => {
      const r = el.getBoundingClientRect();
      const chips = [...el.querySelectorAll('.post-tags .tag-chip, .post-tags .tag-edit')].map((x) => x.getBoundingClientRect());
      return { l: r.left, r: r.right, chipsIn: chips.every((x) => x.left >= r.left - 0.5 && x.right <= r.right + 0.5), chips: chips.length };
    });
    assert.ok(c.l >= 0 && c.r <= 390 && c.chipsIn && c.chips >= 2, 'card + chips inside ' + JSON.stringify(c));
    await assertFits('card');
    await m.screenshot({ path: path.join(SHOTS, 'G3-mobile-card-chips.png') });
    await mctx.close();
    return out.join(', ');
  });

  // ── review fixes (phase P): human-speed clicks, keyboard, stale catalog answers, filter state, overflow, phones ──
  // a human click: press, hold, release at the same point (a dialog that moves between the two loses the click)
  async function humanClick(pg, sel, hold = 120) {
    const r = await pg.$eval(sel, (e) => { const b = e.getBoundingClientRect(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; });
    await pg.mouse.move(r.x, r.y);
    await pg.mouse.down();
    await sleep(hold);
    await pg.mouse.up();
  }
  const listShown = (pg, root) => pg.$eval(`${root} .picker-list`, (l) => !l.hidden);
  const CORS = { 'Access-Control-Allow-Origin': WEB, 'Access-Control-Expose-Headers': 'X-Fikir-Next', 'Content-Type': 'application/json; charset=utf-8' };
  // request interception with rules (fn(req) -> true when it took the request); everything else goes to the worker as is
  async function intercept(pg) {
    const rules = [];
    const on = (req) => {
      for (const r of rules) if (r(req)) return;
      req.continue().catch(() => {});
    };
    await pg.setRequestInterception(true);
    pg.on('request', on);
    return { rules, async off() { pg.off('request', on); await pg.setRequestInterception(false); } };
  }
  const adminLogin = await call('POST', '/api/inspire/login', { username: 'vkesgin38', password: ADMIN_PW });
  assert.equal(adminLogin.status, 200, JSON.stringify(adminLogin.data));
  const ADM = adminLogin.data.token;
  const postReqs = [], tagPuts = [];
  page.on('request', (r) => {
    if (r.url() === BASE + '/api/inspire/posts' && r.method() === 'POST') postReqs.push(r.postData());
    if (r.method() === 'PUT' && /\/api\/inspire\/posts\/\d+\/tags$/.test(r.url())) tagPuts.push(r.url());
  });

  await check('H', 'picker: one human click on Kaydet / Paylaş with the list open; Enter with the list open picks; a half-typed name is never created; sent while creating; a stale GET /tags keeps the new company; hover = active; focus back on ✎', async () => {
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForSelector(`${card(ids.a)} .tag-edit`, { timeout: 20000 });
    const out = [];
    // (1) #tag-modal: the list is open (input focused), a mouse pick keeps it open, one human click on "Kaydet" saves
    await page.$eval(card(ids.a), (c) => c.scrollIntoView({ block: 'center' }));
    await page.click(`${card(ids.a)} .tag-edit`);
    await waitModal(page, '#tag-modal');
    assert.equal(await listShown(page, '#tag-picker'), true, 'list open at start');
    const first = await page.$eval('#tag-picker .picker-list li[data-i="0"] .tc-name', (e) => e.textContent);
    await page.click('#tag-picker .picker-list li[data-i="0"]');
    await sleep(150);
    assert.equal(await listShown(page, '#tag-picker'), true, 'still open after a mouse pick');
    let n0 = tagPuts.length;
    const saved = page.waitForResponse((r) => r.url() === `${BASE}/api/inspire/posts/${ids.a}/tags` && r.request().method() === 'PUT', { timeout: 5000 });
    await humanClick(page, '#tag-save');
    assert.equal((await saved).status(), 200, 'one human click on Kaydet saved');
    await page.waitForSelector('#tag-modal', { hidden: true, timeout: 5000 });
    assert.equal(tagPuts.length, n0 + 1);
    assert.ok((await cardChips(page, ids.a)).includes(first), 'the picked company is on the card');
    // focus is back on the card's (new) ✎, not on <body>
    await page.waitForFunction((s) => document.activeElement && document.activeElement.matches(`${s} .tag-edit`), { timeout: 3000 }, card(ids.a))
      .catch(async () => { throw new Error('focus after save: ' + await page.evaluate(() => document.activeElement && (document.activeElement.outerHTML || '').slice(0, 120))); });
    out.push('Kaydet 1 click, focus ✎');
    // (2) add dialog: a mouse pick, then one human click on "Paylaş"
    await openAdd(page, 'text');
    await setStoryboard(page, false);
    await page.type('#text-body', 'İnsan hızında tek tıkla paylaşılan fikir');
    await page.focus(inp('#add-firms'));
    await page.waitForSelector('#add-firms .picker-list:not([hidden]) li[data-i="0"]');
    // the first option is highlighted on open; hovering another makes it the active one
    assert.equal(await page.$eval('#add-firms .picker-list li[data-i="0"]', (l) => l.getAttribute('aria-selected')), 'true', 'first option highlighted');
    await page.hover('#add-firms .picker-list li[data-i="1"]');
    await sleep(100);
    const hov = await page.$eval('#add-firms .picker-list li[data-i="1"]', (l) => ({ sel: l.getAttribute('aria-selected'), bg: getComputedStyle(l).backgroundColor,
      ad: document.querySelector('#add-firms input[role="combobox"]').getAttribute('aria-activedescendant') === l.id }));
    assert.deepEqual([hov.sel, hov.ad], ['true', true], 'hover = active option ' + JSON.stringify(hov));
    assert.notEqual(hov.bg, 'rgba(0, 0, 0, 0)', 'hover feedback');
    assert.equal(await page.$eval('#add-firms .picker-list li[data-i="0"]', (l) => l.getAttribute('aria-selected')), 'false');
    await shot(page, 'H1-picker-open-hover.png');
    await page.click('#add-firms .picker-list li[data-i="1"]');
    await sleep(150);
    n0 = postReqs.length;
    const created = postCreated(page);
    await humanClick(page, '#text-submit');
    const p1 = await (await created).json();
    assert.equal(postReqs.length, n0 + 1, 'one human click on Paylaş posted');
    assert.equal(p1.tags.length, 1);
    await page.waitForSelector('#add-modal', { hidden: true, timeout: 5000 });
    ids.h1 = p1.id;
    out.push('Paylaş 1 click');
    // (3) Enter in the empty company field while the list shows: picks the highlighted first option, never sends the form
    await openAdd(page, 'text');
    await setStoryboard(page, false);
    await page.type('#text-body', 'Enter ile firma seçilen fikir');
    await page.focus(inp('#add-firms'));
    await page.waitForSelector('#add-firms .picker-list:not([hidden]) li[data-i="0"][aria-selected="true"]');
    const top = await page.$eval('#add-firms .picker-list li[data-i="0"] .tc-name', (e) => e.textContent);
    n0 = postReqs.length;
    await page.keyboard.press('Enter');
    await sleep(700);
    assert.equal(postReqs.length, n0, 'Enter with the list open sent nothing');
    assert.deepEqual(await pickerChips(page, '#add-firms'), [top], 'Enter picked the highlighted option');
    assert.equal(await page.$eval('#add-modal', (m) => m.hidden), false);
    await page.keyboard.press('Backspace');   // the empty field's Backspace removes the last chip
    assert.deepEqual(await pickerChips(page, '#add-firms'), []);
    // (4) a half-typed name of a listed company ("say" for "Sayın"): "Paylaş" neither creates "say" nor sends; the list stays
    const tp0 = tagPosts.length;
    await page.type(inp('#add-firms'), 'say');
    await sleep(150);
    await page.click('#text-submit');
    await page.waitForFunction(() => /Listeden bir firma seç/.test(document.querySelector('#add-firms .picker-note').textContent), { timeout: 3000 });
    await sleep(400);
    assert.equal(tagPosts.length, tp0, 'no POST /tags for "say"');
    assert.equal(postReqs.length, n0, 'not sent');
    assert.equal(await listShown(page, '#add-firms'), true, 'the list stays open');
    assert.match(await page.$eval('#add-firms .picker-list li[aria-selected="true"]', (l) => l.textContent), /^Sayın/, '"Sayın" highlighted');
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => [...document.querySelectorAll('#add-firms .picker .tag-chip .tc-name')].some((c) => c.textContent === 'Sayın'), { timeout: 3000 });
    const c2 = postCreated(page);
    await page.click('#text-submit');
    const p2 = await (await c2).json();
    ids.h2 = p2.id;
    assert.ok(p2.tags.some((t) => t.id === T.sayin.id), 'sent with the real Sayın');
    assert.ok(!(await catalog()).some((t) => t.slug === 'say'), 'no company "say"');
    out.push('Enter picks, "say" refused');
    // (5) a GET /tags already on its way when a company is created must not drop it; "Paylaş" while it is being created
    const ic = await intercept(page);
    let holdNext = true, held = null, delayNextCreate = 0;
    ic.rules.push((req) => {
      if (holdNext && req.method() === 'GET' && req.url() === BASE + '/api/inspire/tags') {
        holdNext = false;
        const auth = req.headers().authorization;
        held = fetch(req.url(), { headers: { Authorization: auth, 'X-Fikir-Client': '2' } }).then(async (r) => ({ req, status: r.status, body: await r.text() }));
        return true;
      }
      if (delayNextCreate && req.method() === 'POST' && req.url() === BASE + '/api/inspire/tags') {
        const ms = delayNextCreate; delayNextCreate = 0;
        setTimeout(() => req.continue().catch(() => {}), ms);
        return true;
      }
      return false;
    });
    try {
      // the card save asks the catalog again (loadFirms): that answer is held (taken now, before the new company exists)
      await page.click(`${card(ids.a)} .tag-edit`);
      await waitModal(page, '#tag-modal');
      const s2 = page.waitForResponse((r) => r.url() === `${BASE}/api/inspire/posts/${ids.a}/tags` && r.request().method() === 'PUT', { timeout: 5000 });
      await page.click('#tag-save');
      await s2;
      await page.waitForFunction(() => true);
      for (let i = 0; i < 50 && !held; i++) await sleep(50);
      assert.ok(held, 'a GET /tags is on its way');
      const stale = await held;
      assert.ok(!JSON.parse(stale.body).tags.some((t) => t.name === 'Delta Yapı'));
      await openAdd(page, 'text');
      await setStoryboard(page, false);
      await page.type('#text-body', 'Yeni firma eklenirken paylaşılan fikir');
      await page.focus(inp('#add-firms'));
      await page.type(inp('#add-firms'), 'Delta Yapı');
      await page.waitForSelector('#add-firms .picker-list li.opt-new');
      const tp1 = tagPosts.length;
      delayNextCreate = 900;
      await page.click('#add-firms .picker-list li.opt-new');
      await sleep(100);
      const c3 = postCreated(page);
      n0 = postReqs.length;
      await page.click('#text-submit');   // while POST /tags is still on its way
      const p3 = await (await c3).json();
      ids.h3 = p3.id;
      assert.deepEqual(p3.tags.map((t) => t.name), ['Delta Yapı'], 'sent once the company existed, with it');
      assert.equal(tagPosts.length, tp1 + 1, 'one POST /tags');
      assert.equal(postReqs.length, n0 + 1);
      await page.waitForSelector('#add-modal', { hidden: true, timeout: 5000 });
      // now the old catalog answer arrives
      await stale.req.respond({ status: stale.status, headers: CORS, body: stale.body });
      await sleep(800);
      const bar = await chipCounts(page);
      assert.equal(bar['Delta Yapı'], 1, 'the new company survived the stale catalog answer: ' + JSON.stringify(bar));
      await openAdd(page, 'text');
      await page.focus(inp('#add-firms'));
      await page.type(inp('#add-firms'), 'delta');
      await sleep(150);
      assert.match((await options(page, '#add-firms'))[0] || '', /^Delta Yapı/, 'the picker knows it');
      await page.keyboard.press('Escape'); await page.keyboard.press('Escape');
      await page.waitForSelector('#add-modal', { hidden: true });
      out.push('stale GET dropped, sent while creating');
    } finally {
      await ic.off();
    }
    return out.join('; ');
  });

  await check('J', 'filter state: "Hepsi" never stays hidden; Firmasız ✓; own edit re-flows the columns; a renamed slug in this browser\'s URL restores from its saved ids', async () => {
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForSelector(card(ids.h3));
    await page.waitForSelector('#firm-bar:not([hidden])');
    const cat = await catalog();
    const gay = cat.find((t) => t.slug === 'gayrimenkul');
    assert.ok(gay, JSON.stringify(cat.map((t) => t.slug)));
    // "Hepsi", then "Tümü": a single company + "Firmasız" is a union again (not the hidden exclusive mode)
    await clickChip(page, 'Sayın'); await clickChip(page, 'Gayrimenkul');
    await page.click('#firm-match [data-match="all"]');
    await clickChip(page, 'Tümü');
    await clickChip(page, 'Sayın');
    await clickChip(page, 'Firmasız');
    const list = await apiPosts();
    assert.deepEqual(await pressed(page), ['Firmasız', 'Sayın'], 'both pressed');
    assert.deepEqual(await visible(page), expectIds(list, { ids: [T.sayin.id], untagged: true }), 'Sayın OR untagged');
    assert.ok(!/eslesme/.test(await search(page)), await search(page));
    const tick = await page.$eval('#firm-chips .firm-chip[data-tag="none"]', (b) => getComputedStyle(b, '::before').content);
    assert.equal(tick, '"✓"', 'pressed Firmasız shows ✓');
    assert.equal(await page.$eval('#firm-chips .firm-chip[data-tag="all"]', (b) => getComputedStyle(b, '::before').content), 'none');
    await shot(page, 'J1-sayin-or-firmasiz.png');
    // own edit that takes a card out of the filter: the columns re-flow at once
    await clickChip(page, 'Tümü');
    await clickChip(page, 'Sayın');
    const lay = await page.evaluate((own) => {
      const cols = [...document.querySelectorAll('#board .board-col')];
      for (const c of cols) {
        const vis = [...c.querySelectorAll(':scope > .post-card')].filter((x) => !x.hidden);
        const mine = vis.find((x) => own.includes(Number(x.dataset.id)) && x.querySelector('.tag-edit'));
        if (vis.length === 1 && mine) return { id: Number(mine.dataset.id), alone: true };
      }
      const any = [...document.querySelectorAll('.post-card')].find((x) => !x.hidden && own.includes(Number(x.dataset.id)) && x.querySelector('.tag-edit'));
      return { id: any ? Number(any.dataset.id) : null, alone: false };
    }, [ids.b, ids.reel, ids.story, ids.h2].filter(Boolean));
    assert.ok(lay.id, 'an own Sayın card');
    await page.$eval(card(lay.id), (c) => c.scrollIntoView({ block: 'center' }));
    await page.click(`${card(lay.id)} .tag-edit`);
    await waitModal(page, '#tag-modal');
    await page.evaluate(() => [...document.querySelectorAll('#tag-picker .picker .tag-chip')].find((c) => c.textContent.includes('Sayın')).querySelector('.x').click());
    await page.click('#tag-save');
    await waitToast(page, /artık görünmüyor/);
    assert.equal(await page.$eval(card(lay.id), (c) => c.hidden), true);
    const flow = await layoutOk(page, 'after own edit');
    const nVis = (await visible(page)).length;
    const cols = flow.split('/').map(Number);
    if (nVis >= cols.length) assert.ok(cols.every((n) => n > 0), `no empty column with ${nVis} cards: ${flow}`);
    await shot(page, 'J2-after-own-edit-reflowed.png');
    // the focus went to the filter summary (the card is hidden) and stays there when the catalog answer re-renders it
    await sleep(800);
    assert.equal(await page.evaluate(() => !!document.activeElement.closest('#firm-summary')), true,
      'focus on the summary: ' + await page.evaluate(() => (document.activeElement.outerHTML || '').slice(0, 100)));
    // rename while this browser has ?firma=gayrimenkul: a reload restores it through the saved ids
    await clickChip(page, 'Tümü');
    await clickChip(page, 'Gayrimenkul');
    assert.match(await search(page), /firma=gayrimenkul(&|$)/);
    const href = await page.evaluate(() => location.href);
    const ren = await call('PUT', `/api/inspire/tags/${gay.id}`, { name: 'Gayrimenkul Grup' }, ADM);
    assert.equal(ren.status, 200, JSON.stringify(ren.data));
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => /firma=gayrimenkul-grup/.test(location.search), { timeout: 15000 })
      .catch(async () => { throw new Error('after reload: ' + await search(page) + ' ' + JSON.stringify(await pressed(page))); });
    assert.deepEqual(await pressed(page), ['Gayrimenkul Grup']);
    assert.deepEqual(await visible(page), expectIds(await apiPosts(), { ids: [gay.id] }));
    // a browser that never saved it (someone else's old link): dropped as before
    const ctx = await browser.createBrowserContext();
    const f = await ctx.newPage();
    await f.setViewport({ width: 1360, height: 1000, deviceScaleFactor: 1 });
    prepare(f, 'stale-link');
    await loginGuest(f, 'Eski Bağlantı', href);
    await f.waitForFunction(() => !/firma=/.test(location.search), { timeout: 10000 });
    assert.deepEqual(await pressed(f), ['Tümü']);
    await ctx.close();
    await clickChip(page, 'Tümü');
    T.gay = { ...gay, name: 'Gayrimenkul Grup', slug: 'gayrimenkul-grup' };
    return `edited ${lay.id}${lay.alone ? ' (alone in its column)' : ''}: ${flow}`;
  });

  await check('K', 'a link with a file added outside the filter whose upload fails: the error toast offers "Filtreyi temizle"', async () => {
    const png = path.join(SHOTS, '..', 'k-upload.png');
    fs.writeFileSync(png, Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64'));
    await page.evaluate(() => window.scrollTo(0, 0));
    await clickChip(page, 'Tümü');
    await clickChip(page, 'Sayın');
    assert.deepEqual(await pressed(page), ['Sayın']);
    const ic = await intercept(page);
    let uploads = 0;
    ic.rules.push((req) => {
      if (req.method() === 'POST' && /\/api\/inspire\/posts\/\d+\/media\/upload/.test(req.url())) {
        uploads++;
        req.respond({ status: 500, headers: CORS, body: JSON.stringify({ error: 'upload_failed', message: 'Test: yükleme reddedildi' }) }).catch(() => {});
        return true;
      }
      return false;
    });
    try {
      await openAdd(page, 'link');
      await page.type('#link-url', `${FXB}/page/plain/k-upload-outside-filter`);
      await page.waitForSelector('#link-media-box:not([hidden])', { timeout: 20000 });
      // the dialog starts with the filter's company: removed, so the idea lands outside the filter
      for (let i = 0; i < 12 && await page.$('#add-firms .picker .tag-chip .x'); i++) await page.click('#add-firms .picker .tag-chip .x');
      assert.deepEqual(await pickerChips(page, '#add-firms'), []);
      await page.evaluate(() => { document.getElementById('link-media-box').open = true; });
      await (await page.$('#link-file')).uploadFile(png);
      await page.waitForFunction(() => document.getElementById('link-file-name').textContent.trim().length > 0, { timeout: 5000 });
      await page.waitForFunction(() => !document.querySelector('#link-submit').disabled, { timeout: 10000 });
      const created = postCreated(page);
      await page.click('#link-submit');
      const post = await (await created).json();
      await waitToast(page, /dosya yüklenemedi/);
      assert.equal(uploads, 1);
      const t = await page.evaluate(() => {
        const el = [...document.querySelectorAll('#toasts .toast')].find((x) => /dosya yüklenemedi/.test(x.textContent));
        return { text: el.querySelector('.toast-msg') ? el.querySelector('.toast-msg').textContent : el.textContent, action: (el.querySelector('.toast-action') || {}).textContent || '' };
      });
      assert.match(t.text, /seçili filtrede görünmüyor/, t.text);
      assert.equal(t.action, 'Filtreyi temizle');
      assert.equal(await page.$eval(card(post.id), (c) => c.hidden), true, 'the card is outside the filter');
      await shot(page, 'K1-upload-error-outside-filter.png');
      await page.evaluate(() => [...document.querySelectorAll('#toasts .toast-action')].find((b) => b.textContent === 'Filtreyi temizle' && /dosya yüklenemedi/.test(b.closest('.toast').textContent)).click());
      await page.waitForFunction((s) => document.querySelector(s) && !document.querySelector(s).hidden, { timeout: 5000 }, card(post.id));
      assert.ok(!/firma=/.test(await search(page)), 'filter cleared');
      return `post ${post.id}: "${t.text.slice(0, 60)}…" + ${t.action}`;
    } finally {
      await ic.off();
    }
  });

  await check('I', 'more than the board loads (MAX_PAGES, simulated pages of 5): the filter\'s older matches come from below the oldest loaded id, also when the catalog arrives after the first fill', async () => {
    const tpl = (await call('GET', '/api/inspire/posts', null, OT)).data.find((p) => p.type === 'text' && !p.storyboard);
    assert.ok(tpl, 'a text post as the template');
    const S = T.sayin;
    const sayTag = { id: S.id, name: 'Sayın', slug: 'sayin', color: 'orange' };
    // 80 synthetic ideas (ids 900080 .. 900001); the even ones have Sayın. Pages of 5: the board stops after 10 pages (50).
    const all = Array.from({ length: 80 }, (_, i) => 900080 - i).map((id) => ({ ...tpl, id, is_mine: false, can_tag: false, notes: [],
      description: `Sentetik fikir ${id}`, text: `Sentetik fikir ${id}`, tags: id % 2 === 0 ? [sayTag] : [] }));
    const ctx = await browser.createBrowserContext();
    const o = await ctx.newPage();
    await o.setViewport({ width: 1360, height: 1000, deviceScaleFactor: 1 });
    prepare(o, 'overflow');
    const filtered = [];
    let holdTags = false, heldTags = [];
    const ic = await intercept(o);
    ic.rules.push((req) => {
      const u = new URL(req.url());
      if (req.method() === 'GET' && u.origin === BASE && u.pathname === '/api/inspire/tags' && holdTags) { heldTags.push(req); return true; }
      if (req.method() !== 'GET' || u.origin !== BASE || u.pathname !== '/api/inspire/posts') return false;
      const before = u.searchParams.get('before') ? Number(u.searchParams.get('before')) : Infinity;
      const tags = u.searchParams.get('tags');
      if (tags) filtered.push(u.search);
      const src = tags ? all.filter((p) => p.tags.some((t) => tags.split(',').map(Number).includes(t.id))) : all;
      const rest = src.filter((p) => p.id < before);
      const pageRows = rest.slice(0, 5);
      const headers = { ...CORS };
      if (rest.length > 5) headers['X-Fikir-Next'] = String(pageRows[pageRows.length - 1].id);
      req.respond({ status: 200, headers, body: JSON.stringify(pageRows) }).catch(() => {});
      return true;
    });
    try {
      // the catalog answers 5 s late: the first fill (it waits 4 s at most) shows the whole list, then the URL filter applies
      holdTags = true;
      const loginDone = loginGuest(o, 'Taşma', boardUrl('&firma=sayin')).catch((e) => e);
      for (let i = 0; i < 200 && !heldTags.length; i++) await sleep(50);
      await o.waitForFunction(() => document.querySelectorAll('.post-card').length >= 50, { timeout: 20000 });
      await sleep(1500);
      holdTags = false;
      for (const r of heldTags.splice(0)) r.continue().catch(() => {});
      const lr = await loginDone;
      if (lr instanceof Error) throw lr;
      const want = all.filter((p) => p.id % 2 === 0).map((p) => p.id).sort((a, b) => a - b);
      await o.waitForFunction((n) => [...document.querySelectorAll('.post-card')].filter((c) => !c.hidden).length === n, { timeout: 15000 }, want.length)
        .catch(async () => { throw new Error(`visible ${(await visible(o)).length} of ${want.length}; filtered requests ${JSON.stringify(filtered)}`); });
      assert.deepEqual(await visible(o), want, 'the 25 loaded matches + the 15 older ones');
      assert.ok(filtered.length >= 1, 'an overflow request');
      const first = new URLSearchParams(filtered[0]);
      assert.equal(first.get('before'), '900031', 'it starts below the oldest loaded id: ' + filtered[0]);
      assert.equal(first.get('tags'), String(S.id));
      assert.ok(filtered.length <= 4, `pages of the older matches only: ${filtered.length}`);
      await shot(o, 'I1-overflow-filter.png');
      return `${filtered.length} filtered requests, first ${filtered[0]}`;
    } finally {
      await ic.off().catch(() => {});
      await ctx.close();
    }
  });

  await check('L', '390 px: only the chip row is sticky; the match toggle + summary scroll away; the admin manage dialog with "Kullanılmayanları sil"', async () => {
    const mctx = await browser.createBrowserContext();
    const m = await mctx.newPage();
    prepare(m, 'mobile-admin');
    await m.emulate({ viewport: { width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
      userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1' });
    await m.goto(boardUrl(), { waitUntil: 'domcontentloaded' });
    await m.waitForSelector('#entry-screen:not([hidden])');
    await m.click('#admin-toggle');
    await m.type('#admin-user', 'vkesgin38');
    await m.type('#admin-pass', ADMIN_PW);
    await m.click('#admin-btn');
    await m.waitForSelector('#firm-bar:not([hidden])', { timeout: 20000 });
    await clickChip(m, 'Sayın');
    await clickChip(m, 'Gayrimenkul Grup');
    await m.waitForSelector('#firm-sub:not([hidden]) #firm-match:not([hidden])');
    await m.evaluate(() => window.scrollTo(0, 0));
    await sleep(200);
    const top0 = await m.evaluate(() => ({ bar: document.getElementById('firm-bar').getBoundingClientRect().height,
      sub: !!document.querySelector('#firm-sub #firm-summary:not([hidden])'), manage: !!document.querySelector('#firm-sub #firm-manage:not([hidden])') }));
    assert.ok(top0.sub && top0.manage, JSON.stringify(top0));
    await m.screenshot({ path: path.join(SHOTS, 'L1-mobile-filter-two-companies.png') });
    // the "Hepsi" toggle works from its new place
    await m.click('#firm-match [data-match="all"]');
    assert.match(await search(m), /eslesme=hepsi/);
    await m.click('#firm-match [data-match="any"]');
    await m.evaluate(() => window.scrollTo(0, 700));
    await sleep(300);
    const st = await m.evaluate(() => {
      const b = document.getElementById('firm-bar').getBoundingClientRect(), s = document.getElementById('firm-sub').getBoundingClientRect();
      return { barTop: Math.round(b.top), barH: Math.round(b.height), subBottom: Math.round(s.bottom), vh: innerHeight, sw: document.documentElement.scrollWidth };
    });
    assert.ok(st.barTop === 0 && st.barH <= 72, 'one sticky row: ' + JSON.stringify(st));
    assert.ok(st.subBottom <= 0, 'the tools scrolled away: ' + JSON.stringify(st));
    assert.ok(st.sw <= 390, 'no horizontal scroll');
    await m.screenshot({ path: path.join(SHOTS, 'L2-mobile-scrolled-sticky.png') });
    await m.evaluate(() => window.scrollTo(0, 0));
    await sleep(200);
    // manage dialog (admin) at 390 px; "Kullanılmayanları sil" with the unused Çağ Lojistik (created minutes ago: kept)
    await m.click('#firm-manage');
    await waitModal(m, '#firms-modal');
    await m.waitForSelector('#firms-prune-row:not([hidden])');
    const fit = await m.evaluate(() => ({ sw: document.documentElement.scrollWidth, mc: document.querySelector('#firms-modal .modal-content').scrollWidth,
      mw: document.querySelector('#firms-modal .modal-content').clientWidth }));
    assert.ok(fit.sw <= 390 && fit.mc <= fit.mw + 1, 'manage dialog fits ' + JSON.stringify(fit));
    await m.screenshot({ path: path.join(SHOTS, 'L3-mobile-manage.png') });
    await m.click('#firms-prune');
    await waitModal(m, '#confirm-modal');
    assert.match(await m.$eval('#confirm-text', (e) => e.textContent), /Hiçbir fikirde kullanılmayan \d+ firma silinsin mi\?/);
    const pr = m.waitForResponse((r) => r.url() === BASE + '/api/inspire/tags/unused' && r.request().method() === 'DELETE');
    await m.click('#confirm-ok');
    const prj = await (await pr).json();
    assert.equal(prj.ok, true);
    await waitToast(m, /kullanılmayan firma/);
    // Çağ Lojistik (unused) was created at the start of this run: kept while it is younger than 10 minutes
    const cagLeft = (await catalog()).some((t) => t.name === 'Çağ Lojistik');
    assert.equal(cagLeft, prj.removed === 0, `removed ${prj.removed}, Çağ Lojistik ${cagLeft ? 'kept' : 'removed'}`);
    assert.ok((await catalog()).some((t) => t.name === 'Delta Yapı') && (await catalog()).some((t) => t.name === 'Sayın'), 'used companies stay');
    await mctx.close();
    return `sticky ${st.barH}px; prune removed ${prj.removed}`;
  });
} catch (e) {
  results.push({ id: 'setup', ok: false });
  console.log('not ok setup — ' + String(e && e.stack || e).slice(0, 2500));
} finally {
  try { if (browser) await browser.close(); } catch (_) {}
  try { web.close(); } catch (_) {}
}
if (consoleErrors.length) console.log(`# console errors (${consoleErrors.length}):\n` + consoleErrors.slice(0, 40).join('\n'));
else console.log('# console errors: 0');
if (pageErrors.length) { console.log(`# page errors (${pageErrors.length}):\n` + pageErrors.join('\n')); results.push({ id: 'pageerrors', ok: false }); }
else console.log('# page errors: 0');
const failed = results.filter((r) => !r.ok);
console.log(`# ${results.length - failed.length}/${results.length} passed; screenshots: ${SHOTS}`);
process.exit(failed.length ? 1 : 0);
