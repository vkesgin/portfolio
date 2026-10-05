// routes.js: /api/inspire/* storyboard routes + the hooks the existing inspire handlers call.
// Called from handleInspire() (worker/index.js) AFTER ensureInspireSchema(); every response goes through deps.ok/deps.fail,
// so CORS headers and the {error, message} error shape are the same as the rest of the inspire API.
//
// deps = { db, ok(data, status), fail(status, error, message, extra), getActor(), readBody(), cleanText, postSelect, ownerParams, maxText,
//          overLimit(actor) -> true when the caller is over the inspire rate limit (buckets 'sb' / 'sb_ip'), limited() -> 429 }
import {
  sbConfig, utcDay, now, filePath, SB_ID_RE, OP_ID_RE, newId, newSeed, COST, QUOTA_ERRORS, quotaItems, neuronItem, quotaStmts, refundStmts,
  isCheckError, isUniqueError, whichQuota, quotaLeft, quotaSubject, ipSubject, SB_SUMMARY_SQL, summaryOut,
  buildEndStmts, opEndStmts, buildRefundStmt, opRefundStmt, startInstance, instanceStatus, terminateInstance, deleteSbObjects, deleteRowsStmts,
  ensureStoryboardSchema,
} from "./db.js";
import { TEXT_MODEL } from "./prompt.v6.js";
import { IMG_MODEL } from "./images.js";
import { localizeCharNames } from "./postprocess.js";

export { ensureStoryboardSchema };

const FORMATS = new Set(["auto", "16:9", "9:16"]);
const MSG = {
  sb_disabled: "Storyboard özelliği şu an kapalı.",
  sb_admin_only: "Storyboard şimdilik yalnızca yönetici için açık.",
  sb_busy: "Bu storyboard için devam eden bir işlem var. Bitince tekrar dene.",
  sb_unavailable: "Arka plan işi başlatılamadı. Biraz sonra tekrar dene.",
};
const clean1 = (deps, v, max) => {
  const s = deps.cleanText(typeof v === "string" ? v : "").replace(/\s+/g, " ").trim();
  return Array.from(s).slice(0, max).join("");
};

// ---------------------------------------------------------------- hooks for existing handlers
// GET /api/inspire/config: adds `sb` and sets `storyboard` (= creation UI allowed for this caller).
export async function sbConfigPayload(env, db, actor) {
  const cfg = sbConfig(env);
  const canCreate = cfg.enabled && !!actor && (!cfg.adminOnly || actor.isAdmin);
  const out = {
    enabled: cfg.enabled, admin_only: cfg.adminOnly, can_create: canCreate,
    limits: { daily: cfg.dailyLimit, per_user: cfg.perUser, frame_daily: cfg.frameDaily, frame_per_user: cfg.framePerUser },
    left: null,
  };
  if (actor) out.left = await quotaLeft(db, cfg, actor, quotaSubject(actor));
  return out;
}

// GET /api/inspire/posts: every text post gets `storyboard` (summary of its latest version) or null.
// Only the posts of this page are looked up (the board is paged, see INSPIRE_PAGE_SIZE).
export async function sbAttachSummaries(env, db, list) {
  const ids = list.filter((p) => p && p.type === "text").map((p) => Number(p.id));
  if (!ids.length) return list;
  const { results } = await db.prepare(`${SB_SUMMARY_SQL} AND s.post_id IN (SELECT value FROM json_each(?1))`).bind(JSON.stringify(ids)).all();
  const byPost = new Map((results || []).map((r) => [Number(r.post_id), summaryOut(r)]));
  for (const p of list) if (p && p.type === "text") p.storyboard = byPost.get(Number(p.id)) || null;
  return list;
}

// POST /api/inspire/posts (type 'text' with a `storyboard` object): start right after the post insert.
// Returns fields to spread into the 201 response; never fails the post itself.
export async function sbStartForNewPost(env, ctx, deps, request, actor, postId, spec) {
  const [cid, uid] = deps.ownerParams(actor);
  const post = await deps.db.prepare(`${deps.postSelect} WHERE p.id = ?3`).bind(cid, uid, postId).first();
  const r = await startStoryboard(env, ctx, deps, request, actor, post, parseSpec(deps, spec && typeof spec === "object" ? spec : {}));
  if (r.error) return { storyboard: null, storyboard_error: { error: r.error, message: r.message }, sb_left: r.left || null };
  return { storyboard: r.summary, sb_left: r.left };
}

