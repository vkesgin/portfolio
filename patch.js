const fs = require('fs');

let html = fs.readFileSync('admin.html', 'utf-8');

if (!html.includes('data-tab="inspire"')) {
    html = html.replace(
        '<button class="admin-tab" data-tab="kpss">KPSS Üyeleri</button>',
        '<button class="admin-tab" data-tab="kpss">KPSS Üyeleri</button>\n      <button class="admin-tab" data-tab="inspire">Fikir Üyeleri</button>'
    );
}

const inspire_panel = `  <!-- TAB: INSPIRE -->
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
        <input type="text" id="iPassword" class="admin-input" placeholder="Giriş şifresi">
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
  </div>`;

if (!html.includes('id="tab-inspire"')) {
    html = html.replace('</div>\n</div>\n\n<script', '</div>\n\n' + inspire_panel + '\n</div>\n\n<script');
}

if (!html.includes('loadInspireUsers()')) {
    html = html.replace("if(t==='kpss') loadKpssUsers();", "if(t==='kpss') loadKpssUsers();\n    if(t==='inspire') loadInspireUsers();");
}

const inspire_js = `
// --- INSPIRE ---
async function loadInspireUsers() {
  const list = document.getElementById('inspireUsersList');
  try {
    const r = await fetch(API+'/api/admin/inspire-users', { headers:{Authorization:\`Bearer \${TOKEN}\`} });
    if (!r.ok) throw new Error();
    const data = await r.json();
    list.innerHTML = data.map(u => \`
      <div style="background:rgba(255,255,255,0.03); padding:12px 16px; border-radius:8px; display:flex; justify-content:space-between; align-items:center;">
        <div>
          <div style="color:#fff; font-size:14px; font-weight:500">\${u.username} <span style="color:#888;font-size:12px;font-weight:400;margin-left:8px">\${u.full_name||''}</span></div>
          <div style="color:#666; font-size:11px; margin-top:4px">\${new Date(u.created_at).toLocaleDateString('tr-TR')}</div>
        </div>
        <button class="btn btn-outline" style="padding:4px 8px; font-size:10px; color:#ff4444; border-color:rgba(255,68,68,0.2)" onclick="deleteInspireUser('\${u.id}')">SİL</button>
      </div>
    \`).join('') || '<div style="color:#888; font-size:13px">Henüz kayıtlı üye yok.</div>';
  } catch(e) {
    list.innerHTML = '<div style="color:#ff4444; font-size:13px">Üyeler yüklenemedi.</div>';
  }
}

async function addInspireUser() {
  const status = document.getElementById('inspireStatus');
  status.textContent = 'Ekleniyor...';
  status.style.color = 'var(--text-muted)';
  const username = document.getElementById('iUsername').value.trim();
  const full_name = document.getElementById('iFullName').value.trim();
  const password = document.getElementById('iPassword').value;
  
  if (!username || !password) {
    status.textContent = 'Kullanıcı adı ve şifre zorunlu!';
    status.style.color = 'var(--danger)';
    return;
  }
  
  try {
    const r = await fetch(API+'/api/admin/inspire-users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: \`Bearer \${TOKEN}\` },
      body: JSON.stringify({ username, full_name, password })
    });
    const d = await r.json();
    if (!r.ok) throw new Error(d.error || 'Hata');
    status.textContent = 'Üye başarıyla eklendi.';
    status.style.color = 'var(--accent)';
    document.getElementById('iUsername').value = '';
    document.getElementById('iFullName').value = '';
    document.getElementById('iPassword').value = '';
    loadInspireUsers();
  } catch(e) {
    status.textContent = e.message;
    status.style.color = 'var(--danger)';
  }
}

async function deleteInspireUser(id) {
  if(!confirm('Bu üyeyi silmek istediğinize emin misiniz? Fikirleri de silinebilir.')) return;
  try {
    await fetch(API+'/api/admin/inspire-users/'+id, {
      method: 'DELETE',
      headers: { Authorization: \`Bearer \${TOKEN}\` }
    });
    loadInspireUsers();
  } catch(e) {}
}
`;

if (!html.includes('function loadInspireUsers')) {
    html = html.replace('</script>', inspire_js + '\n</script>');
}

fs.writeFileSync('admin.html', html, 'utf-8');
