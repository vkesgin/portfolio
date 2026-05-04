const fs = require('fs');
let html = fs.readFileSync('fikir.html', 'utf8');

// 1. YouTube Shorts Regex Fix & Generic Link Preview
const targetRender = `          } else if (p.type === 'youtube') {
            const ytMatch = p.url.match(/(?:youtu\\.be\\/|youtube\\.com\\/(?:embed\\/|v\\/|watch\\?v=|watch\\?.+&v=))([\\w-]{11})/);
            if (ytMatch) {
              mediaHtml = \`<iframe src="https://www.youtube.com/embed/\${ytMatch[1]}" width="100%" height="250" frameborder="0" allowfullscreen sandbox="allow-scripts allow-same-origin allow-presentation"></iframe>\`;
            }
          } else if (p.type === 'link') {
            mediaHtml = \`<div style="padding:40px 20px; text-align:center; background:rgba(255,255,255,0.03); border-radius:12px; margin:10px;"><a href="\${p.url}" target="_blank" style="color:var(--accent); font-weight:bold; text-decoration:none; display:block; padding:15px; border:1px solid rgba(0,229,255,0.2); border-radius:8px;">🔗 Dış Bağlantıyı Aç / Ziyaret Et</a></div>\`;
          }`;

const newRender = `          } else if (p.type === 'youtube') {
            const ytMatch = p.url.match(/(?:youtu\\.be\\/|youtube\\.com\\/(?:embed\\/|v\\/|shorts\\/|watch\\?v=|watch\\?.+&v=))([\\w-]{11})/);
            if (ytMatch) {
              const isShort = p.url.includes('shorts');
              mediaHtml = \`<iframe src="https://www.youtube.com/embed/\${ytMatch[1]}" width="100%" height="\${isShort ? '500' : '250'}" frameborder="0" allowfullscreen sandbox="allow-scripts allow-same-origin allow-presentation"></iframe>\`;
            }
          } else if (p.type === 'link') {
            mediaHtml = \`
              <div id="link-preview-\${p.id}" style="padding:40px 20px; text-align:center; background:rgba(255,255,255,0.03); border-radius:12px; margin:10px;">
                <a href="\${p.url}" target="_blank" style="color:var(--accent); font-weight:bold; text-decoration:none; display:block; padding:15px; border:1px solid rgba(0,229,255,0.2); border-radius:8px;">🔗 Dış Bağlantıyı Aç / Ziyaret Et</a>
                <div class="microlink-spinner" style="margin-top:10px; font-size:11px; color:#888;">Önizleme Yükleniyor...</div>
              </div>
              <script>
                fetch('https://api.microlink.io?url=' + encodeURIComponent('\${p.url}'))
                  .then(r => r.json())
                  .then(data => {
                    const el = document.getElementById('link-preview-\${p.id}');
                    if(!el) return;
                    if(data.status === 'success' && data.data) {
                      const img = data.data.image ? data.data.image.url : (data.data.logo ? data.data.logo.url : '');
                      const title = data.data.title || '\${p.url}';
                      const desc = data.data.description ? data.data.description.substring(0,80)+'...' : '';
                      el.innerHTML = \`<a href="\${p.url}" target="_blank" style="text-decoration:none; color:inherit; display:block; text-align:left;">
                        \${img ? \`<img src="\${img}" style="width:100%; max-height:200px; object-fit:cover; border-radius:8px; margin-bottom:10px;">\` : ''}
                        <h4 style="margin:0 0 5px 0; font-size:14px; color:#fff;">\${title}</h4>
                        <p style="margin:0; font-size:11px; color:#888;">\${desc}</p>
                      </a>\`;
                      el.style.padding = '15px';
                    } else {
                      el.querySelector('.microlink-spinner').style.display = 'none';
                    }
                  }).catch(() => {
                    const el = document.getElementById('link-preview-\${p.id}');
                    if(el) el.querySelector('.microlink-spinner').style.display = 'none';
                  });
              <\\/script>\`;
          }`;

if(html.includes(targetRender)) {
  html = html.replace(targetRender, newRender);
} else {
  console.log("Could not find render target");
}

// 2. Fix Notes Filtering
const notesTarget = `          let notesHtml = '';
            if (p.notes && p.notes.length > 0) {
              notesHtml = '<div style="margin-top:15px; border-top:1px solid rgba(255,255,255,0.05); padding-top:10px;"><strong style="font-size:12px;color:#aaa">Notlar:</strong>';
              p.notes.forEach(n => {
                const lock = n.is_public ? '' : ' <span style="font-size:10px;color:#666">(Sadece sana özel)</span>';
                notesHtml += \`<div style="font-size:13px; color:#ccc; margin-top:5px; padding:8px; background:rgba(0,0,0,0.2); border-radius:8px;"><b>@\${n.author}</b>: \${n.content}\${lock}</div>\`;
              });
              notesHtml += '</div>';
            }`;

const notesNew = `          let notesHtml = '';
            if (p.notes && p.notes.length > 0) {
              const visibleNotes = p.notes.filter(n => n.is_public || n.user_id === currentUser.id);
              if (visibleNotes.length > 0) {
                notesHtml = '<div style="margin-top:15px; border-top:1px solid rgba(255,255,255,0.05); padding-top:10px;"><strong style="font-size:12px;color:#aaa">Notlar:</strong>';
                visibleNotes.forEach(n => {
                  const lock = n.is_public ? '' : ' <span style="font-size:10px;color:#666">(Sadece sana özel)</span>';
                  notesHtml += \`<div style="font-size:13px; color:#ccc; margin-top:5px; padding:8px; background:rgba(0,0,0,0.2); border-radius:8px;"><b>@\${n.author || 'Anonim'}</b>: \${n.content}\${lock}</div>\`;
                });
                notesHtml += '</div>';
              }
            }`;

if(html.includes(notesTarget)) {
  html = html.replace(notesTarget, notesNew);
} else {
  console.log("Could not find notes target");
}

fs.writeFileSync('fikir.html', html, 'utf8');
