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
