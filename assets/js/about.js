(function() {
  if (typeof gsap === 'undefined') return;
  gsap.registerPlugin(ScrollTrigger);

  gsap.timeline({ defaults: { ease: 'power4.out' }, delay: .2 })
    .to('.abt-eyebrow',   { opacity: 1, duration: .6 })
    .to('.abt-line',      { opacity: 1, y: 0, duration: 1.1, stagger: .12 }, '-=.4')
    .to('.abt-hero-meta', { opacity: 1, y: 0, duration: .7 }, '-=.5');

  gsap.to('.abt-bio-p', {
    opacity: 1, y: 0, duration: .8, stagger: .15,
    ease: 'power3.out',
    scrollTrigger: { trigger: '#abt-bio', start: 'top 75%' }
  });

  gsap.to('.abt-photo-wrap', {
    opacity: 1, y: 0, duration: .9,
    ease: 'power3.out',
    scrollTrigger: { trigger: '#abt-bio', start: 'top 78%' }
  });

  gsap.to('.abt-contact-row', {
    opacity: 1, y: 0, duration: .7,
    ease: 'power3.out',
    scrollTrigger: { trigger: '.abt-contact-row', start: 'top 85%' }
  });

  gsap.to('.tool-group', {
    opacity: 1, x: 0, duration: .7, stagger: .1,
    ease: 'power3.out',
    scrollTrigger: {
      trigger: '.tools-grid', start: 'top 75%',
      onEnter: () => {
        document.querySelectorAll('.tool-fill').forEach(bar => {
          bar.style.width = bar.dataset.w + '%';
        });
      }
    }
  });

  gsap.to('.abt-tl-item', {
    opacity: 1, y: 0, duration: .7, stagger: .12,
    ease: 'power3.out',
    scrollTrigger: { trigger: '#abt-timeline', start: 'top 75%' }
  });
  gsap.from('.abt-tl-line', {
    scaleY: 0, transformOrigin: 'top center',
    duration: .8, stagger: .12,
    ease: 'power3.out',
    scrollTrigger: { trigger: '#abt-timeline', start: 'top 75%' }
  });

  gsap.to('.abt-stat', {
    opacity: 1, y: 0, duration: .7, stagger: .12,
    ease: 'power3.out',
    scrollTrigger: {
      trigger: '#abt-stats', start: 'top 80%',
      onEnter: () => {
        document.querySelectorAll('.count').forEach(el => {
          const target = parseInt(el.dataset.target);
          let n = 0;
          const step = Math.max(1, Math.floor(target / 50));
          const iv = setInterval(() => {
            n = Math.min(n + step, target);
            el.textContent = n;
            if (n >= target) clearInterval(iv);
          }, 30);
        });
      }
    }
  });

  gsap.timeline({
    scrollTrigger: { trigger: '#abt-cta', start: 'top 80%' },
    defaults: { ease: 'power4.out' }
  })
    .to('.abt-cta-title', { opacity: 1, y: 0, duration: 1 })
    .to('.abt-cta-sub',   { opacity: 1, y: 0, duration: .7 }, '-=.5')
    .to('#abt-cta .btn',  { opacity: 1, duration: .6 }, '-=.4');
})();
