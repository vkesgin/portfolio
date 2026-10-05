-- LOCAL TEST ONLY (tests/storyboard-e2e/run-mode.sh kpss). Test values, not real credentials.
-- The owner row holds a stale copy of an OLD admin password (what the pre-fix login wrote into it);
-- the legacy 'admin' row is what the first owner login took over before 'vkesgin38' existed.
CREATE TABLE IF NOT EXISTS kpss_users (id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT UNIQUE NOT NULL, password TEXT NOT NULL,
  full_name TEXT DEFAULT '', exam_name TEXT DEFAULT 'KPSS', exam_date TEXT, xp INTEGER DEFAULT 0, created_at TEXT DEFAULT (datetime('now')));
CREATE TABLE IF NOT EXISTS kpss_daily_plans (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS kpss_teachers (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS kpss_trial_exams (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS kpss_sticky_notes (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL);
INSERT INTO kpss_users (username, password, full_name, exam_name, exam_date) VALUES
  ('vkesgin38', 'old-leaked-admin-pass-TEST', 'Veli Kesgin', 'KPSS', '2026-01-01'),
  ('kpss_user1', 'kpss-user-test-pw', 'Test Öğrenci', 'KPSS', '2026-01-01'),
  ('admin', '', 'Admin', 'KPSS', '2026-01-01');
