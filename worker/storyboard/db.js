// db.js: storyboard schema (idempotent, memoized like ensureInspireSchema), settings, quota, ledger, R2/instance helpers.
// Every timestamp is epoch milliseconds; every "day" is the UTC date YYYY-MM-DD (Workers AI neurons reset at 00:00 UTC).

export const now = () => Date.now();
export const utcDay = (t = Date.now()) => new Date(t).toISOString().slice(0, 10);
export const monthStart = (t = Date.now()) => new Date(t).toISOString().slice(0, 8) + "01";
export const nextResetIso = (t = Date.now()) => { const d = new Date(t); d.setUTCHours(24, 0, 0, 0); return d.toISOString(); };
export const imageKey = (sbId, job, rev) => `sb/${sbId}/${job}.r${rev}.jpg`;
export const filePath = (key) => (key ? `/files/${key}` : null);
export const SB_ID_RE = /^sb_[0-9a-f]{32}$/;
export const OP_ID_RE = /^op_[0-9a-f]{32}$/;
export const newId = (prefix) => prefix + crypto.randomUUID().replace(/-/g, "");
export function newSeed() { const a = new Uint32Array(1); crypto.getRandomValues(a); return (a[0] % 2147483646) + 1; }
// rev 0 = the build's seed (all build images share it, as in the prototype); every redraw gets a new deterministic seed.
export const seedFor = (sbSeed, n, rev) => (rev === 0 ? sbSeed : ((sbSeed + rev * 7919 + n * 104729) % 2147483646) + 1);

// Neurons RESERVED per job by the capacity guard (sb_quota scope 'neurons', see neuronItem). Realistic worst cases, not
// averages: a build is draft (gemma + repair, then gpt-oss + repair: ~710 text) + up to 8 frames x ~63 + anchor/refs ~90
// = ~1,300 (measured: 637 for a 5-frame build with one repair); a frame ~63; a reference ~26-31; a scene rewrite ~80-210
// measured, ~900 on the repair/fallback path. When the job ends the reservation is replaced by its ledgered cost.
export const COST = { build: 1300, frame: 70, ref: 35, scene: 450 };

export function sbConfig(env) {
  const int = (v, d) => { const n = Number.parseInt(v, 10); return Number.isFinite(n) && n >= 0 ? n : d; };
  return {
    enabled: env.SB_ENABLED === "1",
    adminOnly: env.SB_ADMIN_ONLY !== "0",               // safe default: admin only until explicitly opened
    dailyLimit: int(env.SB_DAILY_LIMIT, 12),             // storyboards per UTC day, everyone together (admin included)
    perUser: int(env.SB_PER_CID_LIMIT, 3),               // storyboards per guest cid / registered user per day (admin exempt)
    perIp: int(env.SB_PER_IP_LIMIT, 6),                  // storyboards per hashed IP per day (admin exempt; 0 = off)
    frameDaily: int(env.SB_DAILY_FRAME_REGEN, 40),       // frame regeneration units per day, everyone together
    framePerUser: int(env.SB_PER_CID_FRAME_REGEN, 15),   // frame regeneration units per cid/user per day (admin exempt)
    neuronBudget: int(env.SB_NEURON_BUDGET, 9000),       // soft ceiling under the 10,000/day free allocation
    tavilyMonthly: int(env.SB_TAVILY_MONTHLY, 900),      // Tavily credits per calendar month (free plan: 1,000)
    maxQueries: Math.min(int(env.SB_TAVILY_MAX_QUERIES, 3), 3),
    research: env.SB_RESEARCH !== "0",
    fake: env.SB_FAKE_AI === "1",
    concurrency: Math.min(Math.max(int(env.SB_FRAME_CONCURRENCY, 3), 1), 4),
    staleMs: int(env.SB_STALE_MIN, 15) * 60000,
  };
}

