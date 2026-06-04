#!/usr/bin/env bash
#
# Deterministic unit tests for the committed cold-start baseline auto-refresh
# logic (sd_baseline_refresh_mode / sd_refresh_baseline_if_changed in
# scripts/lib/slowdown-detect.sh). Runs in isolation against temp JSON files —
# it does NOT execute the real privacy suite or touch object storage. Exits
# non-zero if any assertion fails.
#
# Why this exists: the auto-refresh keeps scripts/privacy-test-baseline.json
# fresh without manual upkeep. Its single most important guarantee is that a
# genuine SUSTAINED slow-down is NEVER silently absorbed into the committed
# baseline (it must fail CI and be fixed/re-blessed first). These tests pin that
# behavior, plus the no-churn "only rewrite when numbers changed" optimization.
#
# Run: bash test/baseline-refresh.test.sh

set -u

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# shellcheck source=scripts/lib/slowdown-detect.sh
source "${ROOT}/scripts/lib/slowdown-detect.sh"

if ! command -v jq >/dev/null 2>&1; then
  echo "SKIP: jq not available; cannot run baseline-refresh tests."
  exit 0
fi

PASS=0
FAIL=0

# assert_mode DESC FAILED SLOWDOWN UPDATE AUTO EXPECTED
assert_mode() {
  local desc=$1 failed=$2 slow=$3 update=$4 auto=$5 expected=$6 got
  got="$(sd_baseline_refresh_mode "${failed}" "${slow}" "${update}" "${auto}")"
  if [ "${got}" = "${expected}" ]; then
    echo "  ✅ ${desc} → ${got}"
    PASS=$((PASS + 1))
  else
    echo "  ❌ ${desc} → expected ${expected}, got ${got}"
    FAIL=$((FAIL + 1))
  fi
}

echo "▶ sd_baseline_refresh_mode (FAILED|SLOWDOWN|UPDATE|AUTO):"

# AUTO path: refresh only on a fully green run.
assert_mode "green run, AUTO on"                       0 0 0 1 AUTO
assert_mode "green run, AUTO off, UPDATE off"          0 0 0 0 NONE

# THE safety guarantee: a sustained slow-down must NOT auto-refresh.
assert_mode "sustained slow-down, AUTO on → NOT absorbed" 0 1 0 1 NONE

# A failed suite must never write the baseline, regardless of flags.
assert_mode "failed suite, AUTO on"                    1 0 0 1 NONE
assert_mode "failed suite, UPDATE on"                  1 0 1 0 NONE
assert_mode "failed suite, both flags"                 1 1 1 1 NONE

# Manual re-bless deliberately absorbs new numbers even on a slow-down.
assert_mode "UPDATE on, no slow-down"                  0 0 1 0 UPDATE
assert_mode "UPDATE on, slow-down (deliberate absorb)" 0 1 1 0 UPDATE

# UPDATE takes precedence over AUTO when both are set.
assert_mode "UPDATE+AUTO, slow-down → UPDATE wins"     0 1 1 1 UPDATE

echo ""
echo "▶ sd_refresh_baseline_if_changed (change-only copy):"

TMP="$(mktemp -d)"
trap 'rm -rf "${TMP}"' EXIT
HIST="${TMP}/durations.json"
BASE="${TMP}/baseline.json"

assert_copy() {
  local desc=$1 expected=$2 got=$3
  if [ "${got}" = "${expected}" ]; then
    echo "  ✅ ${desc} → ${got}"
    PASS=$((PASS + 1))
  else
    echo "  ❌ ${desc} → expected ${expected}, got ${got}"
    FAIL=$((FAIL + 1))
  fi
}

# No history yet → SKIP, baseline untouched.
rm -f "${HIST}" "${BASE}"
out="$(sd_refresh_baseline_if_changed "${HIST}" "${BASE}")"
assert_copy "no rolling history" "SKIP" "${out}"
if [ -f "${BASE}" ]; then
  echo "  ❌ baseline was created from missing history"; FAIL=$((FAIL + 1))
else
  echo "  ✅ baseline not created when history missing"; PASS=$((PASS + 1))
fi

# History present, baseline missing → REFRESHED (writes it).
echo '{"updated":"t1","suites":{"a.test.ts":[6,6,6]}}' > "${HIST}"
out="$(sd_refresh_baseline_if_changed "${HIST}" "${BASE}")"
assert_copy "baseline missing, history present" "REFRESHED" "${out}"

# Same suite numbers but a NEWER timestamp → NOCHANGE (no churn).
echo '{"updated":"t2-LATER","suites":{"a.test.ts":[6,6,6]}}' > "${HIST}"
out="$(sd_refresh_baseline_if_changed "${HIST}" "${BASE}")"
assert_copy "same numbers, newer timestamp" "NOCHANGE" "${out}"
if grep -q '"t1"' "${BASE}"; then
  echo "  ✅ baseline left byte-for-byte unchanged on NOCHANGE"; PASS=$((PASS + 1))
else
  echo "  ❌ baseline was rewritten despite identical numbers"; FAIL=$((FAIL + 1))
fi

# Numbers actually drifted → REFRESHED and the new numbers are written.
echo '{"updated":"t3","suites":{"a.test.ts":[6,6,7,8]}}' > "${HIST}"
out="$(sd_refresh_baseline_if_changed "${HIST}" "${BASE}")"
assert_copy "numbers drifted" "REFRESHED" "${out}"
if [ "$(jq -c '.suites["a.test.ts"]' "${BASE}")" = "[6,6,7,8]" ]; then
  echo "  ✅ drifted numbers written to baseline"; PASS=$((PASS + 1))
else
  echo "  ❌ drifted numbers NOT written to baseline"; FAIL=$((FAIL + 1))
fi

echo ""
echo "════════════════════════════════════════════════════════════════════════"
echo "Baseline-refresh tests: ${PASS} passed, ${FAIL} failed."
if [ "${FAIL}" -gt 0 ]; then
  echo "🚨 baseline-refresh tests FAILED."
  exit 1
fi
echo "🎉 All baseline-refresh tests passed!"
exit 0
