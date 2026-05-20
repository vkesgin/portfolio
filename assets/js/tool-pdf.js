document.addEventListener('DOMContentLoaded', () => {
  const { PDFDocument } = PDFLib;

  let currentMode = 'merge'; // 'merge' veya 'split'
  let uploadedFiles = []; // Array of JS File objects
  let totalReadPages = 0; // Split modunda kaç sayfa olduğunu bilmek için

  const tabBtns = document.querySelectorAll('.tab-btn');
  const uploadZone = document.getElementById('uploadZone');
  const pdfInput = document.getElementById('pdfInput');
  const fileList = document.getElementById('fileList');
  
  const step1Title = document.getElementById('step1Title');
  const step1Desc = document.getElementById('step1Desc');
  const step2Title = document.getElementById('step2Title');
  const step2Desc = document.getElementById('step2Desc');
  const splitSettings = document.getElementById('splitSettings');
  
  const emptyState = document.getElementById('emptyState');
  const reportBanner = document.getElementById('reportBanner');
  const actionBtn = document.getElementById('actionBtn');
  const loadingStatus = document.getElementById('loadingStatus');

  const startPageInput = document.getElementById('startPage');
  const endPageInput = document.getElementById('endPage');

  const statsPanel = document.getElementById('statsPanel');
  const origSizeStr = document.getElementById('origSizeStr');
  const newSizeStr = document.getElementById('newSizeStr');

  if (typeof gsap !== 'undefined') {
    gsap.from('#tool-hero', { y: 30, opacity: 0, duration: 1, ease: 'power3.out' });
    gsap.from('.tool-tabs', { y: 20, opacity: 0, duration: 1, delay: 0.2, ease: 'power3.out' });
    gsap.from('.tool-card', { y: 40, opacity: 0, duration: 1, delay: 0.4, ease: 'power3.out' });
  }

  // --- TAB DEĞİŞTİRME MANTIĞI ---
  tabBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      tabBtns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      currentMode = btn.dataset.tab;
      
      // Arayüz Reset
      uploadedFiles = [];
      updateUI();
      
      if (currentMode === 'merge') {
        pdfInput.multiple = true;
        step1Title.innerText = "Adım 1: PDF Dosyalarını Seç";
        step1Desc.innerText = "Birleştirmek istediğiniz PDF belgelerini sırasıyla içeri aktarın.";
        splitSettings.style.display = 'none';
        step2Title.innerText = "Adım 2: Birleştir ve İndir";
        actionBtn.innerText = "Birleştirilmiş Belgeyi İndir ↓";
        if(statsPanel) statsPanel.style.display = 'none';
      } else if (currentMode === 'split') {
        pdfInput.multiple = false;
        step1Title.innerText = "Adım 1: Tek PDF Seç";
        step1Desc.innerText = "Sayfalarını parçalamak istediğiniz tek bir belgeyi yükleyin.";
        splitSettings.style.display = 'none'; // Sadece dosya gelince açılacak
        step2Title.innerText = "Adım 2: Parçaları İndir";
        actionBtn.innerText = "Kesilmiş Belgeyi İndir ↓";
        if(statsPanel) statsPanel.style.display = 'none';
      } else if (currentMode === 'compress') {
        pdfInput.multiple = false;
        step1Title.innerText = "Adım 1: PDF Seç";
        step1Desc.innerText = "Dosya boyutunu yapısal olarak küçültmek istediğiniz belgeyi yükleyin.";
        splitSettings.style.display = 'none';
        step2Title.innerText = "Adım 2: Sıkıştır ve İndir";
        actionBtn.innerText = "Belgeyi Sıkıştır ↓";
        if(statsPanel) statsPanel.style.display = 'none';
      }
    });
  });

  // --- SÜRÜKLE BIRAK (DRAG & DROP) ---
  ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
    uploadZone.addEventListener(eventName, e => { e.preventDefault(); e.stopPropagation(); }, false);
  });
  uploadZone.addEventListener('dragover', () => uploadZone.classList.add('dragover'));
  uploadZone.addEventListener('dragleave', () => uploadZone.classList.remove('dragover'));
  uploadZone.addEventListener('drop', (e) => {
    uploadZone.classList.remove('dragover');
    handleFiles(e.dataTransfer.files);
  });

  pdfInput.addEventListener('change', (e) => {
    handleFiles(e.target.files);
  });

  function handleFiles(files) {
    const validFiles = Array.from(files).filter(f => f.type === 'application/pdf');
    if(validFiles.length === 0) {
      alert("Lütfen sadece PDF belgesi yükleyin.");
      return;
    }

    if (currentMode === 'split' || currentMode === 'compress') {
      uploadedFiles = [validFiles[0]]; // sadece ilk dosyayı al
      if (currentMode === 'split') {
        analyzeSinglePDF(uploadedFiles[0]);
      }
    } else {
      // merge modunda üstüne ekleyebilir
      uploadedFiles = uploadedFiles.concat(validFiles);
    }
    updateUI();
  }

  function updateUI() {
    fileList.innerHTML = '';
    
    if (uploadedFiles.length === 0) {
      emptyState.style.display = 'block';
      actionBtn.style.display = 'none';
      reportBanner.style.display = 'none';
      return;
    }

    emptyState.style.display = 'none';
    
    uploadedFiles.forEach((file, index) => {
      const li = document.createElement('li');
      li.className = 'file-list-item';
      li.innerHTML = `
        <span class="file-name">📄 ${file.name}</span>
        <button class="file-remove" data-index="${index}">×</button>
      `;
      fileList.appendChild(li);
    });

    document.querySelectorAll('.file-remove').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const i = parseInt(e.target.dataset.index);
        uploadedFiles.splice(i, 1);
        updateUI();
        if(currentMode === 'split' && uploadedFiles.length === 0) {
           splitSettings.style.display = 'none';
        }
      });
    });

    // Validations to show actionBtn
    if (currentMode === 'merge' && uploadedFiles.length > 1) {
      reportBanner.style.background = 'rgba(0,229,255,0.1)';
      reportBanner.style.border = '1px solid rgba(0,229,255,0.3)';
      reportBanner.style.color = 'var(--accent)';
      reportBanner.innerText = `${uploadedFiles.length} Belge Hazır`;
      reportBanner.style.display = 'block';
      actionBtn.style.display = 'flex';
    } 
    else if (currentMode === 'merge' && uploadedFiles.length <= 1) {
      reportBanner.style.background = 'rgba(255,255,255,0.05)';
      reportBanner.style.border = '1px solid rgba(255,255,255,0.1)';
      reportBanner.style.color = 'var(--text-muted)';
      reportBanner.innerText = `En az 2 PDF yüklemelisiniz.`;
      reportBanner.style.display = 'block';
      actionBtn.style.display = 'none';
    }
    else if ((currentMode === 'split' || currentMode === 'compress') && uploadedFiles.length === 1) {
      actionBtn.style.display = 'flex';
      if (currentMode === 'compress') {
        statsPanel.style.display = 'block';
        origSizeStr.innerText = formatBytes(uploadedFiles[0].size);
        newSizeStr.innerText = 'Bekleniyor...';
        reportBanner.style.display = 'none';
      }
    }
  }

  // Split Modu İçin PDF İncelemesi (Kac sayfa oldugunu bul)
  async function analyzeSinglePDF(file) {
    try {
      const arrayBuffer = await file.arrayBuffer();
      const pdfDoc = await PDFDocument.load(arrayBuffer);
      totalReadPages = pdfDoc.getPageCount();
      
      splitSettings.style.display = 'block';
      
      startPageInput.value = 1;
      startPageInput.max = totalReadPages;
      endPageInput.value = totalReadPages;
      endPageInput.max = totalReadPages;

      reportBanner.style.background = 'rgba(0,229,255,0.1)';
      reportBanner.style.border = '1px solid rgba(0,229,255,0.3)';
      reportBanner.style.color = 'var(--accent)';
      reportBanner.innerText = `${file.name} (Algılandı: ${totalReadPages} Sayfa)`;
      reportBanner.style.display = 'block';

    } catch (error) {
      alert("Bu PDF okunamadı. Şifreli olabilir.");
      uploadedFiles = [];
      updateUI();
    }
  }

  // --- İŞLEM MERKEZİ ---
  actionBtn.addEventListener('click', async () => {
    actionBtn.style.display = 'none';
    loadingStatus.style.display = 'block';

    try {
      if (currentMode === 'merge') {
        await handleMerge();
      } else if (currentMode === 'split') {
        await handleSplit();
      } else if (currentMode === 'compress') {
        await handleCompress();
      }
    } catch (err) {
      console.error(err);
      alert("İşlem sırasında beklenmedik bir hata oluştu: " + err.message);
    } finally {
      actionBtn.style.display = 'flex';
      loadingStatus.style.display = 'none';
    }
  });

  async function handleMerge() {
    const mergedPdf = await PDFDocument.create();
    
    for (const file of uploadedFiles) {
      const fileBuffer = await file.arrayBuffer();
      const pdf = await PDFDocument.load(fileBuffer);
      const copiedPages = await mergedPdf.copyPages(pdf, pdf.getPageIndices());
      copiedPages.forEach((page) => mergedPdf.addPage(page));
    }
    
    const mergedPdfBytes = await mergedPdf.save();
    downloadBlob(mergedPdfBytes, 'birlestirilmis-belge.pdf', 'application/pdf');
    
    reportBanner.innerText = `Başarı! Toplam ${mergedPdf.getPageCount()} sayfalık yeni PDF oluşturuldu.`;
  }

  async function handleSplit() {
    let start = parseInt(startPageInput.value);
    let end = parseInt(endPageInput.value);
    
    // Basit Validasyon
    if (isNaN(start) || isNaN(end) || start < 1 || end > totalReadPages || start > end) {
      alert(`Lütfen 1 ile ${totalReadPages} arasında geçerli bir sayfa aralığı girin.`);
      return;
    }

    const file = uploadedFiles[0];
    const fileBuffer = await file.arrayBuffer();
    const sourcePdf = await PDFDocument.load(fileBuffer);

    const newPdf = await PDFDocument.create();
    
    // pdf-lib Array indexleri 0'dan baslar. start: 1, end: 3 -> index 0,1,2
    const indicesToCopy = [];
    for (let i = start - 1; i < end; i++) {
      indicesToCopy.push(i);
    }

    const copiedPages = await newPdf.copyPages(sourcePdf, indicesToCopy);
    copiedPages.forEach((page) => newPdf.addPage(page));

    const newPdfBytes = await newPdf.save();
    downloadBlob(newPdfBytes, `ayrilmis-${start}-${end}.pdf`, 'application/pdf');

    reportBanner.innerText = `Başarı! ${indicesToCopy.length} sayfa söküldü ve yeni PDF oluşturuldu.`;
  }

  async function handleCompress() {
    const file = uploadedFiles[0];
    const origBytes = file.size;
    const fileBuffer = await file.arrayBuffer();
    const sourcePdf = await PDFDocument.load(fileBuffer);
    
    // Yapisal olarak yeniden olustur (Gereksiz objeleri ve metadataları atar)
    const newPdf = await PDFDocument.create();
    const copiedPages = await newPdf.copyPages(sourcePdf, sourcePdf.getPageIndices());
    copiedPages.forEach((page) => newPdf.addPage(page));
    
    // Obje streamleri ile sikistirarak kaydet
    const newPdfBytes = await newPdf.save({ useObjectStreams: true });
    const newBytesLength = newPdfBytes.byteLength;
    
    newSizeStr.innerText = formatBytes(newBytesLength);
    
    let diff = origBytes - newBytesLength;
    if (diff < 0) diff = 0;
    
    let percent = Math.round((diff / origBytes) * 100);
    
    reportBanner.style.display = 'block';
    if (percent > 0) {
      reportBanner.style.background = 'rgba(0,229,255,0.1)';
      reportBanner.style.border = '1px solid rgba(0,229,255,0.3)';
      reportBanner.style.color = 'var(--accent)';
      reportBanner.innerText = `Tasarruf: %${percent} (↓${formatBytes(diff)})\nYapısal gereksiz veriler temizlendi.`;
    } else {
      reportBanner.style.background = 'rgba(255,255,255,0.05)';
      reportBanner.style.border = '1px solid rgba(255,255,255,0.1)';
      reportBanner.style.color = 'var(--text-muted)';
      reportBanner.innerText = `Optimum Boyut (Sıkışma Yok).`;
    }
    
    downloadBlob(newPdfBytes, `kucultulmus-belge.pdf`, 'application/pdf');
  }

  function formatBytes(bytes, decimals = 2) {
    if (!+bytes) return '0 Bytes';
    const k = 1024;
    const dm = decimals < 0 ? 0 : decimals;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${parseFloat((bytes / Math.pow(k, i)).toFixed(dm))} ${sizes[i]}`;
  }

  function downloadBlob(byteData, fileName, mimeType) {
    const blob = new Blob([byteData], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    setTimeout(() => URL.revokeObjectURL(url), 100);
  }

});
