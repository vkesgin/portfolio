// Company tags ("Firma") of board posts: schema, post-row column, GET /posts filter and the /api/inspire/tags routes.
// Name rules (Turkish fold, slugs, colors) come from the shared module the board uses too (assets/js/fikir-tags.mjs).
//   inspire_tags        id, name (display), fold (UNIQUE dedupe key), slug (UNIQUE, URL; changes on rename), color, created_by, created_at
//   inspire_post_tags   (post_id, tag_id) links; FKs cascade in D1. Every read JOINs live rows, so an orphan link never counts.
// Permissions: any session creates a company (at most TAG_UNUSED_PER_CREATOR unused ones each; the admin is exempt from that
// and from the catalog cap) and lists them; the post owner or the admin sets a post's companies; only the admin renames,
// recolors, merges or deletes a company, or deletes every unused one at once. Names leave only as JSON (the board renders
// them as text).
import {
  TAG_COLORS, TAG_PER_POST_MAX, TAG_CATALOG_MAX, TAG_NAME_MAX, TAG_FILTER_MAX, checkTagName, tagFold, tagSlugBase, tagDefaultColor,
} from '../assets/js/fikir-tags.mjs';

export const TAGS_TABLES = ['inspire_tags', 'inspire_post_tags'];
export const TAGS_INDEX_NAME = 'idx_inspire_post_tags_tag';
export const TAGS_DDL = [
  `CREATE TABLE IF NOT EXISTS inspire_tags (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      fold TEXT NOT NULL UNIQUE,
      slug TEXT NOT NULL UNIQUE,
      color TEXT NOT NULL DEFAULT 'cyan',
      created_by TEXT,
      created_at INTEGER NOT NULL
    )`,
  `CREATE TABLE IF NOT EXISTS inspire_post_tags (
      post_id INTEGER NOT NULL,
      tag_id INTEGER NOT NULL,
      created_at INTEGER NOT NULL,
      PRIMARY KEY (post_id, tag_id),
      FOREIGN KEY(post_id) REFERENCES inspire_posts(id) ON DELETE CASCADE,
      FOREIGN KEY(tag_id) REFERENCES inspire_tags(id) ON DELETE CASCADE
    ) WITHOUT ROWID`,
];
export const TAGS_INDEX = `CREATE INDEX IF NOT EXISTS ${TAGS_INDEX_NAME} ON inspire_post_tags(tag_id, post_id)`;

// One more column of the post select (alias p): the post's live companies as JSON ('[]' without any). 0 statements more.
// 'f' is the stored fold (the sort key of tagsOut; never output): GET /posts sorts up to 200 x 10 tags per page, and folding
// the names there (NFKD + Unicode regexes per comparison) cost about as much CPU as the Free plan's 10 ms.
export const TAGS_POST_COLUMN = `(SELECT json_group_array(json_object('id', t.id, 'name', t.name, 'slug', t.slug, 'color', t.color, 'f', t.fold))
      FROM inspire_post_tags pt JOIN inspire_tags t ON t.id = pt.tag_id WHERE pt.post_id = p.id) AS tags_json`;

// fold (UNIQUE, so ties only between rows without one), then id: plain string compares, no Unicode work
const byFold = (a, b) => (a.f < b.f ? -1 : a.f > b.f ? 1 : a.t.id - b.t.id);
const colorOk = (c) => (TAG_COLORS.includes(c) ? c : 'cyan');
const tagRowOut = (r) => ({ id: Number(r.id), name: String(r.name), slug: String(r.slug), color: colorOk(r.color) });

// tags_json -> [{id, name, slug, color}] sorted by the stored fold (each name folded at most once when it is missing); []
// for anything unreadable
export function tagsOut(json) {
  if (typeof json !== 'string' || !json) return [];
  let arr;
  try { arr = JSON.parse(json); } catch { return []; }
  if (!Array.isArray(arr)) return [];
  const rows = [];
  for (const t of arr) {
    if (!t || typeof t !== 'object' || !Number.isInteger(t.id) || typeof t.name !== 'string' || typeof t.slug !== 'string') continue;
    rows.push({ f: typeof t.f === 'string' ? t.f : tagFold(t.name), t: tagRowOut(t) });
  }
  if (rows.length > 1) rows.sort(byFold);
  return rows.map((r) => r.t);
}

