#!/bin/zsh
# usage: TAGS_E2E_PUPPETEER=<dir with node_modules/puppeteer-core> tests/tags-e2e/run-smoke.sh
# Company tags ("Firma") acceptance smoke (tags-smoke.mjs) in headless Chrome against a local `wrangler dev --local` with
# worker/wrangler.toml as it is (fresh state; R2 copies off as the owner set them) + tests/media-e2e/fixture-server.mjs as
# Instagram (INSPIRE_TEST_IG=1: every Instagram / Meta fetch of the worker goes to the fixture, nothing reaches Instagram).
# Test-only values are passed with --var; nothing is edited: a 127.0.0.1 ALLOWED_ORIGIN, the fetch allow for the fixture,
# Browser Run off, the fake storyboard AI + Tavily (SB_FAKE_AI / SB_FAKE_TAVILY: no model, no network), the TEST board
# password (FIKIR_E2E_BOARD_PASSWORD, default test-board-pass) and a TEST admin password (TAGS_E2E_ADMIN_PASSWORD, default
# tags-e2e-admin). Chrome resolves no host but 127.0.0.1. The scripts never read worker/.dev.vars.
# Ports: worker 8861 (TAGS_E2E_PORT), board page 4761 (TAGS_E2E_WEBPORT), fixture server 4762 (TAGS_E2E_FXPORT). Never 8765.
# State, logs and screenshots in $TAGS_E2E_OUT (default $TMPDIR/fikir-tags-e2e); screenshots in $TAGS_E2E_SHOTS ($OUT/shots).
R="${0:A:h:h:h}"
HERE="${0:A:h}"
OUT="${TAGS_E2E_OUT:-${TMPDIR:-/tmp}/fikir-tags-e2e}"
PORT="${TAGS_E2E_PORT:-8861}"
FXPORT="${TAGS_E2E_FXPORT:-4762}"
export TAGS_E2E_WEBPORT="${TAGS_E2E_WEBPORT:-4761}"
export FIKIR_E2E_BOARD_PASSWORD="${FIKIR_E2E_BOARD_PASSWORD:-test-board-pass}"
export TAGS_E2E_ADMIN_PASSWORD="${TAGS_E2E_ADMIN_PASSWORD:-tags-e2e-admin}"
export TAGS_E2E_SHOTS="${TAGS_E2E_SHOTS:-$OUT/shots}"
for p in $PORT $FXPORT $TAGS_E2E_WEBPORT; do
  [[ "$p" == 8765 ]] && { echo "never 8765"; exit 1; }
  if lsof -nP -iTCP:$p -sTCP:LISTEN >/dev/null; then echo "port $p busy"; exit 1; fi
done
STATE="$OUT/state"; rm -rf "$STATE" "$TAGS_E2E_SHOTS"; mkdir -p "$STATE" "$OUT/logs" "$TAGS_E2E_SHOTS"
node "$R/tests/media-e2e/fixture-server.mjs" $FXPORT > "$OUT/logs/fixture.log" 2>&1 &
FXPID=$!
for i in {1..20}; do grep -q "fixture server" "$OUT/logs/fixture.log" && break; sleep 0.3; done
cd "$R/worker"
npx -y wrangler@4 dev -c wrangler.toml --local --ip 127.0.0.1 --port $PORT --persist-to "$STATE" \
  --show-interactive-dev-session=false \
  --var ALLOWED_ORIGIN:http://127.0.0.1:$TAGS_E2E_WEBPORT --var INSPIRE_TEST_FETCH_ALLOW:127.0.0.1:$FXPORT --var INSPIRE_TEST_IG:1 \
  --var FIKIR_BR:0 --var FIKIR_IG_AUTO:off --var FIKIR_IG_CRON_CHECKS:0 \
  --var SB_ENABLED:1 --var SB_ADMIN_ONLY:0 --var SB_FAKE_AI:1 --var SB_FAKE_TAVILY:1 --var SB_FAKE_DELAY_MS:300 \
  --var FIKIR_BOARD_PASSWORD:$FIKIR_E2E_BOARD_PASSWORD --var ADMIN_PASSWORD:$TAGS_E2E_ADMIN_PASSWORD \
  > "$OUT/logs/worker.log" 2>&1 &
WPID=$!
for i in {1..90}; do grep -q "Ready on" "$OUT/logs/worker.log" && break; sleep 1; done
TAGS_E2E_FX="http://127.0.0.1:$FXPORT" node "$HERE/tags-smoke.mjs" "http://127.0.0.1:$PORT"
RC=$?
kill $WPID 2>/dev/null; sleep 1; pkill -P $WPID 2>/dev/null
for i in {1..20}; do lsof -nP -iTCP:$PORT -sTCP:LISTEN >/dev/null || break; sleep 0.5; done
kill $FXPID 2>/dev/null
for p in $PORT $FXPORT $TAGS_E2E_WEBPORT; do for pid in $(lsof -nP -t -iTCP:$p -sTCP:LISTEN 2>/dev/null); do kill $pid; done; done
if grep -E "inspire (error|gate)" "$OUT/logs/worker.log" | grep -q .; then
  echo "worker log lines:"; grep -E "inspire (error|gate)" "$OUT/logs/worker.log" | head -40
fi
exit $RC
