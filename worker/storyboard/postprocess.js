// postprocess.js: deterministic parse / coerce / validate / lint for the storyboard draft (no model call, no Node APIs).
import { STORYBOARD_SCHEMA_V6, validate, SHOTS, MOVES, ASPECTS, CONFIDENCE } from "./schema.v6.js";
import { trLower, trUpper, fold, escapeRe, extractEntities, cleanName } from "./research.js";
import { defaultNameTr, normNameTr, isProperTr, capFirst, attachSuffix } from "./trtext.js";
import { SYSTEM_PROMPT_V6, buildUserMessageV6, TEXT_MODEL, TEXT_PARAMS, TEXT_RATES, SCENE_SYSTEM_V6, SCENE_PARAMS, buildSceneMessageV6 } from "./prompt.v6.js";

// Pipeline-owned style sentence (the text model must not own the drawing style).
export const TEXT_STYLE = "Rough grayscale graphite pencil storyboard sketch, loose confident lines, light hatching for shadows, plain white paper, no color, no text, no logos.";
// Raw Workers AI error text that means the DAILY neuron allocation is used up (4006 / 3036 "...daily free allocation of
// 10,000 neurons..."). Deliberately narrow: transient capacity / rate-limit errors ("3040: Capacity temporarily exceeded",
// HTTP 429) are not quota; they fall through to the repair call and the gpt-oss fallback. Shared with the image path
// (workflow.js), so text and images classify the same way.
export const QUOTA_RE = /4006|3036|neurons|daily free allocation|quota/i;

// ------------------------------------------------------------------ 1. parse (fence strip, then {…} slice)
export function tryParse(text) {
  if (text == null) return { err: "no text" };
  if (typeof text === "object") return { obj: text, note: "already parsed" }; // llama json_schema route returns objects
  const t = String(text).trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "").trim();
  try { return { obj: JSON.parse(t) }; } catch (e1) {
    const a = t.indexOf("{"), b = t.lastIndexOf("}");
    if (a >= 0 && b > a) { try { return { obj: JSON.parse(t.slice(a, b + 1)), note: "sliced" }; } catch (e2) { return { err: e2.message }; } }
    return { err: e1.message };
  }
}

// ------------------------------------------------------------------ 2. enum near-miss map (no repair call needed)
export function coerceShot(v) {
  const x = String(v || "").toLowerCase().replace(/[\s-]+/g, "_");
  if (SHOTS.includes(x)) return x;
  if (/extreme/.test(x) && /close/.test(x)) return "extreme_close_up";
  if (/aerial|drone|top_down|bird/.test(x)) return "aerial_drone";
  if (/shoulder|ots/.test(x)) return "over_the_shoulder";
  if (/pov|point_of_view/.test(x)) return "pov";
  if (/insert|detail/.test(x)) return "insert";
  if (/close/.test(x)) return "close_up";
  if (/extreme|establish/.test(x)) return "extreme_wide";
  if (/wide|long/.test(x)) return "wide";
  if (/full/.test(x)) return "full";
  return "medium"; // e.g. "low_angle", "medium_wide"
}
export function coerceMove(v) {
  const x = String(v || "").toLowerCase().replace(/[\s-]+/g, "_");
  if (MOVES.includes(x)) return x;
  if (/pan/.test(x)) return "pan";
  if (/tilt/.test(x)) return "tilt"; // "tilt_up"
  if (/zoom/.test(x)) return /out/.test(x) ? "zoom_out" : "zoom_in";
  if (/crane|jib|boom|pedestal/.test(x)) return /down/.test(x) ? "crane_down" : "crane_up";
  if (/drone|fly/.test(x)) return "drone_flyover";
  if (/orbit|arc/.test(x)) return "orbit";
  if (/hand/.test(x)) return "handheld";
  if (/track|follow|truck|steadicam/.test(x)) return "tracking";
  if (/pull|dolly_out|back/.test(x)) return "dolly_out";
  if (/push|dolly/.test(x)) return "dolly_in";
  return "static"; // e.g. "low_angle"
}
export function coerceAspect(v) {
  const x = String(v || "").toLowerCase().replace(/\s+/g, "");
  if (ASPECTS.includes(x)) return x;
  if (/9[:x/×]16|vertical|dikey|portrait|reels|story|tiktok|shorts/.test(x)) return "9:16";
  if (/4[:x/×]5/.test(x)) return "4:5";
  if (/1[:x/×]1|square|kare/.test(x)) return "1:1";
  return "16:9";
}
export function coerceConfidence(v) {
  const x = fold(v).trim();
  if (CONFIDENCE.includes(x)) return x;
  if (/yuksek|high|kesin/.test(x)) return "high";
  if (/dusuk|low|zayif/.test(x)) return "low";
  return "medium";
}

