// Admin-only, stateless gateway. No D1, R2, KV, cache, history, or user accounts.
const PREFIX = '/api/admin/video';
const ID = /^[a-f0-9]{32}$/;
const QUALITY = new Set(['best', '2160', '1080', '720', '480', 'audio']);

export async function handleVideoDownloader(request, env, deps) {
  const url = new URL(request.url);
  if (url.pathname !== PREFIX && !url.pathname.startsWith(PREFIX + '/')) return null;
  const route = url.pathname.slice(PREFIX.length) || '/';
  const origin = request.headers.get('Origin');
  const expected = env.ALLOWED_ORIGIN || 'https://velikesgin.com';
  const allowed = new Set([expected]);
  try {
    const u = new URL(expected);
    if (u.hostname === 'velikesgin.com') allowed.add('https://www.velikesgin.com');
  } catch {}
  const headers = {
    'Cache-Control': 'no-store, private', 'Referrer-Policy': 'no-referrer',
    'X-Content-Type-Options': 'nosniff',
    'Access-Control-Allow-Origin': origin && allowed.has(origin) ? origin : expected,
    'Vary': 'Origin',
  };
  const json = (data, status = 200) => new Response(JSON.stringify(data), {status, headers:{...headers,'Content-Type':'application/json; charset=utf-8'}});
  if (origin && !allowed.has(origin)) return json({error:'Bu kaynaktan erişim desteklenmiyor.'},403);
  const configured = () => {
    try {
      const u = new URL(env.VIDEO_BACKEND_URL);
      return u.protocol === 'https:' && !u.username && !u.password && u.pathname === '/' && !u.search && !u.hash && String(env.VIDEO_BACKEND_TOKEN || '').length >= 32;
    } catch {return false;}
  };
  async function backend(path, {method = 'GET', data} = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 20000);
    try {
      const fetcher = deps.fetchImpl || ((...args) => fetch(...args));
      return await fetcher(new URL(path, env.VIDEO_BACKEND_URL).href, {
        method, headers:{Authorization:'Bearer '+env.VIDEO_BACKEND_TOKEN,...(data ? {'Content-Type':'application/json'} : {})},
        body:data ? JSON.stringify(data) : undefined, signal:controller.signal, redirect:'manual',
      });
    } finally {clearTimeout(timer);}
  }
  async function relay(path, options) {
    const res = await backend(path, options);
    const body = await res.json().catch(() => null);
    if (!body) return json({error:'İndirme motorundan yanıt alınamadı.'},502);
    // FastAPI validation errors must not echo the pasted URL or credentials.
    if (!res.ok) return json({error:typeof body.error === 'string' ? body.error : typeof body.detail === 'string' ? body.detail : 'İstek tamamlanamadı.'},res.status);
    return json(body,res.status);
  }
  try {
    if (route === '/file' && request.method === 'POST') {
      if (!configured() || !env.JWT_SECRET) return json({error:'İndirme motoru henüz bağlı değil.'},503);
      if (Number(request.headers.get('Content-Length') || 0) > 8192) return json({error:'İstek çok uzun.'},413);
      const type = request.headers.get('Content-Type') || '';
      if (!type.startsWith('application/x-www-form-urlencoded')) return json({error:'Geçersiz indirme isteği.'},400);
      const raw = await request.text();
      if (raw.length > 8192) return json({error:'İstek çok uzun.'},413);
      const ticket = new URLSearchParams(raw).get('ticket');
      const p = ticket ? await deps.verify(ticket,env.JWT_SECRET) : null;
      if (!p || p.scope !== 'video-download' || !ID.test(p.job || '') || !Number.isFinite(p.exp) || p.exp < Date.now() || p.exp > Date.now()+90000) return json({error:'İndirme bağlantısının süresi doldu. Tekrar “Cihaza kaydet”e bas.'},401);
      const res = await backend('/v1/files/'+p.job,{method:'POST'});
      if (!res.ok) {
        const error = await res.json().catch(()=>({}));
        return json({error:error.detail || error.error || 'Dosya hazır değil veya temizlendi.'},res.status);
      }
      const output = new Headers(headers);
      for (const name of ['Content-Type','Content-Length','Content-Disposition']) if (res.headers.has(name)) output.set(name,res.headers.get(name));
      output.set('Content-Security-Policy',"sandbox; default-src 'none'");
      return new Response(res.body,{status:200,headers:output});
    }
    const admin = await deps.authenticate(request,env);
    if (!admin || admin.role !== 'admin') return json({error:'Admin oturumu gerekli.'},401);
    if (route === '/config' && request.method === 'GET') return json({configured:configured(),retention_seconds:600,max_mb:1024});
    if (!configured()) return json({error:'İndirme motoru henüz bağlı değil. Sunucu bağlantısı tamamlandığında burada kullanabileceksin.'},503);
    if (request.method === 'POST') {
      if (Number(request.headers.get('Content-Length') || 0) > 16384) return json({error:'İstek çok uzun.'},413);
      const raw = await request.text();
      if (raw.length > 16384) return json({error:'İstek çok uzun.'},413);
      let data;
      try {data=JSON.parse(raw);} catch {return json({error:'Geçersiz istek.'},400);}
      if (route === '/analyze' || route === '/browser') {
        if (typeof data.url !== 'string' || data.url.length > 8192) return json({error:'Geçerli bir video bağlantısı gir.'},400);
        let parsed;
        try {parsed=new URL(data.url.trim());} catch {return json({error:'Geçerli bir video bağlantısı gir.'},400);}
        if (!['http:','https:'].includes(parsed.protocol) || parsed.username || parsed.password) return json({error:'Geçerli bir http(s) bağlantısı gir.'},400);
        if (!['analyze','scan'].includes(data.mode || 'analyze')) return json({error:'Geçersiz tespit yöntemi.'},400);
        return await relay(route === '/browser' ? '/v1/browser' : '/v1/analyze',{method:'POST',data:{url:parsed.href,mode:data.mode || 'analyze'}});
      }
      const browserAction = route.match(/^\/browser\/([a-f0-9]{32})\/action$/);
      if (browserAction) {
        if (!['frame','click','scroll','text','key','back','reload'].includes(data.action)) return json({error:'Geçersiz tarayıcı kontrolü.'},400);
        return await relay('/v1/browser/'+browserAction[1]+'/action',{method:'POST',data});
      }
      if (route === '/download') {
        if (!ID.test(data.source_id || '') || !QUALITY.has(data.quality || 'best')) return json({error:'Geçersiz video veya kalite.'},400);
        return await relay('/v1/download',{method:'POST',data:{source_id:data.source_id,quality:data.quality || 'best'}});
      }
      if (route === '/ticket') {
        if (!ID.test(data.job_id || '') || !env.JWT_SECRET) return json({error:'Geçersiz işlem.'},400);
        const ready = await backend('/v1/jobs/'+data.job_id);
        const job = await ready.json();
        if (!ready.ok || job.status !== 'ready') return json({error:'Dosya henüz hazır değil veya temizlendi.'},410);
        return json({ticket:await deps.sign({scope:'video-download',job:data.job_id,exp:Date.now()+90000},env.JWT_SECRET)});
      }
    }
    const match = route.match(/^\/jobs\/([a-f0-9]{32})$/);
    if (match && ['GET','DELETE'].includes(request.method)) return await relay('/v1/jobs/'+match[1],{method:request.method});
    return json({error:'Bulunamadı.'},404);
  } catch {
    // Never print pasted links, cookies, signed media URLs, or API credentials.
    return json({error:'İndirme sunucusuna ulaşılamıyor. Biraz sonra tekrar dene.'},502);
  }
}