// DELETE /api/inspire/posts/:id: { stmts } to add to its batch, then cleanup() via ctx.waitUntil AFTER the batch succeeded.
export async function sbDeleteForPost(env, db, postId) {
  const [a, b] = await db.batch([
    db.prepare("SELECT id FROM sb_storyboards WHERE post_id = ?1").bind(postId),
    db.prepare("SELECT o.id FROM sb_ops o JOIN sb_storyboards s ON s.id = o.sb_id WHERE s.post_id = ?1 AND o.status IN ('queued','running')").bind(postId),
  ]);
  const ids = (a.results || []).map((r) => r.id);
  const ops = (b.results || []).map((r) => r.id);
  return {
    stmts: ids.flatMap((id) => deleteRowsStmts(db, id)),
    cleanup: async () => {
      for (const id of [...ids, ...ops]) await terminateInstance(env, id);
      for (const id of ids) { try { await deleteSbObjects(env, id); } catch (e) { console.error("sb cleanup", id, e && e.message); } }
    },
  };
}

// ---------------------------------------------------------------- shared start logic
function parseSpec(deps, d) {
  const out = {};
  if (d.brand !== undefined) out.brand = clean1(deps, d.brand, 80);
  if (d.place !== undefined) out.place = clean1(deps, d.place, 80);
  if (d.format !== undefined) { if (!FORMATS.has(d.format)) return { bad: "format" }; out.format = d.format; }
  if (d.corrections !== undefined) {
    const c = deps.cleanText(typeof d.corrections === "string" ? d.corrections : "");
    if (c.length > 500) return { bad: "corrections" };
    out.corrections = c;
  }
  return out;
}
const sameText = (a, b) => String(a || "").trim() === String(b || "").trim();

async function startStoryboard(env, ctx, deps, request, actor, post, spec) {
  const db = deps.db, cfg = sbConfig(env);
  const subject = quotaSubject(actor);
  const bad = (status, error, message) => ({ status, error, message });
  if (!cfg.enabled) return bad(503, "sb_disabled", MSG.sb_disabled);
  if (cfg.adminOnly && !actor.isAdmin) return bad(403, "sb_admin_only", MSG.sb_admin_only);
  if (!post) return bad(404, "not_found", "Fikir bulunamadı");
  if (post.type !== "text") return bad(400, "not_text", "Storyboard yalnızca metin fikirler için oluşturulabilir");
  if (!(post.is_mine || actor.isAdmin)) return bad(403, "forbidden", "Bu fikir için storyboard oluşturma yetkin yok");
  if (spec.bad) return bad(400, "bad_field", "Geçersiz alan: " + spec.bad);
  const prev = await db.prepare("SELECT id, version, status, input_json, research_json FROM sb_storyboards WHERE post_id = ?1 ORDER BY version DESC LIMIT 1")
    .bind(post.id).first();
  if (prev && (prev.status === "queued" || prev.status === "running")) return bad(409, "sb_busy", MSG.sb_busy);
  const pin = prev ? JSON.parse(prev.input_json) : {};
  const input = {
    idea: String(post.description || "").slice(0, deps.maxText),
    brand: spec.brand !== undefined ? spec.brand : pin.brand || "",
    place: spec.place !== undefined ? spec.place : pin.place || "",
    format: spec.format || pin.format || "auto",
    corrections: [pin.corrections, spec.corrections].filter((x) => x && String(x).trim()).join("\n").slice(-600),
  };
  if (!input.idea.trim()) return bad(400, "empty_text", "Fikir metni boş");
  const day = utcDay();
  const reuseResearch = prev && prev.research_json && sameText(pin.idea, input.idea) && sameText(pin.brand, input.brand) && sameText(pin.place, input.place)
    ? prev.research_json : null;
  const ip = actor.isAdmin ? null : await ipSubject(request, env);
  // Counters + the build's neuron reservation (capacity guard) are taken atomically with the insert.
  const items = [...quotaItems(cfg, actor, "sb", 1, subject, ip), neuronItem(cfg, COST.build)];
  const sbId = newId("sb_");
  const t = now();
  const [cid, uid] = deps.ownerParams(actor);
  // Earlier FAILED versions go in the same batch: a failed build has no draft and no images (it ends before the image
  // stage), so nothing is lost, and a post keeps at most one failed version, always the latest (the board offers the
  // previous finished version next to it, see SB_SUMMARY_SQL previous_id).
  const failedOf = "SELECT id FROM sb_storyboards WHERE post_id = ?1 AND status = 'failed'";
  try {
    await db.batch([
      ...quotaStmts(db, day, items),
      db.prepare(`DELETE FROM sb_images WHERE sb_id IN (${failedOf})`).bind(post.id),
      db.prepare(`DELETE FROM sb_ops WHERE sb_id IN (${failedOf})`).bind(post.id),
      db.prepare("DELETE FROM sb_storyboards WHERE post_id = ?1 AND status = 'failed'").bind(post.id),
      db.prepare(`INSERT INTO sb_storyboards (id, post_id, version, status, stage, input_json, research_json, seed, author_name, client_id, user_id,
                    quota_subject, ip_subject, day, reserve, created_at, updated_at)
                  VALUES (?1, ?2, ?3, 'queued', 'queued', ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?14, ?13, ?13)`)
        .bind(sbId, post.id, prev ? prev.version + 1 : 1, JSON.stringify(input), reuseResearch, newSeed(),
          actor.guest ? actor.name : null, cid, uid, subject, ip, day, t, items[items.length - 1].units),
    ]);
  } catch (e) {
    if (isUniqueError(e)) return bad(409, "sb_busy", MSG.sb_busy);
    if (isCheckError(e)) {
      const [code, message] = QUOTA_ERRORS[await whichQuota(db, day, items)];
      return { ...bad(429, code, message), left: await quotaLeft(db, cfg, actor, subject, day) };
    }
    throw e;
  }
  try {
    await startInstance(env, sbId, { op: "build", sbId });
  } catch (e) {
    console.error("sb start", sbId, e && e.message);
    await db.batch([...refundStmts(db, day, items), ...deleteRowsStmts(db, sbId)]);
    return bad(503, "sb_unavailable", MSG.sb_unavailable);
  }
  const row = await db.prepare(`${SB_SUMMARY_SQL} AND s.id = ?1`).bind(sbId).first();
  return { summary: summaryOut(row), left: await quotaLeft(db, cfg, actor, subject, day) };
}

