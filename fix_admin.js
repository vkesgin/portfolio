const fs = require('fs');
let html = fs.readFileSync('admin.html', 'utf-8');

if (!html.includes("if (btn.dataset.tab === 'inspire') loadInspireUsers();")) {
    html = html.replace(
        "if (btn.dataset.tab === 'cube') loadCubeProducts();",
        "if (btn.dataset.tab === 'cube') loadCubeProducts();\n    if (btn.dataset.tab === 'inspire') loadInspireUsers();"
    );
    fs.writeFileSync('admin.html', html, 'utf-8');
}
