// Node harness for worker/index.js invocations measured against the Workers Free per-invocation limits.
// Each loadIsolate() imports the worker with its own module graph (a fresh "isolate": memoized schema setup, caches and
// rate-limit state start empty), so cold and warm invocations can be told apart. The bindings are counting fakes:
//   D1        node:sqlite in memory; counts calls and statements (each statement of a batch counts: the conservative
//             reading of "Queries per Worker invocation", https://developers.cloudflare.com/d1/platform/limits/)
//   R2, Workflows, Browser Run, Workers AI   one subrequest per binding call
//   fetch     globalThis.fetch replaced by a router; one subrequest per call (every redirect hop is its own call: the
//             worker always fetches with redirect: 'manual')
// These counts are independent of the worker's own accounting (worker/budget.js), so a test can compare the two.
// Time is virtual while an invocation runs: timers fire after 1/100 of their delay and Date.now() jumps by the full delay
// when one fires (the worker spaces Instagram requests 3 s and Browser Run calls 11 s apart).
// Used by tests/cron-budget.test.mjs. `node tests/cron-harness.mjs` prints every scenario's counts.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import * as nodeModule from 'node:module';
import { DatabaseSync } from 'node:sqlite';
import { CMAF_VIDEO, CMAF_AUDIO } from './fmp4.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(HERE, '..');
const ROOT_URL = pathToFileURL(ROOT).href + '/';
const FX = (p) => fs.readFileSync(path.join(HERE, 'fixtures', p));
export const CRON_MAIN = '*/15 * * * *';
export const CRON_IG = '7-59/15 * * * *';

// ---------------------------------------------------------------- module loading (one graph per "isolate")
let hooked = false, isoSeq = 0;
function installHooks() {
  if (hooked) return;
  hooked = true;
  const stub = (src) => 'data:text/javascript,' + encodeURIComponent(src);
  nodeModule.registerHooks({
    resolve(spec, ctx, next) {
      if (spec === 'cloudflare:workers') return { url: stub('export class WorkflowEntrypoint {}\nexport class DurableObject {}\nexport class WorkerEntrypoint {}'), format: 'module', shortCircuit: true };
      if (spec === 'cloudflare:workflows') return { url: stub('export class NonRetryableError extends Error {}'), format: 'module', shortCircuit: true };
      const m = ctx.parentURL && /[?&]iso=(\d+)/.exec(ctx.parentURL);
      const r = next(spec, ctx);
      if (!r.url.startsWith(ROOT_URL) || !/\/(worker|assets\/js)\/[^?]*\.m?js(\?|$)/.test(r.url.slice(ROOT_URL.length - 1))) return r;
      // the worker's files are ES modules (package.json has no "type"): skip Node's syntax detection; same isolate as the parent
      return { ...r, url: m && !r.url.includes('?') ? `${r.url}?iso=${m[1]}` : r.url, format: 'module', shortCircuit: true };
    },
  });
}
// node:module registerHooks (Node >= 22.15 / 23.5) loads the worker with stubs for its cloudflare:* imports
export const HARNESS_SUPPORTED = typeof nodeModule.registerHooks === 'function';
// -> the worker's default export ({fetch, scheduled}) from a module graph nobody has used yet
export async function loadIsolate() {
  installHooks();
  const mod = await import(pathToFileURL(path.join(ROOT, 'worker/index.js')).href + '?iso=' + (++isoSeq));
  return mod.default;
}

// ---------------------------------------------------------------- wrangler.toml ([vars] + [triggers] crons)
export function readWranglerToml(file = path.join(ROOT, 'worker/wrangler.toml')) {
  const vars = {};
  let section = '', crons = [];
  for (const raw of fs.readFileSync(file, 'utf8').split('\n')) {
    const line = raw.replace(/\s+#.*$/, '').trim();
    if (!line || line.startsWith('#')) continue;
    const sec = /^\[+([^\]]+)\]+$/.exec(line);
    if (sec) { section = sec[1].trim(); continue; }
    if (section === 'vars') {
      const kv = /^([A-Z0-9_]+)\s*=\s*"([^"]*)"$/.exec(line);
      if (kv) vars[kv[1]] = kv[2];
    } else if (section === 'triggers') {
      const c = /^crons\s*=\s*\[(.*)\]$/.exec(line);
      if (c) crons = [...c[1].matchAll(/"([^"]+)"/g)].map((x) => x[1]);
    }
  }
  return { vars, crons };
}

// ---------------------------------------------------------------- counters
export function makeStats() {
  const s = {
    d1: 0, d1Calls: 0, fetch: 0, r2: 0, wf: 0, br: 0, ai: 0, sqlCpuMs: 0, fakeCpuMs: 0, sql: [], ops: [], urls: [],
    get sub() { return s.fetch + s.r2 + s.wf + s.br + s.ai; },   // subrequests other than D1
    get calls() { return s.d1Calls + s.sub; },                   // every subrequest, D1 calls included
    reset() { Object.assign(s, { d1: 0, d1Calls: 0, fetch: 0, r2: 0, wf: 0, br: 0, ai: 0, sqlCpuMs: 0, fakeCpuMs: 0, sql: [], ops: [], urls: [] }); },
    snapshot() { return { d1: s.d1, d1Calls: s.d1Calls, sub: s.sub, fetch: s.fetch, r2: s.r2, wf: s.wf, br: s.br, ai: s.ai, calls: s.calls }; },
  };
  return s;
}

// ---------------------------------------------------------------- D1 (node:sqlite)
export function makeD1(stats) {
  const sq = new DatabaseSync(':memory:');
  const isRows = (sql) => /^\s*(SELECT|PRAGMA|WITH|VALUES)\b/i.test(sql) || /\bRETURNING\b/i.test(sql);
  const norm = (a) => a.map((v) => {
    if (v === undefined) throw new Error("D1_TYPE_ERROR: Type 'undefined' not supported for value 'undefined'");
    return typeof v === 'boolean' ? (v ? 1 : 0) : v;
  });
  const exec1 = (sql, args) => {
    stats.d1++;
    stats.sql.push(sql.replace(/\s+/g, ' ').trim().slice(0, 110));
    const c0 = threadCpu();
    try {
      const st = sq.prepare(sql);
      if (isRows(sql)) {
        const results = st.all(...args).map((r) => ({ ...r }));
        return { results, success: true, meta: { changes: /\bRETURNING\b/i.test(sql) ? results.length : 0, last_row_id: 0 } };
      }
      const r = st.run(...args);
      return { results: [], success: true, meta: { changes: Number(r.changes), last_row_id: Number(r.lastInsertRowid) } };
    } catch (e) {
      throw new Error('D1_ERROR: ' + e.message);
    } finally {
      const c = threadCpu(c0);
      stats.sqlCpuMs += (c.user + c.system) / 1000;
    }
  };
  const stmt = (sql, args = []) => ({
    __sql: sql, __args: args,
    bind: (...a) => stmt(sql, norm(a)),
    first: async (col) => { stats.d1Calls++; const row = exec1(sql, args).results[0] || null; return col ? (row ? row[col] ?? null : null) : row; },
    all: async () => { stats.d1Calls++; return exec1(sql, args); },
    run: async () => { stats.d1Calls++; return exec1(sql, args); },
    raw: async () => { stats.d1Calls++; return exec1(sql, args).results.map((r) => Object.values(r)); },
  });
  const db = {
    prepare: (sql) => stmt(sql),
    batch: async (list) => {
      stats.d1Calls++;
      sq.exec('BEGIN');
      try { const out = list.map((s) => exec1(s.__sql, s.__args)); sq.exec('COMMIT'); return out; }
      catch (e) { sq.exec('ROLLBACK'); throw e; }
    },
    exec: async (sql) => {
      stats.d1Calls++;
      const parts = sql.split(';').filter((x) => x.trim());
      for (const p of parts) exec1(p, []);
      return { count: parts.length, duration: 0 };
    },
  };
  return { db, sq };
}

