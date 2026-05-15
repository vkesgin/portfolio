const fs = require('fs');
let html = fs.readFileSync('admin.html', 'utf-8');

// Replace the payload
const oldPayload = `    let rivUrl = editingUiCurrentRivUrl;
    if (file) rivUrl = await uploadFile(file, 'file');

    const payload = {
      title, category: categoryStr, description: code,
      tags: tagsJson, image_url: rivUrl, is_featured: isPro
    };`;

const newPayload = `    let rivUrl = editingUiCurrentRivUrl;
    if (file) rivUrl = await uploadFile(file, 'file');

    let thumbUrl = window.editingUiCurrentThumbUrl || '';
    if (thumbFile) thumbUrl = await uploadFile(thumbFile, 'image');

    const payload = {
      title, category: categoryStr, description: code,
      tags: tagsJson, image_url: rivUrl, thumbnail_url: thumbUrl, is_featured: isPro
    };`;

if (html.includes(oldPayload)) {
    html = html.replace(oldPayload, newPayload);
    fs.writeFileSync('admin.html', html, 'utf-8');
    console.log("admin.html payload patched successfully.");
} else {
    // try line by line replacement if exact match fails
    console.log("exact match failed, trying regex");
    html = html.replace(/const payload = \{\s*title, category: categoryStr, description: code,\s*tags: tagsJson, image_url: rivUrl, is_featured: isPro\s*\};/g, `let thumbUrl = window.editingUiCurrentThumbUrl || '';
    if (thumbFile) thumbUrl = await uploadFile(thumbFile, 'image');

    const payload = {
      title, category: categoryStr, description: code,
      tags: tagsJson, image_url: rivUrl, thumbnail_url: thumbUrl, is_featured: isPro
    };`);
    fs.writeFileSync('admin.html', html, 'utf-8');
    console.log("admin.html payload patched using regex.");
}
