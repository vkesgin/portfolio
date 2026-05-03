const fs = require('fs');
let html = fs.readFileSync('fikir.html', 'utf8');

const regex = /let type = 'image';\s*if \(url\.includes\('instagram\.com'\)\) type = 'reels';\s*else if \(url\.includes\('pinterest\.'\)\) type = 'pinterest';\s*else if \(url\.includes\('drive\.google\.com'\)\) type = 'drive';\s*else if \(url\.match\(\/\\\\\.\[mp4\|webm\|mov\]\(\\\\\?\|\$\)\/i\)\) type = 'video';\s*let url = document\.getElementById\('post-url'\)\.value;/g;

// Instead of complex regex, let's just find `let type = 'image';` and `let url = document.getElementById('post-url').value;`

let lines = html.split('\n');
let typeIndex = -1;
let urlIndex = -1;

for (let i = 0; i < lines.length; i++) {
    if (lines[i].includes("let type = 'image';")) {
        typeIndex = i;
    }
    if (lines[i].includes("let url = document.getElementById('post-url').value;")) {
        urlIndex = i;
        if (typeIndex !== -1 && urlIndex > typeIndex) {
            // Swap them!
            let urlLine = lines.splice(urlIndex, 1)[0];
            lines.splice(typeIndex, 0, urlLine);
            break;
        }
    }
}

fs.writeFileSync('fikir.html', lines.join('\n'), 'utf8');
