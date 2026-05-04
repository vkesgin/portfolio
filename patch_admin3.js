const fs = require('fs');
let lines = fs.readFileSync('admin.html', 'utf8').split('\n');

for (let i = 0; i < lines.length; i++) {
    if (lines[i].includes("toLocaleDateString('tr-TR')}</div>")) {
        lines[i] = lines[i].replace(
            "toLocaleDateString('tr-TR')}</div>",
            "toLocaleDateString('tr-TR')} <span style=\"margin-left:10px;color:#ffaa00;\">🔑 ${u.password}</span></div>"
        );
        break;
    }
}

fs.writeFileSync('admin.html', lines.join('\n'), 'utf8');
