-- seed-legacy.sql: production-shaped rows written by the pre-v2 worker (meta v1, no media column value), loaded by
-- media-smoke.mjs after the worker's schema migration ran. TEST data only; URLs point at fixture-server.mjs.
INSERT INTO inspire_posts (user_id, type, url, description, author_name, client_id, url_key, meta) VALUES
  ((SELECT id FROM inspire_users WHERE username = '__guest__'), 'web', 'http://127.0.0.1:4742/page/legacy-ok/video/77001234-legacy-clip',
   'v1 good meta, page has a video now', 'Eski', 'legacyseedcid0000000001', 'web:127.0.0.1:4742/page/legacy-ok/video/77001234-legacy-clip',
   '{"title":"Old title","description":null,"image":null,"site_name":null,"provider":"127.0.0.1"}'),
  ((SELECT id FROM inspire_users WHERE username = '__guest__'), 'web', 'http://127.0.0.1:4742/page/legacy-fail/old-article',
   'v1 good meta, page fails now', 'Eski', 'legacyseedcid0000000001', 'web:127.0.0.1:4742/page/legacy-fail/old-article',
   '{"title":"Kept title","description":"kept description","image":null,"site_name":"Old Site","provider":"127.0.0.1"}'),
  ((SELECT id FROM inspire_users WHERE username = '__guest__'), 'web', 'http://127.0.0.1:4742/page/plain/legacy-failed',
   'v1 failure', 'Eski', 'legacyseedcid0000000001', 'web:127.0.0.1:4742/page/plain/legacy-failed',
   '{"failed":1,"at":1791290000}'),
  ((SELECT id FROM inspire_users WHERE username = '__guest__'), 'youtube', 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
   'embed post (no fetch in tests)', 'Eski', 'legacyseedcid0000000001', 'youtube:dQw4w9WgXcQ', NULL);
