// Company tags ("Firma") of board posts (worker/inspire-tags.js + worker/index.js), in the Node harness (tests/cron-harness.mjs:
// in-memory D1, fake network; nothing leaves the machine). TEST values only (harness-board-pass, harness-admin).
//   schema        additive tables + index, probe-only cold isolates, the cron never migrates
//   POST /tags    create / Turkish case-insensitive dedupe / invisible characters / validation / rate limits / catalog cap
//                 (the admin exempt) / unused companies per creator / slug collisions; DELETE /tags/unused (admin)
//   tagsOut       sorted on the stored fold (CPU of a 200 x 10 tags page)
//   GET /tags     counts (live rows only), untagged / total, order, can_manage
//   POST /posts   tag_ids; PUT /posts/:id/tags (owner / admin); PUT + DELETE /tags/:id (admin); DELETE /posts/:id
//   GET /posts    tags / can_tag, legacy clients, ?tags=&match=&untagged= with paging, notes and live facts of the page, budgets
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import * as H from './cron-harness.mjs';
import { tagsOut } from '../worker/inspire-tags.js';

const call = async (w, iso, method, path, opts = {}) => {
  const m = await H.runRequest(w, iso, method, path, opts);
  return { ...m.result, m };
};
const guestId = (w) => H.sqlAll(w, "SELECT id FROM inspire_users WHERE username='__guest__'")[0].id;
const seedText = (w, cid = 'harness-cid-0001', text = 'x') => Number(H.sqlRun(w,
  "INSERT INTO inspire_posts (user_id, type, url, description, client_id) VALUES (?, 'text', '', ?, ?)", guestId(w), text, cid).lastInsertRowid);
const seedTag = (w, name, fold, slug, color = 'cyan') => Number(H.sqlRun(w,
  'INSERT INTO inspire_tags (name, fold, slug, color, created_by, created_at) VALUES (?, ?, ?, ?, NULL, 1)', name, fold, slug, color).lastInsertRowid);
const link = (w, post, tag) => H.sqlRun(w, 'INSERT OR IGNORE INTO inspire_post_tags (post_id, tag_id, created_at) VALUES (?, ?, 1)', post, tag);
const tagsOf = (w, post) => H.sqlAll(w, 'SELECT tag_id FROM inspire_post_tags WHERE post_id=? ORDER BY tag_id', post).map((r) => r.tag_id);
async function userToken(w, iso, username = 'firma-kayitli') {
  H.sqlRun(w, "INSERT OR IGNORE INTO inspire_users (username, password, full_name, is_first_login) VALUES (?, 'firma-user-pass', 'Kayıtlı', 0)", username);
  const r = await call(w, iso, 'POST', '/api/inspire/login', { body: { username, password: 'firma-user-pass' }, ip: '198.51.100.40' });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  return r.json.token;
}

