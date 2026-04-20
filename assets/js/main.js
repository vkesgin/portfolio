function getScroller() { return window; }

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
  gsap.set('#nav', { y: -24 });
  gsap.set(['.hero-role', '.hero-desc', '.hero-cta'], { y: 22 });

  gsap.timeline({ defaults: { ease: 'power4.out' }, delay: .1 })
    .to('#nav',               { opacity: 1, y: 0, duration: .9 })
    .to('.hero-label',        { opacity: 1, duration: .7 },       '-=.5')
    .to('.line',              { y: '0%', duration: 1.1, stagger: .13 }, '-=.5')
    .to('.hero-role',         { opacity: 1, y: 0, duration: .7 }, '-=.5')
    .to('.hero-desc',         { opacity: 1, y: 0, duration: .6 }, '-=.4')
    .to('.hero-cta',          { opacity: 1, y: 0, duration: .6 }, '-=.4')
    .to('.hero-photo-side',   { opacity: 1, x: 0, duration: 1, ease: 'power3.out' }, '-=.8')
    .to('.hero-scroll',       { opacity: 1, duration: .6 },       '-=.3');
}

// === HERO PHOTO PARALLAX ===
function initHeroParallax() {
  if (window.matchMedia('(max-width: 900px)').matches) return;
  const section = document.getElementById('hero');
  const inner   = document.getElementById('heroPhotoInner');
  const img     = document.getElementById('heroImg');
  if (!section || !inner || !img) return;

  let targetX = 0, targetY = 0;
  let currentX = 0, currentY = 0;

  section.addEventListener('mousemove', e => {
    const rect = section.getBoundingClientRect();
    const cx   = rect.left + rect.width  / 2;
    const cy   = rect.top  + rect.height / 2;
    targetX = (e.clientX - cx) / rect.width  * 18;
    targetY = (e.clientY - cy) / rect.height * 12;
  });

  section.addEventListener('mouseleave', () => {
    targetX = 0;
    targetY = 0;
  });

  function loopParallax() {
    currentX += (targetX - currentX) * .06;
    currentY += (targetY - currentY) * .06;

    // Dış kutu hafif ters yönde — derinlik hissi
    gsap.set(inner, {
      rotateX: -currentY * .4,
      rotateY:  currentX * .4,
      transformPerspective: 800,
    });

    // Görsel biraz daha agresif kayar
    gsap.set(img, {
      x: currentX * 1.4,
      y: currentY * 1.0,
      scale: 1.06,
    });

    requestAnimationFrame(loopParallax);
  }

  loopParallax();
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
  initHeroParallax();
}
initNav();
initFooter();

// Hash scroll — başka sayfadan gelinince (#works gibi)
if (window.location.hash) {
  setTimeout(() => {
    const target = document.querySelector(window.location.hash);
    if (!target) return;
    if (window._loco) {
      window._loco.scrollTo(target, { duration: 800, easing: [0.25, 0.0, 0.35, 1.0] });
    } else {
      target.scrollIntoView({ behavior: 'smooth' });
    }
  }, 700);
}

