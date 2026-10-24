/* fikir-tags.mjs: company tags ("Firma") of Fikir Havuzu ideas. Pure (no DOM): the board (fikir.html) and the worker
 * (worker/inspire-tags.js) import the same rules, so client and server dedupe names the same way.
 *
 *   cleanTagName(v)            -> display name (NFC, no bidi / zero-width / filler / control characters, single spaces, trimmed)
 *   checkTagName(v)            -> {name, fold} | {error, message (TR)}
 *   tagFold(s)                 -> dedupe key: case-, diacritics- and Turkish İ/ı-insensitive ('SAYIN' = 'Sayın' = 'sayin')
 *   tagSlugBase(fold)          -> URL slug ([a-z0-9-], <= 48; 'firma' when nothing is left)
 *   tagDefaultColor(fold)      -> one of TAG_COLORS (deterministic)
 *   tagMatches(post, f)        -> the board's filter predicate (f = {ids: Set<number>, all, untagged})
 *   parseFilterQuery(search, bySlug) / filterQueryString(f, byId)   board URL state (?firma=sayin,gayrimenkul&eslesme=hepsi)
 *   tagFilterApiQuery(f)       -> GET /api/inspire/posts filter (tags=1,2&match=all&untagged=1)
 */

export const TAG_NAME_MAX = 40;        // code points, like the worker's INSPIRE_MAX_NAME
export const TAG_PER_POST_MAX = 10;
export const TAG_CATALOG_MAX = 300;
export const TAG_FILTER_MAX = 20;      // ids in one ?tags=
export const TAG_COLORS = Object.freeze(['cyan', 'blue', 'violet', 'pink', 'red', 'orange', 'amber', 'lime', 'green', 'teal']);
// Folded names that would read as a filter word on the board ("Tümü", "Firmasız", "Hepsi", "Herhangi biri")
export const TAG_RESERVED = Object.freeze(['firmasiz', 'tumu', 'tum', 'hepsi', 'herhangi', 'herhangi biri']);
export const UNTAGGED_TOKEN = 'firmasiz';   // ?firma=firmasiz,… (no slug can be it: see tagSlugBase)
const RESERVED_SLUGS = new Set(TAG_RESERVED.map((r) => r.replace(/ /g, '-')));
const SLUG_MAX = 48;

const MESSAGES = {
  empty_name: 'Firma adı boş olamaz',
  name_too_long: `Firma adı en fazla ${TAG_NAME_MAX} karakter olabilir`,
  reserved_name: 'Bu ad filtre için ayrılmış, başka bir ad seç',
  invalid_name: 'Firma adında en az bir harf ya da rakam olmalı',
  invalid_chars: 'Firma adında üst üste binen işaretler olamaz',
};

