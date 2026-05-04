const fs = require('fs');
let html = fs.readFileSync('fikir.html', 'utf8');

const notesRenderTarget = `            if (p.notes && p.notes.length > 0) {
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

const notesRenderNew = `            if (p.notes && p.notes.length > 0) {
              const visibleNotes = p.notes.filter(n => String(n.is_public) === '1' || n.is_public === true || n.user_id === currentUser.id);
              if (visibleNotes.length > 0) {
                notesHtml = '<div style="margin-top:15px; border-top:1px solid rgba(255,255,255,0.05); padding-top:10px;"><strong style="font-size:12px;color:#aaa">Notlar:</strong>';
                visibleNotes.forEach(n => {
                  const lock = (String(n.is_public) === '1' || n.is_public === true) ? '' : ' <span style="font-size:10px;color:#666">(Sadece sana özel)</span>';
                  const canEditNote = currentUser.username === 'vkesgin38' || currentUser.id === n.user_id;
                  const noteActions = canEditNote ? \`<div style="margin-top:5px; display:flex; gap:10px;">
                    <span style="font-size:11px; color:#00e5ff; cursor:pointer;" onclick="editNote(\${n.id}, '\${n.content.replace(/'/g, "\\\\'")}')">Düzenle</span>
                    <span style="font-size:11px; color:#ff4444; cursor:pointer;" onclick="deleteNote(\${n.id})">Sil</span>
                  </div>\` : '';
                  notesHtml += \`<div style="font-size:13px; color:#ccc; margin-top:5px; padding:8px; background:rgba(0,0,0,0.2); border-radius:8px;">
                    <b>@\${n.author || 'Anonim'}</b>: \${n.content}\${lock}
                    \${noteActions}
                  </div>\`;
                });
                notesHtml += '</div>';
              }
            }`;

if (html.includes(notesRenderTarget)) {
    html = html.replace(notesRenderTarget, notesRenderNew);
}

const addNoteFuncTarget = `    async function addNote(postId) {
      const input = document.getElementById('note-input-'+postId);
      const pub = document.getElementById('note-public-'+postId);
      const content = input.value.trim();
      if (!content) return;
      
      try {
        const res = await fetch(\`\${API_URL}/api/inspire/posts/\${postId}/notes\`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': \`Bearer \${token}\` },
          body: JSON.stringify({ content: content, is_public: pub.checked })
        });
        if (!res.ok) throw new Error();
        loadPosts();
      } catch(e) {
        alert('Not eklenemedi');
      }
    }`;

const addNoteFuncNew = `    async function addNote(postId) {
      const input = document.getElementById('note-input-'+postId);
      const pub = document.getElementById('note-public-'+postId);
      const content = input.value.trim();
      if (!content) return;
      
      try {
        const res = await fetch(\`\${API_URL}/api/inspire/posts/\${postId}/notes\`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': \`Bearer \${token}\` },
          body: JSON.stringify({ content: content, is_public: pub.checked })
        });
        if (!res.ok) throw new Error();
        loadPosts();
      } catch(e) {
        alert('Not eklenemedi');
      }
    }
    
    async function editNote(noteId, oldContent) {
      const newContent = prompt('Notu düzenle:', oldContent);
      if (!newContent || newContent.trim() === '' || newContent === oldContent) return;
      
      try {
        const res = await fetch(\`\${API_URL}/api/inspire/notes/\${noteId}\`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json', 'Authorization': \`Bearer \${token}\` },
          body: JSON.stringify({ content: newContent.trim() })
        });
        if (!res.ok) throw new Error();
        loadPosts();
      } catch(e) {
        alert('Not düzenlenemedi');
      }
    }
    
    async function deleteNote(noteId) {
      if (!confirm('Bu notu silmek istediğinize emin misiniz?')) return;
      try {
        const res = await fetch(\`\${API_URL}/api/inspire/notes/\${noteId}\`, {
          method: 'DELETE',
          headers: { 'Authorization': \`Bearer \${token}\` }
        });
        if (!res.ok) throw new Error();
        loadPosts();
      } catch(e) {
        alert('Not silinemedi');
      }
    }`;

if (html.includes(addNoteFuncTarget)) {
    html = html.replace(addNoteFuncTarget, addNoteFuncNew);
}

fs.writeFileSync('fikir.html', html, 'utf8');
