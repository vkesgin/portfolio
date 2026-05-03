const fs = require('fs');
let html = fs.readFileSync('admin.html', 'utf8');

// The JS functions are currently inside `<script src="...cropper.min.js">`
// Let's extract them.

const startMarker = "// --- INSPIRE ---";
const startIndex = html.indexOf(startMarker);

if (startIndex !== -1) {
    // Find where the script tag closes
    const endScript = html.indexOf('</script>', startIndex);
    
    // Extract the JS code
    const inspireJs = html.substring(startIndex, endScript);
    
    // Remove the JS code from its current location
    html = html.slice(0, startIndex) + html.slice(endScript);
    
    // Append it to the main script block
    // Main script block starts right after `</script>\n<script>`
    const mainScriptStart = html.indexOf('<script>', endScript) + '<script>'.length;
    html = html.slice(0, mainScriptStart) + '\n' + inspireJs + '\n' + html.slice(mainScriptStart);
    
    fs.writeFileSync('admin.html', html, 'utf8');
}
