const fs = require('fs');
let code = fs.readFileSync('worker/index.js', 'utf8');

const targetStr = `        await env.DB.prepare(\`
        try { await env.DB.prepare('ALTER TABLE inspire_users ADD COLUMN is_first_login INTEGER DEFAULT 1').run(); } catch(e) {}
        await env.DB.prepare(\`
          CREATE TABLE IF NOT EXISTS inspire_posts (`;

const newStr = `        try { await env.DB.prepare('ALTER TABLE inspire_users ADD COLUMN is_first_login INTEGER DEFAULT 1').run(); } catch(e) {}
        await env.DB.prepare(\`
          CREATE TABLE IF NOT EXISTS inspire_posts (`;

if (code.includes(targetStr)) {
    code = code.replace(targetStr, newStr);
    fs.writeFileSync('worker/index.js', code, 'utf8');
} else {
    console.log("Not found");
}
