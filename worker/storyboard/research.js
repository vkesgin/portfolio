// research.js: deterministic entity extraction, Tavily query building and research notes.
// No LLM call, no Node APIs (uses only String/RegExp/URL/JSON; runs in Workers and browsers).

// ------------------------------------------------------------------ Turkish text helpers
export function trLower(s) {
  return String(s ?? "").normalize("NFC").replace(/İ/g, "i").replace(/I/g, "ı").toLowerCase();
}
export function trUpper(s) {
  return String(s ?? "").normalize("NFC").replace(/i/g, "İ").replace(/ı/g, "I").toUpperCase();
}
// ASCII fold for list/domain matching: "İZMİR", "IZMIR", "izmir" -> "izmir"; "Sayın" -> "sayin"
export function fold(s) {
  return String(s ?? "").normalize("NFC").replace(/[İIı]/g, "i").toLowerCase()
    .replace(/ç/g, "c").replace(/ğ/g, "g").replace(/ö/g, "o").replace(/ş/g, "s").replace(/ü/g, "u")
    .replace(/[âà]/g, "a").replace(/[îì]/g, "i").replace(/[ûù]/g, "u");
}
export const escapeRe = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// ------------------------------------------------------------------ word lists (compared after fold())
const PROVINCES = new Set(("adana adiyaman afyon afyonkarahisar agri aksaray amasya ankara antalya ardahan artvin aydin balikesir bartin batman bayburt bilecik bingol bitlis bolu burdur bursa canakkale cankiri corum denizli diyarbakir duzce edirne elazig erzincan erzurum eskisehir gaziantep giresun gumushane hakkari hatay igdir isparta istanbul izmir kahramanmaras karabuk karaman kars kastamonu kayseri kilis kirikkale kirklareli kirsehir kocaeli konya kutahya malatya manisa mardin mersin mugla mus nevsehir nigde ordu osmaniye rize sakarya samsun sanliurfa siirt sinop sivas sirnak tekirdag tokat trabzon tunceli usak van yalova yozgat zonguldak").split(" "));
const STOP_SINGLE = new Set(("ocak subat mart nisan mayis haziran temmuz agustos eylul ekim kasim aralik " +
  "pazartesi sali carsamba persembe cuma cumartesi pazar " +
  "bu su o bir biz siz ben sen onlar ilk yeni her tum butun en cok daha sabah aksam gece ogle bugun yarin dun " +
  "merhaba sayin degerli sevgili fikir reklam kampanya video film sahne " +
  "turkiye turk instagram reels reel tiktok youtube facebook twitter linkedin whatsapp google story hikaye").split(" "));
// capitalised words that only start a sentence; stripped from the front of a sentence-initial run ("Bu Demlik Kahve")
const STOP_LEAD = new Set(("bu su o bir her tum butun ilk en cok daha merhaba degerli sevgili yeni").split(" "));
const PERSON_WORDS = new Set(("teyze amca bey hanim abla abi agabey usta dede nine hoca doktor dr").split(" "));
const ACR_STOP = new Set(("tl usd eur kdv otv avm tv vo sms pdf url dm ok hd ai yz m2 km cm mm sn dk vs vb tc abd ab").split(" "));
const ORG_STEMS = ["gayrimenkul", "emlak", "insaat", "yapi", "konut", "rezidans", "residence", "mobilya", "kahve", "kafe", "cafe",
  "restoran", "lokanta", "otel", "market", "magaza", "eczane", "kuafor", "berber", "turizm", "gida", "tekstil", "otomotiv",
  "pastane", "firin", "ticaret", "sanayi", "holding", "grup", "group", "kitabevi", "butik", "optik", "klinik", "hastane",
  "okul", "kolej", "akademi", "studyo", "studio", "ajans", "banka", "bank", "sigorta", "elektrik", "elektronik", "mimarlik",
  "dekorasyon", "petrol", "lojistik", "kargo", "kozmetik", "kuyumcu", "cicek", "plaza", "carsi", "pasaj", "merkezi"];
const ORG_EXACT = new Set(["oto", "spor", "as", "a.s", "ltd", "sti"]);
const LEGAL_RE = /\s+(?:A\.?Ş\.?|Ltd\.?(?:\s*Şti\.?)?|Şti\.?|San\.?\s*(?:ve\s*)?Tic\.?(?:\s*Ltd\.?)?(?:\s*Şti\.?)?)$/iu;

