// workflow.js: StoryboardWorkflow (Cloudflare Workflows, same script as vk-portfolio-api).
// Free plan: 10 ms CPU per step, unlimited wall time. Every step is I/O-bound: D1, R2, Workers AI, Tavily.
// Step results are small (keys, draft JSON ~10 KB, plan ~15 KB); image bytes never leave a step (1 MiB cap).
// D1 is the source of truth for the UI; Workflows step results are only the engine's replay cache.
//
// D1 budget: the Free plan allows 50 D1 queries per invocation (each statement of a batch counts). A build instance
// uses 1 (load) + 3 (research) + 3 (draft) + 2 per image + 5 (finalize, +1 refund) + 3 per older version = 37 for
// 8 frames (11 images); +1 per timed-out image attempt (its ledger row). Ledger rows are therefore collected from step
// results and written in bulk by the finalize step, in the same single batch that settles quota and status.
import { WorkflowEntrypoint } from "cloudflare:workers";
import { NonRetryableError } from "cloudflare:workflows";
import { Buffer } from "node:buffer";
import { draftStage, rewriteSceneStage, applyFormat, correctionExpansions, QUOTA_RE } from "./postprocess.js";
import { TEXT_FALLBACK, TEXT_FALLBACK_PARAMS, SCENE_FALLBACK_PARAMS, buildContext } from "./prompt.v6.js";
import { planImages, planFrameForOp, kleinRun, IMG_MODEL } from "./images.js";
import { runResearch } from "./research.js";
import { createFakeAI } from "./fake-ai.js";
import { FAKE_TAVILY } from "./fixtures.js";
import {
  sbConfig, now, utcDay, imageKey, seedFor, ledgerStmt, ledgerRowsStmts, textLedgerRows, tavilyCreditsThisMonth,
  buildEndStmts, opEndStmts, buildReleaseStmt, opReleaseStmt, buildRefundStmt, opRefundStmt, deleteRowsStmts, deleteSbObjects,
} from "./db.js";

const STEP_DB = { retries: { limit: 3, delay: "2 seconds", backoff: "exponential" }, timeout: "1 minute" };
const STEP_RESEARCH = { retries: { limit: 1, delay: "10 seconds", backoff: "constant" }, timeout: "3 minutes" };
const STEP_TEXT = { retries: { limit: 0, delay: "1 second", backoff: "constant" }, timeout: "8 minutes" };       // repair is inside the step
const STEP_TEXT_FB = { retries: { limit: 0, delay: "1 second", backoff: "constant" }, timeout: "8 minutes" };   // worst case per draft: 2 gemma + 2 gpt-oss calls (~710 neurons)
const STEP_IMAGE = { retries: { limit: 1, delay: "10 seconds", backoff: "constant" }, timeout: "4 minutes" };
const KLEIN_TIMEOUT_MS = 100000;   // measured p90 47 s, max 85.7 s; a timed-out call may still be billed

const errMsg = (e) => String((e && e.message) || e).slice(0, 300);
// Our own marker ("QUOTA: ...", set by draftStage/rewriteSceneStage/renderImage). Never match generic words such as
// "exceeded": a Workflows "exceeded CPU time" error must not be reported as an AI quota problem. Raw Workers AI error
// text is classified by QUOTA_RE (postprocess.js), the same narrow pattern for text and image calls.
const isQuota = (e) => /QUOTA:/.test(errMsg(e));
// The storyboard (or op) was deleted meanwhile: stop without spending more. A distinctive marker, so no model or
// platform error text can be mistaken for it.
const GONE = "SB_GONE: storyboard deleted";
const isGone = (e) => /SB_GONE/.test(errMsg(e));
const withTimeout = (p, ms) => { let t; return Promise.race([p, new Promise((_, rej) => { t = setTimeout(() => rej(new Error(`timeout ${ms}ms`)), ms); })]).finally(() => clearTimeout(t)); };

