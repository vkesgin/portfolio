#!/bin/zsh
# usage: tests/storyboard-e2e/run-mode.sh <mode> [--var KEY:VALUE ...]
#   modes: main | fail_frame | fail_draft | fail_draft_quota | fail_quota | global_limit | capacity | ip_limit
#          | kpss | kpss_nopw | kpss_cutoff   (see sb-smoke.mjs for the --var each mode expects)
# Fake-AI worker (worker/wrangler.sbtest.toml, LOCAL TEST ONLY) on 127.0.0.1:8813 with a fresh local state per run.
# Never uses port 8765. State + logs go to $SB_E2E_OUT (default: $TMPDIR/fikir-sb-e2e), never into the repo.
R="${0:A:h:h:h}"                      # repo root
HERE="${0:A:h}"
OUT="${SB_E2E_OUT:-${TMPDIR:-/tmp}/fikir-sb-e2e}"
MODE="$1"; shift
PORT=8813
if lsof -nP -iTCP:$PORT -sTCP:LISTEN >/dev/null; then echo "port $PORT busy"; exit 1; fi
STATE="$OUT/state-$MODE"; rm -rf "$STATE"; mkdir -p "$STATE" "$OUT/logs"
cd "$R/worker"
if [[ "$MODE" == kpss* ]]; then
  # KPSS tables + rows the owner-login fix must handle (TEST values only), written before the worker's first request.
  npx -y wrangler@4 d1 execute vk-portfolio-sbtest --local -c wrangler.sbtest.toml --persist-to "$STATE" --file "$HERE/kpss-seed.sql" > "$OUT/logs/kpss-seed.log" 2>&1 \
    || { echo "kpss seed failed (see $OUT/logs/kpss-seed.log)"; exit 1; }
fi
npx -y wrangler@4 dev -c wrangler.sbtest.toml --local --ip 127.0.0.1 --port $PORT --persist-to "$STATE" --show-interactive-dev-session=false "$@" > "$OUT/logs/worker-$MODE.log" 2>&1 &
WPID=$!
for i in {1..60}; do grep -q "Ready on" "$OUT/logs/worker-$MODE.log" && break; sleep 1; done
node "$HERE/sb-smoke.mjs" "http://127.0.0.1:$PORT" "$MODE"; RC=$?
kill $WPID 2>/dev/null; sleep 1; pkill -P $WPID 2>/dev/null
for i in {1..20}; do lsof -nP -iTCP:$PORT -sTCP:LISTEN >/dev/null || break; sleep 0.5; done
for pid in $(lsof -nP -t -iTCP:$PORT -sTCP:LISTEN 2>/dev/null); do kill $pid; done
if [[ "$MODE" == kpss* && $RC == 0 ]]; then
  # Owner row after the run: an unusable value ('!' + 73 chars) - in kpss_nopw this is the one-time migration alone
  # (no owner login succeeded). The normal user's row is untouched. Only prefix/length are printed, never values.
  npx -y wrangler@4 d1 execute vk-portfolio-sbtest --local -c wrangler.sbtest.toml --persist-to "$STATE" --json \
    --command "SELECT username, substr(password,1,1) AS p0, length(password) AS len, password = 'kpss-user-test-pw' AS user_pw_kept FROM kpss_users ORDER BY id" > "$OUT/logs/kpss-rows-$MODE.json" 2>"$OUT/logs/kpss-rows-$MODE.err"
  node -e '
    const [file, mode] = process.argv.slice(1);
    const rows = JSON.parse(require("fs").readFileSync(file, "utf8"))[0].results;
    const own = rows.filter((r) => r.username === "vkesgin38"), usr = rows.find((r) => r.username === "kpss_user1");
    const hasAdmin = rows.some((r) => r.username === "admin");
    // kpss: the owner deleted his row and the next owner login took over the legacy admin row; other kpss_* modes: no takeover
    const ok = own.length === 1 && own[0].p0 === "!" && own[0].len === 73 && usr && usr.user_pw_kept === 1 && hasAdmin === (mode !== "kpss");
    console.log((ok ? "ok" : "not ok") + " kpss rows after the run: " + JSON.stringify(rows.map((r) => ({ u: r.username, p0: r.p0 === "!" ? "!" : "?", len: r.len }))));
    process.exit(ok ? 0 : 1);' "$OUT/logs/kpss-rows-$MODE.json" "$MODE"; RC=$?
fi
exit $RC
