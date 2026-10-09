// Per-invocation budgets for scheduled() on Workers Free (limits checked 2026-10-08):
//   D1           50 queries per Worker invocation             https://developers.cloudflare.com/d1/platform/limits/
//   subrequests  50 external (fetch) + 1,000 to Cloudflare services (D1, R2, ...) per invocation
//                https://developers.cloudflare.com/workers/platform/limits/#subrequests
//                https://developers.cloudflare.com/changelog/post/2026-02-11-subrequests-limit/
//   CPU          10 ms per HTTP request and per Cron Trigger (I/O waits do not count); 5 Cron Triggers per account
// Every task of a cron run shares one invocation, so they share one Budget. It counts D1 per STATEMENT (each statement of
// a batch too: the conservative reading of "queries"; a batch may well count as one call) and every other subrequest
// (fetch, R2, Workflows, Browser Run, Workers AI) against one subrequest figure, and refuses a call once a hard cap is
// reached. Tasks check fits() with a unit's measured worst case before they start it, so the hard cap is a backstop
// that a run never reaches in practice (tests/cron-budget.test.mjs measures both).
import { AsyncLocalStorage } from 'node:async_hooks';

export const FREE_LIMITS = Object.freeze({ d1: 50, external: 50, internal: 1000, cronCpuMs: 10, crons: 5 });
// hard caps of one scheduled() invocation, well under FREE_LIMITS (D1 statements; subrequests other than D1)
export const CRON_BUDGET = Object.freeze({ d1: 40, sub: 35 });
// Worst case of one unit of cron work (D1 statements, other subrequests), checked with Budget.fits() before it starts;
// tests/cron-budget.test.mjs measures each one against these. index.js uses them (sbScheduled has its own, smaller ones).
export const CRON_COSTS = Object.freeze({
  // Instagram R2 copy by the cron (inspireCopy, retryStale false) incl. the cron's failure record. Worst measured: 22
  // statements (Browser Run after a slot wait, then the commit lost to a manual preview: undo); 13 subrequests = Instagram
  // page + Browser Run + video and poster (<= 4 hops each) + 2 R2 puts + the R2 delete of the undo
  igCopy: Object.freeze({ d1: 24, sub: 13 }),
  // a second Instagram copy in the same run: never Browser Run (allowBR false) -> no Browser Run quota / slot statements.
  // Worst measured: 18 statements, 12 subrequests (plain resolve, 3-hop CDN links, the commit lost: undo)
  igCopyPlain: Object.freeze({ d1: 20, sub: 12 }),
  // X / TikTok / Facebook / Pinterest / Reddit copy by the cron (inspireCopy through the platform adapter, retryStale false)
  // incl. the failure record: worst of every platform (adCopyBy). Statements as an Instagram copy without Browser Run
  // (worst measured 18: TikTok, the commit lost). Subrequests: the adapter's page / API (<= 3 fetches: 2 redirect hops),
  // the video (<= 4 hops), the poster (<= 4 hops), 2 R2 puts + the R2 delete of an undo; Reddit adds its DASH playlist
  // (<= 3) and the sound file (<= 4) + the picture's first bytes (1; the picture itself then cannot redirect); a Pinterest
  // idea pin adds <= 6 HEADs (<= 3 fetches each) of the progressive file next to its HLS playlist.
  adCopy: Object.freeze({ d1: 20, sub: 33 }),
  adCopyBy: Object.freeze({
    x: Object.freeze({ d1: 20, sub: 14 }), tiktok: Object.freeze({ d1: 20, sub: 14 }), facebook: Object.freeze({ d1: 20, sub: 14 }),
    reddit: Object.freeze({ d1: 20, sub: 20 }), pinterest: Object.freeze({ d1: 20, sub: 33 }),
  }),
  // embed check (inspireIgEmbed): cache read, fetch window, daily quota (+ its lookup), result (a failure: 2) <= 5; 1 fetch
  igCheck: Object.freeze({ d1: 6, sub: 1 }),
  // link-preview Browser Run retry (inspireBrAndStore, mode cron): <= 8 statements (rate count, reservation, slot, ms
  // adjust, 2 strike counters, meta write of 2); 1 Browser Run + <= 3 media probes x 4 hops
  brRetry: Object.freeze({ d1: 10, sub: 14 }),
  // the storyboard reconcile's share of a "*/15" run (it runs first)
  sbShare: Object.freeze({ d1: 22, sub: 20 }),
});
// wrangler.toml [triggers] crons; scheduled() dispatches on controller.cron (each fires its own invocation, own limits)
export const CRON_MAIN = '*/15 * * * *';      // storyboard reconcile + board housekeeping + link-preview Browser Run retries
export const CRON_IG = '7-59/15 * * * *';     // R2 copies of video posts (all copy platforms) + Instagram embed checks (minutes 7, 22, 37, 52)

export class BudgetExceeded extends Error {
  constructor(kind, budget) {
    super(`budget: ${kind} cap of ${budget.name} reached (${budget.describe()})`);
    this.name = 'BudgetExceeded';
    this.kind = kind;
  }
}

