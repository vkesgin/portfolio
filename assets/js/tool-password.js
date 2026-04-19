document.addEventListener('DOMContentLoaded', () => {
  const lengthSlider = document.getElementById('lengthSlider');
  const lengthValue = document.getElementById('lengthValue');
  
  const chkUpper = document.getElementById('chkUpper');
  const chkLower = document.getElementById('chkLower');
  const chkNumbers = document.getElementById('chkNumbers');
  const chkSymbols = document.getElementById('chkSymbols');
  
  const passwordOutput = document.getElementById('passwordOutput');
  const strengthBadge = document.getElementById('strengthBadge');
  const copyBtn = document.getElementById('copyBtn');
  const copyToast = document.getElementById('copyToast');

  // GSAP Animations
  if (typeof gsap !== 'undefined') {
    gsap.from('#tool-hero', { y: 30, opacity: 0, duration: 1, ease: 'power3.out' });
    gsap.from('.tool-card', { y: 40, opacity: 0, duration: 1, delay: 0.3, ease: 'power3.out' });
  }

  const UPPER = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  const LOWER = "abcdefghijklmnopqrstuvwxyz";
  const NUMBERS = "0123456789";
  const SYMBOLS = "!@#$%^&*()_+~`|}{[]:;?><,./-=";

  // Olay Dinleyiciler
  [lengthSlider, chkUpper, chkLower, chkNumbers, chkSymbols].forEach(element => {
    element.addEventListener('input', generatePassword);
  });

  lengthSlider.addEventListener('input', () => {
    lengthValue.innerText = lengthSlider.value;
  });

  copyBtn.addEventListener('click', () => {
    if(!passwordOutput.innerText) return;
    navigator.clipboard.writeText(passwordOutput.innerText).then(() => {
      showToast();
    });
  });

  // Crypto destekli Rastgele sayı üreteci
  function getSecureRandomInt(max) {
    if (window.crypto && window.crypto.getRandomValues) {
      const array = new Uint32Array(1);
      window.crypto.getRandomValues(array);
      return array[0] % max;
    }
    // Safari/Eski Tarayıcı Fallback
    return Math.floor(Math.random() * max);
  }

  function generatePassword() {
    let length = parseInt(lengthSlider.value);
    let charset = "";
    
    if (chkUpper.checked) charset += UPPER;
    if (chkLower.checked) charset += LOWER;
    if (chkNumbers.checked) charset += NUMBERS;
    if (chkSymbols.checked) charset += SYMBOLS;

    if (charset === "") {
      passwordOutput.innerText = "Lütfen Kurallardan Seçin..";
      strengthBadge.innerText = "Hata";
      strengthBadge.style.color = "#ff4d4d";
      return;
    }

    let password = "";
    for (let i = 0; i < length; i++) {
        password += charset[getSecureRandomInt(charset.length)];
    }

    passwordOutput.innerText = password;

    // Şifre gücü hesaplayıcısı (Basit mantık)
    let strength = 0;
    if (length >= 12) strength += 1;
    if (length >= 16) strength += 1;
    if (chkUpper.checked && chkLower.checked) strength += 1;
    if (chkNumbers.checked) strength += 1;
    if (chkSymbols.checked) strength += 1;

    if (strength <= 2) {
      strengthBadge.innerText = "Zayıf";
      strengthBadge.style.color = "#ff4d4d"; // Red
    } else if (strength === 3 || strength === 4) {
      strengthBadge.innerText = "Baya İyi";
      strengthBadge.style.color = "#ffaa00"; // Orange
    } else {
      strengthBadge.innerText = "Kırılamaz!";
      strengthBadge.style.color = "#00e5ff"; // Accent Neon
    }
    
    // Küçük hover / değişim animasyonu
    if(typeof gsap !== 'undefined') {
      gsap.fromTo(passwordOutput, {opacity: 0.5}, {opacity: 1, duration: 0.3});
    }
  }

  let toastTimer;
  function showToast() {
    copyToast.style.display = 'block';
    
    clearTimeout(toastTimer);
    copyToast.style.opacity = '1';
    
    toastTimer = setTimeout(() => {
      copyToast.style.opacity = '0';
      setTimeout(() => copyToast.style.display = 'none', 300);
    }, 2000);
  }

  // İlk yüklemede çalıştır
  generatePassword();
});
