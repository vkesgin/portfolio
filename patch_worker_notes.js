const fs = require('fs');
let code = fs.readFileSync('worker/index.js', 'utf8');

const targetStr = `    // 4. Posts
    if (path === '/api/inspire/posts' && method === 'GET') {
      const { results } = await env.DB.prepare(\`
        SELECT p.*, u.full_name as author 
        FROM inspire_posts p 
        LEFT JOIN inspire_users u ON p.user_id = u.id 
        ORDER BY p.id DESC
      \`).all();
      return json(results, 200, origin);
    }`;

const replaceStr = `    // 4. Posts
    if (path === '/api/inspire/posts' && method === 'GET') {
      const { results } = await env.DB.prepare(\`
        SELECT p.*, u.full_name as author,
        (
          SELECT json_group_array(json_object('id', n.id, 'content', n.content, 'author', nu.full_name, 'is_public', n.is_public, 'user_id', n.user_id))
          FROM inspire_notes n 
          LEFT JOIN inspire_users nu ON n.user_id = nu.id 
          WHERE n.post_id = p.id
        ) as notes_json
        FROM inspire_posts p 
        LEFT JOIN inspire_users u ON p.user_id = u.id 
        ORDER BY p.id DESC
      \`).all();
      
      const parsedResults = results.map(r => {
        let notes = [];
        try {
          if (r.notes_json) {
            notes = JSON.parse(r.notes_json);
            // sqlite json_group_array might return '[{}]' if empty due to some joins, let's filter nulls
            notes = notes.filter(n => n.id !== null);
          }
        } catch(e) {}
        r.notes = notes;
        delete r.notes_json;
        return r;
      });
      return json(parsedResults, 200, origin);
    }`;

if (code.includes(targetStr)) {
    code = code.replace(targetStr, replaceStr);
    fs.writeFileSync('worker/index.js', code, 'utf8');
} else {
    console.log("Not found.");
}