// ---------------------------------------------------------------- full storyboard JSON (viewer + polling)
function publicDraft(d, admin) {
  if (!d) return null;
  const scenes = (d.scenes || []).map((s) => {
    const o = { n: s.n, title: s.title, duration_s: s.duration_s, shot: s.shot, camera_move: s.camera_move, action: s.action,
      onscreen_text: s.onscreen_text, vo: s.vo, sound: s.sound };
    if (admin) { o.characters = s.characters; o.image_prompt_en = s.image_prompt_en; }
    return o;
  });
  const out = { title: d.title, logline: d.logline, core_message: d.core_message, interpretations: d.interpretations || [],
    assumptions: d.assumptions || [], aspect_ratio: d.aspect_ratio, scenes };
  if (admin) { out.location_en = d.location_en; out.characters_en = d.characters_en; out.anchor_prompt_en = d.anchor_prompt_en; }
  return out;
}
const hostOf = (u) => { try { return new URL(u).hostname.replace(/^www\./, ""); } catch (_) { return ""; } };

// A job whose instance is gone (stale) is a platform failure: a build that ends 'failed' gives the per-user/IP unit
// back, a failed op its frame units (the refund statements run only while the row is still queued/running). The neuron
// reservation is kept for the day (unknown real cost).
const closeStaleBuild = (db, sbId, msg) => db.batch([buildRefundStmt(db, sbId), ...buildEndStmts(db, sbId, "stale", msg)]);
const closeStaleOp = (db, opId, sbId, msg) => db.batch([opRefundStmt(db, opId), ...opEndStmts(db, opId, sbId, "failed", "stale", msg)]);
const INSTANCE_ENDED = ["errored", "terminated", "unknown", "complete"];

async function reconcileIfStale(env, db, cfg, sb, ops) {
  const old = now() - cfg.staleMs;
  let changed = false;
  if ((sb.status === "queued" || sb.status === "running") && sb.updated_at < old) {
    const st = await instanceStatus(env, sb.id);
    if (INSTANCE_ENDED.includes(st.status)) {
      await closeStaleBuild(db, sb.id, st.error && st.error.message);
      changed = true;
    }
  }
  for (const o of ops) {
    if ((o.status === "queued" || o.status === "running") && o.updated_at < old) {
      const st = await instanceStatus(env, o.id);
      if (INSTANCE_ENDED.includes(st.status)) {
        await closeStaleOp(db, o.id, sb.id, st.error && st.error.message);
        changed = true;
      }
    }
  }
  return changed;
}

