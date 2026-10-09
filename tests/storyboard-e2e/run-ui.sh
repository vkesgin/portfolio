#!/bin/zsh
# usage: tests/storyboard-e2e/run-ui.sh <absolute path to puppeteer-core/lib/puppeteer/puppeteer-core.js>
# Fresh fake-AI worker (worker/wrangler.sbtest.toml, LOCAL TEST ONLY) on 8813 + static server for the repo root on 4733.
# Never uses port 8765. State, logs and screenshots go to $SB_E2E_OUT (default: $TMPDIR/fikir-sb-e2e).
# Board password: a TEST value (FIKIR_E2E_BOARD_PASSWORD, default test-board-pass) passed with --var and to sb-ui.mjs.
R="${0:A:h:h:h}"
HERE="${0:A:h}"
OUT="${SB_E2E_OUT:-${TMPDIR:-/tmp}/fikir-sb-e2e}"
PPT="$1"
export FIKIR_E2E_BOARD_PASSWORD="${FIKIR_E2E_BOARD_PASSWORD:-test-board-pass}"
for p in 8813 4733; do if lsof -nP -iTCP:$p -sTCP:LISTEN >/dev/null; then echo "port $p busy"; exit 1; fi; done
rm -rf "$OUT/state-ui"; mkdir -p "$OUT/logs"
cd "$R/worker"
npx -y wrangler@4 dev -c wrangler.sbtest.toml --local --ip 127.0.0.1 --port 8813 --persist-to "$OUT/state-ui" --show-interactive-dev-session=false --var SB_FAKE_DELAY_MS:1000 \
  --var FIKIR_BOARD_PASSWORD:$FIKIR_E2E_BOARD_PASSWORD > "$OUT/logs/worker-ui.log" 2>&1 &
WPID=$!
cd "$R"; python3 -m http.server 4733 --bind 127.0.0.1 > "$OUT/logs/static.log" 2>&1 &
SPID=$!
for i in {1..60}; do grep -q "Ready on" "$OUT/logs/worker-ui.log" && break; sleep 1; done
node "$HERE/sb-ui.mjs" http://127.0.0.1:4733 http://127.0.0.1:8813 "$OUT/ui-out" "$PPT"; RC=$?
kill $WPID $SPID 2>/dev/null; sleep 1; pkill -P $WPID 2>/dev/null
for p in 8813 4733; do for pid in $(lsof -nP -t -iTCP:$p -sTCP:LISTEN 2>/dev/null); do kill $pid; done; done
exit $RC
