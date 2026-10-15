#!/bin/zsh
# usage: tests/video-e2e/run-smoke.sh            (VIDEO_E2E_REAL_IG=1 also talks to the real Instagram, see video-smoke.mjs)
#        VIDEO_E2E_SCRIPT=platform-smoke.mjs VIDEO_E2E_REAL=1 tests/video-e2e/run-smoke.sh   (real downloads of every platform)
#        VIDEO_E2E_SCRIPT=live-smoke.mjs VIDEO_E2E_PUPPETEER=<dir with node_modules/puppeteer-core> tests/video-e2e/run-smoke.sh
#          (the board in headless Chrome, Instagram videos played live; see live-smoke.mjs; copies as wrangler.toml has them)
# Local worker (wrangler dev --local with worker/wrangler.toml, fresh state) + tests/media-e2e/fixture-server.mjs, then
# video-smoke.mjs. Test-only values (127.0.0.1 ALLOWED_ORIGIN, fetch allow for the fixture server, Browser Run off,
# storyboards off) are passed with --var; nothing is edited. State + logs in $VIDEO_E2E_OUT (default $TMPDIR/fikir-video-e2e).
# Board password: a TEST value (FIKIR_E2E_BOARD_PASSWORD, default test-board-pass) passed with --var and to the smoke.
# Ports: worker 8841, fixture server 4741 (VIDEO_E2E_PORT / VIDEO_E2E_FXPORT). Never 8765.
# Instagram: unless VIDEO_E2E_REAL_IG=1 / VIDEO_E2E_REAL=1, the worker runs with INSPIRE_TEST_IG=1, so every Instagram / Meta
# fetch it makes goes to the fixture server (/igfx/...) and nothing reaches Instagram (FIKIR_IG_LIVE is on in wrangler.toml).
# live-smoke.mjs: copy flags as wrangler.toml has them (FIKIR_IG_AUTO not overridden); with ffmpeg on PATH (or
# /opt/homebrew/bin) a 30 s synthetic test-pattern MP4 is made in $OUT/gen for the fixture's Instagram CDN (seeks need a
# file the browser does not buffer at once); the board page is served on VIDEO_E2E_WEBPORT (4743), a second worker with
# FIKIR_IG_LIVE=0 runs on VIDEO_E2E_OFFPORT (8843), screenshots go to VIDEO_E2E_SHOTS (default $OUT/shots).
R="${0:A:h:h:h}"
HERE="${0:A:h}"
OUT="${VIDEO_E2E_OUT:-${TMPDIR:-/tmp}/fikir-video-e2e}"
PORT="${VIDEO_E2E_PORT:-8841}"
FXPORT="${VIDEO_E2E_FXPORT:-4741}"
export FIKIR_E2E_BOARD_PASSWORD="${FIKIR_E2E_BOARD_PASSWORD:-test-board-pass}"
[[ "$PORT" == 8765 || "$FXPORT" == 8765 ]] && { echo "never 8765"; exit 1; }
for p in $PORT $FXPORT; do if lsof -nP -iTCP:$p -sTCP:LISTEN >/dev/null; then echo "port $p busy"; exit 1; fi; done
STATE="$OUT/state"; rm -rf "$STATE"; mkdir -p "$STATE" "$OUT/logs"
SCRIPT="${VIDEO_E2E_SCRIPT:-video-smoke.mjs}"
VARS=()
[[ "$VIDEO_E2E_REAL_IG" == 1 || "$VIDEO_E2E_REAL" == 1 ]] || VARS+=(--var INSPIRE_TEST_IG:1)
if [[ "$SCRIPT" == live-smoke.mjs ]]; then
  export VIDEO_E2E_WEBPORT="${VIDEO_E2E_WEBPORT:-4743}" VIDEO_E2E_OFFPORT="${VIDEO_E2E_OFFPORT:-8843}" VIDEO_E2E_SHOTS="${VIDEO_E2E_SHOTS:-$OUT/shots}"
  for p in $VIDEO_E2E_WEBPORT $VIDEO_E2E_OFFPORT; do
    [[ "$p" == 8765 ]] && { echo "never 8765"; exit 1; }
    if lsof -nP -iTCP:$p -sTCP:LISTEN >/dev/null; then echo "port $p busy"; exit 1; fi
  done
  FF="$(command -v ffmpeg || ls /opt/homebrew/bin/ffmpeg 2>/dev/null)"
  mkdir -p "$OUT/gen"; export FIXTURE_IG_LONG="$OUT/gen/ig-long.mp4"; rm -f "$FIXTURE_IG_LONG"
  [[ -n "$FF" ]] && "$FF" -loglevel error -y -f lavfi -i testsrc2=size=360x640:rate=30 -f lavfi -i sine=frequency=440:sample_rate=44100 \
    -t 30 -c:v libx264 -preset ultrafast -b:v 2500k -maxrate 2500k -bufsize 5000k -pix_fmt yuv420p -g 30 -c:a aac -b:a 64k \
    -movflags +faststart "$FIXTURE_IG_LONG" > "$OUT/logs/ffmpeg.log" 2>&1
