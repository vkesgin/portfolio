const fs = require('fs');
let html = fs.readFileSync('fikir.html', 'utf8');

// Remove Admin Notice
html = html.replace(/<div id="admin-notice" class="admin-notice">[\s\S]*?<\/div>/, '');
html = html.replace("if (currentUser.username === 'vkesgin38') {\n        document.getElementById('admin-notice').style.display = 'block';\n      }", '');

// Add Pinterest option
html = html.replace('<option value="reels">Instagram Reels / Post</option>', '<option value="reels">Instagram Reels / Post</option>\n          <option value="pinterest">Pinterest Linki</option>');

// Clean Pinterest link
const pintRegex = "if (type === 'pinterest') { url = url.split('?')[0]; }";
html = html.replace("if (type === 'reels' && url.includes('instagram.com')) {", pintRegex + "\n      if (type === 'reels' && url.includes('instagram.com')) {");

// Pinterest Embed script in body
if (!html.includes('pinit.js')) {
    html = html.replace('</body>', '<script async defer src="//assets.pinterest.com/js/pinit.js"></script>\n</body>');
}

// Ensure token is passed in loadPosts
html = html.replace(
    "const res = await fetch(`${API_URL}/api/inspire/posts`);", 
    "const res = await fetch(`${API_URL}/api/inspire/posts`, { headers: { 'Authorization': `Bearer ${token}` } });"
);

// Add addNote function
const addNoteJs = `
    async function addNote(postId) {
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
`;
if (!html.includes('async function addNote')) {
    html = html.replace('async function deletePost', addNoteJs + '\n    async function deletePost');
}

fs.writeFileSync('fikir.html', html, 'utf8');
