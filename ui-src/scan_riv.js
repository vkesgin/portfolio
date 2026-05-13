const fs = require('fs');
const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true });

const buf = fs.readFileSync('C:\\Users\\2025\\Downloads\\Benim rivlerim\\SendButton.riv');
const rivBytes = new Uint8Array(buf);

// "Send" string'ini tüm binary'de ara
const target = encoder.encode("Send");
console.log('=== "Send" arama sonuçları ===');
for (let i = 0; i < rivBytes.length - target.length; i++) {
  let match = true;
  for (let j = 0; j < target.length; j++) {
    if (rivBytes[i + j] !== target[j]) { match = false; break; }
  }
  if (match) {
    const before = i > 0 ? rivBytes[i - 1] : -1;
    const after = i + target.length < rivBytes.length ? rivBytes[i + target.length] : -1;
    // Sadece length-prefixed gibi olanları göster
    if (before === 4 || before === 5 || after < 32) {
      console.log(`  pos:${i} before:${before}(0x${before.toString(16)}) after:${after}(0x${after.toString(16)})`);
    }
  }
}

// "Send" ile biten veya "Send\n" stringleri ara
console.log('\n=== "Send" + newline arama ===');
const targetNL = encoder.encode("Send\n");
for (let i = 0; i < rivBytes.length - targetNL.length; i++) {
  let match = true;
  for (let j = 0; j < targetNL.length; j++) {
    if (rivBytes[i + j] !== targetNL[j]) { match = false; break; }
  }
  if (match) {
    const before = i > 0 ? rivBytes[i - 1] : -1;
    console.log(`  pos:${i} before:${before}(0x${before.toString(16)})`);
  }
}

// Son %30'daki TÜM readable stringleri göster (hepsini)
console.log('\n=== Son %30 readable strings (hepsi) ===');
const searchStart = Math.floor(rivBytes.length * 0.70);
for (let k = searchStart; k < rivBytes.length - 3; k++) {
  const strLen = rivBytes[k];
  if (strLen < 2 || strLen > 80) continue;
  if (k + 1 + strLen > rivBytes.length) continue;
  
  let readable = true;
  for (let j = 0; j < strLen; j++) {
    const b = rivBytes[k + 1 + j];
    if (b < 32 && b !== 10 && b !== 13) { readable = false; break; }
  }
  if (!readable) continue;
  
  let text;
  try { text = decoder.decode(rivBytes.slice(k + 1, k + 1 + strLen)); } catch { continue; }
  
  const trimmed = text.replace(/[\n\r]+$/g, '');
  if (/[\p{L}]/u.test(trimmed) && trimmed.length >= 3 && /^[\p{L}\p{N}\s!?.,'"\-:]+$/u.test(trimmed)) {
    const nl = text.endsWith('\n') ? ' (+\\n)' : '';
    console.log(`  pos:${k} len:${strLen} "${trimmed}"${nl}`);
  }
}
