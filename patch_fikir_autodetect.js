const fs = require('fs');
let html = fs.readFileSync('fikir.html', 'utf8');

// 1. Remove the select box from the modal
const selectHtmlRegex = /<select id="post-type"[\s\S]*?<\/select>/;
html = html.replace(selectHtmlRegex, '');

// 2. Change the JS that reads post-type
const getTypeValue = "let type = document.getElementById('post-type').value;";
const autoDetectType = `
      let type = 'image';
      if (url.includes('instagram.com')) type = 'reels';
      else if (url.includes('pinterest.')) type = 'pinterest';
      else if (url.includes('drive.google.com')) type = 'drive';
      else if (url.match(/\\.(mp4|webm|mov)(\\?|$)/i)) type = 'video';
`;

html = html.replace(getTypeValue, autoDetectType);

// 3. Add Google Drive rendering
const driveRenderOld = "if (p.type === 'pinterest') {";
const driveRenderNew = `if (p.type === 'drive') {
            const driveId = p.url.match(/\\/d\\/([^\\/]+)/);
            const iframeUrl = driveId ? \`https://drive.google.com/file/d/\${driveId[1]}/preview\` : p.url;
            mediaHtml = \`<iframe src="\${iframeUrl}" width="100%" height="450" frameborder="0" allowfullscreen></iframe>\`;
          } else if (p.type === 'pinterest') {`;
html = html.replace(driveRenderOld, driveRenderNew);

fs.writeFileSync('fikir.html', html, 'utf8');
