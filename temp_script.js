
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
      
      
      
      loadPosts();
    }

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
      
      
      let type = 'image';
      if (url.includes('instagram.com')) type = 'reels';
      else if (url.includes('pinterest.')) type = 'pinterest';
      else if (url.includes('drive.google.com')) type = 'drive';
      else if (url.match(/\.(mp4|webm|mov)(\?|$)/i)) type = 'video';

      let url = document.getElementById('post-url').value;
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
              <iframe src="${p.url}/embed" width="100%" height="450" frameborder="0" scrolling="no" allowtransparency="true" allowfullscreen></iframe>
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
            mediaHtml = `<div style="padding: 10px; display: flex; justify-content: center;"><a data-pin-do="embedPin" data-pin-width="medium" href="${p.url}"></a></div>`;
          }

          let notesHtml = '';
          if (p.notes && p.notes.length > 0) {
            notesHtml = '<div style="margin-top:15px; border-top:1px solid rgba(255,255,255,0.05); padding-top:10px;"><strong style="font-size:12px;color:#aaa">Notlar:</strong>';
            p.notes.forEach(n => {
              const lock = n.is_public ? '' : ' <span style="font-size:10px;color:#666">(Sadece sana özel)</span>';
              notesHtml += `<div style="font-size:13px; color:#ccc; margin-top:5px; padding:8px; background:rgba(0,0,0,0.2); border-radius:8px;"><b>@${n.author}</b>: ${n.content}${lock}</div>`;
            });
            notesHtml += '</div>';
          }
          
          const addNoteForm = `
            <div style="margin-top:10px; display:flex; flex-direction:column; gap:5px;">
              <input type="text" id="note-input-${p.id}" placeholder="Bir not ekle..." style="width:100%; padding:8px; background:rgba(255,255,255,0.03); border:1px solid rgba(255,255,255,0.05); border-radius:6px; color:#fff; font-size:12px; box-sizing:border-box;">
              <div style="display:flex; justify-content:space-between; align-items:center;">
                <label style="font-size:11px; color:#888; display:flex; align-items:center; gap:4px;">
                  <input type="checkbox" id="note-public-${p.id}"> Diğer kullanıcılar da görsün
                </label>
                <button onclick="addNote(${p.id})" style="background:var(--accent); color:#000; border:none; padding:4px 10px; border-radius:4px; font-size:11px; font-weight:bold; cursor:pointer;">Ekle</button>
              </div>
            </div>
          `;

          card.innerHTML = `
            <div class="post-media">${mediaHtml}</div>
            <div class="post-info">
              ${p.description ? `<p class="post-desc">${p.description}</p>` : ''}
              <div class="post-meta">
                <span class="author-badge">@${p.author || 'Anonim'}</span>
                ${deleteHtml}
              </div>
              ${notesHtml}
              ${addNoteForm}
            </div>
          `;
          grid.appendChild(card);
        });
        
        // Instagram scriptini tetikle
        if (window.instgrm) {
          window.instgrm.Embeds.process();
        }
        if (window.PinUtils) {
          window.PinUtils.build();
        }
      } catch(e) {
        grid.innerHTML = '<div style="color:red;text-align:center;">Fikirler yüklenirken hata oluştu.</div>';
      }
    }

    
    async function addNote(postId) {
      const input = document.getElementById('note-input-'+postId);
      const pub = document.getElementById('note-public-'+postId);
      const content = input.value.trim();
      if (!content) return;
      
      try {
        const res = await fetch(`${API_URL}/api/inspire/posts/${postId}/notes`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
          body: JSON.stringify({ content: content, is_public: pub.checked })
        });
        if (!res.ok) throw new Error();
        loadPosts();
      } catch(e) {
        alert('Not eklenemedi');
      }
    }

    async function deletePost(id) {
      if(!confirm('Bu fikri silmek istediğine emin misin?')) return;
      try {
        await fetch(`${API_URL}/api/inspire/posts/${id}`, {
          method: 'DELETE',
          headers: { 'Authorization': `Bearer ${token}` }
        });
        loadPosts();
      } catch(e) {
        alert('Silinemedi');
      }
    }
  