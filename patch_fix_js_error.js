const fs = require('fs');
let html = fs.readFileSync('fikir.html', 'utf8');

const badScript = `              <script>
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
              <\\/script>\`;`;

// Remove the bad script completely from the template
if (html.includes(badScript)) {
    html = html.replace(badScript, "`;");
}

// Now we need to inject the fetch logic after `grid.appendChild(card);`
const appendTarget = `grid.appendChild(card);
        });`;
        
const fetchLogic = `grid.appendChild(card);
          
          if (p.type === 'link') {
            fetch('https://api.microlink.io?url=' + encodeURIComponent(p.url))
              .then(r => r.json())
              .then(data => {
                const el = document.getElementById('link-preview-' + p.id);
                if(!el) return;
                if(data.status === 'success' && data.data) {
                  const img = data.data.image ? data.data.image.url : (data.data.logo ? data.data.logo.url : '');
                  const title = data.data.title || p.url;
                  const desc = data.data.description ? data.data.description.substring(0,80)+'...' : '';
                  el.innerHTML = \`<a href="\${p.url}" target="_blank" style="text-decoration:none; color:inherit; display:block; text-align:left;">
                    \${img ? \`<img src="\${img}" style="width:100%; max-height:200px; object-fit:cover; border-radius:8px; margin-bottom:10px;">\` : ''}
                    <h4 style="margin:0 0 5px 0; font-size:14px; color:#fff;">\${title}</h4>
                    <p style="margin:0; font-size:11px; color:#888;">\${desc}</p>
                  </a>\`;
                  el.style.padding = '15px';
                } else {
                  const spinner = el.querySelector('.microlink-spinner');
                  if(spinner) spinner.style.display = 'none';
                }
              }).catch(() => {
                const el = document.getElementById('link-preview-' + p.id);
                if(el) {
                  const spinner = el.querySelector('.microlink-spinner');
                  if(spinner) spinner.style.display = 'none';
                }
              });
          }
        });`;

if (html.includes(appendTarget)) {
    html = html.replace(appendTarget, fetchLogic);
}

fs.writeFileSync('fikir.html', html, 'utf8');
