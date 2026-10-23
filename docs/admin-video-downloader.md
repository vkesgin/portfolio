# Admin video downloader

The **Video İndir** tab in `/admin.html` uses the portfolio's existing admin session. No new account is created. The static Astro mirror under `web-src/public/` has the same markup and assets.

## Architecture

- `assets/js/admin-video.js`, `assets/css/admin-video.css`: VK theme, mobile layout, pasted link, quality selection, optional headless scan, download status and save button. A single unambiguous supported-site video or direct media link is prepared and saved automatically; ambiguous generic embeds remain selectable. A save button remains available if the browser blocks automatic download.
- `worker/video-downloader.js`: `/api/admin/video/*`, authenticated with the existing portfolio admin JWT. Rejects other roles and foreign origins. No D1, R2, KV, response cache, analytics events or download history.
- `services/video-downloader/`: private Python/yt-dlp/FFmpeg/Chromium service. Deployable Docker image; no volume or database required. Health check: `/health`. Business routes require the separate `VIDEO_BACKEND_TOKEN`.
- Browser → existing Cloudflare API → private authenticated Railway engine. The service credential never reaches the browser. Short lived, scoped file tickets are sent in a POST form body, never in a URL or as the admin bearer token.

The original Mac application's Opera integration is a separate execution environment. A remote server cannot use the Mac's Opera VPN. The web engine uses its hosting network and a temporary Chromium process for dynamic sites. Account-only videos, geographic blocks, bot challenges, DRM, WebRTC, and some proprietary players cannot be guaranteed. No DRM bypass or session/password collection is implemented.

## Retention and privacy

No permanent download history, URL list or site account/session is saved by this feature. Source URLs, extracted metadata, ephemeral cookies, status and tickets remain in process memory for the current operation and expire after ten minutes. Browser profiles and media intermediates live only inside the job's temporary directory. A janitor runs every 15 seconds; cancelled/failed jobs delete their temporary files. Explicit **Temizle**, admin logout and best-effort page unload cancel the associated jobs and remove their source records.

Prepared media is deleted after the transfer iterator finishes, including cancellation, or expires if unused. A transfer has a 30-minute safety deadline; unused files expire after ten minutes. Startup/shutdown allocate and clean a temporary root. There are no attached volumes. An abrupt container failure can leave temporary data only in that container's ephemeral filesystem until it is replaced; this is not cryptographic secure erasure.

No application request/access logs, yt-dlp logs, or raw upstream exception messages are emitted by the engine/gateway. Hosting providers, source websites and the user's browser may have their own network/download logs; this feature cannot promise that those third parties keep no records. Existing admin session storage and unrelated portfolio features are unchanged. The translation widget is removed from the admin page so video titles are not sent to that third-party widget. Only the final file explicitly saved by the user remains on their device.

## Configuration

Existing Cloudflare API worker `worker/wrangler.toml`:

- Secret `VIDEO_BACKEND_URL`: the engine's HTTPS origin ending in `/`.
- Secret `VIDEO_BACKEND_TOKEN`: a random credential of at least 32 characters. Same value on the engine. Never commit it or expose it in browser code.
- Existing `JWT_SECRET` and `ADMIN_PASSWORD` continue protecting admin access.

Engine:

- `VIDEO_BACKEND_TOKEN` (required for all `/v1/*` operations).
- `PORT` (provided by host; default `8080`).
- `VIDEO_MAX_MB` (default `1024`). If changing this, update the frontend/config response limit text too.

Two simultaneous operations, at most 50 transient jobs and 100 sources. Analysis has a 100-second ceiling; download preparation has 15 minutes. No active live recordings. Native HTTP/HLS/DASH downloads only; FFmpeg merges/converts local files. Public HTTP(S) hosts on ports 80/443 only. An egress proxy resolves and pins global IP addresses for each connection, including redirects; private/link-local/loopback addresses and DNS rebinding to them are rejected. Both yt-dlp and Chromium use that proxy. The child process drops hosting/API secret environment variables.

## Deployment

The site and API are distinct existing Cloudflare workers:

- Site: repository root `wrangler.jsonc` (`portfolio`).
- API: **always** deploy with `npx wrangler deploy -c worker/wrangler.toml` from the repository root. Deploying without that flag updates the static site, not the API.
- Engine: Railway service from `services/video-downloader`, using its Dockerfile and `railway.json`. One replica: transient jobs are process-local and are intentionally not shared across replicas or restored across restarts. Deploy/restart clears active jobs.

The `.assetsignore` excludes `/services/`, `/worker/`, `/tests/`, and `/docs/` so service code, credentials and test files do not become public website assets.

## Verification

- `node --test tests/` runs existing regression tests and gateway coverage for roles, origin checks, URL/quality validation, ticket expiry/scope, file streaming and no-store responses.
- Python service: from its directory, `python -m unittest -v test_service` checks temporary-file/source deletion, expiry, public-address filtering, DRM/live/non-HTTP rejection.
- `tests/admin-video-ui.py` is the manual integration harness for a local worker with test-only admin credentials + the real engine. It exercises desktop/mobile UI, actual preparation, a browser download, and FFprobe validation. It never uses production admin credentials. Its preview ports/configuration are development fixtures, not public setup instructions.

Production smoke testing should use the regular admin login in a browser and an allowed public video, then verify the downloaded file. Endpoint availability does not prove every site is supported.

## Interactive browser fallback

Failed extraction opens an ephemeral remote Chromium viewport directly in the admin panel. The user can click a player, scroll, type, follow links, return, or reload. JPEG frames are relayed through the authenticated gateway; this is a remote control view, not an iframe of the target site. Frames update roughly once per second depending on network speed; audio is not relayed. Detected media appear as explicit choices. The browser's scoped cookies and headers are copied into the download process before the browser is closed.

`POST /api/admin/video/browser` opens a session; `/browser/:id/action` accepts only frame, click, scroll, text, key, back and reload. No arbitrary JavaScript evaluation is exposed. Coordinates, text length and keys are constrained server-side. Both the browser and downloads use the existing public-only egress proxy. Sessions share the two-operation limit, expire after ten minutes, and are deleted on close, clear, logout or best-effort page exit. Browser profiles live in the job's temporary directory and are removed on shutdown; images and captured credentials are never added to app logs or persistent storage. As with other temporary data, abrupt container termination is not a secure-erasure guarantee.

Validation: install `httpx2` in the development environment, then run `python -m unittest discover -s services/video-downloader -p 'test_*.py'`. The interactive integration test launches real Chromium through a test-only proxy, clicks a delayed player, verifies cookie/referrer dependent media capture and download, rejects invalid controls, and verifies browser profile/source/file cleanup.
