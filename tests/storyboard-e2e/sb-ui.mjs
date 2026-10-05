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
const browser = await puppeteer.launch({ executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: true, args: ["--lang=tr-TR"] });
const page = await browser.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
page.on("console", (m) => { if (m.type() === "error" && !/favicon|gtranslate|Failed to load resource/i.test(m.text())) errors.push(m.text()); });
await page.setViewport({ width: 1300, height: 900 });
await page.goto(`${STATIC}/fikir.html?api=${encodeURIComponent(API)}`, { waitUntil: "networkidle0" });
await page.click("#anon-btn");
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
const thumbs = await page.$$eval(`${MINE} .sb-card .sb-thumb img`, (l) => l.length);
assert.ok(thumbs >= 3, "thumbs");
await page.screenshot({ path: path.join(OUT, "2-card-done.png") });
ok(`card done: ${thumbs} thumbnails, chip ${await page.$eval(`${MINE} .sb-chip`, (e) => e.textContent)}`);

await page.click(`${MINE} [data-sb="open"]`);
await page.waitForSelector("#sb-viewer:not([hidden]) .sb-scene img");
await page.waitForFunction(() => [...document.querySelectorAll(".sb-scene img")].every((i) => i.complete && i.naturalWidth > 0));
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
assert.match(await page.$eval('.sb-scene[data-n="1"] img', (i) => i.src), /frame_1\.r1\.jpg$/);
await new Promise((r) => setTimeout(r, 800));   // quota refresh after the op ended re-renders the scenes
assert.equal(await page.$eval('.sb-scene[data-n="2"] .sb-rewrite input', (i) => i.value), "kamera yerden baksın", "note kept across re-renders");
assert.equal(await page.evaluate(() => !!document.activeElement && !!document.activeElement.closest('.sb-scene[data-n="2"] .sb-rewrite')), false, "focus not pulled into the note");
await page.click('.sb-scene[data-n="2"] [data-sbv="rewrite-cancel"]');
await page.waitForFunction(() => !document.querySelector(".sb-rewrite"));
ok("Yeniden çiz: frame 1 replaced by rev 1 without reopening; an open note on scene 2 keeps its text and does not steal focus");

// print: A4 landscape PDF of the sheet only
await page.evaluate(() => document.documentElement.classList.add("sb-print"));
await page.emulateMediaType("print");
const pdf = Buffer.from(await page.pdf({ preferCSSPageSize: true, printBackground: true }));
fs.writeFileSync(path.join(OUT, "sheet.pdf"), pdf);
const pages = (pdf.toString("latin1").match(/\/Type\s*\/Page[^s]/g) || []).length;
const box = pdf.toString("latin1").match(/\/MediaBox\s*\[\s*0 0 ([\d.]+) ([\d.]+)\s*\]/);
assert.ok(box && +box[1] > +box[2], "landscape MediaBox");
assert.ok(Math.abs(+box[1] - 841.89) < 2 && Math.abs(+box[2] - 595.28) < 3, `A4 landscape, got ${box && box.slice(1).join("x")}`);
await page.emulateMediaType("screen");
await page.evaluate(() => document.documentElement.classList.remove("sb-print"));
ok(`print: A4 landscape PDF (${box[1]}x${box[2]} pt), ${pages} page(s)`);

await page.keyboard.press("Escape");
await page.waitForFunction(() => document.querySelector("#sb-viewer").hidden);
ok("Esc closes the viewer");

// mobile width: no horizontal scroll in the viewer
await page.setViewport({ width: 390, height: 844, isMobile: true });   // isMobile change reloads the page
await page.waitForSelector(`${MINE} [data-sb="open"]`, { timeout: 15000 });
await page.click(`${MINE} [data-sb="open"]`);
await page.waitForSelector("#sb-viewer:not([hidden]) .sb-scene img");
const overflow = await page.$eval(".sb-viewer-inner", (e) => e.scrollWidth - e.clientWidth);
assert.ok(overflow <= 1, `horizontal overflow ${overflow}px`);
await new Promise((r) => setTimeout(r, 500));   // modal-overlay opacity transition
await page.screenshot({ path: path.join(OUT, "4-viewer-mobile.png") });
ok("mobile 390px: viewer without horizontal scroll");

assert.deepEqual(errors, [], "page errors: " + errors.join(" | "));
ok("no page errors");
await browser.close();
console.log(`all ${n} UI checks passed`);
