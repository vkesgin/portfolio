// Lossless mux of a video-only and an audio-only CMAF (fragmented MP4) file into ONE fragmented MP4 with sound: no
// re-encoding, no dependencies, Workers + Node. Made for Reddit, whose v.redd.it serves picture and sound as separate
// CMAF_<h>.mp4 / CMAF_AUDIO_<kbps>.mp4 files (worker/inspire-video.js, downloads). Ported from the phase-g prototype
// (2026-10-08: same bytes on workerd and Node, planned length = streamed length, headless Chrome played the result with
// audio decoding and seeking).
//
// Output: ftyp(video) + moov(video trak = track 1, audio trak renumbered to track 2, mvex with both trex) + the moof/mdat
// pairs of both inputs interleaved by decode time, mfhd sequence numbers renumbered, tfhd track ids rewritten. trun data
// offsets are relative to their moof (default-base-is-moof, required by CMAF), so the pairs move unchanged.
// Memory/CPU: the audio file is held in memory (128 kbps ~ 1 MB/min); the video streams through: only its (small) moof
// boxes are copied and patched, mdat payloads pass through chunk by chunk without copying. sidx/styp/free are dropped.

const enc = (s) => Uint8Array.from(s, (c) => c.charCodeAt(0));
function u32(b, o) { return ((b[o] << 24) >>> 0) + (b[o + 1] << 16) + (b[o + 2] << 8) + b[o + 3]; }
function w32(b, o, v) { b[o] = (v >>> 24) & 255; b[o + 1] = (v >>> 16) & 255; b[o + 2] = (v >>> 8) & 255; b[o + 3] = v & 255; }
function u64(b, o) { return u32(b, o) * 2 ** 32 + u32(b, o + 4); }
function w64(b, o, v) { w32(b, o, Math.floor(v / 2 ** 32)); w32(b, o + 4, v >>> 0); }
function type(b, o) { return String.fromCharCode(b[o + 4], b[o + 5], b[o + 6], b[o + 7]); }
function concat(parts) {
  const n = parts.reduce((s, p) => s + p.length, 0);
  const out = new Uint8Array(n);
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}
function box(t, ...kids) {
  const body = concat(kids);
  const out = new Uint8Array(8 + body.length);
  w32(out, 0, out.length); out.set(enc(t), 4); out.set(body, 8);
  return out;
}

// Child boxes of b[s, e): [{type, start, end, hdr}]
export function children(b, s = 0, e = b.length) {
  const out = [];
  let o = s;
  while (o + 8 <= e) {
    let size = u32(b, o);
    let hdr = 8;
    if (size === 1) { size = u64(b, o + 8); hdr = 16; } else if (size === 0) size = e - o;
    if (size < hdr || o + size > e) throw new Error(`bad box at ${o}`);
    out.push({ type: type(b, o), start: o, end: o + size, hdr });
    o += size;
  }
  return out;
}
const child = (b, parent, t) => children(b, parent.start + parent.hdr, parent.end).find((c) => c.type === t);
const path = (b, parent, ...ts) => ts.reduce((p, t) => (p ? child(b, p, t) : null), parent);

function trackInfo(b, moov) {
  const trak = child(b, moov, 'trak');
  const mdhd = trak && path(b, trak, 'mdia', 'mdhd');
  const mvhd = child(b, moov, 'mvhd');
  if (!trak || !mdhd || !mvhd) throw new Error('moov without trak/mdhd/mvhd');
  const v = (x) => b[x.start + 8];
  return {
    trak, mvhd,
    timescale: v(mdhd) === 1 ? u32(b, mdhd.start + 28) : u32(b, mdhd.start + 20),
    movieTimescale: v(mvhd) === 1 ? u32(b, mvhd.start + 28) : u32(b, mvhd.start + 20),
  };
}

// Decode time (tfdt) of a moof; throws for layouts the mux does not handle.
export function fragmentTime(b, moof) {
  const traf = child(b, moof, 'traf');
  const tfhd = traf && child(b, traf, 'tfhd');
  if (!tfhd) throw new Error('moof without traf/tfhd');
  const flags = u32(b, tfhd.start + 8) & 0xffffff;
  if (flags & 0x000001) throw new Error('tfhd base-data-offset-present: absolute offsets are not supported');
  const tfdt = child(b, traf, 'tfdt');
  if (!tfdt) throw new Error('fragment without tfdt');
  return b[tfdt.start + 8] === 1 ? u64(b, tfdt.start + 12) : u32(b, tfdt.start + 12);
}

