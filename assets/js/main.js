// === CANVAS PARTICLES ===
const canvas = document.getElementById('bgCanvas');
const ctx = canvas ? canvas.getContext('2d') : null;
let W, H, particles = [];
const mouse = { x: -9999, y: -9999 };

function resize() {
  if (!canvas) return;
  W = canvas.width = window.innerWidth;
  H = canvas.height = window.innerHeight;
}

class Particle {
  constructor() { this.init(); }
  init() {
    this.x = Math.random() * W;
    this.y = Math.random() * H;
    this.vx = (Math.random() - .5) * .35;
    this.vy = (Math.random() - .5) * .35;
    this.r = Math.random() * 1.2 + .4;
    this.a = Math.random() * .35 + .1;
  }
  update() {
    this.x += this.vx;
    this.y += this.vy;
    if (this.x < 0 || this.x > W) this.vx *= -1;
    if (this.y < 0 || this.y > H) this.vy *= -1;
  }
  draw() {
    ctx.beginPath();
    ctx.arc(this.x, this.y, this.r, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(0,229,255,${this.a})`;
    ctx.fill();
  }
}

function initParticles() {
  particles = [];
  const n = Math.min(90, Math.floor(W * H / 12000));
  for (let i = 0; i < n; i++) particles.push(new Particle());
}

function drawConnections() {
  const MAX = 125, MMOUSE = 170;
  for (let i = 0; i < particles.length; i++) {
    for (let j = i + 1; j < particles.length; j++) {
      const dx = particles[i].x - particles[j].x;
      const dy = particles[i].y - particles[j].y;
      const d = Math.hypot(dx, dy);
      if (d < MAX) {
        ctx.beginPath();
        ctx.moveTo(particles[i].x, particles[i].y);
        ctx.lineTo(particles[j].x, particles[j].y);
        ctx.strokeStyle = `rgba(0,229,255,${(1 - d / MAX) * .12})`;
        ctx.lineWidth = .5;
        ctx.stroke();
      }
    }
    const mdx = particles[i].x - mouse.x;
    const mdy = particles[i].y - mouse.y;
    const md = Math.hypot(mdx, mdy);
    if (md < MMOUSE) {
      ctx.beginPath();
      ctx.moveTo(particles[i].x, particles[i].y);
      ctx.lineTo(mouse.x, mouse.y);
      ctx.strokeStyle = `rgba(0,229,255,${(1 - md / MMOUSE) * .45})`;
      ctx.lineWidth = .8;
      ctx.stroke();
    }
  }
}

function loopCanvas() {
  if (!ctx) return;
  ctx.clearRect(0, 0, W, H);
  particles.forEach(p => { p.update(); p.draw(); });
  drawConnections();
  requestAnimationFrame(loopCanvas);
}

// === CURSOR ===
const cursorDot = document.getElementById('cursor');
const cursorRing = document.getElementById('cursor-ring');
let cx = 0, cy = 0, rx = 0, ry = 0;

document.addEventListener('mousemove', e => {
  mouse.x = e.clientX; mouse.y = e.clientY;
});

function loopCursor() {
  if (!cursorDot || !cursorRing) return;
  cx += (mouse.x - cx) * .15;
  cy += (mouse.y - cy) * .15;
  rx += (cx - rx) * .11;
  ry += (cy - ry) * .11;
  cursorDot.style.left = cx + 'px';
  cursorDot.style.top = cy + 'px';
  cursorRing.style.left = rx + 'px';
  cursorRing.style.top = ry + 'px';
  requestAnimationFrame(loopCursor);
}

document.querySelectorAll('a, button, .filter-btn, .work-card, .srv-item').forEach(el => {
  el.addEventListener('mouseenter', () => {
    if(cursorDot) cursorDot.classList.add('hover');
    if(cursorRing) cursorRing.classList.add('hover');
  });
  el.addEventListener('mouseleave', () => {
    if(cursorDot) cursorDot.classList.remove('hover');
    if(cursorRing) cursorRing.classList.remove('hover');
  });
});

// === TYPING ===
const roles = ['Web Designer', '3D Animatör', 'Videographer', 'Grafiker', 'Yazılımcı'];
let rIdx = 0, cIdx = 0, deleting = false;
const roleEl = document.getElementById('roleText');

function typeNext() {
  const word = roles[rIdx];
  if (deleting) {
    cIdx--;
    roleEl.textContent = word.slice(0, cIdx);
    if (cIdx === 0) {
      deleting = false;
      rIdx = (rIdx + 1) % roles.length;
      setTimeout(typeNext, 350);
      return;
    }
    setTimeout(typeNext, 45);
  } else {
    cIdx++;
    roleEl.textContent = word.slice(0, cIdx);
    if (cIdx === word.length) {
      deleting = true;
      setTimeout(typeNext, 2000);
      return;
    }
    setTimeout(typeNext, 85);
  }
}

// === GSAP ENTRANCE ===
function initGSAP() {
  const isHome = document.querySelector('#hero') !== null;

  if (isHome) {
    gsap.set('#nav', { y: -24 });
    gsap.set(['.hero-role', '.hero-desc', '.hero-cta'], { y: 22 });

    gsap.timeline({ defaults: { ease: 'power4.out' }, delay: .1 })
      .to('#nav', { opacity: 1, y: 0, duration: .9 })
      .to('.hero-label', { opacity: 1, duration: .7 }, '-=.5')
      .to('.line', { y: '0%', duration: 1.1, stagger: .13 }, '-=.5')
      .to('.hero-role', { opacity: 1, y: 0, duration: .7 }, '-=.5')
      .to('.hero-desc', { opacity: 1, y: 0, duration: .6 }, '-=.4')
      .to('.hero-cta', { opacity: 1, y: 0, duration: .6 }, '-=.4')
      .to('.hero-scroll', { opacity: 1, duration: .6 }, '-=.3');
  } else {
    // Other pages: just show nav
    gsap.to('#nav', { opacity: 1, y: 0, duration: 0.9, delay: 0.1, ease: 'power4.out' });
  }
}

// === INIT ===
window.addEventListener('resize', () => { resize(); initParticles(); });
if (canvas) {
  resize();
  initParticles();
  loopCanvas();
}
if (cursorDot && cursorRing) {
  loopCursor();
}
if (roleEl) {
  setTimeout(typeNext, 1600);
}
if (typeof gsap !== 'undefined') {
  initGSAP();
  initStats();
  initSkills();
  initWorks();
  initAbout();
  initToolsMarquee();
  initCta();
}
initNav();
initFooter();

// === STATS SCROLL ANIMATION ===
// === SKILLS SCROLL + 3D TILT ===
function initSkills() {
  if (typeof gsap === 'undefined' || typeof ScrollTrigger === 'undefined') return;

  // Stagger giriş
  gsap.to('.skill-card', {
    opacity: 1,
    y: 0,
    duration: 0.8,
    stagger: 0.08,
    ease: 'power4.out',
    scrollTrigger: {
      trigger: '#skills',
      start: 'top 75%',
    }
  });

  // 3D tilt
  document.querySelectorAll('.skill-card').forEach(card => {
    card.addEventListener('mousemove', e => {
      const rect = card.getBoundingClientRect();
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;
      const dx = (e.clientX - cx) / (rect.width / 2);
      const dy = (e.clientY - cy) / (rect.height / 2);
      const rotX = -dy * 7;
      const rotY = dx * 7;
      gsap.to(card, {
        rotateX: rotX, rotateY: rotY,
        scale: 1.02,
        duration: 0.4,
        ease: 'power2.out',
        overwrite: true
      });
    });
    card.addEventListener('mouseleave', () => {
      gsap.to(card, {
        rotateX: 0, rotateY: 0, scale: 1,
        duration: 0.6,
        ease: 'elastic.out(1, 0.5)',
        overwrite: true
      });
    });
  });
}

// === WORKS SCROLL + FILTER ===
function initWorks() {
  if (typeof gsap === 'undefined' || typeof ScrollTrigger === 'undefined') return;

  // Giriş animasyonu
  gsap.to('.work-card', {
    opacity: 1,
    duration: 0.7,
    stagger: { amount: 0.5, from: 'start' },
    ease: 'power3.out',
    scrollTrigger: {
      trigger: '#works',
      start: 'top 75%',
    }
  });

  // Filtre
  const filterBtns = document.querySelectorAll('.filter-btn');
  const cards = document.querySelectorAll('.work-card');
  const countLabel = document.querySelector('.works-count-label');

  filterBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      filterBtns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');

      const filter = btn.dataset.filter;
      let visible = 0;

      cards.forEach(card => {
        const match = filter === 'all' || card.dataset.cat === filter;
        if (match) {
          card.classList.remove('hidden');
          gsap.fromTo(card,
            { opacity: 0, y: 16 },
            { opacity: 1, y: 0, duration: 0.45, ease: 'power3.out', delay: visible * 0.06 }
          );
          visible++;
        } else {
          card.classList.add('hidden');
        }
      });

      if (countLabel) {
        countLabel.textContent = visible + ' iş gösteriliyor';
      }
    });
  });
}

// === ABOUT PREVIEW ===
function initAbout() {
  if (typeof gsap === 'undefined' || typeof ScrollTrigger === 'undefined') return;

  // Metin satırları — stagger
  gsap.to('.about-line', {
    opacity: 1,
    y: 0,
    duration: 0.8,
    stagger: 0.18,
    ease: 'power3.out',
    scrollTrigger: {
      trigger: '#about-preview',
      start: 'top 72%',
      onEnter: () => {
        document.querySelectorAll('.about-line').forEach(el => {
          el.classList.add('visible');
        });
      }
    }
  });

  // CTA butonu
  gsap.to('.about-cta', {
    opacity: 1,
    y: 0,
    duration: 0.7,
    ease: 'power3.out',
    scrollTrigger: {
      trigger: '.about-cta',
      start: 'top 85%',
    }
  });

  // Timeline itemlar
  gsap.to('.tl-item', {
    opacity: 1,
    x: 0,
    duration: 0.7,
    stagger: 0.12,
    ease: 'power3.out',
    scrollTrigger: {
      trigger: '.timeline',
      start: 'top 75%',
    }
  });

  // Timeline çizgisi büyüsün
  gsap.from('.tl-line', {
    scaleY: 0,
    transformOrigin: 'top center',
    duration: 0.8,
    stagger: 0.12,
    ease: 'power3.out',
    scrollTrigger: {
      trigger: '.timeline',
      start: 'top 75%',
    }
  });
}

// === STATS SCROLL ANIMATION ===
function initStats() {
  if (typeof gsap === 'undefined' || typeof ScrollTrigger === 'undefined') return;

  gsap.registerPlugin(ScrollTrigger);

  // Kartlar stagger ile gelsin
  gsap.to('.stat-item', {
    opacity: 1,
    y: 0,
    duration: 0.9,
    stagger: 0.15,
    ease: 'power4.out',
    scrollTrigger: {
      trigger: '#stats',
      start: 'top 75%',
    }
  });

  // CountUp
  document.querySelectorAll('.count').forEach(el => {
    const target = parseInt(el.dataset.target);
    ScrollTrigger.create({
      trigger: el,
      start: 'top 80%',
      once: true,
      onEnter: () => {
        const duration = target > 50 ? 2000 : 1400;
        const step = Math.max(1, Math.floor(target / 60));
        let current = 0;
        const interval = setInterval(() => {
          current = Math.min(current + step, target);
          el.textContent = current;
          if (current >= target) clearInterval(interval);
        }, duration / (target / step));
      }
    });
  });
}

// === CTA ===
function initCta() {
  if (typeof gsap === 'undefined' || typeof ScrollTrigger === 'undefined') return;

  const tl = gsap.timeline({
    scrollTrigger: {
      trigger: '#cta',
      start: 'top 72%',
    },
    defaults: { ease: 'power4.out' }
  });

  tl.to('.cta-eyebrow', { opacity: 1, y: 0, duration: .6 })
    .to('.cta-line', { opacity: 1, y: 0, duration: 1, stagger: .12 }, '-=.3')
    .to('.cta-sub', { opacity: 1, y: 0, duration: .7 }, '-=.5')
    .to('.cta-btns', { opacity: 1, y: 0, duration: .6 }, '-=.4')
    .to('.cta-socials', { opacity: 1, y: 0, duration: .6 }, '-=.4');

  // Glow mouse takibi
  const glow = document.querySelector('.cta-glow');
  const section = document.getElementById('cta');
  if (glow && section) {
    section.addEventListener('mousemove', e => {
      const rect = section.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      gsap.to(glow, {
        left: x, top: y,
        duration: 1.2,
        ease: 'power3.out'
      });
    });
  }
}

// === STICKY NAV ===
function initNav() {
  const nav = document.getElementById('nav');
  const hamburger = document.getElementById('hamburger');
  const menu = document.getElementById('mobileMenu');
  const sections = document.querySelectorAll('section[id]');
  const links = document.querySelectorAll('.nav-links a');
  let menuOpen = false;

  function updateActiveLinks() {
    const scrollY = window.scrollY;
    let current = '';

    // Scroll progress & sticky
    if (nav) {
      const docH = document.documentElement.scrollHeight - window.innerHeight;
      const progress = docH > 0 ? (scrollY / docH * 100).toFixed(1) : 0;
      nav.classList.toggle('scrolled', scrollY > 60);
      nav.style.setProperty('--scroll-progress', progress + '%');
    }

    // Determine current section by scroll position (for index page)
    sections.forEach(sec => {
      if (scrollY >= sec.offsetTop - 120) current = sec.getAttribute('id');
    });

    const currentPath = window.location.pathname;

    links.forEach(link => {
      const href = link.getAttribute('href');
      if (!href) return;

      // 1- Alt sayfalardaysak (örn: services.html)
      if (href !== '/' && href !== '/index.html' && !href.includes('#') && currentPath.includes(href)) {
        link.classList.add('active');
        return;
      }

      // 2- Ana sayfadaysak scroll id kontrolü
      if (currentPath === '/' || currentPath.endsWith('index.html')) {
        if (href.includes('#')) {
          const id = href.split('#')[1];
          link.classList.toggle('active', id === current);
        } else {
          link.classList.remove('active');
        }
      } else {
        // İlgili olmayan linklerin active classını temizle
        if (!currentPath.includes(href)) {
          link.classList.remove('active');
        }
      }
    });
  }

  // İlk yüklemede ve scroll'da update et
  updateActiveLinks();
  window.addEventListener('scroll', updateActiveLinks, { passive: true });

  // Hamburger
  hamburger.addEventListener('click', () => {
    menuOpen = !menuOpen;
    hamburger.classList.toggle('open', menuOpen);
    menu.classList.toggle('open', menuOpen);
    document.body.style.overflow = menuOpen ? 'hidden' : '';
  });
}

window.closeMenu = function () {
  const hamburger = document.getElementById('hamburger');
  const menu = document.getElementById('mobileMenu');
  hamburger.classList.remove('open');
  menu.classList.remove('open');
  document.body.style.overflow = '';
};

// === TOOLS MARQUEE ===
function initToolsMarquee() {
  const track = document.getElementById('toolsTrack');
  const marquee = document.querySelector('.hero-tools-marquee');
  if (!track || !marquee) return;

  // Çift kopya işlemini artık index.html'de statik olarak yaptık (Glitches önleyici)

  // === MARQUEE ENGINE ===
  function startMarquee() {
    // Küçük bir gecikme: Layout'un ve ikonların oturması için
    setTimeout(() => {
      const totalHeight = track.offsetHeight / 2;
      
      // Eğer yükseklik hala 0 ise (nadiren olur), 500ms sonra tekrar dene
      if (totalHeight <= 0) {
        setTimeout(startMarquee, 500);
        return;
      }

      const marqueeTween = gsap.to(track, {
        y: -totalHeight,
        duration: 25,
        ease: "none",
        repeat: -1,
        overwrite: true
      });

      marquee.addEventListener('mouseenter', () => marqueeTween.pause());
      marquee.addEventListener('mouseleave', () => marqueeTween.play());
    }, 200);
  }

  // Sayfa çoktan yüklendiyse hemen başlat, yoksa load event'ini bekle
  if (document.readyState === 'complete') {
    startMarquee();
  } else {
    window.addEventListener('load', startMarquee);
  }

  // 3D Kavis efekti — GÜÇLENDİRİLDİ (Ekran duyarlı)
  function apply3DDepth() {
    const containerRect = marquee.getBoundingClientRect();
    const centerY = containerRect.top + containerRect.height / 2;
    const maxDist = containerRect.height / 2;
    const isMobile = window.innerWidth < 768;

    const buttons = track.querySelectorAll('.tool-btn');
    buttons.forEach(btn => {
      const btnRect = btn.getBoundingClientRect();
      const btnCenterY = btnRect.top + btnRect.height / 2;
      const dist = Math.abs(btnCenterY - centerY);
      
      const ratio = Math.min(dist / maxDist, 1); 

      // Mobile vs Desktop Math
      let scale, opacity, z;
      
      if (isMobile) {
        // Mobil: Uygulama hissi için daha nazik şişirme
        scale = 1.12 - (ratio * 0.35); // Max 1.12
        opacity = Math.max(1 - (ratio * 0.7), 0.4);
        z = 40 - (ratio * 120); // Daha dar Z aralığı
      } else {
        // Masaüstü: Dev 3D etkisi devrede
        scale = 1.25 - (ratio * 0.55);
        opacity = Math.max(1 - (ratio * 0.8), 0.2);
        z = 80 - (ratio * 230);
      }

      btn.style.transform = `scale(${scale}) translateZ(${z}px)`;
      btn.style.opacity = opacity;
      btn.style.zIndex = Math.round((1 - ratio) * 100);
    });
  }

  gsap.ticker.add(apply3DDepth);
}

// === FOOTER ===
function initFooter() {
  if (typeof gsap === 'undefined' || typeof ScrollTrigger === 'undefined') return;

  gsap.to('.footer-word', {
    y: 0,
    duration: 1.2,
    stagger: .12,
    ease: 'power4.out',
    scrollTrigger: {
      trigger: '.footer-big-text',
      start: 'top 100%',
      once: true,
    }
  });

  gsap.from('.footer-nav-col', {
    y: 24,
    opacity: 0,
    duration: .7,
    stagger: .1,
    ease: 'power3.out',
    scrollTrigger: {
      trigger: '#footer',
      start: 'top 100%',
      once: true,
    }
  });
}