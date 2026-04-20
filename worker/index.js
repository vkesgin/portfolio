const CORS = (origin) => ({
  'Access-Control-Allow-Origin':  origin || '*',
  'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type,Authorization',
  'Access-Control-Max-Age':       '86400',
});

function json(data, status = 200, origin) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS(origin) }
  });
}

// JWT — Web Crypto API
async function signJWT(payload, secret) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  const header  = btoa(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body    = btoa(JSON.stringify({ ...payload, iat: Date.now() }));
  const sig     = await crypto.subtle.sign('HMAC', key, enc.encode(`${header}.${body}`));
  const sigB64  = btoa(String.fromCharCode(...new Uint8Array(sig)));
  return `${header}.${body}.${sigB64}`;
}

async function verifyJWT(token, secret) {
  try {
    const [header, body, sig] = token.split('.');
    const enc = new TextEncoder();
    const key = await crypto.subtle.importKey(
      'raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']
    );
    const sigBytes = Uint8Array.from(atob(sig), c => c.charCodeAt(0));
    const valid = await crypto.subtle.verify('HMAC', key, sigBytes, enc.encode(`${header}.${body}`));
    if (!valid) return null;
    return JSON.parse(atob(body));
  } catch { return null; }
}

function nanoid() {
  return crypto.randomUUID().replace(/-/g,'').slice(0,16);
}

async function authMiddleware(request, env) {
  const auth = request.headers.get('Authorization') || '';
  const token = auth.replace('Bearer ', '');
  if (!token) return null;
  return await verifyJWT(token, env.JWT_SECRET);
}