// In place: new mfhd sequence number + tfhd track id of every traf (out = moof bytes, optionally followed by its mdat).
function patchMoof(out, trackId, seq) {
  const moof = children(out, 0, out.length)[0];
  const mfhd = child(out, moof, 'mfhd');
  w32(out, mfhd.start + 12, seq);
  for (const traf of children(out, moof.start + moof.hdr, moof.end).filter((c) => c.type === 'traf')) {
    const tfhd = child(out, traf, 'tfhd');
    w32(out, tfhd.start + 12, trackId);
  }
  return out;
}
const patchFragment = (bytes, trackId, seq) => patchMoof(bytes.slice(), trackId, seq);

// Parse a whole fMP4 held in memory.
export function parseFmp4(b) {
  const top = children(b);
  const ftyp = top.find((c) => c.type === 'ftyp');
  const moov = top.find((c) => c.type === 'moov');
  if (!moov) throw new Error('no moov');
  const frags = [];
  for (let i = 0; i < top.length; i++) {
    if (top[i].type !== 'moof') continue;
    const mdat = top[i + 1] && top[i + 1].type === 'mdat' ? top[i + 1] : null;
    if (!mdat) throw new Error('moof without following mdat');
    frags.push({ start: top[i].start, end: mdat.end, bmdt: fragmentTime(b, top[i]) });
  }
  return { b, ftyp, moov, info: trackInfo(b, moov), frags };
}

function setTkhdId(trak, id) {
  const tkhd = child(trak, children(trak)[0], 'tkhd');
  w32(trak, tkhd.start + (trak[tkhd.start + 8] === 1 ? 28 : 20), id);
}
function rescaleElst(trak, from, to) {
  if (from === to) return;
  const elst = path(trak, children(trak)[0], 'edts', 'elst');
  if (!elst) return;
  const v = trak[elst.start + 8];
  const n = u32(trak, elst.start + 12);
  for (let k = 0; k < n; k++) {
    const o = elst.start + 16 + k * (v === 1 ? 20 : 12);
    if (v === 1) w64(trak, o, Math.round(u64(trak, o) * to / from)); else w32(trak, o, Math.round(u32(trak, o) * to / from));
  }
}
// moov(video) + audio trak (track 2) -> merged moov bytes
export function mergeMoov(vb, vMoov, ab, aMoov) {
  const vi = trackInfo(vb, vMoov);
  const ai = trackInfo(ab, aMoov);
  const mvhd = vb.slice(vi.mvhd.start, vi.mvhd.end);
  w32(mvhd, mvhd.length - 4, 3);   // next_track_ID
  const vtrak = vb.slice(vi.trak.start, vi.trak.end);
  setTkhdId(vtrak, 1);
  // audio trak: track 2; edit-list durations are in movie timescale -> the video's
  const atrak = ab.slice(ai.trak.start, ai.trak.end);
  setTkhdId(atrak, 2);
  rescaleElst(atrak, ai.movieTimescale, vi.movieTimescale);
  const vmvex = child(vb, vMoov, 'mvex');
  const amvex = child(ab, aMoov, 'mvex');
  if (!vmvex || !amvex) throw new Error('not a fragmented MP4 (no mvex)');
  const vtrex = vb.slice(...span(child(vb, vmvex, 'trex')));
  const atrex = ab.slice(...span(child(ab, amvex, 'trex')));
  w32(vtrex, 12, 1); w32(atrex, 12, 2);
  const parts = [vtrex, atrex];
  const vmehd = child(vb, vmvex, 'mehd');
  const amehd = child(ab, amvex, 'mehd');
  if (vmehd || amehd) {
    const dur = (b, m, ts) => (m ? (b[m.start + 8] === 1 ? u64(b, m.start + 12) : u32(b, m.start + 12)) * vi.movieTimescale / ts : 0);
    const d = Math.ceil(Math.max(dur(vb, vmehd, vi.movieTimescale), dur(ab, amehd, ai.movieTimescale)));
    const mehd = new Uint8Array(20); w32(mehd, 0, 20); mehd.set(enc('mehd'), 4); mehd[8] = 1; w64(mehd, 12, d);
    parts.unshift(mehd);
  }
  const mvex = box('mvex', ...parts);
  const others = children(vb, vMoov.start + vMoov.hdr, vMoov.end).filter((c) => !['mvhd', 'trak', 'mvex'].includes(c.type)).map((c) => vb.slice(c.start, c.end));
  return box('moov', mvhd, vtrak, atrak, ...others, mvex);
}
function span(c) { if (!c) throw new Error('mvex without trex'); return [c.start, c.end]; }