async function loadFull(env, deps, sbId, actor, debug) {
  const db = deps.db, cfg = sbConfig(env);
  const read = () => db.batch([
    db.prepare("SELECT * FROM sb_storyboards WHERE id = ?1").bind(sbId),
    db.prepare("SELECT job, kind, n, status, rev, r2_key, width, height, error FROM sb_images WHERE sb_id = ?1 AND kind = 'frame' ORDER BY n").bind(sbId),
    db.prepare("SELECT id, kind, n, status, error_code, created_at, updated_at FROM sb_ops WHERE sb_id = ?1 ORDER BY created_at DESC LIMIT 10").bind(sbId),
  ]);
  let [a, b, c] = await read();
  let sb = (a.results || [])[0];
  if (!sb) return null;
  if (await reconcileIfStale(env, db, cfg, sb, c.results || [])) { [a, b, c] = await read(); sb = (a.results || [])[0]; if (!sb) return null; }
  const [cid, uid] = deps.ownerParams(actor);
  const post = await db.prepare(`${deps.postSelect} WHERE p.id = ?3`).bind(cid, uid, sb.post_id).first();
  const prev = await db.prepare("SELECT id FROM sb_storyboards WHERE post_id = ?1 AND version < ?2 AND status IN ('done','partial') ORDER BY version DESC LIMIT 1")
    .bind(sb.post_id, sb.version).first();
  const admin = !!(actor && actor.isAdmin);
  const owner = !!(actor && post && (post.is_mine || admin));
  const draft = sb.draft_json ? JSON.parse(sb.draft_json) : null;
  if (draft) localizeCharNames(draft);   // drafts stored before the lint replaced English character ids ("THE COMMUTER aniden durur")
  const research = sb.research_json ? JSON.parse(sb.research_json) : null;
  const input = JSON.parse(sb.input_json);
  const imgs = new Map((b.results || []).map((r) => [r.n, r]));
  const frames = draft ? draft.scenes.map((s) => {
    const r = imgs.get(s.n) || {};
    return { n: s.n, status: r.status || "pending", path: filePath(r.r2_key), rev: r.rev || 0, width: r.width || null, height: r.height || null,
      error: r.error || null, busy: r.status === "pending" || r.status === "running" };
  }) : [];
  const ops = (c.results || []).map((o) => ({ id: o.id, kind: o.kind, n: o.n, status: o.status, error: o.error_code || null, created_at: o.created_at }));
  const active = sb.status === "queued" || sb.status === "running" || ops.some((o) => o.status === "queued" || o.status === "running");
  const out = {
    id: sb.id, post_id: sb.post_id, version: sb.version, previous_id: prev ? prev.id : null,
    status: sb.status, stage: sb.stage, error: sb.error_code ? { code: sb.error_code } : null,
    input: { brand: input.brand || "", place: input.place || "", format: input.format || "auto", corrections: input.corrections || "" },
    entities: research && research.entities ? { brand: research.entities.brand || null, place: research.entities.place || null } : null,
    research: research ? { degraded: research.degraded || null, sources: (research.sources || []).slice(0, 6).map((s) => ({ title: s.title, host: hostOf(s.url) })) } : null,
    draft: publicDraft(draft, admin && debug),
    frames, frame_total: frames.length, frame_done: frames.filter((f) => f.path).length,
    ops, seed: sb.seed,
    models: { text: sb.text_model || TEXT_MODEL, image: IMG_MODEL },
    can_edit: owner && cfg.enabled && (!cfg.adminOnly || admin),
    can_delete: owner,
    created_at: sb.created_at, updated_at: sb.updated_at,
    poll_ms: active ? (sb.stage === "draft" || sb.stage === "research" || sb.stage === "queued" ? 4000 : 2500) : null,
  };
  if (admin && debug) out.debug = { input, lint: sb.lint_json ? JSON.parse(sb.lint_json) : null, research, plan: sb.plan_json ? JSON.parse(sb.plan_json) : null };
  return out;
}

