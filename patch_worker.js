const fs = require('fs');
let code = fs.readFileSync('worker/index.js', 'utf8');

// 1. Update init
code = code.replace(
  "created_at TEXT DEFAULT (datetime('now'))\n          )",
  "created_at TEXT DEFAULT (datetime('now'))\n          )\n        `).run();\n        try { await env.DB.prepare('ALTER TABLE inspire_users ADD COLUMN is_first_login INTEGER DEFAULT 1').run(); } catch(e) {}"
);
// Wait, the replace string should be simpler.
code = code.replace(
  "          CREATE TABLE IF NOT EXISTS inspire_posts (",
  "        try { await env.DB.prepare('ALTER TABLE inspire_users ADD COLUMN is_first_login INTEGER DEFAULT 1').run(); } catch(e) {}\n        await env.DB.prepare(`\n          CREATE TABLE IF NOT EXISTS inspire_posts ("
);

// 2. Update get users
code = code.replace(
  "SELECT id, username, full_name, created_at FROM inspire_users ORDER BY id DESC",
  "SELECT id, username, full_name, created_at, password FROM inspire_users ORDER BY id DESC"
);

// 3. Update login response
code = code.replace(
  "return json({ token, user: { id:user.id, username:user.username, full_name:user.full_name } }, 200, origin);",
  "return json({ token, user: { id:user.id, username:user.username, full_name:user.full_name, is_first_login: user.is_first_login } }, 200, origin);"
);

// 4. Add change-password endpoint
const changePwd = `
    if (path === '/api/inspire/change-password' && method === 'POST') {
      const user = await inspireAuth(request, env);
      if (!user) return json({ error: 'Yetkisiz' }, 401, origin);
      const { newPassword } = await request.json();
      if (!newPassword || newPassword.length < 4) return json({ error: 'Gecerli bir sifre giriniz' }, 400, origin);
      await env.DB.prepare('UPDATE inspire_users SET password=?, is_first_login=0 WHERE id=?').bind(newPassword, user.userId).run();
      return json({ ok: true }, 200, origin);
    }
`;

code = code.replace(
  "// 4. Posts",
  changePwd + "\n    // 4. Posts"
);

fs.writeFileSync('worker/index.js', code, 'utf8');
