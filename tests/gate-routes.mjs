// gate-routes.mjs: every /api/inspire/* route, read from the router source, so the board-password gate tests walk a new
// route without anyone listing it. Sources: handleInspireRoutes() in worker/index.js and handleStoryboard() in
// worker/storyboard/routes.js. A route is a line of those bodies that names an /api/inspire path (a string compared with
// ===, or a regex literal used with .match()/.test()) together with `method === '<VERB>'`; a regex is expanded to example
// paths (alternatives all taken). A line that mentions both an /api/inspire path and `method ===` but yields no path
// throws, so a route written in a new shape fails the tests instead of being skipped silently.
// Used by tests/fikir-gate.test.mjs (Node harness) and tests/gate-e2e/gate-smoke.mjs (wrangler dev).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// Placeholders in example paths: {post} (a post id), {note} (a note id), {sb} (a storyboard id), digits otherwise '1'.
const PH = { post: '{post}', note: '{note}', sb: '{sb}' };

// Example strings of the regex subset the router uses: ^ $ literals \/ \d [class] {n,m} + ( ) (?: ) |
function expand(src) {
  let i = 0;
  const parseAlt = () => {   // -> array of strings
    let out = [''];
    const alts = [];
    while (i < src.length && src[i] !== ')') {
      if (src[i] === '|') { alts.push(out); out = ['']; i++; continue; }
      const atom = parseAtom();
      let min = 1;
      if (src[i] === '{') { const m = /^\{(\d+)(?:,(\d*))?\}/.exec(src.slice(i)); min = Number(m[1]); i += m[0].length; }
      else if (src[i] === '+') { i++; }
      else if (src[i] === '?' || src[i] === '*') { min = 0; i++; }
      const rep = atom.map((a) => (a.ph ? (min > 0 ? a.ph(min) : '') : a.s.repeat(min)));
      out = out.flatMap((o) => rep.map((r) => o + r));
    }
    alts.push(out);
    return alts.flat();
  };
  const parseAtom = () => {   // -> array of {s} | {ph(n)}
    const c = src[i];
    if (c === '^' || c === '$') { i++; return [{ s: '' }]; }
    if (c === '\\') {
      const d = src[i + 1]; i += 2;
      if (d === 'd') return [{ ph: (n) => '1'.repeat(n) }];
      return [{ s: d }];
    }
    if (c === '[') {
      const j = src.indexOf(']', i);
      const cls = src.slice(i + 1, j); i = j + 1;
      const first = cls[0] === '\\' ? cls[1] : cls[0];
      return [{ s: first === '0' && cls.includes('a-f') ? '0' : first }];
    }
    if (c === '(') {
      i++;
      if (src.startsWith('?:', i)) i += 2;
      const alts = parseAlt();
      if (src[i] !== ')') throw new Error('gate-routes: unbalanced group in ' + src);
      i++;
      return alts.map((s) => ({ s }));
    }
    i++;
    return [{ s: c }];
  };
  const out = parseAlt();
  if (i !== src.length) throw new Error('gate-routes: cannot expand ' + src);
  return out;
}
// /api/inspire/posts/1/... -> {post}; /notes/1 -> {note}; sb_000... -> {sb}
function template(p) {
  return p.replace(/\/posts\/1+(?=\/|$)/, '/posts/' + PH.post).replace(/\/notes\/1+(?=\/|$)/, '/notes/' + PH.note)
    .replace(/sb_0{32}/, PH.sb);
}

function bodyOf(src, start) {
  const a = src.indexOf(start);
  if (a < 0) throw new Error('gate-routes: not found: ' + start);
  const b = src.indexOf('\n}\n', a);
  return src.slice(a, b);
}
function routesIn(body, file) {
  const out = [];
  for (const line of body.split('\n')) {
    if (!(line.includes('/api/inspire') || line.includes('\\/api\\/inspire')) || !/method === ['"]/.test(line)) continue;
    const methods = [...line.matchAll(/method === ['"]([A-Z]+)['"]/g)].map((m) => m[1]);
    const paths = [];
    for (const m of line.matchAll(/(?:cleanPath|path) === ['"](\/api\/inspire[^'"]*)['"]/g)) paths.push(m[1]);
    for (const m of line.matchAll(/\/(\^\\\/api\\\/inspire.*?\$)\/(?=[).])/g)) paths.push(...expand(m[1]).map(template));
    if (!paths.length || !methods.length) throw new Error(`gate-routes: route line not understood (${file}): ${line.trim()}`);
    for (const p of paths) for (const meth of methods) out.push({ method: meth, path: p, file });
  }
  return out;
}

// -> [{method, path, file}] (paths with {post} / {note} / {sb} placeholders), unique, in source order
export function inspireRoutes() {
  const idx = fs.readFileSync(path.join(ROOT, 'worker/index.js'), 'utf8');
  const sb = fs.readFileSync(path.join(ROOT, 'worker/storyboard/routes.js'), 'utf8');
  const all = [
    ...routesIn(bodyOf(idx, 'async function handleInspireRoutes('), 'worker/index.js'),
    ...routesIn(bodyOf(sb, 'export async function handleStoryboard('), 'worker/storyboard/routes.js'),
  ];
  const seen = new Set();
  return all.filter((r) => { const k = r.method + ' ' + r.path; if (seen.has(k)) return false; seen.add(k); return true; });
}
// Routes open without a session (must match INSPIRE_OPEN_ROUTES in worker/index.js; the tests check both ways)
export const OPEN_ROUTES = ['GET /api/inspire/config', 'POST /api/inspire/guest', 'POST /api/inspire/login'];
export const isOpen = (r) => OPEN_ROUTES.includes(r.method + ' ' + r.path);
export const isDownload = (r) => r.method === 'GET' && /^\/api\/inspire\/posts\/\{post\}\/download$/.test(r.path);
export const fill = (p, ids) => p.replace('{post}', String(ids.post)).replace('{note}', String(ids.note)).replace('{sb}', String(ids.sb));
