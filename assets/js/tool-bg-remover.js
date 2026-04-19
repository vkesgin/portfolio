document.addEventListener('DOMContentLoaded', () => {
  const uploadZone = document.getElementById('uploadZone');
  const imageInput = document.getElementById('imageInput');
  const emptyState = document.getElementById('emptyState');
  
  const originalPreview = document.getElementById('originalPreview');
  const sourceImage = document.getElementById('sourceImage');
  
  const loadingStatus = document.getElementById('loadingStatus');
  const resultPreview = document.getElementById('resultPreview');
  const outputImage = document.getElementById('outputImage');
  const downloadBtn = document.getElementById('downloadBtn');

  // Progress bar elements
  const progressStage = document.getElementById('progressStage');
  const progressBarFill = document.getElementById('progressBarFill');
  const progressDetail = document.getElementById('progressDetail');

  let currentBlobUrl = null;
  let currentBlob = null; // Store the actual blob for download

  if (typeof gsap !== 'undefined') {
    gsap.from('#tool-hero', { y: 30, opacity: 0, duration: 1, ease: 'power3.out' });
    gsap.from('.tool-card', { y: 40, opacity: 0, duration: 1, delay: 0.3, ease: 'power3.out' });
  }

  // --- Sürükle Bırak Olayları ---
  ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
    uploadZone.addEventListener(eventName, preventDefaults, false);
  });
  function preventDefaults(e) { e.preventDefault(); e.stopPropagation(); }

  uploadZone.addEventListener('dragenter', () => uploadZone.classList.add('dragover'));
  uploadZone.addEventListener('dragover', () => uploadZone.classList.add('dragover'));
  uploadZone.addEventListener('dragleave', () => uploadZone.classList.remove('dragover'));
  uploadZone.addEventListener('drop', (e) => {
    uploadZone.classList.remove('dragover');
    if(e.dataTransfer.files.length > 0) handleFile(e.dataTransfer.files[0]);
  });

  imageInput.addEventListener('change', (e) => {
    if(e.target.files.length > 0) handleFile(e.target.files[0]);
  });

  // --- Progress Bar Helpers ---
  function setProgressStage(stageNum, label, detail, percent) {
    if (progressStage) progressStage.textContent = label;
    if (progressDetail) progressDetail.textContent = detail;
    if (progressBarFill) progressBarFill.style.width = percent + '%';

    // Update dots and lines
    for (let i = 1; i <= 4; i++) {
      const dot = document.getElementById('dot' + i);
      if (!dot) continue;
      dot.classList.remove('active', 'done');
      if (i < stageNum) dot.classList.add('done');
      else if (i === stageNum) dot.classList.add('active');
    }
    for (let i = 1; i <= 3; i++) {
      const line = document.getElementById('line' + i);
      if (!line) continue;
      line.classList.remove('done');
      if (i < stageNum) line.classList.add('done');
    }
  }

  function handleFile(file) {
    if (!file.type.startsWith('image/')) {
      alert("Lütfen geçerli bir fotoğraf (jpg, png, webp) yükleyin!");
      return;
    }

    if (typeof window.imglyRemoveBackground === 'undefined') {
      alert("Yapay Zeka kütüphanesi henüz yükleniyor. Lütfen birkaç saniye bekleyip tekrar deneyin.");
      return;
    }

    emptyState.style.display = 'none';
    resultPreview.style.display = 'none';
    loadingStatus.style.display = 'block';

    // Reset progress
    setProgressStage(1, '🧠 Yapay Zeka Hazırlanıyor...', 'Model dosyaları okunuyor...', 5);

    const reader = new FileReader();
    reader.onload = (e) => {
      sourceImage.src = e.target.result;
      originalPreview.style.display = 'block';
    };
    reader.readAsDataURL(file);

    processBackgroundRemoval(file);
  }

  async function processBackgroundRemoval(file) {
    try {
      const config = {
        publicPath: "https://staticimgly.com/@imgly/background-removal-data/1.4.3/dist/",
        model: "small", // 'medium' ~40MB, 'small' ~10MB — çok daha hızlı yüklenir
        progress: (key, current, total) => {
          if (key.startsWith('fetch:')) {
            const fileName = key.replace('fetch:','').split('/').pop();
            if (total > 0) {
              const mb = (current / (1024*1024)).toFixed(1);
              const totalMb = (total / (1024*1024)).toFixed(1);
              const pct = Math.round((current / total) * 50) + 5;
              setProgressStage(1, '📦 Model İndiriliyor...', `${fileName} — ${mb}MB / ${totalMb}MB`, Math.min(pct, 55));
            } else {
              setProgressStage(1, '📦 Model İndiriliyor...', `${fileName} yükleniyor...`, 15);
            }
          } else if (key === 'compute:inference') {
            const pct = total > 0 ? Math.round((current / total) * 30) + 60 : 70;
            setProgressStage(3, '🔬 Yapay Zeka Analiz Ediyor...', 'Nöral ağ pikselleri sınıflandırıyor...', Math.min(pct, 90));
          } else {
            setProgressStage(2, '🖼️ Piksel Taraması...', `${key} işleniyor...`, 55);
          }
        }
      };
      
      const blob = await window.imglyRemoveBackground(file, config);

      // Stage 4: Tamamlandı
      setProgressStage(4, '✅ Tamamlandı!', 'Arka plan başarıyla silindi!', 100);

      // Blob'u sakla (indirme için)
      currentBlob = blob;
      if(currentBlobUrl) URL.revokeObjectURL(currentBlobUrl);
      currentBlobUrl = URL.createObjectURL(blob);
      
      outputImage.src = currentBlobUrl;
      
      // Kısa bir gecikmeyle sonucu göster
      setTimeout(() => {
        loadingStatus.style.display = 'none';
        resultPreview.style.display = 'block';

        if(typeof gsap !== 'undefined') {
          gsap.fromTo(outputImage, {scale: 0.8, opacity: 0}, {scale: 1, opacity: 1, duration: 0.8, ease: 'back.out(1.5)'});
        }
      }, 600);

    } catch (err) {
      console.error(err);
      setProgressStage(1, '❌ Bir Hata Oluştu', err.message, 0);
      progressBarFill.style.background = '#ff4d4d';
    }
  }

  // --- DOWNLOAD FIX ---
  downloadBtn.addEventListener('click', () => {
    if (!currentBlob && !currentBlobUrl) return;

    // Yöntem 1: Blob'dan doğrudan indirme (en güvenilir)
    const downloadBlob = currentBlob || null;
    
    if (downloadBlob) {
      // Blob varsa doğrudan indir
      const url = URL.createObjectURL(downloadBlob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'arkaplan-silinmis.png';
      a.style.display = 'none';
      document.body.appendChild(a);
      a.click();
      
      // Temizlik
      setTimeout(() => {
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      }, 500);
    } else {
      // Fallback: Canvas üzerinden indirme
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      canvas.width = outputImage.naturalWidth;
      canvas.height = outputImage.naturalHeight;
      ctx.drawImage(outputImage, 0, 0);
      
      canvas.toBlob((canvasBlob) => {
        const url = URL.createObjectURL(canvasBlob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'arkaplan-silinmis.png';
        a.style.display = 'none';
        document.body.appendChild(a);
        a.click();
        setTimeout(() => {
          document.body.removeChild(a);
          URL.revokeObjectURL(url);
        }, 500);
      }, 'image/png');
    }
  });
});