// In-memory mux (tests, small clips)
export function muxCmafBytes(videoBytes, audioBytes) {
  const v = parseFmp4(videoBytes);
  const a = parseFmp4(audioBytes);
  const parts = [...(v.ftyp ? [v.b.slice(v.ftyp.start, v.ftyp.end)] : []), mergeMoov(v.b, v.moov, a.b, a.moov)];
  let seq = 0, ai = 0;
  for (const f of v.frags) {
    const tv = f.bmdt / v.info.timescale;
    while (ai < a.frags.length && a.frags[ai].bmdt / a.info.timescale <= tv) { parts.push(patchFragment(a.b.subarray(a.frags[ai].start, a.frags[ai].end), 2, ++seq)); ai++; }
    parts.push(patchFragment(v.b.subarray(f.start, f.end), 1, ++seq));
  }
  while (ai < a.frags.length) { parts.push(patchFragment(a.b.subarray(a.frags[ai].start, a.frags[ai].end), 2, ++seq)); ai++; }
  return concat(parts);
}

const MAX_SMALL_BOX = 8 << 20;   // ftyp / moov / moof are copied: never more than this
// Streaming mux: the video from a ReadableStream, the audio file in memory. Pull-based; cancelling it cancels the video.
export function muxCmafStream(videoStream, audioBytes) {
  const a = parseFmp4(audioBytes);
  const reader = videoStream.getReader();
  const q = [];
  let qLen = 0, eof = false;
  const fill = async (n) => {
    while (qLen < n && !eof) {
      const r = await reader.read();
      if (r.done) { eof = true; break; }
      const v = r.value instanceof Uint8Array ? r.value : new Uint8Array(r.value);
      if (v.byteLength) { q.push(v); qLen += v.byteLength; }
    }
    return qLen >= n;
  };
  const peek = (n) => {
    const out = new Uint8Array(n);
    let o = 0;
    for (const c of q) { const k = Math.min(c.byteLength, n - o); out.set(c.subarray(0, k), o); o += k; if (o >= n) break; }
    return out;
  };
  const take = (n) => {   // one copy of exactly n bytes (small boxes only)
    const out = new Uint8Array(n);
    let o = 0;
    while (o < n) {
      const c = q[0];
      const k = Math.min(c.byteLength, n - o);
      out.set(c.subarray(0, k), o);
      o += k;
      if (k === c.byteLength) q.shift(); else q[0] = c.subarray(k);
    }
    qLen -= n;
    return out;
  };
  const takeChunk = (max) => {   // the next queued chunk (or its first `max` bytes), no copy
    let c = q.shift();
    if (c.byteLength > max) { q.unshift(c.subarray(max)); c = c.subarray(0, max); }
    qLen -= c.byteLength;
    return c;
  };
  const header = async () => {
    if (!(await fill(8))) { if (qLen) throw new Error('truncated video stream'); return null; }
    let h = peek(8);
    let size = u32(h, 0), hdr = 8;
    if (size === 1) { if (!(await fill(16))) throw new Error('truncated video stream'); h = peek(16); size = u64(h, 8); hdr = 16; }
    else if (size === 0) throw new Error('open-ended box');
    if (size < hdr) throw new Error('bad box size');
    return { type: type(h, 0), size, hdr };
  };
  const takeBox = async (bx) => {
    if (bx.size > MAX_SMALL_BOX) throw new Error(`${bx.type} box too large`);
    if (!(await fill(bx.size))) throw new Error('truncated video stream');
    return take(bx.size);
  };
  let started = false, seq = 0, ai = 0, vTimescale = 0, mdatLeft = 0, skipLeft = 0;
  const audioUpTo = (ctl, tv) => {
    while (ai < a.frags.length && a.frags[ai].bmdt / a.info.timescale <= tv) {
      ctl.enqueue(patchFragment(a.b.subarray(a.frags[ai].start, a.frags[ai].end), 2, ++seq));
      ai++;
    }
  };
  async function step(ctl) {
    if (!started) {
      started = true;
      let ftyp = null, moov = null;
      while (!moov) {
        const bx = await header();
        if (!bx) throw new Error('no moov in video');
        const bytes = await takeBox(bx);
        if (bx.type === 'ftyp') ftyp = bytes; else if (bx.type === 'moov') moov = bytes;
      }
      const vMoov = children(moov)[0];
      vTimescale = trackInfo(moov, vMoov).timescale;
      if (ftyp) ctl.enqueue(ftyp);
      ctl.enqueue(mergeMoov(moov, vMoov, a.b, a.moov));
      return;
    }
    for (;;) {
      if (mdatLeft > 0) {   // mdat payload: passes straight through
        if (!qLen && !(await fill(1))) throw new Error('truncated video stream');
        const c = takeChunk(mdatLeft);
        mdatLeft -= c.byteLength;
        ctl.enqueue(c);
        return;
      }
      if (skipLeft > 0) {   // dropped box (sidx, styp, free, ...)
        if (!qLen && !(await fill(1))) throw new Error('truncated video stream');
        skipLeft -= takeChunk(skipLeft).byteLength;
        continue;
      }
      const bx = await header();
      if (!bx) { audioUpTo(ctl, Infinity); ctl.close(); return; }
      if (bx.type === 'moof') {
        const moof = await takeBox(bx);
        audioUpTo(ctl, fragmentTime(moof, children(moof)[0]) / vTimescale);
        ctl.enqueue(patchMoof(moof, 1, ++seq));
        return;
      }
      if (bx.type === 'mdat') {
        await fill(bx.hdr);
        ctl.enqueue(take(bx.hdr));
        mdatLeft = bx.size - bx.hdr;
        return;
      }
      skipLeft = bx.size;
    }
  }
  return new ReadableStream({
    pull(ctl) { return step(ctl); },
    cancel(reason) { return reader.cancel(reason).catch(() => {}); },
  });
}