// tag_ids of a request body: undefined / null -> []; an array of <= TAG_PER_POST_MAX positive integers -> deduped; else null
export function parseTagIds(v) {
  if (v == null) return [];
  if (!Array.isArray(v) || v.length > TAG_PER_POST_MAX) return null;
  const out = [];
  for (const x of v) {
    if (!Number.isSafeInteger(x) || x < 1) return null;
    if (!out.includes(x)) out.push(x);
  }
  return out;
}

// GET /posts ?tags=1,2&match=any|all&untagged=0|1 -> null (no filter) | {json: '[1,2]' | null, all: 0|1, untagged: 0|1} | 'bad'
const TAGS_PARAM_RE = new RegExp(`^\\d{1,15}(?:,\\d{1,15}){0,${TAG_FILTER_MAX - 1}}$`);
export function parseTagFilter(q) {
  const tags = q.get('tags'), match = q.get('match'), untagged = q.get('untagged');
  if (tags != null && tags !== '' && !TAGS_PARAM_RE.test(tags)) return 'bad';
  if (match != null && match !== 'any' && match !== 'all') return 'bad';
  if (untagged != null && untagged !== '0' && untagged !== '1') return 'bad';
  const ids = tags ? [...new Set(tags.split(',').map(Number))] : [];
  if (!ids.length && untagged !== '1') return null;
  return { json: ids.length ? JSON.stringify(ids) : null, all: match === 'all' ? 1 : 0, untagged: untagged === '1' ? 1 : 0 };
}
// SQL condition on posts alias `a`; ?n = JSON ids | NULL, ?n+1 = all, ?n+2 = untagged. Untagged is OR-ed in both modes.
// any: one of the ids (unknown ids never match); all: every KNOWN id of the set (a set of only unknown ids matches nothing).
export const tagFilterSql = (a, n) => `(
    (?${n} IS NOT NULL AND ?${n + 1} = 0 AND EXISTS (SELECT 1 FROM inspire_post_tags f JOIN inspire_tags t ON t.id = f.tag_id
       WHERE f.post_id = ${a}.id AND f.tag_id IN (SELECT value FROM json_each(?${n}))))
    OR (?${n} IS NOT NULL AND ?${n + 1} = 1
       AND EXISTS (SELECT 1 FROM inspire_tags WHERE id IN (SELECT value FROM json_each(?${n})))
       AND (SELECT COUNT(*) FROM inspire_post_tags f JOIN inspire_tags t ON t.id = f.tag_id WHERE f.post_id = ${a}.id
              AND f.tag_id IN (SELECT value FROM json_each(?${n})))
         = (SELECT COUNT(*) FROM inspire_tags WHERE id IN (SELECT value FROM json_each(?${n}))))
    OR (?${n + 2} = 1 AND NOT EXISTS (SELECT 1 FROM inspire_post_tags f JOIN inspire_tags t ON t.id = f.tag_id WHERE f.post_id = ${a}.id)))`;

// Links of a post to existing companies (?1 post id, ?2 JSON ids, ?3 now s); unknown ids are dropped, a deleted post gets none.
export const POST_TAGS_INSERT = `INSERT OR IGNORE INTO inspire_post_tags (post_id, tag_id, created_at)
  SELECT ?1, t.id, ?3 FROM inspire_tags t WHERE t.id IN (SELECT value FROM json_each(?2))
    AND EXISTS (SELECT 1 FROM inspire_posts WHERE id = ?1)`;
export const POST_TAGS_DELETE = 'DELETE FROM inspire_post_tags WHERE post_id=?';

const nowS = () => Math.floor(Date.now() / 1000);
// A fresh slug for row ?2 (fold or id) that holds slug ?1 || '~new': the base, else base-<id>, else base-<id>-<random>
const slugFixSql = (where) => `UPDATE inspire_tags SET slug = CASE
    WHEN NOT EXISTS (SELECT 1 FROM inspire_tags o WHERE o.slug = ?1) THEN ?1
    WHEN NOT EXISTS (SELECT 1 FROM inspire_tags o WHERE o.slug = ?1 || '-' || inspire_tags.id) THEN ?1 || '-' || id
    ELSE ?1 || '-' || id || '-' || lower(hex(randomblob(3))) END
  WHERE ${where} AND slug = ?1 || '~new'`;
const uniqueError = (e) => /UNIQUE/i.test(String(e && e.message));

