// === CANVAS PARTICLES ===
const canvas = document.getElementById('bgCanvas');
const ctx = canvas.getContext('2d');
let W, H, particles = [];
const mouse = { x: -9999, y: -9999 };

function resize() {
  W = canvas.width = window.innerWidth;
  H = canvas.height = window.innerHeight;
}

class Particle {
  constructor() { this.init(); }
  init() {
    this.x  = Math.random() * W;
    this.y  = Math.random() * H;
    this.vx = (Math.random() - .5) * .35;
    this.vy = (Math.random() - .5) * .35;
    this.r  = Math.random() * 1.2 + .4;
    this.a  = Math.random() * .35 + .1;
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
      const d  = Math.hypot(dx, dy);
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
    const md  = Math.hypot(mdx, mdy);
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
  ctx.clearRect(0, 0, W, H);
  particles.forEach(p => { p.update(); p.draw(); });
  drawConnections();
  requestAnimationFrame(loopCanvas);
}

// === CURSOR ===
const cursorDot  = document.getElementById('cursor');
const cursorRing = document.getElementById('cursor-ring');
let cx = 0, cy = 0, rx = 0, ry = 0;

document.addEventListener('mousemove', e => {
  cx = e.clientX; cy = e.clientY;
  mouse.x = cx;   mouse.y = cy;
});

function loopCursor() {
  rx += (cx - rx) * .11;
  ry += (cy - ry) * .11;
  cursorDot.style.left  = cx + 'px';
  cursorDot.style.top   = cy + 'px';
  cursorRing.style.left = rx + 'px';
  cursorRing.style.top  = ry + 'px';
  requestAnimationFrame(loopCursor);
}

document.querySelectorAll('a, button').forEach(el => {
  el.addEventListener('mouseenter', () => {
    cursorDot.classList.add('hover');
    cursorRing.classList.add('hover');
  });
  el.addEventListener('mouseleave', () => {
    cursorDot.classList.remove('hover');
    cursorRing.classList.remove('hover');
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
    .to('#nav',                { opacity: 1, y: 0, duration: .9 })
    .to('.hero-label',         { opacity: 1, duration: .7 },       '-=.5')
    .to('.line',               { y: '0%', duration: 1.1, stagger: .13 }, '-=.5')
    .to('.hero-role',          { opacity: 1, y: 0, duration: .7 }, '-=.5')
    .to('.hero-desc',          { opacity: 1, y: 0, duration: .6 }, '-=.4')
    .to('.hero-cta',           { opacity: 1, y: 0, duration: .6 }, '-=.4')
    .to('.hero-scroll',        { opacity: 1, duration: .6 },       '-=.3');
}

// === INIT ===
window.addEventListener('resize', () => { resize(); initParticles(); });
resize();
initParticles();
loopCanvas();
loopCursor();
setTimeout(typeNext, 1600);
if (typeof gsap !== 'undefined') {
  initGSAP();
  initStats();
  initSkills();
}

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
      const rect  = card.getBoundingClientRect();
      const cx    = rect.left + rect.width  / 2;
      const cy    = rect.top  + rect.height / 2;
      const dx    = (e.clientX - cx) / (rect.width  / 2);
      const dy    = (e.clientY - cy) / (rect.height / 2);
      const rotX  = -dy * 7;
      const rotY  =  dx * 7;
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