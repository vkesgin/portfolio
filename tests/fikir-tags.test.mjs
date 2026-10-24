// fikir-tags.test.mjs: company tag rules shared by the board and the worker (assets/js/fikir-tags.mjs). Pure, no DOM.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  TAG_NAME_MAX, TAG_COLORS, TAG_FILTER_MAX, UNTAGGED_TOKEN, cleanTagName, checkTagName, tagFold, tagSlugBase, tagDefaultColor, tagMatches,
  parseFilterQuery, filterQueryString, tagFilterApiQuery, filterActive,
} from '../assets/js/fikir-tags.mjs';

const F = (ids = [], all = false, untagged = false) => ({ ids: new Set(ids), all, untagged });
const P = (...ids) => ({ tags: ids.map((id) => ({ id })) });

describe('fikir-tags (shared module)', () => {
  test('tagFold: Turkish case / İ ı / diacritics / spacing insensitive', () => {
    const combining = 'Sayi' + String.fromCharCode(0x0306) + 'n';   // a combining breve typed after the i
    for (const s of ['Sayın', 'SAYIN', 'sayin', 'SAYİN', ' sayın ', 'Sayın'.normalize('NFD'), combining, 'sAyIn']) assert.equal(tagFold(s), 'sayin', JSON.stringify(s));
    for (const s of ['İstanbul', 'ISTANBUL', 'istanbul', 'İSTANBUL']) assert.equal(tagFold(s), 'istanbul', s);
    assert.equal(tagFold('Çağ Ğüş'), 'cag gus');
    assert.equal(tagFold('İstanbul Yapı'), tagFold('istanbul-yapi'));
    assert.equal(tagFold('İstanbul Yapı'), 'istanbul yapi');
    assert.equal(tagFold('  A  --  B!!c  '), 'a b c', 'punctuation and space runs collapse');
    assert.equal(tagFold('Sayın-Gayrimenkul'), tagFold('Sayın Gayrimenkul'));
    assert.notEqual(tagFold('A1'), tagFold('Ai'), 'no look-alike folding (unlike inspireFoldName)');
    assert.equal(tagFold('ＡＢＣ'), 'abc', 'full-width letters (NFKD)');
    assert.equal(tagFold(null), '');
  });

  test('cleanTagName / checkTagName: bidi, controls, zero-width, length in code points, reserved, empty', () => {
    const RLO = String.fromCharCode(0x202e), ZW = String.fromCharCode(0x200b), BOM = String.fromCharCode(0xfeff);
    assert.equal(cleanTagName(`Say${RLO}ın${ZW}${BOM}`), 'Sayın');
    assert.equal(cleanTagName('A\tB\n' + String.fromCharCode(7) + 'C'), 'A B C');
    assert.equal(cleanTagName('  çok    boşluk  '), 'çok boşluk');
    assert.equal(cleanTagName(42), '');
    const emoji39 = 'A' + '😀'.repeat(TAG_NAME_MAX - 1);   // 40 code points, 79 UTF-16 units
    assert.deepEqual(checkTagName(emoji39), { name: emoji39, fold: 'a' }, 'length counts code points: 40 pass');
    assert.equal(checkTagName(emoji39 + '😀').error, 'name_too_long', '41 code points fail');
    assert.equal(checkTagName('a'.repeat(TAG_NAME_MAX)).name, 'a'.repeat(TAG_NAME_MAX), '40 characters pass');
    assert.equal(checkTagName('ş'.repeat(TAG_NAME_MAX)).name.length, TAG_NAME_MAX, '40 Turkish letters pass');
    assert.equal(checkTagName('a'.repeat(TAG_NAME_MAX + 1)).error, 'name_too_long');
    assert.equal(checkTagName('😀'.repeat(TAG_NAME_MAX + 1)).error, 'name_too_long', '41 emoji');
    for (const r of ['Firmasız', 'FİRMASIZ', 'tümü', 'Tüm', 'Hepsi', 'herhangi', 'Herhangi biri', ' herhangi-biri ']) assert.equal(checkTagName(r).error, 'reserved_name', r);
    for (const e of ['', '   ', RLO + ZW, null, undefined, 7]) assert.equal(checkTagName(e).error, 'empty_name', JSON.stringify(e));
    assert.equal(checkTagName('!!!').error, 'invalid_name');
    assert.equal(checkTagName('😀😀').error, 'invalid_name', 'emoji only: no letter or digit to dedupe on');
    assert.match(checkTagName('').message, /boş/);
    assert.deepEqual(checkTagName(' Sayın  Gayrimenkul '), { name: 'Sayın Gayrimenkul', fold: 'sayin gayrimenkul' });
  });

  test('invisible / blank characters: never a second "Sayın", never a blank company (picker, server dedupe and filter agree)', () => {
    const c = (...cps) => String.fromCodePoint(...cps);
    // joiners, soft hyphen, bidi mark, grapheme joiner, Mongolian separator inside a name: removed, not a word break
    for (const cp of [0x200d, 0x200c, 0x00ad, 0x061c, 0x034f, 0x180e, 0x2060, 0xfeff, 0x200b]) {
      const v = 'Say' + c(cp) + 'ın';
      assert.equal(tagFold(v), 'sayin', 'U+' + cp.toString(16));
      assert.deepEqual(checkTagName(v), { name: 'Sayın', fold: 'sayin' }, 'U+' + cp.toString(16));
    }
    assert.deepEqual(checkTagName('Gayri' + c(0xad) + 'menkul'), { name: 'Gayrimenkul', fold: 'gayrimenkul' }, 'a soft hyphen from copied web text');
    // Hangul fillers count as letters (\p{L}): a name of only them is refused, inside a name they vanish
    for (const v of [c(0x3164), c(0x115f), c(0x1160), c(0xffa0), c(0x3164, 0x3164), ' ' + c(0x3164) + ' ']) {
      assert.ok(checkTagName(v).error, JSON.stringify(v));
      assert.equal(tagFold(v), '', JSON.stringify(v));
    }
    assert.equal(tagFold('Sa' + c(0x3164) + 'yın'), 'sayin');
    // the fold alone (a name stored before cleaning, a picker query) drops every default-ignorable / format character too
    assert.equal(tagFold('Say' + c(0x200d) + 'ın' + c(0xe0001) + c(0xfe0f)), 'sayin');
    // stacked combining marks ("Zalgo") are refused; ordinary accents pass
    assert.equal(checkTagName('Sa' + c(0x0301, 0x0302, 0x0303, 0x0304) + 'yın').error, 'invalid_chars');
    assert.equal(checkTagName('Ç' + c(0x0327) + 'ağ').name, 'Ç' + c(0x0327) + 'ağ', 'two marks still pass');
    assert.equal(checkTagName('Café Señor').fold, 'cafe senor');
    assert.match(checkTagName('Sa' + c(0x0301, 0x0302, 0x0303, 0x0304) + 'yın').message, /işaret/);
    // emoji with variation selector keep their display form
    assert.equal(checkTagName('❤️ Sevgi').name, '❤️ Sevgi');
  });

  test('tagSlugBase / tagDefaultColor', () => {
    assert.equal(tagSlugBase(tagFold('Sayın Gayrimenkul')), 'sayin-gayrimenkul');
    assert.equal(tagSlugBase(tagFold('Çağ & Ğüş A.Ş.')), 'cag-gus-a-s');
    assert.equal(tagSlugBase(tagFold('Москва')), 'firma', 'Cyrillic only');
    assert.equal(tagSlugBase(tagFold('Ак Ltd')), 'ltd');
    assert.equal(tagSlugBase(''), 'firma');
    const long = tagSlugBase(tagFold('abcdefghij '.repeat(8)));
    assert.ok(long.length <= 48 && !long.endsWith('-'), long);
    assert.equal(tagSlugBase(tagFold('firmasiz ж')), 'firmasiz-firma', 'never the untagged token');
    assert.notEqual(tagSlugBase(tagFold('firmasiz ж')), UNTAGGED_TOKEN);
    for (const n of ['Sayın', 'Gayrimenkul', 'Москва', 'x', '']) {
      const c = tagDefaultColor(tagFold(n));
      assert.ok(TAG_COLORS.includes(c), c);
      assert.equal(tagDefaultColor(tagFold(n)), c, 'deterministic');
    }
    assert.ok(new Set(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'].map(tagDefaultColor)).size > 2, 'spread over the palette');
  });

  test('tagMatches: any, all, untagged, untagged OR any, no filter, posts without tags', () => {
    const a = P(1), ab = P(1, 2), c = P(3), none = P(), bare = {};
    assert.ok([a, ab, c, none, bare].every((p) => tagMatches(p, F())), 'no filter: everything');
    assert.ok([a, ab, c, none].every((p) => tagMatches(p, null)));
    assert.deepEqual([a, ab, c, none, bare].map((p) => tagMatches(p, F([1, 2]))), [true, true, false, false, false], 'any');
    assert.deepEqual([a, ab, c, none, bare].map((p) => tagMatches(p, F([1, 2], true))), [false, true, false, false, false], 'all');
    assert.deepEqual([a, ab, c, none, bare].map((p) => tagMatches(p, F([], false, true))), [false, false, false, true, true], 'untagged');
    assert.deepEqual([a, ab, c, none, bare].map((p) => tagMatches(p, F([3], false, true))), [false, false, true, true, true], 'untagged OR any');
    assert.deepEqual([a, ab, c, none].map((p) => tagMatches(p, F([1], true, true))), [true, true, false, true], 'untagged OR all');
    assert.ok(tagMatches({ tags: [{ id: '2' }] }, F([2])), 'string ids from JSON still compare');
    assert.equal(filterActive(F()), false); assert.equal(filterActive(F([], true)), false); assert.equal(filterActive(F([], false, true)), true);
  });

  test('parseFilterQuery / filterQueryString: round trip, unknown slugs dropped, firmasiz, eslesme', () => {
    const tags = [{ id: 4, slug: 'sayin' }, { id: 9, slug: 'gayrimenkul' }, { id: 12, slug: 'firma-12' }];
    const bySlug = new Map(tags.map((t) => [t.slug, t])), byId = new Map(tags.map((t) => [t.id, t]));
    let f = parseFilterQuery('?firma=sayin,gayrimenkul&eslesme=hepsi', bySlug);
    assert.deepEqual([[...f.ids], f.all, f.untagged, f.dropped], [[4, 9], true, false, false]);
    assert.equal(filterQueryString(f, byId), 'firma=sayin,gayrimenkul&eslesme=hepsi');
    assert.deepEqual(parseFilterQuery('?' + filterQueryString(f, byId), bySlug), f, 'round trip');
    f = parseFilterQuery('?firma=sayin,firmasiz', bySlug);
    assert.deepEqual([[...f.ids], f.all, f.untagged, f.dropped], [[4], false, true, false]);
    assert.equal(filterQueryString(f, byId), 'firma=sayin,firmasiz');
    f = parseFilterQuery('?firma=sayin&eslesme=herhangi', bySlug);
    assert.deepEqual([[...f.ids], f.all, f.dropped], [[4], false, false], 'herhangi = the default');
    f = parseFilterQuery('?firma=eski-ad,sayin,SAYIN', bySlug);
    assert.deepEqual([[...f.ids], f.dropped], [[4], true], 'unknown slug dropped (rewrite the URL); duplicates once; case-insensitive');
    f = parseFilterQuery('?firma=sayin&eslesme=yanlis', bySlug);
    assert.deepEqual([f.all, f.dropped], [false, true]);
    f = parseFilterQuery('?api=http://127.0.0.1:8851', bySlug);
    assert.deepEqual([f.ids.size, f.untagged, f.dropped, filterQueryString(f, byId)], [0, false, false, ''], 'no filter params');
    f = parseFilterQuery('?firma=firmasiz&eslesme=hepsi', bySlug);
    assert.deepEqual([f.all, f.untagged, filterQueryString(f, byId)], [false, true, 'firma=firmasiz'], 'hepsi needs companies');
    assert.equal(parseFilterQuery('firma=sayin', { sayin: 4 }).ids.has(4), true, 'plain object / id values');
    const many = Array.from({ length: 30 }, (_, i) => ({ id: i + 1, slug: 's' + i }));
    assert.equal(parseFilterQuery('?firma=' + many.map((t) => t.slug).join(','), new Map(many.map((t) => [t.slug, t]))).ids.size, TAG_FILTER_MAX);
    assert.equal(filterQueryString(F([4, 99]), byId), 'firma=sayin', 'an id the catalog no longer has is left out');
  });

  test('tagFilterApiQuery: the GET /posts filter of a board filter', () => {
    assert.equal(tagFilterApiQuery(F()), '');
    assert.equal(tagFilterApiQuery(F([1, 2], true)), 'tags=1,2&match=all&untagged=0');
    assert.equal(tagFilterApiQuery(F([3])), 'tags=3&match=any&untagged=0');
    assert.equal(tagFilterApiQuery(F([], false, true)), 'match=any&untagged=1');
  });
});