// ---------------------------------------------------------------- router
// Inspire rate limiter (worker/index.js inspireOverLimit, buckets 'sb' per cid/user and 'sb_ip'); mutating routes only.
const overLimit = async (deps, actor) => (typeof deps.overLimit === "function" ? !!(await deps.overLimit(actor)) : false);

export async function handleStoryboard(request, env, ctx, path, method, deps) {
  const { db, ok, fail } = deps;
  let m;
  const err = (r) => fail(r.status, r.error, r.message, r.left ? { left: r.left } : undefined);

  // Start a storyboard (new version) for an existing text idea. Also "Yorumu düzelt" (with corrections).
  if ((m = path.match(/^\/api\/inspire\/posts\/(\d{1,15})\/storyboards$/)) && method === "POST") {
    const actor = await deps.getActor();
    if (!actor) return fail(401, "unauthorized", "Önce giriş yapın");
    if (await overLimit(deps, actor)) return deps.limited();
    const d = await deps.readBody();
    if (!d) return fail(400, "bad_request", "Geçersiz istek");
    const [cid, uid] = deps.ownerParams(actor);
    const post = await db.prepare(`${deps.postSelect} WHERE p.id = ?3`).bind(cid, uid, Number(m[1])).first();
    const r = await startStoryboard(env, ctx, deps, request, actor, post, parseSpec(deps, d));
    if (r.error) return err(r);
    return ok({ storyboard: r.summary, left: r.left }, 202);
  }

  if ((m = path.match(/^\/api\/inspire\/storyboards\/(sb_[0-9a-f]{32})$/)) && method === "GET") {
    const actor = await deps.getActor();   // optional: everyone can view
    const full = await loadFull(env, deps, m[1], actor, new URL(request.url).searchParams.get("debug") === "1");
    if (!full) return fail(404, "not_found", "Storyboard bulunamadı");
    return ok(full);
  }

  if ((m = path.match(/^\/api\/inspire\/storyboards\/(sb_[0-9a-f]{32})$/)) && method === "DELETE") {
    const actor = await deps.getActor();
    if (!actor) return fail(401, "unauthorized", "Önce giriş yapın");
    if (await overLimit(deps, actor)) return deps.limited();
    const sb = await db.prepare("SELECT id, post_id FROM sb_storyboards WHERE id = ?1").bind(m[1]).first();
    if (!sb) return fail(404, "not_found", "Storyboard bulunamadı");
    const [cid, uid] = deps.ownerParams(actor);
    const post = await db.prepare(`${deps.postSelect} WHERE p.id = ?3`).bind(cid, uid, sb.post_id).first();
    if (!(actor.isAdmin || (post && post.is_mine))) return fail(403, "forbidden", "Bu storyboard'u silme yetkin yok");
    const { results } = await db.prepare("SELECT id FROM sb_ops WHERE sb_id = ?1 AND status IN ('queued','running')").bind(sb.id).all();
    await db.batch(deleteRowsStmts(db, sb.id));
    const job = (async () => {
      await terminateInstance(env, sb.id);
      for (const o of results || []) await terminateInstance(env, o.id);
      await deleteSbObjects(env, sb.id);
    })().catch((e) => console.error("sb delete cleanup", sb.id, e && e.message));
    if (ctx && ctx.waitUntil) ctx.waitUntil(job);
    return ok({ ok: true });
  }

  // Redraw one frame (new seed) | rewrite one scene with a note, then redraw | resume missing frames
  const opMatch = (m = path.match(/^\/api\/inspire\/storyboards\/(sb_[0-9a-f]{32})\/(?:frames\/(\d{1,2})\/(redraw)|scenes\/(\d{1,2})\/(rewrite)|(resume))$/)) && method === "POST";
  if (opMatch) {
    const sbId = m[1];
    const kind = m[3] || m[5] || m[6];
    const n = kind === "resume" ? 0 : Number(m[2] || m[4]);
    const cfg = sbConfig(env);
    if (!cfg.enabled) return fail(503, "sb_disabled", MSG.sb_disabled);
    const actor = await deps.getActor();
    if (!actor) return fail(401, "unauthorized", "Önce giriş yapın");
    if (cfg.adminOnly && !actor.isAdmin) return fail(403, "sb_admin_only", MSG.sb_admin_only);
    if (await overLimit(deps, actor)) return deps.limited();
    const d = await deps.readBody();
    if (!d) return fail(400, "bad_request", "Geçersiz istek");
    const sb = await db.prepare(`SELECT id, post_id, status, draft_json IS NOT NULL AS has_draft,
        CASE WHEN draft_json IS NULL THEN 0 ELSE json_array_length(draft_json, '$.scenes') END AS scenes FROM sb_storyboards WHERE id = ?1`).bind(sbId).first();
    if (!sb) return fail(404, "not_found", "Storyboard bulunamadı");
    const [cid, uid] = deps.ownerParams(actor);
    const post = await db.prepare(`${deps.postSelect} WHERE p.id = ?3`).bind(cid, uid, sb.post_id).first();
    if (!(actor.isAdmin || (post && post.is_mine))) return fail(403, "forbidden", "Bu storyboard'u değiştirme yetkin yok");
    if (sb.status === "queued" || sb.status === "running") return fail(409, "sb_busy", MSG.sb_busy);
    if (!sb.has_draft) return fail(400, "no_draft", "Bu storyboard'un sahne metni yok; yeniden oluştur.");
    if (kind !== "resume" && (n < 1 || n > sb.scenes)) return fail(400, "bad_frame", "Geçersiz sahne numarası");
    let note = null;
    if (kind === "rewrite") {
      note = deps.cleanText(typeof d.note === "string" ? d.note : "");
      if (Array.from(note).length < 3 || Array.from(note).length > 300) return fail(400, "bad_note", "Not 3-300 karakter olmalı");
    }
    const { results: act } = await db.prepare("SELECT n FROM sb_ops WHERE sb_id = ?1 AND status IN ('queued','running')").bind(sbId).all();
    if ((act || []).some((o) => o.n === 0 || kind === "resume" || o.n === n)) return fail(409, "sb_busy", MSG.sb_busy);
    let units = 1, refs = 0;
    if (kind === "resume") {   // units = missing frames; missing anchor/references are redrawn too (not charged, but reserved)
      const r = await db.prepare("SELECT COALESCE(SUM(kind = 'frame'), 0) AS frames, COALESCE(SUM(kind <> 'frame'), 0) AS refs FROM sb_images WHERE sb_id = ?1 AND r2_key IS NULL").bind(sbId).first();
      units = r ? r.frames : 0;
      refs = r ? r.refs : 0;
      if (!units) return fail(400, "nothing_to_resume", "Eksik kare yok");
    }
    const day = utcDay();
    const subject = quotaSubject(actor);
    // Frame-unit counters + the op's neuron reservation (capacity guard), atomically with the insert.
    const reserve = units * COST.frame + refs * COST.ref + (kind === "rewrite" ? COST.scene : 0);
    const items = [...quotaItems(cfg, actor, "fr", units, subject, null), neuronItem(cfg, reserve)];
    const opId = newId("op_");
    const t = now();
    const busyImg = kind === "resume"
      ? db.prepare("UPDATE sb_images SET status = 'pending', updated_at = ?2 WHERE sb_id = ?1 AND kind = 'frame' AND r2_key IS NULL").bind(sbId, t)
      : db.prepare("UPDATE sb_images SET status = 'pending', updated_at = ?2 WHERE sb_id = ?1 AND job = ?3").bind(sbId, t, `frame_${n}`);
    try {
      await db.batch([
        ...quotaStmts(db, day, items),
        db.prepare(`INSERT INTO sb_ops (id, sb_id, kind, n, note, status, units, quota_subject, day, reserve, created_at, updated_at)
                    VALUES (?1, ?2, ?3, ?4, ?5, 'queued', ?6, ?7, ?8, ?10, ?9, ?9)`).bind(opId, sbId, kind, n, note, units, subject, day, t, items[items.length - 1].units),
        busyImg,
      ]);
    } catch (e) {
      if (isUniqueError(e)) return fail(409, "sb_busy", MSG.sb_busy);
      if (isCheckError(e)) {
        const [code, message] = QUOTA_ERRORS[await whichQuota(db, day, items)];
        return fail(429, code, message, { left: await quotaLeft(db, cfg, actor, subject, day) });
      }
      throw e;
    }
    try {
      await startInstance(env, opId, { op: kind, opId });
    } catch (e) {
      console.error("sb op start", opId, e && e.message);
      await db.batch([...refundStmts(db, day, items), ...opEndStmts(db, opId, sbId, "failed", "start_failed", null)]);
      return fail(503, "sb_unavailable", MSG.sb_unavailable);
    }
    return ok({ op: { id: opId, kind, n, status: "queued" }, left: await quotaLeft(db, cfg, actor, subject, day) }, 202);
  }

  // Admin: today's counters, neuron ledger, Tavily credits, active jobs
  if (path === "/api/inspire/sb-admin/usage" && method === "GET") {
    const actor = await deps.getActor();
    if (!actor || !actor.isAdmin) return fail(403, "forbidden", "Yalnızca yönetici");
    const day = utcDay();
    const [q, l, tv, act] = await db.batch([
      db.prepare("SELECT scope, subject, n, lim FROM sb_quota WHERE day = ?1 ORDER BY scope, n DESC").bind(day),
      db.prepare("SELECT kind, model, COUNT(*) AS calls, ROUND(SUM(neurons), 1) AS neurons FROM sb_ledger WHERE day = ?1 GROUP BY kind, model").bind(day),
      db.prepare("SELECT COALESCE(SUM(credits), 0) AS credits FROM sb_ledger WHERE kind = 'tavily' AND day >= ?1").bind(day.slice(0, 8) + "01"),
      db.prepare("SELECT id, post_id, status, stage, updated_at FROM sb_storyboards WHERE status IN ('queued','running') ORDER BY updated_at").bind(),
    ]);
    return ok({ day, quota: q.results || [], ledger: l.results || [], tavily_credits_month: (tv.results || [])[0]?.credits || 0,
      active: act.results || [], config: sbConfig(env) });
  }

  return null;
}

