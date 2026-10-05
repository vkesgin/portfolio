CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  category TEXT NOT NULL,
  description TEXT DEFAULT '',
  tags TEXT DEFAULT '',
  year TEXT DEFAULT '',
  image_url TEXT DEFAULT '',
  video_url TEXT DEFAULT '',
  thumbnail_url TEXT DEFAULT '',
  is_featured INTEGER DEFAULT 0,
  featured_order INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS fitness_store (
  key TEXT PRIMARY KEY,
  value TEXT
);
CREATE TABLE IF NOT EXISTS kpss_users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT UNIQUE NOT NULL,
  password TEXT NOT NULL,
  full_name TEXT DEFAULT '',
  exam_name TEXT DEFAULT 'KPSS',
  exam_date TEXT NOT NULL,
  xp INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS kpss_daily_plans (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  date TEXT NOT NULL,
  lesson_name TEXT DEFAULT '',
  topic_name TEXT DEFAULT '',
  target_question_count INTEGER DEFAULT 50,
  solved_question_count INTEGER DEFAULT 0,
  status TEXT DEFAULT 'Planland�',
  is_video_watched INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY(user_id) REFERENCES kpss_users(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS kpss_teachers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  lesson_name TEXT DEFAULT '',
  teacher_name TEXT DEFAULT '',
  youtube_url TEXT DEFAULT '',
  FOREIGN KEY(user_id) REFERENCES kpss_users(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS kpss_trial_exams (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  lesson TEXT DEFAULT 'GENEL DENEME',
  exam_name TEXT DEFAULT '',
  exam_date TEXT DEFAULT (date('now')),
  correct_count INTEGER DEFAULT 0,
  incorrect_count INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY(user_id) REFERENCES kpss_users(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS kpss_sticky_notes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER UNIQUE NOT NULL,
  content TEXT DEFAULT '',
  updated_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY(user_id) REFERENCES kpss_users(id) ON DELETE CASCADE
);

-- ─── Fikir Havuzu (inspire) ───
-- Documentation mirror: the worker creates/migrates these itself (ensureInspireSchema in worker/index.js).
CREATE TABLE IF NOT EXISTS inspire_users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT UNIQUE NOT NULL,          -- 'vkesgin38' = admin; '__guest__' = reserved owner of guest content
  password TEXT NOT NULL,
  full_name TEXT DEFAULT '',
  created_at TEXT DEFAULT (datetime('now')),
  is_first_login INTEGER DEFAULT 1
);
CREATE TABLE IF NOT EXISTS inspire_posts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,               -- guest posts: id of the '__guest__' row
  type TEXT NOT NULL,                     -- platform from parseLink ('instagram','youtube',...,'web','image','video') or 'text'; legacy: 'reels','link',...
  url TEXT NOT NULL,                      -- canonical URL ('' for text ideas)
  description TEXT DEFAULT '',            -- text ideas store their text here
  created_at TEXT DEFAULT (datetime('now')),
  author_name TEXT,                       -- name at posting time ('' = Anonim); NULL on legacy rows
  client_id TEXT,                         -- guest client id (NULL for registered users)
  url_key TEXT,                           -- parseLink(url).key, dedupe key (NULL for text ideas)
  meta TEXT,                              -- JSON {title, description, image, site_name, provider} or NULL
  FOREIGN KEY(user_id) REFERENCES inspire_users(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS inspire_notes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  post_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  content TEXT NOT NULL,
  is_public INTEGER DEFAULT 0,            -- 0 = visible to its author only
  created_at TEXT DEFAULT (datetime('now')),
  author_name TEXT,
  client_id TEXT,
  FOREIGN KEY(post_id) REFERENCES inspire_posts(id) ON DELETE CASCADE,
  FOREIGN KEY(user_id) REFERENCES inspire_users(id) ON DELETE CASCADE
);
-- Not UNIQUE: legacy duplicates may exist; uniqueness is enforced in code.
CREATE INDEX IF NOT EXISTS idx_inspire_posts_url_key ON inspire_posts(url_key);
CREATE INDEX IF NOT EXISTS idx_inspire_notes_post ON inspire_notes(post_id);
