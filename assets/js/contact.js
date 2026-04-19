// ============================================================
// EmailJS ayarları — kendi değerlerinle değiştir
// emailjs.com → Account → Public Key
const EMAILJS_PUBLIC_KEY  = 'ZCzUKlv3tX5NekKgR';
// emailjs.com → Email Services → Service ID
const EMAILJS_SERVICE_ID  = 'service_btaba6d';
// emailjs.com → Email Templates → Template ID
const EMAILJS_TEMPLATE_ID = 'template_0iyedpa';
// ============================================================

// EmailJS init
if (typeof emailjs !== 'undefined') {
    emailjs.init(EMAILJS_PUBLIC_KEY);
  }

  // GSAP animasyonlar
  if (typeof gsap !== 'undefined') {
    gsap.registerPlugin(ScrollTrigger);

    gsap.timeline({ defaults: { ease: 'power4.out' }, delay: .2 })
      .to('.ct-eyebrow',   { opacity: 1, duration: .6 })
      .to('.ct-line',      { opacity: 1, y: 0, duration: 1.1, stagger: .12 }, '-=.4')
      .to('.ct-hero-sub',  { opacity: 1, y: 0, duration: .7 }, '-=.5');

    gsap.to('.contact-info', {
      opacity: 1, x: 0, duration: .8,
      ease: 'power3.out',
      scrollTrigger: { trigger: '#contact-body', start: 'top 78%' }
    });

    gsap.to('.contact-form-wrap', {
      opacity: 1, x: 0, duration: .8, delay: .1,
      ease: 'power3.out',
      scrollTrigger: { trigger: '#contact-body', start: 'top 78%' }
    });
  }

  // Karakter sayacı
  const textarea  = document.getElementById('message');
  const charCount = document.getElementById('charCount');
  if (textarea && charCount) {
    textarea.addEventListener('input', () => {
      const len = textarea.value.length;
      charCount.textContent = `${len} / 1000`;
      if (len > 900) charCount.style.color = 'var(--danger)';
      else charCount.style.color = 'var(--text-muted)';
      if (len > 1000) textarea.value = textarea.value.slice(0, 1000);
    });
  }

  // Form validasyon
  function validateField(id, check) {
    const field = document.getElementById('field-' + id);
    const el    = document.getElementById(id);
    if (!field || !el) return true;
    const valid = check(el.value);
    field.classList.toggle('has-error', !valid);
    return valid;
  }

  function validateAll() {
    const n = validateField('name',    v => v.trim().length >= 2);
    const e = validateField('email',   v => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v));
    const s = validateField('subject', v => v !== '');
    const m = validateField('message', v => v.trim().length >= 20);
    return n && e && s && m;
  }

  // Live validation — Anlık geribildirim
  ['name','email','subject','message'].forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;

    const validate = () => {
      if (id === 'name')    validateField(id, v => v.trim().length >= 2);
      if (id === 'email')   validateField(id, v => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v));
      if (id === 'subject') validateField(id, v => v !== '');
      if (id === 'message') validateField(id, v => v.trim().length >= 20);
    };

    el.addEventListener('blur', validate);
    el.addEventListener('input', () => {
      // Eğer kullanıcı daha önce hata almışsa, yazarken anlık olarak kontrol et
      const field = document.getElementById('field-' + id);
      if (field && field.classList.contains('has-error')) {
        validate();
      }
    });
  });

  // Form submit
  const form      = document.getElementById('contactForm');
  const submitBtn = document.getElementById('submitBtn');
  const success   = document.getElementById('ctSuccess');
  const errorMsg  = document.getElementById('ctErrorMsg');

  if (!form) return;

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!validateAll()) return;

    submitBtn.classList.add('loading');
    submitBtn.disabled = true;
    errorMsg.classList.remove('show');

    const params = {
      from_name:  document.getElementById('name').value.trim(),
      from_email: document.getElementById('email').value.trim(),
      subject:    document.getElementById('subject').value,
      message:    document.getElementById('message').value.trim(),
    };

    try {
      if (typeof emailjs === 'undefined') throw new Error('EmailJS not loaded');
      await emailjs.send(EMAILJS_SERVICE_ID, EMAILJS_TEMPLATE_ID, params);
      form.style.display    = 'none';
      success.classList.add('show');
      if (typeof gsap !== 'undefined') {
        gsap.from('.ct-success-icon', { scale: 0, duration: .5, ease: 'back.out(1.7)' });
        gsap.from('.ct-success-title, .ct-success-sub, .ct-success .btn', {
          opacity: 0, y: 16, duration: .5, stagger: .1, delay: .2
        });
      }
    } catch (err) {
      console.error('EmailJS error:', err);
      errorMsg.classList.add('show');
      submitBtn.classList.remove('loading');
      submitBtn.disabled = false;
    }
  });

window.resetForm = function() {
  const form    = document.getElementById('contactForm');
  const success = document.getElementById('ctSuccess');
  const errMsg  = document.getElementById('ctErrorMsg');
  if (form)    { form.reset(); form.style.display = ''; }
  if (success) success.classList.remove('show');
  if (errMsg)  errMsg.classList.remove('show');
  document.getElementById('charCount').textContent = '0 / 1000';
};