else
  # video-smoke.mjs / platform-smoke.mjs exercise the R2-copy routes and an admin upload: copies + admin uploads on for this
  # local run only (wrangler.toml keeps them off, the owner's decision)
  VARS+=(--var FIKIR_IG_COPY:1 --var FIKIR_COPY_VIEW:1 --var FIKIR_IG_AUTO:blocked --var FIKIR_COPY_ADAPTERS:x,pinterest,tiktok,facebook,reddit
    --var FIKIR_MEDIA_UPLOADS:admin)
fi
node "$R/tests/media-e2e/fixture-server.mjs" $FXPORT > "$OUT/logs/fixture.log" 2>&1 &
FXPID=$!
for i in {1..20}; do grep -q "fixture server" "$OUT/logs/fixture.log" && break; sleep 0.3; done
cd "$R/worker"
npx -y wrangler@4 dev -c wrangler.toml --local --ip 127.0.0.1 --port $PORT --persist-to "$STATE" --test-scheduled \
  --show-interactive-dev-session=false \
  --var ALLOWED_ORIGIN:http://127.0.0.1:$FXPORT --var INSPIRE_TEST_FETCH_ALLOW:127.0.0.1:$FXPORT \
  --var FIKIR_BR:0 --var SB_ENABLED:0 --var FIKIR_IG_CRON_CHECKS:0 $VARS \
  --var FIKIR_BOARD_PASSWORD:$FIKIR_E2E_BOARD_PASSWORD \
  > "$OUT/logs/worker.log" 2>&1 &
WPID=$!
for i in {1..90}; do grep -q "Ready on" "$OUT/logs/worker.log" && break; sleep 1; done
VIDEO_E2E_STATE="$STATE" VIDEO_E2E_FX="http://127.0.0.1:$FXPORT" VIDEO_E2E_LOG="$OUT/logs/worker.log" VIDEO_E2E_DL="${VIDEO_E2E_DL:-$OUT/dl}" \
  node "$HERE/$SCRIPT" "http://127.0.0.1:$PORT"
RC=$?
kill $WPID 2>/dev/null; sleep 1; pkill -P $WPID 2>/dev/null
for i in {1..20}; do lsof -nP -iTCP:$PORT -sTCP:LISTEN >/dev/null || break; sleep 0.5; done
for pid in $(lsof -nP -t -iTCP:$PORT -sTCP:LISTEN 2>/dev/null); do kill $pid; done
kill $FXPID 2>/dev/null
for pid in $(lsof -nP -t -iTCP:$FXPORT -sTCP:LISTEN 2>/dev/null); do kill $pid; done
if grep -E "inspire (error|ig|download|cron|dl|live|play)" "$OUT/logs/worker.log" | grep -q .; then
  echo "worker log lines:"; grep -E "inspire (error|ig|download|cron|dl|live|play)" "$OUT/logs/worker.log" | head -40
fi
exit $RC
