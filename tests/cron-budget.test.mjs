// Workers Free per-invocation limits (50 D1 queries, 50 external subrequests; see worker/budget.js for the sources):
// every scheduled() run, measured by tests/cron-harness.mjs (D1 counted per statement, batch statements included; every
// fetch / R2 / Workflows / Browser Run call), must stay under CRON_BUDGET (40 statements, 35 subrequests), cold and warm,
// with every queue full; each unit of work must stay within the worst case its gate assumes (CRON_COSTS); the heavy
// requests (download, ig-copy, on-view copies of every platform, ig-blocked, download-info, GET /posts with copy hints,
// /meta with Browser Run) too, on cold isolates.
import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';
import {
  Budget, BudgetExceeded, CRON_BUDGET, CRON_COSTS, CRON_MAIN, CRON_IG, FREE_LIMITS, meterEnv, withBudget,
} from '../worker/budget.js';
import * as H from './cron-harness.mjs';
import fs from 'node:fs';
import { webcrypto } from 'node:crypto';
import { xParse, adToCache, igExtract } from '../worker/inspire-video.js';
import { ipBucket } from '../worker/storyboard/db.js';

// every scenario runs once (both describe blocks below read the same results)
let scenariosP = null;
const scenarios = () => (scenariosP ||= H.scenarios());

describe('budget.js', () => {
  test('counts D1 statements (each statement of a batch), refuses past the cap without calling D1', async () => {
    const calls = [];
    const db = {
      prepare: (sql) => {
        const st = { sql, bind: () => st, first: async () => { calls.push(sql); return { ok: 1 }; }, run: async () => { calls.push(sql); return {}; }, all: async () => { calls.push(sql); return { results: [] }; } };
        return st;
      },
      batch: async (list) => { calls.push('batch:' + list.map((s) => s.sql).join(',')); return list.map(() => ({})); },
    };
    const b = new Budget('t', { d1: 4, sub: 1 });
    const env = meterEnv({ DB: db, OTHER: 'x' }, b);
    assert.equal(env.OTHER, 'x');
    await env.DB.prepare('A').bind(1).first();
    await env.DB.batch([env.DB.prepare('B'), env.DB.prepare('C').bind(2)]);
    assert.deepEqual(calls, ['A', 'batch:B,C'], 'the real statements reach D1 (unwrapped)');
    assert.equal(b.d1, 3); assert.equal(b.d1Calls, 2);
    assert.equal(b.fits({ d1: 1 }), true); assert.equal(b.fits({ d1: 2 }), false); assert.equal(b.fits({ d1: 1 }, { d1: 3 }), false);
    await assert.rejects(env.DB.batch([env.DB.prepare('D'), env.DB.prepare('E')]), BudgetExceeded);   // 3 + 2 > 4
    await env.DB.prepare('F').run();   // the last statement that fits
    const p = env.DB.prepare('G').all();   // a refusal is a rejected promise (`.all().catch()` chains keep working)
    assert.ok(p instanceof Promise);
    await assert.rejects(p, /budget: D1 cap of t reached/);
    assert.deepEqual(calls, ['A', 'batch:B,C', 'F']);
    assert.equal(b.d1, 4); assert.equal(b.refused, 2);
  });
  test('binding calls are subrequests; Workflows instances count too', async () => {
    const b = new Budget('t', { d1: 10, sub: 3 });
    const env = meterEnv({
      STORAGE: { put: async () => 'put', delete: async () => 'del' },
      STORYBOARD_WF: { get: async (id) => ({ id, status: async () => ({ status: 'complete' }) }) },
    }, b);
    assert.equal(await env.STORAGE.put('k', 'v'), 'put');
    assert.equal((await (await env.STORYBOARD_WF.get('x')).status()).status, 'complete');
    assert.equal(b.binding, 3);
    await assert.rejects(env.STORAGE.delete(['k']), /subrequest cap/);
  });
  test('fetch is charged only inside the budget context', async () => {
    const prev = globalThis.fetch;
    let real = 0;
    globalThis.fetch = async () => { real++; return new Response('ok'); };
    try {
      const b = new Budget('t', { d1: 1, sub: 2 });
      let release;
      const gate = new Promise((r) => { release = r; });
      const outside = (async () => { await gate; return fetch('https://out.example/'); })();   // a request's work, started outside
      await withBudget(b, {}, async () => {
        await fetch('https://a.example/');
        release();
        await outside;   // runs while the cron task waits: not charged to it
        await fetch('https://b.example/');
        await assert.rejects(fetch('https://c.example/'), /subrequest cap/);
      });
      await fetch('https://d.example/');   // not metered
      assert.equal(b.fetch, 2); assert.equal(real, 4);
    } finally { globalThis.fetch = prev; }
  });
  test('caps sit well under the Free limits; unit costs fit a run', () => {
    assert.ok(CRON_BUDGET.d1 <= FREE_LIMITS.d1 - 10 && CRON_BUDGET.sub <= FREE_LIMITS.external - 15);
    // an Instagram run: probe + cleanup + queue select, one copy, check select + one check
    assert.ok(3 + CRON_COSTS.igCopy.d1 + 1 + CRON_COSTS.igCheck.d1 <= CRON_BUDGET.d1);
    assert.ok(CRON_COSTS.igCopy.sub + CRON_COSTS.igCheck.sub <= CRON_BUDGET.sub);
    // a copy of any other platform fits an empty run; each platform's own worst case is within the shared one
    assert.ok(3 + CRON_COSTS.adCopy.d1 <= CRON_BUDGET.d1 && CRON_COSTS.adCopy.sub <= CRON_BUDGET.sub);
    for (const [pf, c] of Object.entries(CRON_COSTS.adCopyBy)) assert.ok(c.d1 <= CRON_COSTS.adCopy.d1 && c.sub <= CRON_COSTS.adCopy.sub, pf);
    assert.deepEqual(Object.keys(CRON_COSTS.adCopyBy).sort(), ['facebook', 'pinterest', 'reddit', 'tiktok', 'x']);
    // the second Instagram copy of a run (no Browser Run) is cheaper than the first
    assert.ok(CRON_COSTS.igCopyPlain.d1 <= CRON_COSTS.igCopy.d1 && CRON_COSTS.igCopyPlain.sub <= CRON_COSTS.igCopy.sub);
    // a main run: the storyboard share, the fixed housekeeping (probe, select, delete, prune batch of 2), one retry
    assert.ok(CRON_COSTS.sbShare.d1 + 5 + 1 + CRON_COSTS.brRetry.d1 <= CRON_BUDGET.d1);
    assert.ok(CRON_COSTS.sbShare.sub + 1 + CRON_COSTS.brRetry.sub <= CRON_BUDGET.sub);
  });
});