// deps: { db, fail(status, error, message, extra), ok(data, status), actor, readBody(), overLimit(pairs) -> bool, limited(),
//         actorKey, ipKey, postSelect, ownerParams(actor), postOut(row, isAdmin, notes) }

// GET /api/inspire/tags: the catalog with post counts (live posts only), the untagged / total counts, what the caller may do
export async function tagsList({ db, ok, actor }) {
  const [list, totals] = await db.batch([
    db.prepare(`SELECT t.id, t.name, t.slug, t.color,
        (SELECT COUNT(*) FROM inspire_post_tags pt JOIN inspire_posts p ON p.id = pt.post_id WHERE pt.tag_id = t.id) AS n
      FROM inspire_tags t ORDER BY t.fold LIMIT ?1`).bind(TAG_CATALOG_MAX),
    db.prepare(`SELECT COUNT(*) AS total, COALESCE(SUM(NOT EXISTS (SELECT 1 FROM inspire_post_tags pt JOIN inspire_tags x ON x.id = pt.tag_id
        WHERE pt.post_id = p.id)), 0) AS untagged FROM inspire_posts p`),
  ]);
  const t = (totals.results || [])[0] || {};
  return ok({
    tags: (list.results || []).map((r) => ({ ...tagRowOut(r), count: Number(r.n) || 0 })),
    untagged: Number(t.untagged) || 0, total: Number(t.total) || 0, can_manage: !!(actor && actor.isAdmin),
    limits: { per_post: TAG_PER_POST_MAX, name_max: TAG_NAME_MAX, max: TAG_CATALOG_MAX }, colors: TAG_COLORS,
  });
}

// A company "in use" has a link to a live post (orphan links of deleted posts do not count)
const TAG_USED_SQL = (t) => `EXISTS (SELECT 1 FROM inspire_post_tags pt JOIN inspire_posts p ON p.id = pt.post_id WHERE pt.tag_id = ${t}.id)`;
// Companies one creator (cid / user) may hold that no idea uses yet: a board member cannot fill the shared catalog alone
export const TAG_UNUSED_PER_CREATOR = 10;
// "Kullanılmayanları sil" leaves companies this young alone (someone may be about to post with the one just created)
export const TAG_PRUNE_GRACE_S = 600;

// POST /api/inspire/tags {name, color?}: 201 {tag, created: true}; an existing name (Turkish case / diacritics-insensitive)
// 200 {tag, created: false}; catalog full 409 tag_limit; the creator's unused companies at the cap 409 tag_unused_limit.
// The admin is exempt from both caps (and so can always add a company, even to a catalog a board member filled).
export async function tagCreate({ db, fail, ok, actor, readBody, overLimit, limited, actorKey, ipKey }) {
  const d = await readBody();
  if (!d) return fail(400, 'bad_request', 'Geçersiz istek');
  const c = checkTagName(d.name);
  if (c.error) return fail(400, c.error, c.message);
  const color = TAG_COLORS.includes(d.color) ? d.color : tagDefaultColor(c.fold);
  if (await overLimit([['tag', actorKey], ['tag_ip', ipKey]])) return limited();
  const slug = tagSlugBase(c.fold);
  const admin = actor && actor.isAdmin ? 1 : 0;
  let res;
  try {
    res = await db.batch([
      db.prepare(`INSERT INTO inspire_tags (name, fold, slug, color, created_by, created_at)
        SELECT ?1, ?2, ?3 || '~new', ?4, ?5, ?6 WHERE ?8 = 1 OR ((SELECT COUNT(*) FROM inspire_tags) < ?7
          AND (SELECT COUNT(*) FROM inspire_tags u WHERE u.created_by = ?5 AND NOT ${TAG_USED_SQL('u')}) < ?9)
        ON CONFLICT(fold) DO NOTHING`).bind(c.name, c.fold, slug, color, actorKey, nowS(), TAG_CATALOG_MAX, admin, TAG_UNUSED_PER_CREATOR),
      db.prepare(slugFixSql('fold = ?2')).bind(slug, c.fold),
      db.prepare('SELECT id, name, slug, color FROM inspire_tags WHERE fold = ?1').bind(c.fold),
    ]);
  } catch (e) {
    if (uniqueError(e)) return fail(409, 'retry', 'Firma şu an eklenemedi, tekrar dene');
    throw e;
  }
  const row = (res[2].results || [])[0];
  if (!row) {
    // refused (only here: one statement more): which cap?
    const r = await db.prepare(`SELECT (SELECT COUNT(*) FROM inspire_tags) AS total,
        (SELECT COUNT(*) FROM inspire_tags u WHERE u.created_by = ?1 AND NOT ${TAG_USED_SQL('u')}) AS unused`).bind(actorKey).first();
    if (r && Number(r.total) < TAG_CATALOG_MAX && Number(r.unused) >= TAG_UNUSED_PER_CREATOR) {
      return fail(409, 'tag_unused_limit', `Henüz hiçbir fikirde kullanılmayan ${TAG_UNUSED_PER_CREATOR} firman var; yenisini eklemeden önce onları bir fikirde kullan`);
    }
    return fail(409, 'tag_limit', 'Firma listesi dolu; yöneticinin kullanılmayanları silmesi gerekiyor');
  }
  const created = !!(res[0].meta && res[0].meta.changes);
  return ok({ tag: tagRowOut(row), created }, created ? 201 : 200);
}

