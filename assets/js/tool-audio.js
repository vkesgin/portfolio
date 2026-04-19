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

  // GSAP Animations
  if (typeof gsap !== 'undefined') {
    gsap.from('#tool-hero', { y: 30, opacity: 0, duration: 1, ease: 'power3.out' });
    gsap.from('.tool-card', { y: 40, opacity: 0, duration: 1, delay: 0.3, ease: 'power3.out' });
  }

  // --- Zamanlayıcı ---
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

  function stopTimer() {
    clearInterval(timerInterval);
  }

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
      const percent = Math.min((avg / 128) * 100, 100);
      vuMeter.style.width = percent + '%';
      if (percent > 80) vuMeter.style.background = '#ff4d4d';
      else if (percent > 50) vuMeter.style.background = '#ffaa00';
      else vuMeter.style.background = 'var(--accent)';
      animFrame = requestAnimationFrame(draw);
    }
    draw();
  }

  function stopVU() {
    cancelAnimationFrame(animFrame);
    vuMeter.style.width = '0%';
  }

  // --- SES DOSYASI YÜKLEME ---
  audioFileInput.addEventListener('change', async (e) => {
    if (e.target.files.length === 0) return;
    const file = e.target.files[0];
    
    audioStatus.textContent = '📂 Dosya yükleniyor...';
    
    try {
      const arrayBuffer = await file.arrayBuffer();
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      audioBuffer = await ctx.decodeAudioData(arrayBuffer);
      
      audioTimer.textContent = formatTime(audioBuffer.duration);
      audioStatus.textContent = '✅ Dosya Yüklendi: ' + file.name;
      
      showResult();
    } catch (err) {
      alert('Bu ses dosyası açılamadı! Lütfen geçerli bir ses dosyası seçin.');
      console.error(err);
    }
  });

  // --- KAYIT BAŞLAT ---
  recBtn.addEventListener('click', async () => {
    if (mediaRecorder && mediaRecorder.state === 'recording') return;

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      audioChunks = [];
      elapsed = 0;

      mediaRecorder = new MediaRecorder(stream);

      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) audioChunks.push(e.data);
      };

      mediaRecorder.onstop = () => {
        stream.getTracks().forEach(t => t.stop());
        stopVU();
        stopTimer();
        processRecording();
      };

      mediaRecorder.start(100);
      startVU(stream);
      startTimer();

      recBtn.classList.add('recording');
      audioStatus.textContent = '🔴 Kayıt Yapılıyor...';
      pauseStopRow.style.display = 'flex';
      isPaused = false;
      pauseBtn.textContent = '⏸ Duraklat';

    } catch (err) {
      alert('Mikrofon erişimi reddedildi! Lütfen tarayıcı ayarlarından mikrofon iznini açın.');
      console.error(err);
    }
  });

  // --- DURAKLAT ---
  pauseBtn.addEventListener('click', () => {
    if (!mediaRecorder) return;
    if (mediaRecorder.state === 'recording') {
      mediaRecorder.pause();
      stopTimer();
      isPaused = true;
      pauseBtn.textContent = '▶ Devam Et';
      audioStatus.textContent = '⏸ Duraklatıldı';
    } else if (mediaRecorder.state === 'paused') {
      mediaRecorder.resume();
      startTimer();
      isPaused = false;
      pauseBtn.textContent = '⏸ Duraklat';
      audioStatus.textContent = '🔴 Kayıt Yapılıyor...';
    }
  });

  // --- DURDUR ---
  stopBtn.addEventListener('click', () => {
    if (mediaRecorder && (mediaRecorder.state === 'recording' || mediaRecorder.state === 'paused')) {
      mediaRecorder.stop();
      recBtn.classList.remove('recording');
      audioStatus.textContent = '✅ Kayıt Tamamlandı';
      pauseStopRow.style.display = 'none';
    }
  });

  // --- KAYDI İŞLE ---
  async function processRecording() {
    const blob = new Blob(audioChunks, { type: 'audio/webm' });
    const arrayBuffer = await blob.arrayBuffer();
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    audioBuffer = await ctx.decodeAudioData(arrayBuffer);
    showResult();
  }

  // --- SONUCU GÖSTER ---
  function showResult() {
    if (!audioBuffer) return;

    const duration = audioBuffer.duration;
    trimStart.max = duration;
    trimEnd.max = duration;
    trimStart.value = 0;
    trimEnd.value = duration;
    trimStart.step = 0.1;
    trimEnd.step = 0.1;
    trimStartVal.textContent = '0.0s';
    trimEndVal.textContent = duration.toFixed(1) + 's';

    // Önce göster sonra dalga çiz (canvas boyutu doğru olsun diye)
    audioEmpty.style.display = 'none';
    audioResult.style.display = 'block';

    // Bir frame bekle ki DOM render'ı tamamlansın
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        drawWaveform(audioBuffer);
      });
    });

    if (typeof gsap !== 'undefined') {
      gsap.fromTo(audioResult, { y: 20, opacity: 0 }, { y: 0, opacity: 1, duration: 0.5 });
    }
  }

  // --- DALGA FORMU ÇİZİMİ ---
  function drawWaveform(buffer) {
    const canvas = waveformCanvas;
    const ctx = canvas.getContext('2d');

    // Canvas'ın gerçek piksel boyutunu ayarla
    const rect = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const width = rect.width;
    const height = rect.height;

    canvas.width = width * dpr;
    canvas.height = height * dpr;
    ctx.scale(dpr, dpr);

    // Temizle
    ctx.clearRect(0, 0, width, height);

    // Arkaplan
    ctx.fillStyle = 'rgba(0,0,0,0.2)';
    ctx.fillRect(0, 0, width, height);

    const data = buffer.getChannelData(0);
    const step = Math.ceil(data.length / width);
    const mid = height / 2;

    // Bar-style dalga çizimi (daha görünür)
    for (let i = 0; i < width; i++) {
      let min = 1.0, max = -1.0;
      for (let j = 0; j < step; j++) {
        const idx = (i * step) + j;
        if (idx < data.length) {
          const datum = data[idx];
          if (datum < min) min = datum;
          if (datum > max) max = datum;
        }
      }

      const barTop = (1 + max) * mid;
      const barBottom = (1 + min) * mid;
      const barHeight = barBottom - barTop;

      // Gradient renk — ortası parlak, kenarları koyu
      const intensity = Math.abs(max - min);
      const alpha = Math.min(0.3 + intensity * 2, 1);

      ctx.fillStyle = `rgba(0, 229, 255, ${alpha})`;
      ctx.fillRect(i, barTop, 1, Math.max(barHeight, 1));
    }

    // Orta çizgi
    ctx.strokeStyle = 'rgba(0,229,255,0.15)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, mid);
    ctx.lineTo(width, mid);
    ctx.stroke();
  }

  // --- TRIM SLIDER ---
  trimStart.addEventListener('input', () => {
    const val = parseFloat(trimStart.value);
    if (val >= parseFloat(trimEnd.value)) {
      trimStart.value = parseFloat(trimEnd.value) - 0.1;
    }
    trimStartVal.textContent = parseFloat(trimStart.value).toFixed(1) + 's';
  });

  trimEnd.addEventListener('input', () => {
    const val = parseFloat(trimEnd.value);
    if (val <= parseFloat(trimStart.value)) {
      trimEnd.value = parseFloat(trimStart.value) + 0.1;
    }
    trimEndVal.textContent = parseFloat(trimEnd.value).toFixed(1) + 's';
  });

  // --- KIRPILMIŞI DİNLE ---
  playTrimmedBtn.addEventListener('click', () => {
    if (!audioBuffer) return;

    // Çalıyorsa durdur
    if (currentPlaySource) {
      currentPlaySource.stop();
      currentPlaySource = null;
      playTrimmedBtn.textContent = '▶ Kırpılmışı Dinle';
      return;
    }

    playCtx = new (window.AudioContext || window.webkitAudioContext)();
    const startSec = parseFloat(trimStart.value);
    const endSec = parseFloat(trimEnd.value);
    const sampleRate = audioBuffer.sampleRate;
    const startSample = Math.floor(startSec * sampleRate);
    const endSample = Math.floor(endSec * sampleRate);
    const length = endSample - startSample;

    if (length <= 0) return;

    const trimmedBuffer = playCtx.createBuffer(
      audioBuffer.numberOfChannels, length, sampleRate
    );

    for (let ch = 0; ch < audioBuffer.numberOfChannels; ch++) {
      const src = audioBuffer.getChannelData(ch);
      const dst = trimmedBuffer.getChannelData(ch);
      for (let i = 0; i < length; i++) {
        dst[i] = src[startSample + i];
      }
    }

    const source = playCtx.createBufferSource();
    source.buffer = trimmedBuffer;
    source.connect(playCtx.destination);
    source.start();
    currentPlaySource = source;
    playTrimmedBtn.textContent = '⏹ Durdur';

    source.onended = () => {
      currentPlaySource = null;
      playTrimmedBtn.textContent = '▶ Kırpılmışı Dinle';
    };
  });

  // --- WAV OLARAK İNDİR ---
  downloadBtn.addEventListener('click', () => {
    if (!audioBuffer) return;

    const startSec = parseFloat(trimStart.value);
    const endSec = parseFloat(trimEnd.value);
    const sampleRate = audioBuffer.sampleRate;
    const startSample = Math.floor(startSec * sampleRate);
    const endSample = Math.floor(endSec * sampleRate);
    const length = endSample - startSample;
    const numChannels = audioBuffer.numberOfChannels;

    if (length <= 0) return;

    // WAV header
    const bytesPerSample = 2;
    const blockAlign = numChannels * bytesPerSample;
    const byteRate = sampleRate * blockAlign;
    const dataSize = length * blockAlign;
    const wavBuffer = new ArrayBuffer(44 + dataSize);
    const view = new DataView(wavBuffer);

    function ws(offset, str) {
      for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i));
    }

    ws(0, 'RIFF');
    view.setUint32(4, 36 + dataSize, true);
    ws(8, 'WAVE');
    ws(12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, numChannels, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, byteRate, true);
    view.setUint16(32, blockAlign, true);
    view.setUint16(34, 16, true);
    ws(36, 'data');
    view.setUint32(40, dataSize, true);

    let offset = 44;
    for (let i = 0; i < length; i++) {
      for (let ch = 0; ch < numChannels; ch++) {
        const sample = audioBuffer.getChannelData(ch)[startSample + i];
        const clamped = Math.max(-1, Math.min(1, sample));
        view.setInt16(offset, clamped < 0 ? clamped * 0x8000 : clamped * 0x7FFF, true);
        offset += 2;
      }
    }

    const blob = new Blob([wavBuffer], { type: 'audio/wav' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'ses-kaydi.wav';
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { document.body.removeChild(a); URL.revokeObjectURL(url); }, 500);
  });
});
