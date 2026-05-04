const fs = require('fs');
let html = fs.readFileSync('fikir.html', 'utf8');

// 1. Sandbox iframe
html = html.replace(
  '<iframe src="${p.url}/embed" width="100%" height="450" frameborder="0" scrolling="no" allowtransparency="true" allowfullscreen></iframe>',
  '<iframe src="${p.url}/embed" width="100%" height="450" frameborder="0" scrolling="no" allowtransparency="true" allowfullscreen sandbox="allow-scripts allow-same-origin allow-presentation"></iframe>'
);

// 2. Add Change Password Modal HTML
const pwdModalHtml = `
  <!-- Change Password Modal -->
  <div class="modal-overlay" id="pwd-modal" style="z-index: 2000;">
    <div class="modal-content">
      <div class="modal-header">
        <h2>Şifrenizi Belirleyin</h2>
      </div>
      <p style="font-size:13px; color:#aaa; margin-bottom:20px;">Güvenliğiniz için sisteme ilk girişinizde varsayılan şifrenizi değiştirmeniz gerekmektedir.</p>
      <form id="pwd-form">
        <input type="password" id="new-pwd" class="modal-input" placeholder="Yeni Şifreniz" required minlength="4">
        <input type="password" id="new-pwd-confirm" class="modal-input" placeholder="Yeni Şifrenizi Tekrar Girin" required minlength="4">
        <div id="pwd-error" style="color:#ff4444; font-size:12px; margin-bottom:10px; display:none;">Şifreler eşleşmiyor</div>
        <button type="submit" class="btn btn-primary" style="width:100%" id="submit-pwd-btn">Şifremi Güncelle</button>
      </form>
    </div>
  </div>
`;
html = html.replace('<!-- Add Post Modal -->', pwdModalHtml + '\n  <!-- Add Post Modal -->');

// 3. Add JS logic for the modal
const showDashOld = "document.getElementById('user-greeting').textContent = `Hoş geldin, ${currentUser.full_name || currentUser.username}!`;";
const showDashNew = `document.getElementById('user-greeting').textContent = \`Hoş geldin, \${currentUser.full_name || currentUser.username}!\`;
      
      if (currentUser.is_first_login) {
        document.getElementById('pwd-modal').classList.add('active');
        document.getElementById('pwd-modal').style.pointerEvents = 'all'; // prevent closing
      }`;
html = html.replace(showDashOld, showDashNew);

const pwdScript = `
    // Change Password
    document.getElementById('pwd-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const p1 = document.getElementById('new-pwd').value;
      const p2 = document.getElementById('new-pwd-confirm').value;
      const err = document.getElementById('pwd-error');
      
      if (p1 !== p2) {
        err.style.display = 'block';
        return;
      }
      err.style.display = 'none';
      
      const btn = document.getElementById('submit-pwd-btn');
      btn.innerHTML = '<div class="spinner"></div>';
      
      try {
        const res = await fetch(\`\${API_URL}/api/inspire/change-password\`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': \`Bearer \${token}\` },
          body: JSON.stringify({ newPassword: p1 })
        });
        
        if (!res.ok) throw new Error('Şifre güncellenemedi');
        
        currentUser.is_first_login = 0;
        localStorage.setItem('inspire_user', JSON.stringify(currentUser));
        document.getElementById('pwd-modal').classList.remove('active');
      } catch(e) {
        err.textContent = e.message;
        err.style.display = 'block';
      } finally {
        btn.innerHTML = 'Şifremi Güncelle';
      }
    });

    // Modal
`;
html = html.replace('// Modal', pwdScript);

fs.writeFileSync('fikir.html', html, 'utf8');