// DELETE /api/inspire/tags/unused (admin): every company no idea uses (older than TAG_PRUNE_GRACE_S) in one step
// -> {ok, removed}. Ideas are never touched; orphan links of deleted posts go with their company.
export async function tagsPruneUnused({ db, fail, ok, actor }) {
  if (!actor || !actor.isAdmin) return fail(403, 'forbidden', 'Firmaları yalnızca yönetici düzenleyebilir');
  const before = nowS() - TAG_PRUNE_GRACE_S;
  const unused = `SELECT t.id FROM inspire_tags t WHERE t.created_at < ?1 AND NOT ${TAG_USED_SQL('t')}`;
  const res = await db.batch([
    db.prepare(`DELETE FROM inspire_post_tags WHERE tag_id IN (${unused})`).bind(before),
    db.prepare(`DELETE FROM inspire_tags WHERE id IN (${unused})`).bind(before),
  ]);
  return ok({ ok: true, removed: Number(res[1].meta && res[1].meta.changes) || 0 });
}

// PUT /api/inspire/tags/:id {name} | {color} | {merge_into} and DELETE /api/inspire/tags/:id (admin only)
export async function tagEdit({ db, fail, ok, actor, readBody }, id, method) {
  if (!actor || !actor.isAdmin) return fail(403, 'forbidden', 'Firmaları yalnızca yönetici düzenleyebilir');
  if (method === 'DELETE') {
    const res = await db.batch([
      db.prepare('SELECT COUNT(*) AS n FROM inspire_post_tags WHERE tag_id=?1').bind(id),
      db.prepare('DELETE FROM inspire_post_tags WHERE tag_id=?1').bind(id),
      db.prepare('DELETE FROM inspire_tags WHERE id=?1').bind(id),
    ]);
    if (!(res[2].meta && res[2].meta.changes)) return fail(404, 'not_found', 'Firma bulunamadı');
    return ok({ ok: true, removed_links: Number(((res[0].results || [])[0] || {}).n) || 0 });
  }
  const d = await readBody();
  if (!d) return fail(400, 'bad_request', 'Geçersiz istek');
  const keys = ['name', 'color', 'merge_into'].filter((k) => d[k] !== undefined);
  if (keys.length !== 1) return fail(400, 'bad_request', 'Yalnızca ad, renk ya da birleştirme gönderilebilir');
  const selectOne = (tid) => db.prepare('SELECT id, name, slug, color FROM inspire_tags WHERE id=?1').bind(tid);
  if (keys[0] === 'name') {
    const c = checkTagName(d.name);
    if (c.error) return fail(400, c.error, c.message);
    const r = await db.prepare(`SELECT (SELECT json_object('id', id, 'name', name, 'fold', fold) FROM inspire_tags WHERE id=?1) AS cur,
        (SELECT json_object('id', id, 'name', name) FROM inspire_tags WHERE fold=?2 AND id<>?1) AS clash`).bind(id, c.fold).first();
    if (!r || !r.cur) return fail(404, 'not_found', 'Firma bulunamadı');
    if (r.clash) {
      const x = JSON.parse(r.clash);
      return fail(409, 'tag_exists', `«${x.name}» adında bir firma zaten var`, { existing: { id: Number(x.id), name: String(x.name) } });
    }
    const slug = tagSlugBase(c.fold);
    let res;
    try {
      res = await db.batch([
        db.prepare("UPDATE inspire_tags SET name=?2, fold=?3, slug = CASE WHEN fold=?3 THEN slug ELSE ?4 || '~new' END WHERE id=?1")
          .bind(id, c.name, c.fold, slug),
        db.prepare(slugFixSql('id = ?2')).bind(slug, id),
        selectOne(id),
      ]);
    } catch (e) {
      if (uniqueError(e)) return fail(409, 'retry', 'Firma şu an değiştirilemedi, tekrar dene');
      throw e;
    }
    const row = (res[2].results || [])[0];
    return row ? ok({ tag: tagRowOut(row) }) : fail(404, 'not_found', 'Firma bulunamadı');
  }
  if (keys[0] === 'color') {
    if (!TAG_COLORS.includes(d.color)) return fail(400, 'invalid_color', 'Geçersiz renk');
    const res = await db.batch([db.prepare('UPDATE inspire_tags SET color=?2 WHERE id=?1').bind(id, d.color), selectOne(id)]);
    const row = (res[1].results || [])[0];
    return row ? ok({ tag: tagRowOut(row) }) : fail(404, 'not_found', 'Firma bulunamadı');
  }
  const into = d.merge_into;
  if (!Number.isSafeInteger(into) || into < 1 || into === id) return fail(400, 'invalid_merge', 'Geçersiz birleştirme hedefi');
  const r = await db.prepare('SELECT (SELECT id FROM inspire_tags WHERE id=?1) AS src, (SELECT id FROM inspire_tags WHERE id=?2) AS dst')
    .bind(id, into).first();
  if (!r || r.src == null || r.dst == null) return fail(404, 'not_found', 'Firma bulunamadı');
  // a post that had both ends up with one link (INSERT OR IGNORE), so the per-post cap is never exceeded
  const res = await db.batch([
    db.prepare('INSERT OR IGNORE INTO inspire_post_tags (post_id, tag_id, created_at) SELECT post_id, ?2, created_at FROM inspire_post_tags WHERE tag_id=?1')
      .bind(id, into),
    db.prepare('DELETE FROM inspire_post_tags WHERE tag_id=?1').bind(id),
    db.prepare('DELETE FROM inspire_tags WHERE id=?1').bind(id),
    selectOne(into),
  ]);
  const row = (res[3].results || [])[0];
  return row ? ok({ tag: tagRowOut(row), merged_from: id }) : fail(404, 'not_found', 'Firma bulunamadı');
}

