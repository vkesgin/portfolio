const fs = require('fs');
let html = fs.readFileSync('admin.html', 'utf8');

const inspire_panel = `
  <!-- TAB: INSPIRE -->
  <div class="admin-panel" id="tab-inspire">
    <div class="admin-panel-header">
      <h2 class="admin-panel-title">Fikir Havuzu Üye Yönetimi</h2>
      <p class="admin-panel-sub">Sadece admin yeni üye ekleyebilir. Fikir Havuzu sayfasına erişim için buradan üye tanımlayınız.</p>
    </div>
    
    <div class="upload-form" style="max-width: 600px; margin-bottom: 30px;">
      <div class="admin-field">
        <label class="admin-label">Kullanıcı Adı</label>
        <input type="text" id="iUsername" class="admin-input" placeholder="Örn: yenikullanici">
        <span class="admin-field-line"></span>
      </div>
      <div class="admin-field">
        <label class="admin-label">Ad Soyad</label>
        <input type="text" id="iFullName" class="admin-input" placeholder="Örn: Ahmet Yılmaz">
        <span class="admin-field-line"></span>
      </div>
      <div class="admin-field">
        <label class="admin-label">Şifre</label>
        <input type="password" id="iPassword" class="admin-input" placeholder="Giriş şifresi">
        <span class="admin-field-line"></span>
      </div>
      <button class="btn btn-primary" onclick="addInspireUser()" style="margin-top: 10px; width: 100%; justify-content: center;">Yeni Üye Oluştur ↗</button>
      <p id="inspireStatus" style="font-size:12px; color:var(--accent); margin-top:10px; text-align:center; min-height:16px;"></p>
    </div>

    <div class="admin-panel-header" style="margin-top: 40px; margin-bottom:16px;">
      <h3 class="admin-panel-title" style="font-size:14px;">Mevcut Üyeler</h3>
    </div>
    <div id="inspireUsersList" style="display:flex; flex-direction:column; gap:8px;">
      <div class="admin-loading">Yükleniyor...</div>
    </div>
  </div>
`;

if (!html.includes('id="tab-inspire"')) {
    html = html.replace('<script src="https://cdnjs.cloudflare.com/ajax/libs/cropperjs/1.5.13/cropper.min.js">', inspire_panel + '\n<script src="https://cdnjs.cloudflare.com/ajax/libs/cropperjs/1.5.13/cropper.min.js">');
    fs.writeFileSync('admin.html', html, 'utf8');
}
