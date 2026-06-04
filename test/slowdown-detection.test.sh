#!/usr/bin/env bash
#
# Deterministic unit/simulation tests for the privacy-suite slow-down detector
# (scripts/lib/slowdown-detect.sh). Runs in isolation against a temp history
# file — it does NOT execute the real privacy suite. Exits non-zero if any
# assertion fails.
#
# Run: bash test/slowdown-detection.test.sh

set -u

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# shellcheck source=scripts/lib/slowdown-detect.sh
source "${ROOT}/scripts/lib/slowdown-detect.sh"

if ! command -v jq >/dev/null 2>&1; then
  echo "SKIP: jq not available; cannot run slow-down detector tests."
  exit 0
fi

# Detection parameters mirror the defaults in run-privacy-tests.sh.
MIN_SECONDS=5
THRESHOLD="0.5"
MIN_BASELINE=3
WINDOW=10

TMP="$(mktemp -d)"
trap 'rm -rf "${TMP}"' EXIT
HIST="${TMP}/durations.json"

SUITE="test/example.test.ts"
PASS=0
FAIL=0

# verdict_of NOW → echoes the VERDICT (OK|WARN|FAIL) for the current HIST.
verdict_of() {
  local now=$1 result
  result="$(sd_evaluate "${HIST}" "${SUITE}" "${now}" \
    "${MIN_SECONDS}" "${THRESHOLD}" "${MIN_BASELINE}")"
  printf '%s' "${result%%|*}"
}

# assert_verdict DESC NOW EXPECTED — evaluate without recording.
assert_verdict() {
  local desc=$1 now=$2 expected=$3 got
  got="$(verdict_of "${now}")"
  if [ "${got}" = "${expected}" ]; then
    echo "  ✅ ${desc} (now=${now}s → ${got})"
    PASS=$((PASS + 1))
  else
    echo "  ❌ ${desc} (now=${now}s → expected ${expected}, got ${got})"
    FAIL=$((FAIL + 1))
  fi
}

# step DESC NOW EXPECTED — evaluate, assert, THEN record the run (mimics a real
# run: classify against history, then append to history).
step() {
  local desc=$1 now=$2 expected=$3
  assert_verdict "${desc}" "${now}" "${expected}"
  sd_history_append "${HIST}" "${SUITE}" "${now}" "${WINDOW}"
}

reset_hist() { rm -f "${HIST}"; }
seed() { local v; for v in "$@"; do sd_history_append "${HIST}" "${SUITE}" "${v}" "${WINDOW}"; done; }

echo "── median() ──"
assert_eq() {
  local desc=$1 got=$2 expected=$3
  if [ "${got}" = "${expected}" ]; then
    echo "  ✅ ${desc} (${got})"; PASS=$((PASS + 1))
  else
    echo "  ❌ ${desc} (expected ${expected}, got ${got})"; FAIL=$((FAIL + 1))
  fi
}
assert_eq "odd count median"  "$(printf '10\n30\n11\n' | median)" "11"
assert_eq "even count median" "$(printf '10\n20\n' | median)"     "15"
assert_eq "single value"      "$(printf '12\n' | median)"         "12"
assert_eq "outlier doesn't move median" "$(printf '10\n10\n10\n10\n90\n' | median)" "10"

echo ""
echo "── Scenario 1: a single one-off slow run never FAILs ──"
reset_hist
seed 10 10 10 10 10
# Baseline excludes the most recent (10): median of [10,10,10,10] = 10.
step "one-off spike is a WARN, not a FAIL" 30 "WARN"
step "back to normal is OK" 10 "OK"
step "another isolated spike is still only WARN" 28 "WARN"

echo ""
echo "── Scenario 2: a genuine SUSTAINED slow-down fails ──"
reset_hist
seed 10 10 10 10 10
step "first slow run warns" 30 "WARN"
step "second consecutive slow run FAILs (sustained)" 30 "FAIL"
step "third consecutive slow run still FAILs" 30 "FAIL"

echo ""
echo "── Scenario 3: reviewer counterexample (baseline must exclude prev) ──"
# A baseline that included the previous run would drift to ~15 after one slow
# sample and stop flagging at +33%. With prev excluded the baseline stays 10.
reset_hist
seed 10 10 10            # exactly MIN_BASELINE older points after first run
step "warm-up run records, no verdict expected yet" 10 "OK"
step "first 20s run warns" 20 "WARN"
step "second 20s run FAILs — NOT masked by baseline drift" 20 "FAIL"
step "third 20s run still FAILs" 20 "FAIL"

echo ""
echo "── Scenario 4: insufficient history never flags ──"
reset_hist
seed 10                  # only 1 entry → 0 older baseline points
assert_verdict "no baseline yet → OK" 30 "OK"
seed 10                  # now 2 entries → 1 older point (< MIN_BASELINE=3)
assert_verdict "below MIN_BASELINE older points → OK" 30 "OK"

echo ""
echo "── Scenario 5: fast suites (< MIN_SECONDS) are ignored ──"
reset_hist
seed 1 1 1 1 1
assert_verdict "tiny absolute time → OK even if 4x slower" 4 "OK"

echo ""
echo "── Scenario 6: legacy single-number history is read & upgraded ──"
reset_hist
printf '{"suites":{"%s":10}}\n' "${SUITE}" > "${HIST}"
# Legacy file = 1 entry → 0 older points, so first comparison can't flag.
assert_verdict "legacy single value → OK (insufficient older points)" 30 "OK"
sd_history_append "${HIST}" "${SUITE}" 30 "${WINDOW}"
upgraded="$(jq -c --arg s "${SUITE}" '.suites[$s]' "${HIST}")"
assert_eq "legacy value upgraded to list" "${upgraded}" "[10,30]"

echo ""
echo "── Scenario 7: rolling window caps history length ──"
reset_hist
seed 1 2 3 4 5 6 7 8 9 10 11 12      # 12 appends, WINDOW=10
len="$(jq --arg s "${SUITE}" '.suites[$s] | length' "${HIST}")"
first="$(jq -r --arg s "${SUITE}" '.suites[$s][0]' "${HIST}")"
assert_eq "history capped to WINDOW" "${len}" "10"
assert_eq "oldest entries dropped" "${first}" "3"

echo ""
echo "════════════════════════════════════════════════════════════════════════"
echo "Passed: ${PASS}   Failed: ${FAIL}"
if [ "${FAIL}" -gt 0 ]; then
  echo "🚨 slow-down detector tests FAILED"
  exit 1
fi
echo "🎉 all slow-down detector tests passed"
exit 0
