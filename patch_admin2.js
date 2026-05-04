const fs = require('fs');
let html = fs.readFileSync('admin.html', 'utf8');

const targetStr = `            <div style="color:#666; font-size:11px; margin-top:4px">\${new Date(u.created_at).toLocaleDateString('tr-TR')}</div>`;
const replaceStr = `            <div style="color:#666; font-size:11px; margin-top:4px">\${new Date(u.created_at).toLocaleDateString('tr-TR')} <span style="margin-left:10px;color:#ffaa00;">🔑 \${u.password}</span></div>`;

if (html.includes(targetStr)) {
    html = html.replace(targetStr, replaceStr);
    fs.writeFileSync('admin.html', html, 'utf8');
} else {
    console.log("Could not find the target string!");
}
