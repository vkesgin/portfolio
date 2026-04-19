document.addEventListener('DOMContentLoaded', () => {
  const qrInput = document.getElementById('qrInput');
  const qrcodeDiv = document.getElementById('qrcode');
  const emptyState = document.getElementById('emptyState');
  const downloadBtn = document.getElementById('downloadBtn');

  // GSAP Animasyonları
  if (typeof gsap !== 'undefined') {
    gsap.from('#tool-hero', { y: 30, opacity: 0, duration: 1, ease: 'power3.out' });
    gsap.from('.tool-card', { y: 40, opacity: 0, duration: 1, delay: 0.3, ease: 'power3.out' });
  }

  // QR Kodu Tutucu
  const formatSelect = document.getElementById('formatSelect');

  function generateQR() {
    const text = qrInput.value.trim();
    const format = formatSelect ? formatSelect.value : 'jpg';
    const bgCol = format === 'png' ? 'transparent' : '#ffffff';
    
    if (text.length === 0) {
      qrcodeDiv.innerHTML = '';
      emptyState.style.display = 'block';
      downloadBtn.style.display = 'none';
      document.getElementById('downloadOptions').style.display = 'none';
      return;
    }

    // Seçime göre arka plan rengini değiştirmek için mecburen divi temizleyip yeniden basıyoruz
    qrcodeDiv.innerHTML = '';
    emptyState.style.display = 'none';
    downloadBtn.style.display = 'flex';
    document.getElementById('downloadOptions').style.display = 'flex';
    
    new QRCode(qrcodeDiv, {
      text: text,
      width: 512, // indirmede yüksek çözünürlük için büyük çizdiriyor, CSS ile küçük gösteriyoruz
      height: 512,
      colorDark : "#000000",
      colorLight : bgCol,
      correctLevel : QRCode.CorrectLevel.H
    });
  }

  // Kullanıcı her harf girdiğinde veya format değiştirdiğinde otomatik güncelle
  qrInput.addEventListener('input', generateQR);
  if (formatSelect) {
    formatSelect.addEventListener('change', generateQR);
  }

  // İndirme Butonu İşlevi
  downloadBtn.addEventListener('click', () => {
    const qrCanvas = qrcodeDiv.querySelector('canvas');
    if (!qrCanvas) return;
    
    const format = formatSelect ? formatSelect.value : 'jpg';
    let imageSrc = '';
    
    if (format === 'png') {
       // Saydam destekler (transparent arka planla üretildiği için saydam kalır)
       imageSrc = qrCanvas.toDataURL("image/png");
    } else {
       // Beyaz arka planla üretildiği için güvenle JPG çıkarabiliriz
       imageSrc = qrCanvas.toDataURL("image/jpeg", 1.0);
    }

    if (imageSrc) {
      const link = document.createElement('a');
      link.href = imageSrc;
      link.download = `karekod.${format}`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    }
  });
});
