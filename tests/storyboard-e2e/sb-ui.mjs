// sb-ui.mjs: browser check of the storyboard UI (headless Chrome via puppeteer-core) against the fake-AI worker.
// usage: node e2e/sb-ui.mjs <static base e.g. http://127.0.0.1:4733> <api base e.g. http://127.0.0.1:8813> <out dir> <puppeteer-core path>
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const [STATIC, API, OUT, PPT] = process.argv.slice(2);
const { default: puppeteer } = await import(PPT);
fs.mkdirSync(OUT, { recursive: true });
let n = 0;
const MINE = ".post-card:has(.author-badge.is-mine)";   // the board may hold other guests' cards
const ok = (m) => console.log(`ok ${++n} ${m}`);
const gtDisplay = () => page.$eval(".gtranslate_wrapper", (e) => getComputedStyle(e).display);   // GTranslate flag widget (fixed, bottom-left)
const browser = await puppeteer.launch({ executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: true, args: ["--lang=tr-TR"] });
const page = await browser.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
page.on("console", (m) => { if (m.type() === "error" && !/favicon|gtranslate|Failed to load resource/i.test(m.text())) errors.push(m.text()); });
await page.setViewport({ width: 1300, height: 900 });
await page.goto(`${STATIC}/fikir.html?api=${encodeURIComponent(API)}`, { waitUntil: "networkidle0" });
// board password gate: anonymous entry = empty name + the TEST board password (run-ui.sh passes the same value with --var)
await page.waitForSelector("#entry-screen:not([hidden])");
await page.type("#guest-pass", process.env.FIKIR_E2E_BOARD_PASSWORD || "test-board-pass");
await page.click("#guest-btn");
await page.waitForSelector("#dashboard:not([hidden])");
await page.waitForFunction(() => window.fikirConfig && window.fikirConfig.sb && window.fikirConfig.sb.left);
await page.click("#btn-add");
await page.click("#tab-text");
await page.waitForSelector("#sb-fields:not([hidden])");
ok("add modal: storyboard fields visible for a guest when enabled");
await page.type("#text-body", "Sayın Gayrimenkul için STM'nin sokaklarında fil dolaşacak, dükkan aralarının büyüklüğünü göstermek için");
await page.type("#sb-brand", "Sayın Gayrimenkul");
await page.type("#sb-place", "Kayseri");
assert.equal(await page.$eval("#sb-enable", (e) => e.checked), true);
assert.match(await page.$eval("#sb-quota-hint", (e) => e.textContent), /kalan storyboard hakkın: 3/);
await page.click("#text-submit");
await page.waitForSelector(`${MINE} .sb-card .sb-steps`, { timeout: 8000 });
const steps = await page.$$eval(`${MINE} .sb-card .sb-steps li`, (l) => l.map((x) => x.textContent));
assert.deepEqual(steps.slice(0, 2), ["Araştırılıyor", "Sahneler yazılıyor"]);
await page.screenshot({ path: path.join(OUT, "1-card-progress.png") });
ok("card shows live steps right after submit");
await page.waitForFunction((m) => /Çiziliyor \d\/\d/.test(document.querySelector(`${m} .sb-card`)?.textContent || "") || document.querySelector(`${m} .sb-chip.ok`), { timeout: 60000 }, MINE);
await page.waitForSelector(`${MINE} .sb-chip.ok`, { timeout: 90000 });
const thumbs = await page.$$eval(`${MINE} .sb-media .sb-car-slide img`, (l) => l.length);
const total = await page.$$eval(`${MINE} .sb-media .sb-car-slide`, (l) => l.length);
assert.ok(thumbs >= 3 && thumbs === total, `carousel frames ${thumbs}/${total}`);
assert.equal(await page.$eval(`${MINE} .sb-car-count`, (e) => e.textContent), `1/${total}`);
assert.equal(await page.$eval(MINE, (card) => { const m = card.querySelector(".sb-media"), t = card.querySelector(".text-idea");
  return m && t && !m.hidden && m.compareDocumentPosition(t) & Node.DOCUMENT_POSITION_FOLLOWING ? "before-text" : "after"; }), "before-text", "carousel on top of the card, above the idea text");
const srcs = await page.$$eval(`${MINE} .sb-car-img`, (l) => l.map((i) => !!i.getAttribute("src")));
assert.ok(srcs[0] && srcs.slice(2).every((x) => !x), "only the current + next slide load: " + JSON.stringify(srcs));
await page.screenshot({ path: path.join(OUT, "2-card-done.png") });
ok(`card done: carousel of ${total} frames on top of the card (1/${total}), lazy beyond the next slide, chip ${await page.$eval(`${MINE} .sb-chip`, (e) => e.textContent)}`);

