/* No localStorage, IndexedDB, saved links, analytics, or extra account. */
(() => {
  'use strict';
  const $ = id => document.getElementById('vkd-'+id);
  if (!$('form')) return;
  let current = null, generation = 0, timer = null, autoSave = false;
  const jobs = new Set();
  const endpoint = () => API + '/api/admin/video';
  const size = n => n ? (n / 1024 / 1024).toFixed(1)+' MB' : '';
  const duration = n => n ? Math.floor(n / 60)+':'+String(Math.floor(n % 60)).padStart(2,'0') : '';
  async function api(path, data, method) {
    const response = await fetch(endpoint()+path, {
      method:method || (data === undefined ? 'GET':'POST'), cache:'no-store',
      headers:{Authorization:'Bearer '+TOKEN,...(data === undefined ? {}:{'Content-Type':'application/json'})},
      body:data === undefined ? undefined:JSON.stringify(data),
    });
    const value = await response.json();
    if (!response.ok) throw new Error(value.error || 'İşlem tamamlanamadı.');
    return value;
  }
  function busy(value) {
    $('submit').disabled=value;
    $('scan').disabled=value;
  }
  function status(title, message, error=false) {
    $('empty').hidden=true;
    $('result').hidden=false;
    $('result').dataset.error=String(error);
    $('result-title').textContent=title;
    $('status').textContent=message;
  }
  async function clear({blank=false}={}) {
    generation++;autoSave=false;
    clearTimeout(timer);
    const existing=[...jobs];jobs.clear();current=null;
    $('choices').replaceChildren();$('save').hidden=true;$('file').disabled=false;
    $('caption').textContent='';$('result').hidden=true;$('empty').hidden=false;
    $('progress').hidden=false;$('progress').firstElementChild.style.width='0%';busy(false);
    if(blank)$('url').value='';
    await Promise.allSettled(existing.map(id=>api('/jobs/'+id,undefined,'DELETE')));
  }
  function choices(items) {
    $('choices').replaceChildren();
    const available=items.filter(v=>!v.ad);
    if(!available.length){status('Video bulunamadı','Bulunan akışlar reklam işaretleri taşıyor. Ana video bağlantısını dene.',true);return;}
    for (const video of available) {
      const row=document.createElement('div');row.className='vkd-choice';
      const info=document.createElement('div');info.className='vkd-choice-info';
      const title=document.createElement('p');title.className='vkd-choice-title';title.textContent=video.title;
      const meta=document.createElement('p');meta.className='vkd-choice-meta';
      meta.textContent=[video.provider,duration(video.duration),video.heights?.length ? Math.max(...video.heights)+'p':'',size(video.size)].filter(Boolean).join(' · ');
      info.append(title,meta);
      const button=document.createElement('button');button.type='button';button.textContent='Hazırla ↙';
      button.addEventListener('click',()=>download(video.id,video.title));
      row.append(info,button);$('choices').append(row);
    }
  }
  async function poll(id, epoch) {
    if(epoch!==generation)return;
    try {
      const job=await api('/jobs/'+id);
      if(epoch!==generation)return;
      current=id;
      status(job.title || 'Video',job.message || 'İşleniyor…',job.status==='error');
      const percent=Number.isFinite(job.progress) ? Math.max(0,Math.min(100,job.progress)):0;
      $('progress').firstElementChild.style.width=percent+'%';
      if(job.status==='running') {timer=setTimeout(()=>poll(id,epoch),1200);return;}
      busy(false);$('progress').hidden=true;
      if(job.status==='choices') {
        const found=job.choices || [];
        const one=found.length===1 && !found[0].ad ? found[0]:null;
        const direct=/\.(mp4|webm|mov|mkv|m3u8|mpd)(?:[?#]|$)/i.test($('url').value);
        if(one && (direct || !/generic|^web$/i.test(one.provider || 'Web'))) {
          await download(one.id,one.title);return;
        }
        choices(found);
      }
      if(job.status==='ready') {
        $('save').hidden=false;
        $('caption').textContent=[size(job.bytes),'Aktarımdan sonra geçici dosya silinir. Kaydetmezsen 10 dakika içinde temizlenir.'].filter(Boolean).join(' · ');
        if(autoSave){autoSave=false;$('file').click();}
      }
    } catch(error) {
      if(epoch!==generation)return;
      busy(false);$('progress').hidden=true;status('İşlem tamamlanamadı',error.message,true);
    }
  }
  async function analyze(mode) {
    const link=$('url').value.trim();
    try {const p=new URL(link);if(!['http:','https:'].includes(p.protocol))throw 0;}catch{status('Bağlantıyı kontrol et','http:// veya https:// ile başlayan video bağlantısını yapıştır.',true);return;}
    await clear();
    const epoch=generation;autoSave=true;busy(true);status('Video aranıyor',mode==='scan'?'Sayfa geçici tarayıcıda inceleniyor…':'Video bağlantısı inceleniyor…');
    try {
      const job=await api('/analyze',{url:link,mode});
      jobs.add(job.id);
      if(epoch!==generation){await api('/jobs/'+job.id,undefined,'DELETE');return;}
      current=job.id;await poll(job.id,epoch);
    }catch(error){if(epoch===generation){busy(false);$('progress').hidden=true;status('Video alınamadı',error.message,true);}}
  }
  async function download(source_id,title) {
    const epoch=++generation;autoSave=true;clearTimeout(timer);busy(true);
    $('choices').replaceChildren();$('save').hidden=true;$('progress').hidden=false;
    status(title,'Video indirilmeye hazırlanıyor…');
    try {
      const job=await api('/download',{source_id,quality:$('quality').value});jobs.add(job.id);
      if(epoch!==generation){await api('/jobs/'+job.id,undefined,'DELETE');return;}
      current=job.id;await poll(job.id,epoch);
    }catch(error){if(epoch===generation){busy(false);$('progress').hidden=true;status('İndirme hazırlanamadı',error.message,true);}}
  }
  $('form').addEventListener('submit',event=>{event.preventDefault();analyze('analyze');});
  $('scan').addEventListener('click',()=>analyze('scan'));
  $('cancel').addEventListener('click',()=>clear({blank:true}));
  $('paste').addEventListener('click',async()=>{
    try{$('url').value=(await navigator.clipboard.readText()).trim();$('url').focus();}
    catch{status('Bağlantını yapıştır','Panoya erişilemedi. Bağlantıyı alana elle yapıştırabilirsin.');$('url').focus();}
  });
  $('file').addEventListener('click',async()=>{
    if(!current)return;
    const id=current;const epoch=generation;$('file').disabled=true;
    try {
      const {ticket}=await api('/ticket',{job_id:id});
      if(epoch!==generation)return;
      const form=document.createElement('form');form.method='POST';form.action=endpoint()+'/file';form.target='vkd-transfer';form.hidden=true;
      const input=document.createElement('input');input.name='ticket';input.value=ticket;form.append(input);document.body.append(form);form.submit();form.remove();
      $('status').textContent='Dosya tarayıcına gönderiliyor. İndirme durumunu tarayıcının indirmeler bölümünden takip edebilirsin.';
      $('caption').textContent='Yeni video için “Temizle”ye bas. Aktarım tamamlandığında sunucudaki geçici dosya silinir.';
      setTimeout(async()=>{
        if(epoch!==generation)return;
        try{
          const check=await api('/jobs/'+id);
          if(check.status==='ready'){
            $('file').disabled=false;
            $('status').textContent='Video hazır. Tarayıcın otomatik indirmeyi başlatmadıysa “Cihaza kaydet”e bas.';
          }
        }catch{}
      },3500);
    }catch(error){$('file').disabled=false;status('Dosya alınamadı',error.message,true);}
  });
  document.getElementById('logoutBtn')?.addEventListener('click',()=>clear({blank:true}),true);
  window.addEventListener('pagehide',()=>{
    const authorization='Bearer '+TOKEN;
    for(const id of jobs)fetch(endpoint()+'/jobs/'+id,{method:'DELETE',headers:{Authorization:authorization},keepalive:true}).catch(()=>{});
  });
})();