function getAI(env) {
  if (env.SB_FAKE_AI === "1") return createFakeAI(env);
  if (!env.AI) throw new NonRetryableError("AI binding missing");
  return env.AI;
}
// Research JSON kept in D1 / step results: notes text + what lint needs (no raw Tavily payloads).
function slimResearch(r) {
  const e = r.entities || null;
  return {
    degraded: r.degraded || null, text: r.text || null, credits: r.credits || 0,
    queries: (r.queries || []).map((q) => q.query),
    allowedExpansions: r.allowedExpansions || [], otherEntities: r.otherEntities || {},
    sources: (r.sources || []).slice(0, 8),
    entities: e ? { brand: e.brand, place: e.place, acronyms: e.acronyms, orgs: e.orgs, places: e.places, persons: e.persons, names: e.names, imageStripTokens: e.imageStripTokens } : null,
  };
}
const slimPlan = (p) => ({
  seed: p.seed, size: p.size, neurons_est: p.neurons_est,
  jobs: p.jobs.map((j) => ({ id: j.id, stage: j.stage, kind: j.kind || null, name: j.name || null, n: j.n || 0, width: j.width, height: j.height, seed: j.seed, refs: j.refs, prompt: j.prompt, neurons_est: j.neurons_est })),
});
function textInput(st, research) {
  return {
    idea: st.input.idea, brand: st.input.brand, place: st.input.place, context: buildContext(st.input),
    research: research && research.text, entities: (research && research.entities) || undefined,
    allowedExpansions: [...((research && research.allowedExpansions) || []), ...correctionExpansions(st.input.corrections)],
    otherEntities: (research && research.otherEntities) || {},
  };
}

// ---------------------------------------------------------------- one image (anchor, reference or frame), idempotent
// rev 0 for every build image; redraws use the next rev, so the public /files/ URL (1-year cache) is always new.
// D1: 2 statements. R2: head + get per reference + put (+ delete of the previous rev). Returns the ledger row.
async function renderImage(env, ai, { sbId, opId = null, job, rev }) {
  const db = env.DB;
  const key = imageKey(sbId, job.id, rev);
  const claim = await db.prepare(
    `UPDATE sb_images SET status = 'running', error = NULL, updated_at = ?3
     WHERE sb_id = ?1 AND job = ?2 AND EXISTS (SELECT 1 FROM sb_storyboards s WHERE s.id = ?1) RETURNING r2_key`
  ).bind(sbId, job.id, now()).first();
  if (!claim) throw new NonRetryableError(GONE);            // storyboard deleted meanwhile (or a leftover image row)
  const oldKey = claim.r2_key && claim.r2_key !== key ? claim.r2_key : null;
  let neurons = 0, ms = null;
  if (!(await env.STORAGE.head(key))) {                     // a previous attempt may have stored it already
    const refs = await Promise.all(job.refs.map(async (id) => {
      const o = await env.STORAGE.get(imageKey(sbId, id, 0));
      if (!o) throw new Error(`missing reference ${id}`);
      return new Uint8Array(await o.arrayBuffer());
    }));
    const t0 = now();
    let b64;
    try {
      b64 = ai.image ? await ai.image(job) : await withTimeout(kleinRun(ai, { ...job, refs }), KLEIN_TIMEOUT_MS);
    } catch (e) {
      if (QUOTA_RE.test(errMsg(e))) throw new NonRetryableError(`QUOTA: ${errMsg(e)}`);
      // A timed-out call may still be billed. Ledger THIS attempt now (not in the failure step): when the step retry
      // then succeeds, its own row covers only the second call, and the capacity guard must see both.
      if (/^timeout \d+ms$/.test(errMsg(e)) && !ai.fake) {
        try { await ledgerStmt(db, { sbId, opId, kind: "image", model: IMG_MODEL, neurons: job.neurons_est, ms: now() - t0, note: `${job.id} timeout` }).run(); }
        catch (_) { /* best effort */ }
      }
      throw e;
    }
    ms = now() - t0;
    neurons = ai.fake ? 0 : job.neurons_est;
    const bytes = Buffer.from(b64, "base64");                // native decode (nodejs_compat), ~0.3 ms for 436 KB
    const type = bytes[0] === 0x89 ? "image/png" : "image/jpeg";
    await env.STORAGE.put(key, bytes, { httpMetadata: { contentType: type } });
  }
  const res = await db.prepare(
    `UPDATE sb_images SET status = 'done', r2_key = ?3, rev = ?4, seed = ?5, width = ?6, height = ?7, error = NULL, updated_at = ?8
     WHERE sb_id = ?1 AND job = ?2`).bind(sbId, job.id, key, rev, job.seed, job.width, job.height, now()).run();
  if (!res.meta || !res.meta.changes) { await env.STORAGE.delete(key); throw new NonRetryableError(GONE); }
  if (oldKey) { try { await env.STORAGE.delete(oldKey); } catch (_) {} }
  return { job: job.id, key, ledger: { sbId, opId, kind: "image", model: IMG_MODEL, neurons, ms, note: job.id } };
}