// PUT /api/inspire/posts/:id/tags {tag_ids}: replaces the post's companies (post owner or admin) -> {post} (like PUT /media)
export async function postTagsSet({ db, fail, ok, actor, readBody, overLimit, limited, actorKey, ipKey, postSelect, ownerParams, postOut }, id) {
  const d = await readBody();
  if (!d) return fail(400, 'bad_request', 'Geçersiz istek');
  const ids = parseTagIds(d.tag_ids);
  if (!Array.isArray(d.tag_ids) || !ids) return fail(400, 'invalid_tags', `En fazla ${TAG_PER_POST_MAX} firma seçilebilir`);
  const [cid, uid] = ownerParams(actor);
  const row = await db.prepare(`${postSelect} WHERE p.id = ?3`).bind(cid, uid, id).first();
  if (!row) return fail(404, 'not_found', 'Fikir bulunamadı');
  if (!(actor.isAdmin || row.is_mine)) return fail(403, 'forbidden', 'Bu fikrin firmalarını değiştirme yetkin yok');
  if (await overLimit([['tagset', actorKey], ['tagset_ip', ipKey]])) return limited();
  const json = JSON.stringify(ids);
  const res = await db.batch([
    db.prepare('DELETE FROM inspire_post_tags WHERE post_id=?1 AND tag_id NOT IN (SELECT value FROM json_each(?2))').bind(id, json),
    db.prepare(POST_TAGS_INSERT).bind(id, json, nowS()),
    db.prepare(`${postSelect} WHERE p.id = ?3`).bind(cid, uid, id),
  ]);
  const after = (res[2].results || [])[0];
  if (!after) return fail(404, 'not_found', 'Fikir bulunamadı');
  return ok({ post: postOut(after, actor.isAdmin, []) });
}
