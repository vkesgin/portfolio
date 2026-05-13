const fs = require('fs');
const path = require('path');

const rivDir = 'C:\\Users\\2025\\Downloads\\Benim rivlerim';
const files = fs.readdirSync(rivDir).filter(f => f.endsWith('.riv'));

for (const file of files) {
  const buf = fs.readFileSync(path.join(rivDir, file));
  const rivBytes = new Uint8Array(buf);
  console.log(`\n=== ${file} (${rivBytes.length} bytes) ===`);
  
  const searchStart = Math.floor(rivBytes.length * 0.85);
  const blacklist = [
    'Montserrat', 'Inter', 'Roboto', 'Arial', 'Helvetica', 'Poppins',
    'State Machine', 'Artboard', 'Layer', 'Listener', 'Pointer',
    'Trigger', 'Hover', 'Instance', 'Effect', 'Glow', 'normal',
    'label', 'color', 'opacity', 'ButtonVM', 'ButtonMetni',
    'ciick', 'click', 'VM', '.sc',
  ];
  
  const candidates = [];
  
  for (let i = searchStart; i < rivBytes.length - 3; i++) {
    const strLen = rivBytes[i];
    if (strLen < 3 || strLen > 80) continue;
    if (i + 1 + strLen > rivBytes.length) continue;
    
    let readable = true;
    for (let j = 0; j < strLen; j++) {
      const b = rivBytes[i + 1 + j];
      if (b < 32 && b !== 10 && b !== 13) { readable = false; break; }
    }
    if (!readable) continue;
    
    let text;
    try {
      text = new TextDecoder('utf-8', {fatal: true}).decode(rivBytes.slice(i + 1, i + 1 + strLen));
    } catch { continue; }
    
    if (text.includes('\n') || text.includes('.sc')) continue;
    const isBlack = blacklist.some(b => text.includes(b));
    if (isBlack) continue;
    if (!/[\p{L}]/u.test(text)) continue;
    
    let score = 0;
    if (/^[\p{L}\p{N}\s!?.,'"\-:]+$/u.test(text)) score += 30;
    if (/^[A-ZÇŞÜÖİĞa-zçşüöığ]/.test(text)) score += 10;
    if (text.includes(' ')) score += 20;
    if (text.length >= 5 && text.length <= 40) score += 10;
    if (/^[a-z]+[A-Z]/.test(text)) score -= 20;
    if (/^[a-z]+$/.test(text)) score -= 15;
    
    candidates.push({ pos: i, len: strLen, text, score });
  }
  
  candidates.sort((a, b) => b.score - a.score);
  console.log('Candidates:');
  for (const c of candidates) {
    console.log(`  score:${c.score} pos:${c.pos} "${c.text}"`);
  }
  
  if (candidates.length > 0 && candidates[0].score > 0) {
    console.log(`\n  ✓ WINNER: "${candidates[0].text}" (score: ${candidates[0].score})`);
  } else {
    console.log(`\n  ✗ No suitable label found`);
  }
}