export class Budget {
  constructor(name, limits = CRON_BUDGET) {
    this.name = name;
    this.limits = { d1: Infinity, sub: Infinity, ...limits };
    this.d1 = 0;          // D1 statements
    this.d1Calls = 0;     // D1 API calls (a batch is one)
    this.fetch = 0;       // outbound fetch() calls (each redirect hop: the worker fetches with redirect: 'manual')
    this.binding = 0;     // R2 / Workflows / Browser Run / AI binding calls
    this.refused = 0;
  }
  get sub() { return this.fetch + this.binding; }
  // Room for a unit of work whose worst case is `cost`? `cap` = a lower ceiling for one part of the run.
  fits({ d1 = 0, sub = 0 } = {}, cap = null) {
    const capD1 = cap && cap.d1 != null ? Math.min(cap.d1, this.limits.d1) : this.limits.d1;
    const capSub = cap && cap.sub != null ? Math.min(cap.sub, this.limits.sub) : this.limits.sub;
    return this.d1 + d1 <= capD1 && this.sub + sub <= capSub;
  }
  // -> null (charged) | BudgetExceeded (not charged; the call must not be made)
  chargeD1(n) {
    if (this.d1 + n > this.limits.d1) { this.refused++; return new BudgetExceeded('D1', this); }
    this.d1 += n;
    this.d1Calls++;
    return null;
  }
  chargeSub(kind) {
    if (this.sub + 1 > this.limits.sub) { this.refused++; return new BudgetExceeded('subrequest', this); }
    if (kind === 'fetch') this.fetch++;
    else this.binding++;
    return null;
  }
  describe() {
    return `D1 ${this.d1}/${this.limits.d1} statements in ${this.d1Calls} calls, subrequests ${this.sub}/${this.limits.sub}` +
      ` (fetch ${this.fetch}, bindings ${this.binding})${this.refused ? `, ${this.refused} refused` : ''}`;
  }
}

// ---------------------------------------------------------------- metering
const ALS = new AsyncLocalStorage();
export const currentBudget = () => ALS.getStore() || null;

function meterD1(db, b) {
  const wrap = (st) => {
    const charged = (fn) => { const e = b.chargeD1(1); return e ? Promise.reject(e) : fn(); };
    return {
      __inner: st,
      bind: (...a) => wrap(st.bind(...a)),
      first: (...a) => charged(() => st.first(...a)),
      all: (...a) => charged(() => st.all(...a)),
      run: (...a) => charged(() => st.run(...a)),
      raw: (...a) => charged(() => st.raw(...a)),
    };
  };
  return {
    prepare: (sql) => wrap(db.prepare(sql)),
    batch: (list) => {
      const e = b.chargeD1(list.length);
      return e ? Promise.reject(e) : db.batch(list.map((s) => (s && s.__inner) || s));
    },
    exec: (sql) => {
      const e = b.chargeD1(String(sql).split(';').filter((x) => x.trim()).length || 1);
      return e ? Promise.reject(e) : db.exec(sql);
    },
  };
}
// Every method call of a binding is one subrequest; `deep` methods return an object whose methods count too
// (Workflows: get(id) -> instance.status() / terminate()).
function meterBinding(obj, b, deep = []) {
  if (!obj || typeof obj !== 'object') return obj;
  return new Proxy(obj, {
    get(t, k) {
      const v = Reflect.get(t, k);
      if (typeof v !== 'function') return v;
      return (...a) => {
        const e = b.chargeSub('binding');
        if (e) return Promise.reject(e);
        const r = v.apply(t, a);
        return deep.includes(k) ? Promise.resolve(r).then((x) => meterBinding(x, b)) : r;
      };
    },
  });
}
// The env a cron task runs with: D1, R2, Workflows, Browser Run and AI calls charged to `b`.
export function meterEnv(env, b) {
  const over = {
    DB: env.DB ? meterD1(env.DB, b) : env.DB,
    STORAGE: meterBinding(env.STORAGE, b),
    STORYBOARD_WF: meterBinding(env.STORYBOARD_WF, b, ['get']),
    BROWSER: meterBinding(env.BROWSER, b),
    AI: meterBinding(env.AI, b),
  };
  return new Proxy(env, { get: (t, k) => (Object.prototype.hasOwnProperty.call(over, k) ? over[k] : Reflect.get(t, k)) });
}
// Outbound fetch(): charged to the budget of the async context it runs in (none outside withBudget: requests running in
// the same isolate pass straight through). Installed once per isolate, on the first cron run.
export function installFetchMeter() {
  const cur = globalThis.fetch;
  if (typeof cur !== 'function' || cur.__budgetMeter === ALS) return;
  const metered = function fetch(input, init) {
    const b = ALS.getStore();
    if (b) { const e = b.chargeSub('fetch'); if (e) return Promise.reject(e); }
    return cur.call(globalThis, input, init);
  };
  metered.__budgetMeter = ALS;
  globalThis.fetch = metered;
}
// Runs fn(meteredEnv) with `b` as the budget of everything it awaits.
export function withBudget(b, env, fn) {
  installFetchMeter();
  return ALS.run(b, () => fn(meterEnv(env, b)));
}
