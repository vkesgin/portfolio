const fs = require('fs');
let code = fs.readFileSync('worker/index.js', 'utf8');

code = code.replace(/FOREIGN KEY\(user_id\) REFERENCES inspire_users\(id\) ON DELETE CASCADE\s*\)\s*`\.run\(\);/m, 
    "FOREIGN KEY(user_id) REFERENCES inspire_users(id) ON DELETE CASCADE\n          )\n        `).run();"
);

fs.writeFileSync('worker/index.js', code);