// CPU spent inside the fakes (building responses, R2 reading a body: native in workerd) is left out of the worker's figure
// CPU of this thread only (process.cpuUsage() would add V8's background compiler / GC threads)
const threadCpu = typeof process.threadCpuUsage === 'function' ? (prev) => process.threadCpuUsage(prev) : (prev) => process.cpuUsage(prev);
async function fakeCpu(stats, fn) {
  const c0 = threadCpu();
  try { return await fn(); } finally { const c = threadCpu(c0); stats.fakeCpuMs += (c.user + c.system) / 1000; }
}

// ---------------------------------------------------------------- R2, Workflows, Browser Run, AI
// r2.onPut(key): hook run after an object is stored (e.g. a manual preview set meanwhile: the copy's commit then loses)
export function makeR2(stats) {
  const objs = new Map();
  const bump = (op, key) => { stats.r2++; stats.ops.push(`r2.${op} ${Array.isArray(key) ? key.length + ' keys' : key || ''}`); };
  const bytes = async (v) => (v == null ? new Uint8Array(0) : typeof v === 'string' ? new TextEncoder().encode(v)
    : v instanceof ArrayBuffer ? new Uint8Array(v) : ArrayBuffer.isView(v) ? new Uint8Array(v.buffer, v.byteOffset, v.byteLength)
      : new Uint8Array(await new Response(v).arrayBuffer()));
  const obj = (key, x) => ({ key, size: x.b.length, httpEtag: '"t"', writeHttpMetadata() {}, body: new Response(x.b).body });
  const r2 = {
    objs, onPut: null,
    put: async (key, v) => { bump('put', key); const b = await fakeCpu(stats, () => bytes(v)); objs.set(key, { b }); if (r2.onPut) r2.onPut(key); return { key, size: b.length }; },
    get: async (key) => { bump('get', key); const x = objs.get(key); return x ? obj(key, x) : null; },
    head: async (key) => { bump('head', key); const x = objs.get(key); return x ? { ...obj(key, x), body: undefined } : null; },
    delete: async (keys) => { bump('delete', keys); for (const k of [].concat(keys)) objs.delete(k); },
    list: async ({ prefix = '', limit = 1000 } = {}) => {
      bump('list', prefix);
      return { objects: [...objs.keys()].filter((k) => k.startsWith(prefix)).slice(0, limit).map((key) => ({ key })), truncated: false };
    },
  };
  return r2;
}
export function makeWorkflows(stats, status = 'errored') {
  const bump = (op) => { stats.wf++; stats.ops.push('wf.' + op); };
  return {
    get: async (id) => {
      bump('get');
      return { id, status: async () => { bump('status'); return { status, error: { message: 'test' } }; }, terminate: async () => { bump('terminate'); } };
    },
    create: async () => { bump('create'); },
  };
}
// Browser Run Quick Actions: 'content' -> the Instagram page of the URL's code, 'scrape' -> a stock-site scrape
export function makeBrowser(stats, net) {
  return {
    quickAction: (action, opts) => fakeCpu(stats, async () => {
      stats.br++;
      stats.ops.push('br.' + action);
      const h = { 'X-Browser-Ms-Used': '1500' };
      if (action === 'content') {
        const code = /\/(?:reel|p|tv)\/([^/]+)\//.exec(opts.url)[1];
        return new Response(net.igPage(code), { status: 200, headers: { ...h, 'Content-Type': 'text/html; charset=utf-8' } });
      }
      return new Response(FX('media/br-scrape-magnific.json'), { status: 200, headers: { ...h, 'Content-Type': 'application/json' } });
    }),
  };
}
export function makeAI(stats) {
  return { run: async () => { stats.ai++; stats.ops.push('ai.run'); return {}; } };
}