// === SCROLL TO TOP ===
function initScrollToTop() {
  let stt = document.getElementById('scrollToTopBtn');
  if (!stt) {
    stt = document.createElement('button');
    stt.id = 'scrollToTopBtn';
    stt.className = 'scroll-to-top';
    stt.setAttribute('aria-label', 'Yukarı Çık');
    stt.innerHTML = `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="18 15 12 9 6 15"></polyline></svg>`;
    document.body.appendChild(stt);
  }

  const updateStt = () => {
    const sY = window._locoScrollY ?? window.scrollY;
    if (sY > 500) stt.classList.add('visible');
    else stt.classList.remove('visible');
  };

  window.addEventListener('scroll', updateStt);
  if (typeof ScrollTrigger !== 'undefined') {
    ScrollTrigger.addEventListener('scrollStart', updateStt);
  }

  stt.addEventListener('click', () => {
    if (window._loco) {
      window._loco.scrollTo(0, { duration: 1000, easing: [0.25, 0.0, 0.35, 1.0] });
    } else {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  });

  // Locomotive scroll binding
  setTimeout(() => {
    if (window._loco) {
      window._loco.on('scroll', (args) => {
        const sY = args.scroll.y;
        if (sY > 500) stt.classList.add('visible');
        else stt.classList.remove('visible');
      });
    }
  }, 1000);
}

initScrollToTop();

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
      scroller: getScroller(),
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
  if (typeof loadFeaturedFromAPI === 'function') {
    loadFeaturedFromAPI().then(projects => {
      const grid = document.getElementById('worksGrid');
      if (!grid) return;

      if (!projects || !projects.length) {
        grid.innerHTML = '<div class="port-empty">Ana sayfada gösterilecek seçilmiş bir iş bulunamadı.</div>';
        const label = document.querySelector('.works-count-label');
        if (label) label.textContent = '0 iş gösteriliyor';
        return;
      }

      // Statik kartları kaldır
      grid.innerHTML = '';

      const maxShow = Math.min(projects.length, 6);
      projects.slice(0, maxShow).forEach((p, i) => {
        const div = document.createElement('div');
        div.innerHTML = buildWorkCard(p);
        const card = div.firstElementChild;

        // İlk ve 4. kart large
        if ((i === 0 || i === 3) && maxShow > 2) {
          card.classList.add('work-card--large');
        }

        grid.appendChild(card);
      });

      // Count label
      const label = document.querySelector('.works-count-label');
      if (label) label.textContent = projects.length + ' iş gösteriliyor';

      // Baştan görünür yap
      const cards = grid.querySelectorAll('.work-card');
      cards.forEach(c => c.style.opacity = '1');

      // GSAP ile göster
      if (typeof gsap !== 'undefined' && typeof ScrollTrigger !== 'undefined') {
        gsap.from(cards, {
          opacity: 0,
          y: 40,
          duration: .8,
          stagger: .1,
          ease: 'power3.out',
          scrollTrigger: { trigger: '#works', start: 'top 75%' }
        });
      }

      // Video kartları için tıklama
      grid.querySelectorAll('.work-card--video').forEach(card => {
        card.addEventListener('click', e => {
          const videoSrc = card.dataset.video;
          if (!videoSrc) return;
          e.preventDefault();

          let lb = document.getElementById('works-lightbox');
          if (lb) lb.remove();

          lb = document.createElement('div');
          lb.id = 'works-lightbox';
          lb.style.cssText = 'position:fixed;inset:0;z-index:9000;background:rgba(0,0,0,.96);display:flex;align-items:center;justify-content:center;backdrop-filter:blur(20px)';
          lb.innerHTML = `
            <button id="wlbClose" style="position:absolute;top:24px;right:24px;background:rgba(255,255,255,.05);border:0.5px solid #2a2a2a;color:#888;padding:8px 14px;border-radius:6px;cursor:pointer;font-family:var(--font-mono);font-size:13px;z-index:2">✕</button>
            <div style="width:90%;max-width:960px;aspect-ratio:16/9;position:relative;background:#000;border-radius:8px;overflow:hidden;">
              <video id="wlbVideo" style="width:100%;height:100%;object-fit:contain;" playsinline controls autoplay></video>
            </div>`;
          document.body.appendChild(lb);

          const vid = lb.querySelector('#wlbVideo');
          vid.src = videoSrc;
          vid.play().catch(()=>{});
          document.body.style.overflow = 'hidden';

          const close = () => { vid.pause(); lb.remove(); document.body.style.overflow = ''; };
          lb.querySelector('#wlbClose').addEventListener('click', close);
          lb.addEventListener('click', e => { if (e.target === lb) close(); });
          document.addEventListener('keydown', function esc(event) {
            if (event.key === 'Escape') { close(); document.removeEventListener('keydown', esc); }
          });
        });
      });
      // Görsel kartları için lightbox
      grid.querySelectorAll('.work-card:not(.work-card--video)').forEach(card => {
        card.addEventListener('click', () => {
          const imgSrc   = card.dataset.img || card.querySelector('img')?.src;
          const title    = card.querySelector('.work-title')?.textContent || '';
          const desc     = card.querySelector('.work-desc')?.textContent  || '';
          const cat      = card.querySelector('.work-cat-label')?.textContent || '';
          const year     = card.querySelector('.work-year')?.textContent  || '';
          if (!imgSrc) return;

          let lb = document.getElementById('works-lightbox');
          if (lb) lb.remove();

          lb = document.createElement('div');
          lb.id = 'works-lightbox';
          lb.style.cssText = `
            position:fixed;inset:0;z-index:9000;
            background:rgba(0,0,0,.96);
            display:flex;align-items:center;justify-content:center;
            backdrop-filter:blur(20px);
            padding:24px;
          `;
          lb.innerHTML = `
            <button id="wlbClose" style="
              position:absolute;top:24px;right:24px;
              background:rgba(255,255,255,.05);
              border:0.5px solid #2a2a2a;
              color:#888;padding:8px 14px;
              border-radius:6px;cursor:pointer;
              font-family:var(--font-mono);font-size:13px;
              z-index:2;transition:color .2s,border-color .2s;
            ">✕</button>
            <div style="
              display:flex;gap:32px;align-items:center;
              max-width:1100px;width:100%;
            ">
              <div style="flex:1;overflow:hidden;border-radius:8px;max-height:80vh;">
                <img src="${imgSrc}" alt="${title}"
                  style="width:100%;height:100%;object-fit:contain;display:block;max-height:80vh;">
              </div>
              <div style="width:260px;flex-shrink:0;display:flex;flex-direction:column;gap:12px;">
                <span style="
                  font-family:var(--font-mono);font-size:10px;
                  letter-spacing:.12em;color:#00e5ff;
                  background:rgba(0,229,255,.08);
                  border:0.5px solid rgba(0,229,255,.2);
                  padding:3px 10px;border-radius:3px;
                  display:inline-block;width:fit-content;
                ">${cat}</span>
                <h3 style="
                  font-family:var(--font-display);
                  font-size:32px;line-height:.95;
                  color:#f0f0f0;letter-spacing:.02em;
                ">${title}</h3>
                <p style="
                  font-size:13px;color:#888;
                  line-height:1.7;
                ">${desc}</p>
                <span style="
                  font-family:var(--font-mono);
                  font-size:11px;color:#444;
                  letter-spacing:.08em;
                ">${year}</span>
                <a href="/pages/portfolio.html" style="
                  margin-top:8px;
                  font-family:var(--font-mono);font-size:11px;
                  letter-spacing:.1em;color:#00e5ff;
                  border:0.5px solid rgba(0,229,255,.3);
                  padding:10px 20px;border-radius:4px;
                  text-align:center;
                  transition:background .2s;
                  display:block;
                ">Tüm İşleri Gör ↗</a>
              </div>
            </div>`;
          document.body.appendChild(lb);
          document.body.style.overflow = 'hidden';

          const close = () => {
            lb.remove();
            document.body.style.overflow = '';
          };
          lb.querySelector('#wlbClose').addEventListener('click', close);
          lb.addEventListener('click', e => { if (e.target === lb) close(); });
          document.addEventListener('keydown', function esc(e) {
            if (e.key === 'Escape') { close(); document.removeEventListener('keydown', esc); }
          });
        });
      });

    });
  }

  if (typeof gsap === 'undefined' || typeof ScrollTrigger === 'undefined') return;

  // Filtre
  const filterBtns = document.querySelectorAll('#works .filter-btn');
  const countLabel  = document.querySelector('.works-count-label');
  filterBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      filterBtns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const filter = btn.dataset.filter;
      let visible  = 0;
      document.querySelectorAll('.work-card').forEach(card => {
        const match = filter === 'all' || card.dataset.cat === filter;
        card.classList.toggle('hidden', !match);
        if (match) {
          gsap.fromTo(card, { opacity:0, y:12 }, { opacity:1, y:0, duration:.4, delay: visible*.05 });
          visible++;
        }
      });
      if (countLabel) countLabel.textContent = visible + ' iş gösteriliyor';
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
      scroller: getScroller(),
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
      scroller: getScroller(),
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
      scroller: getScroller(),
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
      scroller: getScroller(),
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
      scroller: getScroller(),
    }
  });

  // CountUp
  document.querySelectorAll('.count').forEach(el => {
    const target = parseInt(el.dataset.target);
    ScrollTrigger.create({
      trigger: el,
      start: 'top 80%',
      scroller: getScroller(),
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
      scroller: getScroller(),
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
    const scrollY = window._locoScrollY ?? window.scrollY;
    let current = '';

    // Scroll progress & sticky
    if (nav) {
      const scrollEl = document.querySelector('[data-scroll-container]');
      const docH = (scrollEl || document.documentElement).scrollHeight - window.innerHeight;
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
    hamburger.setAttribute('aria-expanded', menuOpen);
    hamburger.setAttribute('aria-label', menuOpen ? 'Menüyü kapat' : 'Menüyü aç');
    document.body.style.overflow = menuOpen ? 'hidden' : '';
  });
}

window.closeMenu = function () {
  const hamburger = document.getElementById('hamburger');
  const menu = document.getElementById('mobileMenu');
  hamburger.classList.remove('open');
  menu.classList.remove('open');
  hamburger.setAttribute('aria-expanded', false);
  hamburger.setAttribute('aria-label', 'Menüyü aç');
  document.body.style.overflow = '';
};

// === TOOLS MARQUEE ===
function initToolsMarquee() {
  const track = document.getElementById('toolsTrack');
  const marquee = document.querySelector('.hero-tools-marquee');
  if (!track || !marquee) return;

  let marqueeTween = null;

  // === MARQUEE ENGINE ===
  function startMarquee() {
    // Önceki tween varsa temizle (Resize durumunda)
    if (marqueeTween) marqueeTween.kill();
    gsap.set(track, { x: 0, y: 0 });

    setTimeout(() => {
      const isMobile = window.innerWidth <= 1440;
      
      if (isMobile) {
        // MOBİL/TABLET: Yatay Akış
        const totalWidth = track.scrollWidth / 2;
        if (totalWidth <= 0) return;

        marqueeTween = gsap.to(track, {
          x: -totalWidth,
          duration: 20,
          ease: "none",
          repeat: -1,
          overwrite: true
        });
      } else {
        // MASAÜSTÜ: Dikey Akış
        const totalHeight = track.offsetHeight / 2;
        if (totalHeight <= 0) {
          setTimeout(startMarquee, 500);
          return;
        }

        marqueeTween = gsap.to(track, {
          y: -totalHeight,
          duration: 25,
          ease: "none",
          repeat: -1,
          overwrite: true
        });
      }

      marquee.addEventListener('mouseenter', () => marqueeTween.pause());
      marquee.addEventListener('mouseleave', () => marqueeTween.play());
    }, 200);
  }

  // Sayfa yüklendiğinde başlat
  if (document.readyState === 'complete') {
    startMarquee();
  } else {
    window.addEventListener('load', startMarquee);
  }

  // Resize durumunda yönü güncelle (Debounced)
  let resizeTimer;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(startMarquee, 250);
  });

  // 3D Kavis efekti — Sadece Masaüstünde Aktif
  function apply3DDepth() {
    if (window.innerWidth <= 1440) return;

    const containerRect = marquee.getBoundingClientRect();
    const centerY = containerRect.top + containerRect.height / 2;
    const maxDist = containerRect.height / 2;

    const buttons = track.querySelectorAll('.tool-btn');
    buttons.forEach(btn => {
      const btnRect = btn.getBoundingClientRect();
      const btnCenterY = btnRect.top + btnRect.height / 2;
      const dist = Math.abs(btnCenterY - centerY);
      const ratio = Math.min(dist / maxDist, 1); 

      const scale = 1.25 - (ratio * 0.55);
      const opacity = Math.max(1 - (ratio * 0.8), 0.2);
      const z = 80 - (ratio * 230);

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

  const footerGlow = document.querySelector('.footer-glow');
  const footerEl = document.getElementById('footer');
  if (footerGlow && footerEl) {
    footerEl.addEventListener('mousemove', e => {
      const rect = footerEl.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      gsap.to(footerGlow, {
        left: x, top: y,
        duration: 1.2,
        ease: 'power3.out'
      });
    });
  }

  gsap.to('.footer-word', {
    y: 0,
    duration: 1.2,
    stagger: .12,
    ease: 'power4.out',
    scrollTrigger: {
      trigger: '.footer-big-text',
      start: 'top 100%',
      scroller: getScroller(),
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
      scroller: getScroller(),
      once: true,
    }
  });
}