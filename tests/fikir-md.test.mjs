// fikir-md.test.mjs: node tests/fikir-md.test.mjs  (safe Markdown subset of fikir.html, assets/js/fikir-md.mjs)
import assert from 'node:assert/strict';
import { parseMarkdown, parseInline, misleadingLabel } from '../assets/js/fikir-md.mjs';

let n = 0;
const ok = (m) => console.log(`ok ${++n} ${m}`);
const P = (s) => parseMarkdown(s);

// post #131 (real text): ### headings, **“…”** quotes, blank-line paragraphs, "Örneğin:" line
{
  const text = '### BTM – “Bu Dükkâna Kaç Lokum Sığar?”\n\nBTM; A, B, C ve D bloklardan oluşan bir ticaret merkezi.\n\nÖrneğin:\n\n' +
    '**“Bu dükkâna tam 134.556 adet lokum sığdı.”**\n\n### Kampanya Kurgusu\n\nVideo başlar.\n\n**134.556 ADET LOKUM**\n\nAlt mesaj:\n\n' +
    '**“Bir dükkâna bu kadar lokum sığıyorsa, sizin işinize neler sığar?”**';
  const b = P(text);
  assert.deepEqual(b.map((x) => x.t), ['h', 'p', 'p', 'p', 'h', 'p', 'p', 'p', 'p']);
  assert.deepEqual(b[0], { t: 'h', level: 3, kids: ['BTM – “Bu Dükkâna Kaç Lokum Sığar?”'] });
  assert.deepEqual(b[3].kids, [{ t: 'b', kids: ['“Bu dükkâna tam 134.556 adet lokum sığdı.”'] }]);
  assert.deepEqual(b[6].kids, [{ t: 'b', kids: ['134.556 ADET LOKUM'] }], '134.556 is not a numbered list');
  assert.deepEqual(b[8].kids, [{ t: 'b', kids: ['“Bir dükkâna bu kadar lokum sığıyorsa, sizin işinize neler sığar?”'] }]);
  ok('#131: headings, bold Turkish quotes, paragraphs, numbers with dots stay text');
}
// headings, lists, quotes, rules, line breaks
{
  const b = P('# Bir\n## İki\n#### Dört\n#etiket\n\n- a\n* b\n+ c\n• d\n\n1. bir\n2) iki\n   devam\n\n3. üç\n\n> alıntı\n> **ikinci** satır\n\n---\nsatır 1\nsatır 2');
  assert.deepEqual(b.slice(0, 3).map((x) => [x.t, x.level]), [['h', 1], ['h', 2], ['h', 3]]);
  assert.deepEqual(b[3], { t: 'p', kids: ['#etiket'] }, 'hashtag without a space is text');
  assert.deepEqual(b[4], { t: 'ul', items: [['a'], ['b'], ['c'], ['d']] });
  assert.deepEqual(b[5], { t: 'ol', start: 1, items: [['bir'], ['iki\ndevam']] });
  assert.deepEqual(b[6], { t: 'ol', start: 3, items: [['üç']] });
  assert.deepEqual(b[7], { t: 'quote', kids: ['alıntı\n', { t: 'b', kids: ['ikinci'] }, ' satır'] });
  assert.deepEqual(b[8], { t: 'hr' });
  assert.deepEqual(b[9], { t: 'p', kids: ['satır 1\nsatır 2'] });
  ok('blocks: #..### (#### -> 3), - * + • lists, 1. / 2) lists with start + continuation, > quotes, ---, line breaks');
}
// inline emphasis rules
{
  const I = parseInline;
  assert.deepEqual(I('**kalın** ve *eğik* ve _eğik_ ve __kalın__'), [{ t: 'b', kids: ['kalın'] }, ' ve ', { t: 'i', kids: ['eğik'] }, ' ve ', { t: 'i', kids: ['eğik'] }, ' ve ', { t: 'b', kids: ['kalın'] }]);
  assert.deepEqual(I('*eğik **kalın** eğik*'), [{ t: 'i', kids: ['eğik ', { t: 'b', kids: ['kalın'] }, ' eğik'] }]);
  assert.deepEqual(I('snake_case_name, 5*3*2, a * b * c, ** boş **'), ['snake_case_name, 5*3*2, a * b * c, ** boş **']);
  assert.deepEqual(I('**açık kalan'), ['**açık kalan']);
  assert.deepEqual(I('\\*yıldız\\* \\_alt\\_'), ['*yıldız* _alt_']);
  assert.deepEqual(I('<b>html</b> <img src=x onerror=alert(1)>'), ['<b>html</b> <img src=x onerror=alert(1)>'], 'HTML stays text');
  ok('inline: bold/italic (both markers), nesting, intraword and spaced markers literal, escapes, HTML stays text');
}
// links
{
  const I = parseInline;
  assert.deepEqual(I('bak: https://ornek.com/a_(b), sonra.'), ['bak: ', { t: 'a', href: 'https://ornek.com/a_(b)', kids: ['https://ornek.com/a_(b)'], bare: true }, ', sonra.']);
  assert.deepEqual(I('(https://ornek.com/x)'), ['(', { t: 'a', href: 'https://ornek.com/x', kids: ['https://ornek.com/x'], bare: true }, ')']);
  assert.deepEqual(I('[**Site**](https://ornek.com/p?q=1)'), [{ t: 'a', href: 'https://ornek.com/p?q=1', kids: [{ t: 'b', kids: ['Site'] }] }]);
  assert.deepEqual(I('[x](javascript:alert(1)) [y](ftp://a.b) ![resim](https://ornek.com/a.png)'),
    ['[x](javascript:alert(1)) [y](ftp://a.b) ![resim](', { t: 'a', href: 'https://ornek.com/a.png', kids: ['https://ornek.com/a.png'], bare: true }, ')'],
    'only http(s) links; images are not rendered');
  const hasLink = (kids) => kids.some((k) => typeof k !== 'string' && (k.t === 'a' || hasLink(k.kids)));
  assert.ok(I('[a [b](https://x.com/1)](https://x.com/2) [**c https://x.com/3**](https://x.com/4)').every((k) => typeof k === 'string' || k.t !== 'a' || !hasLink(k.kids)), 'no links inside links');
  assert.deepEqual(I('xhttps://ornek.com'), ['xhttps://ornek.com'], 'URL glued to a word stays text');
  assert.deepEqual(I('**https://ornek.com/a**'), [{ t: 'b', kids: [{ t: 'a', href: 'https://ornek.com/a', kids: ['https://ornek.com/a'], bare: true }] }]);
  ok('links: bare URLs (trailing punctuation trimmed, balanced parens kept), [text](url) with emphasis, only http(s), no images/nesting');
}
// masked links: a text that names another host shows the real destination (like a bare URL)
{
  const I = parseInline;
  const bare = (href) => ({ t: 'a', href, kids: [href], bare: true });
  assert.deepEqual(I('[https://velikesgin.com/fikir/giris](https://evil.example/login)'), [bare('https://evil.example/login')]);
  for (const label of ['velikesgin.com', '**velikesgin.com**', 'bilgi@velikesgin.com', 'Giriş: www.velikesgin.com/fikir', 'sub.example.com']) {
    assert.ok(misleadingLabel(label, label === 'sub.example.com' ? 'https://example.com/' : 'https://evil.example/x'), label);
  }
  for (const [label, href] of [['rapor', 'https://example.com/rapor'], ['velikesgin.com', 'https://www.velikesgin.com/fikir'],
    ['Kaynak: news.example.net', 'https://news.example.net/a'], ['example.com', 'https://sub.example.com/a'],
    ['WWW.Example.COM:443', 'https://example.com/'], ['(örnek.com)', 'https://xn--rnek-4qa.com/'], ['134.556 adet', 'https://x.com/'],
    ['Örn.: bak', 'https://x.com/'], ['e.g. bu', 'https://x.com/']]) {
    assert.equal(misleadingLabel(label, href), false, label);
  }
  assert.ok(misleadingLabel('örnek.com', 'https://ornek.com/'), 'IDN look-alike');
  assert.deepEqual(I('[**velikesgin.com**](https://www.velikesgin.com/fikir)'), [{ t: 'a', href: 'https://www.velikesgin.com/fikir', kids: [{ t: 'b', kids: ['velikesgin.com'] }] }]);
  ok('masked links: a [text](url) naming another host renders as the bare destination URL; same host / subdomain / plain words keep the text');
}
// robustness
{
  assert.deepEqual(P(''), []); assert.deepEqual(P(null), []); assert.deepEqual(P('\n\n  \n'), []);
  assert.deepEqual(P('a\r\nb'), [{ t: 'p', kids: ['a\nb'] }]);
  const t0 = Date.now();
  P('*'.repeat(2000)); P('_a '.repeat(700)); P('**a '.repeat(600)); P('[a](' + 'h'.repeat(1990));
  assert.ok(Date.now() - t0 < 1500, 'pathological inputs stay fast');
  ok('robust: empty/null, CRLF, pathological marker runs are fast');
}
console.log(`all ${n} markdown tests passed`);
