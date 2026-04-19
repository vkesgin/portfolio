if (typeof gsap === 'undefined') return;

gsap.registerPlugin(ScrollTrigger);

  // Hero animasyonu
  gsap.timeline({ defaults: { ease: 'power4.out' }, delay: .2 })
    .to('.srv-eyebrow',   { opacity: 1, duration: .6 })
    .to('.srv-line',      { opacity: 1, y: 0, duration: 1.1, stagger: .12 }, '-=.4')
    .to('.srv-hero-sub',  { opacity: 1, y: 0, duration: .7 }, '-=.5')
    .to('.srv-hero-scroll-hint', { opacity: 1, duration: .5 }, '-=.3');

  // Servis itemları
  gsap.to('.srv-item', {
    opacity: 1, y: 0,
    duration: .8, stagger: .1,
    ease: 'power3.out',
    scrollTrigger: { trigger: '#srv-list', start: 'top 80%' }
  });

  // Process adımları
  gsap.to('.process-step', {
    opacity: 1, y: 0,
    duration: .7, stagger: .1,
    ease: 'power3.out',
    scrollTrigger: { trigger: '.process-grid', start: 'top 78%' }
  });

  // CTA
  gsap.timeline({
    scrollTrigger: { trigger: '#srv-cta', start: 'top 78%' },
    defaults: { ease: 'power4.out' }
  })
    .to('.srv-cta-title', { opacity: 1, y: 0, duration: 1 })
    .to('.srv-cta-sub',   { opacity: 1, y: 0, duration: .7 }, '-=.5')
    .to('#srv-cta .btn',  { opacity: 1, y: 0, duration: .6 }, '-=.4');