// Invisible characters a name never keeps (removed, not turned into a space): bidi controls and marks (U+061C, U+200E/F,
// U+202A-E, U+2066-9), zero-width (U+200B-D, U+2060-4, U+FEFF), the soft hyphen (U+00AD, common in copied web text:
// 'Gayri\u00ADmenkul' is 'Gayrimenkul'), the combining grapheme joiner (U+034F), Mongolian vowel separator / variation
// selectors (U+180B-E) and the Hangul fillers that count as letters (U+115F, U+1160, U+3164, U+FFA0). Variation selectors
// U+FE00-F stay (emoji presentation); tagFold drops them and every other default-ignorable character.
const INVISIBLE_RE = /[\u00AD\u034F\u061C\u115F\u1160\u180B-\u180E\u200B-\u200F\u202A-\u202E\u2060-\u2064\u2066-\u2069\u3164\uFEFF\uFFA0]/g;
// Display name: the same character classes as the worker's cleanInspireName and the invisible ones above (no truncation:
// checkTagName refuses > max).
export function cleanTagName(v) {
  if (typeof v !== 'string') return '';
  return v.normalize('NFC')
    .replace(INVISIBLE_RE, '')
    .replace(/[\u0000-\u001F\u007F-\u009F\u2028\u2029]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function checkTagName(v) {
  const name = cleanTagName(v);
  const err = (error) => ({ error, message: MESSAGES[error] });
  if (!name) return err('empty_name');
  if (Array.from(name).length > TAG_NAME_MAX) return err('name_too_long');
  if (/\p{M}{3}/u.test(name)) return err('invalid_chars');   // stacked marks ("Zalgo"): no real name has 3 in a row after NFC
  const fold = tagFold(name);
  if (!fold) return err('invalid_name');
  if (TAG_RESERVED.includes(fold)) return err('reserved_name');
  return { name, fold };
}

// NFKD, marks and invisible (format / default-ignorable) characters dropped, lower case, ı -> i, again NFKD + marks
// (İ.toLowerCase() = i + U+0307), runs of anything that is not a letter or digit -> one space.
// 'İstanbul Yapı' = 'istanbul-yapi' -> 'istanbul yapi'; 'Çağ' -> 'cag'; 'A1' stays 'a1'; 'Say\u200Dın' = 'Sayın' -> 'sayin'.
export function tagFold(s) {
  return String(s == null ? '' : s).normalize('NFKD').replace(/[\p{M}\p{Cf}\p{Default_Ignorable_Code_Point}]/gu, '').toLowerCase()
    .replace(/ı/g, 'i').normalize('NFKD').replace(/\p{M}/gu, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

// URL slug of a fold: ASCII letters / digits joined by '-'. Nothing left (Cyrillic, emoji only …) -> 'firma'. A slug that
// reads as a filter word ('firmasiz' from 'firmasiz ж') gets '-firma'. Collisions are the server's job (slug-<id>).
export function tagSlugBase(fold) {
  let s = String(fold || '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  if (s.length > SLUG_MAX) s = s.slice(0, SLUG_MAX).replace(/-+$/, '');
  if (!s) return 'firma';
  return RESERVED_SLUGS.has(s) ? s + '-firma' : s;
}

// djb2 over the fold's UTF-16 units
export function tagDefaultColor(fold) {
  let h = 5381;
  const s = String(fold || '');
  for (let i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0;
  return TAG_COLORS[h % TAG_COLORS.length];
}

const postTagIds = (post) => (post && Array.isArray(post.tags) ? post.tags : []).map((t) => Number(t && t.id)).filter(Number.isInteger);
export const filterActive = (f) => !!f && ((f.ids && f.ids.size > 0) || !!f.untagged);

// No filter: every post. untagged: posts without companies (OR-ed with the ids in both modes, like the server).
// any: one of f.ids; all: every one of f.ids.
export function tagMatches(post, f) {
  if (!filterActive(f)) return true;
  const ids = postTagIds(post);
  if (f.untagged && !ids.length) return true;
  const want = f.ids;
  if (!want || !want.size) return false;
  if (f.all) {
    const have = new Set(ids);
    for (const id of want) if (!have.has(id)) return false;
    return true;
  }
  return ids.some((id) => want.has(id));
}

const slugMap = (m) => (m instanceof Map ? m : new Map(Object.entries(m || {})));
// ?firma=<slug>,…&eslesme=hepsi|herhangi -> {ids: Set<number>, all, untagged, dropped}. bySlug: Map slug -> tag ({id}) or id.
// Unknown slugs (a renamed / deleted company in an old link) and a bad eslesme are dropped (dropped: true: rewrite the URL).
export function parseFilterQuery(search, bySlug) {
  const q = new URLSearchParams(typeof search === 'string' ? search : '');
  const map = slugMap(bySlug);
  const out = { ids: new Set(), all: false, untagged: false, dropped: false };
  const raw = q.get('firma');
  if (raw) {
    for (const part of raw.split(',')) {
      const slug = part.trim().toLowerCase();
      if (!slug) continue;
      if (slug === UNTAGGED_TOKEN) { out.untagged = true; continue; }
      const t = map.get(slug);
      const id = Number(t && typeof t === 'object' ? t.id : t);
      if (Number.isInteger(id) && id > 0 && out.ids.size < TAG_FILTER_MAX) out.ids.add(id);
      else out.dropped = true;
    }
  }
  const m = q.get('eslesme');
  if (m === 'hepsi') out.all = true;
  else if (m != null && m !== 'herhangi') out.dropped = true;
  if (out.all && !out.ids.size) { out.all = false; if (m) out.dropped = true; }
  return out;
}

// The URL part of a filter ('' = no filter). byId: Map id -> tag ({slug}); ids it does not know are left out.
export function filterQueryString(f, byId) {
  if (!filterActive(f)) return '';
  const slugs = [];
  for (const id of f.ids || []) {
    const t = byId && byId.get(id);
    if (t && t.slug) slugs.push(t.slug);
  }
  if (f.untagged) slugs.push(UNTAGGED_TOKEN);
  if (!slugs.length) return '';
  return 'firma=' + slugs.join(',') + (f.all && f.ids && f.ids.size ? '&eslesme=hepsi' : '');
}

// GET /api/inspire/posts?… of a filter ('' = no filter)
export function tagFilterApiQuery(f) {
  if (!filterActive(f)) return '';
  const ids = [...(f.ids || [])].slice(0, TAG_FILTER_MAX);
  return [ids.length ? 'tags=' + ids.join(',') : '', 'match=' + (f.all ? 'all' : 'any'), 'untagged=' + (f.untagged ? 1 : 0)]
    .filter(Boolean).join('&');
}
