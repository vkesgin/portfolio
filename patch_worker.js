const fs = require('fs');
let code = fs.readFileSync('worker/index.js', 'utf8');

const initTable = `
          CREATE TABLE IF NOT EXISTS inspire_notes (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            post_id INTEGER NOT NULL,
            user_id INTEGER NOT NULL,
            content TEXT NOT NULL,
            is_public INTEGER DEFAULT 0,
            created_at TEXT DEFAULT (datetime('now')),
            FOREIGN KEY(post_id) REFERENCES inspire_posts(id) ON DELETE CASCADE,
            FOREIGN KEY(user_id) REFERENCES inspire_users(id) ON DELETE CASCADE
          )
        \`.run();`;
if (!code.includes('inspire_notes')) {
    code = code.replace('.run();', `.run();\n          await env.DB.prepare(\`${initTable}`);
}

const getPostsOld = `    if (path === '/api/inspire/posts' && method === 'GET') {
      const { results } = await env.DB.prepare(\`
        SELECT p.*, u.full_name as author 
        FROM inspire_posts p 
        LEFT JOIN inspire_users u ON p.user_id = u.id 
        ORDER BY p.id DESC
      \`).all();
      return json(results, 200, origin);
    }`;

const getPostsNew = `    if (path === '/api/inspire/posts' && method === 'GET') {
      const user = await inspireAuth(request, env);
      const uid = user ? user.userId : -1;
      const { results } = await env.DB.prepare(\`
        SELECT p.*, u.full_name as author,
          (SELECT json_group_array(
             json_object('id', n.id, 'user_id', n.user_id, 'author', nu.full_name, 'content', n.content, 'is_public', n.is_public)
           ) 
           FROM inspire_notes n 
           LEFT JOIN inspire_users nu ON n.user_id = nu.id 
           WHERE n.post_id = p.id AND (n.is_public = 1 OR n.user_id = ?)
          ) as notes_json
        FROM inspire_posts p 
        LEFT JOIN inspire_users u ON p.user_id = u.id 
        ORDER BY p.id DESC
      \`).bind(uid).all();
      
      results.forEach(r => {
        try { r.notes = JSON.parse(r.notes_json).filter(n => n.id !== null); } catch(e) { r.notes = []; }
        delete r.notes_json;
      });
      return json(results, 200, origin);
    }`;

if (code.includes(getPostsOld)) {
    code = code.replace(getPostsOld, getPostsNew);
}

const addNotesEndpoint = `
    if (cleanPath.match(/^\\/api\\/inspire\\/posts\\/\\d+\\/notes$/) && method === 'POST') {
      const user = await inspireAuth(request, env);
      if (!user) return json({ error: 'Yetkisiz' }, 401, origin);
      const postId = cleanPath.split('/')[4];
      const d = await request.json();
      if (!d.content) return json({ error: 'İçerik gerekli' }, 400, origin);
      await env.DB.prepare(
        'INSERT INTO inspire_notes (post_id, user_id, content, is_public) VALUES (?, ?, ?, ?)'
      ).bind(postId, user.userId, d.content, d.is_public ? 1 : 0).run();
      return json({ ok: true }, 201, origin);
    }
`;

if (!code.includes('\\/notes$')) {
    code = code.replace("if (cleanPath.match(/^\\/api\\/inspire\\/posts\\/\\d+$/) && method === 'DELETE')", addNotesEndpoint + "\n    if (cleanPath.match(/^\\/api\\/inspire\\/posts\\/\\d+$/) && method === 'DELETE')");
}

fs.writeFileSync('worker/index.js', code);
