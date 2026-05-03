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

// KPSS JWT helpers
async function signKpssJWT(payload, secret) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw', enc.encode(secret + '_kpss'), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  const header = btoa(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body   = btoa(JSON.stringify({ ...payload, iat: Date.now() }));
  const sig    = await crypto.subtle.sign('HMAC', key, enc.encode(`${header}.${body}`));
  return `${header}.${body}.${btoa(String.fromCharCode(...new Uint8Array(sig)))}`;
}
async function verifyKpssJWT(token, secret) {
  try {
    const [header, body, sig] = token.split('.');
    const enc = new TextEncoder();
    const key = await crypto.subtle.importKey(
      'raw', enc.encode(secret + '_kpss'), { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']
    );
    const valid = await crypto.subtle.verify('HMAC', key,
      Uint8Array.from(atob(sig), c => c.charCodeAt(0)),
      enc.encode(`${header}.${body}`)
    );
    if (!valid) return null;
    return JSON.parse(atob(body));
  } catch { return null; }
}
async function kpssAuth(request, env) {
  const token = (request.headers.get('Authorization') || '').replace('Bearer ', '');
  if (!token) return null;
  return verifyKpssJWT(token, env.JWT_SECRET);
}

export default {
  async fetch(request, env) {
    const url    = new URL(request.url);
    const path   = url.pathname;
    const method = request.method;
    const origin = request.headers.get('Origin') || env.ALLOWED_ORIGIN;

    // CORS preflight
    if (method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type,Authorization',
          'Access-Control-Max-Age': '86400',
        }
      });
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

      const baseHeaders = new Headers();
      obj.writeHttpMetadata(baseHeaders);
      baseHeaders.set('Cache-Control', 'public, max-age=31536000');
      baseHeaders.set('Access-Control-Allow-Origin', origin);
      baseHeaders.set('Accept-Ranges', 'bytes');
      if (obj.size != null) baseHeaders.set('Content-Length', String(obj.size));

      // Range request — video seeking/streaming icin kritik
      const rangeHeader = request.headers.get('Range');
      if (rangeHeader && obj.size) {
        const match = rangeHeader.match(/bytes=(\d+)-(\d*)/);
        if (match) {
          const start = parseInt(match[1]);
          const end   = match[2] ? parseInt(match[2]) : obj.size - 1;
          const clampedEnd = Math.min(end, obj.size - 1);
          const rangedObj = await env.STORAGE.get(key, {
            range: { offset: start, length: clampedEnd - start + 1 }
          });
          if (rangedObj) {
            const rh = new Headers(baseHeaders);
            rh.set('Content-Range',  `bytes ${start}-${clampedEnd}/${obj.size}`);
            rh.set('Content-Length', String(clampedEnd - start + 1));
            return new Response(rangedObj.body, { status: 206, headers: rh });
          }
        }
      }

      return new Response(obj.body, { headers: baseHeaders });
    }

    // === PUBLIC: Key-Value (Ayarlar) ===
    if (path === '/api/fitness' && method === 'GET') {
      const { results } = await env.DB.prepare('SELECT * FROM fitness_store').all();
      return json(results, 200, origin);
    }

