/* fikir-md.mjs: a small, safe Markdown subset for Fikir Havuzu idea texts and link descriptions (fikir.html).
 *
 *   parseMarkdown(text)       -> blocks (plain objects; no HTML anywhere, so it runs and is tested in node)
 *   renderMarkdown(blocks, h) -> DocumentFragment built with fikir.html's h() (text nodes only; href passes safeHttpUrl)
 *
 * Supported: # / ## / ### headings (####+ shown like ###), paragraphs (single line breaks kept), - * + • bullet lists,
 * 1. / 1) numbered lists, > quotes, --- rules, **bold** / __bold__, *italic* / _italic_, [text](https://…) links and bare
 * http(s) URLs. Everything else (HTML, images, code, tables …) stays plain text exactly as typed. A [text](url) whose text
 * names another host than the link's ("[velikesgin.com/giris](https://evil.example)") is shown like a bare URL: the reader
 * always sees the real destination (touch screens have no hover title).
 */

const MAX_DEPTH = 4;   // nested emphasis levels; deeper markers stay literal
const ESCAPABLE = new Set(['\\', '*', '_', '[', ']', '(', ')', '#', '>', '-', '+', '.', '!', '`', '~', '|']);
const WORD = /[\p{L}\p{N}]/u;
const LINK_RE = /^\[([^\]\n]{1,300})\]\((https?:\/\/[^\s()<>]{1,2000})\)/i;
const URL_RE = /^https?:\/\/[^\s<>"“”‘’«»]{1,2000}/i;
const URL_TRAIL_CH = '.,;:!?…\'"”’»)]}*_';

const isUrl = (v) => { try { const u = new URL(v); return u.protocol === 'http:' || u.protocol === 'https:'; } catch (_) { return false; } };
const isWord = (ch) => !!ch && WORD.test(ch);
const isSpace = (ch) => !ch || /\s/.test(ch);

/* ------------------------------------------------------------------ inline */
// Inline = string | { t: 'b' | 'i', kids: Inline[] } | { t: 'a', href, kids: Inline[], bare?: true }
export function parseInline(s, depth = 0, noLinks = false) {
  const out = [];
  let buf = '';
  const flush = () => { if (buf) { out.push(buf); buf = ''; } };
  let i = 0;
  while (i < s.length) {
    const c = s[i];
    if (c === '\\' && ESCAPABLE.has(s[i + 1])) { buf += s[i + 1]; i += 2; continue; }
    if (!noLinks && c === '[' && s[i - 1] !== '!') {   // ![image](…) is not a link: stays literal
      const m = LINK_RE.exec(s.slice(i, i + 2400));
      if (m && isUrl(m[2])) {
        flush();
        out.push(misleadingLabel(m[1], m[2]) ? { t: 'a', href: m[2], kids: [m[2]], bare: true }
          : { t: 'a', href: m[2], kids: parseInline(m[1], depth + 1, true) });   // emphasis inside, no nested links
        i += m[0].length;
        continue;
      }
    }
    if (!noLinks && (c === 'h' || c === 'H') && !isWord(s[i - 1]) && s[i - 1] !== '/') {
      const m = URL_RE.exec(s.slice(i, i + 2100));
      if (m) {
        const url = trimUrl(m[0]);
        if (url.length > 10 && isUrl(url)) {
          flush();
          out.push({ t: 'a', href: url, kids: [url], bare: true });
          i += url.length;
          continue;
        }
      }
    }
    if ((c === '*' || c === '_') && depth < MAX_DEPTH) {
      const dbl = s[i + 1] === c;
      const mark = dbl ? c + c : c;
      const end = findClose(s, i, mark);
      if (end > 0) {
        flush();
        out.push({ t: dbl ? 'b' : 'i', kids: parseInline(s.slice(i + mark.length, end), depth + 1, noLinks) });
        i = end + mark.length;
        continue;
      }
      // an unmatched run of markers stays literal as a whole ("***", "5*3*2")
      let j = i;
      while (s[j] === c) j++;
      buf += s.slice(i, j);
      i = j;
      continue;
    }
    buf += c;
    i++;
  }
  flush();
  return out;
}

// Whether a link text names a host (a URL, "site.com", "ad@site.com") other than the link's own host or a parent domain
// of it ("example.com" for https://sub.example.com is fine). Hosts compare normalised (lower case, IDN -> punycode, no www.).
const LABEL_TRIM_L = /^[([{"'“‘«*_<]+/;
const LABEL_TRIM_R = /[)\]}"'”’»*_>.,;:!?…]+$/;
const HOSTLIKE = /^(?:[\p{L}\p{N}](?:[\p{L}\p{N}-]*[\p{L}\p{N}])?\.)+[a-z]{2,24}$/iu;
const normHost = (x) => x.toLowerCase().replace(/^www\./, '');
export function misleadingLabel(label, href) {
  let host;
  try { host = normHost(new URL(href).hostname); } catch (_) { return true; }
  for (const word of String(label).split(/\s+/)) {
    let tok = word.replace(LABEL_TRIM_L, '').replace(/^[a-z][a-z0-9+.-]*:\/\//i, '').split(/[/?#]/)[0];
    tok = tok.slice(tok.lastIndexOf('@') + 1).replace(/:\d*$/, '').replace(LABEL_TRIM_R, '');
    if (!HOSTLIKE.test(tok)) continue;
    let named;
    try { named = normHost(new URL('http://' + tok).hostname); } catch (_) { continue; }
    if (named !== host && !host.endsWith('.' + named)) return true;
  }
  return false;
}

// Sentence punctuation after a bare URL is not part of it; a ")" stays while the URL has an unmatched "(" (Wikipedia).
function trimUrl(url) {
  const count = (ch) => url.split(ch).length - 1;
  while (url.length) {
    const last = url[url.length - 1];
    if (last === ')' && count(')') <= count('(')) break;
    if (!URL_TRAIL_CH.includes(last)) break;
    url = url.slice(0, -1);
  }
  return url;
}

// Closing marker for an emphasis run opened at `at`: the text inside must not start or end with a space, `_` (and single
// `*`) do not open/close inside words (snake_case, 5*3*2), and a single marker never matches half of a double one.
function findClose(s, at, mark) {
  const c = mark[0];
  const n = mark.length;
  const after = s[at + n];
  if (isSpace(after) || after === c) return -1;
  if (isWord(s[at - 1]) && (c === '_' || n === 1)) return -1;
  for (let j = at + n + 1; j <= s.length - n; j++) {
    if (s[j] === '\\') { j++; continue; }
    if (s.slice(j, j + n) !== mark) continue;
    if (n === 1 && (s[j + 1] === c || s[j - 1] === c)) { // part of a "**" inside: skip the whole run
      while (s[j + 1] === c) j++;
      continue;
    }
    if (n === 2 && s[j + 2] === c) continue;          // "***": let the last two close
    if (isSpace(s[j - 1])) continue;
    if ((c === '_' || n === 1) && isWord(s[j + n])) continue;
    return j;
  }
  return -1;
}

/* ------------------------------------------------------------------ blocks */
// Block = { t: 'h', level: 1..3, kids } | { t: 'p', kids } | { t: 'quote', kids } | { t: 'hr' }
//       | { t: 'ul', items: Inline[][] } | { t: 'ol', start, items: Inline[][] }
// Paragraph / quote / list-item text keeps its single line breaks as '\n' inside the strings (rendered as <br>).
const H_RE = /^ {0,3}(#{1,6})[ \t]+(.+?)(?:[ \t]+#+)?[ \t]*$/;
const HR_RE = /^ {0,3}([-*_])(?:[ \t]*\1){2,}[ \t]*$/;
const QUOTE_RE = /^ {0,3}>[ \t]?(.*)$/;
const UL_RE = /^[ \t]{0,6}[-*+•][ \t]+(.*)$/;
const OL_RE = /^[ \t]{0,6}(\d{1,3})[.)][ \t]+(.*)$/;

export function parseMarkdown(text) {
  const lines = String(text == null ? '' : text).replace(/\r\n?/g, '\n').split('\n');
  const blocks = [];
  let cur = null;   // open paragraph / quote / list
  const close = () => {
    if (!cur) return;
    if (cur.t === 'p' || cur.t === 'quote') blocks.push({ t: cur.t, kids: parseInline(cur.lines.join('\n')) });
    else blocks.push({ ...(cur.t === 'ol' ? { t: 'ol', start: cur.start } : { t: 'ul' }), items: cur.items.map((it) => parseInline(it.join('\n'))) });
    cur = null;
  };
  for (const raw of lines) {
    const line = raw.replace(/\s+$/, '');
    if (!line.trim()) { close(); continue; }
    let m;
    if ((m = H_RE.exec(line))) { close(); blocks.push({ t: 'h', level: Math.min(3, m[1].length), kids: parseInline(m[2]) }); continue; }
    if (HR_RE.test(line)) { close(); blocks.push({ t: 'hr' }); continue; }
    if ((m = QUOTE_RE.exec(line))) {
      if (!cur || cur.t !== 'quote') { close(); cur = { t: 'quote', lines: [] }; }
      cur.lines.push(m[1]);
      continue;
    }
    if ((m = UL_RE.exec(line))) {
      if (!cur || cur.t !== 'ul') { close(); cur = { t: 'ul', items: [] }; }
      cur.items.push([m[1]]);
      continue;
    }
    if ((m = OL_RE.exec(line))) {
      if (!cur || cur.t !== 'ol') { close(); cur = { t: 'ol', start: Number(m[1]), items: [] }; }
      cur.items.push([m[2]]);
      continue;
    }
    if (cur && (cur.t === 'ul' || cur.t === 'ol') && /^[ \t]{2,}\S/.test(raw)) {   // indented continuation of a list item
      cur.items[cur.items.length - 1].push(line.trim());
      continue;
    }
    if (!cur || cur.t !== 'p') { close(); cur = { t: 'p', lines: [] }; }
    cur.lines.push(line.replace(/^[ \t]+/, ''));
  }
  close();
  return blocks;
}

/* ------------------------------------------------------------------ DOM */
// h: fikir.html's element builder (text nodes only; href/src must pass safeHttpUrl, otherwise the attribute is dropped).
const H_TAG = { 1: 'h4', 2: 'h5', 3: 'h6' };
function shortUrl(url) {
  try {
    const u = new URL(url);
    let p = u.pathname + u.search;
    try { p = decodeURIComponent(p); } catch (_) { /* keep raw */ }
    const s = u.hostname.replace(/^www\./, '') + (p === '/' ? '' : p.replace(/\/$/, ''));
    return s.length > 48 ? s.slice(0, 47) + '…' : s;
  } catch (_) { return url; }
}
function renderInline(kids, h) {
  const out = [];
  for (const k of kids) {
    if (typeof k === 'string') {
      const parts = k.split('\n');
      parts.forEach((p, i) => { if (i) out.push(h('br')); if (p) out.push(p); });
    } else if (k.t === 'b') out.push(h('strong', null, renderInline(k.kids, h)));
    else if (k.t === 'i') out.push(h('em', null, renderInline(k.kids, h)));
    else if (k.t === 'a') {
      const a = h('a', { href: k.href, target: '_blank', rel: 'noopener noreferrer nofollow ugc', title: k.href, translate: k.bare ? 'no' : null },
        k.bare ? shortUrl(k.href) : renderInline(k.kids, h));
      if (!a.hasAttribute('href')) out.push(...renderInline(k.kids, h));   // refused by safeHttpUrl: plain text
      else out.push(a);
    }
  }
  return out;
}
export function renderMarkdown(blocks, h) {
  const frag = document.createDocumentFragment();
  for (const b of blocks) {
    if (b.t === 'h') frag.append(h(H_TAG[b.level] || 'h6', { class: `md-h md-h${b.level}` }, renderInline(b.kids, h)));
    else if (b.t === 'p') frag.append(h('p', null, renderInline(b.kids, h)));
    else if (b.t === 'quote') frag.append(h('blockquote', null, renderInline(b.kids, h)));
    else if (b.t === 'hr') frag.append(h('hr'));
    else if (b.t === 'ul' || b.t === 'ol') {
      frag.append(h(b.t, b.t === 'ol' && b.start !== 1 ? { start: b.start } : null, b.items.map((it) => h('li', null, renderInline(it, h)))));
    }
  }
  return frag;
}
