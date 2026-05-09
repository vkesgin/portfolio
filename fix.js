const fs = require('fs');
let h = fs.readFileSync('admin.html', 'utf8');

const targetStr = '<script src="https://cdnjs.cloudflare.com/ajax/libs/cropperjs/1.5.13/cropper.min.js">\r\n// --- INSPIRE ---';
const targetStr2 = '<script src="https://cdnjs.cloudflare.com/ajax/libs/cropperjs/1.5.13/cropper.min.js">\n// --- INSPIRE ---';

const replacement = '<script src="https://cdnjs.cloudflare.com/ajax/libs/cropperjs/1.5.13/cropper.min.js"></script>\n<script>\n// --- INSPIRE ---';

if (h.includes(targetStr)) {
    h = h.replace(targetStr, replacement);
} else if (h.includes(targetStr2)) {
    h = h.replace(targetStr2, replacement);
}

fs.writeFileSync('admin.html', h);