// ------------------------------------------------------------------ character names
export function normCharName(v) {
  let s = String(v ?? "").normalize("NFC").replace(/['’]s\b/gi, "").replace(/[:.,;()"]+/g, " ").trim().replace(/\s+/g, " ").toUpperCase();
  if (!s) return "";
  if (!/^THE\s/.test(s)) s = "THE " + s.replace(/^(?:A|AN)\s+/, "");
  return s.slice(0, 40).trim();
}
const nounOf = (name) => name.replace(/^THE\s+/, "");
// strict: canonical CAPS name ("THE ELEPHANT", "THE ELEPHANT's"); loose: also "the elephant", "an elephant"
export function mentions(text, name, loose = false) {
  if (!loose) return new RegExp(`(?<![A-Za-z])${escapeRe(name).replace(/\s+/g, "\\s+")}(?![A-Za-z])`).test(String(text || ""));
  return new RegExp(`(?<![A-Za-z])${escapeRe(nounOf(name)).replace(/\s+/g, "\\s+")}(?:e?s)?(?![A-Za-z])`, "i").test(String(text || ""));
}
// trNames: { "THE COMMUTER": "yolcu" } - a scene may list the Turkish display name instead of the canonical one.
function resolveName(raw, known, trNames = {}) {
  const byTr = Object.keys(trNames).find((k) => fold(trNames[k]) === fold(String(raw ?? "").trim()));
  if (byTr) return byTr;
  const n = normCharName(raw);
  if (!n) return null;
  if (known.includes(n)) return n;
  return known.find((k) => nounOf(k).endsWith(" " + nounOf(n)) || nounOf(n).endsWith(" " + nounOf(k)) || nounOf(k) === nounOf(n)) || null;
}

// ------------------------------------------------------------------ v5 salvage (model returned style_bible_en prose)
const STYLE_WORDS_RE = /\b(sketch|pencil|graphite|drawing|grayscale|greyscale|monochrome|hatching|storyboard)\b/i;
const NOT_CHAR = /^THE (LOCATION|SETTING|PLACE|STREET|SCENE|COMPLEX|AREA|CITY|CHARACTER|MAIN CHARACTER)$/;
export const splitSentences = (s) => (String(s || "").match(/[^.!?]+(?:[.!?]+|$)/g) || []).map((x) => x.trim()).filter(Boolean);
export function salvageV5(obj) {
  const fixes = [];
  if (typeof obj.style_bible_en !== "string") { delete obj.style_bible_en; return fixes; }
  const sents = splitSentences(obj.style_bible_en).filter((s) => !(STYLE_WORDS_RE.test(s) && !/LOCATION|THE [A-Z]{3,}/.test(s)));
  const chars = [], loc = [];
  for (const s of sents) {
    const names = [...s.matchAll(/(LOCATION[^A-Z]{0,4})?\b(THE(?: [A-Z][A-Z'-]+){1,3})\b/g)]
      .filter((m) => !m[1] && !NOT_CHAR.test(m[2])).map((m) => m[2]);
    if (!names.length) { loc.push(s); continue; }
    const name = names[0];
    const look = (s.split(new RegExp(`${escapeRe(name)}\\s*(?::|\\bis\\b|\\bare\\b|,)\\s*`))[1] || s.replace(name, "")).replace(/^(?:CHARACTER:\s*)/, "").trim();
    if (!chars.some((c) => c.name === name)) chars.push({ name, look: look.replace(/\.$/, "") });
  }
  if (obj.location_en == null) { obj.location_en = loc.join(" ").replace(/^LOCATION:\s*/, ""); fixes.push("v5 salvage: location_en from style_bible_en"); }
  if (obj.characters_en == null) { obj.characters_en = chars; fixes.push(`v5 salvage: characters_en [${chars.map((c) => c.name).join(", ")}]`); }
  delete obj.style_bible_en;
  return fixes;
}

// ------------------------------------------------------------------ 3. coerce everything that code can fix
export function coerceDraft(obj, { context = "" } = {}) {
  const fixes = [];
  if (!obj || typeof obj !== "object" || Array.isArray(obj)) return fixes;
  if ("style_bible_en" in obj) fixes.push(...salvageV5(obj));
  for (const k of Object.keys(obj)) if (!STORYBOARD_SCHEMA_V6.properties[k]) { delete obj[k]; fixes.push(`dropped unexpected key ${k}`); }

  if (obj.aspect_ratio != null && !ASPECTS.includes(obj.aspect_ratio)) { const c = coerceAspect(obj.aspect_ratio); fixes.push(`aspect_ratio ${obj.aspect_ratio}->${c}`); obj.aspect_ratio = c; }
  if (/dikey|reels|story|stories|tiktok|shorts|9:16/i.test(String(context)) && obj.aspect_ratio !== "9:16") { fixes.push(`aspect_ratio ${obj.aspect_ratio}->9:16 (context says vertical)`); obj.aspect_ratio = "9:16"; }
  if (typeof obj.assumptions === "string") { obj.assumptions = [obj.assumptions]; fixes.push("assumptions str->[str]"); }
  if (Array.isArray(obj.assumptions) && obj.assumptions.length > 6) { obj.assumptions = obj.assumptions.slice(0, 6); fixes.push("assumptions cut to 6"); }
  // zero readings are valid (an idea without brand, place or acronym); a missing key or a junk item never costs a repair call
  if (obj.interpretations == null) { obj.interpretations = []; fixes.push("interpretations missing -> []"); }
  if (obj.interpretations && !Array.isArray(obj.interpretations)) { obj.interpretations = [obj.interpretations]; fixes.push("interpretations obj->[obj]"); }
  if (Array.isArray(obj.interpretations)) {
    const n0 = obj.interpretations.length;
    obj.interpretations = obj.interpretations.filter((it) => it && typeof it === "object" && typeof it.name === "string" && it.name.trim());
    if (obj.interpretations.length < n0) fixes.push(`interpretations: dropped ${n0 - obj.interpretations.length} item(s) without a name`);
    for (const it of obj.interpretations) if (typeof it.meaning !== "string") it.meaning = it.meaning == null ? "" : String(it.meaning);
    if (obj.interpretations.length > 6) { obj.interpretations = obj.interpretations.slice(0, 6); fixes.push("interpretations cut to 6"); }
  }
  if (obj.assumptions == null) { obj.assumptions = []; fixes.push("assumptions missing -> []"); }
  for (const it of obj.interpretations || []) if (it && it.confidence != null && !CONFIDENCE.includes(it.confidence)) { const c = coerceConfidence(it.confidence); fixes.push(`confidence ${it.confidence}->${c}`); it.confidence = c; }

  if (obj.characters_en == null) { obj.characters_en = []; fixes.push("characters_en missing -> []"); }
  if (Array.isArray(obj.characters_en)) {
    const seen = new Set();
    obj.characters_en = obj.characters_en.filter((c) => c && typeof c === "object" && c.name).map((c) => {
      const name = normCharName(c.name);
      if (name !== c.name) fixes.push(`character name ${c.name}->${name}`);
      const look = typeof c.look === "string" && c.look.trim() ? c.look.trim() : nounOf(name).toLowerCase();
      // name_tr: Turkish display name used in every Turkish field (older drafts have none -> derived from the English noun)
      const rawTr = c.name_tr ?? c.nameTr ?? c.tr_name ?? c.turkish_name ?? c.name_turkish ?? c.ad;
      const name_tr = normNameTr(rawTr, name, look);
      if (rawTr == null) fixes.push(`${name}.name_tr missing -> "${name_tr}"`);
      else if (name_tr !== rawTr) fixes.push(`${name}.name_tr "${rawTr}"->"${name_tr}"`);
      return { name, name_tr, look };
    }).filter((c) => !seen.has(c.name) && seen.add(c.name)).slice(0, 4);
    const used = new Set();   // two characters never share a Turkish name ("yolcu", "diğer yolcu")
    for (const c of obj.characters_en) {
      if (used.has(fold(c.name_tr))) { const t = `diğer ${trLower(c.name_tr)}`; fixes.push(`${c.name}.name_tr "${c.name_tr}"->"${t}" (duplicate)`); c.name_tr = t; }
      used.add(fold(c.name_tr));
    }
  }
  const known = (obj.characters_en || []).map((c) => c.name);
  const trNames = Object.fromEntries((obj.characters_en || []).map((c) => [c.name, c.name_tr]));

  if (Array.isArray(obj.scenes)) obj.scenes.forEach((sc, i) => {
    if (!sc || typeof sc !== "object") return;
    if (sc.shot != null && !SHOTS.includes(sc.shot)) { const c = coerceShot(sc.shot); fixes.push(`scenes[${i}].shot ${sc.shot}->${c}`); sc.shot = c; }
    if (sc.camera_move != null && !MOVES.includes(sc.camera_move)) { const c = coerceMove(sc.camera_move); fixes.push(`scenes[${i}].camera_move ${sc.camera_move}->${c}`); sc.camera_move = c; }
    if (typeof sc.duration_s === "string" && !isNaN(parseFloat(sc.duration_s))) { sc.duration_s = parseFloat(sc.duration_s); fixes.push(`scenes[${i}].duration_s str->num`); }
    if (sc.n !== i + 1) { fixes.push(`scenes[${i}].n ${sc.n}->${i + 1}`); sc.n = i + 1; }
    for (const k of ["onscreen_text", "vo"]) if (sc[k] == null) { sc[k] = ""; fixes.push(`scenes[${i}].${k} null->""`); }
    // per-scene characters: normalise, map to known names, add canonical names the prompt uses
    let list = sc.characters;
    if (typeof list === "string") list = list ? [list] : [];
    if (!Array.isArray(list)) {
      list = known.filter((k) => mentions(sc.image_prompt_en, k, true));
      fixes.push(`scenes[${i}].characters missing -> derived [${list.join(", ")}]`);
    }
    const out = [];
    for (const raw of list) {
      const r = resolveName(raw, known, trNames);
      if (r) { if (!out.includes(r)) out.push(r); if (r !== raw) fixes.push(`scenes[${i}].characters ${raw}->${r}`); }
      else fixes.push(`scenes[${i}].characters dropped unknown "${raw}"`);
    }
    for (const k of known) if (!out.includes(k) && mentions(sc.image_prompt_en, k)) { out.push(k); fixes.push(`scenes[${i}].characters +${k} (named in image_prompt_en)`); }
    sc.characters = out;
  });
  return fixes;
}

// ------------------------------------------------------------------ 4. style sentence ownership
// v5 drafts (style_bible_en from the model): force the pipeline sentence at the start.
export function ownStyleSentence(styleBible) {
  const s = String(styleBible || "");
  if (s.startsWith(TEXT_STYLE)) return { text: s, changed: false };
  return { text: TEXT_STYLE + " " + s.replace(/^[^.]*(sketch|pencil|drawing)[^.]*\.\s*/i, ""), changed: true };
}
// v6 drafts: the model never writes style; the bible is composed in code (kept for consumers that read style_bible_en).
export function composeStyleBible(d) {
  const chars = (d.characters_en || []).map((c) => `${c.name}: ${String(c.look).trim().replace(/[.\s]+$/, "")}.`).join(" ");
  return [TEXT_STYLE, stripStyleSentences(d.location_en), chars].filter(Boolean).join(" ").replace(/\s{2,}/g, " ").trim();
}
export function stripStyleSentences(s) {
  return splitSentences(s).filter((x) => !STYLE_WORDS_RE.test(x)).join(" ");
}

// ------------------------------------------------------------------ 5. acronym-expansion scrubber
const wordSpans = (T) => [...T.matchAll(/[\p{L}\p{N}]+(?:['’]\p{L}+)?/gu)].map((m) => ({
  w: m[0], base: m[0].replace(/['’]\p{L}+$/u, ""), suf: (m[0].match(/['’](\p{L}+)$/u) || [])[1] || "", s: m.index, e: m.index + m[0].length,
}));
const capW = (x) => /^\p{Lu}\p{L}+$/u.test(x.base);
// suffix of the removed last word re-attached to the acronym: "Merkezi'nde" -> "STM'de", "Merkezi'ne" -> "STM'ye"
const SUFFIX_MAP = { nde: "de", nda: "da", nden: "den", ndan: "dan", ne: "ye", na: "ya", ni: "yi", nı: "yı", nu: "yu", nü: "yü" };
const moveSuffix = (suf) => (suf ? "'" + (SUFFIX_MAP[suf] || suf) : "");

// allowedLower: trLower() of every text where an expansion may legitimately come from (FİKİR, BAĞLAM, brand-linked research expansions)
export function findInventedExpansions(text, acronyms, allowedLower = "") {
  const T = String(text || "");
  const W = wordSpans(T);
  const adj = (a, b) => /^[ \t]+$/.test(T.slice(a.e, b.s));
  const hits = [];
  for (const ac of acronyms) {
    const AC = trUpper(ac);
    for (let i = 0; i < W.length; i++) {
      // (a) "STM Ticaret Merkezi": acronym + 2-3 capitalised words whose initials are part of the acronym
      if (W[i].base === ac) {
        for (let k = 3; k >= 2; k--) {
          const ws = W.slice(i + 1, i + 1 + k);
          if (ws.length < k || !ws.every(capW) || !ws.every((x, j) => adj(j ? ws[j - 1] : W[i], x)) || ws.slice(0, -1).some((x) => x.suf)) continue;
          const ini = ws.map((x) => trUpper(x.base[0])).join("");
          const core = T.slice(W[i].s, ws[k - 1].s + ws[k - 1].base.length);
          if (AC.includes(ini) && !allowedLower.includes(trLower(core))) { hits.push({ ac, s: W[i].s, e: ws[k - 1].e, phrase: T.slice(W[i].s, ws[k - 1].e), repl: ac + moveSuffix(ws[k - 1].suf) }); break; }
        }
      }
      // (b) "Sayın Ticaret Merkezi": as many capitalised words as letters, initials spell the acronym
      const ws = W.slice(i, i + ac.length);
      if (ws.length === ac.length && ws[0].base !== ac && ws.every(capW) && ws.every((x, j) => !j || adj(ws[j - 1], x)) && !ws.slice(0, -1).some((x) => x.suf)) {
        const ini = ws.map((x) => trUpper(x.base[0])).join("");
        const core = T.slice(ws[0].s, ws[ws.length - 1].s + ws[ws.length - 1].base.length);
        if (ini === AC && !allowedLower.includes(trLower(core))) hits.push({ ac, s: ws[0].s, e: ws[ws.length - 1].e, phrase: T.slice(ws[0].s, ws[ws.length - 1].e), repl: ac + moveSuffix(ws[ws.length - 1].suf) });
      }
    }
  }
  // keep non-overlapping hits, earliest-longest first
  hits.sort((x, y) => x.s - y.s || y.e - x.e);
  const out = [];
  for (const h of hits) if (!out.length || h.s >= out[out.length - 1].e) out.push(h);
  return out;
}
export function scrubExpansions(text, acronyms, allowedLower = "") {
  let T = String(text || "");
  const hits = findInventedExpansions(T, acronyms, allowedLower);
  for (const h of hits.slice().reverse()) T = T.slice(0, h.s) + h.repl + T.slice(h.e);
  for (const ac of acronyms) { // "STM (STM)", "STM STM" left behind by the replacement
    const A = escapeRe(ac);
    T = T.replace(new RegExp(`${A}\\s*\\(\\s*${A}\\s*\\)`, "g"), ac).replace(new RegExp(`(?<![\\p{L}\\p{N}])${A}\\s+${A}(?![\\p{L}\\p{N}])`, "gu"), ac);
    T = T.replace(new RegExp(`(?<![\\p{L}\\p{N}])${A}\\s*\\(\\s*([^()]{3,80})\\s*\\)`, "gu"), (m, inner) => // "STM (Sayın Ticaret Merkezi)"
      inner.split(/\s+/).filter((w) => /^\p{Lu}/u.test(w)).map((w) => trUpper(w[0])).join("") === trUpper(ac) && !allowedLower.includes(trLower(inner)) ? ac : m);
  }
  return { text: T, hits };
}

// ------------------------------------------------------------------ 6. brand-token stripping from image prompts
const ENGLISH_SAFE = new Set(["sky", "garden", "life", "point", "park", "home", "city", "center", "centre", "plaza", "tower", "mall",
  "street", "house", "star", "sun", "moon", "green", "blue", "red", "white", "black", "gold", "golden", "royal", "grand", "new", "old", "the"]);
const REALISM_RE = /\b(?:photo-?realistic|hyper-?realistic|realistic|lifelike|vibrant|colou?rful|full[- ]colou?r|in colou?r|cinematic lighting|HDR|[48]K)\b/gi;
const LIGHT_SENTENCE_RE = /^(?:the\s+)?(?:lighting|light|colou?rs?|colou?r palette|mood|atmosphere)\b/i;
export function sanitizeImagePrompt(p, tokens = []) {
  let s = String(p || "").normalize("NFC")
    .replace(/["“”][^"“”]{1,40}["“”](?:\s+(signs?|plates?|boards?|fascias?|banners?|logos?|text))?/gi, (m, w) => (w ? `blank ${w}` : "blank sign")); // quoted sign wording
  for (const t of tokens) {
    if (!t || (!/\s/.test(t) && ENGLISH_SAFE.has(t.toLowerCase()))) continue;
    const multi = /\s/.test(t);
    for (const v of new Set([t, trUpper(t)])) // phrases any case; single words and acronyms exact case only
      s = s.replace(new RegExp(`(?<![\\p{L}\\p{N}])${escapeRe(v).replace(/\s+/g, "\\s+")}(?:['’]\\p{L}+)?(?![\\p{L}\\p{N}])`, multi ? "giu" : "gu"), "");
  }
  s = splitSentences(s).filter((x) => !LIGHT_SENTENCE_RE.test(x)).join(" ");   // "The lighting is bright and professional."
  s = s.replace(new RegExp(`,\\s*(?=${REALISM_RE.source})`, "gi"), " ").replace(REALISM_RE, "");
  s = stripColorWords(s);
  return s.replace(/\(\s*\)/g, "").replace(/\s{2,}/g, " ").replace(/\s+([,.;:'’])/g, "$1").replace(/([,;:])\1+/g, "$1")
    .replace(/\b(the|a|an) (?=[,.;:])/gi, "").replace(/\bthe the\b/gi, "the").replace(/,\s*\./g, ".").trim();
}

// ------------------------------------------------------------------ 6b. colour words in image prompt parts
// klein copies hues from the prompt (real run: "navy blue blazer", "brown leather briefcase", "golden morning light" ->
// golden tint on every frame). Every model-written image part loses chromatic colour words and colour temperature;
// light/dark values stay ("navy blue blazer" -> "dark blazer", "beige coat" -> "light coat", "light gray", "white shirt").
const wordSet = (s) => new Set(s.trim().split(/\s+/));
const C_DARK = wordSet("navy maroon burgundy brown indigo oxblood umber auburn");
const C_LIGHT = wordSet("beige khaki blond blonde ecru");
const C_PLAIN = wordSet(`red blue green yellow purple violet pink teal turquoise cyan magenta crimson scarlet azure cobalt ochre
  chartreuse fuchsia cerulean vermilion golden sepia mauve aqua aquamarine tawny neon rosy rusty reddish bluish greenish
  yellowish brownish pinkish purplish orangey orangish goldish`);
// also everyday nouns (fruit, metal, drink): a colour only in adjective position ("gold watch", "olive green"), never "an orange on the table"
const C_AMBIG = wordSet("orange lime olive mint rose cherry plum wine salmon coral peach copper bronze rust ginger gold emerald ruby sapphire amber lavender lilac mustard mahogany chestnut cream ivory platinum");
const AMBIG_DARK = wordSet("mahogany chestnut"), AMBIG_LIGHT = wordSet("cream ivory platinum");
const C_MODS = wordSet("light pale dark deep bright vivid vibrant soft muted warm cool rich pastel neon dusty burnt hot electric sky royal baby navy forest bottle blood cherry lemon lime olive mint sea ocean midnight powder steel ice icy");
const MOD_DARK = wordSet("dark deep midnight navy forest bottle blood burnt");
const MOD_LIGHT = wordSet("light pale pastel powder baby ice icy");
const C_SUFX = wordSet("colored coloured toned tinted hued");
const NOT_ADJ_NEXT = wordSet(`and or on in at of with is are was were to from by for the a an near under over behind beside next into onto
  juice juices tree trees peel slice slices grove groves blossom blossoms oil leaf leaves bush bushes petal petals garden gardens
  fillet glass glasses bottle bottles barrel barrels cellar bar bars medal medals mine`);
const isColor = (w) => C_DARK.has(w) || C_LIGHT.has(w) || C_PLAIN.has(w);
export function stripColorWords(text) {
  let T = String(text || "");
  if (!T.trim()) return T.trim();
  const X = "\u0001";   // removed span; "\u0002" marks an inserted tonal word (article fix)
  T = T.replace(/\bgolden[\s-]+hour(?:[\s-]+(?:light|lighting|sunlight|glow))?/gi, (m) => (/^G/.test(m) ? "Low sun" : "low sun"))
    .replace(/#[0-9a-f]{3,8}\b/gi, X).replace(/\b(?:rgba?|hsla?|cmyk)\s*\([^)]*\)/gi, X).replace(/\bpantone\s+[\w-]+/gi, X)
    .replace(/\b(?:warm|cool|cold)(?:[\s-]+(?:toned|tinted|hued))?(?=[\s-]+(?:(?:morning|evening|afternoon|ambient|soft|natural|diffused|street|window|interior|indoor)\s+)?(?:light|lighting|lights|glow|sunlight|daylight|lamplight)\b)/gi, X)
    .replace(/\b(?:warm|cool|cold|earth|earthy|golden|pastel|muted|neutral|sunset|autumn|autumnal|jewel|vivid|vibrant|bright|bold|rich|natural|candy|neon)[\s-]+(?:tones?|hues?|colou?rs?|palette|shades|tints?|cast)\b/gi, X)
    .replace(/\b(?:warm|cool)[\s-]+(?:toned|tinted)\b/gi, X)
    .replace(/\b(?:sepia(?:[\s-]+toned)?|tinted|tints?|duotone|technicolou?r|polychrome|multi-?colou?red|rainbow-colou?red|(?:brightly|richly|vividly)[\s-]+colou?red|colou?r[\s-]+(?:grad(?:ed|ing)|temperature|palette|scheme|accents?|splash(?:es)?|pops?))\b/gi, X);
  const toks = [...T.matchAll(/[A-Za-z]+/g)].map((m) => ({ w: m[0], lw: m[0].toLowerCase(), s: m.index, e: m.index + m[0].length }));
  // modifiers join only by a space or hyphen ("navy blue"); colours may also be listed ("red, blue and green")
  const gapOk = (a, b, list) => /^[\s-]*$/.test(T.slice(a.e, b.s)) || (list && /^\s*[,&/]\s*$/.test(T.slice(a.e, b.s)));
  const ambigIsColor = (k) => {
    const nx = toks[k + 1], pv = toks[k - 1];
    if (!nx || !/^[\s-]+$/.test(T.slice(toks[k].e, nx.s)) || (pv && pv.lw === "of")) return false;
    if (C_SUFX.has(nx.lw) || isColor(nx.lw)) return true;
    if ((nx.lw === "and" || nx.lw === "or") && toks[k + 2] && isColor(toks[k + 2].lw)) return true;
    return !NOT_ADJ_NEXT.has(nx.lw);
  };
  const edits = [];
  for (let i = 0; i < toks.length;) {
    const mods = [], cols = [];
    let k = i, last = -1;
    for (; k < toks.length; k++) {
      const x = toks[k];
      if (k > i && !gapOk(toks[k - 1], x, cols.length > 0)) break;
      if (isColor(x.lw) || (C_AMBIG.has(x.lw) && (mods.length || cols.length || ambigIsColor(k)))) { cols.push(x.lw); last = k; continue; }
      if (C_MODS.has(x.lw) && !cols.length) { mods.push(x.lw); continue; }
      if ((x.lw === "and" || x.lw === "or") && cols.length) continue;
      if (C_SUFX.has(x.lw) && last === k - 1) { last = k; continue; }
      break;
    }
    if (last < 0) { i++; continue; }
    const tone = mods.some((m) => MOD_DARK.has(m)) ? "dark" : mods.some((m) => MOD_LIGHT.has(m)) ? "light"
      : C_DARK.has(cols[0]) || AMBIG_DARK.has(cols[0]) ? "dark" : C_LIGHT.has(cols[0]) || AMBIG_LIGHT.has(cols[0]) ? "light" : "";
    const cap = /^[A-Z]/.test(toks[i].w);
    edits.push({ s: toks[i].s, e: toks[last].e, repl: tone ? "\u0002" + (cap ? tone[0].toUpperCase() + tone.slice(1) : tone) : X });
    i = last + 1;
  }
  for (const ed of edits.reverse()) T = T.slice(0, ed.s) + ed.repl + T.slice(ed.e);
  return T
    .replace(/(^|[,;(]\s*|\b(?:a|an|the|with|in|and)\s+)\u0001+\s+(?:and|or|&)\s+/gi, "$1")                // "a red and white sign" -> "a white sign"
    .replace(/\s*\b(?:in|with|of|and|or|under|at|wearing)\s*\u0001+\s*(?=[,.;:!?)]|$|(?:on|in|at|of|over|under|near|by|and)\b)/gi, " ") // "dressed in red." -> "dressed."
    .replace(/\b(an?)\s+\u0002/gi, (m, a) => (a[0] === "A" ? "A " : "a "))                                  // "an indigo coat" -> "a dark coat"
    .replace(/\b(an?)(\s+)(?:\u0001[\s,-]*)+(?=[A-Za-z])/g, (m, a, sp, off, str) => {                          // "an amber lamp" -> "a lamp"
      const nx = str.slice(off + m.length, off + m.length + 1);
      return (/[aeiou]/i.test(nx) ? (a[0] === "A" ? "An" : "an") : (a[0] === "A" ? "A" : "a")) + " ";
    })
    .replace(/(^|[.!?]\s+)\u0001+[\s,-]*(\p{Ll})/gu, (m, a, c) => a + c.toUpperCase())                        // "Golden light ..." -> "Light ..."
    .replace(/\u0001+[\s-]*/g, " ").replace(/\u0002/g, "")
    .replace(/\s{2,}/g, " ").replace(/\s+([,.;:!?)])/g, "$1").replace(/\(\s+/g, "(").replace(/([,;:])(?:\s*[,;:])+/g, "$1")
    .replace(/^\s*[,;:]\s*/, "").replace(/,\s*\./g, ".").replace(/\(\s*\)/g, "").replace(/\s{2,}/g, " ").trim();
}

// ------------------------------------------------------------------ 7. VO merge ("Öyle bir ferahlık ki..." + "...en büyük ...")
// protect: proper nouns / acronyms (brand, place, names from the idea); everything else starting the joined half is
// Turkish-lowercased ("Öyle ki..." + "Her adımda ..." -> "Öyle ki her adımda ...").
export function lowerJoinStart(text, protect = []) {
  const m = String(text).match(/^(\p{Lu})(\p{L}*)/u);
  if (!m) return text;
  const w = m[0];
  if (w.length >= 2 && w === trUpper(w)) return text;                                    // acronym / all caps
  const words = new Set(protect.filter(Boolean).flatMap((p) => String(p).split(/[\s'’]+/)).filter((x) => /^\p{Lu}/u.test(x)));
  if (words.has(w)) return text;
  return trLower(m[1]) + String(text).slice(1);
}
export function mergeSplitVO(scenes, protect = []) {
  const fixes = [];
  const open = (v) => /(\.\.\.|…)\s*$/.test(v);
  const cont = (v) => /^(\.\.\.|…)/.test(v);
  const comma = (v) => /[,;]\s*$/.test(v);
  const lowerStart = (v) => /^\p{Ll}/u.test(v);
  for (let i = 0; i < scenes.length - 1; i++) {
    const a = scenes[i];
    let j = i + 1;
    while (j < scenes.length) {
      const av = String(a.vo || "").trim(), bv = String(scenes[j].vo || "").trim();
      if (!av || !bv || !(open(av) || cont(bv) || (comma(av) && lowerStart(bv.replace(/^(\.\.\.|…)\s*/, ""))))) break;
      a.vo = `${av.replace(/(\.\.\.|…|[,;])\s*$/, "")} ${lowerJoinStart(bv.replace(/^(\.\.\.|…)\s*/, ""), protect)}`.replace(/\s{2,}/g, " ");
      scenes[j].vo = "";
      fixes.push(`scene ${a.n}+${scenes[j].n} vo: split sentence merged into scene ${a.n}`);
      j++;
    }
  }
  return fixes;
}

// ------------------------------------------------------------------ 7b. bracket placeholders ("[MARKA ADI]", "[X m]")
// A placeholder never reaches the client: a brand placeholder becomes the brand the client gave; anything else drops its
// line (the sentence, the on-screen text, the assumption or the reading). Brackets around ordinary words are unwrapped.
const PH_RE = /\[\s*([^[\]\n]{1,40}?)\s*\](?:['’](\p{L}+))?/gu;
const PH_WORDS = /\b(?:x+|n|marka|brand|logo|firma|sirket|company|isletme|adi|ismi|isim|name|urun|sayi|rakam|tarih|adres|fiyat|telefon|tel|sehir|yer|mekan|slogan|web|site|url|metre|m2|tl|yuzde|kampanya|indirim|oran|saat|gun)\b/;
const BRAND_PH = /\b(?:marka|brand|logo|firma|sirket|company|isletme)|\b(?:adi|ismi|isim|name)\b/;
export const isPlaceholder = (inner) => {
  const letters = String(inner).match(/\p{L}/gu) || [];
  return /\.\.\.|…|_{2,}/.test(inner) || (letters.length > 0 && letters.every((c) => /\p{Lu}/u.test(c))) || PH_WORDS.test(fold(inner));
};
// brand: what the client typed (MARKA) or an org-looking name in FİKİR; never a guess.
export function stripPlaceholders(d, { brand = "" } = {}) {
  const fixes = [];
  const fix = (where, text, mode = "sentence") => {
    const T = String(text ?? "");
    if (!T.includes("[")) return T;
    const notes = [];
    let out = T.replace(PH_RE, (m, inner, suf) => {
      if (!isPlaceholder(inner)) { notes.push(`"${m}" unwrapped`); return inner + (suf ? `'${suf}` : ""); }
      if (brand && BRAND_PH.test(fold(inner))) { notes.push(`"${m}" -> brand`); return suf ? attachSuffix(brand, suf, { apostrophe: true }) : brand; }
      notes.push(`"${m}" removed`);
      return "\u0000";
    });
    if (!notes.length) return T;
    if (out.includes("\u0000")) {
      if (mode === "line") out = "";
      else if (mode === "title") out = out.replace(/\s*\u0000\s*/g, " ").replace(/\s{2,}/g, " ").replace(/^[\s:,–—-]+|[\s:,–—-]+$/g, "").trim();
      else out = splitSentences(out).filter((x) => !x.includes("\u0000")).join(" ");
    }
    fixes.push(`${where}: placeholder ${notes.join(", ")}`);
    return out;
  };
  d.title = fix("title", d.title, "title") || "Storyboard";
  for (const k of ["logline", "core_message"]) d[k] = fix(k, d[k]);
  d.assumptions = (d.assumptions || []).map((a, i) => { const x = fix(`assumptions[${i}]`, a, "line"); return x === "" && String(a).trim() ? null : x; }).filter((a) => a != null);
  d.interpretations = (d.interpretations || []).filter((it) => {
    const inv = [...String(it.name).matchAll(PH_RE)].some((m) => isPlaceholder(m[1]));
    if (inv) fixes.push(`interpretation "${it.name}": dropped (reading of a placeholder)`);
    return !inv;
  });
  d.interpretations = d.interpretations.map((it, i) => {
    const meaning = fix(`interpretations[${i}].meaning`, it.meaning, "line");
    return meaning === "" && String(it.meaning).trim() ? null : { ...it, name: fix(`interpretations[${i}].name`, it.name, "title"), meaning };
  }).filter((it) => it && it.name);
  const last = d.scenes.length;
  for (const sc of d.scenes) {
    sc.title = fix(`scene ${sc.n} title`, sc.title, "title") || (sc.n === last ? "Kapanış" : `Sahne ${sc.n}`);
    sc.onscreen_text = fix(`scene ${sc.n} onscreen_text`, sc.onscreen_text, "line");
    for (const k of ["action", "vo", "sound"]) sc[k] = fix(`scene ${sc.n} ${k}`, sc[k]);
  }
  return fixes;
}

// ------------------------------------------------------------------ 7c. English character ids in Turkish text
// "THE COMMUTER aniden durur" -> "Yolcu aniden durur"; "THE COMMUTER'ın" -> "yolcunun"; a proper name keeps its
// apostrophe ("Ayşe Teyze'nin"). Matches "THE X" in any case, and the bare noun in capitals (4+ letters, not in
// onscreen_text, where Turkish capitals are common).
export const TR_FIELDS = ["title", "action", "onscreen_text", "vo", "sound"];
export function localizeCharNames(d) {
  const fixes = [];
  const chars = (d.characters_en || []).filter((c) => c && c.name).map((c) => ({ id: c.name, tr: c.name_tr || defaultNameTr(c.name, c.look) }))
    .sort((a, b) => b.id.length - a.id.length);
  if (!chars.length) return fixes;
  const rx = chars.map(({ id, tr }) => {
    const noun = nounOf(id), words = escapeRe(noun).replace(/\s+/g, "\\s+");
    const tail = "(?:['’](\\p{L}+))?(?![\\p{L}\\p{N}])";
    return { id, tr, the: new RegExp(`(?<![\\p{L}\\p{N}])the\\s+${words}${tail}`, "giu"),
      bare: noun.replace(/\s/g, "").length >= 4 ? new RegExp(`(?<![\\p{L}\\p{N}'’])${words}${tail}`, "gu") : null };
  });
  const put = (where, text, bareOk = true) => {
    let T = String(text ?? "");
    if (!T) return T;
    const before = T;
    for (const r of rx) {
      const repl = (m, suf, off, str) => {
        const proper = isProperTr(r.tr);
        let w = suf ? attachSuffix(r.tr, suf, { apostrophe: proper }) : r.tr;
        if (!str.slice(0, off).trim() || /[.!?…]["'”’)]?\s*$/.test(str.slice(0, off))) w = capFirst(w);
        return w;
      };
      T = T.replace(r.the, repl);
      if (bareOk && r.bare) T = T.replace(r.bare, repl);
    }
    if (T !== before) fixes.push(`${where}: English character id -> Turkish name`);
    return T;
  };
  for (const k of ["title", "logline", "core_message"]) d[k] = put(k, d[k]);
  d.assumptions = (d.assumptions || []).map((a, i) => put(`assumptions[${i}]`, a));
  for (const it of d.interpretations || []) it.meaning = put(`interpretation "${it.name}"`, it.meaning);
  for (const sc of d.scenes || []) for (const k of TR_FIELDS) sc[k] = put(`scene ${sc.n} ${k}`, sc[k], k !== "onscreen_text");
  return fixes;
}

// ------------------------------------------------------------------ 8. lint (mutates d; fixes = applied, warnings = for the UI/log)
// ctx: { idea, context, research, brand, place, entities?, allowedExpansions?: [{ac, expansion}], otherEntities?: {ac: [label]} }
export function lintDraft(d, ctx = {}) {
  const warnings = [], fixes = [];
  const ents = ctx.entities || extractEntities(ctx.idea, { brand: ctx.brand, place: ctx.place });
  const acronyms = ents.acronyms || [];
  const allowedExp = ctx.allowedExpansions || [];
  const allowedLower = trLower([ctx.idea, ctx.context, ctx.brand, ...allowedExp.map((e) => e.expansion)].filter(Boolean).join("\n"));
  const numberSrc = [ctx.idea, ctx.context, ctx.research, ctx.brand, ctx.place].filter(Boolean).join("\n");
  const unknown = acronyms.filter((ac) => !allowedExp.some((e) => e.ac === ac));
  const apos = (s) => String(s ?? "").replace(/’/g, "'");

  // apostrophes (gpt-oss writes ’), split VO, invented expansions in display text
  for (const k of ["title", "logline", "core_message"]) d[k] = apos(d[k]);
  d.assumptions = (d.assumptions || []).map(apos);
  for (const it of d.interpretations || []) { it.name = apos(it.name); it.meaning = apos(it.meaning); }
  for (const sc of d.scenes) for (const k of ["title", "action", "onscreen_text", "vo", "sound"]) sc[k] = apos(sc[k]);
  const userBrand = cleanName(ctx.brand);
  const brand = userBrand || (ents.brand && (ents.orgs || []).includes(ents.brand) ? ents.brand : "");
  fixes.push(...stripPlaceholders(d, { brand }));
  fixes.push(...localizeCharNames(d));
  const protect = [ctx.brand, ctx.place, ents.brand, ents.place, ...(ents.orgs || []), ...(ents.places || []), ...(ents.persons || []),
    ...(ents.names || []), ...acronyms, ...(d.characters_en || []).map((c) => c.name_tr).filter(isProperTr)];
  fixes.push(...mergeSplitVO(d.scenes, protect));

  const scrub = (where, v) => {
    const r = scrubExpansions(v, unknown, allowedLower);
    for (const h of r.hits) fixes.push(`${where}: unsupported expansion "${h.phrase}" -> "${h.repl}"`);
    return r.text;
  };
  for (const k of ["title", "logline", "core_message"]) d[k] = scrub(k, d[k]);
  for (const sc of d.scenes) for (const k of ["title", "action", "onscreen_text", "vo"]) sc[k] = scrub(`scene ${sc.n} ${k}`, sc[k]);
  d.assumptions = d.assumptions.map((a, i) => {
    if (!findInventedExpansions(a, unknown, allowedLower).length || /doğrulanmadı\)$/.test(a)) return a;
    fixes.push(`assumptions[${i}]: unverified expansion flagged`);
    return `${a.replace(/[.\s]+$/, "")} (açılım doğrulanmadı)`;
  });

  // interpretations: invented expansion -> low; unknown acronym never "high"; >= 2 readings per unknown acronym
  for (const it of d.interpretations || []) {
    const inv = findInventedExpansions(it.meaning, unknown, allowedLower);
    if (inv.length) {
      if (it.confidence !== "low") fixes.push(`interpretation "${it.name}": ${it.confidence}->low (unsupported expansion "${inv[0].phrase}")`);
      it.confidence = "low";
      if (!/doğrulanmadı\)$/.test(it.meaning)) it.meaning = `${it.meaning.replace(/[.\s]+$/, "")} (açılım doğrulanmadı)`;
    }
    const ac = unknown.find((a) => trUpper(it.name).includes(trUpper(a)));
    if (ac && it.confidence === "high") { it.confidence = "medium"; fixes.push(`interpretation "${it.name}": high->medium (no verified source for ${ac})`); }
    // no research (no_key, no_entities, disabled, ...): nothing can confirm a reading, unless the client wrote it in BAĞLAM
    // ("Yorumu düzelt") or it is a corrected acronym
    const noResearch = !String(ctx.research || "").trim();
    const fromClient = allowedExp.some((e) => trUpper(it.name).includes(trUpper(e.ac))) || (ctx.context && trLower(ctx.context).includes(trLower(it.name)));
    if (noResearch && it.confidence === "high" && !fromClient) { it.confidence = "medium"; fixes.push(`interpretation "${it.name}": high->medium (no research)`); }
  }
  for (const ac of unknown) {
    const readings = (d.interpretations || []).filter((it) => trUpper(it.name).includes(trUpper(ac)));
    const others = ((ctx.otherEntities || {})[ac] || []).filter((o) => !readings.some((r) => trLower(r.meaning).includes(trLower(o))));
    const add = [];
    if (!readings.length) add.push({ name: ac, meaning: "Müşterinin bu reklamdaki projesi, markası ya da mekânı (açılımı belirtilmemiş).", confidence: "medium" });
    while (readings.length + add.length < 2) {
      const o = others.shift();
      add.push(o ? { name: ac, meaning: `"${o}": aynı kısaltmayı kullanan başka bir kurum; bu fikirle bağlantısı doğrulanmadı.`, confidence: "low" }
        : { name: ac, meaning: "Açılımı belirtilmemiş; aynı harfleri kullanan başka bir kurum, proje ya da yer adı da olabilir. Müşteriyle doğrulanmalı.", confidence: "low" });
    }
    for (const r of add) {
      if ((d.interpretations || []).length >= 6) { warnings.push(`${ac}: fewer than 2 readings and no room to add one`); break; }
      d.interpretations.push(r);
      fixes.push(`interpretations: added reading for ${ac} (${r.confidence})`);
    }
  }

  // scenes
  const charNames = (d.characters_en || []).map((c) => c.name);
  const last = d.scenes.length - 1;
  d.scenes.forEach((sc, i) => {
    if (/[,;]\s*$/.test(sc.vo)) { sc.vo = sc.vo.replace(/[,;]\s*$/, "."); fixes.push(`scene ${sc.n} vo: trailing comma -> period`); }
    if (/[,;]\s*$/.test(sc.onscreen_text)) { sc.onscreen_text = sc.onscreen_text.replace(/[,;]\s*$/, ""); fixes.push(`scene ${sc.n} onscreen_text: trailing comma removed`); }
    for (const k of ["onscreen_text", "vo"]) for (const num of sc[k].match(/\d+(?:[.,]\d+)?/g) || [])
      if (!numberSrc.includes(num)) warnings.push(`scene ${sc.n} ${k}: number "${num}" not in input (invented claim?)`);
    for (const k of ["title", "action", "onscreen_text", "vo", "sound"])
      if (/\bTHE [A-Z]{3,}/.test(sc[k]) || charNames.some((n) => sc[k].includes(n))) warnings.push(`scene ${sc.n} ${k}: English canonical name inside Turkish text`);
    const w = sc.onscreen_text.trim() ? sc.onscreen_text.trim().split(/\s+/).length : 0;
    if (w > 6) warnings.push(`scene ${sc.n} onscreen_text: ${w} words (>6)`);
    const vw = sc.vo.trim() ? sc.vo.trim().split(/\s+/).length : 0;
    if (vw > Math.ceil(3 * (+sc.duration_s || 0))) warnings.push(`scene ${sc.n} vo: ${vw} words for ${sc.duration_s}s (Turkish VO ~2.5-3 words/s)`);
    if (sc.vo && sc.onscreen_text && trLower(sc.vo).replace(/[.!…]+$/, "") === trLower(sc.onscreen_text).replace(/[.!…]+$/, "")) warnings.push(`scene ${sc.n}: vo repeats onscreen_text`);
    if (charNames.length && i < last && !sc.characters.length) warnings.push(`scene ${sc.n}: main subject missing (characters is empty)`);
  });
  const total = d.scenes.reduce((s, x) => s + (+x.duration_s || 0), 0);
  if (total < 12 || total > 35) warnings.push(`total duration ${total}s outside 15-30s`);

  // image fields: never brand/project/place names, no realism/colour/lighting words
  const strip = ents.imageStripTokens || [];
  const san = (where, v) => { const r = sanitizeImagePrompt(v, strip); if (r !== String(v || "").trim()) fixes.push(`${where}: sanitized`); return r; };
  d.location_en = san("location_en", stripStyleSentences(d.location_en) || d.location_en);
  d.anchor_prompt_en = san("anchor_prompt_en", d.anchor_prompt_en);
  for (const c of d.characters_en || []) c.look = san(`${c.name}.look`, c.look);
  for (const sc of d.scenes) sc.image_prompt_en = san(`scene ${sc.n} image_prompt_en`, sc.image_prompt_en);

  return { warnings, fixes, total_duration_s: total };
}

// ------------------------------------------------------------------ 9. one-shot finalize + text stage with one repair
export function finalizeDraft(text, ctx = {}) {
  const parsed = tryParse(text);
  if (!parsed.obj) return { ok: false, errors: ["parse: " + parsed.err], coerced: [] };
  const d = parsed.obj;
  const coerced = coerceDraft(d, ctx);
  const errors = validate(STORYBOARD_SCHEMA_V6, d);
  if (errors.length) return { ok: false, errors, coerced };
  const lint = lintDraft(d, ctx);
  return { ok: true, draft: d, coerced, lint, derived: { style_bible_en: composeStyleBible(d) } };
}

// Bad JSON goes back in a USER turn (assistant-turn repair produced 10k "!" tokens on gpt-oss); tokens capped.
// params: the request params of the failed call (TEXT_PARAMS for gemma, TEXT_FALLBACK_PARAMS for gpt-oss).
export function buildRepairInputs(systemPrompt, badText, errors, firstOutTokens, params = TEXT_PARAMS, what = "storyboard JSON'u") {
  const capKey = "max_completion_tokens" in params ? "max_completion_tokens" : "max_tokens";
  const ceiling = params[capKey] || 6000;
  return {
    messages: [{ role: "system", content: systemPrompt }, { role: "user", content: `Aşağıdaki ${what} geçersiz. Hatalar: ${errors.slice(0, 15).join("; ")}\nİçeriği aynen koru, yalnızca hataları düzelt ve SADECE şemaya uyan tek bir geçerli JSON nesnesi döndür.\n\n${String(badText || "").slice(0, 16000)}` }],
    ...params,
    [capKey]: Math.min(ceiling, Math.round((firstOutTokens || 3000) * 1.3) + 800),
  };
}

export function neuronsOf(model, u) {
  if (u && typeof u.neurons === "number") return +u.neurons.toFixed(1);   // billed value returned by Workers AI
  const r = TEXT_RATES[model];
  const i = u && (u.prompt_tokens ?? u.input_tokens), o = u && (u.completion_tokens ?? u.output_tokens);
  if (!r || i == null) return null;
  return +((i * r[0] + (o || 0) * r[1]) / 1e6).toFixed(1);
}

export async function textCall(ai, inputs, model = TEXT_MODEL) {
  const t0 = Date.now();
  try {
    const out = await ai.run(model, inputs);
    const ch = (out && out.choices || [])[0] || {};
    const u = (out && out.usage) || {};
    return { ms: Date.now() - t0, text: ch.message && ch.message.content, finish: ch.finish_reason, in: u.prompt_tokens, out: u.completion_tokens,
      neurons: neuronsOf(model, u) };
  } catch (e) { return { ms: Date.now() - t0, error: String((e && e.message) || e) }; }
}
// One in-step repair only when it can help: a transport error is retried once; invalid JSON goes back for fixing.
// No repair when the output was cut off (finish=length: the repair has the same token cap, gemma's reasoning would eat
// it again) or when there is no text at all (nothing to repair): the caller's fallback step (gpt-oss) takes over at once.
const repairable = (a, r) => !r.ok && a.finish !== "length" && (!!a.error || String(a.text ?? "").trim() !== "");
const quotaError = (msg) => Object.assign(new Error("QUOTA: " + msg), { quota: true });

// input: { idea, context, research (notes text), brand, place, entities, allowedExpansions, otherEntities }
// opts.model/params: TEXT_MODEL/TEXT_PARAMS (attempt 1) or TEXT_FALLBACK/TEXT_FALLBACK_PARAMS (attempt 2).
export async function draftStage(ai, input, log = [], { model = TEXT_MODEL, params = TEXT_PARAMS } = {}) {
  const messages = [{ role: "system", content: SYSTEM_PROMPT_V6 }, { role: "user", content: buildUserMessageV6(input) }];
  const a = await textCall(ai, { messages, ...params }, model);
  log.push({ step: "draft", model, ms: a.ms, tokens_in: a.in, tokens_out: a.out, neurons: a.neurons, finish: a.finish, error: a.error || null });
  if (a.error && QUOTA_RE.test(a.error)) throw quotaError(a.error);
  let r = a.error ? { ok: false, errors: [a.error], coerced: [] } : finalizeDraft(a.text, input);
  if (repairable(a, r)) {
    const b = await textCall(ai, a.error ? { messages, ...params } : buildRepairInputs(SYSTEM_PROMPT_V6, a.text, r.errors, a.out, params), model);
    log.push({ step: "draft_repair", model, ms: b.ms, tokens_in: b.in, tokens_out: b.out, neurons: b.neurons, finish: b.finish, error: b.error || null, reason: r.errors.slice(0, 5) });
    if (b.error && QUOTA_RE.test(b.error)) throw quotaError(b.error);
    r = b.error ? { ok: false, errors: [b.error], coerced: [] } : finalizeDraft(b.text, input);
  }
  if (!r.ok) throw new Error("draft invalid after repair: " + r.errors.slice(0, 8).join("; "));
  return r; // { draft, coerced, lint, derived }
}

// ------------------------------------------------------------------ 10. scene rewrite ("Yeniden yaz")
const SCENE_SCHEMA = STORYBOARD_SCHEMA_V6.properties.scenes.items;
// Parses one scene, merges it into a copy of the stored draft and runs the same coerce + validate + lint as a full draft.
// Returns { ok, scene, lint, errors }. Only the rewritten scene is taken from the result (other scenes stay as stored).
export function finalizeScene(text, draft, n, ctx = {}) {
  const parsed = tryParse(text);
  if (!parsed.obj) return { ok: false, errors: ["parse: " + parsed.err] };
  let sc = parsed.obj;
  if (sc && typeof sc === "object" && !Array.isArray(sc) && Array.isArray(sc.scenes) && sc.scenes.length === 1) sc = sc.scenes[0]; // {"scenes":[{...}]}
  if (!sc || typeof sc !== "object" || Array.isArray(sc)) return { ok: false, errors: ["$: expected object"] };
  sc = Object.fromEntries(Object.entries(sc).filter(([k]) => SCENE_SCHEMA.properties[k])); // extra keys: drop, no repair call
  const d = JSON.parse(JSON.stringify(draft));
  d.scenes[n - 1] = { ...sc, n };
  coerceDraft(d, ctx);
  const errors = validate(SCENE_SCHEMA, d.scenes[n - 1], `$.scenes[${n - 1}]`);
  if (errors.length) return { ok: false, errors };
  const lint = lintDraft(d, ctx);
  return { ok: true, scene: d.scenes[n - 1], lint };
}

// input: same object as draftStage plus { draft, n, note }.
export async function rewriteSceneStage(ai, input, log = [], { model = TEXT_MODEL, params = SCENE_PARAMS } = {}) {
  const { draft, n } = input;
  // the model sees Turkish names even in drafts stored before the lint replaced English character ids
  const shown = JSON.parse(JSON.stringify(draft));
  localizeCharNames(shown);
  const messages = [{ role: "system", content: SCENE_SYSTEM_V6 }, { role: "user", content: buildSceneMessageV6({ ...input, draft: shown }) }];
  const a = await textCall(ai, { messages, ...params }, model);
  log.push({ step: "scene", model, ms: a.ms, tokens_in: a.in, tokens_out: a.out, neurons: a.neurons, finish: a.finish, error: a.error || null });
  if (a.error && QUOTA_RE.test(a.error)) throw quotaError(a.error);
  let r = a.error ? { ok: false, errors: [a.error] } : finalizeScene(a.text, draft, n, input);
  if (repairable(a, r)) {
    const b = await textCall(ai, a.error ? { messages, ...params } : buildRepairInputs(SCENE_SYSTEM_V6, a.text, r.errors, a.out, params, "sahne JSON'u"), model);
    log.push({ step: "scene_repair", model, ms: b.ms, tokens_in: b.in, tokens_out: b.out, neurons: b.neurons, finish: b.finish, error: b.error || null, reason: r.errors.slice(0, 5) });
    if (b.error && QUOTA_RE.test(b.error)) throw quotaError(b.error);
    r = b.error ? { ok: false, errors: [b.error] } : finalizeScene(b.text, draft, n, input);
  }
  if (!r.ok) throw new Error("scene invalid after repair: " + r.errors.slice(0, 8).join("; "));
  return r; // { scene, lint }
}

// "Yorumu düzelt": lines such as "STM = Sayın Ticaret Merkezi (dükkânlardan oluşan proje)" or "STM: ..." typed by the
// owner become allowed expansions (source: the client), so lint neither scrubs them nor caps their confidence.
export function correctionExpansions(corrections) {
  const out = [];
  for (const line of String(corrections || "").normalize("NFC").split(/\n|;/)) {
    const m = line.match(/^\s*([\p{Lu}\d&]{2,6})\s*(?:=|:|–|—)\s*(.+?)\s*$/u);
    if (!m) continue;
    const expansion = m[2].replace(/\s*\([^()]*\)\s*$/, "").trim();
    if (expansion) out.push({ ac: m[1], expansion, source: "kullanıcı düzeltmesi" });
  }
  return out;
}

// Forced format from the add form ("auto" keeps the model's choice; coerceDraft already maps vertical context to 9:16).
export function applyFormat(d, format) {
  if (format === "16:9" || format === "9:16") d.aspect_ratio = format;
  return d;
}