// ---------------------------------------------------------------- schema
export const SB_DDL = [
  `CREATE TABLE IF NOT EXISTS sb_storyboards (
    id TEXT PRIMARY KEY,
    post_id INTEGER NOT NULL,
    version INTEGER NOT NULL DEFAULT 1,
    status TEXT NOT NULL DEFAULT 'queued',
    stage TEXT NOT NULL DEFAULT 'queued',
    input_json TEXT NOT NULL,
    research_json TEXT,
    draft_json TEXT,
    lint_json TEXT,
    plan_json TEXT,
    title TEXT,
    aspect TEXT,
    seed INTEGER NOT NULL,
    text_model TEXT,
    error_code TEXT,
    error_msg TEXT,
    author_name TEXT,
    client_id TEXT,
    user_id INTEGER,
    quota_subject TEXT,
    ip_subject TEXT,
    day TEXT NOT NULL,
    reserve INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS sb_one_active_build ON sb_storyboards(post_id) WHERE status IN ('queued','running')`,
  `CREATE INDEX IF NOT EXISTS sb_by_post ON sb_storyboards(post_id, version)`,
  `CREATE INDEX IF NOT EXISTS sb_by_status ON sb_storyboards(status, updated_at)`,
  `CREATE TABLE IF NOT EXISTS sb_images (
    sb_id TEXT NOT NULL,
    job TEXT NOT NULL,
    kind TEXT NOT NULL,
    n INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'pending',
    rev INTEGER NOT NULL DEFAULT 0,
    r2_key TEXT,
    seed INTEGER,
    width INTEGER,
    height INTEGER,
    error TEXT,
    updated_at INTEGER NOT NULL,
    PRIMARY KEY (sb_id, job)
  )`,
  `CREATE TABLE IF NOT EXISTS sb_ops (
    id TEXT PRIMARY KEY,
    sb_id TEXT NOT NULL,
    kind TEXT NOT NULL,
    n INTEGER NOT NULL DEFAULT 0,
    note TEXT,
    status TEXT NOT NULL DEFAULT 'queued',
    error_code TEXT,
    error_msg TEXT,
    units INTEGER NOT NULL DEFAULT 1,
    quota_subject TEXT,
    day TEXT NOT NULL,
    reserve INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS sb_one_active_op ON sb_ops(sb_id, n) WHERE status IN ('queued','running')`,
  `CREATE INDEX IF NOT EXISTS sb_ops_by_sb ON sb_ops(sb_id, created_at)`,
  `CREATE INDEX IF NOT EXISTS sb_ops_by_status ON sb_ops(status, updated_at)`,
  `CREATE TABLE IF NOT EXISTS sb_quota (
    day TEXT NOT NULL,
    scope TEXT NOT NULL,
    subject TEXT NOT NULL DEFAULT '',
    n INTEGER NOT NULL,
    lim INTEGER NOT NULL,
    CONSTRAINT sb_quota_cap CHECK (n <= lim),
    PRIMARY KEY (day, scope, subject)
  )`,
  `CREATE TABLE IF NOT EXISTS sb_ledger (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    day TEXT NOT NULL,
    sb_id TEXT,
    op_id TEXT,
    kind TEXT NOT NULL,
    model TEXT,
    neurons REAL NOT NULL DEFAULT 0,
    credits INTEGER NOT NULL DEFAULT 0,
    ms INTEGER,
    note TEXT,
    created_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS sb_ledger_day ON sb_ledger(day, kind)`,
];
// Columns added after the first release go here: [table, column, type] (ALTER TABLE ADD COLUMN, like migrateInspireSchema).
// reserve: neurons this job holds in sb_quota 'neurons' until it ends (also in CREATE TABLE; listed for tables made by
// earlier test builds).
export const SB_ADD_COLUMNS = [
  ["sb_storyboards", "reserve", "INTEGER NOT NULL DEFAULT 0"],
  ["sb_ops", "reserve", "INTEGER NOT NULL DEFAULT 0"],
];

let sbSchemaReady = null;
export function ensureStoryboardSchema(env) {
  if (!sbSchemaReady) sbSchemaReady = migrateStoryboardSchema(env).catch((e) => { sbSchemaReady = null; throw e; });
  return sbSchemaReady;
}
async function migrateStoryboardSchema(env) {
  const db = env.DB;
  await db.batch(SB_DDL.map((s) => db.prepare(s)));
  const byTable = new Map();
  for (const [t, c, type] of SB_ADD_COLUMNS) { if (!byTable.has(t)) byTable.set(t, []); byTable.get(t).push([c, type]); }
  for (const [table, cols] of byTable) {
    let have = null;
    try { const { results } = await db.prepare(`PRAGMA table_info(${table})`).all(); have = new Set((results || []).map((r) => r.name)); } catch (_) {}
    for (const [col, type] of cols) {
      if (have && have.has(col)) continue;
      try { await db.prepare(`ALTER TABLE ${table} ADD COLUMN ${col} ${type}`).run(); } catch (_) {}
    }
  }
}

