const fs = require('fs');
let html = fs.readFileSync('fikir.html', 'utf8');

// 1. Update the regex detection block
const typeDetectStr = `        let type = 'image';
        if (url.includes('instagram.com')) type = 'reels';
        else if (url.includes('pinterest.')) type = 'pinterest';
        else if (url.includes('drive.google.com')) type = 'drive';
        else if (url.match(/\\.(mp4|webm|mov)(\\?|$)/i)) type = 'video';`;

const typeDetectNew = `        let type = 'link';
        if (url.includes('instagram.com')) type = 'reels';
        else if (url.includes('pinterest.')) type = 'pinterest';
        else if (url.includes('drive.google.com')) type = 'drive';
        else if (url.includes('youtube.com') || url.includes('youtu.be')) type = 'youtube';
        else if (url.match(/\\.(mp4|webm|mov)(\\?|$)/i)) type = 'video';
        else if (url.match(/\\.(jpeg|jpg|gif|png|webp)(\\?|$)/i)) type = 'image';`;

if (html.includes(typeDetectStr)) {
    html = html.replace(typeDetectStr, typeDetectNew);
} else {
    console.log("Could not find typeDetectStr");
}

// 2. Update the rendering block
const renderOld = `          } else if (p.type === 'pinterest') {
            mediaHtml = \`<div style="padding: 10px; display: flex; justify-content: center;"><a data-pin-do="embedPin" data-pin-width="medium" href="\${p.url}"></a></div>\`;
          }`;

const renderNew = `          } else if (p.type === 'pinterest') {
            const pinMatch = p.url.match(/pin\\/(\\d+)/);
            if (pinMatch) {
              mediaHtml = \`<div style="padding: 10px; display: flex; justify-content: center;"><iframe src="https://assets.pinterest.com/ext/embed.html?id=\${pinMatch[1]}" height="450" width="100%" frameborder="0" scrolling="no" sandbox="allow-scripts allow-same-origin allow-presentation"></iframe></div>\`;
            } else {
              mediaHtml = \`<div style="padding: 10px; display: flex; justify-content: center;"><a data-pin-do="embedPin" data-pin-width="medium" href="\${p.url}"></a></div>\`;
            }
          } else if (p.type === 'youtube') {
            const ytMatch = p.url.match(/(?:youtu\\.be\\/|youtube\\.com\\/(?:embed\\/|v\\/|watch\\?v=|watch\\?.+&v=))([\\w-]{11})/);
            if (ytMatch) {
              mediaHtml = \`<iframe src="https://www.youtube.com/embed/\${ytMatch[1]}" width="100%" height="250" frameborder="0" allowfullscreen sandbox="allow-scripts allow-same-origin allow-presentation"></iframe>\`;
            }
          } else if (p.type === 'link') {
            mediaHtml = \`<div style="padding:40px 20px; text-align:center; background:rgba(255,255,255,0.03); border-radius:12px; margin:10px;"><a href="\${p.url}" target="_blank" style="color:var(--accent); font-weight:bold; text-decoration:none; display:block; padding:15px; border:1px solid rgba(0,229,255,0.2); border-radius:8px;">🔗 Dış Bağlantıyı Aç / Ziyaret Et</a></div>\`;
          }`;

if (html.includes(renderOld)) {
    html = html.replace(renderOld, renderNew);
} else {
    console.log("Could not find renderOld");
}

fs.writeFileSync('fikir.html', html, 'utf8');
