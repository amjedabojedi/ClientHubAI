#!/usr/bin/env bash
#
# Integration-style simulation for the privacy-suite slow-down detector's
# cross-run persistence (the fix that lets CI actually FAIL on a *newly
# introduced* sustained slow-down even on ephemeral checkouts).
#
# It does NOT run the real privacy suite, and it does NOT touch real object
# storage. Instead it faithfully replays what run-privacy-tests.sh does each
# run, against a temp "remote store" file standing in for object storage:
#
#   per run (each a FRESH checkout — local history starts empty):
#     1. pull:   restore history from the remote store if present
#     2. seed:   else cold-start from the committed baseline
#     3. classify the current duration against the restored/seeded history
#     4. append the current duration
#     5. push:   save the updated history back to the remote store (only on a
#                clean run, mirroring the real "no failed suite" gate)
#
# The key property under test: the "previous run" survives across independent
# fresh checkouts via the store, so a sustained slow-down trips FAIL on run 2.
#
# Run: bash test/privacy-baseline-persistence.test.sh

set -u

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# shellcheck source=scripts/lib/slowdown-detect.sh
source "${ROOT}/scripts/lib/slowdown-detect.sh"

if ! command -v jq >/dev/null 2>&1; then
  echo "SKIP: jq not available; cannot run persistence simulation."
  exit 0
fi

# Detection parameters mirror run-privacy-tests.sh defaults.
MIN_SECONDS=5
THRESHOLD="0.5"
MIN_BASELINE=3
WINDOW=10

SUITE="test/example.test.ts"
TMP="$(mktemp -d)"
trap 'rm -rf "${TMP}"' EXIT

REMOTE="${TMP}/remote-store.json"     # stands in for object storage
BASELINE="${TMP}/committed-baseline.json"
# Committed cold-start baseline: a known-good (fast) history for the suite.
printf '{"suites":{"%s":[10,10,10,10,10,10]}}\n' "${SUITE}" > "${BASELINE}"

PASS=0
FAIL=0

# simulate_run NOW [clean] — replays one full fresh-checkout run and echoes the
# verdict. When the 2nd arg is "dirty" the run is treated as having a failed
# suite, so it does NOT push (mirrors the real no-poison-on-failure gate).
simulate_run() {
  local now=$1 mode=${2:-clean}
  local local_hist="${TMP}/local-$$-${RANDOM}.json"
  rm -f "${local_hist}"

  # 1. pull (restore previous run's history if the store has it)
  if [ -f "${REMOTE}" ]; then
    cp "${REMOTE}" "${local_hist}"
  fi
  # 2. cold-start seed if still empty
  local count=0
  [ -f "${local_hist}" ] && count="$(jq -r '(.suites // {}) | length' "${local_hist}" 2>/dev/null || echo 0)"
  if [ "${count:-0}" -eq 0 ]; then
    cp "${BASELINE}" "${local_hist}"
  fi

  # 3. classify BEFORE recording (same ordering as the real runner)
  local result verdict
  result="$(sd_evaluate "${local_hist}" "${SUITE}" "${now}" \
    "${MIN_SECONDS}" "${THRESHOLD}" "${MIN_BASELINE}")"
  verdict="${result%%|*}"

  # 4. append this run's duration
  sd_history_append "${local_hist}" "${SUITE}" "${now}" "${WINDOW}"

  # 5. push back to the store (skip on a "dirty"/failed run)
  if [ "${mode}" = "clean" ]; then
    cp "${local_hist}" "${REMOTE}"
  fi

  rm -f "${local_hist}"
  printf '%s' "${verdict}"
}

assert() {
  local desc=$1 got=$2 expected=$3
  if [ "${got}" = "${expected}" ]; then
    echo "  ✅ ${desc} (${got})"; PASS=$((PASS + 1))
  else
    echo "  ❌ ${desc} (expected ${expected}, got ${got})"; FAIL=$((FAIL + 1))
  fi
}

echo "── A newly-introduced sustained slow-down is caught across fresh checkouts ──"
rm -f "${REMOTE}"
assert "run 1 (fresh, empty store) slow run only WARNs"        "$(simulate_run 30)" "WARN"
assert "run 2 (fresh, store has slow prev) slow run FAILs"      "$(simulate_run 30)" "FAIL"
assert "run 3 (still slow) keeps FAILing"                       "$(simulate_run 30)" "FAIL"

echo ""
echo "── A one-off slow run does NOT fail (store carries a normal prev) ──"
rm -f "${REMOTE}"
assert "run 1 normal is OK"                                     "$(simulate_run 10)" "OK"
assert "run 2 one-off spike only WARNs"                         "$(simulate_run 30)" "WARN"
assert "run 3 back to normal is OK"                             "$(simulate_run 10)" "OK"

echo ""
echo "── A failed run does NOT poison the persisted history ──"
rm -f "${REMOTE}"
assert "run 1 normal is OK"                                     "$(simulate_run 10)" "OK"
# A slow but FAILED run must not push, so the store's prev stays normal and the
# next clean slow run is still treated as a one-off (WARN), not sustained.
simulate_run 30 dirty >/dev/null
assert "next clean slow run is only WARN (failed run was not persisted)" "$(simulate_run 30)" "WARN"

echo ""
echo "── Without persistence, every fresh run re-seeds and can only WARN ──"
# Demonstrates WHY persistence is required: if the store never carries the
# previous run forward, the cold-start baseline is always "good" and a sustained
# slow-down can never be confirmed — exactly the gap this task closes.
no_persist_run() {
  local now=$1 local_hist="${TMP}/np-$$-${RANDOM}.json"
  rm -f "${local_hist}"
  cp "${BASELINE}" "${local_hist}"   # always cold-start, never restore
  local result
  result="$(sd_evaluate "${local_hist}" "${SUITE}" "${now}" \
    "${MIN_SECONDS}" "${THRESHOLD}" "${MIN_BASELINE}")"
  rm -f "${local_hist}"
  printf '%s' "${result%%|*}"
}
assert "no-persistence run 1 slow → WARN"                      "$(no_persist_run 30)" "WARN"
assert "no-persistence run 2 slow → still only WARN (the bug)" "$(no_persist_run 30)" "WARN"

echo ""
echo "════════════════════════════════════════════════════════════════════════"
echo "Passed: ${PASS}   Failed: ${FAIL}"
if [ "${FAIL}" -gt 0 ]; then
  echo "🚨 persistence simulation FAILED"
  exit 1
fi
echo "🎉 persistence simulation passed"
exit 0
