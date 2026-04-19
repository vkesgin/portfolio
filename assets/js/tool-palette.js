document.addEventListener('DOMContentLoaded', () => {
  const uploadZone = document.getElementById('uploadZone');
  const imageInput = document.getElementById('imageInput');
  const imagePreview = document.getElementById('imagePreview');
  const previewContainer = document.getElementById('previewContainer');
  
  const emptyState = document.getElementById('emptyState');
  const paletteGrid = document.getElementById('paletteGrid');
  const copyToast = document.getElementById('copyToast');

  if (typeof gsap !== 'undefined') {
    gsap.from('#tool-hero', { y: 30, opacity: 0, duration: 1, ease: 'power3.out' });
    gsap.from('.tool-card', { y: 40, opacity: 0, duration: 1, delay: 0.3, ease: 'power3.out' });
  }

  // Sürükle bırak algılayıcıları
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
      alert('Lütfen sadece görsel yükleyin.');
      return;
    }

    const reader = new FileReader();
    reader.onload = (e) => {
      // Resmi önizlemeye koy, yüklenmesini bekle
      imagePreview.onload = () => {
        previewContainer.style.display = 'block';
        emptyState.style.display = 'none';
        
        extractColors(imagePreview);
      };
      // ColorThief'in çalışabilmesi için crossOrigin'i kapatmıyoruz çünkü yerel dataURL
      imagePreview.src = e.target.result;
    };
    reader.readAsDataURL(file);
  }

  function extractColors(imgElement) {
    const colorThief = new ColorThief();
    
    let palette;
    try {
      palette = colorThief.getPalette(imgElement, 5); // 5 numara getirecek
      // Eğer getPalette yeterli renk bulamazsa ya da resim hata verirse fallback yaparız
    } catch(err) {
      console.warn("Renk çıkarılamadı:", err);
      // Çok ufak ya da tek renkli bir formsa getColor kullanabiliriz
      palette = [colorThief.getColor(imgElement)];
    }

    renderPalette(palette);
  }

  function renderPalette(colorsArray) {
    paletteGrid.innerHTML = '';
    paletteGrid.style.display = 'grid';

    colorsArray.forEach((rgbArr, index) => {
      const hex = rgbToHex(rgbArr[0], rgbArr[1], rgbArr[2]);
      
      const swatch = document.createElement('div');
      swatch.className = 'color-swatch';
      swatch.style.backgroundColor = hex;
      
      const label = document.createElement('span');
      label.className = 'color-swatch-hex';
      label.innerText = hex.toUpperCase();
      
      // Işık düzeyini ölçerek renk etiketini beyaz veya koyu gri yapalım (kontrast için)
      const brightness = Math.round(((parseInt(rgbArr[0]) * 299) +
                                     (parseInt(rgbArr[1]) * 587) +
                                     (parseInt(rgbArr[2]) * 114)) / 1000);
      if (brightness > 125) {
        label.style.color = 'rgba(0,0,0,0.8)';
      } else {
        label.style.color = '#ffffff';
      }

      swatch.appendChild(label);
      paletteGrid.appendChild(swatch);

      // Kutucuk animasyonu
      if(typeof gsap !== 'undefined') {
        gsap.fromTo(swatch, 
          { scale: 0.5, opacity: 0 },
          { scale: 1, opacity: 1, duration: 0.5, delay: index * 0.1, ease: 'back.out(1.5)' }
        );
      }

      // Tıklayıp kopyalama
      swatch.addEventListener('click', () => {
        navigator.clipboard.writeText(hex.toUpperCase()).then(() => {
          showToast(`Kopyalandı: ${hex.toUpperCase()}`);
        });
      });
    });
  }

  function rgbToHex(r, g, b) {
    return "#" + (1 << 24 | r << 16 | g << 8 | b).toString(16).slice(1);
  }

  let toastTimer;
  function showToast(msg) {
    copyToast.innerText = msg;
    copyToast.style.display = 'block';
    
    // reset animation
    clearTimeout(toastTimer);
    copyToast.style.opacity = '1';
    
    toastTimer = setTimeout(() => {
      copyToast.style.opacity = '0';
      setTimeout(() => copyToast.style.display = 'none', 300);
    }, 2000);
  }
});