describe('company tags (worker, Node harness)', { skip: !H.HARNESS_SUPPORTED && 'needs node:module registerHooks (Node >= 22.15)' }, () => {
  test('schema: the first request creates both tables + the index; a cold isolate then costs one probe; the cron never migrates', async () => {
    const { w, warm } = await H.readyWorld();
    const names = H.sqlAll(w, "SELECT name FROM sqlite_master WHERE name IN ('inspire_tags', 'inspire_post_tags', 'idx_inspire_post_tags_tag')").map((r) => r.name).sort();
    assert.deepEqual(names, ['idx_inspire_post_tags_tag', 'inspire_post_tags', 'inspire_tags']);
    const tok = await H.guestToken(w, warm);
    const cold = await call(w, await H.loadIsolate(), 'GET', '/api/inspire/tags', { token: tok });
    assert.equal(cold.status, 200);
    assert.ok(!cold.m.sql.some((q) => /^(CREATE|ALTER)\b/i.test(q)), cold.m.sql.join('\n'));
    assert.ok(cold.m.d1 <= 6, `cold GET /tags: ${cold.m.d1} statements`);
    // an existing board (before this release): the tables are missing; the cron skips, the board's next request migrates
    // additively and every post stays
    const post = seedText(w, 'harness-cid-0001', 'eski fikir');
    for (const t of ['inspire_post_tags', 'inspire_tags']) H.sqlRun(w, `DROP TABLE ${t}`);
    const cron = await H.runScheduled(w, await H.loadIsolate(), H.CRON_MAIN);
    assert.ok(!cron.sql.some((q) => /^(CREATE|ALTER)\b/i.test(q)), 'the cron issues no CREATE / ALTER');
    assert.ok(cron.lines.some((l) => /schema incomplete/.test(l[1])), 'cron skipped');
    const again = await call(w, await H.loadIsolate(), 'GET', '/api/inspire/posts', { token: tok });
    assert.equal(again.status, 200);
    assert.ok(again.m.d1 <= 40 && again.m.sub === 0, `the upgrading request: ${again.m.d1} statements`);
    assert.ok(again.m.sql.some((q) => /CREATE TABLE IF NOT EXISTS inspire_tags/.test(q)), 'it migrated');
    const p = again.json.find((x) => x.id === post);
    assert.ok(p && p.description === 'eski fikir'); assert.deepEqual(p.tags, []);
    assert.equal(H.sqlAll(w, "SELECT COUNT(*) AS n FROM sqlite_master WHERE name IN ('inspire_tags', 'inspire_post_tags', 'idx_inspire_post_tags_tag')")[0].n, 3);
    const fresh = H.makeWorld();
    const first = await call(fresh, await H.loadIsolate(), 'GET', '/api/inspire/config');
    assert.equal(first.status, 200);
    assert.ok(first.m.d1 <= 50, `a fresh database's first request: ${first.m.d1} statements (Free: 50)`);
  });

  test('POST /tags: 201, then 200 created:false for every Turkish case / diacritics variant; validation; created_by never leaves', async () => {
    const { w, warm } = await H.readyWorld();
    const tok = await H.guestToken(w, warm, 'firma-guest-cid-0001');
    const a = await call(w, warm, 'POST', '/api/inspire/tags', { token: tok, body: { name: '  Sayın ' } });
    assert.equal(a.status, 201, JSON.stringify(a.json));
    assert.equal(a.json.created, true);
    const t = a.json.tag;
    assert.deepEqual(Object.keys(t).sort(), ['color', 'id', 'name', 'slug']);
    assert.deepEqual([t.name, t.slug], ['Sayın', 'sayin']);
    for (const v of ['SAYIN', 'sayin', 'SAYİN', ' sayın ', 'Sayın'.normalize('NFD'), 'sAyIn!']) {
      const r = await call(w, warm, 'POST', '/api/inspire/tags', { token: tok, body: { name: v } });
      assert.equal(r.status, 200, v); assert.equal(r.json.created, false); assert.deepEqual(r.json.tag, t, v);
    }
    for (const [name, code] of [['Firmasız', 'reserved_name'], ['TÜMÜ', 'reserved_name'], ['Hepsi', 'reserved_name'], ['', 'empty_name'],
      ['   ', 'empty_name'], ['x'.repeat(41), 'name_too_long'], ['!!!', 'invalid_name'], [null, 'empty_name'], [12, 'empty_name']]) {
      const r = await call(w, warm, 'POST', '/api/inspire/tags', { token: tok, body: { name } });
      assert.equal(r.status, 400, String(name)); assert.equal(r.json.error, code, String(name)); assert.ok(r.json.message);
    }
    // invisible characters never make a look-alike second "Sayın" or a blank company
    for (const cp of [0x200d, 0x200c, 0x00ad, 0x061c]) {
      const r = await call(w, warm, 'POST', '/api/inspire/tags', { token: tok, body: { name: 'Say' + String.fromCodePoint(cp) + 'ın' } });
      assert.equal(r.status, 200, 'U+' + cp.toString(16)); assert.deepEqual(r.json.tag, t);
    }
    for (const cp of [0x3164, 0x115f, 0xffa0]) {
      const r = await call(w, warm, 'POST', '/api/inspire/tags', { token: tok, body: { name: String.fromCodePoint(cp) } });
      assert.equal(r.status, 400, 'U+' + cp.toString(16));
    }
    assert.equal(H.sqlAll(w, 'SELECT COUNT(*) AS n FROM inspire_tags')[0].n, 1);
    const RLO = String.fromCharCode(0x202e);
    const b = await call(w, warm, 'POST', '/api/inspire/tags', { token: tok, body: { name: `Gayri${RLO}menkul`, color: 'violet' } });
    assert.equal(b.status, 201); assert.equal(b.json.tag.name, 'Gayrimenkul'); assert.equal(b.json.tag.color, 'violet');
    const c = await call(w, warm, 'POST', '/api/inspire/tags', { token: tok, body: { name: 'Renk', color: 'url(x)' } });
    assert.ok(['cyan', 'blue', 'violet', 'pink', 'red', 'orange', 'amber', 'lime', 'green', 'teal'].includes(c.json.tag.color), 'a bad color: the default');
    const xss = '<img src=x onerror=alert(1)>';
    const x = await call(w, warm, 'POST', '/api/inspire/tags', { token: tok, body: { name: xss } });
    assert.equal(x.status, 201); assert.equal(x.json.tag.name, xss, 'stored and returned as plain JSON text');
    assert.match(x.headers['content-type'], /^application\/json/);
    // slug collisions: two names without Latin letters share the base
    const k1 = await call(w, warm, 'POST', '/api/inspire/tags', { token: tok, body: { name: 'Москва' } });
    const k2 = await call(w, warm, 'POST', '/api/inspire/tags', { token: tok, body: { name: 'Киев' } });
    assert.equal(k1.json.tag.slug, 'firma');
    assert.equal(k2.json.tag.slug, 'firma-' + k2.json.tag.id);
    assert.ok(H.sqlAll(w, "SELECT COUNT(*) AS n FROM inspire_tags WHERE slug LIKE '%~new'")[0].n === 0, 'no temporary slug left');
    const list = await call(w, warm, 'GET', '/api/inspire/tags', { token: tok });
    for (const r of [a, b, k1, list]) {
      assert.ok(!r.text().includes('created_by') && !r.text().includes('firma-guest-cid-0001'), 'the creator never leaves the server');
    }
    assert.equal(H.sqlAll(w, 'SELECT created_by FROM inspire_tags WHERE id=?', t.id)[0].created_by, 'c:firma-guest-cid-0001');
    assert.equal((await call(w, warm, 'POST', '/api/inspire/tags', { body: { name: 'Yok' } })).status, 401, 'no session');
  });

  test('POST /tags: 20 per hour per guest, 40 per IP; the catalog cap answers 409 tag_limit (existing names still 200)', async () => {
    const { w, warm } = await H.readyWorld();
    const t1 = await H.guestToken(w, warm, 'firma-rate-cid-00001');
    const t2 = await H.guestToken(w, warm, 'firma-rate-cid-00002');
    // every company goes onto an idea at once (unused ones have their own cap per creator: see below)
    const used = (r) => { if (r.status === 201) link(w, seedText(w), r.json.tag.id); return r; };
    for (let i = 0; i < 20; i++) assert.equal(used(await call(w, warm, 'POST', '/api/inspire/tags', { token: t1, body: { name: 'Firma ' + i } })).status, 201, 'n ' + i);
    const over = await call(w, warm, 'POST', '/api/inspire/tags', { token: t1, body: { name: 'Firma 20' } });
    assert.equal(over.status, 429); assert.equal(over.json.error, 'rate_limited');
    let okN = 0, r;
    for (;;) {
      r = used(await call(w, warm, 'POST', '/api/inspire/tags', { token: t2, body: { name: 'İkinci ' + okN } }));
      if (r.status !== 201) break;
      okN++;
    }
    assert.equal(r.status, 429);
    assert.equal(okN, 19, 'the second guest on the same IP stops at the IP cap (40 counted hits)');
    // another IP, a fresh guest: the cap of the catalog
    const { w: w2, warm: warm2 } = await H.readyWorld();
    for (let i = 0; i < 300; i++) seedTag(w2, 'Dolu ' + i, 'dolu ' + i, 'dolu-' + i);
    const t3 = await H.guestToken(w2, warm2, 'firma-cap-cid-000001');
    const full = await call(w2, warm2, 'POST', '/api/inspire/tags', { token: t3, body: { name: 'Bir fazla' } });
    assert.equal(full.status, 409); assert.equal(full.json.error, 'tag_limit'); assert.match(full.json.message, /dolu/);
    const old = await call(w2, warm2, 'POST', '/api/inspire/tags', { token: t3, body: { name: 'DOLU 7' } });
    assert.equal(old.status, 200); assert.equal(old.json.tag.name, 'Dolu 7');
    // the admin is never locked out by a full catalog (a board member may have filled it)
    const adm = await H.adminToken(w2, warm2);
    const mine = await call(w2, warm2, 'POST', '/api/inspire/tags', { token: adm, body: { name: 'Yöneticinin firması' } });
    assert.equal(mine.status, 201, JSON.stringify(mine.json));
    assert.equal(H.sqlAll(w2, 'SELECT COUNT(*) AS n FROM inspire_tags')[0].n, 301);
  });

  test('POST /tags: one creator holds at most 10 companies no idea uses (409 tag_unused_limit); using one frees a slot; the admin is exempt', async () => {
    const { w, warm } = await H.readyWorld();
    const tok = await H.guestToken(w, warm, 'firma-unused-cid-0001');
    const other = await H.guestToken(w, warm, 'firma-unused-cid-0002');
    const adm = await H.adminToken(w, warm);
    const mk = (token, name, ip) => call(w, warm, 'POST', '/api/inspire/tags', { token, body: { name }, ...(ip ? { ip } : {}) });
    const made = [];
    for (let i = 0; i < 10; i++) { const r = await mk(tok, 'Boş ' + i); assert.equal(r.status, 201, 'n ' + i); made.push(r.json.tag.id); }
    const over = await mk(tok, 'Boş 10');
    assert.equal(over.status, 409); assert.equal(over.json.error, 'tag_unused_limit');
    assert.match(over.json.message, /kullanılmayan 10 firman var/);
    assert.equal(H.sqlAll(w, "SELECT COUNT(*) AS n FROM inspire_tags WHERE name='Boş 10'")[0].n, 0);
    assert.equal((await mk(tok, 'BOŞ 3')).status, 200, 'an existing name still answers the company');
    assert.equal((await mk(other, 'Başkasının', '198.51.100.71')).status, 201, 'the cap is per creator');
    // an orphan link (a deleted post) does not make a company "used"
    H.sqlRun(w, 'PRAGMA foreign_keys = OFF'); link(w, 987654, made[0]); H.sqlRun(w, 'PRAGMA foreign_keys = ON');
    assert.equal((await mk(tok, 'Boş 10')).status, 409);
    // an idea with one of them: room for one more
    const p = await call(w, warm, 'POST', '/api/inspire/posts', { token: tok, body: { type: 'text', text: 'Boş 0 için fikir', tag_ids: [made[0]] } });
    assert.equal(p.status, 201, JSON.stringify(p.json));
    assert.equal((await mk(tok, 'Boş 10')).status, 201);
    assert.equal((await mk(tok, 'Boş 11')).json.error, 'tag_unused_limit');
    for (let i = 0; i < 12; i++) assert.equal((await mk(adm, 'Yönetici ' + i)).status, 201, 'admin n ' + i);
  });

  test('DELETE /tags/unused: admin only; removes every company no live idea uses (not the last 10 minutes), keeps ideas', async () => {
    const { w, warm } = await H.readyWorld();
    const tok = await H.guestToken(w, warm);
    const adm = await H.adminToken(w, warm);
    const used = seedTag(w, 'Kullanılan', 'kullanilan', 'kullanilan');
    const idle = seedTag(w, 'Boşta', 'bosta', 'bosta');
    const orphan = seedTag(w, 'Silinmiş fikirde', 'silinmis fikirde', 'silinmis-fikirde');
    const post = seedText(w);
    link(w, post, used);
    H.sqlRun(w, 'PRAGMA foreign_keys = OFF'); link(w, 987654, orphan); H.sqlRun(w, 'PRAGMA foreign_keys = ON');
    const young = await call(w, warm, 'POST', '/api/inspire/tags', { token: tok, body: { name: 'Az önce eklendi' } });
    assert.equal(young.status, 201);
    const g = await call(w, warm, 'DELETE', '/api/inspire/tags/unused', { token: tok });
    assert.equal(g.status, 403); assert.equal(g.json.error, 'forbidden');
    assert.equal((await call(w, warm, 'DELETE', '/api/inspire/tags/unused')).status, 401);
    const r = await call(w, warm, 'DELETE', '/api/inspire/tags/unused', { token: adm });
    assert.equal(r.status, 200, JSON.stringify(r.json));
    assert.deepEqual(r.json, { ok: true, removed: 2 });
    assert.ok(r.m.d1 <= 8, `${r.m.d1} statements`);
    const left = H.sqlAll(w, 'SELECT id FROM inspire_tags ORDER BY id').map((x) => x.id);
    assert.deepEqual(left, [used, young.json.tag.id], 'the used one and the one just created stay');
    assert.equal(H.sqlAll(w, 'SELECT COUNT(*) AS n FROM inspire_post_tags WHERE tag_id=?', orphan)[0].n, 0, 'its orphan link went with it');
    assert.deepEqual(tagsOf(w, post), [used]);
    assert.equal(H.sqlAll(w, 'SELECT COUNT(*) AS n FROM inspire_posts WHERE id=?', post)[0].n, 1);
    // ten minutes later (the row ages: the shared harness clock stays as the other suites expect it)
    H.sqlRun(w, 'UPDATE inspire_tags SET created_at = created_at - 601 WHERE id=?', young.json.tag.id);
    assert.deepEqual((await call(w, warm, 'DELETE', '/api/inspire/tags/unused', { token: adm })).json, { ok: true, removed: 1 });
    assert.deepEqual((await call(w, warm, 'DELETE', '/api/inspire/tags/unused', { token: adm })).json, { ok: true, removed: 0 });
  });

  test('GET /tags: counts of live links only, untagged / total, fold order, can_manage for the admin only', async () => {
    const { w, warm } = await H.readyWorld();
    const tok = await H.guestToken(w, warm);
    const adm = await H.adminToken(w, warm);
    const zeta = seedTag(w, 'Zeta', 'zeta', 'zeta', 'red');
    const cag = seedTag(w, 'Çağ', 'cag', 'cag', 'lime');
    const ist = seedTag(w, 'İstanbul', 'istanbul', 'istanbul', 'teal');
    const [p1, p2, p3, p4] = [seedText(w), seedText(w), seedText(w), seedText(w)];
    link(w, p1, zeta); link(w, p1, cag); link(w, p2, cag);
    // orphan links (D1 cascades deletes; a link left by anything else must still never count): foreign keys off to seed them
    H.sqlRun(w, 'PRAGMA foreign_keys = OFF');
    link(w, 987654, zeta);   // a deleted post
    H.sqlRun(w, 'INSERT INTO inspire_post_tags (post_id, tag_id, created_at) VALUES (?, 4242, 1)', p3);   // a deleted tag
    H.sqlRun(w, 'PRAGMA foreign_keys = ON');
    const r = await call(w, warm, 'GET', '/api/inspire/tags', { token: tok });
    assert.equal(r.status, 200);
    assert.deepEqual(r.json.tags.map((t) => [t.name, t.count]), [['Çağ', 2], ['İstanbul', 0], ['Zeta', 1]]);
    assert.deepEqual(r.json.tags[0], { id: cag, name: 'Çağ', slug: 'cag', color: 'lime', count: 2 });
    assert.deepEqual([r.json.total, r.json.untagged], [4, 2], 'p3 (only a dead link) and p4 have no company');
    assert.equal(r.json.can_manage, false);
    assert.deepEqual(r.json.limits, { per_post: 10, name_max: 40, max: 300 });
    assert.equal(r.json.colors.length, 10);
    assert.equal((await call(w, warm, 'GET', '/api/inspire/tags', { token: adm })).json.can_manage, true);
    assert.ok(r.m.d1 <= 4 && r.m.sub === 0, `GET /tags: ${r.m.d1} statements`);
    void ist; void p4;
  });

  test('POST /posts with tag_ids: text and link posts; invalid lists 400 before any insert or rate count; a duplicate tags nothing', async () => {
    const { w, warm } = await H.readyWorld();
    const tok = await H.guestToken(w, warm);
    const zeta = seedTag(w, 'Zeta', 'zeta', 'zeta');
    const alfa = seedTag(w, 'Alfa', 'alfa', 'alfa', 'amber');
    const t = await call(w, warm, 'POST', '/api/inspire/posts', { token: tok, body: { type: 'text', text: 'Firmalı fikir', tag_ids: [zeta, alfa, zeta, 99999] } });
    assert.equal(t.status, 201, JSON.stringify(t.json));
    assert.deepEqual(t.json.tags.map((x) => x.name), ['Alfa', 'Zeta'], 'sorted; duplicate and unknown ids dropped');
    assert.deepEqual(t.json.tags[0], { id: alfa, name: 'Alfa', slug: 'alfa', color: 'amber' });
    assert.equal(t.json.can_tag, true);
    const l = await call(w, warm, 'POST', '/api/inspire/posts', { token: tok, body: { url: 'https://www.instagram.com/reel/Ftag000001/', description: 'x', tag_ids: [zeta] } });
    assert.equal(l.status, 201, JSON.stringify(l.json));
    assert.deepEqual(l.json.tags.map((x) => x.id), [zeta]);
    const none = await call(w, warm, 'POST', '/api/inspire/posts', { token: tok, body: { type: 'text', text: 'Firmasız fikir' } });
    assert.deepEqual(none.json.tags, []);
    const before = H.sqlAll(w, 'SELECT COUNT(*) AS n FROM inspire_posts')[0].n;
    const rate = () => H.sqlAll(w, "SELECT COALESCE(SUM(n), 0) AS n FROM inspire_rate WHERE k LIKE 'post%'")[0].n;
    const r0 = rate();
    for (const bad of [Array.from({ length: 11 }, (_, i) => i + 1), 'abc', [1.5], [0], ['1'], { a: 1 }, [-3]]) {
      const r = await call(w, warm, 'POST', '/api/inspire/posts', { token: tok, body: { type: 'text', text: 'olmaz', tag_ids: bad } });
      assert.equal(r.status, 400, JSON.stringify(bad)); assert.equal(r.json.error, 'invalid_tags');
    }
    assert.equal(H.sqlAll(w, 'SELECT COUNT(*) AS n FROM inspire_posts')[0].n, before, 'nothing inserted');
    assert.equal(rate(), r0, 'no rate-limit hit');
    const dup = await call(w, warm, 'POST', '/api/inspire/posts', { token: tok, body: { url: 'https://www.instagram.com/reel/Ftag000001/', tag_ids: [alfa] } });
    assert.equal(dup.status, 409);
    assert.deepEqual(tagsOf(w, l.json.id), [zeta], 'the duplicate added no company to the existing post');
  });

  test('PUT /posts/:id/tags: owner guest, registered owner and admin; others 403; replaces the set; rate limited', async () => {
    const { w, warm } = await H.readyWorld();
    const owner = await H.guestToken(w, warm, 'firma-owner-cid-0001');
    const other = await H.guestToken(w, warm, 'firma-other-cid-0001');
    const adm = await H.adminToken(w, warm);
    const [a, b, c] = [seedTag(w, 'A Firma', 'a firma', 'a-firma'), seedTag(w, 'B Firma', 'b firma', 'b-firma'), seedTag(w, 'C Firma', 'c firma', 'c-firma')];
    const post = seedText(w, 'firma-owner-cid-0001');
    link(w, post, a); link(w, post, b);
    const put = (token, ids, id = post) => call(w, warm, 'PUT', `/api/inspire/posts/${id}/tags`, { token, body: { tag_ids: ids } });
    let r = await put(owner, [b, c]);
    assert.equal(r.status, 200, JSON.stringify(r.json));
    assert.deepEqual(r.json.post.tags.map((t) => t.id), [b, c]);
    assert.equal(r.json.post.id, post); assert.equal(r.json.post.can_tag, true);
    assert.deepEqual(tagsOf(w, post), [b, c], 'a removed, c added');
    r = await put(other, [a]);
    assert.equal(r.status, 403); assert.match(r.json.message, /firmalarını değiştirme yetkin yok/);
    assert.deepEqual(tagsOf(w, post), [b, c]);
    r = await put(adm, []);
    assert.equal(r.status, 200); assert.deepEqual(r.json.post.tags, []);
    assert.equal((await put(owner, [a], 999999)).status, 404);
    assert.equal((await put(owner, 'x')).status, 400);
    assert.equal((await call(w, warm, 'PUT', `/api/inspire/posts/${post}/tags`, { token: owner, body: {} })).status, 400, 'tag_ids required');
    assert.equal((await put(owner, Array.from({ length: 11 }, (_, i) => i + 1))).status, 400);
    // a registered user's own post
    const ut = await userToken(w, warm);
    const uid = H.sqlAll(w, "SELECT id FROM inspire_users WHERE username='firma-kayitli'")[0].id;
    const upost = Number(H.sqlRun(w, "INSERT INTO inspire_posts (user_id, type, url, description) VALUES (?, 'text', '', 'u')", uid).lastInsertRowid);
    r = await put(ut, [c]);
    assert.equal(r.status, 403, 'not the guest post of someone else');
    r = await put(ut, [c], upost);
    assert.equal(r.status, 200); assert.deepEqual(r.json.post.tags.map((t) => t.id), [c]);
    // tagset: 120 per hour per guest
    const rl = await H.guestToken(w, warm, 'firma-owner-cid-0001');
    let last;
    for (let i = 0; i < 125; i++) { last = await put(rl, i % 2 ? [a] : [b]); if (last.status === 429) break; }
    assert.equal(last.status, 429);
    assert.ok(r.m.d1 <= 10 && r.m.sub === 0, `PUT /posts/:id/tags: ${r.m.d1} statements`);
  });

  test('PUT / DELETE /tags/:id: admin only; rename (slug), case-only rename, clash 409, recolor, merge, delete keeps posts', async () => {
    const { w, warm } = await H.readyWorld();
    const tok = await H.guestToken(w, warm);
    const ut = await userToken(w, warm, 'firma-kayitli-2');
    const adm = await H.adminToken(w, warm);
    const say = seedTag(w, 'Sayın', 'sayin', 'sayin');
    const gay = seedTag(w, 'Gayrimenkul', 'gayrimenkul', 'gayrimenkul', 'green');
    const [p1, p2, p3] = [seedText(w), seedText(w), seedText(w)];
    link(w, p1, say); link(w, p2, say); link(w, p2, gay); link(w, p3, gay);
    const put = (token, id, body) => call(w, warm, 'PUT', `/api/inspire/tags/${id}`, { token, body });
    for (const t of [tok, ut]) {
      const r = await put(t, say, { name: 'Başka' });
      assert.equal(r.status, 403); assert.equal(r.json.error, 'forbidden');
      assert.equal((await call(w, warm, 'DELETE', `/api/inspire/tags/${say}`, { token: t })).status, 403);
    }
    let r = await put(adm, say, { name: 'SAYIN' });
    assert.equal(r.status, 200, JSON.stringify(r.json));
    assert.deepEqual([r.json.tag.name, r.json.tag.slug], ['SAYIN', 'sayin'], 'a case-only rename keeps the slug');
    r = await put(adm, say, { name: 'Sayın Yapı' });
    assert.deepEqual([r.json.tag.name, r.json.tag.slug], ['Sayın Yapı', 'sayin-yapi']);
    r = await put(adm, say, { name: 'gayri menkul' });
    assert.notEqual(r.status, 409, 'a different fold (space) is no clash');
    r = await put(adm, say, { name: 'GAYRİMENKUL' });
    assert.equal(r.status, 409); assert.equal(r.json.error, 'tag_exists');
    assert.deepEqual(r.json.existing, { id: gay, name: 'Gayrimenkul' });
    assert.match(r.json.message, /«Gayrimenkul» adında bir firma zaten var/);
    assert.equal((await put(adm, say, { name: 'Firmasız' })).json.error, 'reserved_name');
    assert.equal((await put(adm, 999999, { name: 'Yok' })).status, 404);
    assert.equal((await put(adm, say, { name: 'X', color: 'red' })).status, 400, 'exactly one change');
    assert.equal((await put(adm, say, {})).status, 400);
    r = await put(adm, say, { color: 'pink' });
    assert.equal(r.status, 200); assert.equal(r.json.tag.color, 'pink');
    assert.equal((await put(adm, say, { color: '#fff' })).json.error, 'invalid_color');
    assert.equal((await put(adm, 999999, { color: 'red' })).status, 404);
    // merge Sayın into Gayrimenkul: p2 had both -> one link; the source is gone
    assert.equal((await put(adm, say, { merge_into: say })).status, 400);
    assert.equal((await put(adm, say, { merge_into: 999999 })).status, 404);
    r = await put(adm, say, { merge_into: gay });
    assert.equal(r.status, 200, JSON.stringify(r.json));
    assert.deepEqual([r.json.tag.id, r.json.merged_from], [gay, say]);
    assert.deepEqual([tagsOf(w, p1), tagsOf(w, p2), tagsOf(w, p3)], [[gay], [gay], [gay]]);
    assert.equal(H.sqlAll(w, 'SELECT COUNT(*) AS n FROM inspire_tags WHERE id=?', say)[0].n, 0);
    // delete: links go, posts stay; a second delete 404
    const d = await call(w, warm, 'DELETE', `/api/inspire/tags/${gay}`, { token: adm });
    assert.equal(d.status, 200); assert.deepEqual(d.json, { ok: true, removed_links: 3 });
    assert.equal(H.sqlAll(w, 'SELECT COUNT(*) AS n FROM inspire_post_tags')[0].n, 0);
    assert.equal(H.sqlAll(w, 'SELECT COUNT(*) AS n FROM inspire_posts WHERE id IN (?, ?, ?)', p1, p2, p3)[0].n, 3, 'posts are never deleted');
    assert.equal((await call(w, warm, 'DELETE', `/api/inspire/tags/${gay}`, { token: adm })).status, 404);
  });

  test('tagsOut: sorts on the stored fold (no Unicode work per page), never outputs it; 200 posts x 10 tags stay far under 10 ms', async () => {
    // the stored fold decides, not the name (a name that would fold elsewhere proves the names are not folded again)
    const j = JSON.stringify([
      { id: 3, name: 'Zeta', slug: 'zeta', color: 'red', f: 'a' },
      { id: 1, name: 'Alfa', slug: 'alfa', color: 'blue', f: 'c' },
      { id: 2, name: 'Çağ', slug: 'cag', color: 'nope', f: 'b' },
    ]);
    assert.deepEqual(tagsOut(j), [
      { id: 3, name: 'Zeta', slug: 'zeta', color: 'red' }, { id: 2, name: 'Çağ', slug: 'cag', color: 'cyan' }, { id: 1, name: 'Alfa', slug: 'alfa', color: 'blue' }]);
    // rows without one (never from SQL): their names are folded once each
    assert.deepEqual(tagsOut(JSON.stringify([{ id: 9, name: 'Zeta', slug: 'z' }, { id: 8, name: 'ÇAĞ', slug: 'c' }, { id: 7, name: 'Bey', slug: 'b' }])).map((t) => t.id), [7, 8, 9]);
    for (const bad of [null, '', 'x', '{}', '[1,{"id":"2","name":"a","slug":"a"}]']) assert.deepEqual(tagsOut(bad), [], String(bad));
    // the page cost: 200 rows x 10 tags in reverse fold order (the worst case for the sort)
    const rows = Array.from({ length: 200 }, (_, p) => JSON.stringify(Array.from({ length: 10 }, (_, i) => {
      const n = 9 - i;
      return { id: p * 10 + n + 1, name: `İstanbul Yapı Şirketi ${n} Çağ`, slug: `istanbul-yapi-sirketi-${n}-cag`, color: 'teal', f: `istanbul yapi sirketi ${n} cag` };
    })));
    for (const r of rows) tagsOut(r);   // warm
    const runs = [];
    for (let k = 0; k < 5; k++) { const t0 = performance.now(); for (const r of rows) tagsOut(r); runs.push(performance.now() - t0); }
    runs.sort((a, b) => a - b);
    assert.ok(runs[2] < 5, `200 x 10 tags: median ${runs[2].toFixed(2)} ms`);
    // through the worker: GET /posts gives sorted tags without the fold
    const { w, warm } = await H.readyWorld();
    const tok = await H.guestToken(w, warm);
    const post = seedText(w);
    const ids = ['Zeytin', 'Çağ', 'ışık', 'Ilgaz', 'Ana'].map((name) => {
      const f = name === 'Çağ' ? 'cag' : name === 'ışık' ? 'isik' : name.toLowerCase();
      return seedTag(w, name, f, f);
    });
    for (const id of [...ids].reverse()) link(w, post, id);
    const r = await call(w, warm, 'GET', '/api/inspire/posts', { token: tok });
    const got = r.json.find((x) => x.id === post).tags;
    assert.deepEqual(got.map((t) => t.name), ['Ana', 'Çağ', 'Ilgaz', 'ışık', 'Zeytin']);
    assert.ok(got.every((t) => Object.keys(t).sort().join() === 'color,id,name,slug'), JSON.stringify(got));
  });

  test('DELETE /posts/:id removes its company links', async () => {
    const { w, warm } = await H.readyWorld();
    const tok = await H.guestToken(w, warm);
    const a = seedTag(w, 'Alfa', 'alfa', 'alfa');
    const post = seedText(w);
    link(w, post, a);
    const r = await call(w, warm, 'DELETE', `/api/inspire/posts/${post}`, { token: tok });
    assert.equal(r.status, 200);
    assert.deepEqual(tagsOf(w, post), []);
  });

  test('GET /posts: tags / can_tag on every post (never for legacy clients); the filter: any, all, untagged, unknown ids, bad params', async () => {
    const { w, warm } = await H.readyWorld();
    const tok = await H.guestToken(w, warm);
    const adm = await H.adminToken(w, warm);
    const [A, B] = [seedTag(w, 'Alfa', 'alfa', 'alfa'), seedTag(w, 'Beta', 'beta', 'beta')];
    const pa = seedText(w), pb = seedText(w, 'other-cid-000000001'), pab = seedText(w), pn = seedText(w);
    link(w, pa, A); link(w, pb, B); link(w, pab, A); link(w, pab, B);
    const list = async (q = '', token = tok, extra = {}) => call(w, warm, 'GET', '/api/inspire/posts' + q, { token, ...extra });
    let r = await list();
    assert.equal(r.status, 200);
    assert.ok(r.json.every((p) => Array.isArray(p.tags) && typeof p.can_tag === 'boolean'));
    const byId = (arr, id) => arr.find((p) => p.id === id);
    assert.deepEqual(byId(r.json, pab).tags.map((t) => t.name), ['Alfa', 'Beta']);
    assert.deepEqual([byId(r.json, pa).can_tag, byId(r.json, pb).can_tag], [true, false], 'owner only');
    assert.ok((await list('', adm)).json.every((p) => p.can_tag === true), 'the admin may tag every post');
    const legacy = await list('', tok, { legacy: true });
    assert.ok(legacy.json.every((p) => !('tags' in p) && !('can_tag' in p)), 'old cached pages never see tags');
    const ids = async (q) => { const x = await list(q); assert.equal(x.status, 200, q + ' ' + JSON.stringify(x.json)); return x.json.map((p) => p.id).sort((m, n) => m - n); };
    const sorted = (...a) => a.sort((m, n) => m - n);
    assert.deepEqual(await ids(`?tags=${A}`), sorted(pa, pab));
    assert.deepEqual(await ids(`?tags=${A},${B}`), sorted(pa, pb, pab), 'any (default)');
    assert.deepEqual(await ids(`?tags=${A},${B}&match=all`), [pab]);
    assert.deepEqual(await ids('?untagged=1'), [pn]);
    assert.deepEqual(await ids(`?tags=${B}&untagged=1`), sorted(pb, pab, pn), 'untagged OR any');
    assert.deepEqual(await ids(`?tags=${A},77777&match=all`), sorted(pa, pab), 'an unknown id is not required');
    assert.deepEqual(await ids(`?tags=${A},77777`), sorted(pa, pab), 'and never matches');
    assert.deepEqual(await ids('?tags=77777,88888&match=all'), [], 'only unknown ids: nothing');
    assert.deepEqual(await ids('?tags=77777'), []);
    assert.deepEqual(await ids('?tags=&untagged=0'), sorted(pa, pb, pab, pn), 'empty = no filter');
    for (const q of ['?tags=abc', '?tags=' + Array.from({ length: 21 }, (_, i) => i + 1).join(','), '?match=x', '?tags=1&match=some', '?untagged=2', '?tags=1,,2']) {
      const x = await list(q);
      assert.equal(x.status, 400, q); assert.equal(x.json.error, 'bad_filter', q);
    }
    assert.equal((await list('?tags=' + Array.from({ length: 20 }, (_, i) => i + 1).join(','))).status, 200, '20 ids pass');
  });

  test('GET /posts filter: paging with X-Fikir-Next stays inside the filter; notes and live facts cover the filtered page; same budget', async () => {
    const { w, warm } = await H.readyWorld({ vars: { ...H.liveVars } });
    const tok = await H.guestToken(w, warm);
    const [A, B] = [seedTag(w, 'Alfa', 'alfa', 'alfa'), seedTag(w, 'Beta', 'beta', 'beta')];
    const g = guestId(w);
    const all = [];
    for (let i = 1; i <= 450; i++) {
      const id = Number(H.sqlRun(w, "INSERT INTO inspire_posts (user_id, type, url, description, client_id) VALUES (?, 'text', '', ?, 'harness-cid-0001')", g, 'p' + i).lastInsertRowid);
      all.push(id);
      if (i % 3 === 0) link(w, id, A);
      if (i % 5 === 0) link(w, id, B);
    }
    const page = async (q) => {
      const got = [];
      let before = null, pages = 0;
      for (;;) {
        const r = await call(w, warm, 'GET', '/api/inspire/posts?' + q + (before ? '&before=' + before : ''), { token: tok });
        assert.equal(r.status, 200);
        assert.ok(r.json.length <= 200);
        got.push(...r.json.map((p) => p.id));
        pages++;
        before = r.headers['x-fikir-next'];
        if (!before) break;
        assert.equal(Number(before), r.json[r.json.length - 1].id, 'the cursor is the last post of the filtered page');
      }
      return { got, pages };
    };
    const idx = (id) => all.indexOf(id) + 1;
    const anyWant = all.filter((id) => idx(id) % 3 === 0 || idx(id) % 5 === 0).reverse();
    const any = await page(`tags=${A},${B}`);
    assert.equal(anyWant.length, 210);
    assert.deepEqual(any.got, anyWant, 'every match once, ids strictly descending');
    assert.equal(any.pages, 2);
    const allWant = all.filter((id) => idx(id) % 15 === 0).reverse();
    const both = await page(`tags=${A},${B}&match=all&limit=7`);
    assert.deepEqual(both.got, allWant);
    assert.equal(both.pages, Math.ceil(allWant.length / 7));
    assert.equal(new Set(both.got).size, both.got.length, 'no duplicates');
    // notes: a public note on a matching post shows, one on a non-matching post never does
    const hit = allWant[0], miss = all[448];   // post 449: neither a 3rd nor a 5th
    for (const [pid, text] of [[hit, 'görünen not'], [miss, 'gizli kalmalı']]) {
      H.sqlRun(w, "INSERT INTO inspire_notes (post_id, user_id, content, is_public, author_name, client_id) VALUES (?, ?, ?, 1, 'N', 'harness-cid-0001')", pid, g, text);
    }
    const f = await call(w, warm, 'GET', `/api/inspire/posts?tags=${A},${B}&match=all`, { token: tok });
    assert.deepEqual(f.json.find((p) => p.id === hit).notes.map((n) => n.content), ['görünen not']);
    assert.ok(!f.text().includes('gizli kalmalı'));
    // live facts: an Instagram post in the filter gets its player, one outside is not in the answer
    const [igIn, igOut] = H.seedIgPosts(w, ['Ftagig0001', 'Ftagig0002']);
    H.seedIgCache(w, [igIn, igOut]);
    link(w, igIn, A); link(w, igIn, B);
    const lf = await call(w, warm, 'GET', `/api/inspire/posts?tags=${A},${B}&match=all&limit=5`, { token: tok });
    assert.equal(lf.json[0].id, igIn);
    assert.ok(lf.json[0].live, 'live object for the filtered page');
    assert.ok(!lf.json.some((p) => p.id === igOut));
    // budget: filtered and unfiltered lists cost the same statements, no subrequest
    const plain = await call(w, warm, 'GET', '/api/inspire/posts', { token: tok });
    const filt = await call(w, warm, 'GET', `/api/inspire/posts?tags=${A}&match=all&untagged=1`, { token: tok });
    assert.equal(filt.status, 200);
    assert.equal(filt.m.d1, plain.m.d1, `${filt.m.d1} vs ${plain.m.d1}`);
    assert.ok(plain.m.d1 <= 8, `GET /posts statements: ${plain.m.d1}`);
    assert.equal(plain.m.sub, 0); assert.equal(filt.m.sub, 0);
  });
});