// ─── KPSS ROUTES ───
if (path.startsWith('/api/kpss')) {

  // KAYIT OL
  if (path === '/api/kpss/register' && method === 'POST') {
    const { username, password, full_name, exam_name, exam_date } = await request.json().catch(() => ({}));
    if (!username || !password || !exam_date) return json({ error: 'Eksik bilgi' }, 400, origin);
    const exists = await env.DB.prepare('SELECT id FROM kpss_users WHERE username=?').bind(username).first();
    if (exists) return json({ error: 'Bu kullanıcı adı alınmış' }, 409, origin);
    const { success } = await env.DB.prepare(
      'INSERT INTO kpss_users (username,password,full_name,exam_name,exam_date) VALUES (?,?,?,?,?)'
    ).bind(username, password, full_name||'', exam_name||'KPSS', exam_date).run();
    if (!success) return json({ error: 'Kayıt hatası' }, 500, origin);
    const user = await env.DB.prepare('SELECT * FROM kpss_users WHERE username=?').bind(username).first();
    // Varsayılan hocaları ekle
    const teachers = [
      [user.id,'Matematik','Mehmet Bilge YILDIZ','https://www.youtube.com/playlist?list=PL8xiaE-wCWlYAj1jWjyNJzKBGLVZjwPOm'],
      [user.id,'Tarih','Ramazan YETGİN','https://www.youtube.com/watch?v=atJmg95Tj2c'],
      [user.id,'Türkçe','Öznur Saat YILDIRIM','https://www.youtube.com/watch?v=52SNuDuWvW8'],
    ];
    for (const t of teachers) {
      await env.DB.prepare('INSERT INTO kpss_teachers (user_id,lesson_name,teacher_name,youtube_url) VALUES (?,?,?,?)').bind(...t).run();
    }
    const token = await signKpssJWT({ userId: user.id, username: user.username }, env.JWT_SECRET);
    return json({ token, user: { id:user.id, username:user.username, full_name:user.full_name, exam_name:user.exam_name, exam_date:user.exam_date, xp:user.xp } }, 201, origin);
  }

  // GİRİŞ YAP
  if (path === '/api/kpss/login' && method === 'POST') {
    const { username, password } = await request.json().catch(() => ({}));
    if (!username || !password) return json({ error: 'Eksik bilgi' }, 400, origin);
    const user = await env.DB.prepare('SELECT * FROM kpss_users WHERE username=? AND password=?').bind(username, password).first();
    if (!user) return json({ error: 'Hatalı kullanıcı adı veya şifre' }, 401, origin);
    const token = await signKpssJWT({ userId: user.id, username: user.username }, env.JWT_SECRET);
    return json({ token, user: { id:user.id, username:user.username, full_name:user.full_name, exam_name:user.exam_name, exam_date:user.exam_date, xp:user.xp } }, 200, origin);
  }

  // Aşağısı auth gerektirir
  const kpssUser = await kpssAuth(request, env);
  if (!kpssUser) return json({ error: 'Yetkisiz' }, 401, origin);
  const uid = kpssUser.userId;

  // ─── GÜNLÜK PLANLAR ───
  if (path === '/api/kpss/plans' && method === 'GET') {
    const date = url.searchParams.get('date');
    let q = 'SELECT * FROM kpss_daily_plans WHERE user_id=?';
    const params = [uid];
    if (date) { q += ' AND date=?'; params.push(date); }
    q += ' ORDER BY date ASC, id ASC';
    const { results } = await env.DB.prepare(q).bind(...params).all();
    return json(results, 200, origin);
  }

  if (path === '/api/kpss/plans' && method === 'POST') {
    const d = await request.json();
    const { meta } = await env.DB.prepare(
      'INSERT INTO kpss_daily_plans (user_id,date,lesson_name,topic_name,target_question_count,solved_question_count,status,is_video_watched) VALUES (?,?,?,?,?,?,?,?)'
    ).bind(uid, d.date, d.lesson_name||'', d.topic_name||'', d.target_question_count||50, 0, 'Planlandı', 0).run();
    const row = await env.DB.prepare('SELECT * FROM kpss_daily_plans WHERE id=?').bind(meta.last_row_id).first();
    return json(row, 201, origin);
  }

  if (path.match(/^\/api\/kpss\/plans\/\d+$/) && method === 'PUT') {
    const id = path.split('/').pop();
    const d = await request.json();
    // XP hesapla
    const existing = await env.DB.prepare('SELECT * FROM kpss_daily_plans WHERE id=? AND user_id=?').bind(id, uid).first();
    let xpGain = 0;
    const wasCompleted = existing?.status === 'Tamamlandı';
    const isNowCompleted = d.is_video_watched && d.solved_question_count >= (existing?.target_question_count || 0);
    if (!wasCompleted && isNowCompleted) xpGain = 50;

    await env.DB.prepare(
      'UPDATE kpss_daily_plans SET lesson_name=?,topic_name=?,target_question_count=?,solved_question_count=?,status=?,is_video_watched=?,date=? WHERE id=? AND user_id=?'
    ).bind(d.lesson_name||'', d.topic_name||'', d.target_question_count||50, d.solved_question_count||0,
      isNowCompleted ? 'Tamamlandı' : 'Planlandı', d.is_video_watched?1:0, d.date||existing?.date, id, uid).run();

    if (xpGain > 0) {
      await env.DB.prepare('UPDATE kpss_users SET xp=xp+? WHERE id=?').bind(xpGain, uid).run();
    }
    const updated = await env.DB.prepare('SELECT * FROM kpss_daily_plans WHERE id=?').bind(id).first();
    const userRow = await env.DB.prepare('SELECT xp FROM kpss_users WHERE id=?').bind(uid).first();
    return json({ plan: updated, xp: userRow?.xp, xpGain }, 200, origin);
  }

  if (path.match(/^\/api\/kpss\/plans\/\d+$/) && method === 'DELETE') {
    const id = path.split('/').pop();
    await env.DB.prepare('DELETE FROM kpss_daily_plans WHERE id=? AND user_id=?').bind(id, uid).run();
    return json({ ok: true }, 200, origin);
  }

  // ─── ÖĞRETMENLER ───
  if (path === '/api/kpss/teachers' && method === 'GET') {
    const { results } = await env.DB.prepare('SELECT * FROM kpss_teachers WHERE user_id=? ORDER BY lesson_name').bind(uid).all();
    return json(results, 200, origin);
  }

  if (path === '/api/kpss/teachers' && method === 'POST') {
    const d = await request.json();
    const { meta } = await env.DB.prepare(
      'INSERT INTO kpss_teachers (user_id,lesson_name,teacher_name,youtube_url) VALUES (?,?,?,?)'
    ).bind(uid, d.lesson_name||'', d.teacher_name||'', d.youtube_url||'').run();
    const row = await env.DB.prepare('SELECT * FROM kpss_teachers WHERE id=?').bind(meta.last_row_id).first();
    return json(row, 201, origin);
  }

  if (path.match(/^\/api\/kpss\/teachers\/\d+$/) && method === 'DELETE') {
    const id = path.split('/').pop();
    await env.DB.prepare('DELETE FROM kpss_teachers WHERE id=? AND user_id=?').bind(id, uid).run();
    return json({ ok: true }, 200, origin);
  }

  // ─── DENEME SINAVLARI ───
  if (path === '/api/kpss/exams' && method === 'GET') {
    const { results } = await env.DB.prepare(
      'SELECT * FROM kpss_trial_exams WHERE user_id=? ORDER BY exam_date DESC, id DESC'
    ).bind(uid).all();
    return json(results, 200, origin);
  }

  if (path === '/api/kpss/exams' && method === 'POST') {
    const d = await request.json();
    const { meta } = await env.DB.prepare(
      'INSERT INTO kpss_trial_exams (user_id,lesson,exam_name,exam_date,correct_count,incorrect_count) VALUES (?,?,?,?,?,?)'
    ).bind(uid, d.lesson||'GENEL DENEME', d.exam_name||'', d.exam_date||new Date().toISOString().split('T')[0], d.correct_count||0, d.incorrect_count||0).run();
    const row = await env.DB.prepare('SELECT * FROM kpss_trial_exams WHERE id=?').bind(meta.last_row_id).first();
    return json(row, 201, origin);
  }

  if (path.match(/^\/api\/kpss\/exams\/\d+$/) && method === 'DELETE') {
    const id = path.split('/').pop();
    await env.DB.prepare('DELETE FROM kpss_trial_exams WHERE id=? AND user_id=?').bind(id, uid).run();
    return json({ ok: true }, 200, origin);
  }

  // ─── YAPIŞKAN NOT ───
  if (path === '/api/kpss/note' && method === 'GET') {
    const row = await env.DB.prepare('SELECT * FROM kpss_sticky_notes WHERE user_id=?').bind(uid).first();
    return json({ content: row?.content || '' }, 200, origin);
  }

  if (path === '/api/kpss/note' && method === 'PUT') {
    const { content } = await request.json();
    const exists = await env.DB.prepare('SELECT id FROM kpss_sticky_notes WHERE user_id=?').bind(uid).first();
    if (exists) {
      await env.DB.prepare('UPDATE kpss_sticky_notes SET content=?,updated_at=datetime(\'now\') WHERE user_id=?').bind(content||'', uid).run();
    } else {
      await env.DB.prepare('INSERT INTO kpss_sticky_notes (user_id,content) VALUES (?,?)').bind(uid, content||'').run();
    }
    return json({ ok: true }, 200, origin);
  }

  // ─── STATS (Dashboard için) ───
  if (path === '/api/kpss/stats' && method === 'GET') {
    const user = await env.DB.prepare('SELECT * FROM kpss_users WHERE id=?').bind(uid).first();
    const totalSolved = await env.DB.prepare('SELECT SUM(solved_question_count) as total FROM kpss_daily_plans WHERE user_id=?').bind(uid).first();
    const completed   = await env.DB.prepare('SELECT COUNT(*) as cnt FROM kpss_daily_plans WHERE user_id=? AND status=\'Tamamlandı\'').bind(uid).first();
    const totalPlans  = await env.DB.prepare('SELECT COUNT(*) as cnt FROM kpss_daily_plans WHERE user_id=?').bind(uid).first();
    const today = new Date().toISOString().split('T')[0];
    const { results: todayPlans } = await env.DB.prepare('SELECT * FROM kpss_daily_plans WHERE user_id=? AND date=?').bind(uid, today).all();
    const { results: teachers }   = await env.DB.prepare('SELECT * FROM kpss_teachers WHERE user_id=?').bind(uid).all();
    const note = await env.DB.prepare('SELECT content FROM kpss_sticky_notes WHERE user_id=?').bind(uid).first();

    // Heatmap — son 28 gün
    const heatmap = [];
    for (let i = 27; i >= 0; i--) {
      const d = new Date(); d.setDate(d.getDate() - i);
      const dateStr = d.toISOString().split('T')[0];
      const act = await env.DB.prepare(
        'SELECT COUNT(*) as cnt FROM kpss_daily_plans WHERE user_id=? AND date=? AND (is_video_watched=1 OR solved_question_count>0)'
      ).bind(uid, dateStr).first();
      heatmap.push({ date: dateStr, day: d.getDate(), count: act?.cnt || 0 });
    }

    return json({
      user: { id:user.id, username:user.username, full_name:user.full_name, exam_name:user.exam_name, exam_date:user.exam_date, xp:user.xp },
      totalSolved: totalSolved?.total || 0,
      completedCount: completed?.cnt || 0,
      totalPlans: totalPlans?.cnt || 0,
      todayPlans,
      teachers,
      note: note?.content || '',
      heatmap
    }, 200, origin);
  }

  // ─── AYARLAR ───
  if (path === '/api/kpss/settings' && method === 'PUT') {
    const { exam_name, exam_date } = await request.json();
    await env.DB.prepare('UPDATE kpss_users SET exam_name=?,exam_date=? WHERE id=?').bind(exam_name||'KPSS', exam_date, uid).run();
    const user = await env.DB.prepare('SELECT * FROM kpss_users WHERE id=?').bind(uid).first();
    return json({ user }, 200, origin);
  }

  if (path === '/api/kpss/user' && method === 'DELETE') {
    const { password } = await request.json();
    const user = await env.DB.prepare('SELECT * FROM kpss_users WHERE id=? AND password=?').bind(uid, password).first();
    if (!user) return json({ error: 'Hatalı şifre' }, 401, origin);
    await env.DB.prepare('DELETE FROM kpss_daily_plans WHERE user_id=?').bind(uid).run();
    await env.DB.prepare('DELETE FROM kpss_teachers WHERE user_id=?').bind(uid).run();
    await env.DB.prepare('DELETE FROM kpss_trial_exams WHERE user_id=?').bind(uid).run();
    await env.DB.prepare('DELETE FROM kpss_sticky_notes WHERE user_id=?').bind(uid).run();
    await env.DB.prepare('DELETE FROM kpss_users WHERE id=?').bind(uid).run();
    return json({ ok: true }, 200, origin);
  }
}
// ─── KPSS ROUTES SONU ───

    // === PROTECTED: Auth gerekli ===
    const user = await authMiddleware(request, env);
    if (!user) return json({ error: 'Yetkisiz' }, 401, origin);

    // === FITNESS / SETTINGS API (POST/DELETE) ===

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