// ---------------------------------------------------------------- outbound fetch
// Instagram: the page of a code is tests/fixtures/video/ig-reel.html with that code (padKB pads it like the real
// 0.8-0.95 MB pages); embeds by state; CDN files are small MP4 / JPEG bodies with valid magic bytes; magnific.com pages
// answer the 403 security filter (link previews then need Browser Run).
// The other copy platforms answer with their fixtures (tests/fixtures/video): X syndication JSON, the TikTok page (+ its
// tt_chain_token cookie), Pinterest PinResource (pin id 1… video pin, 2… idea pin: HLS only, 3… image pin) and the HEADs of
// an idea pin's progressive file, the Reddit feed + DASH playlist + CMAF picture / sound files (tests/fmp4.mjs), the
// Facebook reel page.
//   ig: 'ok' (plain fetch finds the post) | 'login' (redirect to the login page: Browser Run needed)
//   embed(code): 'blocked' | 'ok' | 'photo' | 'fail' (HTTP 500)
//   deadCached: Instagram CDN links seeded by seedIgCache answer 404 (cached links that died; fresh ones work)
//   redirects: hops every non-Instagram request goes through first (the worker follows <= 3 for files, <= 2 for a
//              platform's page / API); a number, or (url) => number
//   pinHeadOk: the n-th HEAD of an idea pin's progressive-file candidates that answers 200 (the others 403)
//   redditFeed: HTTP status of Reddit's post feed (200, or e.g. 429: rate-limited)
export function makeFetch(stats, opts = {}) {
  const o = { ig: 'ok', embed: () => 'ok', padKB: 0, deadCached: false, redirects: 0, videoBytes: 300000, pinHeadOk: 1, redditFeed: 200, ...opts };
  const pad = o.padKB ? `<script type="application/json" data-sjs>{"pad":"${'x'.repeat(o.padKB * 1024)}"}</script>` : '';
  const reel = FX('video/ig-reel.html').toString('utf8');
  const igPage = (code) => reel.replaceAll('DTestReel01', code).replace('</body>', pad + '</body>');
  const embeds = { blocked: FX('video/ig-embed-blocked.html').toString('utf8'), ok: FX('video/ig-embed-ok.html').toString('utf8'), photo: FX('video/ig-embed-photo.html').toString('utf8') };
  const hops = new Map();
  let pinHeads = 0;
  const html = (body, status = 200, extra = {}) => new Response(body, { status, headers: { 'Content-Type': 'text/html; charset=utf-8', ...extra } });
  const typed = (body, type, status = 200, extra = {}) => new Response(body, { status, headers: { 'Content-Type': type, ...extra } });
  const file = (bytes, range) => {
    const m = range && /bytes=0-(\d+)/.exec(range);
    const b = m ? bytes.subarray(0, Number(m[1]) + 1) : bytes;
    return new Response(b, { status: m ? 206 : 200, headers: { 'Content-Type': 'video/mp4', 'Content-Length': String(b.length) } });
  };
  const redirectsFor = (u) => (typeof o.redirects === 'function' ? o.redirects(u) : o.redirects);
  const fetchFn = (input, init = {}) => fakeCpu(stats, async () => respond(input, init));
  const respond = (input, init) => {
    const url = typeof input === 'string' ? input : input.url;
    stats.fetch++;
    stats.urls.push(url.slice(0, 140));
    const u = new URL(url);
    const hdr = init.headers || {};
    const accept = String(hdr.Accept || hdr.accept || '');
    const redirects = u.hostname !== 'www.instagram.com' ? redirectsFor(u) : 0;
    if (redirects) {
      const key = u.href.replace(/[?&]_hop=\d+$/, '');
      const n = hops.get(key) || 0;
      if (n < redirects) {
        hops.set(key, n + 1);
        return new Response(null, { status: 302, headers: { Location: key + (key.includes('?') ? '&' : '?') + '_hop=' + (n + 1) } });
      }
      hops.delete(key);
    }
    if (u.hostname === 'www.instagram.com') {
      const m = /^\/(reel|p|tv)\/([^/]+)\/(embed\/)?$/.exec(u.pathname);
      if (!m) return html('not found', 404);
      if (m[3]) { const st = o.embed(m[2]); return st === 'fail' ? html('error', 500) : html(embeds[st] || embeds.ok); }
      if (o.ig === 'login') return new Response(null, { status: 302, headers: { Location: 'https://www.instagram.com/accounts/login/?next=' + encodeURIComponent(u.pathname) } });
      return html(igPage(m[2]));
    }
    if (/(^|\.)magnific\.com$/.test(u.hostname)) return html(FX('media/magnific-security-filter.html'), 403);
    const range = hdr.Range || hdr.range;
    // the other copy platforms (their adapters in worker/inspire-video.js)
    if (u.hostname === 'cdn.syndication.twimg.com') return typed(FX('video/x-video.json'), 'application/json');
    if (u.hostname === 'www.tiktok.com' && /^\/@[^/]*\/video\/\d+$/.test(u.pathname)) {
      return html(FX('video/tiktok-video.html'), 200, { 'Set-Cookie': 'tt_chain_token=HarnessToken01; path=/; secure' });
    }
    if (u.hostname === 'www.pinterest.com' && u.pathname === '/resource/PinResource/get/') {
      const id = (/"id":"(\d+)"/.exec(u.searchParams.get('data') || '') || [])[1] || '';
      return typed(FX(`video/${id.startsWith('2') ? 'pin-story' : id.startsWith('3') ? 'pin-image' : 'pin-video'}.json`), 'application/json');
    }
    if (u.hostname === 'v1.pinimg.com' && (init.method || 'GET') === 'HEAD') {
      return ++pinHeads === o.pinHeadOk ? typed(null, 'video/mp4', 200, { 'Content-Length': '300000' }) : typed(null, 'text/html', 403);
    }
    if (/^(www|old)\.reddit\.com$/.test(u.hostname) && u.pathname.endsWith('/.rss')) {
      return o.redditFeed === 200 ? typed(FX('video/reddit-post.rss'), 'application/atom+xml') : typed('Too Many Requests', 'text/plain', o.redditFeed);
    }
    if (u.hostname === 'v.redd.it') {
      if (u.pathname.endsWith('/DASHPlaylist.mpd')) return typed(FX('video/reddit-dash.mpd'), 'application/dash+xml');
      if (/\/CMAF_AUDIO_\d+\.mp4$/.test(u.pathname)) return file(CMAF_AUDIO, range);
      if (/\/CMAF_\d+\.mp4$/.test(u.pathname)) return file(CMAF_VIDEO, range);
    }
    if (u.hostname === 'www.facebook.com' && u.pathname.startsWith('/reel/')) return html(FX('video/fb-reel.html'));
    const video = /video/.test(accept) || /\.mp4$/.test(u.pathname);
    if (o.deadCached && /(cdninstagram\.com|fbcdn\.net)$/.test(u.hostname) && u.pathname.includes('/CACHED-')) return new Response('gone', { status: 404 });
    if (video) {
      const n = o.videoBytes;
      const b = new Uint8Array(n);
      b.set([0, 0, 0, 0x20, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d, 0, 0, 2, 0, 0x69, 0x73, 0x6f, 0x6d], 0);
      if (range) return new Response(b.subarray(0, 1), { status: 206, headers: { 'Content-Type': 'video/mp4', 'Content-Range': `bytes 0-0/${n}` } });
      return new Response(b, { status: 200, headers: { 'Content-Type': 'video/mp4', 'Content-Length': String(n) } });
    }
    const jpg = FX('media/poster.jpg');
    if (range) return new Response(jpg.subarray(0, 1), { status: 206, headers: { 'Content-Type': 'image/jpeg', 'Content-Range': `bytes 0-0/${jpg.length}` } });
    return new Response(jpg, { status: 200, headers: { 'Content-Type': 'image/jpeg', 'Content-Length': String(jpg.length) } });
  };
  return { fetchFn, igPage };
}

// ---------------------------------------------------------------- the simulated deployment
// One D1 / R2 / Workflows set shared by every isolate (like production); env = worker/wrangler.toml [vars] + vars.
export function makeWorld({ vars = {}, fetchOpts = {}, wfStatus = 'errored' } = {}) {
  const stats = makeStats();
  const { db, sq } = makeD1(stats);
  const r2 = makeR2(stats);
  const net = makeFetch(stats, fetchOpts);
  const toml = readWranglerToml();
  const env = {
    ...toml.vars,
    ALLOWED_ORIGIN: 'https://board.example',
    JWT_SECRET: 'harness-secret',
    ADMIN_PASSWORD: 'harness-admin',
    FIKIR_BOARD_PASSWORD: 'harness-board-pass',   // TEST value (board password gate, worker/fikir-gate.js)
    DB: db, STORAGE: r2, STORYBOARD_WF: makeWorkflows(stats, wfStatus), BROWSER: makeBrowser(stats, net), AI: makeAI(stats),
    ...vars,
  };
  return { stats, db, sq, r2, env, net, crons: toml.crons };
}