// Turkish case/possessive suffixes that can follow an acronym WITHOUT an apostrophe ("STMnin", "AVMde")
const GLUED_SUFFIX_RE = /^(?:[dt][ae](?:n|ki)?|n?[ıiuü]n|y?[ae]|y?[ıiuü]|n[ae]|n[dt][ae]n?|l[ae]r\p{Ll}{0,3}|s[ıiuü]|s[ıi]z)$/u;
// apostrophe suffixes that mark a place (locative / ablative)
const PLACE_SUFFIX_RE = /^(?:[dt][ae]n?|n[dt][ae]n?|[dt][ae]ki)$/u;

const WORD_RE = /[\p{L}\p{N}]+(?:[.&+\-][\p{L}\p{N}]+)*\.?(?:['’`´]\p{L}+)?/gu;

function parseToken(raw) {
  const m = raw.match(/^(.+?)(?:['’`´](\p{L}+))?$/u);
  let base = m[1].replace(/\.$/, (d) => (/\p{Lu}\.\p{Lu}/u.test(m[1]) ? d : "")); // keep "A.Ş." dot, drop sentence dot
  let suffix = m[2] || "";
  const apos = !!m[2];
  if (!apos) {
    const g = base.match(/^([\p{Lu}\d&]{2,6})(\p{Ll}{1,5})$/u); // "STMnin" -> "STM" + "nin"
    if (g && GLUED_SUFFIX_RE.test(g[2])) { base = g[1]; suffix = g[2]; }
  }
  return { raw, base, suffix, apos };
}
const isCap = (w) => /^\p{Lu}/u.test(w);
export const isAcronym = (w) =>
  /^[\p{Lu}\d&]{2,6}$/u.test(w) && (w.match(/\p{Lu}/gu) || []).length >= 2 && !ACR_STOP.has(fold(w));
const isOrgWord = (w) => { const f = fold(w).replace(/\.$/, ""); return ORG_EXACT.has(f) || ORG_STEMS.some((s) => f.startsWith(s)); };
const stripLegal = (s) => String(s).replace(LEGAL_RE, "").trim();
// user field: "Sayın Gayrimenkul'ün" -> "Sayın Gayrimenkul", "  STM " -> "STM"
export function cleanName(s) {
  return stripLegal(String(s ?? "").normalize("NFC").replace(/['’`´]\p{L}+/gu, "").replace(/["“”«»]/g, "").replace(/\s+/g, " ").trim()).slice(0, 60);
}

// ------------------------------------------------------------------ entity extraction
// Returns { brand, place, acronyms[], orgs[], places[], names[], imageStripTokens[], candidates[] }.
// brand/place: user fields win; otherwise the best candidate from the idea.
export function extractEntities(idea, { brand = "", place = "" } = {}) {
  const text = String(idea ?? "").normalize("NFC");
  const letters = text.match(/\p{L}/gu) || [];
  const upperShare = letters.length ? letters.filter((c) => /\p{Lu}/u.test(c)).length / letters.length : 0;
  const shouting = upperShare > 0.6 && letters.length > 12; // idea typed in CAPS: capitalisation carries no signal

  const toks = [];
  for (const m of text.matchAll(WORD_RE)) {
    const before = text.slice(0, m.index);
    const prev = before.replace(/[\s"'“”‘’«»()[\]\-–—]+$/u, "");
    const t = parseToken(m[0]);
    t.start = m.index; t.end = m.index + m[0].length;
    t.sentStart = prev === "" || /[.!?…:]$/.test(prev) || /\n\s*$/.test(before);
    toks.push(t);
  }

  const cands = [];
  const push = (c) => {
    const key = fold(c.text);
    const old = cands.find((x) => fold(x.text) === key);
    if (old) { old.count++; if (c.suffix) old.suffixes.add(c.suffix); return; }
    cands.push({ ...c, count: 1, suffixes: new Set(c.suffix ? [c.suffix] : []) });
  };

  let run = [];
  const flush = () => {
    if (!run.length) return;
    let words = run.map((t) => t.base);
    // a sentence-initial single capitalised word without apostrophe is just sentence case ("Sabah", "İlk")
    if (run.length === 1 && run[0].sentStart && !run[0].apos) { run = []; return; }
    while (words.length > 1 && run[0].sentStart && STOP_LEAD.has(fold(words[0]))) { words.shift(); run.shift(); run[0].sentStart = true; }
    while (words.length > 1 && STOP_SINGLE.has(fold(words[words.length - 1]))) { words.pop(); run.pop(); }
    if (words.length === 1 && STOP_SINGLE.has(fold(words[0]))) { run = []; return; }
    const last = run[run.length - 1];
    const name = stripLegal(words.join(" "));
    let kind = "name";
    if (words.some(isOrgWord)) kind = "org";
    else if (words.some((w) => PERSON_WORDS.has(fold(w)))) kind = "person";
    else if (words.length === 1 && (PROVINCES.has(fold(name)) || (last.apos && PLACE_SUFFIX_RE.test(last.suffix)))) kind = "place";
    else if (words.length > 1 && PROVINCES.has(fold(words[words.length - 1])) && last.apos) kind = "place";
    if (name.length >= 2) push({ text: name, kind, suffix: last.apos ? last.suffix : "", words: words.length, pos: run[0].start });
    run = [];
  };

  for (let i = 0; i < toks.length; i++) {
    const t = toks[i];
    if (/^[\p{Lu}\d&]{2,6}$/u.test(t.base) && ACR_STOP.has(fold(t.base))) { flush(); continue; } // TL, AVM, KDV ...
    if (shouting) {
      // CAPS idea: only apostrophe tokens and org words carry signal; the user's brand/place fields matter most here
      if (t.apos && /^[\p{Lu}\d&]{2,4}$/u.test(t.base) && isAcronym(t.base)) push({ text: t.base, kind: "acronym", suffix: t.suffix, words: 1, pos: t.start });
      else if (isOrgWord(t.base) && i > 0 && !/^\d/.test(toks[i - 1].base)) push({ text: `${toks[i - 1].base} ${t.base}`, kind: "org", suffix: t.suffix, words: 2, pos: toks[i - 1].start });
      else if (t.apos) push({ text: t.base, kind: PROVINCES.has(fold(t.base)) ? "place" : "name", suffix: t.suffix, words: 1, pos: t.start });
      continue;
    }
    if (isAcronym(t.base)) {
      flush();
      push({ text: t.base, kind: "acronym", suffix: t.suffix, words: 1, pos: t.start });
      continue;
    }
    if (!isCap(t.base) || /^\d/.test(t.base)) { flush(); continue; }
    const prevTok = run[run.length - 1];
    const gap = prevTok ? text.slice(prevTok.end, t.start) : "";
    if (prevTok && (prevTok.apos || !/^\s*(?:&|\+)?\s*$/.test(gap))) flush();
    run.push(t);
    if (t.apos) flush(); // a suffix ends the name: "Ahşap Ev Mobilya'nın" | "Moda'da"
  }
  flush();

  const userBrand = cleanName(brand), userPlace = cleanName(place);
  const has = (outer, inner) => !!outer && !!inner && ` ${fold(outer)} `.includes(` ${fold(inner)} `);
  const orgs = cands.filter((c) => c.kind === "org").map((c) => c.text);
  const names = cands.filter((c) => c.kind === "name").map((c) => c.text);
  const places = cands.filter((c) => c.kind === "place").map((c) => c.text);
  const persons = cands.filter((c) => c.kind === "person").map((c) => c.text);
  const multiNames = cands.filter((c) => c.kind === "name" && c.words > 1).map((c) => c.text);
  const hasAcronym = cands.some((c) => c.kind === "acronym");
  // brand: user field > org-looking name > (no acronym) multi-word proper name. Persons ("Ayşe Teyze") never.
  const brandOut = userBrand || orgs[0] || (hasAcronym ? null : multiNames[0]) || null;
  const placeOut = userPlace || places[0] || null;
  // every acronym (incl. a brand that is itself an acronym): lint needs them all; queries skip the brand one
  const acronyms = cands.filter((c) => c.kind === "acronym").map((c) => c.text);
  if (userBrand && isAcronym(userBrand)) acronyms.unshift(userBrand);

  // tokens that must never reach the image model (brand, project, place names; whole phrases first)
  const phrases = [brandOut, placeOut, ...orgs, ...names, ...places, ...persons].filter(Boolean);
  const singles = phrases.flatMap((p) => p.split(/\s+/)).filter((w) => w.length >= 3);
  const imageStripTokens = [...new Set([...phrases, ...acronyms, ...singles])].sort((a, b) => b.length - a.length);

  return {
    brand: brandOut, place: placeOut, acronyms: [...new Set(acronyms)],
    orgs: orgs.filter((o) => !has(brandOut, o) || o === brandOut),
    places, persons, names: names.filter((n) => !has(brandOut, n) && !has(placeOut, n)),
    imageStripTokens,
    candidates: cands.map((c) => ({ text: c.text, kind: c.kind, suffixes: [...c.suffixes], count: c.count })),
  };
}

// ------------------------------------------------------------------ search queries (max 3, no LLM)
// 1. brand (+ place)  2. brand + acronym (finds the brand's own page about it)  3. bare acronym (+ place) = other readings
export function buildSearchQueries(ents, { max = 3 } = {}) {
  const { brand, place } = ents;
  const join = (...p) => p.filter(Boolean).join(" ").replace(/\s+/g, " ").trim().slice(0, 100);
  const q = [];
  if (brand) q.push({ kind: "brand", entity: brand, query: join(brand, place) });
  for (const ac of ents.acronyms.filter((a) => fold(a) !== fold(brand || "")).slice(0, brand ? 1 : 2)) {
    if (brand) q.push({ kind: "cooc", entity: ac, query: join(brand, ac) });
    q.push({ kind: "alt", entity: ac, query: join(ac, place) });
  }
  if (!ents.acronyms.some((a) => fold(a) !== fold(brand || ""))) {
    const other = ents.names[0] || ents.orgs.find((o) => o !== brand);
    if (other) q.push({ kind: "name", entity: other, query: join(other, brand && !other.includes(brand) ? brand : place) });
  }
  const seen = new Set();
  return q.filter((x) => x.query && !seen.has(fold(x.query)) && seen.add(fold(x.query))).slice(0, max);
}

// Tavily request (basic search = 1 credit). include_answer:false on purpose: an LLM answer would guess acronym expansions.
export function buildTavilyRequest(query, apiKey) {
  return {
    url: "https://api.tavily.com/search",
    init: {
      method: "POST",
      headers: { "Authorization": `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        query, search_depth: "basic", topic: "general", country: "turkey", max_results: 5,
        include_answer: false, include_raw_content: false, include_images: false, include_usage: true,
      }),
    },
  };
}

// ------------------------------------------------------------------ research notes (compact, no guessed expansions)
function clean(s, n) {
  let t = String(s ?? "").normalize("NFC")
    .replace(/<(script|style)\b[\s\S]*?<\/\1\s*>/gi, " ")
    .replace(/<[^>]*>/g, " ").replace(/[<>]/g, " ")                 // no tags: cannot close <research>
    .replace(/https?:\/\/\S+/g, " ").replace(/[#*_`|]{2,}/g, " ")
    .replace(/\s+/g, " ").trim();
  if (t.length > n) t = t.slice(0, n).replace(/\s+\S*$/, "") + "…";
  return t;
}
const shortTitle = (t) => clean(String(t ?? "").split(/\s[-|–—:»]\s|\s\|\s/)[0], 70);
const hasWord = (text, w) => new RegExp(`(?<![\\p{L}\\p{N}])${escapeRe(w)}(?![\\p{L}\\p{N}])`, "u").test(text);
const initials = (phrase) => phrase.split(/\s+/).filter((w) => isCap(w)).map((w) => trUpper(w[0])).join("");

// expansions of `ac` WRITTEN EXPLICITLY next to it: "STM (Sayın Ticaret Merkezi)", "Sayın Ticaret Merkezi (STM)", "STM: Sayın Ticaret Merkezi".
// A bare capitalised phrase whose initials happen to spell the acronym is NOT treated as its expansion here.
export function findExpansions(text, ac) {
  const out = new Set();
  const T = String(text ?? "").normalize("NFC");
  const A = escapeRe(ac);
  const W = "\\p{Lu}[\\p{L}\\p{N}]*(?:\\s+(?:ve\\s+|&\\s+)?\\p{Lu}[\\p{L}\\p{N}]*){1,6}";
  const pats = [
    new RegExp(`(?<![\\p{L}\\p{N}])${A}\\s*\\(\\s*(${W})\\s*\\)`, "gu"), // STM (Sayın Ticaret Merkezi)
    new RegExp(`(${W})\\s*\\(\\s*${A}\\s*\\)`, "gu"),                     // Sayın Ticaret Merkezi (STM)
    new RegExp(`(?<![\\p{L}\\p{N}])${A}\\s*[:–—]\\s*(${W})`, "gu"),       // STM: Sayın Ticaret Merkezi
  ];
  for (const re of pats) for (const m of T.matchAll(re)) {
    const words = m[1].trim().split(/\s+/);
    for (let i = 0; i < words.length; i++) for (let j = i + 1; j <= words.length; j++) {
      const ph = words.slice(i, j).join(" ");
      if (isCap(words[i]) && initials(ph) === trUpper(ac)) out.add(ph);
    }
  }
  return [...out];
}

// responses: [{ query, kind, entity, results: [{ title, url, content, score }] }]  (Tavily /search response + our query meta)
// Returns { text|null, allowedExpansions[{ac, expansion, source}], otherEntities{ac: [label]}, sources[{title,url}] }
export function buildResearchNotes({ entities, responses = [], date = "", maxChars = 1600 }) {
  const brand = entities.brand || "";
  const brandFold = fold(brand);
  const brandSlug = brandFold.replace(/[^a-z0-9]/g, "");
  const brandWords = brandFold.split(/\s+/).filter((w) => w.length >= 3);

  const seen = new Set(), all = [];
  for (const r of responses) for (const x of (r.results || []).slice(0, 5)) {
    if (!x || !x.url || seen.has(x.url)) continue;
    seen.add(x.url);
    let host = ""; try { host = new URL(x.url).hostname.replace(/^www\./, ""); } catch { continue; }
    const raw = `${x.title || ""}. ${x.content || ""}`.normalize("NFC");
    const f = fold(raw);
    const onBrandDomain = brandSlug.length >= 4 && host.replace(/[^a-z0-9]/g, "").includes(brandSlug);
    const mentionsBrand = brandWords.length > 0 && brandWords.every((w) => f.includes(w));
    all.push({ host, url: x.url, raw, title: clean(x.title, 80), label: shortTitle(x.title), snippet: clean(x.content, 200),
      brandLinked: onBrandDomain || mentionsBrand, onBrandDomain, score: +x.score || 0 });
  }
  if (!all.length && !responses.length) return { text: null, allowedExpansions: [], otherEntities: {}, sources: [] };

  const lines = []; // {p: priority (lower = keep longer), s: text}
  const add = (p, s) => lines.push({ p, s });
  const brandHits = all.filter((r) => r.brandLinked);
  const ownDomains = [...new Set(brandHits.filter((r) => r.onBrandDomain).map((r) => r.host))];

  if (brand) {
    if (!brandHits.length) add(0, `- "${brand}": web taramasında markayla açıkça eşleşen sonuç bulunamadı.`);
    else {
      add(0, `- "${brand}": ${ownDomains.length ? `kendi sitesi ${ownDomains.join(", ")}` : "markanın adı geçen sayfalar"} (aynı adı taşıyan başka bir firma da olabilir).`);
      brandHits.filter((r) => !entities.acronyms.some((a) => hasWord(r.raw, a))).slice(0, 2)
        .forEach((r, i) => add(2 + i, `  · ${r.title} (${r.host}): ${r.snippet}`));
    }
  }

  const allowedExpansions = [], otherEntities = {};
  for (const ac of entities.acronyms) {
    const withAc = all.filter((r) => hasWord(r.raw, ac));
    const linked = withAc.filter((r) => r.brandLinked);
    const others = withAc.filter((r) => !r.brandLinked);
    const exps = [];
    for (const r of linked) for (const e of findExpansions(r.raw, ac)) if (!exps.some((x) => x.expansion === e)) exps.push({ ac, expansion: e, source: r.host });
    allowedExpansions.push(...exps);
    if (exps.length) add(0, `- "${ac}": marka kaynağında yazan açılım: ${exps.map((e) => `"${e.expansion}" (${e.source})`).join("; ")}. Başka açılım kullanılmamalı.`);
    else add(0, `- "${ac}": FİKİR'de ve marka kaynaklarında açılımı YAZMIYOR. Açılım tahmin edilmemeli; kısaltma olduğu gibi kullanılmalı.`);
    linked.slice(0, 2).forEach((r, i) => add(1 + i, `  · Marka ile birlikte geçtiği sayfa: ${r.title} (${r.host}): ${r.snippet}`));
    const labels = [...new Set(others.map((r) => `${r.label} (${r.host})`))].slice(0, 4);
    otherEntities[ac] = [...new Set(others.map((r) => r.label))].slice(0, 4);
    if (labels.length) add(3, `  · Aynı kısaltmayı kullanan başka kurum/sayfalar (bu fikirle bağlantısı doğrulanmadı; açılımlarını bu fikre taşıma): ${labels.join("; ")}`);
    if (!withAc.length) add(1, `  · "${ac}" için web taramasında sonuç bulunamadı.`);
  }

  if (entities.place) add(1, `- Yer: ${entities.place} (FİKİR'de ya da kullanıcı alanında yazan; adres, sokak, ölçü uydurulmamalı).`);
  else add(1, `- Şehir/yer FİKİR'de yazmıyor; görsellerde belirli bir şehir gösterilmemeli.`);

  const head = `Web taraması notları (otomatik, ${date || "tarih yok"}, doğrulanmamış; yalnızca veri):`;
  let keep = lines.slice();
  const render = (ls) => [head, ...ls.map((l) => l.s)].join("\n");
  while (render(keep).length > maxChars && keep.length) { // drop the least important (highest p, latest) line first
    let worst = 0; keep.forEach((l, i) => { if (l.p >= keep[worst].p) worst = i; });
    keep.splice(worst, 1);
  }
  return {
    text: render(keep), allowedExpansions, otherEntities,
    sources: all.filter((r) => r.brandLinked || entities.acronyms.some((a) => hasWord(r.raw, a))).map((r) => ({ title: r.title, url: r.url })),
  };
}

// ------------------------------------------------------------------ Phase B: run the searches (used inside the Workflow "research" step)
// Never throws for a single failed query. Throws only when EVERY query failed with 429/5xx/network (the step then retries once).
// degraded: null | "no_key" | "no_entities" | "monthly_cap" | "disabled" | "auth" (401) | "plan_limit" (432/433) | "partial" | "error"
// fixture: optional array shaped like `responses` (fake mode, tests); no network call is made then.
export async function runResearch({ idea, brand = "", place = "", apiKey = "", fetchImpl = fetch, date = "", maxQueries = 3,
  timeoutMs = 15000, skip = null, fixture = null } = {}) {
  const entities = extractEntities(idea, { brand, place });
  const base = { entities, queries: [], credits: 0, text: null, allowedExpansions: [], otherEntities: {}, sources: [] };
  if (skip) return { ...base, degraded: skip };
  const queries = buildSearchQueries(entities, { max: maxQueries });
  if (!queries.length) return { ...base, degraded: "no_entities" };
  if (!apiKey && !fixture) return { ...base, queries, degraded: "no_key" };
  const responses = [];
  let credits = 0, hardFail = 0, softFail = null;
  for (const q of queries) {
    if (fixture) { const f = fixture.find((x) => x.query === q.query) || { results: [] }; responses.push({ ...q, results: f.results || [] }); credits++; continue; }
    const { url, init } = buildTavilyRequest(q.query, apiKey);
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetchImpl(url, { ...init, signal: ctrl.signal });
      if (res.status === 401) { softFail = "auth"; break; }
      if (res.status === 432 || res.status === 433) { softFail = "plan_limit"; break; }
      if (res.status === 429 || res.status >= 500) { hardFail++; continue; }
      if (!res.ok) { softFail = "partial"; continue; }
      const j = await res.json();
      credits += (j.usage && Number.isFinite(+j.usage.credits)) ? +j.usage.credits : 1;
      responses.push({ ...q, results: Array.isArray(j.results) ? j.results.slice(0, 5) : [] });
    } catch (e) {
      hardFail++;
    } finally { clearTimeout(timer); }
  }
  if (!responses.length && hardFail && !softFail) throw new Error(`tavily: all ${hardFail} queries failed`);
  const notes = responses.length ? buildResearchNotes({ entities, responses, date }) : { text: null, allowedExpansions: [], otherEntities: {}, sources: [] };
  return { ...base, ...notes, queries, credits, degraded: softFail || (hardFail ? "partial" : null) };
}
