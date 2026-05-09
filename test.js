
    const API_URL = 'https://vk-portfolio-api.vkesgin38.workers.dev';
    let currentUser = null;
    let token = localStorage.getItem('inspire_token');

    // Init App
    async function init() {
      // Sessizce tabloları kur (ilk açılışta veritabanı yoksa diye)
      fetch(`${API_URL}/api/inspire/init`).catch(()=>{});
      
      if (token) {
        const u = localStorage.getItem('inspire_user');
        if (u) {
          currentUser = JSON.parse(u);
          showDashboard();
          return;
        }
      }
    }
    init();

    // Login
    document.getElementById('login-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const u = document.getElementById('username').value;
      const p = document.getElementById('password').value;
      const btn = document.getElementById('login-btn');
      const err = document.getElementById('login-error');
      
      btn.innerHTML = '<div class="spinner"></div>';
      err.style.display = 'none';

      try {
        const res = await fetch(`${API_URL}/api/inspire/login`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username: u, password: p })
        });
        const data = await res.json();
        
        if (!res.ok) throw new Error(data.error || 'Giriş başarısız');
        
        token = data.token;
        currentUser = data.user;
        localStorage.setItem('inspire_token', token);
        localStorage.setItem('inspire_user', JSON.stringify(currentUser));
        
        showDashboard();
      } catch(error) {
        err.textContent = error.message;
        err.style.display = 'block';
      } finally {
        btn.innerHTML = 'Giriş Yap';
      }
    });

    function logout() {
      localStorage.removeItem('inspire_token');
      localStorage.removeItem('inspire_user');
      token = null;
      currentUser = null;
      document.getElementById('dashboard').style.display = 'none';
      document.getElementById('login-screen').style.display = 'flex';
    }

    async function showDashboard() {
      document.getElementById('login-screen').style.display = 'none';
      document.getElementById('dashboard').style.display = 'block';
      
      document.getElementById('user-greeting').textContent = `Hoş geldin, ${currentUser.full_name || currentUser.username}!`;
      
      if (currentUser.is_first_login) {
        document.getElementById('pwd-modal').classList.add('active');
        document.getElementById('pwd-modal').style.pointerEvents = 'all'; // prevent closing
      }
      
      
      
      loadPosts();
    }

    
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
        const res = await fetch(`${API_URL}/api/inspire/change-password`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
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

    function openModal() {
      document.getElementById('add-modal').classList.add('active');
    }
    function closeModal() {
      document.getElementById('add-modal').classList.remove('active');
      document.getElementById('add-form').reset();
    }

    // Add Post
    document.getElementById('add-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const btn = document.getElementById('submit-post-btn');
      btn.innerHTML = '<div class="spinner"></div>';
      
      
      let url = document.getElementById('post-url').value;
        let type = 'link';
      if (url.includes('instagram.com')) type = 'reels';
      else if (url.includes('pinterest.')) type = 'pinterest';
      else if (url.includes('drive.google.com')) type = 'drive';
        else if (url.includes('youtube.com') || url.includes('youtu.be')) type = 'youtube';
      else if (url.match(/\.(mp4|webm|mov)(\?|$)/i)) type = 'video';
        else if (url.match(/\.(jpeg|jpg|gif|png|webp)(\?|$)/i)) type = 'image';

      const desc = document.getElementById('post-desc').value;
      
      // Instagram link cleanup
      if (type === 'pinterest') { url = url.split('?')[0]; }
      if (type === 'reels' && url.includes('instagram.com')) {
        url = url.split('?')[0]; // Query parametrelerini temizle
        if (url.endsWith('/')) url = url.slice(0, -1);
      }

      try {
        const res = await fetch(`${API_URL}/api/inspire/posts`, {
          method: 'POST',
          headers: { 
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`
          },
          body: JSON.stringify({ type, url, description: desc })
        });
        
        if (!res.ok) throw new Error('Yüklenemedi');
        
        closeModal();
        loadPosts();
      } catch(error) {
        alert('Hata: ' + error.message);
      } finally {
        btn.innerHTML = 'Paylaş';
      }
    });

    // Load Posts
    async function loadPosts() {
      const grid = document.getElementById('posts-grid');
      grid.innerHTML = '<div style="text-align:center;width:100%;padding:40px;"><div class="spinner"></div></div>';
      
      try {
        const res = await fetch(`${API_URL}/api/inspire/posts`, { headers: { 'Authorization': `Bearer ${token}` } });
        const posts = await res.json();
        
        grid.innerHTML = '';
        if(posts.length === 0) {
          grid.innerHTML = '<div style="text-align:center;width:100%;color:#888;">Henüz fikir eklenmemiş. İlk fikri sen ekle!</div>';
          return;
        }

        posts.forEach(p => {
          const card = document.createElement('div');
          card.className = 'post-card';
          
          let mediaHtml = '';
          if (p.type === 'reels') {
            // Instagram Embed
            mediaHtml = `
              <iframe src="${p.url}/embed" width="100%" height="450" frameborder="0" scrolling="no" allowtransparency="true" allowfullscreen sandbox="allow-scripts allow-same-origin allow-presentation"></iframe>
            `;
          } else if (p.type === 'video') {
            mediaHtml = `
              <video src="${p.url}" controls controlsList="nodownload" preload="metadata" style="max-height: 500px; background:#000;"></video>
            `;
          } else {
            mediaHtml = `
              <img src="${p.url}" alt="Fikir Görseli">
            `;
          }

          const canDelete = currentUser.username === 'vkesgin38' || currentUser.id === p.user_id;
          const deleteHtml = canDelete ? `<button class="delete-post" onclick="deletePost(${p.id})">Sil</button>` : '';

          if (p.type === 'drive') {
            const driveId = p.url.match(/\/d\/([^\/]+)/);
            const iframeUrl = driveId ? `https://drive.google.com/file/d/${driveId[1]}/preview` : p.url;
            mediaHtml = `<iframe src="${iframeUrl}" width="100%" height="450" frameborder="0" allowfullscreen></iframe>`;
          } else if (p.type === 'pinterest') {
            const pinMatch = p.url.match(/pin\/(\d+)/);
            if (pinMatch) {
              mediaHtml = `<div style="padding: 10px; display: flex; justify-content: center;"><iframe src="https://assets.pinterest.com/ext/embed.html?id=${pinMatch[1]}" height="450" width="100%" frameborder="0" scrolling="no" sandbox="allow-scripts allow-same-origin allow-presentation"></iframe></div>`;
            } else {
              mediaHtml = `<div style="padding: 10px; display: flex; justify-content: center;"><a data-pin-do="embedPin" data-pin-width="medium" href="${p.url}"></a></div>`;
            }
          } else if (p.type === 'youtube') {
            const ytMatch = p.url.match(/(?:youtu\.be\/|youtube\.com\/(?:embed\/|v\/|shorts\/|watch\?v=|watch\?.+&v=))([\w-]{11})/);
            if (ytMatch) {
              const isShort = p.url.includes('shorts');
              mediaHtml = `<iframe src="https://www.youtube.com/embed/${ytMatch[1]}" width="100%" height="${isShort ? '500' : '250'}" frameborder="0" allowfullscreen sandbox="allow-scripts allow-same-origin allow-presentation"></iframe>`;
            }
          } else if (p.type === 'link') {
            mediaHtml = `
              <div id="link-preview-${p.id}" style="padding:40px 20px; text-align:center; background:rgba(255,255,255,0.03); border-radius:12px; margin:10px;">
                <a href="${p.url}" target="_blank" style="color:var(--accent); font-weight:bold; text-decoration:none; display:block; padding:15px; border:1px solid rgba(0,229,255,0.2); border-radius:8px;">🔗 Dış Bağlantıyı Aç / Ziyaret Et</a>
                <div class="microlink-spinner" style="margin-top:10px; font-size:11px; color:#888;">Önizleme Yükleniyor...</div>
              </div>
              