// ---------------------------------------------------------------- the Workflow
export class StoryboardWorkflow extends WorkflowEntrypoint {
  async run(event, step) {
    const p = (event && event.payload) || {};
    if (p.op === "build") return runBuild(this.env, step, p.sbId);
    if (p.op === "redraw" || p.op === "rewrite" || p.op === "resume") return runOp(this.env, step, p.opId);
    throw new NonRetryableError(`unknown op ${p.op}`);
  }
}

async function runBuild(env, step, sbId) {
  const cfg = sbConfig(env);
  const db = env.DB;
  const st = await step.do("load", STEP_DB, async () => {
    const row = await db.prepare(
      `UPDATE sb_storyboards SET status = 'running', updated_at = ?2,
         stage = CASE WHEN research_json IS NULL THEN 'research' WHEN draft_json IS NULL THEN 'draft' ELSE 'images' END
       WHERE id = ?1 AND status IN ('queued','running')
       RETURNING input_json, research_json, draft_json, plan_json, seed`).bind(sbId, now()).first();
    if (!row) return null;   // deleted, or already finished
    return {
      input: JSON.parse(row.input_json), seed: row.seed,
      research: row.research_json ? JSON.parse(row.research_json) : null,
      draft: row.draft_json ? JSON.parse(row.draft_json) : null,
      plan: row.plan_json ? JSON.parse(row.plan_json) : null,
    };
  });
  if (!st) return { sbId, skipped: true };
  const ai = getAI(env);
  const ledger = [];

  // 1. research (never fails the storyboard)
  let research = st.research;
  if (!research) {
    // Credits are ledgered even if the storyboard was deleted meanwhile; then the build stops before the text model.
    const save = async (r) => {
      const stmts = [db.prepare("UPDATE sb_storyboards SET research_json = ?2, stage = 'draft', updated_at = ?3 WHERE id = ?1 AND status IN ('queued','running') RETURNING id")
        .bind(sbId, JSON.stringify(r), now())];
      if (r.credits && !cfg.fake) stmts.push(...ledgerRowsStmts(db, [{ sbId, kind: "tavily", credits: r.credits, note: r.queries.join(" | ") }]));
      const [upd] = await db.batch(stmts);
      if (!(upd.results || []).length) throw new NonRetryableError(GONE);
      return r;
    };
    try {
      research = await step.do("research", STEP_RESEARCH, async () => {
        let skip = null;
        if (!cfg.research) skip = "disabled";
        else if (!cfg.fake && env.TAVILY_API_KEY && (await tavilyCreditsThisMonth(db)) >= cfg.tavilyMonthly) skip = "monthly_cap";
        return save(slimResearch(await runResearch({
          idea: st.input.idea, brand: st.input.brand, place: st.input.place, apiKey: env.TAVILY_API_KEY || "",
          date: utcDay(), maxQueries: cfg.maxQueries, skip,
          fixture: cfg.fake && env.SB_FAKE_TAVILY === "1" ? FAKE_TAVILY : null,
        })));
      });
    } catch (e) {
      if (isGone(e)) return { sbId, gone: true };
      try {
        research = await step.do("research-failed", STEP_DB, () =>
          save({ degraded: "error", text: null, credits: 0, queries: [], allowedExpansions: [], otherEntities: {}, sources: [], entities: null }));
      } catch (e2) {
        if (isGone(e2)) return { sbId, gone: true };
        throw e2;
      }
    }
  }

  // 2. draft: gemma (one in-step repair) -> on failure gpt-oss-120b (one in-step repair). Quota stops at once.
  let draft = st.draft, plan = st.plan;
  if (!draft) {
    const draftStep = (fallback) => async () => {
      const log = [];
      let r;
      try {
        r = await draftStage(ai, textInput(st, research), log, fallback ? { model: TEXT_FALLBACK, params: TEXT_FALLBACK_PARAMS } : {});
      } catch (e) {
        if (!ai.fake && log.length) await db.batch(ledgerRowsStmts(db, textLedgerRows(sbId, null, log)));
        if (isQuota(e)) throw new NonRetryableError(`QUOTA: ${errMsg(e)}`);
        throw e;
      }
      applyFormat(r.draft, st.input.format);
      const p = slimPlan(planImages(r.draft, { seed: st.seed }));
      const vals = p.jobs.map((_, i) => `(?1, ?${i * 5 + 3}, ?${i * 5 + 4}, ?${i * 5 + 5}, 'pending', 0, ?${i * 5 + 6}, ?${i * 5 + 7}, ?2)`).join(", ");
      const binds = p.jobs.flatMap((j) => [j.id, j.stage === "frames" ? "frame" : j.stage === "anchor" ? "anchor" : "ref", j.n || 0, j.width, j.height]);
      // Both writes apply only while the storyboard still exists and runs: a deleted storyboard must not get image rows
      // back (renderImage would claim them). The text ledger rows are written either way (the neurons were spent).
      const ACTIVE_SB = "EXISTS (SELECT 1 FROM sb_storyboards WHERE id = ?1 AND status IN ('queued','running'))";
      const [upd] = await db.batch([
        db.prepare(`UPDATE sb_storyboards SET draft_json = ?2, lint_json = ?3, plan_json = ?4, title = ?5, aspect = ?6, text_model = ?7,
                    stage = 'images', updated_at = ?8 WHERE id = ?1 AND status IN ('queued','running') RETURNING id`).bind(sbId, JSON.stringify(r.draft),
          JSON.stringify({ coerced: r.coerced, fixes: r.lint.fixes, warnings: r.lint.warnings, total_duration_s: r.lint.total_duration_s, log }),
          JSON.stringify(p), String(r.draft.title).slice(0, 200), r.draft.aspect_ratio, log.length ? log[log.length - 1].model : null, now()),
        db.prepare(`INSERT INTO sb_images (sb_id, job, kind, n, status, rev, width, height, updated_at)
                    SELECT * FROM (VALUES ${vals}) WHERE ${ACTIVE_SB}
                    ON CONFLICT(sb_id, job) DO NOTHING`).bind(sbId, now(), ...binds),
        ...(ai.fake ? [] : ledgerRowsStmts(db, textLedgerRows(sbId, null, log))),
      ]);
      if (!(upd.results || []).length) throw new NonRetryableError(GONE);
      return { draft: r.draft, plan: p };
    };
    let out = null, fail = null;
    try { out = await step.do("draft", STEP_TEXT, draftStep(false)); }
    catch (e) {
      if (isGone(e)) return { sbId, gone: true };
      fail = e;
      if (!isQuota(e)) {
        try { out = await step.do("draft-fallback", STEP_TEXT_FB, draftStep(true)); fail = null; }
        catch (e2) { if (isGone(e2)) return { sbId, gone: true }; fail = e2; }
      }
    }
    if (!out) return finalizeBuild(env, step, sbId, isQuota(fail) ? "quota" : "draft_failed", errMsg(fail), ledger);
    draft = out.draft; plan = out.plan;
  }

  // 3. images: anchor -> references (parallel) -> frames (SB_FRAME_CONCURRENCY at a time, re-planned on the refs that exist)
  const done = new Set();
  let quotaHit = false;
  const runJob = async (job) => {
    if (quotaHit || done.has(job.id)) return;
    try {
      const r = await step.do(`img:${job.id}`, STEP_IMAGE, () => renderImage(env, ai, { sbId, job, rev: 0 }));
      done.add(job.id);
      if (r.ledger.neurons || r.ledger.ms) ledger.push(r.ledger);
    } catch (e) {
      if (isGone(e)) throw new NonRetryableError(GONE);
      if (isQuota(e)) quotaHit = true;
      await step.do(`img-failed:${job.id}`, STEP_DB, async () => {   // timed-out attempts were ledgered by renderImage
        await db.prepare("UPDATE sb_images SET status = 'failed', error = ?3, updated_at = ?4 WHERE sb_id = ?1 AND job = ?2 AND r2_key IS NULL")
          .bind(sbId, job.id, isQuota(e) ? "quota" : errMsg(e).slice(0, 120), now()).run();
        return true;
      });
    }
  };
  try {
    for (const j of plan.jobs.filter((x) => x.stage === "anchor")) await runJob(j);
    if (done.has("anchor")) await Promise.all(plan.jobs.filter((x) => x.stage === "refs").map(runJob));
    const frames = draft.scenes.map((sc) => planFrameForOp(draft, sc.n, plan, done, st.seed));
    for (let i = 0; i < frames.length; i += cfg.concurrency) await Promise.all(frames.slice(i, i + cfg.concurrency).map(runJob));
  } catch (e) {
    if (isGone(e)) return { sbId, gone: true };
    throw e;
  }
  return finalizeBuild(env, step, sbId, quotaHit ? "quota" : null, quotaHit ? "Workers AI günlük kapasitesi doldu" : null, ledger);
}

