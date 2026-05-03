const fs = require('fs');
let html = fs.readFileSync('fikir.html', 'utf8');

const oldStr = `
        let type = 'image';
        if (url.includes('instagram.com')) type = 'reels';
        else if (url.includes('pinterest.')) type = 'pinterest';
        else if (url.includes('drive.google.com')) type = 'drive';
        else if (url.match(/\\.(mp4|webm|mov)(\\?|$)/i)) type = 'video';
  
        let url = document.getElementById('post-url').value;`;

const newStr = `
        let url = document.getElementById('post-url').value;
        let type = 'image';
        if (url.includes('instagram.com')) type = 'reels';
        else if (url.includes('pinterest.')) type = 'pinterest';
        else if (url.includes('drive.google.com')) type = 'drive';
        else if (url.match(/\\.(mp4|webm|mov)(\\?|$)/i)) type = 'video';`;

if (html.includes(oldStr)) {
    html = html.replace(oldStr, newStr);
    fs.writeFileSync('fikir.html', html, 'utf8');
} else {
    console.log("Could not find the target string!");
}