// carousel: arrow (desktop hover), keyboard, caption; a slide opens the viewer at that scene
await page.hover(`${MINE} .sb-car-stage`);
await page.click(`${MINE} .sb-car-nav.next`);
await page.waitForFunction((m) => document.querySelector(`${m} .sb-car-count`).textContent.startsWith("2/"), {}, MINE);
await page.focus(`${MINE} .sb-car-track`);
await page.keyboard.press("ArrowRight");
await page.waitForFunction((m) => document.querySelector(`${m} .sb-car-count`).textContent.startsWith("3/"), {}, MINE);
assert.match(await page.$eval(`${MINE} .sb-car-cap`, (e) => e.textContent), /^3\S/);
await page.keyboard.press("Enter");
await page.waitForSelector("#sb-viewer:not([hidden]) .sb-scene.sb-target[data-n='3']");
assert.equal(await page.$eval(".sb-layout [aria-pressed='true']", (e) => e.dataset.layout), "big", "Büyük is the default layout");
const s3 = await page.$eval(".sb-scene[data-n='3']", (e) => Math.round(e.getBoundingClientRect().top - document.querySelector(".sb-toolbar").getBoundingClientRect().bottom));
assert.ok(s3 >= 0 && s3 < 40, `scene 3 at the top of the viewer (${s3}px)`);
await page.keyboard.press("Escape");
await page.waitForFunction(() => document.querySelector("#sb-viewer").hidden);
assert.equal(await page.evaluate(() => document.activeElement && document.activeElement.classList.contains("sb-car-track")), true, "focus back on the carousel");
ok("carousel: next arrow, ← → keys, caption; Enter opens the viewer at that scene in the Büyük layout; focus returns");

assert.notEqual(await gtDisplay(), "none", "GTranslate widget visible on the board");
await page.click(`${MINE} [data-sb="open"]`);
await page.waitForSelector("#sb-viewer:not([hidden]) .sb-scene img");
await page.waitForFunction(() => [...document.querySelectorAll(".sb-scene img")].every((i) => i.complete && i.naturalWidth > 0));
assert.equal(await gtDisplay(), "none", "GTranslate widget hidden while the viewer is open");
const head = await page.$eval(".sb-head", (e) => e.innerText);
assert.match(head, /SAYIN GAYRİMENKUL\s+·\s+KAYSERİ\s+·\s+KABA STORYBOARD/);
assert.match(head, /Ana mesaj:/); assert.match(head, /Format: 16:9\s+·\s+5 sahne\s+·\s+toplam \d+ sn/);
const rows = await page.$$eval(".sb-scene[data-n='1'] .sb-s-rows dt", (l) => l.map((x) => x.textContent));
assert.deepEqual(rows, ["Aksiyon", "Ekran yazısı", "Dış ses (VO)", "Ses / müzik"]);
assert.match(await page.$eval(".sb-scene .sb-s-shot", (e) => e.textContent), /PLAN|HAVADAN|DETAY|KAMERA|OMUZ/);
const foot = await page.$eval(".sb-foot", (e) => e.innerText);
assert.match(foot, /Yorum:/); assert.match(foot, /Varsayım:/); assert.match(foot, /Not: Yapay zekâ ile üretilmiş kaba eskizdir/);
await new Promise((r) => setTimeout(r, 500));
await page.screenshot({ path: path.join(OUT, "3-viewer.png") });
ok("viewer: kicker, title, Ana mesaj, Format, 4 rows per frame, footer Yorum/Varsayım/Not");

// layout toggle: Büyük (one scene per row, text beside the frame) <-> Sayfa (sheet grid), remembered per browser
const big = await page.evaluate(() => { const sc = document.querySelector(".sb-scene[data-n='1']"); return { cls: document.querySelector(".sb-sheet").classList.contains("is-big"),
  beside: sc.querySelector(".sb-s-text").getBoundingClientRect().left >= sc.querySelector(".sb-frame").getBoundingClientRect().right, w: sc.querySelector(".sb-frame").getBoundingClientRect().width }; });
assert.ok(big.cls && big.beside && big.w > 600, JSON.stringify(big));
await page.click(".sb-layout [data-layout='sheet']");
const sheetW = await page.$eval(".sb-scene[data-n='1'] .sb-frame", (e) => e.getBoundingClientRect().width);
assert.ok(sheetW < big.w, "sheet frames are smaller");
assert.equal(await page.evaluate(() => localStorage.getItem("fikir_sb_layout")), "sheet");
await page.screenshot({ path: path.join(OUT, "3b-viewer-sheet.png") });
await page.click(".sb-layout [data-layout='big']");
assert.equal(await page.evaluate(() => localStorage.getItem("fikir_sb_layout")), "big");
ok(`layout toggle: Büyük (frame ${Math.round(big.w)}px, text beside) / Sayfa (frame ${Math.round(sheetW)}px), remembered in localStorage`);

// Esc inside the rewrite input closes only the input
await page.click('.sb-scene[data-n="2"] [data-sbv="rewrite-open"]');
await page.waitForSelector(".sb-rewrite input");
await page.waitForFunction(() => document.activeElement === document.querySelector(".sb-rewrite input"));   // focused by the module
await page.keyboard.press("Escape");
await page.waitForFunction(() => !document.querySelector(".sb-rewrite"));
assert.equal(await page.$eval("#sb-viewer", (e) => e.hidden), false);
ok("Esc in the rewrite note closes the note, not the viewer");