// ---------------------------------------------------------------- quota (atomic: CHECK(n <= lim) aborts the whole D1 batch)
// Scopes: 'sb' (global storyboards), 'sb_user', 'sb_ip', 'fr' (global frame units), 'fr_user',
// 'neurons' (capacity guard: ledgered neurons of finished jobs + reservations of running ones, lim SB_NEURON_BUDGET).
export const QUOTA_ERRORS = {
  sb: ["sb_daily_limit", "Bugünkü storyboard kotası doldu. Kota her gün 03:00'te (TSİ) yenilenir."],
  sb_user: ["sb_user_limit", "Bugünkü storyboard hakkın doldu. Yarın tekrar deneyebilirsin."],
  sb_ip: ["sb_ip_limit", "Bu bağlantıdan bugün çok fazla storyboard istendi. Yarın tekrar dene."],
  fr: ["sb_frame_limit", "Bugünkü yeniden çizim kotası doldu. Kota her gün 03:00'te (TSİ) yenilenir."],
  fr_user: ["sb_frame_user_limit", "Bugünkü yeniden çizim hakkın doldu. Yarın tekrar deneyebilirsin."],
  neurons: ["sb_capacity", "Yapay zekâ kapasitesi bugünlük doldu. Kota her gün 03:00'te (TSİ) yenilenir."],
};
export function quotaItems(cfg, actor, kind, units, subject, ipSubject) {
  const items = [];
  if (kind === "sb") {
    items.push({ scope: "sb", subject: "", lim: cfg.dailyLimit, units: 1 });
    if (!actor.isAdmin && subject) items.push({ scope: "sb_user", subject, lim: cfg.perUser, units: 1 });
    if (!actor.isAdmin && ipSubject && cfg.perIp > 0) items.push({ scope: "sb_ip", subject: ipSubject, lim: cfg.perIp, units: 1 });
  } else {
    items.push({ scope: "fr", subject: "", lim: cfg.frameDaily, units });
    if (!actor.isAdmin && subject) items.push({ scope: "fr_user", subject, lim: cfg.framePerUser, units });
  }
  return items;
}
// Capacity guard: the job's reservation goes into the same quota batch as its insert, so concurrent admissions cannot
// overshoot SB_NEURON_BUDGET (the old read-then-insert check could). Admin is counted too.
export const neuronItem = (cfg, reserve) => ({ scope: "neurons", subject: "", lim: cfg.neuronBudget, units: Math.max(0, Math.ceil(reserve)) });
export const quotaStmts = (db, day, items) => items.map((it) => db.prepare(
  `INSERT INTO sb_quota (day, scope, subject, n, lim) VALUES (?1, ?2, ?3, ?4, ?5)
   ON CONFLICT(day, scope, subject) DO UPDATE SET n = n + excluded.n, lim = excluded.lim`
).bind(day, it.scope, it.subject, it.units, it.lim));
export const refundStmts = (db, day, items) => items.map((it) => db.prepare(
  "UPDATE sb_quota SET n = MAX(0, n - ?4) WHERE day = ?1 AND scope = ?2 AND subject = ?3"
).bind(day, it.scope, it.subject, it.units));
export const isCheckError = (e) => /CHECK constraint failed/i.test(String(e && e.message || e));
export const isUniqueError = (e) => /UNIQUE constraint failed/i.test(String(e && e.message || e));
// After a CHECK failure: which counter would overflow? (read-only; the batch was rolled back)
export async function whichQuota(db, day, items) {
  for (const it of items) {
    const r = await db.prepare("SELECT n FROM sb_quota WHERE day=?1 AND scope=?2 AND subject=?3").bind(day, it.scope, it.subject).first();
    if ((r ? r.n : 0) + it.units > it.lim) return it.scope;
  }
  return items[0] ? items[0].scope : "sb";
}
export async function quotaLeft(db, cfg, actor, subject, day = utcDay()) {
  const { results } = await db.prepare(
    "SELECT scope, subject, n FROM sb_quota WHERE day = ?1 AND ((subject = '' AND scope IN ('sb','fr')) OR (subject = ?2 AND scope IN ('sb_user','fr_user')))"
  ).bind(day, subject || "-").all();
  const used = (scope) => { const r = (results || []).find((x) => x.scope === scope); return r ? r.n : 0; };
  const left = (lim, scope) => Math.max(0, lim - used(scope));
  const admin = !!(actor && actor.isAdmin);
  const daily = left(cfg.dailyLimit, "sb"), frameDaily = left(cfg.frameDaily, "fr");
  return {
    daily, frame_daily: frameDaily,
    per_user: admin || !subject ? null : left(cfg.perUser, "sb_user"),
    frame_per_user: admin || !subject ? null : left(cfg.framePerUser, "fr_user"),
    storyboards: admin || !subject ? daily : Math.min(daily, left(cfg.perUser, "sb_user")),
    frames: admin || !subject ? frameDaily : Math.min(frameDaily, left(cfg.framePerUser, "fr_user")),
    reset_at: nextResetIso(),
  };
}
export const quotaSubject = (actor) => (!actor || actor.isAdmin ? null : actor.guest ? `c:${actor.cid}` : `u:${actor.userId}`);
// Per-IP buckets: an IPv6 client usually controls a whole /64, so IPv6 addresses count per /64 prefix; IPv4 per address.
// Also used by the inspire rate limiter (worker/index.js inspireIpKey).
export function ipBucket(ip) {
  const s = String(ip || "").trim().toLowerCase();
  if (!s.includes(":")) return s;                                          // IPv4 (or empty / 'unknown')
  if (/^::ffff:\d{1,3}(?:\.\d{1,3}){3}$/.test(s)) return s.slice(7);        // IPv4-mapped
  const parts = s.split("::");
  if (parts.length > 2) return s;                                          // not an IPv6 address: as is
  const groups = (x) => (x ? x.split(":") : []);
  const head = groups(parts[0]), tail = parts.length === 2 ? groups(parts[1]) : [];
  const width = (g) => g.reduce((k, x) => k + (x.includes(".") ? 2 : 1), 0);   // embedded IPv4 = 2 groups
  const full = parts.length === 2 ? [...head, ...Array(Math.max(0, 8 - width(head) - width(tail))).fill("0"), ...tail] : head;
  return full.slice(0, 4).map((x) => (Number.parseInt(x, 16) || 0).toString(16)).join(":") + "::/64";
}
export async function ipSubject(request, env) {
  const ip = request.headers.get("CF-Connecting-IP") || "";
  if (!ip) return null;
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${ipBucket(ip)}|${env.JWT_SECRET || "secret"}|sb`));
  return "ip:" + [...new Uint8Array(buf).slice(0, 8)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// ---------------------------------------------------------------- ledger
export function ledgerStmt(db, { sbId = null, opId = null, kind, model = null, neurons = 0, credits = 0, ms = null, note = null }) {
  return db.prepare(
    "INSERT INTO sb_ledger (day, sb_id, op_id, kind, model, neurons, credits, ms, note, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)"
  ).bind(utcDay(), sbId, opId, kind, model, +(neurons || 0), credits | 0, ms == null ? null : Math.round(ms), note ? String(note).slice(0, 200) : null, now());
}
// Multi-row INSERTs (11 rows x 9 = 99 binds per statement, under D1's 100 bound parameters). Inside a Workflow every
// D1 statement counts against the Free plan's 50 D1 queries per invocation, so ledger rows are written in bulk.
// rows: [{ sbId, opId, kind: 'text'|'image'|'tavily', model, neurons, credits, ms, note }]
// once: 'build' | 'op' makes the rows of a finalize/finish step idempotent: they are inserted only while that build/op
// has not ended (or its row is gone), so a step retry after the batch committed cannot write them twice. Every row then
// belongs to the same build (?2 = row 0's sb_id) or op (?3 = row 0's op_id).
const LEDGER_ONCE = {
  build: "WHERE NOT EXISTS (SELECT 1 FROM sb_storyboards WHERE id = ?2 AND status NOT IN ('queued','running'))",
  op: "WHERE NOT EXISTS (SELECT 1 FROM sb_ops WHERE id = ?3 AND status NOT IN ('queued','running'))",
};
export function ledgerRowsStmts(db, rows, once = null) {
  const out = [];
  const list = (rows || []).filter(Boolean);
  for (let i = 0; i < list.length; i += 11) {
    const chunk = list.slice(i, i + 11);
    const vals = chunk.map((_, k) => `(?${k * 9 + 1}, ?${k * 9 + 2}, ?${k * 9 + 3}, ?${k * 9 + 4}, ?${k * 9 + 5}, ?${k * 9 + 6}, ?${k * 9 + 7}, ?${k * 9 + 8}, ?${k * 9 + 9}, ${now()})`).join(", ");
    const binds = chunk.flatMap((r) => [utcDay(), r.sbId || null, r.opId || null, r.kind, r.model || null, +(r.neurons || 0), r.credits | 0,
      r.ms == null ? null : Math.round(r.ms), r.note ? String(r.note).slice(0, 200) : null]);
    const cols = "INSERT INTO sb_ledger (day, sb_id, op_id, kind, model, neurons, credits, ms, note, created_at)";
    out.push(db.prepare(once ? `${cols} SELECT * FROM (VALUES ${vals}) ${LEDGER_ONCE[once]}` : `${cols} VALUES ${vals}`).bind(...binds));
  }
  return out;
}
// Text-call log (draftStage / rewriteSceneStage) -> ledger rows.
export const textLedgerRows = (sbId, opId, log) => (log || []).filter((l) => l && l.model)
  .map((l) => ({ sbId, opId, kind: "text", model: l.model, neurons: l.neurons, ms: l.ms, note: l.step }));
export async function tavilyCreditsThisMonth(db) {
  const r = await db.prepare("SELECT COALESCE(SUM(credits), 0) AS c FROM sb_ledger WHERE kind = 'tavily' AND day >= ?1").bind(monthStart()).first();
  return r ? r.c : 0;
}

// ---------------------------------------------------------------- summaries (board cards)
// previous_id: the newest finished (done/partial) older version, kept until a newer version finishes; the board offers it
// when the latest version failed (e.g. a "Yorumu düzelt" rebuild).
export const SB_SUMMARY_SQL = `
  SELECT s.id, s.post_id, s.version, s.status, s.stage, s.title, s.aspect, s.error_code, s.updated_at,
    (SELECT p.id FROM sb_storyboards p WHERE p.post_id = s.post_id AND p.version < s.version AND p.status IN ('done','partial')
      ORDER BY p.version DESC LIMIT 1) AS previous_id,
    (SELECT COUNT(*) FROM sb_images i WHERE i.sb_id = s.id AND i.kind = 'frame') AS frame_total,
    (SELECT COUNT(*) FROM sb_images i WHERE i.sb_id = s.id AND i.kind = 'frame' AND i.r2_key IS NOT NULL) AS frame_done,
    (SELECT COUNT(*) FROM sb_images i WHERE i.sb_id = s.id AND i.kind = 'frame' AND i.status IN ('pending','running')) AS frame_busy,
    (SELECT group_concat(i.n || ':' || i.r2_key, '|') FROM sb_images i WHERE i.sb_id = s.id AND i.kind = 'frame' AND i.r2_key IS NOT NULL) AS thumbs
  FROM sb_storyboards s
  WHERE NOT EXISTS (SELECT 1 FROM sb_storyboards s2 WHERE s2.post_id = s.post_id AND s2.version > s.version)`;
export function summaryOut(r) {
  if (!r) return null;
  const thumbs = String(r.thumbs || "").split("|").filter(Boolean)
    .map((x) => { const i = x.indexOf(":"); return { n: Number(x.slice(0, i)), path: filePath(x.slice(i + 1)) }; })
    .sort((a, b) => a.n - b.n).slice(0, 4);
  return {
    id: r.id, version: r.version, status: r.status, stage: r.stage, title: r.title || null, aspect: r.aspect || null,
    frame_total: r.frame_total || 0, frame_done: r.frame_done || 0, frame_busy: r.frame_busy || 0,
    thumbs, error_code: r.error_code || null, previous_id: r.previous_id || null, updated_at: r.updated_at,
  };
}

// ---------------------------------------------------------------- settling a job (finalize / finish / reconcile)
// These must run in the SAME batch as, and BEFORE, the job's own status change (buildEndStmts / opEndStmts): each one
// applies only while the job is still queued/running, so it happens exactly once even if the batch is retried.
//
// Capacity: the reservation is replaced by the job's ledgered cost (its rows must already be in sb_ledger or earlier
// in the batch). Clamped to lim so the CHECK never fails here. Jobs that end without settling (deleted, reconciled as
// stale) keep their reservation for that day: the safe direction, as their real cost is unknown.
export const buildReleaseStmt = (db, sbId) => db.prepare(
  `UPDATE sb_quota SET n = MIN(lim, MAX(0, CAST(ROUND(n - (SELECT reserve FROM sb_storyboards WHERE id = ?1)
       + (SELECT COALESCE(SUM(neurons), 0) FROM sb_ledger WHERE sb_id = ?1 AND op_id IS NULL)) AS INTEGER)))
   WHERE scope = 'neurons' AND subject = '' AND day = (SELECT day FROM sb_storyboards WHERE id = ?1)
     AND EXISTS (SELECT 1 FROM sb_storyboards WHERE id = ?1 AND status IN ('queued','running'))`).bind(sbId);
export const opReleaseStmt = (db, opId) => db.prepare(
  `UPDATE sb_quota SET n = MIN(lim, MAX(0, CAST(ROUND(n - (SELECT reserve FROM sb_ops WHERE id = ?1)
       + (SELECT COALESCE(SUM(neurons), 0) FROM sb_ledger WHERE op_id = ?1)) AS INTEGER)))
   WHERE scope = 'neurons' AND subject = '' AND day = (SELECT day FROM sb_ops WHERE id = ?1)
     AND EXISTS (SELECT 1 FROM sb_ops WHERE id = ?1 AND status IN ('queued','running'))`).bind(opId);
// Per-user/IP storyboard refund for a build that is about to end 'failed' (no draft). Only for platform failures
// (AI quota, stale instance): a draft_failed build is not refunded, since the idea text itself can force that failure
// (and each attempt burns text neurons). The global counter is never refunded.
export const buildRefundStmt = (db, sbId) => db.prepare(
  `UPDATE sb_quota SET n = MAX(0, n - 1)
   WHERE day = (SELECT day FROM sb_storyboards WHERE id = ?1)
     AND ((scope = 'sb_user' AND subject = (SELECT quota_subject FROM sb_storyboards WHERE id = ?1))
       OR (scope = 'sb_ip' AND subject = (SELECT ip_subject FROM sb_storyboards WHERE id = ?1)))
     AND EXISTS (SELECT 1 FROM sb_storyboards WHERE id = ?1 AND status IN ('queued','running') AND draft_json IS NULL)`).bind(sbId);
// Per-user frame-unit refund for an op that is about to end 'failed' (not used for scene_failed, same reason as above).
export const opRefundStmt = (db, opId) => db.prepare(
  `UPDATE sb_quota SET n = MAX(0, n - (SELECT units FROM sb_ops WHERE id = ?1))
   WHERE scope = 'fr_user' AND (day, subject) = (SELECT day, quota_subject FROM sb_ops WHERE id = ?1)
     AND EXISTS (SELECT 1 FROM sb_ops WHERE id = ?1 AND status IN ('queued','running'))`).bind(opId);

// ---------------------------------------------------------------- terminal-state SQL shared by finalize, reconcile and ops
// Build ended (normally or not): unfinished images fail; storyboard -> failed (no draft) | partial | done.
export function buildEndStmts(db, sbId, errCode, errMsg) {
  const t = now();
  return [
    db.prepare("UPDATE sb_images SET status = 'failed', error = COALESCE(error, ?3), updated_at = ?2 WHERE sb_id = ?1 AND status IN ('pending','running')")
      .bind(sbId, t, errCode || "not_rendered"),
    db.prepare(`UPDATE sb_storyboards SET
        status = CASE WHEN draft_json IS NULL THEN 'failed'
                      WHEN EXISTS (SELECT 1 FROM sb_images i WHERE i.sb_id = ?1 AND i.kind = 'frame' AND i.r2_key IS NULL) THEN 'partial'
                      ELSE 'done' END,
        stage = 'done',
        error_code = CASE WHEN ?3 IS NOT NULL THEN ?3
                          WHEN EXISTS (SELECT 1 FROM sb_images i WHERE i.sb_id = ?1 AND i.kind = 'frame' AND i.r2_key IS NULL) THEN 'frames_failed'
                          ELSE NULL END,
        error_msg = ?4, updated_at = ?2
      WHERE id = ?1 AND status IN ('queued','running')`).bind(sbId, t, errCode || null, errMsg ? String(errMsg).slice(0, 300) : null),
  ];
}
// Op ended: busy frames go back to done (old image kept) or failed; storyboard status follows the frames.
export function opEndStmts(db, opId, sbId, status, errCode, errMsg) {
  const t = now();
  return [
    db.prepare("UPDATE sb_ops SET status = ?2, error_code = ?3, error_msg = ?4, updated_at = ?5 WHERE id = ?1 AND status IN ('queued','running')")
      .bind(opId, status, errCode || null, errMsg ? String(errMsg).slice(0, 300) : null, t),
    db.prepare(`UPDATE sb_images SET status = CASE WHEN r2_key IS NULL THEN 'failed' ELSE 'done' END,
        error = CASE WHEN r2_key IS NULL THEN COALESCE(error, ?3) ELSE error END, updated_at = ?2
      WHERE sb_id = ?1 AND status IN ('pending','running')
        AND NOT EXISTS (SELECT 1 FROM sb_ops o WHERE o.sb_id = ?1 AND o.status IN ('queued','running') AND o.id <> ?4
                        AND (o.n = 0 OR o.n = sb_images.n))`).bind(sbId, t, errCode || "not_rendered", opId),
    db.prepare(`UPDATE sb_storyboards SET
        status = CASE WHEN draft_json IS NULL THEN status
                      WHEN EXISTS (SELECT 1 FROM sb_images i WHERE i.sb_id = ?1 AND i.kind = 'frame' AND i.r2_key IS NULL) THEN 'partial'
                      ELSE 'done' END,
        error_code = CASE WHEN EXISTS (SELECT 1 FROM sb_images i WHERE i.sb_id = ?1 AND i.kind = 'frame' AND i.r2_key IS NULL) THEN error_code ELSE NULL END,
        updated_at = ?2
      WHERE id = ?1 AND status IN ('done','partial','failed')`).bind(sbId, t),
  ];
}

// ---------------------------------------------------------------- Workflows + R2 helpers
export async function startInstance(env, id, params) {
  const wf = env.STORYBOARD_WF;
  if (!wf) throw new Error("STORYBOARD_WF binding missing");
  if (typeof wf.createBatch === "function") { await wf.createBatch([{ id, params }]); return; }
  try { await wf.create({ id, params }); } catch (e) { if (!/already exists/i.test(String(e && e.message))) throw e; }
}
export async function instanceStatus(env, id) {
  try { return await (await env.STORYBOARD_WF.get(id)).status(); }
  catch (e) { return { status: "unknown", error: { message: String((e && e.message) || e) } }; }
}
export async function terminateInstance(env, id) {
  try { await (await env.STORYBOARD_WF.get(id)).terminate(); } catch (_) { /* finished, purged or unknown */ }
}
export async function deleteSbObjects(env, sbId) {
  let cursor;
  do {
    const l = await env.STORAGE.list({ prefix: `sb/${sbId}/`, cursor, limit: 1000 });
    const keys = (l.objects || []).map((o) => o.key);
    if (keys.length) await env.STORAGE.delete(keys);
    cursor = l.truncated ? l.cursor : undefined;
  } while (cursor);
}
// Rows of a storyboard (all tables). Used by DELETE routes, post delete, version cleanup and the cron orphan sweep.
// A build/op that is still running keeps its neuron reservation for the day (see buildReleaseStmt).
export const deleteRowsStmts = (db, sbId) => [
  db.prepare("DELETE FROM sb_images WHERE sb_id = ?1").bind(sbId),
  db.prepare("DELETE FROM sb_ops WHERE sb_id = ?1").bind(sbId),
  db.prepare("DELETE FROM sb_storyboards WHERE id = ?1").bind(sbId),
];
