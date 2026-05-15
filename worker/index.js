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
  return await verifyJWT(token, env.JWT_SECRET || 'secret');
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
  return verifyKpssJWT(token, env.JWT_SECRET || 'secret');
}

// Inspire JWT helpers
async function signInspireJWT(payload, secret) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw', enc.encode(secret + '_inspire'), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  const header = btoa(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body   = btoa(JSON.stringify({ ...payload, iat: Date.now() }));
  const sig    = await crypto.subtle.sign('HMAC', key, enc.encode(`${header}.${body}`));
  return `${header}.${body}.${btoa(String.fromCharCode(...new Uint8Array(sig)))}`;
}
async function verifyInspireJWT(token, secret) {
  try {
    const [header, body, sig] = token.split('.');
    const enc = new TextEncoder();
    const key = await crypto.subtle.importKey(
      'raw', enc.encode(secret + '_inspire'), { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']
    );
    const valid = await crypto.subtle.verify('HMAC', key,
      Uint8Array.from(atob(sig), c => c.charCodeAt(0)),
      enc.encode(`${header}.${body}`)
    );
    if (!valid) return null;
    return JSON.parse(atob(body));
  } catch { return null; }
}
async function inspireAuth(request, env) {
  const token = (request.headers.get('Authorization') || '').replace('Bearer ', '');
  if (!token) return null;
  return verifyInspireJWT(token, env.JWT_SECRET || 'secret');
}

// UI JWT helpers
async function signUiJWT(payload, secret) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw', enc.encode(secret + '_ui'), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  const header = btoa(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body   = btoa(JSON.stringify({ ...payload, iat: Date.now() }));
  const sig    = await crypto.subtle.sign('HMAC', key, enc.encode(`${header}.${body}`));
  return `${header}.${body}.${btoa(String.fromCharCode(...new Uint8Array(sig)))}`;
}
async function verifyUiJWT(token, secret) {
  try {
    const [header, body, sig] = token.split('.');
    const enc = new TextEncoder();
    const key = await crypto.subtle.importKey(
      'raw', enc.encode(secret + '_ui'), { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']
    );
    const valid = await crypto.subtle.verify('HMAC', key,
      Uint8Array.from(atob(sig), c => c.charCodeAt(0)),
      enc.encode(`${header}.${body}`)
    );
    if (!valid) return null;
    return JSON.parse(atob(body));
  } catch { return null; }
}
async function uiAuth(request, env) {
  const authHeader = request.headers.get('Authorization') || '';
  if (!authHeader.toLowerCase().startsWith('bearer ')) return null;
  const token = authHeader.split(' ')[1];
  if (!token) return null;
  try {
    return await verifyUiJWT(token, env.JWT_SECRET || 'secret');
  } catch (e) {
    return null;
  }
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
      const params = [];
      let query;

      if (category) {
        // Belirli bir kategori isteniyorsa sadece onu döndür
        query = 'SELECT * FROM projects WHERE category=?';
        params.push(category);
        if (featured === '1') query += ' AND is_featured=1 ORDER BY featured_order ASC';
        else query += ' ORDER BY created_at DESC';
      } else {
        // Genel liste: uilib ve 3dcube özel kategorileri hariç tut
        query = "SELECT * FROM projects WHERE category NOT IN ('uilib','3dcube')";
        if (featured === '1') query += ' AND is_featured=1 ORDER BY featured_order ASC';
        else query += ' ORDER BY created_at DESC';
      }

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
      // PUBLIC dosyalar — tüm originlere izin ver (CORS bloğunu önler)
      baseHeaders.set('Access-Control-Allow-Origin', '*');
      baseHeaders.set('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
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

    const cleanPath = path.replace(/\/$/, '');

    // === ADMIN: KPSS KULLANICI YÖNETİMİ ===
    if (cleanPath === '/api/admin/kpss-users' && method === 'GET') {
      const admin = await authMiddleware(request, env);
      if (!admin) return json({ error: 'Yetkisiz' }, 401, origin);
      const { results } = await env.DB.prepare('SELECT id, username, full_name, created_at FROM kpss_users ORDER BY id DESC').all();
      return json(results, 200, origin);
    }
    if (cleanPath === '/api/admin/kpss-users' && method === 'POST') {
      const admin = await authMiddleware(request, env);
      if (!admin) return json({ error: 'Yetkisiz' }, 401, origin);
      const d = await request.json();
      if (!d.username || !d.password) return json({ error: 'Kullanıcı adı ve şifre zorunlu' }, 400, origin);
      const todayDate = new Date().toISOString().split('T')[0];
      try {
        await env.DB.prepare('INSERT INTO kpss_users (username, password, full_name, exam_name, exam_date) VALUES (?, ?, ?, ?, ?)').bind(d.username, d.password, d.full_name || '', 'KPSS', todayDate).run();
          await env.DB.prepare(`
          CREATE TABLE IF NOT EXISTS inspire_notes (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            post_id INTEGER NOT NULL,
            user_id INTEGER NOT NULL,
            content TEXT NOT NULL,
            is_public INTEGER DEFAULT 0,
            created_at TEXT DEFAULT (datetime('now')),
            FOREIGN KEY(post_id) REFERENCES inspire_posts(id) ON DELETE CASCADE,
            FOREIGN KEY(user_id) REFERENCES inspire_users(id) ON DELETE CASCADE
          )
        `).run();
        return json({ ok: true }, 201, origin);
      } catch(e) {
        return json({ error: 'Kullanıcı zaten var veya DB hatası' }, 400, origin);
      }
    }
    if (cleanPath.match(/^\/api\/admin\/kpss-users\/\d+$/) && method === 'DELETE') {
      const admin = await authMiddleware(request, env);
      if (!admin) return json({ error: 'Yetkisiz' }, 401, origin);
      const id = cleanPath.split('/').pop();
      await env.DB.prepare('DELETE FROM kpss_users WHERE id=?').bind(id).run();
      return json({ ok: true }, 200, origin);
    }

// ─── KPSS ROUTES ───
if (path.startsWith('/api/kpss')) {

  // GİRİŞ YAP
  if (path === '/api/kpss/login' && method === 'POST') {
    const { username, password } = await request.json().catch(() => ({}));
    if (!username || !password) return json({ error: 'Kullanıcı adı ve şifre gereklidir' }, 401, origin);
    
    if (username === 'vkesgin38' && password === env.ADMIN_PASSWORD) {
       const oldAdmin = await env.DB.prepare("SELECT * FROM kpss_users WHERE username='admin'").first();
       if (oldAdmin) {
          await env.DB.prepare("UPDATE kpss_users SET username='vkesgin38', full_name='Veli Kesgin', password=? WHERE username='admin'").bind(password).run();
       } else {
          const exists = await env.DB.prepare("SELECT * FROM kpss_users WHERE username='vkesgin38'").first();
          if (!exists) {
            const todayDate = new Date().toISOString().split('T')[0];
            await env.DB.prepare("INSERT INTO kpss_users (username,password,full_name,exam_name,exam_date) VALUES ('vkesgin38',?,'Veli Kesgin','KPSS',?)").bind(password, todayDate).run();
          }
       }
    }
    
    let user = await env.DB.prepare("SELECT * FROM kpss_users WHERE username=? AND password=?").bind(username, password).first();
    if (!user) return json({ error: 'Hatalı kullanıcı adı veya şifre' }, 401, origin);

    if (user.username === 'vkesgin38' && user.full_name === 'Admin') {
       await env.DB.prepare("UPDATE kpss_users SET full_name='Veli Kesgin' WHERE username='vkesgin38'").run();
       user.full_name = 'Veli Kesgin';
    }

    const token = await signKpssJWT({ userId: user.id, username: user.username }, env.JWT_SECRET || 'secret');
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

  if (path.match(/^\/api\/kpss\/teachers\/\d+$/) && method === 'PUT') {
    const id = path.split('/').pop();
    const d = await request.json();
    await env.DB.prepare(
      'UPDATE kpss_teachers SET lesson_name=?, teacher_name=?, youtube_url=? WHERE id=? AND user_id=?'
    ).bind(d.lesson_name||'', d.teacher_name||'', d.youtube_url||'', id, uid).run();
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
// === INSPIRE ROUTES ===
    // 1. Table Init
    if (path === '/api/inspire/init' && method === 'GET') {
      try {
        await env.DB.prepare(`
          CREATE TABLE IF NOT EXISTS inspire_users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT UNIQUE NOT NULL,
            password TEXT NOT NULL,
            full_name TEXT DEFAULT '',
            created_at TEXT DEFAULT (datetime('now'))
          )
        `).run();
        try { await env.DB.prepare('ALTER TABLE inspire_users ADD COLUMN is_first_login INTEGER DEFAULT 1').run(); } catch(e) {}
        await env.DB.prepare(`
          CREATE TABLE IF NOT EXISTS inspire_posts (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            type TEXT NOT NULL, 
            url TEXT NOT NULL,
            description TEXT DEFAULT '',
            created_at TEXT DEFAULT (datetime('now')),
            FOREIGN KEY(user_id) REFERENCES inspire_users(id) ON DELETE CASCADE
          )
        `).run();
        return json({ok: true}, 200, origin);
      } catch(e) {
        return json({error: e.message}, 500, origin);
      }
    }

    // 2. Admin User Management
    if (cleanPath === '/api/admin/inspire-users' && method === 'GET') {
      const admin = await authMiddleware(request, env);
      if (!admin) return json({ error: 'Yetkisiz' }, 401, origin);
      const { results } = await env.DB.prepare('SELECT id, username, full_name, created_at, password FROM inspire_users ORDER BY id DESC').all();
      return json(results, 200, origin);
    }
    if (cleanPath === '/api/admin/inspire-users' && method === 'POST') {
      const admin = await authMiddleware(request, env);
      if (!admin) return json({ error: 'Yetkisiz' }, 401, origin);
      const d = await request.json();
      if (!d.username || !d.password) return json({ error: 'Kullanıcı adı ve şifre zorunlu' }, 400, origin);
      try {
        await env.DB.prepare('INSERT INTO inspire_users (username, password, full_name) VALUES (?, ?, ?)').bind(d.username, d.password, d.full_name || '').run();
        return json({ ok: true }, 201, origin);
      } catch(e) {
        return json({ error: 'Kullanıcı zaten var veya DB hatası' }, 400, origin);
      }
    }
    if (cleanPath.match(/^\/api\/admin\/inspire-users\/\d+$/) && method === 'DELETE') {
      const admin = await authMiddleware(request, env);
      if (!admin) return json({ error: 'Yetkisiz' }, 401, origin);
      const id = cleanPath.split('/').pop();
      await env.DB.prepare('DELETE FROM inspire_users WHERE id=?').bind(id).run();
      return json({ ok: true }, 200, origin);
    }

    // 3. User Login
    if (path === '/api/inspire/login' && method === 'POST') {
      const { username, password } = await request.json().catch(() => ({}));
      if (!username || !password) return json({ error: 'Kullanıcı adı ve şifre gereklidir' }, 401, origin);
      
      if (username === 'vkesgin38' && password === env.ADMIN_PASSWORD) {
         const exists = await env.DB.prepare("SELECT * FROM inspire_users WHERE username='vkesgin38'").first();
         if (!exists) {
           await env.DB.prepare("INSERT INTO inspire_users (username,password,full_name) VALUES ('vkesgin38',?,'Veli Kesgin')").bind(password).run();
         }
      }
      
      let user = await env.DB.prepare("SELECT * FROM inspire_users WHERE username=? AND password=?").bind(username, password).first();
      if (!user) return json({ error: 'Hatalı kullanıcı adı veya şifre' }, 401, origin);

      const token = await signInspireJWT({ userId: user.id, username: user.username }, env.JWT_SECRET || 'secret');
      return json({ token, user: { id:user.id, username:user.username, full_name:user.full_name, is_first_login: user.is_first_login } }, 200, origin);
    }

    
    if (path === '/api/inspire/change-password' && method === 'POST') {
      const user = await inspireAuth(request, env);
      if (!user) return json({ error: 'Yetkisiz' }, 401, origin);
      const { newPassword } = await request.json();
      if (!newPassword || newPassword.length < 4) return json({ error: 'Gecerli bir sifre giriniz' }, 400, origin);
      await env.DB.prepare('UPDATE inspire_users SET password=?, is_first_login=0 WHERE id=?').bind(newPassword, user.userId).run();
      return json({ ok: true }, 200, origin);
    }

    // 4. Posts
    if (path === '/api/inspire/posts' && method === 'GET') {
      const { results } = await env.DB.prepare(`
        SELECT p.*, u.full_name as author,
        (
          SELECT json_group_array(json_object('id', n.id, 'content', n.content, 'author', nu.full_name, 'is_public', n.is_public, 'user_id', n.user_id))
          FROM inspire_notes n 
          LEFT JOIN inspire_users nu ON n.user_id = nu.id 
          WHERE n.post_id = p.id
        ) as notes_json
        FROM inspire_posts p 
        LEFT JOIN inspire_users u ON p.user_id = u.id 
        ORDER BY p.id DESC
      `).all();
      
      const parsedResults = results.map(r => {
        let notes = [];
        try {
          if (r.notes_json) {
            notes = JSON.parse(r.notes_json);
            // sqlite json_group_array might return '[{}]' if empty due to some joins, let's filter nulls
            notes = notes.filter(n => n.id !== null);
          }
        } catch(e) {}
        r.notes = notes;
        delete r.notes_json;
        return r;
      });
      return json(parsedResults, 200, origin);
    }

    if (path === '/api/inspire/posts' && method === 'POST') {
      const user = await inspireAuth(request, env);
      if (!user) return json({ error: 'Yetkisiz' }, 401, origin);
      const d = await request.json();
      if (!d.type || !d.url) return json({ error: 'Tip ve URL gerekli' }, 400, origin);
      
      const { meta } = await env.DB.prepare(
        'INSERT INTO inspire_posts (user_id, type, url, description) VALUES (?, ?, ?, ?)'
      ).bind(user.userId, d.type, d.url, d.description || '').run();
      
      const newPost = await env.DB.prepare(`
        SELECT p.*, u.full_name as author 
        FROM inspire_posts p 
        LEFT JOIN inspire_users u ON p.user_id = u.id 
        WHERE p.id=?
      `).bind(meta.last_row_id).first();
      
      return json(newPost, 201, origin);
    }

    
    if (cleanPath.match(/^\/api\/inspire\/posts\/\d+\/notes$/) && method === 'POST') {
      const user = await inspireAuth(request, env);
      if (!user) return json({ error: 'Yetkisiz' }, 401, origin);
      const postId = cleanPath.split('/')[4];
      const d = await request.json();
      if (!d.content) return json({ error: 'İçerik gerekli' }, 400, origin);
      await env.DB.prepare(
        'INSERT INTO inspire_notes (post_id, user_id, content, is_public) VALUES (?, ?, ?, ?)'
      ).bind(postId, user.userId, d.content, d.is_public ? 1 : 0).run();
      return json({ ok: true }, 201, origin);
    }

    if (cleanPath.match(/^\/api\/inspire\/posts\/\d+$/) && method === 'DELETE') {
      const user = await inspireAuth(request, env);
      const admin = await authMiddleware(request, env);
      if (!user && !admin) return json({ error: 'Yetkisiz' }, 401, origin);
      
      const id = cleanPath.split('/').pop();
      
      if (admin || (user && user.username === 'vkesgin38')) {
        await env.DB.prepare('DELETE FROM inspire_posts WHERE id=?').bind(id).run();
      } else {
        await env.DB.prepare('DELETE FROM inspire_posts WHERE id=? AND user_id=?').bind(id, user.userId).run();
      }
      return json({ ok: true }, 200, origin);
    }
    
    // Notes Delete
    if (cleanPath.match(/^\/api\/inspire\/notes\/\d+$/) && method === 'DELETE') {
      const user = await inspireAuth(request, env);
      if (!user) return json({ error: 'Yetkisiz' }, 401, origin);
      const id = cleanPath.split('/').pop();
      if (user.username === 'vkesgin38') {
        await env.DB.prepare('DELETE FROM inspire_notes WHERE id=?').bind(id).run();
      } else {
        await env.DB.prepare('DELETE FROM inspire_notes WHERE id=? AND user_id=?').bind(id, user.userId).run();
      }
      return json({ ok: true }, 200, origin);
    }
    
    // Notes Edit
    if (cleanPath.match(/^\/api\/inspire\/notes\/\d+$/) && method === 'PUT') {
      const user = await inspireAuth(request, env);
      if (!user) return json({ error: 'Yetkisiz' }, 401, origin);
      const id = cleanPath.split('/').pop();
      const d = await request.json();
      if (!d.content) return json({ error: 'İçerik gerekli' }, 400, origin);
      
      if (user.username === 'vkesgin38') {
        await env.DB.prepare('UPDATE inspire_notes SET content=? WHERE id=?').bind(d.content, id).run();
      } else {
        await env.DB.prepare('UPDATE inspire_notes SET content=? WHERE id=? AND user_id=?').bind(d.content, id, user.userId).run();
      }
      return json({ ok: true }, 200, origin);
    }

    // === PROTECTED: Auth gerekli ===
    const user = await authMiddleware(request, env);

    // === UI ROUTES ===
    // 1. Table Init
    if (path === '/api/ui/init' && method === 'GET') {
      try {
        await env.DB.prepare(`
          CREATE TABLE IF NOT EXISTS ui_users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            email TEXT UNIQUE NOT NULL,
            password TEXT NOT NULL,
            full_name TEXT DEFAULT '',
            plan TEXT DEFAULT 'FREE', -- FREE, PRO
            subscription_end TEXT,
            is_email_verified INTEGER DEFAULT 0,
            created_at TEXT DEFAULT (datetime('now'))
          )
        `).run();
        
        await env.DB.prepare(`
          CREATE TABLE IF NOT EXISTS ui_auth_tokens (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            token TEXT NOT NULL,
            type TEXT NOT NULL, -- 'ACTIVATION' or 'RESET'
            expires_at TEXT NOT NULL,
            created_at TEXT DEFAULT (datetime('now'))
          )
        `).run();

        await env.DB.prepare(`
          CREATE TABLE IF NOT EXISTS ui_downloads (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            component_id TEXT NOT NULL,
            download_type TEXT DEFAULT 'riv', -- 'riv' or 'code'
            created_at TEXT DEFAULT (datetime('now')),
            FOREIGN KEY(user_id) REFERENCES ui_users(id) ON DELETE CASCADE
          )
        `).run();
        
        try { await env.DB.prepare("ALTER TABLE ui_users ADD COLUMN is_email_verified INTEGER DEFAULT 1").run(); } catch(e){}

        return json({ ok: true }, 200, origin);
      } catch (e) {
        return json({ error: e.message }, 500, origin);
      }
    }

    // -- EMAIL SENDER HELPER --
    async function sendResendEmail(to, subject, html) {
      if (!env.RESEND_API_KEY) return false;
      try {
        const res = await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${env.RESEND_API_KEY}` },
          body: JSON.stringify({
            from: 'VK UI <noreply@velikesgin.com>',
            to: [to],
            subject: subject,
            html: html
          })
        });
        return res.ok;
      } catch(e) { return false; }
    }

    // 2. Register
    if (path === '/api/ui/auth/register' && method === 'POST') {
      const { email, password, full_name } = await request.json().catch(() => ({}));
      if (!email || !password) return json({ error: 'E-posta ve şifre gereklidir' }, 400, origin);
      
      try {
        const isVerifiedDefault = env.RESEND_API_KEY ? 0 : 1; // If no API key, skip verification
        const { meta } = await env.DB.prepare(
          'INSERT INTO ui_users (email, password, full_name, is_email_verified) VALUES (?, ?, ?, ?)'
        ).bind(email, password, full_name || '', isVerifiedDefault).run();
        
        const userId = meta.last_row_id;

        if (env.RESEND_API_KEY) {
          const code = Math.floor(100000 + Math.random() * 900000).toString();
          const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString(); // 1 hour
          await env.DB.prepare('INSERT INTO ui_auth_tokens (user_id, token, type, expires_at) VALUES (?, ?, ?, ?)')
                      .bind(userId, code, 'ACTIVATION', expiresAt).run();
          
          await sendResendEmail(email, 'Hesabınızı Aktive Edin', `
            <div style="font-family:sans-serif;max-width:500px;margin:0 auto;padding:20px;border:1px solid #eee;border-radius:10px;">
              <h2 style="color:#ff2b73;">Hoş Geldiniz!</h2>
              <p>Hesabınızı aktive etmek için aşağıdaki 6 haneli kodu kullanın:</p>
              <div style="background:#f4f4f5;padding:15px;font-size:24px;font-weight:bold;letter-spacing:5px;text-align:center;border-radius:8px;margin:20px 0;">
                ${code}
              </div>
              <p>Bu kod 1 saat geçerlidir.</p>
            </div>
          `);
          return json({ needsVerification: true, email }, 201, origin);
        } else {
          // Fallback if no email provider configured
          const token = await signUiJWT({ userId, email }, env.JWT_SECRET || 'secret');
          return json({ token, user: { id: userId, email, full_name, plan: 'FREE' } }, 201, origin);
        }
      } catch (e) {
        return json({ error: 'Bu e-posta adresi zaten kullanımda olabilir' }, 400, origin);
      }
    }

    // 2.5 Verify Email
    if (path === '/api/ui/auth/verify' && method === 'POST') {
      const { email, code } = await request.json().catch(() => ({}));
      if (!email || !code) return json({ error: 'Eksik bilgi' }, 400, origin);
      
      const user = await env.DB.prepare("SELECT id FROM ui_users WHERE email=?").bind(email).first();
      if (!user) return json({ error: 'Kullanıcı bulunamadı' }, 404, origin);
      
      const tokenRow = await env.DB.prepare("SELECT * FROM ui_auth_tokens WHERE user_id=? AND token=? AND type='ACTIVATION' ORDER BY id DESC").bind(user.id, code).first();
      if (!tokenRow) return json({ error: 'Geçersiz doğrulama kodu' }, 400, origin);
      
      if (new Date(tokenRow.expires_at) < new Date()) {
        return json({ error: 'Kodun süresi dolmuş' }, 400, origin);
      }
      
      await env.DB.prepare("UPDATE ui_users SET is_email_verified=1 WHERE id=?").bind(user.id).run();
      await env.DB.prepare("DELETE FROM ui_auth_tokens WHERE id=?").bind(tokenRow.id).run();
      
      return json({ ok: true }, 200, origin);
    }

    // 3. Login
    if (path === '/api/ui/auth/login' && method === 'POST') {
      const { email, password } = await request.json().catch(() => ({}));
      if (!email || !password) return json({ error: 'E-posta ve şifre gereklidir' }, 400, origin);
      
      const uiUser = await env.DB.prepare("SELECT * FROM ui_users WHERE email=? AND password=?").bind(email, password).first();
      if (!uiUser) return json({ error: 'Hatalı e-posta veya şifre' }, 401, origin);
      
      if (uiUser.is_email_verified === 0) {
        return json({ error: 'Hesabınız onaylanmamış. Lütfen e-postanıza gelen kodu girin.', unverified: true, email }, 403, origin);
      }

      const token = await signUiJWT({ userId: uiUser.id, email: uiUser.email }, env.JWT_SECRET || 'secret');
      return json({ token, user: { id: uiUser.id, email: uiUser.email, full_name: uiUser.full_name, plan: uiUser.plan, subscription_end: uiUser.subscription_end } }, 200, origin);
    }

    // 3.5 Forgot Password Request
    if (path === '/api/ui/auth/forgot-password' && method === 'POST') {
      const { email } = await request.json().catch(() => ({}));
      if (!email) return json({ error: 'E-posta gereklidir' }, 400, origin);
      
      if (!env.RESEND_API_KEY) {
        return json({ error: 'E-posta servisi şu an yapılandırılmamış. Lütfen yönetici ile iletişime geçin.' }, 500, origin);
      }

      const user = await env.DB.prepare("SELECT id FROM ui_users WHERE email=?").bind(email).first();
      if (user) {
        const code = Math.floor(100000 + Math.random() * 900000).toString();
        const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();
        await env.DB.prepare('INSERT INTO ui_auth_tokens (user_id, token, type, expires_at) VALUES (?, ?, ?, ?)')
                    .bind(user.id, code, 'RESET', expiresAt).run();
        
        await sendResendEmail(email, 'Şifre Sıfırlama Kodu', `
          <div style="font-family:sans-serif;max-width:500px;margin:0 auto;padding:20px;border:1px solid #eee;border-radius:10px;">
            <h2 style="color:#ff2b73;">Şifre Sıfırlama</h2>
            <p>Şifrenizi sıfırlamak için aşağıdaki 6 haneli kodu kullanın:</p>
            <div style="background:#f4f4f5;padding:15px;font-size:24px;font-weight:bold;letter-spacing:5px;text-align:center;border-radius:8px;margin:20px 0;">
              ${code}
            </div>
            <p>Eğer bu işlemi siz talep etmediyseniz, bu mesajı yoksayabilirsiniz.</p>
          </div>
        `);
      }
      // Her halükarda başarılı dönüyoruz ki kullanıcı olup olmadığı anlaşılarak brute-force yapılmasın.
      return json({ ok: true }, 200, origin);
    }

    // 3.6 Reset Password
    if (path === '/api/ui/auth/reset-password' && method === 'POST') {
      const { email, code, newPassword } = await request.json().catch(() => ({}));
      if (!email || !code || !newPassword) return json({ error: 'Tüm alanları doldurun' }, 400, origin);
      
      const user = await env.DB.prepare("SELECT id FROM ui_users WHERE email=?").bind(email).first();
      if (!user) return json({ error: 'Geçersiz kod veya e-posta' }, 400, origin);
      
      const tokenRow = await env.DB.prepare("SELECT * FROM ui_auth_tokens WHERE user_id=? AND token=? AND type='RESET' ORDER BY id DESC").bind(user.id, code).first();
      if (!tokenRow) return json({ error: 'Geçersiz veya kullanılmış kod' }, 400, origin);
      
      if (new Date(tokenRow.expires_at) < new Date()) {
        return json({ error: 'Kodun süresi dolmuş' }, 400, origin);
      }
      
      await env.DB.prepare("UPDATE ui_users SET password=? WHERE id=?").bind(newPassword, user.id).run();
      await env.DB.prepare("DELETE FROM ui_auth_tokens WHERE id=?").bind(tokenRow.id).run();
      
      return json({ ok: true }, 200, origin);
    }

    // 4. Me (Get current user)
    
    // ---------------- UI COMMENTS ----------------
    if (path === '/api/ui/comments' && method === 'GET') {
      const compId = url.searchParams.get('component_id');
      if (!compId) return json({ error: 'component_id required' }, 400, origin);
      
      const authData = await uiAuth(request, env);
      const isAdmin = authData?.email === 'vkesgin38@gmail.com';
      
      // Herkese açık olanlar (approved=1) + Yapanın kendisi veya Admin ise diğerleri (0,2)
      const { results } = await env.DB.prepare(`
        SELECT c.id, c.content, c.created_at, u.full_name, u.plan, c.is_approved, c.user_id
        FROM ui_comments c 
        JOIN ui_users u ON c.user_id = u.id 
        WHERE c.component_id = ? AND (c.is_approved = 1 OR c.user_id = ? OR ?)
        ORDER BY c.created_at DESC
      `).bind(compId, authData?.userId || -1, isAdmin ? 1 : 0).all();
      return json(results, 200, origin);
    }

    if (path === '/api/ui/comments' && method === 'POST') {
      const authData = await uiAuth(request, env);
      if (!authData) return json({ error: 'Yetkisiz (Lütfen tekrar giriş yapın)' }, 401, origin);
      
      const { component_id, content } = await request.json().catch(() => ({}));
      if (!component_id || !content) return json({ error: 'Eksik veri' }, 400, origin);
      
      // Admin kontrolü: Sadece vkesgin38@gmail.com direkt yayınlar
      const is_admin = authData.email === 'vkesgin38@gmail.com';
      const is_approved = is_admin ? 1 : 0;

      await env.DB.prepare(
        "INSERT INTO ui_comments (component_id, user_id, content, is_approved) VALUES (?, ?, ?, ?)"
      ).bind(component_id, authData.userId, content, is_approved).run();
      
      return json({ message: is_approved ? 'Yorum eklendi' : 'Yorum onay bekliyor' }, 200, origin);
    }

    if (cleanPath === '/api/admin/comments' && method === 'GET') {
      const authData = await uiAuth(request, env);
      if (!authData || authData.email !== 'vkesgin38@gmail.com') return json({ error: 'Yetkisiz' }, 401, origin);

      const { results } = await env.DB.prepare(`
        SELECT c.id, c.content, c.is_approved, c.created_at, u.full_name, u.email, c.component_id
        FROM ui_comments c
        JOIN ui_users u ON c.user_id = u.id
        ORDER BY c.is_approved ASC, c.created_at DESC
      `).all();
      return json(results, 200, origin);
    }

    if (cleanPath.match(/^\/api\/admin\/comments\/\d+$/) && method === 'PUT') {
      const authData = await uiAuth(request, env);
      if (!authData || authData.email !== 'vkesgin38@gmail.com') return json({ error: 'Yetkisiz' }, 401, origin);

      const id = cleanPath.split('/').pop();
      const { status } = await request.json().catch(() => ({})); // 0, 1, 2
      await env.DB.prepare("UPDATE ui_comments SET is_approved = ? WHERE id = ?").bind(status, id).run();
      return json({ message: 'Güncellendi' }, 200, origin);
    }
    
    if (cleanPath.match(/^\/api\/admin\/comments\/\d+$/) && method === 'DELETE') {
      const authData = await uiAuth(request, env);
      if (!authData || authData.email !== 'vkesgin38@gmail.com') return json({ error: 'Yetkisiz' }, 401, origin);

      const id = cleanPath.split('/').pop();
      await env.DB.prepare("DELETE FROM ui_comments WHERE id = ?").bind(id).run();
      return json({ message: 'Silindi' }, 200, origin);
    }
    // ---------------------------------------------
if (path === '/api/ui/auth/me' && method === 'GET') {
      const authData = await uiAuth(request, env);
      if (!authData) return json({ error: 'Yetkisiz' }, 401, origin);
      
      const uiUser = await env.DB.prepare("SELECT id, email, full_name, plan, subscription_end FROM ui_users WHERE id=?").bind(authData.userId).first();
      if (!uiUser) return json({ error: 'Kullanıcı bulunamadı' }, 404, origin);
      
      // Kalan indirme hakkını hesapla (FREE: 5/ay, PRO: sınırsız)
      let remaining_downloads = -1; // -1 = sınırsız (PRO)
      if (uiUser.plan !== 'PRO') {
        const now = new Date();
        const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
        const dlCount = await env.DB.prepare(
          "SELECT COUNT(*) as cnt FROM ui_downloads WHERE user_id=? AND created_at >= ?"
        ).bind(uiUser.id, monthStart).first();
        remaining_downloads = Math.max(0, 5 - (dlCount?.cnt || 0));
      }
      
      return json({ user: { ...uiUser, remaining_downloads } }, 200, origin);
    }

    // 4.1 Update Me (Profile & Password)
    if (path === '/api/ui/auth/me' && method === 'PUT') {
      const authData = await uiAuth(request, env);
      if (!authData) return json({ error: 'Yetkisiz' }, 401, origin);
      
      const { full_name, currentPassword, newPassword } = await request.json().catch(() => ({}));
      
      let query = 'UPDATE ui_users SET ';
      const updates = [];
      const params = [];
      
      if (full_name !== undefined) {
        updates.push('full_name=?');
        params.push(full_name);
      }
      
      if (newPassword) {
        const user = await env.DB.prepare("SELECT password FROM ui_users WHERE id=?").bind(authData.userId).first();
        if (!user || user.password !== currentPassword) {
           return json({ error: 'Mevcut şifreniz hatalı' }, 400, origin);
        }
        updates.push('password=?');
        params.push(newPassword);
      }
      
      if (updates.length > 0) {
        query += updates.join(', ') + ' WHERE id=?';
        params.push(authData.userId);
        await env.DB.prepare(query).bind(...params).run();
      }
      
      const updatedUser = await env.DB.prepare("SELECT id, email, full_name, plan, subscription_end FROM ui_users WHERE id=?").bind(authData.userId).first();
      return json({ ok: true, user: updatedUser }, 200, origin);
    }

    // 4.5 Download endpoint — indirme hakkı kontrolü ve sayaç
    if (path === '/api/ui/download' && method === 'POST') {
      const authData = await uiAuth(request, env);
      if (!authData) return json({ error: 'Bu içeriğe erişmek için giriş yapmalısınız' }, 401, origin);
      
      const { component_id, download_type } = await request.json().catch(() => ({}));
      if (!component_id) return json({ error: 'component_id gerekli' }, 400, origin);
      
      const uiUser = await env.DB.prepare("SELECT id, plan FROM ui_users WHERE id=?").bind(authData.userId).first();
      if (!uiUser) return json({ error: 'Kullanıcı bulunamadı' }, 404, origin);
      
      // PRO bileşen kontrolü
      const comp = await env.DB.prepare("SELECT is_featured FROM projects WHERE id=?").bind(component_id).first();
      if (comp && comp.is_featured && uiUser.plan !== 'PRO') {
        return json({ error: 'Bu bileşen PRO üyelere özeldir' }, 403, origin);
      }
      
      // FREE kullanıcı limit kontrolü
      if (uiUser.plan !== 'PRO') {
        const now = new Date();
        const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
        const dlCount = await env.DB.prepare(
          "SELECT COUNT(*) as cnt FROM ui_downloads WHERE user_id=? AND created_at >= ?"
        ).bind(uiUser.id, monthStart).first();
        const used = dlCount?.cnt || 0;
        if (used >= 5) {
          return json({ error: 'Aylık indirme limitiniz doldu (5/5). PRO pakete geçerek sınırsız indirme yapabilirsiniz.', limit_reached: true }, 403, origin);
        }
      }
      
      // İndirmeyi kaydet
      await env.DB.prepare(
        'INSERT INTO ui_downloads (user_id, component_id, download_type) VALUES (?, ?, ?)'
      ).bind(uiUser.id, component_id, download_type || 'riv').run();
      
      // Güncel kalan hakkı döndür
      let remaining = -1;
      if (uiUser.plan !== 'PRO') {
        const now2 = new Date();
        const ms2 = new Date(now2.getFullYear(), now2.getMonth(), 1).toISOString();
        const c2 = await env.DB.prepare("SELECT COUNT(*) as cnt FROM ui_downloads WHERE user_id=? AND created_at >= ?").bind(uiUser.id, ms2).first();
        remaining = Math.max(0, 5 - (c2?.cnt || 0));
      }
      
      return json({ ok: true, remaining_downloads: remaining }, 200, origin);
    }

    // 5. Lemon Squeezy Webhook
    if (path === '/api/ui/webhook/lemonsqueezy' && method === 'POST') {
      try {
        const signature = request.headers.get('X-Signature');
        // İdealde burada crypto.subtle ile secret key doğrulaması yapılır.
        // Şimdilik gelen payload'u alıp DB'yi güncelleyeceğiz.
        
        const payload = await request.json();
        const eventName = payload.meta.event_name;
        const customData = payload.meta.custom_data;
        const userId = customData?.user_id;
        
        if (!userId) return json({ error: 'Missing user_id in custom_data' }, 400);

        if (eventName === 'subscription_created' || eventName === 'subscription_updated') {
          const status = payload.data.attributes.status; // active, past_due, unpaid, canceled, expired
          const endsAt = payload.data.attributes.renews_at || payload.data.attributes.ends_at;
          
          if (status === 'active') {
            const user = await env.DB.prepare("SELECT subscription_end FROM ui_users WHERE id=?").bind(userId).first();
            let finalEndsAt = endsAt;

            if (eventName === 'subscription_created' && user && user.subscription_end) {
              const currentEnd = new Date(user.subscription_end);
              const now = new Date();
              if (currentEnd > now) {
                const newEnd = new Date(endsAt);
                const addedMs = newEnd.getTime() - payload.data.attributes.created_at ? new Date(payload.data.attributes.created_at).getTime() : now.getTime();
                // To be safer, just calculate the difference between the given endsAt and now
                const durationMs = newEnd.getTime() - now.getTime();
                if (durationMs > 0) {
                  finalEndsAt = new Date(currentEnd.getTime() + durationMs).toISOString();
                }
              }
            }
            
            await env.DB.prepare("UPDATE ui_users SET plan='PRO', subscription_end=? WHERE id=?").bind(finalEndsAt, userId).run();
          } else if (status === 'expired' || status === 'canceled' || status === 'unpaid') {
            await env.DB.prepare("UPDATE ui_users SET plan='FREE' WHERE id=?").bind(userId).run();
          }
        }
        
        return json({ received: true }, 200);
      } catch (err) {
        return json({ error: 'Webhook processing failed' }, 500);
      }
    }

    // === PROTECTED: Admin Auth Gerekli Olanlar ===
    if (!user) return json({ error: 'Yetkisiz' }, 401, origin);

    // === UI USERS (ADMIN) ===
    if (path === '/api/admin/ui-users' && method === 'GET') {
      const { results } = await env.DB.prepare('SELECT id, email, full_name, plan, password, subscription_end, created_at FROM ui_users ORDER BY created_at DESC').all();
      return json(results, 200, origin);
    }
    
    if (path.match(/^\/api\/admin\/ui-users\/\d+$/) && method === 'DELETE') {
      const id = path.split('/').pop();
      await env.DB.prepare('DELETE FROM ui_users WHERE id=?').bind(id).run();
      return json({ ok: true }, 200, origin);
    }

    if (path.match(/^\/api\/admin\/ui-users\/\d+$/) && method === 'PUT') {
      const id = path.split('/').pop();
      const { password, plan } = await request.json().catch(() => ({}));
      
      let query = 'UPDATE ui_users SET ';
      const updates = [];
      const params = [];
      
      if (password) { updates.push('password=?'); params.push(password); }
      if (plan) { updates.push('plan=?'); params.push(plan); }
      
      if (updates.length > 0) {
        query += updates.join(', ') + ' WHERE id=?';
        params.push(id);
        await env.DB.prepare(query).bind(...params).run();
      }
      return json({ ok: true }, 200, origin);
    }

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
      // 'file' türü için prefix ekleme — sadece images/videos için alt klasör
      const prefix   = (fileType === 'image' || fileType === 'video') ? `${fileType}s/` : '';
      const key      = `${prefix}${nanoid()}.${ext}`;
      const buffer   = await file.arrayBuffer();

      await env.STORAGE.put(key, buffer, {
        httpMetadata: { contentType: file.type },
      });

      const fileUrl = `/files/${key}`;
      return json({ url: fileUrl, key }, 201, origin);
    }


    
  }
};
