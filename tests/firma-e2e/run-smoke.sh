#!/bin/zsh
# usage: FIRMA_E2E_PUPPETEER=<dir with node_modules/puppeteer-core> tests/firma-e2e/run-smoke.sh
# Company tags ("Firma") on the board in headless Chrome (firma-smoke.mjs) against a local `wrangler dev --local` with
# worker/wrangler.toml as it is (fresh state). Test-only values are passed with --var; nothing is edited: 127.0.0.1
# ALLOWED_ORIGIN, Browser Run / storyboards / Instagram auto-copies off, the TEST board password (FIKIR_E2E_BOARD_PASSWORD,
# default test-board-pass) and a TEST admin password (FIRMA_E2E_ADMIN_PASSWORD, default firma-e2e-admin). Text ideas only:
# the worker fetches nothing, and Chrome resolves no host but 127.0.0.1.
# Ports: worker 8851 (FIRMA_E2E_PORT), board page 4751 (FIRMA_E2E_WEBPORT). Never 8765.
# State, logs and screenshots in $FIRMA_E2E_OUT (default $TMPDIR/fikir-firma-e2e); screenshots in $OUT/shots.
R="${0:A:h:h:h}"
HERE="${0:A:h}"
OUT="${FIRMA_E2E_OUT:-${TMPDIR:-/tmp}/fikir-firma-e2e}"
PORT="${FIRMA_E2E_PORT:-8851}"
export FIRMA_E2E_WEBPORT="${FIRMA_E2E_WEBPORT:-4751}"
export FIKIR_E2E_BOARD_PASSWORD="${FIKIR_E2E_BOARD_PASSWORD:-test-board-pass}"
export FIRMA_E2E_ADMIN_PASSWORD="${FIRMA_E2E_ADMIN_PASSWORD:-firma-e2e-admin}"
export FIRMA_E2E_SHOTS="${FIRMA_E2E_SHOTS:-$OUT/shots}"
[[ "$PORT" == 8765 || "$FIRMA_E2E_WEBPORT" == 8765 ]] && { echo "never 8765"; exit 1; }
for p in $PORT $FIRMA_E2E_WEBPORT; do if lsof -nP -iTCP:$p -sTCP:LISTEN >/dev/null; then echo "port $p busy"; exit 1; fi; done
STATE="$OUT/state"; rm -rf "$STATE" "$FIRMA_E2E_SHOTS"; mkdir -p "$STATE" "$OUT/logs" "$FIRMA_E2E_SHOTS"
cd "$R/worker"
npx -y wrangler@4 dev -c wrangler.toml --local --ip 127.0.0.1 --port $PORT --persist-to "$STATE" \
  --show-interactive-dev-session=false \
  --var ALLOWED_ORIGIN:http://127.0.0.1:$FIRMA_E2E_WEBPORT --var FIKIR_BR:0 --var SB_ENABLED:0 --var FIKIR_IG_AUTO:off \
  --var FIKIR_BOARD_PASSWORD:$FIKIR_E2E_BOARD_PASSWORD --var ADMIN_PASSWORD:$FIRMA_E2E_ADMIN_PASSWORD \
  > "$OUT/logs/worker.log" 2>&1 &
WPID=$!
for i in {1..90}; do grep -q "Ready on" "$OUT/logs/worker.log" && break; sleep 1; done
node "$HERE/firma-smoke.mjs" "http://127.0.0.1:$PORT"
RC=$?
kill $WPID 2>/dev/null; sleep 1; pkill -P $WPID 2>/dev/null
for i in {1..20}; do lsof -nP -iTCP:$PORT -sTCP:LISTEN >/dev/null || break; sleep 0.5; done
for p in $PORT $FIRMA_E2E_WEBPORT; do for pid in $(lsof -nP -t -iTCP:$p -sTCP:LISTEN 2>/dev/null); do kill $pid; done; done
if grep -E "inspire (error|gate)" "$OUT/logs/worker.log" | grep -q .; then
  echo "worker log lines:"; grep -E "inspire (error|gate)" "$OUT/logs/worker.log" | head -40
fi
exit $RC
