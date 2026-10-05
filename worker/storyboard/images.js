// images.js: FLUX.2 klein 4B prompt builders, reference selection, multipart call, base64 handling (no Node APIs).
// Input: a v6 draft after lintDraft() (image fields already brand-stripped).
import { stripStyleSentences, mentions } from "./postprocess.js";

export const IMG_MODEL = "@cf/black-forest-labs/flux-2-klein-4b";
// Style C from the image prototype (cleanest storyboard look on klein-4b). Goes FIRST in every prompt.
export const IMG_STYLE = "film storyboard panel, quick rough pencil drawing, simple loose outlines, light gray shading, plain white background, monochrome, unfinished sketch, no text, no letters.";
// Goes LAST in every prompt: after this tail 14/14 images stayed grayscale and plate-referenced frames had blank signs.
export const IMG_TAIL = "Blank signs and blank shop fascias, no readable text, no letters, no numbers, no logos, no signature, no caption. Black-and-white graphite pencil sketch on white paper, not a photo, not a 3D render, no color.";
// Deterministic framing phrase per shot enum (klein follows explicit framing better than the shot name alone).
export const SHOT_HINT = {
  extreme_wide: "Extreme wide shot: the subject is small inside a vast view of the place",
  wide: "Wide shot: the whole subject plus plenty of surroundings, generous space on both sides",
  full: "Full shot: the subject's whole body fills the frame height, little surroundings",
  medium: "Medium shot: the camera is close, the subject is cropped by the frame edges and fills most of the picture",
  close_up: "Close-up: one part of the subject fills the frame",
  extreme_close_up: "Extreme close-up: one small detail fills the entire frame",
  aerial_drone: "Aerial bird's-eye view from high above, camera looking steeply down onto the rooftops and the street, NOT eye level",
  pov: "Point-of-view shot at eye level, as if seen through a passer-by's eyes",
  over_the_shoulder: "Over-the-shoulder shot from just behind a generic passer-by",
  insert: "Insert shot: a single object or detail fills the frame",
};
// Frame / reference sizes per aspect ratio (multiples of 16; references stay <= 512 on each side).
export const SIZES = {
  "16:9": { frame: [912, 512], ref: [480, 272] },
  "9:16": { frame: [512, 912], ref: [272, 480] },
  "1:1": { frame: [512, 512], ref: [384, 384] },
  "4:5": { frame: [512, 640], ref: [384, 480] },
};
export const TILE_OUT = 26.05, TILE_IN = 5.37; // neurons per 512x512 tile (klein-4b price list)
export const tiles = (w, h) => Math.ceil(w / 512) * Math.ceil(h / 512);
export const estNeurons = (w, h, refs) => +(tiles(w, h) * TILE_OUT + refs.reduce((s, r) => s + tiles(r[0], r[1]) * TILE_IN, 0)).toFixed(2);