describe('wrangler.toml', () => {
  test('two Cron Triggers (Free: 5 per account), the ones scheduled() dispatches on', () => {
    const { crons, vars } = H.readWranglerToml();
    assert.deepEqual(crons, [CRON_MAIN, CRON_IG]);
    assert.ok(crons.length <= FREE_LIMITS.crons);
    assert.equal(vars.FIKIR_IG_CRON_COPIES, '2');
    assert.equal(vars.FIKIR_IG_CRON_CHECKS, '2');
    assert.equal(vars.FIKIR_IG_AUTO, 'all');
    assert.deepEqual(vars.FIKIR_COPY_ADAPTERS.split(','), ['x', 'pinterest', 'tiktok', 'facebook', 'reddit']);
    for (const f of ['worker/wrangler.mediatest.toml', 'worker/wrangler.sbtest.toml']) {
      assert.deepEqual(H.readWranglerToml(H.ROOT + '/' + f).crons, [CRON_MAIN, CRON_IG], f);
    }
  });
});

describe('scheduled() and heavy requests under the Free per-invocation limits', { skip: !H.HARNESS_SUPPORTED && 'needs node:module registerHooks (Node >= 22.15)' }, () => {
  let all = [];
  before(async () => { all = await scenarios(); });
  const pick = (label) => {
    const s = all.find((x) => x.label === label);
    assert.ok(s, 'scenario ' + label);
    return s;
  };
  const show = (s) => H.fmt(s.label, s.m);

  test('every scheduled() run stays under CRON_BUDGET and the hard cap is never hit', () => {
    const runs = all.filter((s) => s.kind !== 'request');
    assert.ok(runs.length >= 15);
    for (const s of runs) {
      const m = s.m;
      assert.ok(m.d1 <= CRON_BUDGET.d1, `${show(s)}: D1 statements`);
      assert.ok(m.sub <= CRON_BUDGET.sub, `${show(s)}: subrequests`);
      assert.ok(m.fetch <= FREE_LIMITS.external - 15, `${show(s)}: external fetches`);
      assert.deepEqual(m.errors, [], `${s.label}: console.error`);
      // the worker's own meter saw exactly what the harness counted
      assert.ok(m.budget, `${s.label}: the run logs its budget`);
      assert.deepEqual({ d1: m.budget.d1, d1Calls: m.budget.d1Calls, sub: m.budget.sub }, { d1: m.d1, d1Calls: m.d1Calls, sub: m.sub }, s.label);
    }
  });
  test('each unit stays within the worst case its gate assumes (CRON_COSTS)', () => {
    const units = all.filter((s) => s.kind === 'unit');
    assert.ok(units.length >= 14);
    for (const s of units) {
      const c = s.cost.split('.').reduce((o, k) => o[k], CRON_COSTS);
      assert.ok(c, s.cost);
      assert.ok(s.m.d1 - s.fixed <= c.d1, `${show(s)}: unit ${s.m.d1 - s.fixed} > ${c.d1} statements`);
      assert.ok(s.m.sub <= c.sub, `${show(s)}: unit subrequests > ${c.sub}`);
    }
    // the worst copy path really is near its bound (keeps the bound honest)
    const worst = pick('ig, worst copy (slot wait, redirects, commit lost), warm');
    assert.ok(worst.m.d1 - worst.fixed >= CRON_COSTS.igCopy.d1 - 4 && worst.m.sub === CRON_COSTS.igCopy.sub, show(worst));
    const plain = pick('ig, plain copy worst (3-hop CDN, commit lost), warm');
    assert.ok(plain.m.d1 - plain.fixed >= CRON_COSTS.igCopyPlain.d1 - 4 && plain.m.sub === CRON_COSTS.igCopyPlain.sub, show(plain));
    assert.equal(plain.m.br, 0, 'no Browser Run');
    const tt = pick('copy, TikTok commit lost (undo), warm');
    assert.equal(tt.m.sub, CRON_COSTS.adCopyBy.tiktok.sub, show(tt));
    const rd = pick('copy, Reddit (feed + DASH + picture/sound mux, worst redirects), warm');
    assert.ok(rd.m.sub >= CRON_COSTS.adCopyBy.reddit.sub - 2, show(rd));
  });
  test('dispatch: CRON_IG does the copies (every platform), CRON_MAIN (and a manual run) never touches a platform', () => {
    for (const s of all.filter((x) => x.kind !== 'request')) {
      const ig = s.m.budget.task === 'ig';
      assert.equal(ig, /^(ig|copy),/.test(s.label), s.label);
      if (ig) assert.ok(!s.m.sql.some((q) => /\bsb_\w+/.test(q)), `${s.label}: storyboard SQL in the Instagram run`);
      else assert.ok(!s.m.urls.some((u) => /instagram\.com|tiktok|twimg|pinterest|pinimg|reddit|redd\.it|facebook|fbcdn/.test(u)), `${s.label}: platform request in the main run`);
    }
  });
  test('cold isolates: one schema probe per task, never the migration', () => {
    for (const s of all.filter((x) => x.kind !== 'request')) {
      assert.ok(!s.m.sql.some((q) => /^(CREATE|ALTER|PRAGMA)\b/i.test(q)), `${s.label}: schema statements in a cron run`);
      assert.ok(s.m.sql.filter((q) => q.includes('sqlite_master')).length <= 2, s.label);
    }
    assert.equal(pick('main, empty queues, cold isolate').m.d1 - pick('main, empty queues, warm isolate').m.d1, 2, 'two probes (inspire + storyboard)');
    for (const label of ['main, no schema yet (fresh database), cold', 'ig, no schema yet (fresh database), cold']) {
      const s = pick(label);
      assert.equal(s.facts.tables, 0, `${label}: the cron created tables`);
      assert.ok(s.m.d1 <= 2, show(s));
    }
  });
  test('the work still gets done: backlogs drain run by run, copies and checks happen', () => {
    // production settings (FIKIR_IG_AUTO=all, two copies per run): two plain Instagram copies in a run
    assert.equal(pick('ig, plain resolve, cold').facts.copied, 2);
    assert.equal(pick('ig, plain resolve (2nd run), warm').facts.copied, 4, 'two copies per run');
    // the earlier rollout step: one copy and the embed checks in every run
    const r1 = pick('main, every queue full, 3-hop redirects, cold'), r3 = pick('main, every queue full (3rd run), warm');
    assert.ok(r1.facts.staleOpen < r1.before.staleOpen && r3.facts.staleOpen === 0, 'stale builds closed');
    assert.ok(r3.facts.opsOpen < r1.facts.opsOpen, 'stale ops closed');
    assert.equal(pick('main, every queue full (2nd run), warm').facts.mediaRows, 0, 'upload rows swept (100 per run)');
    assert.ok(r3.facts.brPending < r1.before.brPending, 'Browser Run retries ran');
    assert.equal(pick('main, one Browser Run retry (3-hop probes), warm').facts.brPending, 0);
    assert.equal(pick('ig, blocked only, one copy per run, cold').facts.copied, 1);
    assert.equal(pick('ig, blocked only, one copy per run (2nd run), warm').facts.copied, 2, 'one copy per run');
    assert.ok(pick('ig, blocked only, one copy per run (2nd run), warm').facts.embedRows > pick('ig, blocked only, one copy per run, cold').facts.embedRows, 'embed checks');
    assert.equal(pick('ig, Browser Run after a slot wait, warm').facts.copied, 2);
    const lost = pick('ig, worst copy (slot wait, redirects, commit lost), warm').facts;
    assert.deepEqual({ copied: lost.copied, mediaRows: lost.mediaRows, r2Objects: lost.r2Objects }, { copied: 0, mediaRows: 0, r2Objects: 0 }, 'undo cleaned up');
    const dead = pick('ig, cached link dead (soft failure), warm');
    assert.deepEqual({ copied: dead.facts.copied, staleMarked: dead.facts.staleMarked }, { copied: 0, staleMarked: 1 });
    assert.equal(dead.m.br + dead.m.urls.filter((u) => /www\.instagram\.com/.test(u)).length, 0, 'no second resolve in the same run');
    assert.equal(pick('ig, next run resolves it again, warm').facts.copied, 1);
  });
  test('heavy requests on cold isolates stay well under the per-request limits', () => {
    const reqs = all.filter((s) => s.kind === 'request');
    assert.ok(reqs.length >= 6);
    for (const s of reqs) {
      assert.equal(s.m.result.status, s.status, `${s.label}: HTTP status`);
      assert.ok(s.m.d1 <= CRON_BUDGET.d1, `${show(s)}: D1 statements`);
      assert.ok(s.m.fetch <= CRON_BUDGET.sub && s.m.sub <= CRON_BUDGET.sub, `${show(s)}: subrequests`);
      assert.ok(!s.m.sql.some((q) => /^(CREATE|ALTER)\b/i.test(q)), `${s.label}: migration on a cold isolate with a complete schema`);
    }
  });
});

