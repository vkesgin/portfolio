#!/bin/zsh
# usage: tests/media-e2e/run-smoke.sh [mode ...]        modes: main brquota brlimit (default: all three)
# Local worker (wrangler dev --local, fresh state per mode) + fixture-server.mjs on 127.0.0.1:4742, then media-smoke.mjs.
# Defaults: worker/wrangler.mediatest.toml (LOCAL TEST ONLY) on port 8821, state + logs in $MEDIA_E2E_OUT
# (default $TMPDIR/fikir-media-e2e), never in the repo. Never uses port 8765.
#   MEDIA_E2E_PORT=8799 MEDIA_E2E_CONFIG=wrangler.toml  runs the production config instead; the test values
#   (127.0.0.1 ALLOWED_ORIGIN, fetch allow, fake Browser Run, caps) are then passed with --var, nothing is edited.
#   MEDIA_E2E_FXPORT=<port> moves the fixture server (default 4742; the fetch allow follows it via --var).
#   Board password: a TEST value (FIKIR_E2E_BOARD_PASSWORD, default test-board-pass) passed with --var and to the smoke.
R="${0:A:h:h:h}"                      # repo root
HERE="${0:A:h}"
OUT="${MEDIA_E2E_OUT:-${TMPDIR:-/tmp}/fikir-media-e2e}"
PORT="${MEDIA_E2E_PORT:-8821}"
FXPORT="${MEDIA_E2E_FXPORT:-4742}"
CONFIG="${MEDIA_E2E_CONFIG:-wrangler.mediatest.toml}"
export FIKIR_E2E_BOARD_PASSWORD="${FIKIR_E2E_BOARD_PASSWORD:-test-board-pass}"
[[ "$PORT" == 8765 || "$FXPORT" == 8765 ]] && { echo "never 8765"; exit 1; }
if [[ "$CONFIG" == wrangler.toml ]]; then DB=vk-portfolio; else DB=vk-portfolio-mediatest; fi
MODES=("$@"); (( ${#MODES} )) || MODES=(main brquota brlimit)
for p in $PORT $FXPORT; do if lsof -nP -iTCP:$p -sTCP:LISTEN >/dev/null; then echo "port $p busy"; exit 1; fi; done
mkdir -p "$OUT/logs"
node "$HERE/fixture-server.mjs" $FXPORT > "$OUT/logs/fixture.log" 2>&1 &
FXPID=$!
for i in {1..20}; do grep -q "fixture server" "$OUT/logs/fixture.log" && break; sleep 0.3; done
RC=0
for MODE in $MODES; do
  STATE="$OUT/state-$MODE"; rm -rf "$STATE"; mkdir -p "$STATE"
  curl -s -X POST "http://127.0.0.1:$FXPORT/__br/reset" >/dev/null
  VARS=(--var FIKIR_BOARD_PASSWORD:$FIKIR_E2E_BOARD_PASSWORD)
  [[ "$FXPORT" != 4742 && "$CONFIG" != wrangler.toml ]] && VARS+=(--var INSPIRE_TEST_FETCH_ALLOW:127.0.0.1:$FXPORT)
  if [[ "$CONFIG" == wrangler.toml ]]; then
    VARS+=(--var ALLOWED_ORIGIN:http://127.0.0.1:4741 --var INSPIRE_TEST_FETCH_ALLOW:127.0.0.1:$FXPORT --var INSPIRE_FAKE_BR:1
           --var FIKIR_BR:1 --var FIKIR_BR_DAILY:3 --var FIKIR_BR_PER_CID:2 --var FIKIR_BR_PER_IP:3 --var FIKIR_MEDIA_UPLOADS:all
           --var FIKIR_UP_PER_CID_N:3 --var FIKIR_UP_PER_CID_MB:3 --var FIKIR_UP_PER_IP_N:5 --var SB_ENABLED:0)
  fi
  case $MODE in
    main) VARS+=(--var FIKIR_BR_DAILY:20) ;;
    brquota) VARS+=(--var FIKIR_MEDIA_UPLOADS:admin) ;;
  esac
  cd "$R/worker"
  npx -y wrangler@4 dev -c "$CONFIG" --local --ip 127.0.0.1 --port $PORT --persist-to "$STATE" --test-scheduled \
    --show-interactive-dev-session=false $VARS > "$OUT/logs/worker-$MODE.log" 2>&1 &
  WPID=$!
  for i in {1..60}; do grep -q "Ready on" "$OUT/logs/worker-$MODE.log" && break; sleep 1; done
  MEDIA_E2E_STATE="$STATE" MEDIA_E2E_CONFIG="$CONFIG" MEDIA_E2E_DB="$DB" MEDIA_E2E_FX="http://127.0.0.1:$FXPORT" node "$HERE/media-smoke.mjs" "http://127.0.0.1:$PORT" "$MODE" || RC=1
  kill $WPID 2>/dev/null; sleep 1; pkill -P $WPID 2>/dev/null
  for i in {1..20}; do lsof -nP -iTCP:$PORT -sTCP:LISTEN >/dev/null || break; sleep 0.5; done
  for pid in $(lsof -nP -t -iTCP:$PORT -sTCP:LISTEN 2>/dev/null); do kill $pid; done
  if grep -E "inspire (error|br|cron|upload|quota)" "$OUT/logs/worker-$MODE.log" | grep -v "inspire br quota" | grep -q .; then
    echo "worker log lines (mode $MODE):"; grep -E "inspire (error|br|cron|upload|quota)" "$OUT/logs/worker-$MODE.log" | head -20
  fi
done
kill $FXPID 2>/dev/null
for pid in $(lsof -nP -t -iTCP:$FXPORT -sTCP:LISTEN 2>/dev/null); do kill $pid; done
exit $RC