// One batch, the step's only D1 call, so a retry can never repeat part of it: ledger rows, the neuron release and the
// refund all apply only while the build is still queued/running (before buildEndStmts flips it), then the read-back.
// Refund (per-user/IP, not global) only when the build fails for a platform reason (AI quota), not for draft_failed.
async function finalizeBuild(env, step, sbId, code, msg, ledger) {
  const db = env.DB;
  const res = await step.do("finalize", STEP_DB, async () => {
    const out = await db.batch([
      ...ledgerRowsStmts(db, ledger, "build"),
      buildReleaseStmt(db, sbId),
      ...(code === "quota" ? [buildRefundStmt(db, sbId)] : []),
      ...buildEndStmts(db, sbId, code, msg),
      db.prepare(`SELECT s.status, (SELECT json_group_array(o.id) FROM sb_storyboards o WHERE o.post_id = s.post_id AND o.version < s.version) AS older
                  FROM sb_storyboards s WHERE s.id = ?1`).bind(sbId),
    ]);
    const row = (out[out.length - 1].results || [])[0];
    if (!row) return { status: "gone", older: [] };
    return { status: row.status, older: row.status === "failed" ? [] : JSON.parse(row.older || "[]") };
  });
  if (res.older.length) {
    try {
      await step.do("cleanup-older", STEP_DB, async () => {
        for (const id of res.older) { await db.batch(deleteRowsStmts(db, id)); await deleteSbObjects(env, id); }
        return res.older.length;
      });
    } catch (_) { /* the cron sweep removes orphans */ }
  }
  return { sbId, status: res.status };
}

