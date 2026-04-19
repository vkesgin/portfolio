document.addEventListener('DOMContentLoaded', () => {
  const recBtn = document.getElementById('recBtn');
  const recIcon = document.getElementById('recIcon');
  const audioTimer = document.getElementById('audioTimer');
  const audioStatus = document.getElementById('audioStatus');
  const pauseStopRow = document.getElementById('pauseStopRow');
  const pauseBtn = document.getElementById('pauseBtn');
  const stopBtn = document.getElementById('stopBtn');
  const vuMeter = document.getElementById('vuMeter');
  const audioFileInput = document.getElementById('audioFileInput');

  const audioEmpty = document.getElementById('audioEmpty');
  const audioResult = document.getElementById('audioResult');
  const waveformCanvas = document.getElementById('waveformCanvas');
  const trimStart = document.getElementById('trimStart');
  const trimEnd = document.getElementById('trimEnd');
  const trimStartVal = document.getElementById('trimStartVal');
  const trimEndVal = document.getElementById('trimEndVal');
  const playTrimmedBtn = document.getElementById('playTrimmed');
  const downloadBtn = document.getElementById('downloadAudio');

  let mediaRecorder = null;
  let audioChunks = [];
  let audioBuffer = null;
  let timerInterval = null;
  let startTime = 0;
  let elapsed = 0;
  let isPaused = false;
  let animFrame = null;
  let currentPlaySource = null;
  let playCtx = null;
  let playStartTime = 0;
  let playAnimFrame = null;
  let canvasWidth = 0;
  let canvasHeight = 0;
  let canvasDpr = 1;

  // Waveform verilerini cache'le
  let waveformPeaks = [];

  if (typeof gsap !== 'undefined') {
    gsap.from('#tool-hero', { y: 30, opacity: 0, duration: 1, ease: 'power3.out' });
    gsap.from('.tool-card', { y: 40, opacity: 0, duration: 1, delay: 0.3, ease: 'power3.out' });
  }

  function formatTime(seconds) {
    const m = Math.floor(seconds / 60).toString().padStart(2, '0');
    const s = Math.floor(seconds % 60).toString().padStart(2, '0');
    return `${m}:${s}`;
  }

  function startTimer() {
    startTime = Date.now() - (elapsed * 1000);
    timerInterval = setInterval(() => {
      elapsed = (Date.now() - startTime) / 1000;
      audioTimer.textContent = formatTime(elapsed);
    }, 200);
  }
  function stopTimer() { clearInterval(timerInterval); }

  // --- VU Metre ---
  function startVU(stream) {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const source = ctx.createMediaStreamSource(stream);
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 256;
    source.connect(analyser);
    const dataArray = new Uint8Array(analyser.frequencyBinCount);
    function draw() {
      analyser.getByteFrequencyData(dataArray);
      let sum = 0;
      for (let i = 0; i < dataArray.length; i++) sum += dataArray[i];
      const avg = sum / dataArray.length;
      const pct = Math.min((avg / 128) * 100, 100);
      vuMeter.style.width = pct + '%';
      vuMeter.style.background = pct > 80 ? '#ff4d4d' : pct > 50 ? '#ffaa00' : 'var(--accent)';
      animFrame = requestAnimationFrame(draw);
    }
    draw();
  }
  function stopVU() { cancelAnimationFrame(animFrame); vuMeter.style.width = '0%'; }

  // === SES DOSYASI YÜKLEME ===
  audioFileInput.addEventListener('change', async (e) => {
    if (e.target.files.length === 0) return;
    const file = e.target.files[0];
    audioStatus.textContent = '📂 Dosya yükleniyor...';
    try {
      const arrayBuffer = await file.arrayBuffer();
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      audioBuffer = await ctx.decodeAudioData(arrayBuffer);
      audioTimer.textContent = formatTime(audioBuffer.duration);
      audioStatus.textContent = '✅ ' + file.name;
      showResult();
    } catch (err) {
      alert('Bu ses dosyası açılamadı!');
      console.error(err);
    }
  });

  // === KAYIT ===
  recBtn.addEventListener('click', async () => {
    if (mediaRecorder && mediaRecorder.state === 'recording') return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      audioChunks = []; elapsed = 0;
      mediaRecorder = new MediaRecorder(stream);
      mediaRecorder.ondataavailable = (e) => { if (e.data.size > 0) audioChunks.push(e.data); };
      mediaRecorder.onstop = () => {
        stream.getTracks().forEach(t => t.stop());
        stopVU(); stopTimer();
        processRecording();
      };
      mediaRecorder.start(100);
      startVU(stream); startTimer();
      recBtn.classList.add('recording');
      audioStatus.textContent = '🔴 Kayıt Yapılıyor...';
      pauseStopRow.style.display = 'flex';
      isPaused = false;
      pauseBtn.textContent = '⏸ Duraklat';
    } catch (err) {
      alert('Mikrofon erişimi reddedildi!');
    }
  });

  pauseBtn.addEventListener('click', () => {
    if (!mediaRecorder) return;
    if (mediaRecorder.state === 'recording') {
      mediaRecorder.pause(); stopTimer();
      pauseBtn.textContent = '▶ Devam Et';
      audioStatus.textContent = '⏸ Duraklatıldı';
    } else if (mediaRecorder.state === 'paused') {
      mediaRecorder.resume(); startTimer();
      pauseBtn.textContent = '⏸ Duraklat';
      audioStatus.textContent = '🔴 Kayıt Yapılıyor...';
    }
  });

  stopBtn.addEventListener('click', () => {
    if (mediaRecorder && (mediaRecorder.state === 'recording' || mediaRecorder.state === 'paused')) {
      mediaRecorder.stop();
      recBtn.classList.remove('recording');
      audioStatus.textContent = '✅ Kayıt Tamamlandı';
      pauseStopRow.style.display = 'none';
    }
  });

  async function processRecording() {
    const blob = new Blob(audioChunks, { type: 'audio/webm' });
    const ab = await blob.arrayBuffer();
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    audioBuffer = await ctx.decodeAudioData(ab);
    showResult();
  }

  // === SONUCU GÖSTER ===
  function showResult() {
    if (!audioBuffer) return;
    const dur = audioBuffer.duration;
    trimStart.max = dur; trimEnd.max = dur;
    trimStart.value = 0; trimEnd.value = dur;
    trimStart.step = 0.1; trimEnd.step = 0.1;
    trimStartVal.textContent = '0.0s';
    trimEndVal.textContent = dur.toFixed(1) + 's';

    audioEmpty.style.display = 'none';
    audioResult.style.display = 'block';

    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        setupCanvas();
        computePeaks();
        renderWaveform();
      });
    });

    if (typeof gsap !== 'undefined') {
      gsap.fromTo(audioResult, { y: 20, opacity: 0 }, { y: 0, opacity: 1, duration: 0.5 });
    }
  }

  // === CANVAS SETUP ===
  function setupCanvas() {
    const rect = waveformCanvas.getBoundingClientRect();
    canvasDpr = window.devicePixelRatio || 1;
    canvasWidth = rect.width;
    canvasHeight = rect.height;
    waveformCanvas.width = canvasWidth * canvasDpr;
    waveformCanvas.height = canvasHeight * canvasDpr;
  }

  // === PEAK VERİLERİNİ HESAPLA ===
  function computePeaks() {
    if (!audioBuffer) return;
    const data = audioBuffer.getChannelData(0);
    const barCount = Math.floor(canvasWidth / 3); // Her bar 3px genişliğinde
    const step = Math.floor(data.length / barCount);
    waveformPeaks = [];

    // Max peak bul (normalize etmek için)
    let globalMax = 0;
    for (let i = 0; i < barCount; i++) {
      let min = 1.0, max = -1.0;
      for (let j = 0; j < step; j++) {
        const idx = i * step + j;
        if (idx < data.length) {
          if (data[idx] < min) min = data[idx];
          if (data[idx] > max) max = data[idx];
        }
      }
      const amplitude = max - min;
      if (amplitude > globalMax) globalMax = amplitude;
      waveformPeaks.push({ min, max, amplitude });
    }

    // Normalize et
    if (globalMax > 0) {
      waveformPeaks.forEach(p => {
        p.normalizedMin = p.min / globalMax;
        p.normalizedMax = p.max / globalMax;
      });
    }
  }

  // === DALGA ÇİZİMİ (trim markers + timeline) ===
  function renderWaveform(playheadRatio) {
    const canvas = waveformCanvas;
    const ctx = canvas.getContext('2d');
    ctx.setTransform(canvasDpr, 0, 0, canvasDpr, 0, 0);

    const w = canvasWidth;
    const h = canvasHeight;
    const mid = h / 2;
    const barW = 2;
    const gap = 1;
    const totalBarW = barW + gap;

    ctx.clearRect(0, 0, w, h);

    // Arkaplan
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    ctx.fillRect(0, 0, w, h);

    if (!audioBuffer || waveformPeaks.length === 0) return;

    const dur = audioBuffer.duration;
    const trimS = parseFloat(trimStart.value);
    const trimE = parseFloat(trimEnd.value);
    const trimStartX = (trimS / dur) * w;
    const trimEndX = (trimE / dur) * w;

    // Trim dışı karanlık bölge
    ctx.fillStyle = 'rgba(0,0,0,0.45)';
    ctx.fillRect(0, 0, trimStartX, h);
    ctx.fillRect(trimEndX, 0, w - trimEndX, h);

    // Barlar
    for (let i = 0; i < waveformPeaks.length; i++) {
      const x = i * totalBarW;
      const peak = waveformPeaks[i];
      const barH = Math.max(peak.amplitude / (waveformPeaks.reduce((a,b) => Math.max(a, b.amplitude), 0) || 1) * (h * 0.85), 2);
      const y = mid - barH / 2;

      // Trim içi mi dışı mı?
      const inTrim = x >= trimStartX && x <= trimEndX;

      if (inTrim) {
        ctx.fillStyle = 'rgba(0, 229, 255, 0.85)';
      } else {
        ctx.fillStyle = 'rgba(0, 229, 255, 0.2)';
      }

      ctx.fillRect(x, y, barW, barH);
    }

    // Orta çizgi
    ctx.strokeStyle = 'rgba(255,255,255,0.06)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, mid);
    ctx.lineTo(w, mid);
    ctx.stroke();

    // Trim başlangıç çubuğu (yeşil)
    ctx.fillStyle = '#00ff88';
    ctx.fillRect(trimStartX - 1, 0, 3, h);
    // Üst tutamak
    ctx.beginPath();
    ctx.arc(trimStartX, 6, 5, 0, Math.PI * 2);
    ctx.fill();

    // Trim bitiş çubuğu (kırmızı)
    ctx.fillStyle = '#ff4d4d';
    ctx.fillRect(trimEndX - 1, 0, 3, h);
    ctx.beginPath();
    ctx.arc(trimEndX, 6, 5, 0, Math.PI * 2);
    ctx.fill();

    // Playhead (oynatma sırasında)
    if (playheadRatio !== undefined && playheadRatio >= 0 && playheadRatio <= 1) {
      // Playhead pozisyonu trim aralığında
      const phX = trimStartX + (trimEndX - trimStartX) * playheadRatio;
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(phX - 1, 0, 2, h);
      // Üst daire
      ctx.beginPath();
      ctx.arc(phX, h - 6, 4, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // === TRIM SLIDER → Waveform güncelle ===
  trimStart.addEventListener('input', () => {
    if (parseFloat(trimStart.value) >= parseFloat(trimEnd.value)) {
      trimStart.value = parseFloat(trimEnd.value) - 0.1;
    }
    trimStartVal.textContent = parseFloat(trimStart.value).toFixed(1) + 's';
    stopCurrentPlayback();
    renderWaveform();
  });

  trimEnd.addEventListener('input', () => {
    if (parseFloat(trimEnd.value) <= parseFloat(trimStart.value)) {
      trimEnd.value = parseFloat(trimStart.value) + 0.1;
    }
    trimEndVal.textContent = parseFloat(trimEnd.value).toFixed(1) + 's';
    stopCurrentPlayback();
    renderWaveform();
  });

  // === OYNAT (timeline animasyonlu) ===
  playTrimmedBtn.addEventListener('click', () => {
    if (!audioBuffer) return;

    if (currentPlaySource) {
      stopCurrentPlayback();
      return;
    }

    playCtx = new (window.AudioContext || window.webkitAudioContext)();
    const startSec = parseFloat(trimStart.value);
    const endSec = parseFloat(trimEnd.value);
    const duration = endSec - startSec;
    const sr = audioBuffer.sampleRate;
    const startSample = Math.floor(startSec * sr);
    const endSample = Math.floor(endSec * sr);
    const length = endSample - startSample;

    if (length <= 0) return;

    const trimmedBuffer = playCtx.createBuffer(audioBuffer.numberOfChannels, length, sr);
    for (let ch = 0; ch < audioBuffer.numberOfChannels; ch++) {
      const src = audioBuffer.getChannelData(ch);
      const dst = trimmedBuffer.getChannelData(ch);
      for (let i = 0; i < length; i++) dst[i] = src[startSample + i];
    }

    const source = playCtx.createBufferSource();
    source.buffer = trimmedBuffer;
    source.connect(playCtx.destination);
    source.start();
    currentPlaySource = source;
    playTrimmedBtn.textContent = '⏹ Durdur';
    playStartTime = playCtx.currentTime;

    // Timeline animasyonu
    function animatePlayhead() {
      const elapsed = playCtx.currentTime - playStartTime;
      const ratio = Math.min(elapsed / duration, 1);
      renderWaveform(ratio);
      if (ratio < 1 && currentPlaySource) {
        playAnimFrame = requestAnimationFrame(animatePlayhead);
      }
    }
    animatePlayhead();

    source.onended = () => {
      currentPlaySource = null;
      cancelAnimationFrame(playAnimFrame);
      playTrimmedBtn.textContent = '▶ Kırpılmışı Dinle';
      renderWaveform();
    };
  });

  // === DRAGGING MARKERS ===
  let isDraggingStart = false;
  let isDraggingEnd = false;

  function getMouseX(e) {
    const rect = waveformCanvas.getBoundingClientRect();
    const x = (e.clientX || (e.touches && e.touches[0].clientX)) - rect.left;
    return Math.max(0, Math.min(x, canvasWidth));
  }

  waveformCanvas.addEventListener('mousedown', (e) => {
    if (!audioBuffer) return;
    const x = getMouseX(e);
    const dur = audioBuffer.duration;
    const trimS = parseFloat(trimStart.value);
    const trimE = parseFloat(trimEnd.value);
    const startX = (trimS / dur) * canvasWidth;
    const endX = (trimE / dur) * canvasWidth;

    // Click tolerance (15px)
    if (Math.abs(x - startX) < 15) {
      isDraggingStart = true;
      stopCurrentPlayback();
    } else if (Math.abs(x - endX) < 15) {
      isDraggingEnd = true;
      stopCurrentPlayback();
    }
  });

  function stopCurrentPlayback() {
    if (currentPlaySource) {
      currentPlaySource.stop();
      currentPlaySource = null;
      cancelAnimationFrame(playAnimFrame);
      playTrimmedBtn.textContent = '▶ Kırpılmışı Dinle';
      renderWaveform();
    }
  }

  window.addEventListener('mousemove', (e) => {
    if (!isDraggingStart && !isDraggingEnd) return;
    const x = getMouseX(e);
    const dur = audioBuffer.duration;
    const time = (x / canvasWidth) * dur;

    if (isDraggingStart) {
      if (time < parseFloat(trimEnd.value) - 0.1) {
        trimStart.value = time;
        trimStartVal.textContent = time.toFixed(1) + 's';
      }
    } else if (isDraggingEnd) {
      if (time > parseFloat(trimStart.value) + 0.1) {
        trimEnd.value = time;
        trimEndVal.textContent = time.toFixed(1) + 's';
      }
    }
    renderWaveform();
  });

  window.addEventListener('mouseup', () => {
    isDraggingStart = false;
    isDraggingEnd = false;
  });

  // Touch support
  waveformCanvas.addEventListener('touchstart', (e) => {
    e.preventDefault();
    const x = getMouseX(e);
    const dur = audioBuffer.duration;
    const startX = (parseFloat(trimStart.value) / dur) * canvasWidth;
    const endX = (parseFloat(trimEnd.value) / dur) * canvasWidth;
    
    if (Math.abs(x - startX) < 20) {
      isDraggingStart = true;
      stopCurrentPlayback();
    } else if (Math.abs(x - endX) < 20) {
      isDraggingEnd = true;
      stopCurrentPlayback();
    }
  }, { passive: false });

  window.addEventListener('touchmove', (e) => {
    if (isDraggingStart || isDraggingEnd) {
      e.preventDefault();
      const x = getMouseX(e);
      const dur = audioBuffer.duration;
      const time = (x / canvasWidth) * dur;
      if (isDraggingStart) {
        if (time < parseFloat(trimEnd.value) - 0.1) {
          trimStart.value = time;
          trimStartVal.textContent = time.toFixed(1) + 's';
        }
      } else if (isDraggingEnd) {
        if (time > parseFloat(trimStart.value) + 0.1) {
          trimEnd.value = time;
          trimEndVal.textContent = time.toFixed(1) + 's';
        }
      }
      renderWaveform();
    }
  }, { passive: false });

  window.addEventListener('touchend', () => {
    isDraggingStart = false;
    isDraggingEnd = false;
  });

  // === WAV İNDİR ===
  downloadBtn.addEventListener('click', () => {
    if (!audioBuffer) return;
    const startSec = parseFloat(trimStart.value);
    const endSec = parseFloat(trimEnd.value);
    const sr = audioBuffer.sampleRate;
    const startSample = Math.floor(startSec * sr);
    const endSample = Math.floor(endSec * sr);
    const length = endSample - startSample;
    const nc = audioBuffer.numberOfChannels;
    if (length <= 0) return;

    const bps = 2; const ba = nc * bps;
    const br = sr * ba; const ds = length * ba;
    const buf = new ArrayBuffer(44 + ds);
    const v = new DataView(buf);
    const ws = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };

    ws(0,'RIFF'); v.setUint32(4,36+ds,true); ws(8,'WAVE');
    ws(12,'fmt '); v.setUint32(16,16,true); v.setUint16(20,1,true);
    v.setUint16(22,nc,true); v.setUint32(24,sr,true);
    v.setUint32(28,br,true); v.setUint16(32,ba,true); v.setUint16(34,16,true);
    ws(36,'data'); v.setUint32(40,ds,true);

    let off = 44;
    for (let i = 0; i < length; i++) {
      for (let ch = 0; ch < nc; ch++) {
        const s = Math.max(-1, Math.min(1, audioBuffer.getChannelData(ch)[startSample + i]));
        v.setInt16(off, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
        off += 2;
      }
    }

    const blob = new Blob([buf], { type: 'audio/wav' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'ses-kaydi.wav';
    a.style.display = 'none'; document.body.appendChild(a); a.click();
    setTimeout(() => { document.body.removeChild(a); URL.revokeObjectURL(url); }, 500);
  });
});