// redraw frame 1 from the viewer, while a half-typed "Yeniden yaz" note is open on scene 2
await page.click('.sb-scene[data-n="2"] [data-sbv="rewrite-open"]');
await page.waitForFunction(() => document.activeElement === document.querySelector('.sb-scene[data-n="2"] .sb-rewrite input'));
await page.type('.sb-scene[data-n="2"] .sb-rewrite input', "kamera yerden baksın");
const before = await page.$eval('.sb-scene[data-n="1"] img', (i) => i.src);
await page.click('.sb-scene[data-n="1"] [data-sbv="redraw"]');
await page.waitForFunction((b) => { const i = document.querySelector('.sb-scene[data-n="1"] img'); return i && i.src !== b && i.complete; }, { timeout: 30000 }, before);
// board files carry the files token (?t=, board password gate) unless FIKIR_FILES_GATE="0"
assert.match(await page.$eval('.sb-scene[data-n="1"] img', (i) => i.src), /frame_1\.r1\.jpg(?:\?t=[0-9a-z]+\.[A-Za-z0-9_-]{22})?$/);
await new Promise((r) => setTimeout(r, 800));   // quota refresh after the op ended re-renders the scenes
assert.equal(await page.$eval('.sb-scene[data-n="2"] .sb-rewrite input', (i) => i.value), "kamera yerden baksın", "note kept across re-renders");
assert.equal(await page.evaluate(() => !!document.activeElement && !!document.activeElement.closest('.sb-scene[data-n="2"] .sb-rewrite')), false, "focus not pulled into the note");
await page.click('.sb-scene[data-n="2"] [data-sbv="rewrite-cancel"]');
await page.waitForFunction(() => !document.querySelector(".sb-rewrite"));
ok("Yeniden çiz: frame 1 replaced by rev 1 without reopening; an open note on scene 2 keeps its text and does not steal focus");

// print: A4 landscape PDF of the sheet only
await page.evaluate(() => document.documentElement.classList.add("sb-print"));
await page.emulateMediaType("print");
assert.equal(await gtDisplay(), "none", "GTranslate widget hidden in print");
assert.deepEqual(await page.evaluate(() => [getComputedStyle(document.querySelector(".sb-row")).flexDirection, getComputedStyle(document.querySelector(".sb-scene")).display]), ["row", "block"], "print uses the sheet layout while Büyük is on");
const pdf = Buffer.from(await page.pdf({ preferCSSPageSize: true, printBackground: true }));
fs.writeFileSync(path.join(OUT, "sheet.pdf"), pdf);
const pages = (pdf.toString("latin1").match(/\/Type\s*\/Page[^s]/g) || []).length;
const box = pdf.toString("latin1").match(/\/MediaBox\s*\[\s*0 0 ([\d.]+) ([\d.]+)\s*\]/);
assert.ok(box && +box[1] > +box[2], "landscape MediaBox");
assert.ok(Math.abs(+box[1] - 841.89) < 2 && Math.abs(+box[2] - 595.28) < 3, `A4 landscape, got ${box && box.slice(1).join("x")}`);
await page.emulateMediaType("screen");
await page.evaluate(() => document.documentElement.classList.remove("sb-print"));
ok(`print: A4 landscape PDF (${box[1]}x${box[2]} pt), ${pages} page(s), sheet layout although Büyük is selected`);

await page.keyboard.press("Escape");
await page.waitForFunction(() => document.querySelector("#sb-viewer").hidden);
assert.notEqual(await gtDisplay(), "none", "GTranslate widget back after the viewer closed");
await page.emulateMediaType("print");
assert.equal(await gtDisplay(), "none", "GTranslate widget hidden when the board itself is printed");
await page.emulateMediaType("screen");
ok("Esc closes the viewer; GTranslate widget hidden while it was open and in print, visible again after closing");

// mobile width: no horizontal scroll in the viewer
await page.setViewport({ width: 390, height: 844, isMobile: true });   // isMobile change reloads the page
await page.waitForSelector(`${MINE} [data-sb="open"]`, { timeout: 15000 });
await page.click(`${MINE} [data-sb="open"]`);
await page.waitForSelector("#sb-viewer:not([hidden]) .sb-scene img");
const overflow = await page.$eval(".sb-viewer-inner", (e) => e.scrollWidth - e.clientWidth);
assert.equal(await gtDisplay(), "none", "GTranslate widget hidden over the viewer on a phone");
assert.ok(overflow <= 1, `horizontal overflow ${overflow}px`);
await new Promise((r) => setTimeout(r, 500));   // modal-overlay opacity transition
await page.screenshot({ path: path.join(OUT, "4-viewer-mobile.png") });
ok("mobile 390px: viewer without horizontal scroll, GTranslate widget hidden");

assert.deepEqual(errors, [], "page errors: " + errors.join(" | "));
ok("no page errors");
await browser.close();
console.log(`all ${n} UI checks passed`);