describe('R2 copies of every platform: cron and cards in view', { skip: !H.HARNESS_SUPPORTED && 'needs node:module registerHooks (Node >= 22.15)' }, () => {
  let all = [];
  before(async () => { all = await scenarios(); });
  const pick = (label) => { const s = all.find((x) => x.label === label); assert.ok(s, 'scenario ' + label); return s; };
  test('each platform copies through its adapter: R2 video + poster, post.media source / by / caption / audio', () => {
    const want = {
      'copy, TikTok (page + cookie, worst redirects), warm': { source: 'tiktok', by: 'ornek.tiktok', caption: 'Örnek TikTok videosu #test', audio: true },
      'copy, X (syndication, worst redirects), warm': { source: 'x', by: 'ornek_studio', caption: 'Örnek klip — test https://t.co/TestLink01', audio: true },
      'copy, Facebook reel (poster size, worst redirects), warm': { source: 'facebook', audio: true },
      'copy, Pinterest idea pin (4 HEADs, worst redirects), warm': { source: 'pinterest', by: 'ornek.creator' },
      'copy, Reddit (feed + DASH + picture/sound mux, worst redirects), warm': { source: 'reddit', by: 'ornek_user', caption: 'Örnek makine & test', audio: true },
      'copy, Reddit with a link-preview video (feed read for author + title), warm': { source: 'reddit', by: 'ornek_user', caption: 'Örnek makine & test', audio: true },
      'copy, Reddit feed refused (429): the preview video, its generic title dropped, warm': { source: 'reddit', by: undefined, caption: undefined, audio: true },
    };
    for (const [label, exp] of Object.entries(want)) {
      const s = pick(label);
      assert.equal(s.facts.copied, 1, label);
      const m = s.facts.media[0];
      for (const [k, v] of Object.entries(exp)) assert.equal(m[k], v, `${label}: ${k}`);
      assert.match(m.url, new RegExp(`^/files/fikir/${m.id}/v-[0-9a-f]{32}\\.mp4$`), label);
      assert.match(m.poster, new RegExp(`^/files/fikir/${m.id}/p-[0-9a-f]{32}\\.jpg$`), label);
      assert.ok(m.w > 0 && m.h > 0, `${label}: a size (the platform's or the poster's)`);
      assert.equal(s.facts.r2Objects, 2, label); assert.equal(s.facts.mediaRows, 2, label);
      assert.deepEqual(s.facts.records.map((r) => [r.kind, r.error]), [['ad_copy', null]], label);
    }
    assert.ok(pick('copy, Reddit with a link-preview video (feed read for author + title), warm').m.urls.some((u) => /\.rss/.test(u)), 'a copy reads the feed (author, title)');
    assert.ok(pick('copy, Reddit feed refused (429): the preview video, its generic title dropped, warm').m.urls.some((u) => /testvid0001\/DASHPlaylist/.test(u)), 'fallback: the preview video');
    assert.ok(pick('copy, Reddit (feed + DASH + picture/sound mux, worst redirects), warm').m.urls.some((u) => /CMAF_AUDIO/.test(u)), 'sound joined in');
    const tt = pick('copy, TikTok (page + cookie, worst redirects), warm');
    assert.ok(tt.m.urls.some((u) => /tiktok\.com\/video\/tos/.test(u)));
    const lost = pick('copy, TikTok commit lost (undo), warm').facts;
    assert.deepEqual({ r2: lost.r2Objects, rows: lost.mediaRows, records: lost.records.length }, { r2: 0, rows: 0, records: 0 }, 'undo cleaned up, nothing recorded');
    const pin = pick('copy, image pin (no video: 30-day record), warm').facts;
    assert.equal(pin.copied, 0);
    assert.equal(pin.records[0].error, 'no_video');
    assert.ok(pin.records[0].retry_at - H.nowS() > 29 * 86400, 'no video: asked again after 30 days at the earliest');
  });
  test('the cron drains a mixed backlog: every platform, image pins and YouTube left alone, runs within the budget', () => {
    const runs = all.filter((s) => s.label.startsWith('ig, every platform queued'));
    assert.ok(runs.length >= 8);
    const last = runs[runs.length - 1].facts;
    for (const pf of ['instagram', 'x', 'tiktok', 'facebook', 'pinterest', 'reddit']) assert.ok(last.by[pf] >= 1, pf);
    assert.equal(last.by.youtube, undefined, 'never a YouTube copy');
    for (const s of runs) assert.ok(s.m.d1 <= 40 && s.m.sub <= 35, H.fmt(s.label, s.m));
    assert.ok(runs.filter((s) => (s.m.lines.filter((l) => /inspire copy cron .* copied/.test(l[1])).length) === 2).length >= 3, 'two copies in a run when both fit');
    assert.ok(!runs.some((s) => s.m.urls.some((u) => /youtube|ytimg/.test(u))), 'no YouTube request');
  });
  test('cards in view: POST /copy copies once, then answers from the records; GET /posts carries copy_view', () => {
    const st = (label) => pick(label).m.result.json;
    for (const label of ['POST copy (on view: Instagram via Browser Run, 3-hop CDN), cold', 'POST copy (on view: Instagram cached link dead, Browser Run re-resolve), cold',
      'POST copy (on view: TikTok, worst redirects), cold', 'POST copy (on view: Reddit feed + DASH + mux), cold', 'POST copy (on view: Pinterest idea pin, 4 HEADs), cold']) {
      const j = st(label);
      assert.equal(j.state, 'copied', label);
      assert.ok(j.post && j.post.media && j.post.media.kind === 'video' && j.post.copy_view === false, label);
      assert.match(j.post.media.url, /^\/files\/fikir\/\d+\/v-[0-9a-f]{32}\.mp4\?t=/, `${label}: files token`);
    }
    assert.deepEqual(st('POST copy (on view: image pin -> never), cold'), { state: 'never', reason: 'no_video' });
    assert.equal(st('POST copy (on view: copy exists), cold').state, 'exists');
    assert.equal(pick('POST copy (on view: copy exists), cold').m.fetch, 0, 'an existing copy: no platform request');
    assert.deepEqual(st('POST copy (on view: removed copy -> never), cold'), { state: 'never', reason: 'removed' });
    const del = st('DELETE copy (post owner: TikTok copy), cold');
    assert.equal(del.removed, true); assert.equal(del.post.media, null); assert.equal(del.post.copy_view, false);
    const list = st('GET /posts (current board: copy_view hints), cold');
    const byType = (t) => list.filter((p) => p.type === t);
    assert.ok(list.every((p) => typeof p.copy_view === 'boolean'));
    assert.ok(byType('x').every((p) => p.copy_view === true), 'not copied yet: ask in view');
    assert.ok(list.filter((p) => p.media).every((p) => p.copy_view === false), 'copied: nothing to ask');
    const img = list.find((p) => p.url.includes('300000000000000001'));
    assert.equal(img.copy_view, false, 'no video: not asked again');
  });
});

