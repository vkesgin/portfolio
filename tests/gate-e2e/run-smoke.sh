#!/bin/zsh
# usage: tests/gate-e2e/run-smoke.sh
# Board password gate end to end: a local worker (wrangler dev --local with worker/wrangler.toml, fresh state) on
# 127.0.0.1:8799, then gate-smoke.mjs. Test-only values are passed with --var (nothing is edited): a 127.0.0.1
# ALLOWED_ORIGIN, Browser Run and storyboards off, and the TEST board password (FIKIR_E2E_BOARD_PASSWORD, default
# test-board-pass; worker/.dev.vars holds the TEST JWT_SECRET / ADMIN_PASSWORD). State + logs in $GATE_E2E_OUT (default
# $TMPDIR/fikir-gate-e2e), never in the repo. Port: GATE_E2E_PORT (default 8799). Never 8765.
R="${0:A:h:h:h}"
HERE="${0:A:h}"
OUT="${GATE_E2E_OUT:-${TMPDIR:-/tmp}/fikir-gate-e2e}"
PORT="${GATE_E2E_PORT:-8799}"
export FIKIR_E2E_BOARD_PASSWORD="${FIKIR_E2E_BOARD_PASSWORD:-test-board-pass}"
[[ "$PORT" == 8765 ]] && { echo "never 8765"; exit 1; }
if lsof -nP -iTCP:$PORT -sTCP:LISTEN >/dev/null; then echo "port $PORT busy"; exit 1; fi
STATE="$OUT/state"; rm -rf "$STATE"; mkdir -p "$STATE" "$OUT/logs"
cd "$R/worker"
npx -y wrangler@4 dev -c wrangler.toml --local --ip 127.0.0.1 --port $PORT --persist-to "$STATE" \
  --show-interactive-dev-session=false \
  --var ALLOWED_ORIGIN:http://127.0.0.1:4719 --var FIKIR_BR:0 --var SB_ENABLED:0 --var FIKIR_IG_AUTO:off \
  --var FIKIR_BOARD_PASSWORD:$FIKIR_E2E_BOARD_PASSWORD \
  > "$OUT/logs/worker.log" 2>&1 &
WPID=$!
for i in {1..90}; do grep -q "Ready on" "$OUT/logs/worker.log" && break; sleep 1; done
GATE_E2E_STATE="$STATE" node "$HERE/gate-smoke.mjs" "http://127.0.0.1:$PORT"
RC=$?
kill $WPID 2>/dev/null; sleep 1; pkill -P $WPID 2>/dev/null
for i in {1..20}; do lsof -nP -iTCP:$PORT -sTCP:LISTEN >/dev/null || break; sleep 0.5; done
for pid in $(lsof -nP -t -iTCP:$PORT -sTCP:LISTEN 2>/dev/null); do kill $pid; done
if grep -E "inspire (error|gate|files sign)" "$OUT/logs/worker.log" | grep -q .; then
  echo "worker log lines:"; grep -E "inspire (error|gate|files sign)" "$OUT/logs/worker.log" | head -20
fi
exit $RC
