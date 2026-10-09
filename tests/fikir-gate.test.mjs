// Board password gate (worker/fikir-gate.js + handleInspire in worker/index.js):
//   unit: constant-time compare, password version (pv), download tickets, files tokens, JSON signing
//   worker (tests/cron-harness.mjs: the real worker in Node with in-memory D1/R2 and a fake network): every /api/inspire/*
//   route read from the router source (tests/gate-routes.mjs) without a session / with a stale, wrong-pv, expired or
//   foreign token / with valid guest and admin sessions; registered users (live account + expiring token only); POST /guest
//   (password, lockout per IP / network / site, fail-closed limiter, locked board), /guest/rename,
//   download tickets (binding, expiry, budget), /files policy (board files need ?t=, other files public), a password
//   change logging guests out, YouTube / Vimeo downloads (422, never the thumbnail), the rest of the site unaffected.
// TEST values only (harness-board-pass, harness-secret, harness-admin).
import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  safeEqual, boardPv, boardLocked, checkBoardPassword, guestPvOk, dlTicket, dlTicketRole, DL_TICKET_S,
  filesToken, filesTokenTtl, FILES_WINDOW_S, filesGateOn, signFilesJson,
} from '../worker/fikir-gate.js';
import { inspireRoutes, OPEN_ROUTES, isOpen, isDownload, fill } from './gate-routes.mjs';
import * as H from './cron-harness.mjs';

const ENV = { JWT_SECRET: 'unit-secret', FIKIR_BOARD_PASSWORD: 'unit-board-pass' };
const T0 = 1_800_000_000;   // a fixed "now" (s) for the pure helpers

describe('fikir-gate.js (pure helpers)', () => {
  test('safeEqual: equal strings only; length and content differences alike', async () => {
    assert.equal(await safeEqual('Abc.123', 'Abc.123'), true);
    assert.equal(await safeEqual('Abc.123', 'Abc.124'), false);
    assert.equal(await safeEqual('Abc.123', 'Abc.1234'), false);
    assert.equal(await safeEqual('', ''), true);
    assert.equal(await safeEqual('ş', 's'), false);
    assert.equal(await safeEqual(undefined, 'undefined'), true, 'non-strings compare as String()');
  });

  test('boardPv: 8 hex, stable per (JWT_SECRET, password), different per password and secret, null when locked', async () => {
    const pv = await boardPv(ENV);
    assert.match(pv, /^[0-9a-f]{8}$/);
    assert.equal(await boardPv({ ...ENV }), pv);
    assert.notEqual(await boardPv({ ...ENV, FIKIR_BOARD_PASSWORD: 'another' }), pv);
    assert.notEqual(await boardPv({ ...ENV, JWT_SECRET: 'other-secret' }), pv);
    assert.equal(await boardPv({ JWT_SECRET: 'x' }), null);
    assert.equal(await boardPv({ JWT_SECRET: 'x', FIKIR_BOARD_PASSWORD: '' }), null);
    assert.equal(await boardPv({ FIKIR_BOARD_PASSWORD: 'p' }), null, 'no JWT_SECRET: locked too');
    assert.equal(boardLocked(ENV), false); assert.equal(boardLocked({ JWT_SECRET: 'x' }), true);
    assert.ok(!pv.includes('unit'), 'pv is not the password');
  });

  test('checkBoardPassword: ok / bad / missing / locked (never open without the secret)', async () => {
    assert.equal(await checkBoardPassword(ENV, 'unit-board-pass'), 'ok');
    assert.equal(await checkBoardPassword(ENV, 'unit-board-pas'), 'bad');
    assert.equal(await checkBoardPassword(ENV, 'UNIT-BOARD-PASS'), 'bad', 'case sensitive');
    assert.equal(await checkBoardPassword(ENV, ' unit-board-pass'), 'bad', 'no trimming');
    assert.equal(await checkBoardPassword(ENV, 'x'.repeat(5000)), 'bad');
    assert.equal(await checkBoardPassword(ENV, ''), 'missing');
    assert.equal(await checkBoardPassword(ENV, 123), 'missing');
    assert.equal(await checkBoardPassword({ JWT_SECRET: 'x' }, ''), 'locked');
    assert.equal(await checkBoardPassword({ JWT_SECRET: 'x' }, 'anything'), 'locked');
  });

  test('guestPvOk: the current pv only', async () => {
    const pv = await boardPv(ENV);
    assert.equal(await guestPvOk(ENV, { g: 1, pv }), true);
    assert.equal(await guestPvOk(ENV, { g: 1 }), false, 'token from before the gate');
    assert.equal(await guestPvOk(ENV, { g: 1, pv: '00000000' }), false);
    assert.equal(await guestPvOk({ ...ENV, FIKIR_BOARD_PASSWORD: 'changed' }, { g: 1, pv }), false, 'password changed');
    assert.equal(await guestPvOk({ JWT_SECRET: 'unit-secret' }, { g: 1, pv }), false, 'locked');
  });

  test('download tickets: bound to post, role, expiry and pv; forged / malformed ones refused', async () => {
    const g = await dlTicket(ENV, 42, 'g', T0), a = await dlTicket(ENV, 42, 'a', T0);
    assert.match(g, /^[0-9a-z]+\.g\.[A-Za-z0-9_-]{22}$/);
    assert.match(a, /^[0-9a-z]+\.a\.[A-Za-z0-9_-]{22}$/);
    assert.ok(/^[A-Za-z0-9._-]{1,80}$/.test(g), "fits the board's download-link pattern (?k=[A-Za-z0-9._-]{1,80})");
    assert.equal(await dlTicketRole(ENV, 42, g, T0 + 1), 'g');
    assert.equal(await dlTicketRole(ENV, 42, a, T0 + 1), 'a');
    assert.equal(await dlTicketRole(ENV, 43, g, T0 + 1), null, 'another post');
    assert.equal(await dlTicketRole(ENV, 42, g, T0 + DL_TICKET_S - 1), 'g');
    assert.equal(await dlTicketRole(ENV, 42, g, T0 + DL_TICKET_S), null, 'expired');
    assert.equal(await dlTicketRole(ENV, 42, g, T0 - 3600), null, 'expiry too far ahead (a ticket never lives longer)');
    const [e, , s] = g.split('.');
    assert.equal(await dlTicketRole(ENV, 42, `${e}.a.${s}`, T0 + 1), null, 'role swapped');
    assert.equal(await dlTicketRole(ENV, 42, `${(parseInt(e, 36) + 60).toString(36)}.g.${s}`, T0 + 1), null, 'expiry moved');
    assert.equal(await dlTicketRole(ENV, 42, `${e}.g.${'A'.repeat(22)}`, T0 + 1), null, 'forged');
    assert.equal(await dlTicketRole({ ...ENV, FIKIR_BOARD_PASSWORD: 'changed' }, 42, g, T0 + 1), null, 'password changed');
    for (const bad of [null, '', 'x', `${e}.${s}`, `${e}.z.${s}`, g + 'x']) assert.equal(await dlTicketRole(ENV, 42, bad, T0 + 1), null, String(bad));
    assert.equal(await dlTicket({}, 42, 'g', T0), null, 'no JWT_SECRET: no ticket');
    assert.equal(await dlTicket(ENV, 42, 'x', T0), null);
  });

  test('files tokens: 12-24 h, the same within a 12-hour window, bound to pv, forged ones refused', async () => {
    const w0 = Math.floor(T0 / FILES_WINDOW_S) * FILES_WINDOW_S;
    const t = await filesToken(ENV, w0 + 10);
    assert.match(t, /^[0-9a-z]+\.[A-Za-z0-9_-]{22}$/);
    assert.equal(await filesToken(ENV, w0 + FILES_WINDOW_S - 1), t, 'stable URLs within the window (browser cache)');
    assert.notEqual(await filesToken(ENV, w0 + FILES_WINDOW_S), t);
    assert.equal(await filesTokenTtl(ENV, t, w0 + 10), 2 * FILES_WINDOW_S - 10);
    assert.ok(await filesTokenTtl(ENV, t, w0 + 2 * FILES_WINDOW_S - 1) === 1);
    assert.equal(await filesTokenTtl(ENV, t, w0 + 2 * FILES_WINDOW_S), 0, 'expired');
    assert.equal(await filesTokenTtl({ ...ENV, FIKIR_BOARD_PASSWORD: 'changed' }, t, w0 + 10), 0, 'password changed');
    assert.equal(await filesTokenTtl({ ...ENV, JWT_SECRET: 'other' }, t, w0 + 10), 0);
    assert.equal(await filesTokenTtl(ENV, t.split('.')[0] + '.' + 'A'.repeat(22), w0 + 10), 0, 'forged');
    assert.equal(await filesTokenTtl(ENV, (w0 + 30 * 86400).toString(36) + '.' + t.split('.')[1], w0 + 10), 0, 'far-future expiry');
    for (const bad of [null, '', 'abc', t + '.x']) assert.equal(await filesTokenTtl(ENV, bad, w0 + 10), 0);
    const admin = await filesToken({ JWT_SECRET: 'unit-secret' }, w0 + 10);
    assert.ok(await filesTokenTtl({ JWT_SECRET: 'unit-secret' }, admin, w0 + 10) > 0, 'locked board: the admin still gets file tokens');
    assert.equal(filesGateOn({}), true); assert.equal(filesGateOn({ FIKIR_FILES_GATE: '1' }), true); assert.equal(filesGateOn({ FIKIR_FILES_GATE: '0' }), false);
  });

  test('signFilesJson: exactly the board file paths, any key, arrays; text and other files untouched', () => {
    const data = {
      media: { url: '/files/fikir/7/v-0123456789abcdef0123456789abcdef.mp4', poster: '/files/fikir/7/p-0123456789abcdef0123456789abcdef.jpg', small: null },
      storyboard: { thumbs: [{ n: 1, path: '/files/sb/sb_0123456789abcdef0123456789abcdef/frame_1.r0.jpg' }] },
      list: ['/files/sb/sb_0123456789abcdef0123456789abcdef/frame_2.r1.jpg', 'x'],
      description: 'bak: "/files/fikir/7/v-0123456789abcdef0123456789abcdef.mp4" ve x"/files/sb/a.jpg',
      exact_text: 'see /files/fikir/7/v-0123456789abcdef0123456789abcdef.mp4',
      project: '/files/images/0123456789abcdef.jpg', other: '/files/uiux/thing.png', ext: 'https://cdn.example/files/fikir/1/x.mp4',
    };
    const out = JSON.parse(signFilesJson(JSON.stringify(data), 'TOK.en'));
    assert.equal(out.media.url, data.media.url + '?t=TOK.en');
    assert.equal(out.media.poster, data.media.poster + '?t=TOK.en');
    assert.equal(out.storyboard.thumbs[0].path, data.storyboard.thumbs[0].path + '?t=TOK.en');
    assert.equal(out.list[0], data.list[0] + '?t=TOK.en');
    for (const k of ['description', 'exact_text', 'project', 'other', 'ext']) assert.equal(out[k], data[k], k);
    assert.equal(signFilesJson(JSON.stringify(data), null), JSON.stringify(data));
    const twice = signFilesJson(signFilesJson(JSON.stringify(data), 'A.b'), 'C.d');
    assert.equal(JSON.parse(twice).media.url, data.media.url + '?t=A.b', 'a signed path is not signed again');
  });
});

