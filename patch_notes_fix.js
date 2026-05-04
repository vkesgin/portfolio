const fs = require('fs');
let html = fs.readFileSync('fikir.html', 'utf8');

const oldNotes = `            if (p.notes && p.notes.length > 0) {
              notesHtml = '<div style="margin-top:15px; border-top:1px solid rgba(255,255,255,0.05); padding-top:10px;"><strong style="font-size:12px;color:#aaa">Notlar:</strong>';
              p.notes.forEach(n => {
                const lock = n.is_public ? '' : ' <span style="font-size:10px;color:#666">(Sadece sana özel)</span>';
                notesHtml += \`<div style="font-size:13px; color:#ccc; margin-top:5px; padding:8px; background:rgba(0,0,0,0.2); border-radius:8px;"><b>@\${n.author}</b>: \${n.content}\${lock}</div>\`;
              });
              notesHtml += '</div>';
            }`;

const newNotes = `            if (p.notes && p.notes.length > 0) {
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

html = html.replace(oldNotes, newNotes);
fs.writeFileSync('fikir.html', html, 'utf8');