// Exact output length before streaming (a Response / R2 put of a stream needs it: FixedLengthStream). videoHead = the
// first bytes of the video up to and including its sidx (Range bytes=0-65535 is plenty); the sidx references give the
// moof+mdat sizes, so no full download is needed. null when the head has no moov/sidx (or a hierarchical sidx).
export function muxedLength(videoHead, audioBytes) {
  const a = parseFmp4(audioBytes);
  let o = 0, ftyp = null, moov = null, sidxTotal = null;
  while (o + 8 <= videoHead.length) {
    const size = u32(videoHead, o);
    const t = type(videoHead, o);
    if (size < 8 || o + size > videoHead.length) break;
    if (t === 'ftyp') ftyp = videoHead.slice(o, o + size);
    if (t === 'moov') moov = videoHead.slice(o, o + size);
    if (t === 'sidx') {
      const v = videoHead[o + 8];
      const n = (videoHead[o + (v === 1 ? 38 : 30)] << 8) | videoHead[o + (v === 1 ? 39 : 31)];
      const first = o + (v === 1 ? 40 : 32);
      if (first + n * 12 > o + size) return null;
      sidxTotal = 0;
      for (let k = 0; k < n; k++) {
        const ref = u32(videoHead, first + k * 12);
        if (ref >>> 31) return null;   // hierarchical sidx: not handled
        sidxTotal += ref & 0x7fffffff;
      }
    }
    if (t === 'moof') {
      // the first fragment must be one the mux handles (no absolute offsets, has tfdt)
      try { fragmentTime(videoHead.subarray(o, o + size), { start: 0, end: size, hdr: 8 }); } catch (e) { return null; }
      break;
    }
    o += size;
  }
  if (!moov || sidxTotal == null) return null;
  const header = (ftyp ? ftyp.length : 0) + mergeMoov(moov, children(moov)[0], a.b, a.moov).length;
  return header + sidxTotal + a.frags.reduce((s, f) => s + (f.end - f.start), 0);
}
