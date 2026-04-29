(function() {
  loadPortfolioFromAPI().then(projects => {
    const grid = document.getElementById('portGrid');
    if (!grid) return;

    if (!projects || !projects.length) {
      grid.innerHTML = '<div class="port-empty">Şu an için gösterilecek bir iş bulunamadı.</div>';
      document.querySelectorAll('.filter-count').forEach(el => el.textContent = '0');
      return;
    }

    // Grid'i temizle
    grid.innerHTML = '';

    // Dinamik layout
    projects.forEach((p, i) => {
      const div = document.createElement('div');
      div.innerHTML = buildPortfolioCard(p);
      const card = div.firstElementChild;
      grid.appendChild(card);
    });

    // Animasyon
    if (typeof gsap !== 'undefined') {
      setTimeout(() => {
        gsap.to('.port-card', { opacity: 1, duration: .5, stagger: .04, ease: 'power3.out' });
      }, 50);
    } else {
      document.querySelectorAll('.port-card').forEach(c => c.style.opacity = '1');
    }

    // Filtre sayıları
    const counts = {};
    projects.forEach(p => { counts[p.category] = (counts[p.category]||0)+1; });
    const fcAll = document.getElementById('fc-all');
    if (fcAll) fcAll.textContent = projects.length;

    // Reset others
    document.querySelectorAll('.filter-count').forEach(el => {
      if (el.id !== 'fc-all') el.textContent = '0';
    });

    Object.entries(counts).forEach(([cat, n]) => {
      const el = document.getElementById('fc-' + cat);
      if (el) el.textContent = n;
    });

    // Lightbox için kartları yeniden bağla
    if (typeof initPortfolioCards === 'function') initPortfolioCards();
  });

  if (typeof gsap !== 'undefined') {
    gsap.registerPlugin(ScrollTrigger);

    gsap.timeline({ defaults: { ease: 'power4.out' }, delay: .2 })
      .to('.port-eyebrow',  { opacity: 1, duration: .6 })
      .to('.port-line',     { opacity: 1, y: 0, duration: 1.1, stagger: .12 }, '-=.4')
      .to('.port-hero-sub', { opacity: 1, y: 0, duration: .7 }, '-=.5');
  }

  const filterBtns = document.querySelectorAll('.filter-btn');
  const empty      = document.getElementById('portEmpty');

  filterBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      filterBtns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');

      const filter  = btn.dataset.filter;
      let   visible = 0;
      const cards   = document.querySelectorAll('.port-card');

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

  // === LIGHTBOX + VIDEO PLAYER ===
  const lightbox   = document.getElementById('lightbox');
  const lbClose    = document.getElementById('lbClose');
  const lbPrev     = document.getElementById('lbPrev');
  const lbNext     = document.getElementById('lbNext');
  const lbImg      = document.getElementById('lbImg');
  const lbImgWrap  = document.getElementById('lbImgWrap');
  const lbVideoWrap= document.getElementById('lbVideoWrap');
  const lbVideo    = document.getElementById('lbVideo');
  const lbCat      = document.getElementById('lbCat');
  const lbTitle    = document.getElementById('lbTitle');
  const lbDesc     = document.getElementById('lbDesc');
  const lbTags     = document.getElementById('lbTags');
  const lbYear     = document.getElementById('lbYear');

  // Video player elemanları
  const vpPlayBtn  = document.getElementById('vpPlayBtn');
  const vpPlayIcon = document.getElementById('vpPlayIcon');
  const vpTime     = document.getElementById('vpTime');
  const vpFill     = document.getElementById('vpFill');
  const vpProgress = document.getElementById('vpProgress');
  const vpMuteBtn  = document.getElementById('vpMuteBtn');
  const vpVol      = document.getElementById('vpVol');
  const vpFullBtn  = document.getElementById('vpFullBtn');
  const vpBigPlay  = document.getElementById('vpBigPlay');

  let currentIndex = 0;
  let visibleCards = [];

  // Süre formatla
  function fmtTime(s) {
    const m = Math.floor(s / 60);
    const sec = Math.floor(s % 60);
    return `${m}:${sec.toString().padStart(2,'0')}`;
  }

  // Video player init
  function initVideoPlayer() {
    if (!lbVideo) return;

    lbVideo.addEventListener('timeupdate', () => {
      if (!lbVideo.duration) return;
      const pct = (lbVideo.currentTime / lbVideo.duration) * 100;
      vpFill.style.width = pct + '%';
      vpTime.textContent = `${fmtTime(lbVideo.currentTime)} / ${fmtTime(lbVideo.duration)}`;
    });

    lbVideo.addEventListener('play', () => {
      vpPlayIcon.outerHTML = '<svg id="vpPlayIcon" width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>';
    });
    lbVideo.addEventListener('pause', () => {
      vpPlayIcon.outerHTML = '<svg id="vpPlayIcon" width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><polygon points="5,3 19,12 5,21"/></svg>';
      showBigPlay();
    });
    lbVideo.addEventListener('ended', () => {
      vpFill.style.width = '0%';
    });

    // Progress tıklama
    vpProgress.addEventListener('click', e => {
      const rect = vpProgress.getBoundingClientRect();
      const ratio = (e.clientX - rect.left) / rect.width;
      lbVideo.currentTime = ratio * lbVideo.duration;
    });

    // Play/pause
    vpPlayBtn.addEventListener('click', togglePlay);
    lbVideo.addEventListener('click', togglePlay);

    // Ses
    vpVol.addEventListener('input', () => {
      lbVideo.volume = vpVol.value;
      lbVideo.muted = vpVol.value == 0;
    });
    vpMuteBtn.addEventListener('click', () => {
      lbVideo.muted = !lbVideo.muted;
      vpVol.value = lbVideo.muted ? 0 : lbVideo.volume || 1;
    });

    // Tam ekran
    vpFullBtn.addEventListener('click', () => {
      if (lbVideoWrap.requestFullscreen) lbVideoWrap.requestFullscreen();
    });
  }

  function togglePlay() {
    if (lbVideo.paused) {
      lbVideo.play();
      hideBigPlay();
    } else {
      lbVideo.pause();
    }
  }

  function showBigPlay() {
    vpBigPlay.classList.add('show');
    setTimeout(() => {
      vpBigPlay.classList.add('fade');
      setTimeout(() => {
        vpBigPlay.classList.remove('show','fade');
      }, 300);
    }, 600);
  }

  function hideBigPlay() {
    vpBigPlay.classList.remove('show','fade');
  }

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
    if (lbVideo) {
      lbVideo.pause();
      lbVideo.src = '';
    }
  }

  function fillLightbox(card) {
    const isVideo = !!card.dataset.video;

    lbCat.textContent   = card.dataset.cat   || '';
    lbTitle.textContent = card.dataset.title || '';
    lbDesc.textContent  = card.dataset.desc  || '';
    lbYear.textContent  = card.dataset.year  || '';
    lbTags.innerHTML = (card.dataset.tags || '')
      .split(',').map(t => `<span class="lb-tag">${t.trim()}</span>`).join('');

    if (isVideo) {
      // Video modu
      lbImgWrap.style.display  = 'none';
      lbVideoWrap.style.display = 'flex';
      if (lbVideo.src !== card.dataset.video) {
        lbVideo.src = card.dataset.video;
        lbVideo.load();
      }
      lbVideo.play().catch(() => {});
      vpFill.style.width = '0%';
      vpTime.textContent = '0:00 / 0:00';
    } else {
      // Görsel modu
      lbVideoWrap.style.display = 'none';
      lbImgWrap.style.display   = 'flex';
      if (lbVideo) { lbVideo.pause(); lbVideo.src = ''; }
      lbImg.src  = card.dataset.img || card.querySelector('img').src;
      lbImg.alt  = card.dataset.title || '';
    }
  }

  if (lightbox) {
    initVideoPlayer();

    function initPortfolioCards() {
      const cards = document.querySelectorAll('.port-card');
      cards.forEach(card => {
        // önce eski listener'ı temizle
        card.replaceWith(card.cloneNode(true));
      });
      document.querySelectorAll('.port-card').forEach(card => {
        card.addEventListener('click', () => openLightbox(card));
      });
    }
    initPortfolioCards();

    lbClose.addEventListener('click', closeLightbox);

    lbPrev.addEventListener('click', e => {
      e.stopPropagation();
      visibleCards = [...document.querySelectorAll('.port-card:not(.hidden)')];
      currentIndex = (currentIndex - 1 + visibleCards.length) % visibleCards.length;
      fillLightbox(visibleCards[currentIndex]);
    });

    lbNext.addEventListener('click', e => {
      e.stopPropagation();
      visibleCards = [...document.querySelectorAll('.port-card:not(.hidden)')];
      currentIndex = (currentIndex + 1) % visibleCards.length;
      fillLightbox(visibleCards[currentIndex]);
    });

    lightbox.addEventListener('click', e => {
      if (e.target === lightbox) closeLightbox();
    });

    document.addEventListener('keydown', e => {
      if (!lightbox.classList.contains('open')) return;
      if (e.key === 'Escape')      closeLightbox();
      if (e.key === 'ArrowLeft')   lbPrev.click();
      if (e.key === 'ArrowRight')  lbNext.click();
      if (e.key === ' ') { e.preventDefault(); togglePlay(); }
    });
  }
})();
