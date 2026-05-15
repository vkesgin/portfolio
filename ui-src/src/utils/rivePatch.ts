export const readULEB128 = (d: Uint8Array, o: number): { val: number; size: number } => {
  let v = 0, s = 0, n = 0, b: number;
  do { b = d[o + n]; v |= (b & 0x7F) << s; s += 7; n++; } while (b & 0x80);
  return { val: v, size: n };
};

export const writeULEB128 = (v: number): Uint8Array => {
  const r: number[] = [];
  do { let byte = v & 0x7F; v >>>= 7; if (v) byte |= 0x80; r.push(byte); } while (v);
  return new Uint8Array(r);
};

export const findOrigTextInBinary = (bytes: Uint8Array, propName: string): string => {
  const encoder = new TextEncoder();
  const decoder = new TextDecoder('utf-8', { fatal: true });
  const sysNames = new Set([
    'Artboard','Instance','State Machine','Layer','Listener',
    'Trigger','Hover','Pointer','ButtonVM','ButtonMetni',
    'label','label ','Montserrat','normal','GlowEffect','ciick','click',
    'Button Text','ilk konum','hover','ustunde','tiklandi','ustundedegil',
  ]);
  const cleanPropName = propName.trim();
  const markers = [
    { text: cleanPropName, prefixRange: [cleanPropName.length, cleanPropName.length + 5] },
    { text: "ButtonMetni", prefixRange: [11, 15] },
  ];
  for (const marker of markers) {
    const markerBytes = encoder.encode(marker.text);
    for (let i = 0; i < bytes.length - markerBytes.length; i++) {
      let isMatch = true;
      for (let j = 0; j < markerBytes.length; j++) {
        if (bytes[i + j] !== markerBytes[j]) { isMatch = false; break; }
      }
      if (!isMatch) continue;
      const pfx = i > 0 ? bytes[i - 1] : 0;
      if (pfx < marker.prefixRange[0] || pfx > marker.prefixRange[1]) continue;
      for (let k = i + pfx; k < Math.min(i + 300, bytes.length - 3); k++) {
        const { val: sLen, size: prefSz } = readULEB128(bytes, k);
        if (sLen < 2 || sLen > 200 || k + prefSz + sLen > bytes.length) continue;
        let readable = true;
        for (let j = 0; j < sLen; j++) {
          const b = bytes[k + prefSz + j];
          if (b < 32 && b !== 10 && b !== 13) { readable = false; break; }
        }
        if (!readable) continue;
        let text: string;
        try { text = decoder.decode(bytes.slice(k + prefSz, k + prefSz + sLen)); } catch { continue; }
        const trimmed = text.replace(/[\n\r\s]+$/g, '').trim();
        if (trimmed.length < 2 || sysNames.has(trimmed)) continue;
        if (!/[\p{L}]/u.test(trimmed)) continue;
        if (!/^[\p{L}\p{N}\s!?.,'"\-:]+$/u.test(trimmed)) continue;
        return trimmed;
      }
    }
  }
  return '';
};

export const applyTextPatch = (bytes: Uint8Array, origText: string, newText: string): Uint8Array => {
  const encoder = new TextEncoder();
  const newTextBytes = encoder.encode(newText);
  const oldPlain = encoder.encode(origText);
  const oldWithNL = encoder.encode(origText + '\n');
  
  type PatchInfo = { start: number; prefixSize: number; dataLen: number; hasNL: boolean };
  const patches: PatchInfo[] = [];
  
  for (const variant of [
    { needle: oldWithNL, hasNL: true },
    { needle: oldPlain, hasNL: false },
  ]) {
    for (let i = 0; i <= bytes.length - variant.needle.length; i++) {
      let match = true;
      for (let j = 0; j < variant.needle.length; j++) {
        if (bytes[i + j] !== variant.needle[j]) { match = false; break; }
      }
      if (!match) continue;
      let found = false;
      for (let tryPrefSize = 1; tryPrefSize <= 2 && !found; tryPrefSize++) {
        if (i < tryPrefSize) continue;
        const prefStart = i - tryPrefSize;
        const { val, size } = readULEB128(bytes, prefStart);
        if (size === tryPrefSize && val === variant.needle.length) {
          if (!patches.some(p => p.start === prefStart)) {
            patches.push({ start: prefStart, prefixSize: tryPrefSize, dataLen: variant.needle.length, hasNL: variant.hasNL });
            found = true;
          }
        }
      }
    }
  }
  
  patches.sort((a, b) => b.start - a.start);
  let current = bytes;
  for (const p of patches) {
    const newData = p.hasNL
      ? new Uint8Array([...newTextBytes, 0x0A])
      : new Uint8Array(newTextBytes);
    const newPrefix = writeULEB128(newData.length);
    const before = current.slice(0, p.start);
    const after = current.slice(p.start + p.prefixSize + p.dataLen);
    const rebuilt = new Uint8Array(before.length + newPrefix.length + newData.length + after.length);
    rebuilt.set(before, 0);
    rebuilt.set(newPrefix, before.length);
    rebuilt.set(newData, before.length + newPrefix.length);
    rebuilt.set(after, before.length + newPrefix.length + newData.length);
    current = rebuilt;
  }
  return current;
};