// ---------------------------------------------------------------- redraw / rewrite / resume
async function runOp(env, step, opId) {
  const db = env.DB;
  const st = await step.do("load", STEP_DB, async () => {
    const op = await db.prepare(
      "UPDATE sb_ops SET status = 'running', updated_at = ?2 WHERE id = ?1 AND status IN ('queued','running') RETURNING id, sb_id, kind, n, note"
    ).bind(opId, now()).first();
    if (!op) return null;
    const [sbRes, imgRes] = await db.batch([
      db.prepare("SELECT input_json, research_json, draft_json, plan_json, seed FROM sb_storyboards WHERE id = ?1").bind(op.sb_id),
      db.prepare("SELECT job, kind, n, rev, r2_key FROM sb_images WHERE sb_id = ?1").bind(op.sb_id),
    ]);
    const sb = (sbRes.results || [])[0];
    if (!sb || !sb.draft_json || !sb.plan_json) { await db.batch(opEndStmts(db, opId, op.sb_id, "failed", "gone", null)); return null; }
    return { op, input: JSON.parse(sb.input_json), research: sb.research_json ? JSON.parse(sb.research_json) : null,
      draft: JSON.parse(sb.draft_json), plan: JSON.parse(sb.plan_json), seed: sb.seed, imgs: imgRes.results || [] };
  });
  if (!st) return { opId, skipped: true };
  const { op } = st;
  const sbId = op.sb_id;
  const ai = getAI(env);
  const ledger = [];
  // One batch (see finalizeBuild). A failed op gives the per-user frame units back (global counter stays), except a
  // failed scene rewrite: its note text can force that failure.
  const end = (status, code, msg) => step.do("finish", STEP_DB, async () => {
    await db.batch([
      ...ledgerRowsStmts(db, ledger, "op"),
      opReleaseStmt(db, opId),
      ...(status === "failed" && code !== "scene_failed" ? [opRefundStmt(db, opId)] : []),
      ...opEndStmts(db, opId, sbId, status, code, msg),
    ]);
    return status;
  });

  let draft = st.draft;
  if (op.kind === "rewrite") {
    const sceneStep = (fallback) => async () => {
      const log = [];
      let r;
      try {
        r = await rewriteSceneStage(ai, { ...textInput(st, st.research), draft: st.draft, n: op.n, note: op.note || "" }, log,
          fallback ? { model: TEXT_FALLBACK, params: SCENE_FALLBACK_PARAMS } : {});
      } catch (e) {
        if (!ai.fake && log.length) await db.batch(ledgerRowsStmts(db, textLedgerRows(sbId, opId, log)));
        if (isQuota(e)) throw new NonRetryableError(`QUOTA: ${errMsg(e)}`);
        throw e;
      }
      await db.batch([
        db.prepare("UPDATE sb_storyboards SET draft_json = json_set(draft_json, ?2, json(?3)), updated_at = ?4 WHERE id = ?1")
          .bind(sbId, `$.scenes[${op.n - 1}]`, JSON.stringify(r.scene), now()),
        ...(ai.fake ? [] : ledgerRowsStmts(db, textLedgerRows(sbId, opId, log))),
      ]);
      return r.scene;
    };
    let scene = null, fail = null;
    try { scene = await step.do("scene", STEP_TEXT, sceneStep(false)); }
    catch (e) {
      fail = e;
      if (!isQuota(e)) { try { scene = await step.do("scene-fallback", STEP_TEXT_FB, sceneStep(true)); fail = null; } catch (e2) { fail = e2; } }
    }
    if (!scene) return { opId, status: await end("failed", isQuota(fail) ? "quota" : "scene_failed", errMsg(fail)) };
    draft = { ...draft, scenes: draft.scenes.map((s) => (s.n === op.n ? scene : s)) };
  }

  const done = new Set(st.imgs.filter((i) => i.r2_key).map((i) => i.job));
  const byJob = new Map(st.imgs.map((i) => [i.job, i]));
  const targets = op.kind === "resume" ? draft.scenes.map((s) => s.n).filter((n) => !done.has(`frame_${n}`)) : [op.n];
  let ok = 0, failed = 0, quotaHit = false;
  const runJob = async (job, rev, countIt) => {
    if (quotaHit) { if (countIt) failed++; return; }
    try {
      const r = await step.do(`img:${job.id}:r${rev}`, STEP_IMAGE, () => renderImage(env, ai, { sbId, opId, job, rev }));
      done.add(job.id);
      if (r.ledger.neurons || r.ledger.ms) ledger.push(r.ledger);
      if (countIt) ok++;
    } catch (e) {
      if (isGone(e)) throw new NonRetryableError(GONE);
      if (countIt) failed++;
      if (isQuota(e)) quotaHit = true;
      const code = op.kind === "rewrite" ? "stale_image" : (isQuota(e) ? "quota" : "redraw_failed");
      await step.do(`img-failed:${job.id}:r${rev}`, STEP_DB, async () => {   // timed-out attempts were ledgered by renderImage
        await db.prepare("UPDATE sb_images SET status = CASE WHEN r2_key IS NULL THEN 'failed' ELSE 'done' END, error = ?3, updated_at = ?4 WHERE sb_id = ?1 AND job = ?2")
          .bind(sbId, job.id, code, now()).run();
        return true;
      });
    }
  };
  try {
    if (op.kind === "resume") {   // missing anchor/references first (not charged; ~26-31 neurons each)
      for (const j of st.plan.jobs.filter((x) => x.stage === "anchor" && !done.has(x.id))) await runJob(j, 0, false);
      if (done.has("anchor")) await Promise.all(st.plan.jobs.filter((x) => x.stage === "refs" && !done.has(x.id)).map((j) => runJob(j, 0, false)));
    }
    const cfg = sbConfig(env);
    const jobs = targets.map((n) => {
      const img = byJob.get(`frame_${n}`) || { rev: 0, r2_key: null };
      const rev = img.r2_key ? (img.rev || 0) + 1 : (img.rev || 0);
      return { job: planFrameForOp(draft, n, st.plan, done, seedFor(st.seed, n, rev)), rev };
    });
    for (let i = 0; i < jobs.length; i += cfg.concurrency) await Promise.all(jobs.slice(i, i + cfg.concurrency).map((x) => runJob(x.job, x.rev, true)));
  } catch (e) {
    if (isGone(e)) return { opId, gone: true };
    throw e;
  }
  return { opId, status: await end(ok > 0 ? "done" : "failed", failed ? (quotaHit ? "quota" : "frames_failed") : null, null) };
}
