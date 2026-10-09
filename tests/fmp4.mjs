// Synthetic single-track fragmented MP4s (CMAF layout: ftyp, moov(mvhd, trak, mvex), sidx, then moof/mdat pairs) for the
// Reddit picture + sound files of tests/cron-harness.mjs (worker/cmaf-mux.js joins them). Same builder as the CMAF mux
// tests in tests/inspire-video-adapters.test.mjs; no media files, every byte made up.
const u32b = (v) => [(v >>> 24) & 255, (v >>> 16) & 255, (v >>> 8) & 255, v & 255];
const u64b = (v) => [...u32b(Math.floor(v / 2 ** 32)), ...u32b(v >>> 0)];
const str = (s) => [...s].map((c) => c.charCodeAt(0));
const mk = (type, ...body) => { const b = body.flat(); return [...u32b(8 + b.length), ...str(type), ...b]; };
const full = (type, version, flags, ...body) => mk(type, [version, (flags >> 16) & 255, (flags >> 8) & 255, flags & 255], ...body);
const zeros = (n) => new Array(n).fill(0);
export function fmp4({ handler, timescale, movieTimescale, frags, elst = null, trackId = 1 }) {
  const mvhd = full('mvhd', 0, 0, zeros(8), u32b(movieTimescale), u32b(0), zeros(76), u32b(trackId + 1));
  const tkhd = full('tkhd', 0, 3, zeros(8), u32b(trackId), zeros(64));
  const mdhd = full('mdhd', 0, 0, zeros(8), u32b(timescale), u32b(0), zeros(4));
  const hdlr = full('hdlr', 0, 0, zeros(4), str(handler), zeros(12), [0]);
  const edts = elst ? mk('edts', full('elst', 0, 0, u32b(1), u32b(elst), u32b(0), u32b(0x10000))) : [];
  const trak = mk('trak', tkhd, edts, mk('mdia', mdhd, hdlr, mk('minf')));
  const mvex = mk('mvex', full('trex', 0, 0, u32b(trackId), u32b(1), zeros(12)));
  const moov = mk('moov', mvhd, trak, mvex);
  const pairs = frags.map(([t, n], i) => {
    const payload = Array.from({ length: n }, (_, k) => (k * 7 + i * 13 + handler.charCodeAt(0)) & 255);
    const tfhd = full('tfhd', 0, 0x020000, u32b(trackId));
    const moof = mk('moof', full('mfhd', 0, 0, u32b(i + 1)), mk('traf', tfhd, full('tfdt', 1, 0, u64b(t)), full('trun', 0, 1, u32b(1), u32b(0))));
    return [...moof, ...mk('mdat', payload)];
  });
  const sidx = full('sidx', 0, 0, u32b(trackId), u32b(timescale), u32b(0), u32b(0), [0, 0], [0, frags.length],
    ...pairs.map((p) => [...u32b(p.length), ...u32b(timescale), ...u32b(0x90000000)]));
  const ftyp = mk('ftyp', str('mp41'), u32b(0), str('iso8isommp41dashcmfc'));
  return new Uint8Array([...ftyp, ...moov, ...sidx, ...pairs.flat()]);
}
// picture only (3 fragments, 2 s each) and sound only (6 fragments, 1 s each)
export const CMAF_VIDEO = fmp4({ handler: 'vide', timescale: 15360, movieTimescale: 1000, frags: [[0, 30000], [30720, 50000], [61440, 40000]] });
export const CMAF_AUDIO = fmp4({ handler: 'soun', timescale: 48000, movieTimescale: 48000, elst: 96000, frags: [[0, 3000], [48000, 3100], [96000, 3200], [144000, 3300], [192000, 3400], [240000, 3500]] });
