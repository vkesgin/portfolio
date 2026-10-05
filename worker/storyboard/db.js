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

// Expected neuron cost, used only for the capacity guard (measured: build ~495 for 5 frames, worst case 8 frames ~700).
export const COST = { build: 700, frame: 70, scene: 60 };

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
export const SB_ADD_COLUMNS = [];

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
// Scopes: 'sb' (global storyboards), 'sb_user', 'sb_ip', 'fr' (global frame units), 'fr_user'.
export const QUOTA_ERRORS = {
  sb: ["sb_daily_limit", "Bugünkü storyboard kotası doldu. Kota her gün 03:00'te (TSİ) yenilenir."],
  sb_user: ["sb_user_limit", "Bugünkü storyboard hakkın doldu. Yarın tekrar deneyebilirsin."],
  sb_ip: ["sb_ip_limit", "Bu bağlantıdan bugün çok fazla storyboard istendi. Yarın tekrar dene."],
  fr: ["sb_frame_limit", "Bugünkü yeniden çizim kotası doldu. Kota her gün 03:00'te (TSİ) yenilenir."],
  fr_user: ["sb_frame_user_limit", "Bugünkü yeniden çizim hakkın doldu. Yarın tekrar deneyebilirsin."],
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
export async function ipSubject(request, env) {
  const ip = request.headers.get("CF-Connecting-IP") || "";
  if (!ip) return null;
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${ip}|${env.JWT_SECRET || "secret"}|sb`));
  return "ip:" + [...new Uint8Array(buf).slice(0, 8)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// Soft capacity guard against the 10,000 neurons/day free allocation (ledger is an estimate for images).
export async function capacityOk(db, cfg, cost, day = utcDay()) {
  const r = await db.prepare(
    `SELECT (SELECT COALESCE(SUM(neurons), 0) FROM sb_ledger WHERE day = ?1) AS used,
            (SELECT COUNT(*) FROM sb_storyboards WHERE status IN ('queued','running')) AS builds,
            (SELECT COALESCE(SUM(units), 0) FROM sb_ops WHERE status IN ('queued','running')) AS units`
  ).bind(day).first();
  const inflight = (r.builds || 0) * COST.build + (r.units || 0) * COST.frame;
  return (r.used || 0) + inflight + cost <= cfg.neuronBudget;
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
export function ledgerRowsStmts(db, rows) {
  const out = [];
  const list = (rows || []).filter(Boolean);
  for (let i = 0; i < list.length; i += 11) {
    const chunk = list.slice(i, i + 11);
    const vals = chunk.map((_, k) => `(?${k * 9 + 1}, ?${k * 9 + 2}, ?${k * 9 + 3}, ?${k * 9 + 4}, ?${k * 9 + 5}, ?${k * 9 + 6}, ?${k * 9 + 7}, ?${k * 9 + 8}, ?${k * 9 + 9}, ${now()})`).join(", ");
    const binds = chunk.flatMap((r) => [utcDay(), r.sbId || null, r.opId || null, r.kind, r.model || null, +(r.neurons || 0), r.credits | 0,
      r.ms == null ? null : Math.round(r.ms), r.note ? String(r.note).slice(0, 200) : null]);
    out.push(db.prepare(`INSERT INTO sb_ledger (day, sb_id, op_id, kind, model, neurons, credits, ms, note, created_at) VALUES ${vals}`).bind(...binds));
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
export const SB_SUMMARY_SQL = `
  SELECT s.id, s.post_id, s.version, s.status, s.stage, s.title, s.aspect, s.error_code, s.updated_at,
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
    thumbs, error_code: r.error_code || null, updated_at: r.updated_at,
  };
}

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
// Rows of a storyboard (all tables). Used by DELETE routes, post delete and version cleanup.
export const deleteRowsStmts = (db, sbId) => [
  db.prepare("DELETE FROM sb_images WHERE sb_id = ?1").bind(sbId),
  db.prepare("DELETE FROM sb_ops WHERE sb_id = ?1").bind(sbId),
  db.prepare("DELETE FROM sb_storyboards WHERE id = ?1").bind(sbId),
];
