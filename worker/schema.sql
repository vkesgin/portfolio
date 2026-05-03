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
  status TEXT DEFAULT 'Planlandý',
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
