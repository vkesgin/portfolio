document.addEventListener('DOMContentLoaded', () => {
  const uploadZone = document.getElementById('converterUploadZone');
  const fileInput = document.getElementById('converterInput');
  const fileInfo = document.getElementById('fileInfo');
  const fileName = document.getElementById('fileName');
  const fileSize = document.getElementById('fileSize');
  const fileFormat = document.getElementById('fileFormat');

  const targetFormat = document.getElementById('targetFormat');
  const qualitySlider = document.getElementById('qualitySlider');
  const qualityValue = document.getElementById('qualityValue');
  const qualityGroup = document.getElementById('qualityGroup');

  const converterEmpty = document.getElementById('converterEmpty');
  const converterResult = document.getElementById('converterResult');
  const sizeBefore = document.getElementById('sizeBefore');
  const sizeAfter = document.getElementById('sizeAfter');
  const savingsBanner = document.getElementById('savingsBanner');
  const convertedPreview = document.getElementById('convertedPreview');
  const downloadBtn = document.getElementById('downloadConverted');

  let currentFile = null;
  let convertedBlob = null;

  // GSAP Animations
  if (typeof gsap !== 'undefined') {
    gsap.from('#tool-hero', { y: 30, opacity: 0, duration: 1, ease: 'power3.out' });
    gsap.from('.tool-card', { y: 40, opacity: 0, duration: 1, delay: 0.3, ease: 'power3.out' });
  }

  // --- Sürükle Bırak ---
  ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(ev => {
    uploadZone.addEventListener(ev, e => { e.preventDefault(); e.stopPropagation(); }, false);
  });
  uploadZone.addEventListener('dragenter', () => uploadZone.classList.add('dragover'));
  uploadZone.addEventListener('dragover', () => uploadZone.classList.add('dragover'));
  uploadZone.addEventListener('dragleave', () => uploadZone.classList.remove('dragover'));
  uploadZone.addEventListener('drop', e => {
    uploadZone.classList.remove('dragover');
    if (e.dataTransfer.files.length > 0) loadFile(e.dataTransfer.files[0]);
  });

  fileInput.addEventListener('change', e => {
    if (e.target.files.length > 0) loadFile(e.target.files[0]);
  });

  // Format & kalite değişikliğinde otomatik yeniden dönüştür
  targetFormat.addEventListener('change', () => {
    updateQualityVisibility();
    if (currentFile) convertImage();
  });
  qualitySlider.addEventListener('input', () => {
    qualityValue.textContent = qualitySlider.value + '%';
    if (currentFile) convertImage();
  });

  function updateQualityVisibility() {
    // PNG kayıpsızdır, kalite parametresi yoktur
    const isPNG = targetFormat.value === 'image/png';
    qualityGroup.style.opacity = isPNG ? '0.4' : '1';
    qualitySlider.disabled = isPNG;
  }

  function formatBytes(bytes) {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  }

  function getExtension(mimeType) {
    const map = { 'image/webp': 'webp', 'image/png': 'png', 'image/jpeg': 'jpg' };
    return map[mimeType] || 'png';
  }

  function getFormatName(mimeType) {
    if (mimeType.includes('png')) return 'PNG';
    if (mimeType.includes('jpeg') || mimeType.includes('jpg')) return 'JPG';
    if (mimeType.includes('webp')) return 'WebP';
    if (mimeType.includes('gif')) return 'GIF';
    if (mimeType.includes('bmp')) return 'BMP';
    if (mimeType.includes('svg')) return 'SVG';
    return mimeType.split('/')[1]?.toUpperCase() || 'Bilinmiyor';
  }

  function loadFile(file) {
    if (!file.type.startsWith('image/')) {
      alert('Lütfen geçerli bir görsel dosyası seçin!');
      return;
    }

    currentFile = file;

    // Dosya bilgilerini göster
    fileName.textContent = file.name;
    fileSize.textContent = formatBytes(file.size);
    fileFormat.textContent = getFormatName(file.type);
    fileInfo.style.display = 'block';

    if (typeof gsap !== 'undefined') {
      gsap.fromTo(fileInfo, { y: 10, opacity: 0 }, { y: 0, opacity: 1, duration: 0.4 });
    }

    convertImage();
  }

  function convertImage() {
    if (!currentFile) return;

    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = img.naturalWidth;
        canvas.height = img.naturalHeight;
        const ctx = canvas.getContext('2d');

        // JPG formatı şeffaflığı desteklemez — beyaz zemin koy
        if (targetFormat.value === 'image/jpeg') {
          ctx.fillStyle = '#FFFFFF';
          ctx.fillRect(0, 0, canvas.width, canvas.height);
        }

        ctx.drawImage(img, 0, 0);

        const quality = parseInt(qualitySlider.value) / 100;
        const mime = targetFormat.value;

        canvas.toBlob((blob) => {
          if (!blob) {
            alert('Dönüştürme başarısız! Bu format tarayıcınız tarafından desteklenmiyor olabilir.');
            return;
          }

          convertedBlob = blob;

          // Önizleme
          const url = URL.createObjectURL(blob);
          convertedPreview.src = url;

          // Boyut karşılaştırması
          const before = currentFile.size;
          const after = blob.size;
          sizeBefore.textContent = formatBytes(before);
          sizeAfter.textContent = formatBytes(after);

          const diff = ((before - after) / before * 100).toFixed(1);
          if (after < before) {
            savingsBanner.textContent = `🎉 %${diff} küçüldü! (${formatBytes(before - after)} tasarruf)`;
            savingsBanner.style.color = 'var(--accent)';
            savingsBanner.style.borderColor = 'rgba(0,229,255,0.3)';
            savingsBanner.style.background = 'rgba(0,229,255,0.1)';
          } else if (after > before) {
            const increase = ((after - before) / before * 100).toFixed(1);
            savingsBanner.textContent = `⚠️ %${increase} büyüdü — farklı bir format deneyin.`;
            savingsBanner.style.color = '#ffaa00';
            savingsBanner.style.borderColor = 'rgba(255,170,0,0.3)';
            savingsBanner.style.background = 'rgba(255,170,0,0.1)';
          } else {
            savingsBanner.textContent = 'Boyut değişmedi.';
            savingsBanner.style.color = 'var(--text-muted)';
          }

          // Göster
          converterEmpty.style.display = 'none';
          converterResult.style.display = 'block';

          if (typeof gsap !== 'undefined') {
            gsap.fromTo(converterResult, { y: 20, opacity: 0 }, { y: 0, opacity: 1, duration: 0.5 });
          }

        }, mime, quality);
      };
      img.src = e.target.result;
    };
    reader.readAsDataURL(currentFile);
  }

  // --- İndirme ---
  downloadBtn.addEventListener('click', () => {
    if (!convertedBlob) return;

    const ext = getExtension(targetFormat.value);
    const originalName = currentFile.name.replace(/\.[^/.]+$/, '');
    const url = URL.createObjectURL(convertedBlob);

    const a = document.createElement('a');
    a.href = url;
    a.download = `${originalName}-converted.${ext}`;
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();

    setTimeout(() => {
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }, 500);
  });

  // İlk yükleme
  updateQualityVisibility();
});
