// UMD bundle automatically provides imglyRemoveBackground as a global variable.

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

  let currentBlobUrl = null;

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

  function handleFile(file) {
    if (!file.type.startsWith('image/')) {
      alert("Lütfen geçerli bir fotoğraf (jpg, png, webp) yükleyin!");
      return;
    }

    // Arayüzü işlemin başlangıcına hazırla
    emptyState.style.display = 'none';
    resultPreview.style.display = 'none';
    loadingStatus.style.display = 'block';

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
      // Optimizasyonlar: Çıktı boyutu otomatik algılanır, çok ağır fotoları hızla işler.
      const config = {
        publicPath: "https://unpkg.com/@imgly/background-removal@1.4.3/dist/",
        progress: (key, current, total) => {
          // Gerekirse ilerleme eklenebilir, şimdilik sadece yükleniyor mesajı.
          loadingStatus.innerHTML = `
            <div class="spinner" style="font-size: 16px; margin-bottom:8px;">✨</div>
            Algoritma İşliyor: Pikseller Okunuyor...<br>
            <small>(İlk seferde Wasm dosyası indirildiği için biraz sürebilir)</small>
          `;
        }
      };
      
      const blob = await imglyRemoveBackground(file, config);

      // Temizleme başarıyla bitti!
      if(currentBlobUrl) URL.revokeObjectURL(currentBlobUrl);
      currentBlobUrl = URL.createObjectURL(blob);
      
      outputImage.src = currentBlobUrl;
      
      loadingStatus.style.display = 'none';
      resultPreview.style.display = 'block';

      // Yaylanma efekti
      if(typeof gsap !== 'undefined') {
        gsap.fromTo(outputImage, {scale: 0.8, opacity: 0}, {scale: 1, opacity: 1, duration: 0.8, ease: 'back.out(1.5)'});
      }

    } catch (err) {
      console.error(err);
      loadingStatus.innerHTML = `
        <span style="color:var(--text-primary)">❌ Bir Hata Oluştu:</span><br>
        <small>${err.message}</small>
      `;
    }
  }

  downloadBtn.addEventListener('click', () => {
    if(!currentBlobUrl) return;
    const a = document.createElement('a');
    a.href = currentBlobUrl;
    a.download = 'arkaplan-silinmis.png'; // Her zaman png çıkar!
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  });
});
