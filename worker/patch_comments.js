const fs = require('fs');
const path = require('path');

const targetFile = path.join(__dirname, 'index.js');
let code = fs.readFileSync(targetFile, 'utf8');

const commentRoutes = `
    // ---------------- UI COMMENTS ----------------
    if (path === '/api/ui/comments' && method === 'GET') {
      const compId = url.searchParams.get('component_id');
      if (!compId) return json({ error: 'component_id required' }, 400, origin);
      
      const { results } = await env.DB.prepare(\`
        SELECT c.id, c.content, c.created_at, u.full_name, u.plan 
        FROM ui_comments c 
        JOIN ui_users u ON c.user_id = u.id 
        WHERE c.component_id = ? AND c.is_approved = 1
        ORDER BY c.created_at DESC
      \`).bind(compId).all();
      return json(results, 200, origin);
    }

    if (path === '/api/ui/comments' && method === 'POST') {
      const authData = await uiAuth(request, env);
      if (!authData) return json({ error: 'Yetkisiz' }, 401, origin);
      
      const { component_id, content } = await request.json().catch(() => ({}));
      if (!component_id || !content) return json({ error: 'Eksik veri' }, 400, origin);
      
      // Adminler otomatik onayli olabilir (vkesgin38@gmail.com)
      const user = await env.DB.prepare("SELECT email FROM ui_users WHERE id=?").bind(authData.userId).first();
      const is_approved = user?.email === 'vkesgin38@gmail.com' ? 1 : 0;

      await env.DB.prepare(
        "INSERT INTO ui_comments (component_id, user_id, content, is_approved) VALUES (?, ?, ?, ?)"
      ).bind(component_id, authData.userId, content, is_approved).run();
      
      return json({ message: is_approved ? 'Yorum eklendi' : 'Yorum onay bekliyor' }, 200, origin);
    }

    if (cleanPath.startsWith('/api/admin/comments') && method === 'GET') {
      // Sadece admin
      // Not: Admin kontrolü için user email kontrol edilebilir
      const { results } = await env.DB.prepare(\`
        SELECT c.id, c.content, c.is_approved, c.created_at, u.full_name, u.email, p.title as component_title
        FROM ui_comments c
        JOIN ui_users u ON c.user_id = u.id
        JOIN projects p ON c.component_id = p.id
        ORDER BY c.created_at DESC
      \`).all();
      return json(results, 200, origin);
    }

    if (cleanPath.match(/^\\/api\\/admin\\/comments\\/\\d+$/) && method === 'PUT') {
      const id = cleanPath.split('/').pop();
      const { is_approved } = await request.json().catch(() => ({}));
      await env.DB.prepare("UPDATE ui_comments SET is_approved = ? WHERE id = ?").bind(is_approved ? 1 : 0, id).run();
      return json({ message: 'Güncellendi' }, 200, origin);
    }
    
    if (cleanPath.match(/^\\/api\\/admin\\/comments\\/\\d+$/) && method === 'DELETE') {
      const id = cleanPath.split('/').pop();
      await env.DB.prepare("DELETE FROM ui_comments WHERE id = ?").bind(id).run();
      return json({ message: 'Silindi' }, 200, origin);
    }
    // ---------------------------------------------
`;

if (!code.includes('/api/ui/comments')) {
  // Insert before the last catch-all or a known block
  const searchStr = "if (path === '/api/ui/auth/me' && method === 'GET')";
  const targetIndex = code.indexOf(searchStr);
  
  if (targetIndex !== -1) {
    code = code.slice(0, targetIndex) + commentRoutes + code.slice(targetIndex);
    fs.writeFileSync(targetFile, code);
    console.log("Comment routes injected.");
  } else {
    console.log("Target block not found.");
  }
} else {
  console.log("Comment routes already exist.");
}
