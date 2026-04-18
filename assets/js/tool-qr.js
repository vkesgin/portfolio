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
  let qrCodeInstance = null;

  function generateQR() {
    const text = qrInput.value.trim();
    
    if (text.length === 0) {
      qrcodeDiv.innerHTML = '';
      emptyState.style.display = 'block';
      downloadBtn.style.display = 'none';
      qrCodeInstance = null;
      return;
    }

    // İlk defa oluşturuyorsak
    if (!qrCodeInstance) {
      emptyState.style.display = 'none';
      downloadBtn.style.display = 'flex';
      qrCodeInstance = new QRCode(qrcodeDiv, {
        text: text,
        width: 256,
        height: 256,
        colorDark : "#000000",
        colorLight : "#ffffff",
        correctLevel : QRCode.CorrectLevel.H
      });
    } else {
      // Zaten varsa sadece içeriği güncelle
      qrCodeInstance.clear();
      qrCodeInstance.makeCode(text);
    }
  }

  // Kullanıcı her harf girdiğinde otomatik güncelle
  qrInput.addEventListener('input', generateQR);

  // İndirme Butonu İşlevi
  downloadBtn.addEventListener('click', () => {
    // QRCode.js div içerisine önce canvas sonra da eğer destekliyorsa image atar.
    // Biz image'ı bularak indirebiliriz (veya canvası).
    const qrImage = qrcodeDiv.querySelector('img');
    const qrCanvas = qrcodeDiv.querySelector('canvas');
    
    let imageSrc = '';
    
    if (qrImage && qrImage.src) {
        imageSrc = qrImage.src;
    } else if (qrCanvas) {
        imageSrc = qrCanvas.toDataURL("image/png");
    }

    if (imageSrc) {
      const link = document.createElement('a');
      link.href = imageSrc;
      link.download = 'karekod-ozel.png';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    }
  });
});
