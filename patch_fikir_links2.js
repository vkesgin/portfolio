const fs = require('fs');
let lines = fs.readFileSync('fikir.html', 'utf8').split('\n');

for (let i = 0; i < lines.length; i++) {
    if (lines[i].includes("let type = 'image';")) {
        lines[i] = "        let type = 'link';";
    }
    if (lines[i].includes("else if (url.includes('drive.google.com')) type = 'drive';")) {
        lines.splice(i + 1, 0, "        else if (url.includes('youtube.com') || url.includes('youtu.be')) type = 'youtube';");
    }
    if (lines[i].includes("else if (url.match(/\\.(mp4|webm|mov)(\\?|$)/i)) type = 'video';")) {
        lines.splice(i + 1, 0, "        else if (url.match(/\\.(jpeg|jpg|gif|png|webp)(\\?|$)/i)) type = 'image';");
    }
}

fs.writeFileSync('fikir.html', lines.join('\n'), 'utf8');