let clockOffset = 0;
async function withVirtualTime(scale, fn) {
  const st = globalThis.setTimeout, now = Date.now;
  globalThis.setTimeout = (cb, ms, ...a) => st((...x) => { clockOffset += Number(ms) || 0; cb(...x); }, Math.ceil((Number(ms) || 0) / scale), ...a);
  Date.now = () => now() + clockOffset;
  try { return await fn(); } finally { globalThis.setTimeout = st; Date.now = now; }
}
// Between runs: as if `seconds` had passed (rate-limit windows and backoffs see it)
export function advanceClock(seconds) { clockOffset += seconds * 1000; }
export const nowS = () => Math.floor((Date.now() + clockOffset) / 1000);
async function settle(ps) {
  for (let seen = 0; seen < ps.length;) { const n = ps.length; await Promise.allSettled(ps.slice(seen)); seen = n; }
}
async function capture(fn) {
  const lines = [];
  const ol = console.log, oe = console.error, ow = console.warn;
  console.log = (...a) => lines.push(['log', a.map(String).join(' ')]);
  console.error = (...a) => lines.push(['error', a.map((x) => (x && x.stack) || String(x)).join(' ')]);
  console.warn = (...a) => lines.push(['warn', a.map(String).join(' ')]);
  try { return { r: await fn(), lines }; } finally { console.log = ol; console.error = oe; console.warn = ow; }
}
async function measure(world, fn) {
  const { stats } = world;
  stats.reset();
  const prevFetch = globalThis.fetch;
  globalThis.fetch = world.net.fetchFn;
  const t0 = performance.now();
  const c0 = threadCpu();
  try {
    const { r, lines } = await capture(() => withVirtualTime(100, fn));
    const c = threadCpu(c0);
    const own = lines.map((l) => /^cron (\w+): D1 (\d+)\/\d+ statements in (\d+) calls, subrequests (\d+)\/\d+/.exec(l[1])).find(Boolean);
    return {
      ...stats.snapshot(), result: r, lines,
      errors: lines.filter((l) => l[0] === 'error').map((l) => l[1]),
      budget: own ? { task: own[1], d1: Number(own[2]), d1Calls: Number(own[3]), sub: Number(own[4]) } : null,
      cpuMs: Math.max(0, (c.user + c.system) / 1000 - stats.sqlCpuMs - stats.fakeCpuMs), wallMs: performance.now() - t0,
      sql: stats.sql.slice(), ops: stats.ops.slice(), urls: stats.urls.slice(),
    };
  } finally { globalThis.fetch = prevFetch; }
}

// One scheduled() invocation (controller.cron = cron); waits for every ctx.waitUntil promise.
export function runScheduled(world, worker, cron) {
  return measure(world, async () => {
    const ps = [];
    const ctx = { waitUntil: (p) => ps.push(Promise.resolve(p)), passThroughOnException() {} };
    ps.push(Promise.resolve(worker.scheduled({ cron, scheduledTime: Date.now(), noRetry() {} }, world.env, ctx)));
    await settle(ps);
  });
}
// One fetch() invocation; reads the whole response body (a download streams through the worker).
// headers: extra request headers; legacy: no "X-Fikir-Client: 2" (an old cached board page).
// -> {status, bytes, json, headers, text, waits (ctx.waitUntil calls: work that outlives a client disconnect)}
export function runRequest(world, worker, method, pathname, { token = null, body = null, ip = '203.0.113.7', headers: extra = {}, legacy = false } = {}) {
  return measure(world, async () => {
    const ps = [];
    const ctx = { waitUntil: (p) => ps.push(Promise.resolve(p)), passThroughOnException() {} };
    const headers = { 'CF-Connecting-IP': ip, ...(legacy ? {} : { 'X-Fikir-Client': '2' }), ...extra };
    if (token) headers.Authorization = 'Bearer ' + token;
    if (body) headers['Content-Type'] = 'application/json';
    const res = await worker.fetch(new Request('https://api.example' + pathname, { method, headers, body: body ? JSON.stringify(body) : undefined }), world.env, ctx);
    const buf = Buffer.from(await res.arrayBuffer());
    await settle(ps);
    let json = null;
    try { json = JSON.parse(buf.toString('utf8')); } catch (e) {}
    return { status: res.status, bytes: buf.length, json, headers: Object.fromEntries(res.headers), text: () => buf.toString('utf8'), waits: ps.length };
  });
}

// ---------------------------------------------------------------- seeding (straight into SQLite: not counted)
export const sqlAll = (world, sql, ...a) => world.sq.prepare(sql).all(...a).map((r) => ({ ...r }));
export const sqlRun = (world, sql, ...a) => world.sq.prepare(sql).run(...a);
// A world whose schema the board's first request created (in its own isolate), plus that warm isolate.
export async function readyWorld(opts = {}) {
  const w = makeWorld(opts);
  const warm = await loadIsolate();
  const r = await runRequest(w, warm, 'GET', '/api/inspire/config');
  if (r.result.status !== 200) throw new Error('config ' + r.result.status);
  return { w, warm };
}
export async function guestToken(world, worker, cid = 'harness-cid-0001') {
  const r = await runRequest(world, worker, 'POST', '/api/inspire/guest', { body: { cid, name: 'Deneme', password: world.env.FIKIR_BOARD_PASSWORD } });
  return r.result.json.token;
}
export async function adminToken(world, worker) {
  const r = await runRequest(world, worker, 'POST', '/api/inspire/login', { body: { username: 'vkesgin38', password: world.env.ADMIN_PASSWORD } });
  return r.result.json && r.result.json.token;
}
const guestRow = (world) => sqlAll(world, "SELECT id FROM inspire_users WHERE username='__guest__'")[0].id;
// Instagram posts of guest cid harness-cid-0001; -> ids
export function seedIgPosts(world, codes, { kind = 'reel' } = {}) {
  const g = guestRow(world);
  return codes.map((c) => Number(sqlRun(world, "INSERT INTO inspire_posts (user_id, type, url, description, url_key, client_id) VALUES (?, 'instagram', ?, '', ?, 'harness-cid-0001')",
    g, `https://www.instagram.com/${kind}/${c}/`, `instagram:${c}`).lastInsertRowid));
}
// Posts of the other copy platforms (guest cid harness-cid-0001; urls of the fixtures' ids); -> {name: id}
export const PLATFORM_POSTS = {
  x: ['x', 'https://x.com/ornek_studio/status/1900000000000000001'],
  tiktok: ['tiktok', 'https://www.tiktok.com/@ornek.tiktok/video/7000000000000000001'],
  facebook: ['facebook', 'https://www.facebook.com/reel/500000000000001'],
  pinVideo: ['pinterest', 'https://www.pinterest.com/pin/100000000000000001/'],
  pinIdea: ['pinterest', 'https://www.pinterest.com/pin/200000000000000001/'],
  pinImage: ['pinterest', 'https://www.pinterest.com/pin/300000000000000001/'],
  reddit: ['web', 'https://www.reddit.com/r/ornek/comments/1abcdef/ornek_makine/'],
  youtube: ['youtube', 'https://www.youtube.com/watch?v=dQw4w9WgXcQ'],
};
// The Reddit post's link preview as the board stores it (its v.redd.it picture-only file: no feed request needed)
export const REDDIT_PREVIEW_META = { v: 2, via: 'plain', title: 'Örnek makine', provider: 'reddit.com',
  media: { mv: 1, kind: 'video', url: 'https://v.redd.it/testvid0001/CMAF_720.mp4', poster: 'https://external-preview.redd.it/TestThumb01.png', autoplay: true, verified: true, source: 'og' } };
