const fs = require('fs');

let html = fs.readFileSync('admin.html', 'utf-8');

// 1. Add Thumbnail Zone
html = html.replace(
  `<!-- .riv dosya seçici -->`,
  `<!-- Thumbnail dosya seçici -->
        <div style="margin-top:16px">
          <label class="ct-label">Kapak Görseli (.webp, .jpg)</label>
          <div class="upload-zone" id="ui-thumb-zone" style="margin-top:8px;padding:16px;display:flex;align-items:center;justify-content:center;border:1px dashed rgba(255,255,255,0.2);border-radius:8px;cursor:pointer;flex-direction:column;gap:6px">
            <span id="ui-thumb-name" style="font-size:12px;color:var(--text-muted)">Görsel Seç (SEO için gerekli)</span>
            <input type="file" id="ui-thumb-file" accept="image/*" style="display:none">
          </div>
        </div>

        <!-- .riv dosya seçici -->`
);

// 2. uiResetForm
html = html.replace(
  `  uiRivName.style.color = 'var(--text-muted)';`,
  `  document.getElementById('ui-riv-name').style.color = 'var(--text-muted)';
  const thumbFileEl = document.getElementById('ui-thumb-file');
  if(thumbFileEl) thumbFileEl.value = '';
  const thumbNameEl = document.getElementById('ui-thumb-name');
  if(thumbNameEl) {
    thumbNameEl.textContent = 'Görsel Seç (SEO için gerekli)';
    thumbNameEl.style.color = 'var(--text-muted)';
  }`
);
html = html.replace(
  `  editingUiCurrentRivUrl = '';`,
  `  editingUiCurrentRivUrl = '';
  window.editingUiCurrentThumbUrl = '';`
);
html = html.replace(
  `  uiRivFile.value = '';`,
  `  document.getElementById('ui-riv-file').value = '';`
);
html = html.replace(
  `  uiRivName.textContent = 'Dosya Seç (.riv)';`,
  `  document.getElementById('ui-riv-name').textContent = 'Dosya Seç (.riv)';`
);


// 3. uiStartEdit
html = html.replace(
  `  editingUiCurrentRivUrl = p.image_url || '';`,
  `  editingUiCurrentRivUrl = p.image_url || '';
  window.editingUiCurrentThumbUrl = p.thumbnail_url || '';`
);
html = html.replace(
  `  uiRivName.style.color = p.image_url ? 'var(--accent)' : 'var(--text-muted)';`,
  `  document.getElementById('ui-riv-name').style.color = p.image_url ? 'var(--accent)' : 'var(--text-muted)';
  const thumbNameEl = document.getElementById('ui-thumb-name');
  if(thumbNameEl) {
    thumbNameEl.textContent = p.thumbnail_url ? '📎 Mevcut görsel korunacak' : 'Görsel Seç (SEO için gerekli)';
    thumbNameEl.style.color = p.thumbnail_url ? 'var(--accent)' : 'var(--text-muted)';
  }`
);
html = html.replace(
  `  uiRivName.textContent = p.image_url ? '📎 Mevcut dosya korunacak (değiştirmek için seç)' : 'Dosya Seç (.riv)';`,
  `  document.getElementById('ui-riv-name').textContent = p.image_url ? '📎 Mevcut dosya korunacak (değiştirmek için seç)' : 'Dosya Seç (.riv)';`
);


// 4. Listeners
html = html.replace(
  `document.getElementById('ui-cancel-btn')?.addEventListener('click', uiResetForm);`,
  `document.getElementById('ui-cancel-btn')?.addEventListener('click', uiResetForm);

document.getElementById('ui-thumb-zone')?.addEventListener('click', () => {
  document.getElementById('ui-thumb-file').click();
});
document.getElementById('ui-thumb-file')?.addEventListener('change', (e) => {
  const f = e.target.files[0];
  if(f) {
    document.getElementById('ui-thumb-name').textContent = '📎 ' + f.name;
    document.getElementById('ui-thumb-name').style.color = 'var(--accent)';
  }
});`
);

// 5. ui-save-btn
html = html.replace(
  `  const file    = uiRivFile.files[0];`,
  `  const file    = document.getElementById('ui-riv-file').files[0];
  const thumbFile = document.getElementById('ui-thumb-file') ? document.getElementById('ui-thumb-file').files[0] : null;`
);

html = html.replace(
  `    let rivUrl = editingUiCurrentRivUrl;
    if (file) rivUrl = await uploadFile(file, 'file');

    const payload = {
      title, category: categoryStr, description: code,
      tags: tagsJson, image_url: rivUrl, is_featured: isPro
    };`,
  `    let rivUrl = editingUiCurrentRivUrl;
    if (file) rivUrl = await uploadFile(file, 'file');

    let thumbUrl = window.editingUiCurrentThumbUrl || '';
    if (thumbFile) thumbUrl = await uploadFile(thumbFile, 'image');

    const payload = {
      title, category: categoryStr, description: code,
      tags: tagsJson, image_url: rivUrl, thumbnail_url: thumbUrl, is_featured: isPro
    };`
);

fs.writeFileSync('admin.html', html, 'utf-8');
console.log("Admin panel updated successfully!");