// Cards in view (POST /copy): the copy outlives a client that goes away, Browser Run is the site's and the post's (never the
// viewer's IP's), a busy platform says for how long, and a cached resolve without the post's caption is resolved again.
describe('on-view copies: disconnects, Browser Run charges, retry hints, full captions', { skip: !H.HARNESS_SUPPORTED && 'needs node:module registerHooks (Node >= 22.15)' }, () => {
  const IP = '203.0.113.7';   // runRequest's default CF-Connecting-IP
  const view = async (w, id, token) => H.runRequest(w, await H.loadIsolate(), 'POST', `/api/inspire/posts/${id}/copy`, { token });
  const day = () => new Date(H.nowS() * 1000).toISOString().slice(0, 10);
  const spend = (w, scope, subject, lim) => H.sqlRun(w, 'INSERT OR REPLACE INTO inspire_quota (day, scope, subject, n, lim) VALUES (?, ?, ?, ?, ?)', day(), scope, subject, lim, lim);
  const window = (w, k, n, s) => H.sqlRun(w, 'INSERT OR REPLACE INTO inspire_rate (k, n, reset) VALUES (?, ?, ?)', k, n, H.nowS() + s);
  const rec = (w, id) => H.sqlAll(w, "SELECT kind, error, retry_at, extra FROM inspire_video_cache WHERE post_id=? AND kind IN ('ig_copy', 'ad_copy')", id);
  const locks = (w) => H.sqlAll(w, "SELECT COUNT(*) AS n FROM inspire_rate WHERE k LIKE 'igcopy_lock:%' AND reset > ?", H.nowS())[0].n;
  const FXV = (f) => fs.readFileSync(new URL('./fixtures/video/' + f, import.meta.url), 'utf8');

  test('the copy (and its record) runs under ctx.waitUntil: a reload mid-copy does not cancel it; ig-copy too', async () => {
    const { w, warm } = await H.readyWorld();
    const tok = await H.guestToken(w, warm, 'harness-cid-0011');
    const p = H.seedPlatformPosts(w, ['tiktok', 'pinImage']);
    const a = await view(w, p.tiktok, tok);
    assert.equal(a.result.status, 201); assert.ok(a.result.waits >= 1, 'handed to waitUntil');
    const b = await view(w, p.pinImage, tok);
    assert.deepEqual(b.result.json, { state: 'never', reason: 'no_video' }); assert.ok(b.result.waits >= 1);
    assert.equal(rec(w, p.pinImage)[0].error, 'no_video', 'the record is written by the kept promise');
    const [reel] = H.seedIgPosts(w, ['Fkeep00001']);
    H.seedEmbedState(w, [reel], 'blocked');
    const c = await H.runRequest(w, await H.loadIsolate(), 'POST', `/api/inspire/posts/${reel}/ig-copy`, { token: tok });
    assert.equal(c.result.status, 201); assert.ok(c.result.waits >= 1, 'POST ig-copy: handed to waitUntil');
    assert.equal(locks(w), 0, 'every copy lock released');
  });

  test("Browser Run for an on-view copy is never charged to the viewer's IP; only the post's own budget defers the post", async () => {
    const { w, warm } = await H.readyWorld({ fetchOpts: { ig: 'login' } });   // the page needs Browser Run
    const tok = await H.guestToken(w, warm, 'harness-cid-0012');
    const [a, b] = H.seedIgPosts(w, ['Fbrip00001', 'Fbrpost001']);
    // this viewer's IP has spent its Browser Run calls + ms for today (its link previews, earlier copies)
    const d = new Uint8Array(await webcrypto.subtle.digest('SHA-256', new TextEncoder().encode('inspire-ip:' + ipBucket(IP))));
    const ipKey = 'ip:' + [...d.subarray(0, 12)].map((x) => x.toString(16).padStart(2, '0')).join('');
    spend(w, 'br_ip', ipKey, 1); spend(w, 'br_ms_ip', ipKey, 5000);
    const r = await view(w, a, tok);
    assert.equal(r.result.json.state, 'copied', JSON.stringify(r.result.json)); assert.equal(r.br, 1, 'through Browser Run');
    assert.deepEqual(rec(w, a).map((x) => x.error), [null], 'copied: no deferral of the post');
    assert.equal(H.sqlAll(w, "SELECT n FROM inspire_quota WHERE scope='br_ip' AND subject=?", ipKey)[0].n, 1, 'the IP was not charged');
    // the post's own Browser Run calls for today are spent: this post only waits (never 'busy' for the whole platform)
    H.advanceClock(30);   // the Browser Run slot is free again
    spend(w, 'br_post', String(b), 3);
    const q = await view(w, b, tok);
    assert.equal(q.result.json.state, 'later'); assert.equal(q.result.json.reason, 'deferred');
    const row = rec(w, b)[0];
    assert.equal(row.error, null); assert.ok(row.retry_at > H.nowS()); assert.equal(JSON.parse(row.extra).deferred, 'br_post');
    const again = await view(w, b, tok);
    assert.equal(again.result.json.reason, 'br_post', 'asked again: answered from the record, still not "busy"'); assert.equal(again.fetch, 0);
  });

  test('a busy platform says for how long: Reddit feed minute 60 s, a fetch window 600 s, the Browser Run slot seconds', async () => {
    const { w, warm } = await H.readyWorld({ fetchOpts: { ig: 'login' } });
    const tok = await H.guestToken(w, warm, 'harness-cid-0015');
    const p = H.seedPlatformPosts(w, ['reddit', 'x']);
    window(w, 'ad_rss:all', 2, 60);
    assert.deepEqual((await view(w, p.reddit, tok)).result.json, { state: 'later', reason: 'busy', retry_s: 60 });
    window(w, 'ad_fetch:x', 20, 600);
    assert.deepEqual((await view(w, p.x, tok)).result.json, { state: 'later', reason: 'busy', retry_s: 600 });
    const [reel] = H.seedIgPosts(w, ['Fslot00001']);
    H.takeBrSlot(w, 8);
    const s = (await view(w, reel, tok)).result.json;
    assert.equal(s.state, 'later'); assert.equal(s.reason, 'busy'); assert.ok(s.retry_s >= 1 && s.retry_s <= 11, JSON.stringify(s));
    for (const id of [p.reddit, p.x, reel]) assert.deepEqual(rec(w, id), [], 'a busy platform is no failure of the post: nothing recorded');
  });

  test("a cached resolve without the post's caption is resolved once more for a copy; one with it is used as is", async () => {
    const { w, warm } = await H.readyWorld();
    const tok = await H.guestToken(w, warm, 'harness-cid-0014');
    const now = H.nowS();
    const x = xParse(JSON.parse(FXV('x-video.json')), '1900000000000000001');
    const c = adToCache('x', x, now);
    const adRow = (id, extra) => H.sqlRun(w, `INSERT OR REPLACE INTO inspire_video_cache (post_id, kind, url, poster, width, height, expires_at, resolved_at, fail_count, extra)
      VALUES (?, 'ad', ?, ?, ?, ?, ?, ?, 0, ?)`, id, c.url, c.poster, c.width, c.height, now + 7 * 86400, now, JSON.stringify(extra));
    const { caption, ...before } = c.extra;   // a download cached it before captions were kept: author, no caption key
    const p1 = H.seedPlatformPosts(w, ['x']).x, p2 = H.seedPlatformPosts(w, ['x']).x;
    adRow(p1, before); adRow(p2, { ...c.extra, caption: 'Önbellekteki açıklama' });
    const a = await view(w, p1, tok);
    assert.ok(a.urls.some((u) => /cdn\.syndication\.twimg\.com/.test(u)), 'resolved again');
    assert.equal(a.result.json.post.media.caption, x.caption); assert.equal(a.result.json.post.media.by, 'ornek_studio');
    const b = await view(w, p2, tok);
    assert.ok(!b.urls.some((u) => /syndication/.test(u)), 'cached with its caption: no platform request');
    assert.equal(b.result.json.post.media.caption, 'Önbellekteki açıklama');
    // Instagram: a row cached when captions were cut at 300 code points ('…' at the end, no cv) vs one with cv 2
    const [r1, r2] = H.seedIgPosts(w, ['Fcap000001', 'Fcap000002']);
    const igRow = (id, extra) => H.sqlRun(w, `INSERT OR REPLACE INTO inspire_video_cache (post_id, kind, url, poster, width, height, expires_at, resolved_at, fail_count, extra)
      VALUES (?, 'ig', ?, ?, 720, 1280, ?, ?, 0, ?)`, id, `https://scontent-ams2-1.cdninstagram.com/o1/v/t2/f2/m86/CACHED-${id}.mp4?_nc_cat=104&oe=6AC94349&oh=00_v`,
      'https://scontent-ams2-1.cdninstagram.com/v/t51.0-15/poster_720.jpg?oe=6ACD0906&oh=00_p', now + 86400, now, JSON.stringify(extra));
    igRow(r1, { user: 'ornek.studio', has_audio: true, caption: 'k'.repeat(299) + '…' });
    igRow(r2, { cv: 2, user: 'ornek.studio', has_audio: true, caption: 'Tam açıklama…' });
    const full = igExtract(FXV('ig-reel.html').replaceAll('DTestReel01', 'Fcap000001'), 'Fcap000001').caption;
    const i1 = await view(w, r1, tok);
    assert.ok(i1.urls.some((u) => u.startsWith('https://www.instagram.com/reel/Fcap000001/')), 'resolved again');
    assert.equal(i1.result.json.post.media.caption, full);
    const i2 = await view(w, r2, tok);
    assert.ok(!i2.urls.some((u) => u.startsWith('https://www.instagram.com/')), 'cv 2: the cached caption is whole');
    assert.equal(i2.result.json.post.media.caption, 'Tam açıklama…');
  });
});
