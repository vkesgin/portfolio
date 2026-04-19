document.addEventListener('DOMContentLoaded', () => {
  const recBtn = document.getElementById('recBtn');
  const recIcon = document.getElementById('recIcon');
  const audioTimer = document.getElementById('audioTimer');
  const audioStatus = document.getElementById('audioStatus');
  const pauseStopRow = document.getElementById('pauseStopRow');
  const pauseBtn = document.getElementById('pauseBtn');
  const stopBtn = document.getElementById('stopBtn');
  const vuMeter = document.getElementById('vuMeter');

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
  let audioContext = null;
  let analyser = null;
  let audioBuffer = null;
  let timerInterval = null;
  let startTime = 0;
  let elapsed = 0;
  let isPaused = false;
  let animFrame = null;
  let currentPlaySource = null;

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

  // --- VU Metre (Canlı Ses Seviyesi) ---
  function startVU(stream) {
    audioContext = new (window.AudioContext || window.webkitAudioContext)();
    const source = audioContext.createMediaStreamSource(stream);
    analyser = audioContext.createAnalyser();
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

      // Renk değişimi
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

  // --- KAYIT BAŞLAT ---
  recBtn.addEventListener('click', async () => {
    if (mediaRecorder && mediaRecorder.state === 'recording') return;

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      audioChunks = [];

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

      mediaRecorder.start(100); // Her 100ms'de data topla
      startVU(stream);
      startTimer();

      // UI Güncellemeleri
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

    // AudioContext ile decode et
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    audioBuffer = await ctx.decodeAudioData(arrayBuffer);

    // Trim slider ayarla
    const duration = audioBuffer.duration;
    trimStart.max = duration;
    trimEnd.max = duration;
    trimStart.value = 0;
    trimEnd.value = duration;
    trimStart.step = 0.1;
    trimEnd.step = 0.1;
    trimStartVal.textContent = '0.0s';
    trimEndVal.textContent = duration.toFixed(1) + 's';

    // Waveform çiz
    drawWaveform(audioBuffer);

    // Göster
    audioEmpty.style.display = 'none';
    audioResult.style.display = 'block';

    if (typeof gsap !== 'undefined') {
      gsap.fromTo(audioResult, { y: 20, opacity: 0 }, { y: 0, opacity: 1, duration: 0.5 });
    }
  }

  // --- DALGA FORMU ÇİZİMİ ---
  function drawWaveform(buffer) {
    const canvas = waveformCanvas;
    const ctx = canvas.getContext('2d');
    const dpr = window.devicePixelRatio || 1;

    canvas.width = canvas.offsetWidth * dpr;
    canvas.height = canvas.offsetHeight * dpr;
    ctx.scale(dpr, dpr);

    const width = canvas.offsetWidth;
    const height = canvas.offsetHeight;

    ctx.clearRect(0, 0, width, height);

    const data = buffer.getChannelData(0);
    const step = Math.ceil(data.length / width);
    const mid = height / 2;

    // Arkaplan gradient
    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    ctx.fillRect(0, 0, width, height);

    // Dalga çizimi
    ctx.strokeStyle = '#00e5ff';
    ctx.lineWidth = 1;
    ctx.beginPath();

    for (let i = 0; i < width; i++) {
      let min = 1.0, max = -1.0;
      for (let j = 0; j < step; j++) {
        const datum = data[(i * step) + j];
        if (datum < min) min = datum;
        if (datum > max) max = datum;
      }
      const yMin = (1 + min) * mid;
      const yMax = (1 + max) * mid;
      ctx.moveTo(i, yMin);
      ctx.lineTo(i, yMax);
    }
    ctx.stroke();

    // Orta çizgi
    ctx.strokeStyle = 'rgba(0,229,255,0.2)';
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
    if (currentPlaySource) {
      currentPlaySource.stop();
      currentPlaySource = null;
      playTrimmedBtn.textContent = '▶ Kırpılmışı Dinle';
      return;
    }

    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const startSec = parseFloat(trimStart.value);
    const endSec = parseFloat(trimEnd.value);
    const duration = endSec - startSec;

    const sampleRate = audioBuffer.sampleRate;
    const startSample = Math.floor(startSec * sampleRate);
    const endSample = Math.floor(endSec * sampleRate);
    const length = endSample - startSample;

    const trimmedBuffer = ctx.createBuffer(
      audioBuffer.numberOfChannels,
      length,
      sampleRate
    );

    for (let ch = 0; ch < audioBuffer.numberOfChannels; ch++) {
      const sourceData = audioBuffer.getChannelData(ch);
      const targetData = trimmedBuffer.getChannelData(ch);
      for (let i = 0; i < length; i++) {
        targetData[i] = sourceData[startSample + i];
      }
    }

    const source = ctx.createBufferSource();
    source.buffer = trimmedBuffer;
    source.connect(ctx.destination);
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

    // WAV header oluştur
    const wavBuffer = new ArrayBuffer(44 + length * numChannels * 2);
    const view = new DataView(wavBuffer);

    function writeString(offset, string) {
      for (let i = 0; i < string.length; i++) {
        view.setUint8(offset + i, string.charCodeAt(i));
      }
    }

    const bytesPerSample = 2;
    const blockAlign = numChannels * bytesPerSample;
    const byteRate = sampleRate * blockAlign;
    const dataSize = length * blockAlign;

    writeString(0, 'RIFF');
    view.setUint32(4, 36 + dataSize, true);
    writeString(8, 'WAVE');
    writeString(12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true); // PCM
    view.setUint16(22, numChannels, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, byteRate, true);
    view.setUint16(32, blockAlign, true);
    view.setUint16(34, 16, true); // bits per sample

    writeString(36, 'data');
    view.setUint32(40, dataSize, true);

    // Interleave channels
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

    setTimeout(() => {
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }, 500);
  });
});