let seedSeq = 0;
export function seedPlatformPosts(world, names, { meta = {} } = {}) {
  const g = guestRow(world);
  const out = {};
  for (const n of names) {
    const [type, url] = PLATFORM_POSTS[n];
    out[n] = Number(sqlRun(world, "INSERT INTO inspire_posts (user_id, type, url, description, url_key, client_id, meta) VALUES (?, ?, ?, '', ?, 'harness-cid-0001', ?)",
      g, type, url, `harness:${n}:${++seedSeq}`, meta[n] ? JSON.stringify(meta[n]) : null).lastInsertRowid);
  }
  return out;
}
// The worst redirect chains the worker still follows: a platform's page / API 2 hops (adFetch), files 3 hops (openMedia);
// Reddit's picture file none (its first bytes are read with a Range request that never follows a redirect)
export function worstHops(u) {
  const h = u.hostname;
  if (['cdn.syndication.twimg.com', 'www.tiktok.com', 'www.pinterest.com', 'www.reddit.com', 'www.facebook.com'].includes(h)) return 2;
  if (h === 'v1.pinimg.com') return 2;   // HEADs of an idea pin's progressive file go through adFetch too (its GET follows 3: same key)
  if (h === 'v.redd.it') return u.pathname.endsWith('.mpd') ? 2 : /CMAF_AUDIO/.test(u.pathname) ? 3 : 0;
  return 3;
}
export function seedEmbedState(world, ids, state) {
  const now = nowS();
  for (const id of ids) sqlRun(world, "INSERT OR REPLACE INTO inspire_video_cache (post_id, kind, resolved_at, retry_at, extra) VALUES (?, 'ig_embed', ?, ?, ?)", id, now, now + 30 * 86400, JSON.stringify({ state }));
}
// A cached Instagram resolution (the fixture's CDN links), still fresh
export function seedIgCache(world, ids) {
  const now = nowS();
  for (const id of ids) {
    sqlRun(world, `INSERT OR REPLACE INTO inspire_video_cache (post_id, kind, url, poster, width, height, expires_at, resolved_at, fail_count, extra)
      VALUES (?, 'ig', ?, ?, 720, 1280, ?, ?, 0, ?)`, id, `https://scontent-ams2-1.cdninstagram.com/o1/v/t2/f2/m86/CACHED-${id}.mp4?_nc_cat=104&oe=6AC94349&oh=00_v`,
    'https://scontent-ams2-1.cdninstagram.com/v/t51.0-15/poster_720.jpg?oe=6ACD0906&oh=00_p', now + 86400, now, JSON.stringify({ user: 'ornek.studio', has_audio: true }));
  }
}
// The site-wide Browser Run slot taken for `seconds` more (a copy then waits for it once)
export function takeBrSlot(world, seconds = 4) {
  sqlRun(world, 'INSERT OR REPLACE INTO inspire_rate (k, n, reset) VALUES (?, 1, ?)', 'br_slot:all', nowS() + seconds);
}
// A manual preview lands on the post while its copy uploads (the copy's commit then loses: the undo path)
export function loseCommitOnPut(world) {
  world.r2.onPut = (key) => {
    const m = /^fikir\/(\d+)\/v-/.exec(key);
    if (m) sqlRun(world, 'UPDATE inspire_posts SET media=? WHERE id=?', JSON.stringify({ kind: 'image', url: 'https://cdn.example/manual.jpg' }), Number(m[1]));
  };
}
// Every queue of the "*/15" run full: stale storyboard builds + ops, orphans, upload rows to sweep, due Browser Run rows
export function seedMainBacklog(world, { stale = 12, staleOps = 12, orphans = 6, media = 150, brDue = 12 } = {}) {
  const g = guestRow(world);
  const post = () => Number(sqlRun(world, "INSERT INTO inspire_posts (user_id, type, url, description) VALUES (?, 'text', '', 'x')", g).lastInsertRowid);
  const sb = (id, postId, status = 'running') => sqlRun(world, `INSERT INTO sb_storyboards (id, post_id, status, stage, input_json, seed, day, created_at, updated_at)
    VALUES (?, ?, ?, 'draft', '{}', 1, '2026-01-01', 0, 0)`, id, postId, status);
  for (let i = 0; i < stale; i++) sb(`sbstale${i}`, post());
  for (let i = 0; i < staleOps; i++) {
    sb(`sbop${i}`, post(), 'done');
    sqlRun(world, "INSERT INTO sb_ops (id, sb_id, kind, n, status, day, created_at, updated_at) VALUES (?, ?, 'frame', ?, 'running', '2026-01-01', 0, 0)", `op${i}`, `sbop${i}`, i);
  }
  for (let i = 0; i < orphans; i++) {
    sb(`sborphan${i}`, 900000 + i, 'done');
    sqlRun(world, "INSERT INTO sb_ops (id, sb_id, kind, n, status, day, created_at, updated_at) VALUES (?, ?, 'frame', 1, 'queued', '2026-01-01', 0, 0)", `orphanop${i}`, `sborphan${i}`);
    sqlRun(world, "INSERT INTO sb_images (sb_id, job, kind, updated_at) VALUES (?, 'f1', 'frame', 0)", `sbgone${i}`);
  }
  const now = nowS();
  for (let i = 0; i < media; i++) {
    sqlRun(world, "INSERT INTO inspire_media (key, post_id, slot, subject, mime, bytes, state, created_at) VALUES (?, 1, 'v', 'x', 'video/mp4', 10, 'orphan', ?)",
      `fikir/1/v-${String(i).padStart(32, '0')}.mp4`, now);
  }
  for (let i = 0; i < brDue; i++) {
    sqlRun(world, "INSERT INTO inspire_posts (user_id, type, url, description, meta) VALUES (?, 'web', ?, '', ?)", g, `https://www.magnific.com/premium-video/clip-${i}_${1000 + i}`,
      JSON.stringify({ failed: 1, v: 2, at: now - 3600, retry_s: 15, pending: 'br' }));
  }
}

