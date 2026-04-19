document.addEventListener('DOMContentLoaded', () => {
  const uploadZone = document.getElementById('uploadZone');
  const imageInput = document.getElementById('imageInput');
  const qualitySlider = document.getElementById('qualitySlider');
  const qualityVal = document.getElementById('qualityVal');
  const settingsPanel = document.getElementById('settingsPanel');
  
  const emptyState = document.getElementById('emptyState');
  const imagePreview = document.getElementById('imagePreview');
  const statsPanel = document.getElementById('statsPanel');
  const downloadBtn = document.getElementById('downloadBtn');
  const offscreenCanvas = document.getElementById('offscreenCanvas');
  const ctx = offscreenCanvas.getContext('2d');

  const origSizeStr = document.getElementById('origSizeStr');
  const newSizeStr = document.getElementById('newSizeStr');
  const gainBanner = document.getElementById('gainBanner');

  if (typeof gsap !== 'undefined') {
    gsap.from('#tool-hero', { y: 30, opacity: 0, duration: 1, ease: 'power3.out' });
    gsap.from('.tool-card', { y: 40, opacity: 0, duration: 1, delay: 0.3, ease: 'power3.out' });
  }

  let originalImage = null;
  let originalFile = null;
  let compressedDataUrl = null;

  // Sürükle bırak efektleri
  ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
    uploadZone.addEventListener(eventName, preventDefaults, false);
  });
  function preventDefaults(e) { e.preventDefault(); e.stopPropagation(); }

  uploadZone.addEventListener('dragenter', () => uploadZone.classList.add('dragover'));
  uploadZone.addEventListener('dragover', () => uploadZone.classList.add('dragover'));
  uploadZone.addEventListener('dragleave', () => uploadZone.classList.remove('dragover'));
  uploadZone.addEventListener('drop', handleDrop);

  function handleDrop(e) {
    uploadZone.classList.remove('dragover');
    let dt = e.dataTransfer;
    let files = dt.files;
    if(files.length > 0) handleFile(files[0]);
  }

  imageInput.addEventListener('change', (e) => {
    if(e.target.files.length > 0) handleFile(e.target.files[0]);
  });

  function handleFile(file) {
    if (!file.type.startsWith('image/')) {
      alert('Lütfen sadece görsel (PNG, JPG, vb.) yükleyin.');
      return;
    }
    
    originalFile = file;

    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        originalImage = img;
        emptyState.style.display = 'none';
        imagePreview.style.display = 'block';
        settingsPanel.style.display = 'block';
        statsPanel.style.display = 'block';
        downloadBtn.style.display = 'flex';
        
        // Canvas Setup (Orjinal Boyutunda render alıcaz)
        offscreenCanvas.width = img.width;
        offscreenCanvas.height = img.height;
        
        processImage();
      };
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  }

  // Kalite değişince tekrar renderla
  qualitySlider.addEventListener('input', (e) => {
    let q = parseFloat(e.target.value);
    qualityVal.innerText = Math.round(q * 100) + '%';
    processImage();
  });

  function processImage() {
    if(!originalImage) return;

    // Fotoğrafı orjinal boyutunda tekrar canvas'a çiz.
    // Ancak arkası şeffaf PNG'ler JPEG yapıldığında siyah kalmasın diye önce bembeyaz boyayalım
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, offscreenCanvas.width, offscreenCanvas.height);
    ctx.drawImage(originalImage, 0, 0, offscreenCanvas.width, offscreenCanvas.height);

    // Her zaman JPEG çıkartarak harika sıkıştırma sağlıyoruz
    const quality = parseFloat(qualitySlider.value);
    compressedDataUrl = offscreenCanvas.toDataURL('image/jpeg', quality);

    // Önizleme görselini güncelle
    imagePreview.src = compressedDataUrl;

    // Yeni dosya boyutu ölçümü (DataURL base64 formül hesabı: approx (length - 22) * 3/4)
    // base64 başlığını regex ile keselim: data:image/jpeg;base64,
    const base64str = compressedDataUrl.split(',')[1];
    const newSizeBytes = Math.floor((base64str.length * 3) / 4);

    updateStats(originalFile.size, newSizeBytes);
  }

  function updateStats(origBytes, newBytes) {
    origSizeStr.innerText = formatBytes(origBytes);
    newSizeStr.innerText = formatBytes(newBytes);

    let diff = origBytes - newBytes;
    if (diff < 0) diff = 0; // if it got bigger somehow
    
    let percent = Math.round((diff / origBytes) * 100);
    
    if(percent > 0) {
      gainBanner.style.background = 'rgba(0,229,255,0.1)';
      gainBanner.style.border = '1px solid rgba(0,229,255,0.3)';
      gainBanner.style.color = 'var(--accent)';
      gainBanner.innerText = `Tasrruf: %${percent} Mükemmel! (↓${formatBytes(diff)})`;
    } else {
      gainBanner.style.background = 'rgba(255,255,255,0.05)';
      gainBanner.style.border = '1px solid rgba(255,255,255,0.1)';
      gainBanner.style.color = 'var(--text-muted)';
      gainBanner.innerText = `Sıkışma Yok`;
    }
  }

  function formatBytes(bytes, decimals = 2) {
      if (!+bytes) return '0 Bytes';
      const k = 1024;
      const dm = decimals < 0 ? 0 : decimals;
      const sizes = ['Bytes', 'KB', 'MB', 'GB'];
      const i = Math.floor(Math.log(bytes) / Math.log(k));
      return `${parseFloat((bytes / Math.pow(k, i)).toFixed(dm))} ${sizes[i]}`;
  }

  downloadBtn.addEventListener('click', () => {
    if(!compressedDataUrl) return;
    const link = document.createElement('a');
    link.href = compressedDataUrl;
    link.download = `kucultulmus-gorsel.jpg`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  });
});
