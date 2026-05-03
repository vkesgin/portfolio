const fs = require('fs');
let html = fs.readFileSync('fikir.html', 'utf8');

const cardHtmlOld = `
          card.innerHTML = \`
            <div class="post-media">\${mediaHtml}</div>
            <div class="post-info">
              \${p.description ? \`<p class="post-desc">\${p.description}</p>\` : ''}
              <div class="post-meta">
                <span class="author-badge">@\${p.author || 'Anonim'}</span>
                \${deleteHtml}
              </div>
            </div>
          \`;
`;

const cardHtmlNew = `
          if (p.type === 'pinterest') {
            mediaHtml = \`<div style="padding: 10px; display: flex; justify-content: center;"><a data-pin-do="embedPin" data-pin-width="medium" href="\${p.url}"></a></div>\`;
          }

          let notesHtml = '';
          if (p.notes && p.notes.length > 0) {
            notesHtml = '<div style="margin-top:15px; border-top:1px solid rgba(255,255,255,0.05); padding-top:10px;"><strong style="font-size:12px;color:#aaa">Notlar:</strong>';
            p.notes.forEach(n => {
              const lock = n.is_public ? '' : ' <span style="font-size:10px;color:#666">(Sadece sana özel)</span>';
              notesHtml += \`<div style="font-size:13px; color:#ccc; margin-top:5px; padding:8px; background:rgba(0,0,0,0.2); border-radius:8px;"><b>@\${n.author}</b>: \${n.content}\${lock}</div>\`;
            });
            notesHtml += '</div>';
          }
          
          const addNoteForm = \`
            <div style="margin-top:10px; display:flex; flex-direction:column; gap:5px;">
              <input type="text" id="note-input-\${p.id}" placeholder="Bir not ekle..." style="width:100%; padding:8px; background:rgba(255,255,255,0.03); border:1px solid rgba(255,255,255,0.05); border-radius:6px; color:#fff; font-size:12px; box-sizing:border-box;">
              <div style="display:flex; justify-content:space-between; align-items:center;">
                <label style="font-size:11px; color:#888; display:flex; align-items:center; gap:4px;">
                  <input type="checkbox" id="note-public-\${p.id}"> Diğer kullanıcılar da görsün
                </label>
                <button onclick="addNote(\${p.id})" style="background:var(--accent); color:#000; border:none; padding:4px 10px; border-radius:4px; font-size:11px; font-weight:bold; cursor:pointer;">Ekle</button>
              </div>
            </div>
          \`;

          card.innerHTML = \`
            <div class="post-media">\${mediaHtml}</div>
            <div class="post-info">
              \${p.description ? \`<p class="post-desc">\${p.description}</p>\` : ''}
              <div class="post-meta">
                <span class="author-badge">@\${p.author || 'Anonim'}</span>
                \${deleteHtml}
              </div>
              \${notesHtml}
              \${addNoteForm}
            </div>
          \`;
`;

if (html.includes('<div class="post-media">${mediaHtml}</div>')) {
    html = html.replace(cardHtmlOld.trim(), cardHtmlNew.trim());
}

fs.writeFileSync('fikir.html', html, 'utf8');