// ---------------------------------------------------------------- the worker (Node harness)
const b64u = (v) => Buffer.from(typeof v === 'string' ? v : v).toString('base64url');
// An inspire token as signInspireJWT makes it (to forge stale / wrong-pv / expired / foreign tokens)
async function signInspire(payload, secret) {
  const header = b64u(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = b64u(JSON.stringify(payload));
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret + '_inspire'), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${header}.${body}`)));
  return `${header}.${body}.${b64u(sig)}`;
}
// A registered-user token as the d9456ea-era signInspireJWT made it: standard base64, iat in ms, no exp (never expired)
async function signLegacyInspire(payload, secret) {
  const header = btoa(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = btoa(JSON.stringify(payload));
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret + '_inspire'), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${header}.${body}`)));
  return `${header}.${body}.${btoa(String.fromCharCode(...sig))}`;
}
const HEX = (c) => c.repeat(32);
const BOARD_PW = 'harness-board-pass';

describe('board password gate (worker, Node harness)', { skip: !H.HARNESS_SUPPORTED && 'needs node:module registerHooks (Node >= 22.15)' }, () => {
  let w, warm, ids, tok, adm, files, routes;
  const req = (method, p, opts = {}) => H.runRequest(w, warm, method, p, opts).then((m) => m.result);
  const guestLogin = (body, ip) => req('POST', '/api/inspire/guest', { body, ip });

  before(async () => {
    ({ w, warm } = await H.readyWorld());
    // the rest of the site's tables (projects, KPSS) from worker/schema.sql (Latin-1 file)
    const ddl = fs.readFileSync(path.join(H.ROOT, 'worker/schema.sql'), 'latin1').split(';')
      .filter((s) => /CREATE TABLE IF NOT EXISTS (projects|fitness_store|kpss_\w+)\b/.test(s));
    for (const s of ddl) w.sq.exec(s);
    adm = (await req('POST', '/api/inspire/login', { body: { username: 'vkesgin38', password: w.env.ADMIN_PASSWORD } })).json.token;
    const g = await guestLogin({ cid: 'gate-guest-cid-0001', name: 'Ayşe', password: BOARD_PW });
    assert.equal(g.status, 200, JSON.stringify(g.json));
    tok = g.json.token;
    // seeds: a link post with an uploaded video (R2), a text post with a storyboard frame (R2), a note, YouTube / Vimeo posts
    const guestId = H.sqlAll(w, "SELECT id FROM inspire_users WHERE username='__guest__'")[0].id;
    const ins = (type, url, extra = {}) => Number(H.sqlRun(w, `INSERT INTO inspire_posts (user_id, type, url, description, author_name, client_id, url_key, meta, media)
      VALUES (?, ?, ?, ?, 'Sahip', 'gate-owner-cid-00001', ?, ?, NULL)`, guestId, type, url, extra.description || '', extra.key || null, extra.meta || null).lastInsertRowid);
    const link = ins('web', 'https://example.com/gate-page', { key: 'web:gate', meta: JSON.stringify({ v: 2, via: 'plain', title: 'Kapı', provider: 'example.com', checked: H.nowS(),
      media: { mv: 1, kind: 'video', url: 'https://cdn.example/gate-clip.mp4', poster: 'https://cdn.example/gate-clip.jpg', verified: true } }) });
    const vKey = `fikir/${link}/v-${HEX('a')}.mp4`, pKey = `fikir/${link}/p-${HEX('b')}.jpg`;
    H.sqlRun(w, 'UPDATE inspire_posts SET media=? WHERE id=?', JSON.stringify({ kind: 'video', url: '/files/' + vKey, poster: '/files/' + pKey, mime: 'video/mp4', bytes: 8, verified: true, source: 'upload' }), link);
    const clip = Buffer.from([0, 0, 0, 0x14, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d, 0, 0, 0, 0, 0x69, 0x73, 0x6f, 0x6d]);
    w.r2.objs.set(vKey, { b: clip }); w.r2.objs.set(pKey, { b: Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]) });
    const text = ins('text', '', { description: 'Bir fikir' });
    const sbId = 'sb_' + HEX('c');
    const frameKey = `sb/${sbId}/frame_1.r0.jpg`;
    H.sqlRun(w, `INSERT INTO sb_storyboards (id, post_id, version, status, stage, input_json, draft_json, title, aspect, seed, day, created_at, updated_at)
      VALUES (?, ?, 1, 'done', 'done', '{"format":"9:16"}', ?, 'T', '9:16', 1, '2026-10-09', ?, ?)`, sbId, text,
    JSON.stringify({ title: 'T', aspect_ratio: '9:16', scenes: [{ n: 1, title: 'Sahne bir' }] }), Date.now(), Date.now());
    H.sqlRun(w, "INSERT INTO sb_images (sb_id, job, kind, n, status, rev, r2_key, updated_at) VALUES (?, 'frame_1', 'frame', 1, 'done', 0, ?, ?)", sbId, frameKey, Date.now());
    w.r2.objs.set(frameKey, { b: Buffer.from([0xff, 0xd8, 0xff, 0xe0, 9]) });
    const note = Number(H.sqlRun(w, "INSERT INTO inspire_notes (post_id, user_id, content, is_public, author_name, client_id) VALUES (?, ?, 'not', 1, 'Sahip', 'gate-owner-cid-00001')", link, guestId).lastInsertRowid);
    const yt = ins('youtube', 'https://www.youtube.com/shorts/jNQXAC9IVRw', { key: 'youtube:jNQXAC9IVRw' });
    const ytLive = ins('youtube', 'https://www.youtube.com/live/jfKfPfyJRdk', { key: 'youtube:jfKfPfyJRdk' });
    const vimeo = ins('vimeo', 'https://vimeo.com/76979871', { key: 'vimeo:76979871', meta: JSON.stringify({ v: 2, via: 'plain', title: 'V', image: 'https://i.vimeocdn.com/video/1-d.jpg', provider: 'vimeo.com', checked: H.nowS() }) });
    w.r2.objs.set('images/0123456789abcdef.jpg', { b: Buffer.from([0xff, 0xd8, 0xff, 0xe0, 7]) });   // a portfolio upload
    ids = { post: link, note, sb: sbId, text, yt, ytLive, vimeo };
    files = { vKey, pKey, frameKey };
    routes = inspireRoutes();
  });

  test('the route list comes from the router (every route, the open ones exactly as the worker lists them)', () => {
    assert.ok(routes.length >= 30, `${routes.length} routes`);
    for (const k of ['POST /api/inspire/guest/rename', 'GET /api/inspire/posts', 'GET /api/inspire/storyboards/{sb}', 'GET /api/inspire/posts/{post}/download',
      'POST /api/inspire/posts/{post}/media/upload', 'POST /api/inspire/storyboards/{sb}/scenes/1/rewrite', 'GET /api/inspire/sb-admin/usage']) {
      assert.ok(routes.some((r) => r.method + ' ' + r.path === k), k);
    }
    const src = fs.readFileSync(path.join(H.ROOT, 'worker/index.js'), 'utf8');
    const open = /const INSPIRE_OPEN_ROUTES = new Set\(\[([^\]]*)\]\)/.exec(src)[1].match(/'[^']+'/g).map((s) => s.slice(1, -1));
    assert.deepEqual(open.sort(), [...OPEN_ROUTES].sort());
    for (const o of OPEN_ROUTES) assert.ok(routes.some((r) => r.method + ' ' + r.path === o), 'open route exists: ' + o);
  });

  test('no session, stale / wrong-pv / expired / foreign tokens: 401 on every route but the open ones', async () => {
    const now = H.nowS();
    const pv = await boardPv({ JWT_SECRET: w.env.JWT_SECRET, FIKIR_BOARD_PASSWORD: BOARD_PW });
    const good = await signInspire({ g: 1, cid: 'gate-forged-cid-0001', name: 'F', pv, iat: now, exp: now + 3600 }, w.env.JWT_SECRET);
    assert.equal((await req('GET', '/api/inspire/posts', { token: good })).status, 200, 'sanity: the forging helper makes valid tokens');
    const bad = {
      'stale (no pv, minted before the gate)': await signInspire({ g: 1, cid: 'gate-stale-cid-00001', name: 'Eski', iat: now - 86400, exp: now + 86400 * 90 }, w.env.JWT_SECRET),
      'old password (wrong pv)': await signInspire({ g: 1, cid: 'gate-wrongpv-cid-001', name: 'W', pv: await boardPv({ JWT_SECRET: w.env.JWT_SECRET, FIKIR_BOARD_PASSWORD: 'old-pass' }), iat: now, exp: now + 3600 }, w.env.JWT_SECRET),
      'expired': await signInspire({ g: 1, cid: 'gate-expired-cid-001', name: 'X', pv, iat: now - 7200, exp: now - 1 }, w.env.JWT_SECRET),
      'foreign secret': await signInspire({ g: 1, cid: 'gate-foreign-cid-001', name: 'Y', pv, iat: now, exp: now + 3600 }, 'not-the-secret'),
      'garbage': 'abc.def.ghi',
    };
    let walked = 0;
    for (const r of routes) {
      const p = fill(r.path, ids);
      const none = await req(r.method, p);
      if (isOpen(r)) {
        assert.ok(!['session_expired'].includes(none.json && none.json.error) && !(none.status === 401 && none.json && none.json.error === 'unauthorized'),
          `${r.method} ${r.path} is open: ${none.status} ${JSON.stringify(none.json)}`);
        continue;
      }
      assert.equal(none.status, 401, `${r.method} ${r.path} without a session: ${none.status} ${JSON.stringify(none.json)}`);
      if (!isDownload(r)) assert.equal(none.json.error, 'unauthorized', `${r.method} ${r.path}`);
      for (const [label, t] of Object.entries(bad)) {
        const res = await req(r.method, p, { token: t });
        assert.equal(res.status, 401, `${r.method} ${r.path} with a ${label} token: ${res.status} ${JSON.stringify(res.json)}`);
        if (!isDownload(r)) assert.equal(res.json.error, 'session_expired', `${r.method} ${r.path} ${label}`);
      }
      walked++;
    }
    assert.ok(walked >= 27, `${walked} gated routes walked`);
    // an unknown path under /api/inspire is gated too (401, not 404 to strangers)
    assert.equal((await req('GET', '/api/inspire/nothing-here')).status, 401);
    // the download link without a ticket: a Turkish HTML page (navigation) or JSON (format=json), 401
    const html = await req('GET', `/api/inspire/posts/${ids.post}/download`, { headers: { Accept: 'text/html' } });
    assert.equal(html.status, 401); assert.match(html.headers['content-type'], /^text\/html/); assert.match(html.text(), /süresi doldu/);
    const j = await req('GET', `/api/inspire/posts/${ids.post}/download?format=json`);
    assert.equal(j.status, 401); assert.equal(j.json.error, 'unauthorized');
  });

  test('valid sessions pass the gate on every route (reads 200); the admin is unaffected', async () => {
    const reads = new Set(['GET /api/inspire/init', 'GET /api/inspire/posts', 'GET /api/inspire/posts/{post}/download-info', 'GET /api/inspire/storyboards/{sb}', 'GET /api/inspire/posts/{post}/download']);
    // guest first (not the owner of the seeded posts: no destructive effect), then the admin without DELETE /posts/{post}
    for (const [who, t] of [['guest', tok], ['admin', adm]]) {
      for (const r of routes) {
        if (isOpen(r) || (who === 'admin' && r.method === 'DELETE')) continue;
        const res = await req(r.method, fill(r.path, ids), { token: t });
        assert.notEqual(res.status, 401, `${who}: ${r.method} ${r.path}: ${JSON.stringify(res.json)}`);
        if (reads.has(r.method + ' ' + r.path)) assert.equal(res.status, 200, `${who}: ${r.method} ${r.path}: ${res.status} ${JSON.stringify(res.json)}`);
      }
    }
    assert.equal((await req('GET', '/api/inspire/sb-admin/usage', { token: tok })).status, 403);
    assert.equal((await req('GET', '/api/inspire/sb-admin/usage', { token: adm })).status, 200);
    const cfg = await req('GET', '/api/inspire/config', { token: tok });
    assert.equal(cfg.json.gate, true); assert.equal(cfg.json.locked, false); assert.equal(cfg.json.session, 'guest');
    assert.equal((await req('GET', '/api/inspire/config', { token: adm })).json.session, 'admin');
    assert.equal((await req('GET', '/api/inspire/config', { token: 'abc.def.ghi' })).json.session, 'expired');
    const anon = await req('GET', '/api/inspire/config');
    assert.equal(anon.json.session, 'none');
    assert.ok(!JSON.stringify(anon.json).includes('Bir fikir') && !('posts' in anon.json), 'config carries no board content');
    // an old cached board page (no X-Fikir-Client) with its pre-gate token: 401 on reads too
    const legacyTok = await signInspire({ g: 1, cid: 'gate-legacy-cid-0001', name: 'Eski', iat: Date.now() }, w.env.JWT_SECRET);
    assert.equal((await req('GET', '/api/inspire/posts', { token: legacyTok, legacy: true })).status, 401);
    assert.equal((await req('GET', '/api/inspire/posts', { legacy: true })).status, 401);
  });

  test('registered (non-admin) users: only an expiring token of a live account; no-exp (d9456ea-era) tokens and deleted users -> 401', async () => {
    const S = w.env.JWT_SECRET, now = H.nowS();
    const uid = Number(H.sqlRun(w, "INSERT INTO inspire_users (username, password, full_name, is_first_login) VALUES ('gate-kayitli', 'gate-user-pass', 'Kayıtlı', 0)").lastInsertRowid);
    const live = await signInspire({ userId: uid, username: 'gate-kayitli', iat: now, exp: now + 3600 }, S);
    assert.equal((await req('GET', '/api/inspire/posts', { token: live })).status, 200);
    assert.equal((await req('GET', '/api/inspire/config', { token: live })).json.session, 'user');
    const li = await req('POST', '/api/inspire/login', { body: { username: 'gate-kayitli', password: 'gate-user-pass' }, ip: '198.51.100.90' });
    assert.equal(li.status, 200, 'POST /login of a registered user still works');
    const minted = JSON.parse(Buffer.from(li.json.token.split('.')[1], 'base64url'));
    assert.ok(minted.exp > H.nowS() && !('pv' in minted), 'an expiring token, no board-password version');
    assert.equal((await req('GET', '/api/inspire/posts', { token: li.json.token })).status, 200);
    const refused = {
      'no exp (d9456ea-era token, iat in ms)': await signLegacyInspire({ userId: uid, username: 'gate-kayitli', iat: Date.now() - 300 * 86400e3 }, S),
      'no exp (seconds)': await signInspire({ userId: uid, username: 'gate-kayitli', iat: now }, S),
      'a user id that does not exist': await signInspire({ userId: 987654, username: 'deleted-user', iat: now, exp: now + 3600 }, S),
      'a no-exp token of a user that does not exist': await signLegacyInspire({ userId: 987654, username: 'deleted-user', iat: Date.now() }, S),
      'the id of another user (username mismatch)': await signInspire({ userId: uid, username: 'someone-else', iat: now, exp: now + 3600 }, S),
    };
    for (const [label, t] of Object.entries(refused)) {
      for (const p of ['/api/inspire/posts', `/api/inspire/posts/${ids.post}/download-info`, `/api/inspire/storyboards/${ids.sb}`]) {
        const r = await req('GET', p, { token: t });
        assert.equal(r.status, 401, `${label}: GET ${p} ${r.status}`); assert.equal(r.json.error, 'session_expired', label);
      }
      assert.equal((await req('GET', '/api/inspire/config', { token: t })).json.session, 'expired', label);
    }
    // the account deleted: its (otherwise valid) tokens stop at once
    H.sqlRun(w, 'DELETE FROM inspire_users WHERE id=?', uid);
    for (const t of [live, li.json.token]) {
      assert.equal((await req('GET', '/api/inspire/posts', { token: t })).status, 401);
      assert.equal((await req('GET', `/api/inspire/posts/${ids.post}/download-info`, { token: t })).status, 401, 'no download ticket either');
    }
    // the admin is unaffected (no row lookup; ADMIN_TOKENS_NOT_BEFORE as before)
    assert.equal((await req('GET', '/api/inspire/posts', { token: adm })).status, 200);
  });

  test('POST /guest: password required, name is only a display name, 503 while the secret is missing', async () => {
    const ip = '198.51.100.20';
    let r = await guestLogin({ cid: 'gate-guest-cid-0002', name: 'Bora' }, ip);
    assert.equal(r.status, 400); assert.equal(r.json.error, 'password_required');
    r = await guestLogin({ cid: 'gate-guest-cid-0002', name: '', password: BOARD_PW }, ip);
    assert.equal(r.status, 200); assert.equal(r.json.user.display_name, 'Anonim', 'anonymous: an empty name, still the password');
    const anonTok = r.json.token;
    assert.equal(JSON.parse(Buffer.from(anonTok.split('.')[1], 'base64url')).pv, await boardPv({ JWT_SECRET: w.env.JWT_SECRET, FIKIR_BOARD_PASSWORD: BOARD_PW }));
    assert.ok(!anonTok.includes(BOARD_PW) && !Buffer.from(anonTok.split('.')[1], 'base64url').toString().includes(BOARD_PW), 'the password is never in the token');
    r = await guestLogin({ cid: 'gate-guest-cid-0003', name: 'Patron', password: BOARD_PW }, ip);
    assert.equal(r.status, 200, 'a name is only a display name: it never logs anyone in as someone');
    assert.equal(r.json.user.is_admin, false);
    assert.equal((await req('GET', '/api/inspire/sb-admin/usage', { token: r.json.token })).status, 403);
    for (const name of ['Yönetici', 'vkesgin38']) {   // names that would pass for the owner stay refused (as before)
      r = await guestLogin({ cid: 'gate-guest-cid-0004', name, password: BOARD_PW }, ip);
      assert.equal(r.status, 400, name); assert.equal(r.json.error, 'reserved_name');
    }
    r = await guestLogin({ cid: 'gate-guest-cid-0004', name: 'Yönetici', password: 'wrong' }, ip);
    assert.equal(r.status, 401, 'the password is checked first');
    r = await guestLogin({ cid: 'bad', name: 'x', password: BOARD_PW }, ip);
    assert.equal(r.status, 400); assert.equal(r.json.error, 'invalid_cid');
    // device code restore: the same cid from another device = the same guest (owns its posts), with the password
    const restored = await guestLogin({ cid: 'gate-owner-cid-00001', name: 'Sahip', password: BOARD_PW }, ip);
    const mine = (await req('GET', '/api/inspire/posts', { token: restored.json.token })).json.find((p) => p.id === ids.post);
    assert.equal(mine.is_mine, true);
    // the secret missing: locked, never open; guest tokens rejected; the admin still works
    const saved = w.env.FIKIR_BOARD_PASSWORD;
    delete w.env.FIKIR_BOARD_PASSWORD;
    try {
      r = await guestLogin({ cid: 'gate-guest-cid-0005', name: 'x', password: BOARD_PW }, ip);
      assert.equal(r.status, 503); assert.equal(r.json.error, 'board_locked');
      r = await guestLogin({ cid: 'gate-guest-cid-0005', name: 'x', password: '' }, ip);
      assert.equal(r.status, 503, 'locked even for an empty password');
      assert.equal((await req('GET', '/api/inspire/posts', { token: anonTok })).status, 401);
      assert.equal((await req('GET', '/api/inspire/posts', { token: adm })).status, 200);
      assert.equal((await req('GET', '/api/inspire/config')).json.locked, true);
    } finally { w.env.FIKIR_BOARD_PASSWORD = saved; }
    assert.equal((await req('GET', '/api/inspire/posts', { token: anonTok })).status, 200, 'same secret again: the token is valid again');
  });

  test('wrong passwords: 401 with attempts left, 8 per IP / 15 min, then 429 with the wait (the right one too)', async () => {
    const ip = '198.51.100.30';
    for (let i = 1; i <= 8; i++) {
      const r = await guestLogin({ cid: 'gate-brute-cid-00001', name: '', password: 'guess-' + i }, ip);
      assert.equal(r.status, 401, `attempt ${i}`); assert.equal(r.json.error, 'bad_password'); assert.equal(r.json.attempts_left, 8 - i);
      assert.equal(r.json.message, 'Şifre yanlış.');
    }
    let r = await guestLogin({ cid: 'gate-brute-cid-00001', name: '', password: 'guess-9' }, ip);
    assert.equal(r.status, 429); assert.equal(r.json.error, 'too_many_attempts');
    assert.ok(r.json.retry_s > 0 && r.json.retry_s <= 900); assert.equal(r.headers['retry-after'], String(r.json.retry_s));
    assert.match(r.json.message, /^Çok fazla hatalı deneme\. \d+ dk sonra tekrar dene\.$/);
    r = await guestLogin({ cid: 'gate-brute-cid-00001', name: '', password: BOARD_PW }, ip);
    assert.equal(r.status, 429, 'the right password waits too (no oracle while locked out)');
    assert.equal((await guestLogin({ cid: 'gate-brute-cid-00002', name: '', password: BOARD_PW }, '198.51.100.31')).status, 200, 'another IP');
    assert.equal((await guestLogin({ cid: 'gate-brute-cid-00002', name: '', password: 'nope' }, '198.51.100.31')).json.attempts_left, 7, 'counted per IP');
    H.advanceClock(901);
    assert.equal((await guestLogin({ cid: 'gate-brute-cid-00001', name: '', password: BOARD_PW }, ip)).status, 200, 'after the window');
    // the admin login keeps its own counter and is not locked out by board-password failures
    assert.equal((await req('POST', '/api/inspire/login', { body: { username: 'vkesgin38', password: w.env.ADMIN_PASSWORD }, ip: '198.51.100.31' })).status, 200);
  });

  test('wrong passwords per network: one IPv6 /48 (or IPv4 /24) shares 40 per 15 min across its /64s (addresses)', async () => {
    H.advanceClock(901);   // fresh 15-minute windows
    const by = {};
    let last = null;
    for (let s = 1; s <= 6; s++) {
      for (let i = 1; i <= 9; i++) {
        last = await guestLogin({ cid: 'gate-net-cid-000001', name: '', password: `net-${s}-${i}` }, `2001:db8:abcd:${s}::${i}`);
        by[last.status] = (by[last.status] || 0) + 1;
      }
    }
    assert.deepEqual(by, { 401: 40, 429: 14 }, 'at most 40 compared in the /48: ' + JSON.stringify(by));
    assert.equal(last.json.error, 'too_many_attempts');
    assert.match(last.json.message, /^Bu ağdan çok fazla hatalı deneme\. \d+ dk sonra tekrar dene\.$/);
    assert.ok(Number(last.headers['retry-after']) > 0 && last.json.retry_s > 0);
    let r = await guestLogin({ cid: 'gate-net-cid-000002', name: '', password: BOARD_PW }, '2001:db8:abcd:ff::1');
    assert.equal(r.status, 429, 'a fresh /64 of the same /48 waits too, even with the right password');
    assert.equal((await guestLogin({ cid: 'gate-net-cid-000002', name: '', password: BOARD_PW }, '2001:db8:abce:1::1')).status, 200, 'another /48');
    // IPv4: the /24
    for (let a = 1; a <= 5; a++) for (let i = 1; i <= 8; i++) {
      assert.equal((await guestLogin({ cid: 'gate-net-cid-000003', name: '', password: `v4-${a}-${i}` }, `192.0.2.${a}`)).status, 401);
    }
    r = await guestLogin({ cid: 'gate-net-cid-000003', name: '', password: 'v4-6-1' }, '192.0.2.6');
    assert.equal(r.status, 429); assert.match(r.json.message, /^Bu ağdan/);
    assert.equal((await guestLogin({ cid: 'gate-net-cid-000003', name: '', password: BOARD_PW }, '192.0.3.6')).status, 200, 'another /24');
    H.advanceClock(901);
    assert.equal((await guestLogin({ cid: 'gate-net-cid-000002', name: '', password: BOARD_PW }, '2001:db8:abcd:ff::1')).status, 200, 'after the window');
  });

  test('site-wide budget: over 300 wrong passwords an hour only IPs with a recent right password are still checked', async () => {
    H.advanceClock(3601);   // fresh windows
    const known = '198.51.100.120';
    assert.equal((await guestLogin({ cid: 'gate-all-cid-000001', name: '', password: BOARD_PW }, known)).status, 200, 'marks a recent success');
    const by = {};
    let last = null;
    for (let a = 1; a <= 38; a++) for (let i = 1; i <= 8; i++) {   // 304 wrong guesses from 38 different /24s (8 each)
      last = await guestLogin({ cid: 'gate-all-cid-000002', name: '', password: `all-${a}-${i}` }, `10.${a}.0.1`);
      by[last.status] = (by[last.status] || 0) + 1;
    }
    assert.deepEqual(by, { 401: 300, 429: 4 }, JSON.stringify(by));
    assert.equal(last.json.error, 'too_many_attempts');
    assert.match(last.json.message, /^Şu an çok fazla hatalı giriş denemesi var\. \d+ dk sonra tekrar dene\.$/);
    assert.ok(last.json.retry_s > 0 && last.json.retry_s <= 3600);
    assert.equal((await guestLogin({ cid: 'gate-all-cid-000003', name: '', password: BOARD_PW }, '10.200.0.1')).status, 429, 'a new IP waits (nothing compared)');
    const w1 = await guestLogin({ cid: 'gate-all-cid-000001', name: '', password: 'typo' }, known);
    assert.equal(w1.status, 401, 'an IP with a recent right password is still checked'); assert.equal(w1.json.attempts_left, 7);
    assert.equal((await guestLogin({ cid: 'gate-all-cid-000001', name: '', password: BOARD_PW }, known)).status, 200);
    // the blocked IPs' own counters were given back (not compared): after the hour they have all 8 attempts again
    H.advanceClock(3601);
    assert.equal((await guestLogin({ cid: 'gate-all-cid-000003', name: '', password: BOARD_PW }, '10.200.0.1')).status, 200, 'after the hour');
    assert.equal((await guestLogin({ cid: 'gate-all-cid-000003', name: '', password: 'typo' }, '10.38.0.1')).json.attempts_left, 7);
  });

  test('the board password limiter fails closed: a counter that cannot be updated -> 503, nothing compared', async () => {
    H.advanceClock(3601);
    const ip = '198.51.100.130';
    // one counter failing (the site-wide one, e.g. D1 overloaded): refused, and the earlier counters get their hit back
    w.sq.exec("CREATE TRIGGER gate_fail_all BEFORE INSERT ON inspire_rate WHEN NEW.k LIKE 'board_pw_all:%' BEGIN SELECT RAISE(ABORT, 'overloaded'); END");
    try {
      for (const password of [BOARD_PW, 'wrong-1', 'wrong-2']) {
        const r = await guestLogin({ cid: 'gate-fail-cid-00001', name: '', password }, ip);
        assert.equal(r.status, 503, password === BOARD_PW ? 'right password' : 'wrong password'); assert.equal(r.json.error, 'login_unavailable');
        assert.equal(r.json.message, 'Giriş şu anda doğrulanamıyor. Biraz sonra tekrar dene.'); assert.equal(r.headers['retry-after'], '30');
      }
    } finally { w.sq.exec('DROP TRIGGER gate_fail_all'); }
    assert.equal((await guestLogin({ cid: 'gate-fail-cid-00001', name: '', password: 'wrong-3' }, ip)).json.attempts_left, 7, 'the refused attempts were not counted');
    // the whole table gone: every attempt refused (503), the rest of the board unaffected (other limiters fail open)
    w.sq.exec('ALTER TABLE inspire_rate RENAME TO inspire_rate_gone');
    try {
      for (const password of [BOARD_PW, 'wrong-4']) {
        const r = await guestLogin({ cid: 'gate-fail-cid-00001', name: '', password }, ip);
        assert.equal(r.status, 503); assert.equal(r.json.error, 'login_unavailable');
      }
      assert.equal((await req('GET', '/api/inspire/posts', { token: tok })).status, 200);
    } finally { w.sq.exec('ALTER TABLE inspire_rate_gone RENAME TO inspire_rate'); }
    assert.equal((await guestLogin({ cid: 'gate-fail-cid-00001', name: '', password: BOARD_PW }, ip)).status, 200, 'back to normal');
  });

  test('POST /guest/rename: same cid and pv, no password; guests only', async () => {
    const r = await req('POST', '/api/inspire/guest/rename', { token: tok, body: { name: 'Ayşe K.' } });
    assert.equal(r.status, 200, JSON.stringify(r.json));
    assert.equal(r.json.user.display_name, 'Ayşe K.');
    const p = JSON.parse(Buffer.from(r.json.token.split('.')[1], 'base64url'));
    const old = JSON.parse(Buffer.from(tok.split('.')[1], 'base64url'));
    assert.equal(p.cid, old.cid); assert.equal(p.pv, old.pv); assert.equal(p.name, 'Ayşe K.');
    assert.equal((await req('POST', '/api/inspire/guest/rename', { token: tok, body: { name: '' } })).json.user.display_name, 'Anonim');
    assert.equal((await req('POST', '/api/inspire/guest/rename', { token: tok, body: { name: 'Admin' } })).json.error, 'reserved_name');
    assert.equal((await req('POST', '/api/inspire/guest/rename', { token: adm, body: { name: 'x' } })).status, 403);
    assert.equal((await req('POST', '/api/inspire/guest/rename', { body: { name: 'x' } })).status, 401);
  });

  test('download tickets: every session gets one; bound to the post; 15 minutes; the admin ticket skips the daily budget', async () => {
    const info = await req('GET', `/api/inspire/posts/${ids.post}/download-info`, { token: tok });
    assert.equal(info.status, 200);
    assert.match(info.json.url, new RegExp(`^/api/inspire/posts/${ids.post}/download\\?k=[0-9a-z]+\\.g\\.[A-Za-z0-9_-]{22}$`));
    assert.equal(info.headers['cache-control'], 'private, no-store');
    const k = info.json.url.split('?k=')[1];
    let r = await req('GET', info.json.url);
    assert.equal(r.status, 200, r.text().slice(0, 200)); assert.equal(r.headers['content-type'], 'video/mp4');
    assert.equal((await req('GET', `/api/inspire/posts/${ids.text}/download?format=json&k=${k}`)).status, 401, "another post's ticket");
    assert.equal((await req('GET', `/api/inspire/posts/${ids.post}/download?format=json&k=${k.replace(/.$/, (c) => (c === 'A' ? 'B' : 'A'))}`)).status, 401, 'forged');
    const ai = await req('GET', `/api/inspire/posts/${ids.post}/download-info`, { token: adm });
    assert.match(ai.json.url, /\?k=[0-9a-z]+\.a\.[A-Za-z0-9_-]{22}$/);
    // the day's upstream budget spent by others: a guest ticket gets 429, the admin ticket is exempt
    const day = new Date((H.nowS()) * 1000).toISOString().slice(0, 10);
    H.sqlRun(w, "INSERT OR REPLACE INTO inspire_quota (day, scope, subject, n, lim) VALUES (?, 'dl', '', 1500, 1500)", day);
    r = await req('GET', `/api/inspire/posts/${ids.post}/download?part=image&format=json&k=${k}`);
    assert.equal(r.status, 200, 'our R2 poster never counts');
    H.sqlRun(w, 'UPDATE inspire_posts SET media=NULL WHERE id=?', ids.post);   // the link-preview video (upstream) only
    try {
      r = await req('GET', `/api/inspire/posts/${ids.post}/download?format=json&k=${k}`);
      assert.equal(r.status, 429, JSON.stringify(r.json)); assert.equal(r.json.error, 'quota_exceeded');
      r = await req('GET', ai.json.url + '&format=json');
      assert.equal(r.status, 200, JSON.stringify(r.json)); assert.equal(r.headers['content-type'], 'video/mp4');
    } finally {
      H.sqlRun(w, 'UPDATE inspire_posts SET media=? WHERE id=?', JSON.stringify({ kind: 'video', url: '/files/' + files.vKey, poster: '/files/' + files.pKey, mime: 'video/mp4', bytes: 8, verified: true, source: 'upload' }), ids.post);
      H.sqlRun(w, "DELETE FROM inspire_quota WHERE scope='dl'");
    }
    H.advanceClock(DL_TICKET_S + 1);
    r = await req('GET', info.json.url + '&format=json');
    assert.equal(r.status, 401, 'expired ticket'); assert.match(r.json.message, /süresi doldu/);
  });

  test('/files: board files need a fresh files token (?t=) that the API appends; other files stay public', async () => {
    const board = (await req('GET', '/api/inspire/posts', { token: tok })).json;
    const lp = board.find((p) => p.id === ids.post), tp = board.find((p) => p.id === ids.text);
    assert.match(lp.media.url, new RegExp(`^/files/${files.vKey}\\?t=[0-9a-z]+\\.[A-Za-z0-9_-]{22}$`));
    assert.match(lp.media.poster, new RegExp(`^/files/${files.pKey}\\?t=`));
    assert.match(tp.storyboard.thumbs[0].path, new RegExp(`^/files/${files.frameKey}\\?t=`));
    const t = lp.media.url.split('?t=')[1];
    const sbFull = (await req('GET', `/api/inspire/storyboards/${ids.sb}`, { token: tok })).json;
    assert.equal(sbFull.frames[0].path, `/files/${files.frameKey}?t=${t}`, 'the viewer data too, same token');
    let r = await req('GET', lp.media.url);
    assert.equal(r.status, 200);
    assert.match(r.headers['cache-control'], /^private, max-age=\d+, immutable$/);
    assert.ok(Number(/max-age=(\d+)/.exec(r.headers['cache-control'])[1]) <= 86400);
    assert.equal(r.headers['content-security-policy'], "default-src 'none'; sandbox");
    assert.equal((await req('GET', sbFull.frames[0].path)).status, 200);
    for (const p of ['/files/' + files.vKey, '/files/' + files.frameKey, `/files/${files.vKey}?t=`, `/files/${files.vKey}?t=${t.split('.')[0]}.${'A'.repeat(22)}`]) {
      r = await req('GET', p);
      assert.equal(r.status, 403, p); assert.equal(r.headers['cache-control'], 'no-store');
    }
    assert.equal((await req('GET', '/files/fikir/1/v-zz.mp4')).status, 404, 'malformed fikir/ keys: 404 as before');
    r = await req('GET', '/files/images/0123456789abcdef.jpg');
    assert.equal(r.status, 200, 'a portfolio / UI-library file needs no token'); assert.equal(r.headers['cache-control'], 'public, max-age=31536000');
    // errors and open routes carry no tokens; the admin's lists are signed too
    assert.match((await req('GET', '/api/inspire/posts', { token: adm })).json.find((p) => p.id === ids.post).media.url, /\?t=/);
    // FIKIR_FILES_GATE="0": public by unguessable URL again (rollback switch)
    w.env.FIKIR_FILES_GATE = '0';
    try {
      const plain = (await req('GET', '/api/inspire/posts', { token: tok })).json.find((p) => p.id === ids.post);
      assert.equal(plain.media.url, '/files/' + files.vKey);
      assert.equal((await req('GET', '/files/' + files.vKey)).status, 200);
    } finally { w.env.FIKIR_FILES_GATE = '1'; }
    // a token past its life
    H.advanceClock(2 * FILES_WINDOW_S + 1);
    assert.equal((await req('GET', lp.media.url)).status, 403, 'expired files token');
  });

  test('a new board password logs every guest out (tokens, tickets, file links); the admin is unaffected', async () => {
    const g = (await guestLogin({ cid: 'gate-rotate-cid-0001', name: 'R', password: BOARD_PW }, '198.51.100.40')).json.token;
    const fileUrl = (await req('GET', '/api/inspire/posts', { token: g })).json.find((p) => p.id === ids.post).media.url;
    const link = (await req('GET', `/api/inspire/posts/${ids.post}/download-info`, { token: g })).json.url;
    const saved = w.env.FIKIR_BOARD_PASSWORD;
    w.env.FIKIR_BOARD_PASSWORD = 'harness-board-pass-2';
    try {
      const r = await req('GET', '/api/inspire/posts', { token: g });
      assert.equal(r.status, 401); assert.equal(r.json.error, 'session_expired');
      assert.equal(r.json.message, 'Oturumun sona erdi, şifreyle tekrar gir.');
      assert.equal((await req('GET', fileUrl)).status, 403);
      assert.equal((await req('GET', link + '&format=json')).status, 401);
      assert.equal((await guestLogin({ cid: 'gate-rotate-cid-0001', name: 'R', password: BOARD_PW }, '198.51.100.40')).status, 401, 'the old password');
      const fresh = await guestLogin({ cid: 'gate-rotate-cid-0001', name: 'R', password: 'harness-board-pass-2' }, '198.51.100.40');
      assert.equal(fresh.status, 200);
      assert.equal((await req('GET', '/api/inspire/posts', { token: fresh.json.token })).status, 200);
      assert.equal((await req('GET', '/api/inspire/posts', { token: adm })).status, 200, 'admin token unaffected');
    } finally { w.env.FIKIR_BOARD_PASSWORD = saved; }
  });

  test('YouTube / Vimeo: download-info says why (unsupported); auto / video -> 422, never the thumbnail; part=image works', async () => {
    const info = await req('GET', `/api/inspire/posts/${ids.yt}/download-info`, { token: tok });
    assert.equal(info.status, 200);
    const { video, image, reason, message, unsupported, adapter } = info.json;
    assert.deepEqual({ video, image, reason, message, unsupported, adapter },
      { video: false, image: true, reason: 'not_supported', message: 'YouTube videoları siteden indirilemiyor — YouTube buna izin vermiyor.', unsupported: true, adapter: 'youtube' });
    const day = new Date(H.nowS() * 1000).toISOString().slice(0, 10);
    const dlUnits = () => (H.sqlAll(w, "SELECT n FROM inspire_quota WHERE day=? AND scope='dl'", day)[0] || { n: 0 }).n;
    const u0 = dlUnits();
    const auto = await H.runRequest(w, warm, 'GET', info.json.url + '&format=json');
    assert.equal(auto.result.status, 422, JSON.stringify(auto.result.json));
    assert.deepEqual({ ...auto.result.json, source: undefined }, { error: 'not_downloadable', message: info.json.message, reason: 'not_supported', unsupported: true,
      platform: 'youtube', image: true, source: undefined });
    assert.equal(auto.fetch, 0, 'no request to YouTube or its thumbnail'); assert.equal(dlUnits(), u0, 'no daily budget unit');
    const vid = await req('GET', info.json.url + '&part=video&format=json');
    assert.equal(vid.status, 422); assert.equal(vid.json.unsupported, true);
    const page = await req('GET', info.json.url, { headers: { Accept: 'text/html' } });
    assert.equal(page.status, 422); assert.match(page.headers['content-type'], /^text\/html/);
    const t = page.text();
    assert.ok(t.includes('YouTube videoları siteden indirilemiyor'));
    assert.ok(t.includes(`href="/api/inspire/posts/${ids.yt}/download?part=image&amp;k=`), 'a "Kapak görselini indir" link with the same ticket');
    assert.ok(t.includes('Kapak görselini indir'));
    const img = await req('GET', info.json.url + '&part=image');
    assert.equal(img.status, 200, img.text().slice(0, 200)); assert.equal(img.headers['content-type'], 'image/jpeg');
    assert.match(img.headers['content-disposition'], /^attachment; filename="youtube-/);
    // a (past) live stream link too; Vimeo: DRM
    const live = await req('GET', `/api/inspire/posts/${ids.ytLive}/download-info`, { token: tok });
    assert.equal(live.json.unsupported, true); assert.equal(live.json.reason, 'not_supported');
    assert.equal((await req('GET', live.json.url + '&format=json')).status, 422);
    const vi = await req('GET', `/api/inspire/posts/${ids.vimeo}/download-info`, { token: tok });
    assert.deepEqual({ video: vi.json.video, image: vi.json.image, reason: vi.json.reason, unsupported: vi.json.unsupported },
      { video: false, image: true, reason: 'drm', unsupported: true });
    assert.match(vi.json.message, /^Vimeo videoları siteden indirilemiyor/);
    const va = await req('GET', vi.json.url + '&format=json');
    assert.equal(va.status, 422); assert.equal(va.json.reason, 'drm'); assert.equal(va.json.image, true);
    // the board's hint (GET /posts) keeps saying so up front
    const b = (await req('GET', '/api/inspire/posts', { token: tok })).json.find((p) => p.id === ids.yt);
    assert.deepEqual(b.dl, { video: false, image: true, reason: 'not_supported' });
  });

  test('the rest of the site is unaffected: projects, KPSS, portfolio admin, CORS preflight', async () => {
    assert.equal((await req('GET', '/api/projects')).status, 200);
    const k = await req('POST', '/api/kpss/login', { body: { username: 'vkesgin38', password: w.env.ADMIN_PASSWORD } });
    assert.equal(k.status, 200, JSON.stringify(k.json));
    assert.equal((await req('GET', '/api/kpss/plans', { token: k.json.token })).status, 200);
    assert.equal((await req('GET', '/api/kpss/plans')).status, 401, "KPSS's own auth, not the board's");
    const pre = await req('OPTIONS', '/api/inspire/posts');
    assert.equal(pre.status, 204); assert.match(pre.headers['access-control-allow-headers'], /X-Fikir-Client/);
    // the portfolio admin JWT still deletes board posts (and nothing else on the board)
    const site = await req('POST', '/api/auth/login', { body: { password: w.env.ADMIN_PASSWORD } });
    assert.equal(site.status, 200);
    assert.equal((await req('GET', '/api/inspire/posts', { token: site.json.token })).status, 401);
    const victim = Number(H.sqlRun(w, "INSERT INTO inspire_posts (user_id, type, url, description) VALUES (1, 'text', '', 'sil')").lastInsertRowid);
    assert.equal((await req('DELETE', `/api/inspire/posts/${victim}`, { token: site.json.token })).status, 200);
    assert.equal((await req('DELETE', `/api/inspire/posts/${ids.text}`, { token: tok })).status, 403, 'a guest who does not own it');
    assert.equal((await req('DELETE', `/api/inspire/posts/${ids.text}`, { token: adm })).status, 200, 'the admin');
  });
});

test('no real board password in the repo configs (FIKIR_BOARD_PASSWORD is a secret, documented by name only)', () => {
  for (const f of ['worker/wrangler.toml', 'worker/wrangler.mediatest.toml', 'worker/wrangler.sbtest.toml', 'wrangler.jsonc']) {
    const p = path.join(H.ROOT, f);
    if (!fs.existsSync(p)) continue;
    const src = fs.readFileSync(p, 'utf8');
    assert.ok(!/^\s*FIKIR_BOARD_PASSWORD\s*=/m.test(src) && !/"FIKIR_BOARD_PASSWORD"\s*:/.test(src), f + ' sets FIKIR_BOARD_PASSWORD');
  }
  assert.ok(/FIKIR_BOARD_PASSWORD/.test(fs.readFileSync(path.join(H.ROOT, 'worker/wrangler.toml'), 'utf8')), 'named in the secrets list');
});