const AERIAL_RE = /bird'?s[- ]eye|top[- ]down|overhead view|looking (steeply )?down/i;
export const isAerial = (sc) => sc.shot === "aerial_drone" || AERIAL_RE.test(sc.image_prompt_en || "");
const looks = (chars) => chars.map((c) => `${c.name}: ${String(c.look).trim().replace(/[.\s]+$/, "")}.`).join(" ");
const joinAnd = (xs) => (xs.length < 2 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`);
const squash = (s) => s.replace(/\s{2,}/g, " ").replace(/\s+\./g, ".").trim();

// "Use THE ELEPHANT exactly as drawn in image 1 and the place exactly as drawn in image 2, in the same pencil style; compose a new camera shot."
export function refInstruction(refs) {
  if (!refs.length) return "";
  const parts = refs.map((r, i) => (r.kind === "char" ? `${r.name} exactly as drawn in image ${i + 1}` : `the place exactly as drawn in image ${i + 1}`));
  return `Use ${joinAnd(parts)}, in the same pencil style; compose a new camera shot.`;
}

// Pure planning: every prompt, size, seed and reference id. Nothing is called here.
// opts.maxCharSheets: 1 = measured setup (main character only); 2+ is untested.
// opts.aerialPlate: extra empty top-down plate for aerial frames (+31.42 neurons, untested; fixes sign lettering seen without a plate).
export function planImages(d, { seed = 4242, maxCharSheets = 1, aerialPlate = false } = {}) {
  const sz = SIZES[d.aspect_ratio] || SIZES["16:9"];
  const [fw, fh] = sz.frame, [rw, rh] = sz.ref;
  const location = stripStyleSentences(d.location_en) || d.location_en;
  const chars = d.characters_en || [];
  const sceneCount = (c) => d.scenes.filter((s) => (s.characters || []).includes(c.name)).length;
  const sheetChars = chars.filter((c) => sceneCount(c) > 0).sort((a, b) => sceneCount(b) - sceneCount(a)).slice(0, maxCharSheets);
  const inAnchor = chars.filter((c) => mentions(d.anchor_prompt_en, c.name, true));

  const jobs = [];
  jobs.push({ id: "anchor", stage: "anchor", width: rw, height: rh, seed, refs: [],
    prompt: squash(`${IMG_STYLE} ${location} ${looks(chars)} ${d.anchor_prompt_en} ${IMG_TAIL}`) });

  for (const c of sheetChars) {
    const fromAnchor = inAnchor.includes(c);
    jobs.push({ id: `ref_char_${c.name.replace(/^THE /, "").replace(/\W+/g, "_").toLowerCase()}`, stage: "refs", kind: "char", name: c.name,
      width: rw, height: rh, seed, refs: ["anchor"],
      prompt: squash(fromAnchor
        ? `${IMG_STYLE} Character reference sheet: ${c.name} exactly as drawn in image 1. ${looks([c])} Drawn alone in full side view facing right, whole body visible, isolated on plain white paper, no background, no floor, no people, no buildings. ${IMG_TAIL}`
        : `${IMG_STYLE} Character reference sheet in the same pencil style as image 1: ${looks([c])} Drawn alone in full side view facing right, whole body visible, isolated on plain white paper, no background, no floor, no people, no buildings. ${IMG_TAIL}`) });
  }
  const removeList = inAnchor.map((c) => c.name);
  const empty = `${removeList.length ? `remove ${joinAnd(removeList)}, ` : ""}no animals, only a few tiny generic passers-by in the distance.`;
  jobs.push({ id: "ref_loc", stage: "refs", kind: "loc", width: rw, height: rh, seed, refs: ["anchor"],
    prompt: squash(`${IMG_STYLE} The same place as image 1, same architecture, same pencil style, but completely empty: ${empty} ${location} Wide eye-level view. ${IMG_TAIL}`) });
  const needAerial = aerialPlate && d.scenes.some(isAerial);
  if (needAerial) jobs.push({ id: "ref_loc_aerial", stage: "refs", kind: "loc", width: rw, height: rh, seed, refs: ["anchor"],
    prompt: squash(`${IMG_STYLE} The same place as image 1 seen from high above: aerial bird's-eye view looking steeply down onto the rooftops and the street, same architecture, same pencil style, completely empty: ${empty} ${location} ${IMG_TAIL}`) });

  const sheetJobs = jobs.filter((j) => j.kind === "char").map((j) => ({ id: j.id, name: j.name }));
  for (const sc of d.scenes) {
    jobs.push(frameJob(d, sc, { location, sheetJobs, eyePlate: "ref_loc", aerialPlate: needAerial ? "ref_loc_aerial" : null, size: [fw, fh], seed }));
  }
  const byId = Object.fromEntries(jobs.map((j) => [j.id, j]));
  for (const j of jobs) j.neurons_est = estNeurons(j.width, j.height, j.refs.map((id) => [byId[id].width, byId[id].height]));
  return { seed, size: { frame: [fw, fh], ref: [rw, rh] }, jobs, neurons_est: +jobs.reduce((s, j) => s + j.neurons_est, 0).toFixed(2) };
}

// One frame job. sheetJobs: [{id, name}] character sheets that exist; eyePlate/aerialPlate: ref job ids or null.
// Reference rules (measured): character sheet(s) for characters in the frame + the eye-level location plate.
// Aerial/top-down frames: NO eye-level plate (klein copies the plate's camera angle) -> character sheet only,
// or the aerial plate when it exists. Frames without characters (end card): location plate only.
export function frameJob(d, sc, { location, sheetJobs, eyePlate, aerialPlate, size, seed }) {
  const chars = d.characters_en || [];
  const present = chars.filter((c) => (sc.characters || []).includes(c.name));
  const aerial = isAerial(sc);
  const refs = [
    ...present.map((c) => sheetJobs.find((j) => j.name === c.name)).filter(Boolean).map((j) => ({ kind: "char", name: j.name, id: j.id })),
    ...(!aerial ? (eyePlate ? [{ kind: "loc", id: eyePlate }] : []) : aerialPlate ? [{ kind: "loc", id: aerialPlate }] : []),
  ].slice(0, 4);
  const setting = `${location}${present.length ? " " + looks(present) : ""}`;
  return { id: `frame_${sc.n}`, stage: "frames", n: sc.n, width: size[0], height: size[1], seed, refs: refs.map((r) => r.id),
    prompt: squash(`${IMG_STYLE} ${SHOT_HINT[sc.shot] || ""}. ${refInstruction(refs)} ${sc.image_prompt_en} Setting: ${setting} ${IMG_TAIL}`) };
}

// Re-plans one frame against the reference images that actually exist (doneIds: Set of job ids with an image).
// Used for every frame of a build (after the reference stage) and for redraw/rewrite/resume. With all references
// present it returns exactly the frame job planImages() made; a missing reference is simply left out.
export function planFrameForOp(d, n, plan, doneIds, seed) {
  const location = stripStyleSentences(d.location_en) || d.location_en;
  const refsDone = plan.jobs.filter((j) => j.stage === "refs" && doneIds.has(j.id));
  const sheetJobs = refsDone.filter((j) => j.kind === "char").map((j) => ({ id: j.id, name: j.name }));
  const has = (id) => refsDone.some((j) => j.id === id);
  const sc = d.scenes[n - 1];
  const job = frameJob(d, sc, { location, sheetJobs, eyePlate: has("ref_loc") ? "ref_loc" : null,
    aerialPlate: has("ref_loc_aerial") ? "ref_loc_aerial" : null, size: plan.size.frame, seed });
  job.neurons_est = estNeurons(job.width, job.height, job.refs.map(() => plan.size.ref));
  return job;
}

