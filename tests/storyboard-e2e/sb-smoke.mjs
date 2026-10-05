// sb-smoke.mjs: end-to-end checks against `wrangler dev -c worker/wrangler.sbtest.toml` (SB_FAKE_AI=1, no neurons).
// usage: node tests/storyboard-e2e/sb-smoke.mjs [base=http://127.0.0.1:8813] [mode=main|fail_frame|fail_draft|fail_quota|global_limit|kpss|kpss_nopw]
// (normally started by run-mode.sh). Reads ADMIN_PASSWORD from worker/.dev.vars (TEST value) and never prints it.
// Requests carry "X-Fikir-Client: 2" like fikir.html; old clients (no header) must not see storyboard fields.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const BASE = process.argv[2] || "http://127.0.0.1:8813";
const MODE = process.argv[3] || "main";
const HERE = path.dirname(fileURLToPath(import.meta.url));
const devVars = Object.fromEntries(fs.readFileSync(path.join(HERE, "../../worker/.dev.vars"), "utf8").split("\n").filter(Boolean).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]));
let n = 0;
const ok = (msg) => console.log(`ok ${++n} ${msg}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const cid = () => "t" + Math.random().toString(36).slice(2) + Date.now().toString(36) + "xxxxxxxx";

if (!/^http:\/\/127\.0\.0\.1:\d+$/.test(BASE)) throw new Error("local worker only");
async function call(method, p, body, token, { legacy = false } = {}) {
  const headers = legacy ? {} : { "X-Fikir-Client": "2" };
  if (body != null) headers["Content-Type"] = "application/json";
  if (token) headers.Authorization = "Bearer " + token;
  const res = await fetch(BASE + p, { method, headers, body: body != null ? JSON.stringify(body) : undefined });
  const text = await res.text();
  let data = null; try { data = JSON.parse(text); } catch (_) { data = text; }
  return { status: res.status, data, headers: res.headers };
}
async function guest(name) {
  const r = await call("POST", "/api/inspire/guest", { name, cid: cid() });
  assert.equal(r.status, 200); return r.data.token;
}
async function admin() {
  const r = await call("POST", "/api/inspire/login", { username: "vkesgin38", password: devVars.ADMIN_PASSWORD });
  assert.equal(r.status, 200, "admin login"); return r.data.token;
}
async function waitSb(id, token, pred = (s) => !["queued", "running"].includes(s.status) && !s.ops.some((o) => ["queued", "running"].includes(o.status)), maxMs = 90000) {
  const t0 = Date.now(); const stages = [];
  let firstDraftAt = null, firstFrameAt = null;
  for (;;) {
    const r = await call("GET", `/api/inspire/storyboards/${id}`, null, token);
    assert.equal(r.status, 200, JSON.stringify(r.data));
    const s = r.data;
    if (!stages.includes(s.stage)) stages.push(s.stage);
    if (s.draft && firstDraftAt == null) firstDraftAt = Date.now();
    if (s.frame_done > 0 && firstFrameAt == null) firstFrameAt = Date.now();
    if (pred(s)) return { s, stages, firstDraftAt, firstFrameAt };
    if (Date.now() - t0 > maxMs) throw new Error("timeout waiting for " + id + " " + JSON.stringify({ status: s.status, stage: s.stage, ops: s.ops }));
    await sleep(500);
  }
}
const textPost = (token, text, storyboard) => call("POST", "/api/inspire/posts", { type: "text", text, ...(storyboard ? { storyboard } : {}) }, token);
const IDEA = "Sayın Gayrimenkul için STM'nin sokaklarında fil dolaşacak, dükkan aralarının büyüklüğünü göstermek için";

if (MODE === "main") {
  // config
  let r = await call("GET", "/api/inspire/config");
  assert.equal(r.status, 200); assert.equal(r.data.storyboard, false); assert.equal(r.data.sb.enabled, true); assert.equal(r.data.sb.left, null);
  const A = await guest("Ayşe");
  r = await call("GET", "/api/inspire/config", null, A);
  assert.equal(r.data.storyboard, true); assert.equal(r.data.sb.left.per_user, 3); assert.equal(r.data.sb.left.storyboards, 3);
  r = await call("GET", "/api/inspire/config", null, "garbage.token.x");
  assert.equal(r.status, 200, "invalid token on config never 401");
  ok("config: public + authenticated quota");

  // create with the post
  r = await textPost(A, IDEA, { brand: "Sayın Gayrimenkul", place: "", format: "9:16" });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  assert.ok(r.data.storyboard && /^sb_[0-9a-f]{32}$/.test(r.data.storyboard.id)); assert.equal(r.data.storyboard.status, "queued");
  assert.equal(r.data.sb_left.per_user, 2);
  const postId = r.data.id; const sb1 = r.data.storyboard.id;
  r = await call("POST", `/api/inspire/posts/${postId}/storyboards`, {}, A);
  assert.equal(r.status, 409); assert.equal(r.data.error, "sb_busy");
  ok("create with post -> 201 + summary; second start while running -> 409 sb_busy");

  let w = await waitSb(sb1, A);
  assert.equal(w.s.status, "done", JSON.stringify(w.s.error)); assert.equal(w.s.draft.aspect_ratio, "9:16");
  assert.ok(w.firstDraftAt <= w.firstFrameAt, "draft before frames");
  assert.ok(w.stages.includes("images"), JSON.stringify(w.stages));
  assert.equal(w.s.frame_done, w.s.frame_total); assert.ok(w.s.frame_total >= 3);
  assert.equal(w.s.can_edit, true); assert.equal(w.s.research.degraded, null); assert.ok(w.s.research.sources.length > 0);
  assert.ok(!("image_prompt_en" in w.s.draft.scenes[0]), "prompts hidden from non-admin");
  const f1 = w.s.frames[1];
  r = await fetch(BASE + f1.path);
  assert.equal(r.status, 200); assert.match(r.headers.get("content-type"), /image\/jpeg/); assert.match(r.headers.get("cache-control"), /max-age=31536000/);
  ok(`build: stages ${w.stages.join(">")}, ${w.s.frame_total} frames, format forced 9:16, files served`);

  r = await call("GET", "/api/inspire/posts", null, A);
  const card = r.data.find((p) => p.id === postId);
  assert.equal(card.storyboard.id, sb1); assert.equal(card.storyboard.status, "done"); assert.ok(card.storyboard.thumbs.length >= 3);
  assert.ok(r.data.filter((p) => p.type !== "text").every((p) => !("storyboard" in p)));
  ok("posts list carries storyboard summary with thumbs");
  r = await call("GET", "/api/inspire/posts", null, A, { legacy: true });
  assert.equal(r.status, 200); assert.ok(r.data.length > 0 && r.data.every((p) => !("storyboard" in p)), "old client: no storyboard fields");
  r = await call("POST", "/api/inspire/posts", { type: "text", text: "Eski sayfadan metin fikir", storyboard: { format: "auto" } }, A, { legacy: true });
  assert.equal(r.status, 201); assert.ok(!("storyboard" in r.data) && !("storyboard_error" in r.data) && !("sb_left" in r.data), "old client: plain 201");
  r = await call("GET", "/api/inspire/config", null, A);
  assert.equal(r.data.sb.left.per_user, 2, "old client post did not start a storyboard");
  assert.equal((await call("DELETE", `/api/inspire/posts/${(await call("GET", "/api/inspire/posts", null, A)).data.find((p) => p.description === "Eski sayfadan metin fikir").id}`, null, A)).status, 200);
  ok("old client (no X-Fikir-Client: 2): no storyboard fields in list / 201, no storyboard started");

  // permissions
  const B = await guest("Bora");
  r = await call("GET", `/api/inspire/storyboards/${sb1}`, null, B);
  assert.equal(r.status, 200); assert.equal(r.data.can_edit, false);
  r = await call("GET", `/api/inspire/storyboards/${sb1}`);
  assert.equal(r.status, 200, "anonymous view");
  r = await call("POST", `/api/inspire/storyboards/${sb1}/frames/2/redraw`, {}, B);
  assert.equal(r.status, 403);
  r = await call("POST", `/api/inspire/posts/${postId}/storyboards`, {}, B);
  assert.equal(r.status, 403);
  r = await call("DELETE", `/api/inspire/storyboards/${sb1}`, null, B);
  assert.equal(r.status, 403);
  ok("other guest: view yes, redraw/create/delete 403");

  // redraw
  r = await call("POST", `/api/inspire/storyboards/${sb1}/frames/2/redraw`, {}, A);
  assert.equal(r.status, 202, JSON.stringify(r.data)); assert.equal(r.data.left.frame_per_user, 14);
  const r2 = await call("POST", `/api/inspire/storyboards/${sb1}/frames/2/redraw`, {}, A);
  assert.equal(r2.status, 409, "same frame twice -> busy");
  w = await waitSb(sb1, A);
  const f1b = w.s.frames[1];
  assert.equal(f1b.rev, 1); assert.notEqual(f1b.path, f1.path); assert.equal(w.s.status, "done");
  assert.equal((await fetch(BASE + f1.path)).status, 404, "old rev deleted from R2");
  assert.equal(w.s.ops[0].status, "done");
  ok("redraw: rev 0 -> 1, new key, old object deleted, double click -> 409");

  // rewrite
  r = await call("POST", `/api/inspire/storyboards/${sb1}/scenes/3/rewrite`, { note: "x" }, A);
  assert.equal(r.status, 400); assert.equal(r.data.error, "bad_note");
  r = await call("POST", `/api/inspire/storyboards/${sb1}/scenes/3/rewrite`, { note: "Fil daha küçük görünsün, kamera yerden baksın" }, A);
  assert.equal(r.status, 202, JSON.stringify(r.data));
  w = await waitSb(sb1, A);
  assert.match(w.s.draft.scenes[2].title, /yeniden yazıldı/); assert.equal(w.s.frames[2].rev, 1);
  assert.doesNotMatch(w.s.draft.scenes[1].title, /yeniden yazıldı/, "other scenes untouched");
  r = await call("POST", `/api/inspire/storyboards/${sb1}/frames/99/redraw`, {}, A);
  assert.equal(r.status, 400);
  ok("rewrite: scene 3 text replaced atomically, frame 3 redrawn; bad note / bad frame -> 400");

  // corrections -> version 2, version 1 removed when v2 is done
  r = await call("POST", `/api/inspire/posts/${postId}/storyboards`, { corrections: "STM = Sayın Ticaret Merkezi (dükkânlardan oluşan proje)" }, A);
  assert.equal(r.status, 202, JSON.stringify(r.data)); assert.equal(r.data.storyboard.version, 2); assert.equal(r.data.left.per_user, 1);
  const sb2 = r.data.storyboard.id;
  w = await waitSb(sb2, A);
  assert.equal(w.s.status, "done"); assert.equal(w.s.input.corrections.includes("Sayın Ticaret Merkezi"), true); assert.equal(w.s.input.format, "9:16");
  await sleep(800);
  r = await call("GET", `/api/inspire/storyboards/${sb1}`, null, A);
  assert.equal(r.status, 404, "v1 cleaned up");
  assert.equal((await fetch(BASE + f1b.path)).status, 404, "v1 objects deleted");
  ok("Yorumu düzelt: v2 inherits brand/format, adds corrections; v1 rows + R2 removed");

  // per-user limit (3/day): A has used 2
  r = await textPost(A, "Kedi kahve dükkanının önünde bekliyor, sabah ilk müşteri o.", { format: "auto" });
  assert.equal(r.status, 201); assert.ok(r.data.storyboard);
  const sb3 = r.data.storyboard.id;
  r = await textPost(A, "Eski koltuk evden kaçıyor, sezon sonu indirimi.", { format: "auto" });
  assert.equal(r.status, 201); assert.equal(r.data.storyboard, null); assert.equal(r.data.storyboard_error.error, "sb_user_limit");
  ok("per-user limit: 4th storyboard -> post saved, storyboard_error sb_user_limit");
  await waitSb(sb3, A);

  // admin: exempt from per-user, sees debug + usage
  const ADM = await admin();
  r = await call("GET", "/api/inspire/config", null, ADM);
  assert.equal(r.data.sb.left.per_user, null);
  r = await call("POST", `/api/inspire/posts/${postId}/storyboards`, {}, ADM);
  assert.equal(r.status, 202, "admin may start on someone else's idea");
  const sb4 = r.data.storyboard.id;
  w = await waitSb(sb4, ADM);
  r = await call("GET", `/api/inspire/storyboards/${sb4}?debug=1`, null, ADM);
  assert.ok(r.data.debug && r.data.debug.plan && r.data.draft.scenes[0].image_prompt_en);
  r = await call("GET", "/api/inspire/sb-admin/usage", null, ADM);
  assert.equal(r.status, 200); assert.ok(r.data.quota.find((q) => q.scope === "sb").n >= 4);
  r = await call("GET", "/api/inspire/sb-admin/usage", null, A);
  assert.equal(r.status, 403);
  ok("admin: per-user exempt, debug view, usage endpoint (403 for guests)");

  // delete post cascades
  const keys = (await call("GET", `/api/inspire/storyboards/${sb4}`, null, ADM)).data.frames.map((f) => f.path);
  r = await call("DELETE", `/api/inspire/posts/${postId}`, null, A);
  assert.equal(r.status, 200);
  await sleep(1500);
  assert.equal((await call("GET", `/api/inspire/storyboards/${sb4}`)).status, 404);
  for (const k of keys) assert.equal((await fetch(BASE + k)).status, 404);
  ok("post delete: storyboard rows + R2 objects removed");

  r = await fetch(BASE + "/cdn-cgi/local/scheduled"); assert.equal(r.status, 200);
  ok("cron handler runs");
}

if (MODE === "fail_frame") {   // wrangler dev ... --var SB_FAKE_FAIL:frame_2
  const A = await guest("Ceren");
  let r = await textPost(A, IDEA, { format: "16:9" });
  const sb = r.data.storyboard.id;
  let w = await waitSb(sb, A);
  assert.equal(w.s.status, "partial"); assert.equal(w.s.error.code, "frames_failed");
  assert.equal(w.s.frames[1].status, "failed"); assert.equal(w.s.frame_done, w.s.frame_total - 1);
  r = await call("POST", `/api/inspire/storyboards/${sb}/resume`, {}, A);
  assert.equal(r.status, 202, JSON.stringify(r.data)); assert.equal(r.data.left.frame_per_user, 14);
  w = await waitSb(sb, A);
  assert.equal(w.s.ops[0].status, "failed"); assert.equal(w.s.status, "partial");
  r = await call("GET", "/api/inspire/config", null, A);
  assert.equal(r.data.sb.left.frame_per_user, 15, "per-user frame unit refunded after a failed op");
  r = await call("POST", `/api/inspire/storyboards/${sb}/frames/1/redraw`, {}, A);
  assert.equal(r.status, 202);
  w = await waitSb(sb, A);
  assert.equal(w.s.frames[0].rev, 1); assert.equal(w.s.status, "partial");
  ok("frame failure: partial + frames_failed; resume op fails -> refund; other frames still redraw");
}

if (MODE === "fail_draft") {   // --var SB_FAKE_FAIL:draft_invalid
  const A = await guest("Deniz");
  let r = await textPost(A, IDEA, { format: "auto" });
  const sb = r.data.storyboard.id;
  assert.equal(r.data.sb_left.per_user, 2);
  const w = await waitSb(sb, A);
  assert.equal(w.s.status, "failed"); assert.equal(w.s.error.code, "draft_failed"); assert.equal(w.s.draft, null);
  r = await call("GET", "/api/inspire/config", null, A);
  assert.equal(r.data.sb.left.per_user, 3, "per-user storyboard refunded when nothing was produced");
  r = await call("POST", `/api/inspire/storyboards/${sb}/resume`, {}, A);
  assert.equal(r.status, 400); assert.equal(r.data.error, "no_draft");
  ok("draft failure (gemma + repair + gpt-oss fallback): failed, per-user refund, resume -> 400 no_draft");
}

if (MODE === "fail_quota") {   // --var SB_FAKE_FAIL:img_quota
  const A = await guest("Ece");
  const r = await textPost(A, IDEA, { format: "auto" });
  const w = await waitSb(r.data.storyboard.id, A);
  assert.equal(w.s.status, "partial"); assert.equal(w.s.error.code, "quota"); assert.ok(w.s.draft);
  assert.ok(w.s.frames.every((f) => f.status === "failed" && f.error === "quota"));
  ok("image quota: text kept, every frame failed with quota, status partial");
}

if (MODE === "global_limit") {   // --var SB_DAILY_LIMIT:2
  const ids = [];
  for (let i = 0; i < 3; i++) {
    const G = await guest("G" + i);
    const r = await textPost(G, `Fikir ${i}: Martı vapurdan simit kapıyor.`, { format: "auto" });
    assert.equal(r.status, 201);
    ids.push(r.data.storyboard ? "ok" : r.data.storyboard_error.error);
  }
  assert.deepEqual(ids, ["ok", "ok", "sb_daily_limit"]);
  ok("global daily limit across different guests");
}
if (MODE === "kpss" || MODE === "kpss_nopw") {   // run-mode.sh seeds kpss-seed.sql first (TEST values)
  const OLD = "old-leaked-admin-pass-TEST";       // a stale ADMIN_PASSWORD copy stored in the owner's row before the fix
  const login = (username, password) => call("POST", "/api/kpss/login", { username, password });
  const del = (token, password) => call("DELETE", "/api/kpss/user", { password }, token);
  if (MODE === "kpss_nopw") {                      // --var ADMIN_PASSWORD: (empty) -> the owner can never log in
    assert.equal((await login("vkesgin38", OLD)).status, 401, "stored copy rejected without ADMIN_PASSWORD");
    assert.equal((await login("vkesgin38", "anything")).status, 401);
    assert.equal((await login("vkesgin38", devVars.ADMIN_PASSWORD)).status, 401, "run with --var ADMIN_PASSWORD: (empty)");
    assert.equal((await login("kpss_user1", "kpss-user-test-pw")).status, 200, "normal user unaffected");
    ok("KPSS: ADMIN_PASSWORD unset -> owner login 401 (stored copy too); normal user logs in");
  } else {
    let r = await login("vkesgin38", OLD);
    assert.equal(r.status, 401, "stale stored owner password must not log in");
    assert.equal((await login("vkesgin38", devVars.ADMIN_PASSWORD + "x")).status, 401);
    r = await login("vkesgin38", devVars.ADMIN_PASSWORD);
    assert.equal(r.status, 200, "owner logs in with the current ADMIN_PASSWORD"); assert.equal(r.data.user.username, "vkesgin38");
    const ownerId = r.data.user.id, ownerTok = r.data.token;
    assert.equal((await login("vkesgin38", OLD)).status, 401, "still rejected after the owner logged in");
    ok("KPSS owner: current ADMIN_PASSWORD 200; stale stored copy / wrong password 401");
    r = await login("kpss_user1", "kpss-user-test-pw");
    assert.equal(r.status, 200, "normal KPSS user"); assert.equal(r.data.user.username, "kpss_user1");
    const userTok = r.data.token;
    assert.equal((await login("kpss_user1", "wrong")).status, 401);
    assert.equal((await login("admin", "")).status, 401, "legacy admin row (empty password) cannot log in");
    assert.equal((await call("GET", "/api/kpss/note", null, userTok)).status, 200, "user token works");
    ok("KPSS normal user: own password 200, wrong 401 (unchanged)");
    assert.equal((await del(userTok, "wrong")).status, 401, "user delete still needs the user's own password");
    assert.equal((await del(ownerTok, OLD)).status, 401, "owner delete: stale copy rejected");
    assert.equal((await del(ownerTok, devVars.ADMIN_PASSWORD)).status, 200, "owner delete with ADMIN_PASSWORD");
    r = await login("vkesgin38", devVars.ADMIN_PASSWORD);
    assert.equal(r.status, 200); assert.notEqual(r.data.user.id, ownerId); assert.equal(r.data.user.full_name, "Veli Kesgin");
    assert.equal((await login("vkesgin38", OLD)).status, 401);
    assert.equal((await login("admin", "x")).status, 401, "legacy admin row was taken over");
    ok("KPSS owner delete needs ADMIN_PASSWORD; next owner login takes over the legacy 'admin' row (unusable password)");
  }
}
console.log(`all ${n} checks passed (${MODE})`);
