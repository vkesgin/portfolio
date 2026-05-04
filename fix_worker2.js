const fs = require('fs');
let lines = fs.readFileSync('worker/index.js', 'utf8').split(/\r?\n/);

let targetIndex = -1;
for (let i = 0; i < lines.length; i++) {
    if (lines[i].includes("await env.DB.prepare(`") && lines[i+1] && lines[i+1].includes("try { await env.DB.prepare('ALTER TABLE inspire_users")) {
        targetIndex = i;
        break;
    }
}

if (targetIndex !== -1) {
    lines.splice(targetIndex, 1);
    fs.writeFileSync('worker/index.js', lines.join('\n'), 'utf8');
}