// ---------------------------------------------------------------- scenarios (tests/cron-budget.test.mjs asserts them)
// -> [{label, kind: 'cron' | 'unit' | 'request', cost?: CRON_COSTS key, fixed?: statements outside the unit, m}]
const BLOCKED = ['BLOCKa00001', 'BLOCKa00002', 'BLOCKa00003', 'BLOCKa00004'];
const UNCHECKED = ['Cunchk00001', 'Cunchk00002', 'Cunchk00003', 'Cunchk00004', 'Cunchk00005'];
const embedOf = (c) => (c.startsWith('B') ? 'blocked' : 'ok');
async function igWorld(fetchOpts = {}, vars = {}) {
  const x = await readyWorld({ fetchOpts: { embed: embedOf, ...fetchOpts }, vars });
  const blocked = seedIgPosts(x.w, BLOCKED);
  seedEmbedState(x.w, blocked, 'blocked');
  seedIgPosts(x.w, UNCHECKED);
  return { ...x, blocked };
}
const count = (w, sql) => sqlAll(w, sql)[0].n;
const backlogFacts = (w) => ({
  staleOpen: count(w, "SELECT COUNT(*) AS n FROM sb_storyboards WHERE status IN ('queued','running')"),
  opsOpen: count(w, "SELECT COUNT(*) AS n FROM sb_ops WHERE status IN ('queued','running')"),
  orphans: count(w, 'SELECT COUNT(*) AS n FROM sb_storyboards s WHERE NOT EXISTS (SELECT 1 FROM inspire_posts p WHERE p.id = s.post_id)'),
  mediaRows: count(w, 'SELECT COUNT(*) AS n FROM inspire_media'),
  brPending: count(w, `SELECT COUNT(*) AS n FROM inspire_posts WHERE meta LIKE '%"pending":"br"%'`),
});
const copyFacts = (w) => {
  const by = Object.fromEntries(sqlAll(w, "SELECT json_extract(media, '$.source') AS s, COUNT(*) AS n FROM inspire_posts WHERE media IS NOT NULL GROUP BY 1").map((r) => [r.s, r.n]));
  return {
    by, copied: Object.values(by).reduce((a, b) => a + b, 0),
    records: sqlAll(w, "SELECT kind, error, retry_at FROM inspire_video_cache WHERE kind IN ('ig_copy', 'ad_copy')"),
    mediaRows: count(w, 'SELECT COUNT(*) AS n FROM inspire_media'), r2Objects: w.r2.objs.size,
    media: sqlAll(w, 'SELECT id, media FROM inspire_posts WHERE media IS NOT NULL').map((r) => ({ id: r.id, ...JSON.parse(r.media) })),
  };
};
const igFacts = (w) => ({
  copied: count(w, "SELECT COUNT(*) AS n FROM inspire_posts WHERE json_extract(media, '$.source') = 'instagram'"),
  embedRows: count(w, "SELECT COUNT(*) AS n FROM inspire_video_cache WHERE kind = 'ig_embed'"),
  staleMarked: count(w, "SELECT COUNT(*) AS n FROM inspire_video_cache WHERE kind = 'ig' AND expires_at = 1"),
  mediaRows: count(w, 'SELECT COUNT(*) AS n FROM inspire_media'),
  r2Objects: w.r2.objs.size,
});
export async function scenarios() {
  const out = [];
  const add = (label, kind, m, extra = {}) => { out.push({ label, kind, m, ...extra }); };

  // "*/15": storyboard reconcile + housekeeping + link-preview Browser Run retries
  {
    const { w, warm } = await readyWorld();
    add('main, empty queues, cold isolate', 'cron', await runScheduled(w, await loadIsolate(), CRON_MAIN));
    add('main, empty queues, warm isolate', 'cron', await runScheduled(w, warm, CRON_MAIN));
    add('main, unknown cron string (manual run), warm', 'cron', await runScheduled(w, warm, ''), { task: 'main' });
  }
  {
    const { w, warm } = await readyWorld({ fetchOpts: { redirects: 3 } });
    seedMainBacklog(w);
    const before = backlogFacts(w);
    add('main, every queue full, 3-hop redirects, cold', 'cron', await runScheduled(w, await loadIsolate(), CRON_MAIN), { before, facts: backlogFacts(w) });
    advanceClock(900);
    add('main, every queue full (2nd run), warm', 'cron', await runScheduled(w, warm, CRON_MAIN), { facts: backlogFacts(w) });
    advanceClock(900);
    add('main, every queue full (3rd run), warm', 'cron', await runScheduled(w, warm, CRON_MAIN), { facts: backlogFacts(w) });
  }
  {
    // one due Browser Run retry, nothing else: unit = run - fixed part (warm: storyboard selects 2 + orphan selects 2 +
    // prune 2, upload select 1 + prune 2, due-rows select 1 = 10)
    const { w, warm } = await readyWorld({ fetchOpts: { redirects: 3 } });
    seedMainBacklog(w, { stale: 0, staleOps: 0, orphans: 0, media: 0, brDue: 1 });
    add('main, one Browser Run retry (3-hop probes), warm', 'unit', await runScheduled(w, warm, CRON_MAIN), { cost: 'brRetry', fixed: 10, facts: backlogFacts(w) });
  }
  {
    const w = makeWorld();   // schema never created: the cron must not migrate
    add('main, no schema yet (fresh database), cold', 'cron', await runScheduled(w, await loadIsolate(), CRON_MAIN),
      { facts: { tables: count(w, "SELECT COUNT(*) AS n FROM sqlite_master WHERE type = 'table'") } });
    add('ig, no schema yet (fresh database), cold', 'cron', await runScheduled(w, await loadIsolate(), CRON_IG),
      { facts: { tables: count(w, "SELECT COUNT(*) AS n FROM sqlite_master WHERE type = 'table'") } });
  }

  // "7-59/15": Instagram copies + embed checks
  {
    const { w, warm } = await igWorld({ ig: 'ok' });
    add('ig, plain resolve, cold', 'cron', await runScheduled(w, await loadIsolate(), CRON_IG), { facts: igFacts(w) });
    advanceClock(900);
    add('ig, plain resolve (2nd run), warm', 'cron', await runScheduled(w, warm, CRON_IG), { facts: igFacts(w) });
  }
  {
    // the earlier rollout step (FIKIR_IG_AUTO=blocked, one copy per run): a copy and the embed checks in every run
    const { w, warm } = await igWorld({ ig: 'ok' }, { FIKIR_IG_AUTO: 'blocked', FIKIR_IG_CRON_COPIES: '1' });
    add('ig, blocked only, one copy per run, cold', 'cron', await runScheduled(w, await loadIsolate(), CRON_IG), { facts: igFacts(w) });
    advanceClock(900);
    add('ig, blocked only, one copy per run (2nd run), warm', 'cron', await runScheduled(w, warm, CRON_IG), { facts: igFacts(w) });
  }
  {
    const { w, warm } = await igWorld({ ig: 'login', redirects: 3 });
    add('ig, Browser Run resolve, 3-hop CDN, cold', 'cron', await runScheduled(w, await loadIsolate(), CRON_IG), { facts: igFacts(w) });
    advanceClock(900);
    takeBrSlot(w);
    add('ig, Browser Run after a slot wait, warm', 'cron', await runScheduled(w, warm, CRON_IG), { facts: igFacts(w) });
  }
  {
    // worst copy: Browser Run after a slot wait, 3-hop CDN links, the commit lost to a manual preview (undo path);
    // no embed checks: unit = run - fixed part (warm: cleanup 1 + queue select 1)
    const { w, warm } = await igWorld({ ig: 'login', redirects: 3 }, { FIKIR_IG_CRON_CHECKS: '0', FIKIR_IG_CRON_COPIES: '1' });
    takeBrSlot(w);
    loseCommitOnPut(w);
    add('ig, worst copy (slot wait, redirects, commit lost), warm', 'unit', await runScheduled(w, warm, CRON_IG), { cost: 'igCopy', fixed: 2, facts: igFacts(w) });
  }
  {
    // a cached link that died: the cron marks it stale and fails softly (no second resolve in the same run) ...
    const { w, warm, blocked } = await igWorld({ ig: 'login', deadCached: true }, { FIKIR_IG_CRON_CHECKS: '0', FIKIR_IG_CRON_COPIES: '1' });
    seedIgCache(w, blocked);
    add('ig, cached link dead (soft failure), warm', 'unit', await runScheduled(w, warm, CRON_IG), { cost: 'igCopy', fixed: 2, facts: igFacts(w) });
    advanceClock(900);   // ... and the next run (past the 10-minute backoff) resolves the post again and copies it
    add('ig, next run resolves it again, warm', 'unit', await runScheduled(w, warm, CRON_IG), { cost: 'igCopy', fixed: 2, facts: igFacts(w) });
  }
  {
    // embed check whose fetch fails (failure record: 2 statements); no copies: unit = run - fixed (cleanup + select)
    const { w, warm } = await igWorld({ embed: () => 'fail' }, { FIKIR_IG_CRON_COPIES: '0', FIKIR_IG_CRON_CHECKS: '1' });
    add('ig, one failing embed check, warm', 'unit', await runScheduled(w, warm, CRON_IG), { cost: 'igCheck', fixed: 2, facts: igFacts(w) });
  }
  {
    const { w } = await igWorld({ ig: 'ok' }, { FIKIR_IG_AUTO: 'all' });
    seedIgPosts(w, Array.from({ length: 30 }, (_, i) => `Pall${String(i).padStart(7, '0')}`), { kind: 'p' });
    add('ig, FIKIR_IG_AUTO=all with 39 posts, cold', 'cron', await runScheduled(w, await loadIsolate(), CRON_IG), { facts: igFacts(w) });
  }

  {
    // the second Instagram copy of a run never uses Browser Run: its worst case (plain resolve, 3-hop CDN, the commit lost)
    // measured as a unit (Browser Run off; unit = run - fixed: cleanup 1 + queue select 1)
    const { w, warm } = await igWorld({ ig: 'ok', redirects: 3 }, { FIKIR_IG_CRON_CHECKS: '0', FIKIR_IG_CRON_COPIES: '1', FIKIR_BR: '0' });
    loseCommitOnPut(w);
    add('ig, plain copy worst (3-hop CDN, commit lost), warm', 'unit', await runScheduled(w, warm, CRON_IG), { cost: 'igCopyPlain', fixed: 2, facts: igFacts(w) });
  }

  // "7-59/15": copies of the other platforms (adapters), one per run as a unit (unit = run - fixed: cleanup 1 + select 1)
  {
    // cost: the platform's own worst case (CRON_COSTS.adCopyBy.<platform>); every one is also within CRON_COSTS.adCopy
    const unit = async (label, names, fetchOpts = {}, { meta = {}, lose = false, vars = {} } = {}) => {
      const x = await readyWorld({ fetchOpts: { redirects: worstHops, ...fetchOpts }, vars: { FIKIR_IG_CRON_CHECKS: '0', FIKIR_IG_CRON_COPIES: '1', ...vars } });
      const ids = seedPlatformPosts(x.w, names, { meta });
      if (lose) loseCommitOnPut(x.w);
      const pf = PLATFORM_POSTS[names[0]][0] === 'web' ? 'reddit' : PLATFORM_POSTS[names[0]][0];
      add(label, 'unit', await runScheduled(x.w, x.warm, CRON_IG), { cost: 'adCopyBy.' + pf, fixed: 2, ids, facts: copyFacts(x.w) });
    };
    await unit('copy, TikTok (page + cookie, worst redirects), warm', ['tiktok']);
    await unit('copy, X (syndication, worst redirects), warm', ['x']);
    await unit('copy, Facebook reel (poster size, worst redirects), warm', ['facebook']);
    await unit('copy, Pinterest idea pin (4 HEADs, worst redirects), warm', ['pinIdea'], { pinHeadOk: 4 });
    await unit('copy, Reddit (feed + DASH + picture/sound mux, worst redirects), warm', ['reddit']);
    await unit('copy, Reddit with a link-preview video (feed read for author + title), warm', ['reddit'], {}, { meta: { reddit: REDDIT_PREVIEW_META } });
    await unit('copy, Reddit feed refused (429): the preview video, its generic title dropped, warm', ['reddit'], { redditFeed: 429 },
      { meta: { reddit: { ...REDDIT_PREVIEW_META, title: 'Reddit - İnternetin kalbi' } } });
    await unit('copy, TikTok commit lost (undo), warm', ['tiktok'], {}, { lose: true });
    await unit('copy, image pin (no video: 30-day record), warm', ['pinImage']);
  }
  {
    // the production queue: every platform waiting, two copies per run (Browser Run never for the second), 3 runs
    const { w, warm } = await igWorld({ ig: 'ok' });
    seedPlatformPosts(w, ['x', 'tiktok', 'facebook', 'pinVideo', 'pinImage', 'reddit', 'youtube']);
    add('ig, every platform queued (1st run), cold', 'cron', await runScheduled(w, await loadIsolate(), CRON_IG), { facts: copyFacts(w) });
    for (const n of [2, 3, 4, 5, 6, 7, 8]) {
      advanceClock(900);
      add(`ig, every platform queued (run ${n}), warm`, 'cron', await runScheduled(w, warm, CRON_IG), { facts: copyFacts(w) });
    }
  }

  // requests that can do heavy work, on cold isolates (the board's first request after an isolate starts)
  {
    const { w, warm } = await readyWorld({ fetchOpts: { ig: 'login', deadCached: true, redirects: 3 } });
    const tok = await guestToken(w, warm);
    const [a, b, c, d] = seedIgPosts(w, ['Rdownl00001', 'Rcopy000001', 'Rcopy000002', 'Rrep0000001']);
    seedIgCache(w, [a, b]);
    seedEmbedState(w, [b, c], 'blocked');   // guests copy only reels whose embed was found blocked
    // a download is a navigation without the session header: the link of download-info carries the session's ticket (?k=)
    const link = (await runRequest(w, warm, 'GET', `/api/inspire/posts/${a}/download-info`, { token: tok })).result.json.url;
    add('GET download (IG: cached link dead, Browser Run re-resolve, redirects), cold', 'request',
      await runRequest(w, await loadIsolate(), 'GET', `${link}&part=video`), { status: 200 });
    add('POST ig-copy (guest: cached link dead, Browser Run re-resolve, redirects), cold', 'request',
      await runRequest(w, await loadIsolate(), 'POST', `/api/inspire/posts/${b}/ig-copy`, { token: tok }), { status: 201 });
    takeBrSlot(w);
    loseCommitOnPut(w);
    add('POST ig-copy (guest: slot wait, commit lost), cold', 'request',
      await runRequest(w, await loadIsolate(), 'POST', `/api/inspire/posts/${c}/ig-copy`, { token: tok }), { status: 409 });
    w.r2.onPut = null;
    // the post owner's report of a never-checked post: the one case (with the admin's) that fetches the embed page
    add('POST ig-blocked (unchecked post: embed fetch), cold', 'request',
      await runRequest(w, await loadIsolate(), 'POST', `/api/inspire/posts/${d}/ig-blocked`, { token: tok }), { status: 200 });
    add('GET download-info, cold', 'request', await runRequest(w, await loadIsolate(), 'GET', `/api/inspire/posts/${a}/download-info`, { token: tok }), { status: 200 });
  }
  {
    // a card in view asks for its copy (POST /copy): the heavy paths of every platform, each on a cold isolate
    const { w, warm } = await readyWorld({ fetchOpts: { ig: 'login', deadCached: true, redirects: worstHops, pinHeadOk: 4 } });
    const tok = await guestToken(w, warm, 'harness-cid-0003');
    const [ig, igDead] = seedIgPosts(w, ['Vview000001', 'Vview000002']);
    seedIgCache(w, [igDead]);
    const p = seedPlatformPosts(w, ['tiktok', 'reddit', 'pinIdea', 'pinImage', 'x']);
    const view = async (label, id, status) => add(label, 'request', await runRequest(w, await loadIsolate(), 'POST', `/api/inspire/posts/${id}/copy`, { token: tok }), { status, id });
    await view('POST copy (on view: Instagram via Browser Run, 3-hop CDN), cold', ig, 201);
    advanceClock(30);   // the Browser Run slot is free again
    await view('POST copy (on view: Instagram cached link dead, Browser Run re-resolve), cold', igDead, 201);
    await view('POST copy (on view: TikTok, worst redirects), cold', p.tiktok, 201);
    await view('POST copy (on view: Reddit feed + DASH + mux), cold', p.reddit, 201);
    await view('POST copy (on view: Pinterest idea pin, 4 HEADs), cold', p.pinIdea, 201);
    await view('POST copy (on view: image pin -> never), cold', p.pinImage, 200);
    await view('POST copy (on view: copy exists), cold', p.tiktok, 200);
    add('GET /posts (current board: copy_view hints), cold', 'request', await runRequest(w, await loadIsolate(), 'GET', '/api/inspire/posts', { token: tok }), { status: 200 });
    add('DELETE copy (post owner: TikTok copy), cold', 'request', await runRequest(w, await loadIsolate(), 'DELETE', `/api/inspire/posts/${p.tiktok}/copy`, { token: await guestToken(w, warm) }), { status: 200 });
    await view('POST copy (on view: removed copy -> never), cold', p.tiktok, 200);
  }
  {
    const { w, warm } = await readyWorld({ fetchOpts: { redirects: 3 } });
    const adm = await adminToken(w, warm);
    const tok = await guestToken(w, warm, 'harness-cid-0002');
    seedMainBacklog(w, { stale: 0, staleOps: 0, orphans: 0, media: 0, brDue: 1 });
    const id = sqlAll(w, "SELECT id FROM inspire_posts WHERE type='web'")[0].id;
    add('POST meta?force=1 (admin: L1 blocked, Browser Run, 3-hop probes), cold', 'request',
      await runRequest(w, await loadIsolate(), 'POST', `/api/inspire/posts/${id}/meta?force=1`, { token: adm }), { status: 200 });
    // a new link post whose page is blocked: L1 on the response path, Browser Run in waitUntil (same invocation), plus a
    // manual media URL to probe; every request through 3 redirects
    advanceClock(30);   // the Browser Run slot of the /meta call above is free again
    add('POST /posts (guest: blocked page, media URL, Browser Run in waitUntil, 3-hop redirects), cold', 'request',
      await runRequest(w, await loadIsolate(), 'POST', '/api/inspire/posts', { token: tok,
        body: { url: 'https://www.magnific.com/premium-video/new-clip_4242', description: 'x', media: { url: 'https://cdn.example/clip.mp4' } } }), { status: 201 });
  }
  return out;
}

export const fmt = (label, m) => `${label.padEnd(82)} D1 ${String(m.d1).padStart(2)} stmts/${String(m.d1Calls).padStart(2)} calls | sub ${String(m.sub).padStart(2)} (fetch ${String(m.fetch).padStart(2)}, R2 ${m.r2}, WF ${String(m.wf).padStart(2)}, BR ${m.br}) | ~${m.cpuMs.toFixed(1)} ms CPU`;

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  for (const s of await scenarios()) {
    console.log(fmt(s.label, s.m) + (s.m.result && s.m.result.status ? `  -> ${s.m.result.status}` : ''));
    if (process.env.VERBOSE) {
      s.m.sql.forEach((q, i) => console.log(`     ${String(i + 1).padStart(2)} ${q}`));
      console.log('     ops:', s.m.ops.join(', '));
      console.log('     urls:', s.m.urls.join('\n           '));
      console.log('     log:', s.m.lines.map((l) => l[1].slice(0, 160)).join('\n          '));
    }
  }
}
