// Workers Free per-invocation limits (50 D1 queries, 50 external subrequests; see worker/budget.js for the sources):
// every scheduled() run, measured by tests/cron-harness.mjs (D1 counted per statement, batch statements included; every
// fetch / R2 / Workflows / Browser Run call), must stay under CRON_BUDGET (40 statements, 35 subrequests), cold and warm,
// with every queue full; each unit of work must stay within the worst case its gate assumes (CRON_COSTS); the heavy
// requests (download, ig-copy, ig-blocked, download-info, /meta with Browser Run) too, on cold isolates.
import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';
import {
  Budget, BudgetExceeded, CRON_BUDGET, CRON_COSTS, CRON_MAIN, CRON_IG, FREE_LIMITS, meterEnv, withBudget,
} from '../worker/budget.js';
import * as H from './cron-harness.mjs';

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
    assert.equal(vars.FIKIR_IG_CRON_COPIES, '1');
    assert.equal(vars.FIKIR_IG_CRON_CHECKS, '2');
    for (const f of ['worker/wrangler.mediatest.toml', 'worker/wrangler.sbtest.toml']) {
      assert.deepEqual(H.readWranglerToml(H.ROOT + '/' + f).crons, [CRON_MAIN, CRON_IG], f);
    }
  });
});

describe('scheduled() and heavy requests under the Free per-invocation limits', { skip: !H.HARNESS_SUPPORTED && 'needs node:module registerHooks (Node >= 22.15)' }, () => {
  let all = [];
  before(async () => { all = await H.scenarios(); });
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
    assert.ok(units.length >= 5);
    for (const s of units) {
      const c = CRON_COSTS[s.cost];
      assert.ok(s.m.d1 - s.fixed <= c.d1, `${show(s)}: unit ${s.m.d1 - s.fixed} > ${c.d1} statements`);
      assert.ok(s.m.sub <= c.sub, `${show(s)}: unit subrequests > ${c.sub}`);
    }
    // the worst copy path really is near its bound (keeps the bound honest)
    const worst = pick('ig, worst copy (slot wait, redirects, commit lost), warm');
    assert.ok(worst.m.d1 - worst.fixed >= CRON_COSTS.igCopy.d1 - 4 && worst.m.sub === CRON_COSTS.igCopy.sub, show(worst));
  });
  test('dispatch: CRON_IG does Instagram only, CRON_MAIN (and a manual run) never touches Instagram', () => {
    for (const s of all.filter((x) => x.kind !== 'request')) {
      const ig = s.m.budget.task === 'ig';
      assert.equal(ig, s.label.startsWith('ig,'), s.label);
      if (ig) assert.ok(!s.m.sql.some((q) => /\bsb_\w+/.test(q)), `${s.label}: storyboard SQL in the Instagram run`);
      else assert.ok(!s.m.urls.some((u) => /instagram\.com/.test(u)), `${s.label}: Instagram request in the main run`);
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
    const r1 = pick('main, every queue full, 3-hop redirects, cold'), r3 = pick('main, every queue full (3rd run), warm');
    assert.ok(r1.facts.staleOpen < r1.before.staleOpen && r3.facts.staleOpen === 0, 'stale builds closed');
    assert.ok(r3.facts.opsOpen < r1.facts.opsOpen, 'stale ops closed');
    assert.equal(pick('main, every queue full (2nd run), warm').facts.mediaRows, 0, 'upload rows swept (100 per run)');
    assert.ok(r3.facts.brPending < r1.before.brPending, 'Browser Run retries ran');
    assert.equal(pick('main, one Browser Run retry (3-hop probes), warm').facts.brPending, 0);
    assert.equal(pick('ig, plain resolve, cold').facts.copied, 1);
    assert.equal(pick('ig, plain resolve (2nd run), warm').facts.copied, 2, 'one copy per run');
    assert.ok(pick('ig, plain resolve (2nd run), warm').facts.embedRows > pick('ig, plain resolve, cold').facts.embedRows, 'embed checks');
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