// ------------------------------------------------------------------ klein call + base64
export function b64ToBytes(s) { const bin = atob(s); const o = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) o[i] = bin.charCodeAt(i); return o; }
export function bytesToB64(b) { let s = ""; for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode.apply(null, b.subarray(i, i + 0x8000)); return btoa(s); }

// FLUX.2 takes multipart only. Fields are strings; references are input_image_0..3 (<= 512x512 each). No `steps` (fixed 4).
// Returns the base64 JPEG string exactly as the model sent it (decode only when the image is needed as a reference).
export async function kleinRun(ai, { prompt, width, height, seed, refs = [] }) {
  const form = new FormData();
  form.append("prompt", prompt);
  form.append("width", String(width));
  form.append("height", String(height));
  form.append("seed", String(seed));
  refs.slice(0, 4).forEach((bytes, i) => form.append(`input_image_${i}`, new Blob([bytes], { type: "image/jpeg" }), `ref${i}.jpeg`));
  const fr = new Response(form); // serialises the form and creates the multipart boundary
  const r = await ai.run(IMG_MODEL, { multipart: { body: fr.body, contentType: fr.headers.get("content-type") } });
  if (!r || typeof r.image !== "string") throw new Error("unexpected klein result: " + JSON.stringify(Object.keys(r || {})));
  return r.image;
}

// 90 s timeout + one retry (same seed). A timed-out call may still be billed, so it is counted.
export async function kleinWithRetry(ai, job, refBytes, log, { timeoutMs = 90000, quotaRe = /quota|neuron|daily|limit exceeded|exceeded|3036|4006|429|5035/i } = {}) {
  let lastErr;
  for (let attempt = 1; attempt <= 2; attempt++) {
    const t0 = Date.now();
    let timer;
    try {
      const b64 = await Promise.race([
        kleinRun(ai, { ...job, refs: refBytes }),
        new Promise((_, rej) => { timer = setTimeout(() => rej(new Error(`timeout ${timeoutMs}ms`)), timeoutMs); }),
      ]);
      log.push({ step: job.id, model: IMG_MODEL, ms: Date.now() - t0, size: `${job.width}x${job.height}`, refs: job.refs, seed: job.seed, neurons_est: job.neurons_est, attempt, b64_len: b64.length });
      return b64;
    } catch (e) {
      lastErr = String((e && e.message) || e);
      log.push({ step: job.id, model: IMG_MODEL, ms: Date.now() - t0, error: lastErr, attempt, neurons_est: /timeout/.test(lastErr) ? job.neurons_est : 0 });
      if (quotaRe.test(lastErr)) throw Object.assign(new Error("QUOTA: " + lastErr), { quota: true });
    } finally { clearTimeout(timer); }
  }
  throw new Error(`${job.id} failed twice: ${lastErr}`);
}

async function pool(items, n, fn) {
  const out = new Array(items.length); let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => { while (i < items.length) { const k = i++; out[k] = await fn(items[k], k); } }));
  return out;
}

// Runs a plan: anchor -> references (parallel) -> frames (3 at a time). onImage(id, b64) lets a Workflow/DO persist
// each image as it arrives. Only anchor/reference images are decoded (they are sent back as references).
export async function renderPlan(ai, plan, { concurrency = 3, timeoutMs = 90000, onImage = async () => {} } = {}, log = []) {
  const b64 = {}, bytes = {};
  const run = async (job) => {
    const refBytes = job.refs.map((id) => bytes[id] || (bytes[id] = b64ToBytes(b64[id])));
    b64[job.id] = await kleinWithRetry(ai, job, refBytes, log, { timeoutMs });
    await onImage(job.id, b64[job.id], job);
  };
  const st = (s) => plan.jobs.filter((j) => j.stage === s);
  for (const j of st("anchor")) await run(j);
  await Promise.all(st("refs").map(run));
  await pool(st("frames"), concurrency, run);
  return { images: b64, log };
}

// Browser-side safety net (canvas, 64x36 downscale): mean |R-G|+|G-B|. Measured on the prototype JPEGs with this exact metric:
// 40 grayscale images 0.5-1.5, the one colour-drift end card 20.0 -> regenerate (seed+1) or desaturate when > 5.
export function colorSpread(imgEl) {
  const c = document.createElement("canvas"); const w = (c.width = 64), h = (c.height = 36);
  const g = c.getContext("2d"); g.drawImage(imgEl, 0, 0, w, h);
  const p = g.getImageData(0, 0, w, h).data; let s = 0;
  for (let i = 0; i < p.length; i += 4) s += Math.abs(p[i] - p[i + 1]) + Math.abs(p[i + 1] - p[i + 2]);
  return s / (w * h);
}
