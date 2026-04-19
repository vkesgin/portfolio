(function() {
  if (typeof gsap !== 'undefined') {
    gsap.registerPlugin(ScrollTrigger);

    gsap.timeline({ defaults: { ease: 'power4.out' }, delay: .2 })
      .to('.port-eyebrow',  { opacity: 1, duration: .6 })
      .to('.port-line',     { opacity: 1, y: 0, duration: 1.1, stagger: .12 }, '-=.4')
      .to('.port-hero-sub', { opacity: 1, y: 0, duration: .7 }, '-=.5');

    gsap.to('.port-card', {
      opacity: 1,
      duration: .6,
      stagger: { amount: .8, from: 'start' },
      ease: 'power3.out',
      scrollTrigger: { trigger: '#port-gallery', start: 'top 80%' }
    });
  }

  const filterBtns = document.querySelectorAll('.filter-btn');
  const cards      = document.querySelectorAll('.port-card');
  const empty      = document.getElementById('portEmpty');

  filterBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      filterBtns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');

      const filter  = btn.dataset.filter;
      let   visible = 0;

      cards.forEach(card => {
        const match = filter === 'all' || card.dataset.cat === filter;
        if (match) {
          card.classList.remove('hidden');
          if (typeof gsap !== 'undefined') {
            gsap.fromTo(card,
              { opacity: 0, y: 16 },
              { opacity: 1, y: 0, duration: .45, ease: 'power3.out', delay: visible * .05 }
            );
          }
          visible++;
        } else {
          card.classList.add('hidden');
        }
      });

      if (empty) empty.style.display = visible === 0 ? 'block' : 'none';
    });
  });

  const lightbox = document.getElementById('lightbox');
  const lbClose  = document.getElementById('lbClose');
  const lbPrev   = document.getElementById('lbPrev');
  const lbNext   = document.getElementById('lbNext');
  const lbImg    = document.getElementById('lbImg');
  const lbCat    = document.getElementById('lbCat');
  const lbTitle  = document.getElementById('lbTitle');
  const lbDesc   = document.getElementById('lbDesc');
  const lbTags   = document.getElementById('lbTags');
  const lbYear   = document.getElementById('lbYear');

  let currentIndex = 0;
  let visibleCards = [];

  function openLightbox(card) {
    visibleCards = [...document.querySelectorAll('.port-card:not(.hidden)')];
    currentIndex = visibleCards.indexOf(card);
    fillLightbox(card);
    lightbox.classList.add('open');
    document.body.style.overflow = 'hidden';
  }

  function closeLightbox() {
    lightbox.classList.remove('open');
    document.body.style.overflow = '';
  }

  function fillLightbox(card) {
    lbImg.src           = card.dataset.img   || card.querySelector('img').src;
    lbCat.textContent   = card.dataset.cat   || '';
    lbTitle.textContent = card.dataset.title || '';
    lbDesc.textContent  = card.dataset.desc  || '';
    lbYear.textContent  = card.dataset.year  || '';
    lbTags.innerHTML = (card.dataset.tags || '')
      .split(',')
      .map(t => `<span class="lb-tag">${t.trim()}</span>`)
      .join('');
  }

  cards.forEach(card => {
    card.addEventListener('click', () => openLightbox(card));
  });

  if (lbClose) lbClose.addEventListener('click', closeLightbox);

  if (lbPrev) lbPrev.addEventListener('click', (e) => {
    e.stopPropagation();
    visibleCards = [...document.querySelectorAll('.port-card:not(.hidden)')];
    currentIndex = (currentIndex - 1 + visibleCards.length) % visibleCards.length;
    fillLightbox(visibleCards[currentIndex]);
  });

  if (lbNext) lbNext.addEventListener('click', (e) => {
    e.stopPropagation();
    visibleCards = [...document.querySelectorAll('.port-card:not(.hidden)')];
    currentIndex = (currentIndex + 1) % visibleCards.length;
    fillLightbox(visibleCards[currentIndex]);
  });

  if (lightbox) lightbox.addEventListener('click', (e) => {
    if (e.target === lightbox) closeLightbox();
  });

  document.addEventListener('keydown', (e) => {
    if (!lightbox || !lightbox.classList.contains('open')) return;
    if (e.key === 'Escape')     closeLightbox();
    if (e.key === 'ArrowLeft')  lbPrev && lbPrev.click();
    if (e.key === 'ArrowRight') lbNext && lbNext.click();
  });
})();