// ---------------------------------------------------------------- cron (every 15 min): stale jobs + housekeeping
export async function sbScheduled(env) {
  await ensureStoryboardSchema(env);
  const db = env.DB, cfg = sbConfig(env);
  const old = now() - cfg.staleMs;
  const [a, b] = await db.batch([
    db.prepare("SELECT id, status, updated_at FROM sb_storyboards WHERE status IN ('queued','running') AND updated_at < ?1 ORDER BY updated_at LIMIT 10").bind(old),
    db.prepare("SELECT id, sb_id, status, updated_at FROM sb_ops WHERE status IN ('queued','running') AND updated_at < ?1 ORDER BY updated_at LIMIT 10").bind(old),
  ]);
  for (const sb of a.results || []) {
    const st = await instanceStatus(env, sb.id);
    if (INSTANCE_ENDED.includes(st.status)) await closeStaleBuild(db, sb.id, st.error && st.error.message);
  }
  for (const o of b.results || []) {
    const st = await instanceStatus(env, o.id);
    if (INSTANCE_ENDED.includes(st.status)) await closeStaleOp(db, o.id, o.sb_id, st.error && st.error.message);
  }
  // Orphans: storyboards whose post is gone (post deleted while R2 cleanup failed, or the user row was deleted and the
  // post went with it), plus image/op rows left without a storyboard. A build may still be running: its instances are
  // terminated first, so it cannot render into the prefix after it was cleared (its own D1 checks stop it otherwise).
  const [o1, o2] = await db.batch([
    db.prepare(`SELECT s.id, (SELECT json_group_array(o.id) FROM sb_ops o WHERE o.sb_id = s.id AND o.status IN ('queued','running')) AS ops
                FROM sb_storyboards s WHERE NOT EXISTS (SELECT 1 FROM inspire_posts p WHERE p.id = s.post_id) LIMIT 5`),
    db.prepare(`SELECT sb_id AS id FROM (SELECT sb_id FROM sb_images UNION SELECT sb_id FROM sb_ops) x
                WHERE NOT EXISTS (SELECT 1 FROM sb_storyboards s WHERE s.id = x.sb_id) LIMIT 5`),
  ]);
  for (const o of o1.results || []) {
    await terminateInstance(env, o.id);
    for (const opId of JSON.parse(o.ops || "[]")) await terminateInstance(env, opId);
    await db.batch(deleteRowsStmts(db, o.id));
    await deleteSbObjects(env, o.id);
  }
  for (const o of o2.results || []) { await db.batch(deleteRowsStmts(db, o.id)); await deleteSbObjects(env, o.id); }
  const cutoff = utcDay(now() - 90 * 86400e3);
  await db.batch([
    db.prepare("DELETE FROM sb_quota WHERE day < ?1").bind(utcDay(now() - 7 * 86400e3)),
    db.prepare("DELETE FROM sb_ledger WHERE day < ?1").bind(cutoff),
  ]);
}
