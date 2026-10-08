#!/bin/zsh
# usage: tests/video-e2e/run-smoke.sh            (VIDEO_E2E_REAL_IG=1 also talks to the real Instagram, see video-smoke.mjs)
#        VIDEO_E2E_SCRIPT=platform-smoke.mjs VIDEO_E2E_REAL=1 tests/video-e2e/run-smoke.sh   (real downloads of every platform)
# Local worker (wrangler dev --local with worker/wrangler.toml, fresh state) + tests/media-e2e/fixture-server.mjs, then
# video-smoke.mjs. Test-only values (127.0.0.1 ALLOWED_ORIGIN, fetch allow for the fixture server, Browser Run off,
# storyboards off) are passed with --var; nothing is edited. State + logs in $VIDEO_E2E_OUT (default $TMPDIR/fikir-video-e2e).
# Ports: worker 8841, fixture server 4741 (VIDEO_E2E_PORT / VIDEO_E2E_FXPORT). Never 8765.
R="${0:A:h:h:h}"
HERE="${0:A:h}"
OUT="${VIDEO_E2E_OUT:-${TMPDIR:-/tmp}/fikir-video-e2e}"
PORT="${VIDEO_E2E_PORT:-8841}"
FXPORT="${VIDEO_E2E_FXPORT:-4741}"
[[ "$PORT" == 8765 || "$FXPORT" == 8765 ]] && { echo "never 8765"; exit 1; }
for p in $PORT $FXPORT; do if lsof -nP -iTCP:$p -sTCP:LISTEN >/dev/null; then echo "port $p busy"; exit 1; fi; done
STATE="$OUT/state"; rm -rf "$STATE"; mkdir -p "$STATE" "$OUT/logs"
node "$R/tests/media-e2e/fixture-server.mjs" $FXPORT > "$OUT/logs/fixture.log" 2>&1 &
FXPID=$!
for i in {1..20}; do grep -q "fixture server" "$OUT/logs/fixture.log" && break; sleep 0.3; done
cd "$R/worker"
npx -y wrangler@4 dev -c wrangler.toml --local --ip 127.0.0.1 --port $PORT --persist-to "$STATE" --test-scheduled \
  --show-interactive-dev-session=false \
  --var ALLOWED_ORIGIN:http://127.0.0.1:$FXPORT --var INSPIRE_TEST_FETCH_ALLOW:127.0.0.1:$FXPORT \
  --var FIKIR_BR:0 --var SB_ENABLED:0 --var FIKIR_IG_AUTO:blocked --var FIKIR_IG_CRON_CHECKS:0 \
  > "$OUT/logs/worker.log" 2>&1 &
WPID=$!
for i in {1..90}; do grep -q "Ready on" "$OUT/logs/worker.log" && break; sleep 1; done
VIDEO_E2E_STATE="$STATE" VIDEO_E2E_FX="http://127.0.0.1:$FXPORT" VIDEO_E2E_LOG="$OUT/logs/worker.log" VIDEO_E2E_DL="${VIDEO_E2E_DL:-$OUT/dl}" \
  node "$HERE/${VIDEO_E2E_SCRIPT:-video-smoke.mjs}" "http://127.0.0.1:$PORT"
RC=$?
kill $WPID 2>/dev/null; sleep 1; pkill -P $WPID 2>/dev/null
for i in {1..20}; do lsof -nP -iTCP:$PORT -sTCP:LISTEN >/dev/null || break; sleep 0.5; done
for pid in $(lsof -nP -t -iTCP:$PORT -sTCP:LISTEN 2>/dev/null); do kill $pid; done
kill $FXPID 2>/dev/null
for pid in $(lsof -nP -t -iTCP:$FXPORT -sTCP:LISTEN 2>/dev/null); do kill $pid; done
if grep -E "inspire (error|ig|download|cron|dl)" "$OUT/logs/worker.log" | grep -q .; then
  echo "worker log lines:"; grep -E "inspire (error|ig|download|cron|dl)" "$OUT/logs/worker.log" | head -40
fi
exit $RC