export default {
  async fetch(request, env) {
    const url    = new URL(request.url);
    const path   = url.pathname;
    const method = request.method;
    const origin = request.headers.get('Origin') || env.ALLOWED_ORIGIN;

    // CORS preflight
    if (method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS(origin) });
    }

    // === AUTH ===
    if (path === '/api/auth/login' && method === 'POST') {
      const { password } = await request.json().catch(() => ({}));
      if (!password || password !== env.ADMIN_PASSWORD) {
        return json({ error: 'Geçersiz şifre' }, 401, origin);
      }
      const token = await signJWT({ role: 'admin' }, env.JWT_SECRET);
      return json({ token }, 200, origin);
    }

    // === PUBLIC: Proje listesi ===
    if (path === '/api/projects' && method === 'GET') {
      const featured = url.searchParams.get('featured');
      const category = url.searchParams.get('category');
      let query = 'SELECT * FROM projects WHERE 1=1';
      const params = [];
      if (featured === '1') { query += ' AND is_featured=1 ORDER BY featured_order ASC'; }
      else { query += ' ORDER BY created_at DESC'; }
      if (category) { query = query.replace('WHERE 1=1', 'WHERE category=?'); params.push(category); }
      const { results } = await env.DB.prepare(query).bind(...params).all();
      return json(results, 200, origin);
    }

    // === PUBLIC: Tek proje ===
    if (path.match(/^\/api\/projects\/[^/]+$/) && method === 'GET') {
      const id = path.split('/').pop();
      const project = await env.DB.prepare('SELECT * FROM projects WHERE id=?').bind(id).first();
      if (!project) return json({ error: 'Bulunamadı' }, 404, origin);
      return json(project, 200, origin);
    }

    // === PUBLIC: Dosya serve ===
    if (path.startsWith('/files/')) {
      const key = path.replace('/files/', '');
      const obj = await env.STORAGE.get(key);
      if (!obj) return new Response('Not Found', { status: 404 });
      const headers = new Headers();
      obj.writeHttpMetadata(headers);
      headers.set('Cache-Control', 'public, max-age=31536000');
      headers.set('Access-Control-Allow-Origin', origin);
      return new Response(obj.body, { headers });
    }

    // === PROTECTED: Auth gerekli ===
    const user = await authMiddleware(request, env);
    if (!user) return json({ error: 'Yetkisiz' }, 401, origin);

    // === FITNESS API ===
    if (path === '/api/fitness' && method === 'GET') {
      const { results } = await env.DB.prepare('SELECT * FROM fitness_store').all();
      return json(results, 200, origin);
    }

    if (path === '/api/fitness' && method === 'POST') {
      const body = await request.json();
      const { key, value } = body;
      if (!key || !value) return json({ error: 'Eksik veri' }, 400, origin);
      
      await env.DB.prepare(`
        INSERT INTO fitness_store (key, value) VALUES (?, ?)
        ON CONFLICT(key) DO UPDATE SET value=excluded.value
      `).bind(key, value).run();
      
      return json({ ok: true }, 200, origin);
    }

    if (path === '/api/fitness' && method === 'DELETE') {
      const body = await request.json();
      const { key } = body;
      if (!key) return json({ error: 'Key gerekli' }, 400, origin);
      await env.DB.prepare('DELETE FROM fitness_store WHERE key=?').bind(key).run();
      return json({ ok: true }, 200, origin);
    }

    // Proje ekle
    if (path === '/api/projects' && method === 'POST') {
      const data = await request.json();
      const id   = nanoid();
      await env.DB.prepare(`
        INSERT INTO projects (id,title,category,description,tags,year,image_url,video_url,thumbnail_url,is_featured,featured_order)
        VALUES (?,?,?,?,?,?,?,?,?,?,?)
      `).bind(
        id, data.title, data.category,
        data.description || '', data.tags || '', data.year || new Date().getFullYear().toString(),
        data.image_url || '', data.video_url || '', data.thumbnail_url || '',
        data.is_featured ? 1 : 0, data.featured_order || 0
      ).run();
      const project = await env.DB.prepare('SELECT * FROM projects WHERE id=?').bind(id).first();
      return json(project, 201, origin);
    }

    // Proje güncelle
    if (path.match(/^\/api\/projects\/[^/]+$/) && method === 'PUT') {
      const id   = path.split('/').pop();
      const data = await request.json();
      await env.DB.prepare(`
        UPDATE projects SET
          title=?, category=?, description=?, tags=?, year=?,
          image_url=?, video_url=?, thumbnail_url=?,
          is_featured=?, featured_order=?
        WHERE id=?
      `).bind(
        data.title, data.category,
        data.description || '', data.tags || '', data.year || '',
        data.image_url || '', data.video_url || '', data.thumbnail_url || '',
        data.is_featured ? 1 : 0, data.featured_order || 0,
        id
      ).run();
      const project = await env.DB.prepare('SELECT * FROM projects WHERE id=?').bind(id).first();
      return json(project, 200, origin);
    }

    // Proje sil
    if (path.match(/^\/api\/projects\/[^/]+$/) && method === 'DELETE') {
      const id = path.split('/').pop();
      const project = await env.DB.prepare('SELECT * FROM projects WHERE id=?').bind(id).first();
      if (project) {
        // R2'den dosyaları sil
        if (project.image_url)   await env.STORAGE.delete(project.image_url.replace('/files/',''));
        if (project.video_url)   await env.STORAGE.delete(project.video_url.replace('/files/',''));
        if (project.thumbnail_url) await env.STORAGE.delete(project.thumbnail_url.replace('/files/',''));
      }
      await env.DB.prepare('DELETE FROM projects WHERE id=?').bind(id).run();
      return json({ ok: true }, 200, origin);
    }

    // Dosya yükle
    if (path === '/api/upload' && method === 'POST') {
      const form     = await request.formData();
      const file     = form.get('file');
      const fileType = form.get('type') || 'image';
      if (!file) return json({ error: 'Dosya yok' }, 400, origin);

      const ext      = file.name.split('.').pop().toLowerCase();
      const key      = `${fileType}s/${nanoid()}.${ext}`;
      const buffer   = await file.arrayBuffer();

      await env.STORAGE.put(key, buffer, {
        httpMetadata: { contentType: file.type },
      });

      const fileUrl = `/files/${key}`;
      return json({ url: fileUrl, key }, 201, origin);
    }

    return json({ error: 'Bulunamadı' }, 404, origin);
  }
};
