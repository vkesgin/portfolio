const fs = require('fs');
let code = fs.readFileSync('worker/index.js', 'utf8');

const targetStr = `    if (cleanPath.match(/^\\/api\\/inspire\\/posts\\/\\d+$/) && method === 'DELETE') {
      const user = await inspireAuth(request, env);
      const admin = await authMiddleware(request, env);
      if (!user && !admin) return json({ error: 'Yetkisiz' }, 401, origin);
      
      const id = cleanPath.split('/').pop();
      
      if (admin) {
        await env.DB.prepare('DELETE FROM inspire_posts WHERE id=?').bind(id).run();
      } else {
        await env.DB.prepare('DELETE FROM inspire_posts WHERE id=? AND user_id=?').bind(id, user.userId).run();
      }
      return json({ ok: true }, 200, origin);
    }`;

const replaceStr = `    if (cleanPath.match(/^\\/api\\/inspire\\/posts\\/\\d+$/) && method === 'DELETE') {
      const user = await inspireAuth(request, env);
      const admin = await authMiddleware(request, env);
      if (!user && !admin) return json({ error: 'Yetkisiz' }, 401, origin);
      
      const id = cleanPath.split('/').pop();
      
      if (admin || (user && user.username === 'vkesgin38')) {
        await env.DB.prepare('DELETE FROM inspire_posts WHERE id=?').bind(id).run();
      } else {
        await env.DB.prepare('DELETE FROM inspire_posts WHERE id=? AND user_id=?').bind(id, user.userId).run();
      }
      return json({ ok: true }, 200, origin);
    }
    
    // Notes Delete
    if (cleanPath.match(/^\\/api\\/inspire\\/notes\\/\\d+$/) && method === 'DELETE') {
      const user = await inspireAuth(request, env);
      if (!user) return json({ error: 'Yetkisiz' }, 401, origin);
      const id = cleanPath.split('/').pop();
      if (user.username === 'vkesgin38') {
        await env.DB.prepare('DELETE FROM inspire_notes WHERE id=?').bind(id).run();
      } else {
        await env.DB.prepare('DELETE FROM inspire_notes WHERE id=? AND user_id=?').bind(id, user.userId).run();
      }
      return json({ ok: true }, 200, origin);
    }
    
    // Notes Edit
    if (cleanPath.match(/^\\/api\\/inspire\\/notes\\/\\d+$/) && method === 'PUT') {
      const user = await inspireAuth(request, env);
      if (!user) return json({ error: 'Yetkisiz' }, 401, origin);
      const id = cleanPath.split('/').pop();
      const d = await request.json();
      if (!d.content) return json({ error: 'İçerik gerekli' }, 400, origin);
      
      if (user.username === 'vkesgin38') {
        await env.DB.prepare('UPDATE inspire_notes SET content=? WHERE id=?').bind(d.content, id).run();
      } else {
        await env.DB.prepare('UPDATE inspire_notes SET content=? WHERE id=? AND user_id=?').bind(d.content, id, user.userId).run();
      }
      return json({ ok: true }, 200, origin);
    }`;

if (code.includes(targetStr)) {
    code = code.replace(targetStr, replaceStr);
    fs.writeFileSync('worker/index.js', code, 'utf8');
} else {
    console.log("Could not find DELETE route");
}
