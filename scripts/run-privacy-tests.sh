#!/usr/bin/env bash
#
# Runs the full privacy/regression test suite list one suite at a time.
#
# Unlike chaining the suites with `&&` (which aborts at the first failure and
# hides the status of every later suite), this runner executes ALL suites even
# when one fails, then prints a summary of which passed and which failed. The
# overall exit code is non-zero if any suite failed.
#
# The suites are run serially (never in parallel) because they share live
# database state and race on generated identifiers when run concurrently.

set -u

# Pure slow-down detection helpers (median / baseline / classify / history),
# extracted so they can be unit-tested without running the real suite.
# shellcheck source=scripts/lib/slowdown-detect.sh
source "$(dirname "${BASH_SOURCE[0]}")/lib/slowdown-detect.sh"

SUITES=(
  "test/communications-transcribe-privacy.test.ts"
  "test/communications-transcribe-recovery.test.ts"
  "test/session-transcribe-privacy.test.ts"
  "test/assessment-report-privacy.test.ts"
  "test/client-report-privacy.test.ts"
  "test/client-report-source-selection.test.ts"
  "test/client-report-template-defaults.test.ts"
  "test/supporting-files-authz.test.ts"
  "test/supporting-files-download-authz.test.ts"
  "test/supporting-files-download-audit.test.ts"
  "test/supporting-files-delete-denial-audit.test.ts"
  "test/supporting-files-upload-validation.test.ts"
  "test/daily-schedule-email-privacy.test.ts"
  "test/daily-schedule-email-idempotency.test.ts"
  "test/daily-schedule-email-preference.test.ts"
  "test/daily-schedule-email-preference-api.test.ts"
  "test/notification-preferences-ui.test.ts"
  "test/notification-preferences-mute.test.ts"
  "test/notification-specific-users.test.ts"
  "test/deferred-summary-email.test.ts"
  "test/quiet-hours-suppression.test.ts"
  "test/quiet-hours-settings-save.test.ts"
  "test/defer-summary-settings-save.test.ts"
  "test/quiet-hours-summary-toggle-ui.test.ts"
  "test/quiet-hours-window-inputs-ui.test.ts"
  "test/quiet-hours-summary-toggle-save-ui.test.ts"
  "test/portal-document-download-ui.test.ts"
  "test/client-detail-drawers-ui.test.ts"
  "test/client-detail-drawers-submit.test.ts"
  "test/record-drawer-back-button-ui.test.ts"
  "test/record-drawer-real-ui.test.ts"
  "test/session-edit-drawers-ui.test.ts"
)

PASSED=()
FAILED=()

# Parallel arrays keyed by suite index: how long each suite took (whole
# seconds) and a "slowest-first" view assembled after the run.
DURATIONS=()

# Where per-suite durations are persisted, so this run can flag suites that
# have gotten significantly slower over time. Lives under .local/ (untracked
# working state) and is keyed by suite path. Each suite stores a rolling list
# of its most recent durations (oldest first), e.g. {"suites": {"a.test.ts":
# [12, 13, 11]}}. Legacy files that stored a single number per suite are read
# transparently as a one-element list.
HISTORY_FILE=".local/privacy-test-durations.json"

# How many recent durations to keep per suite. The baseline a run is compared
# against is the MEDIAN of the OLDER part of this window (excluding the most
# recent recorded run), which makes detection robust to a single noisy run: one
# slow outlier barely moves the median, and because the latest sample is left
# out of the baseline it cannot re-anchor the baseline and mask itself. A wider
# window also keeps old "normal" samples around longer, so a genuine sustained
# slow-down keeps failing for several consecutive runs rather than quickly
# becoming the new normal.
HISTORY_WINDOW=10

# Minimum number of OLDER baseline points (i.e. excluding the most recent
# recorded run) required before a suite can be flagged at all. Prevents
# spurious failures on fresh checkouts before enough history has accumulated.
MIN_BASELINE_POINTS=3

# A suite is flagged as slower-than-baseline when it is at least this fraction
# slower than its rolling-median baseline. 0.5 == "more than 50% slower".
REGRESSION_THRESHOLD="0.5"

# Suites this fast (whole seconds) are ignored for regression flagging: a jump
# from 1s to 3s is 200% slower but almost always just scheduling noise.
REGRESSION_MIN_SECONDS=5

# Opt-in: when FAIL_ON_SLOWDOWN is set to a truthy value (1/true/yes), a
# SUSTAINED slow-down regression makes the overall run exit non-zero. Default
# (unset/0) is warning-only — the run still passes. Useful in CI to catch
# performance regressions automatically.
#
# "Sustained" matters: a slow-down only fails the run when BOTH this run and
# the immediately previous recorded run are slower than the rolling-median
# baseline. A single noisy run (scheduling jitter on the shared CI machine)
# shows up as a warning but never fails the build, because the run before it
# was normal. A genuine, persistent slow-down trips two runs in a row and
# fails as intended.
#
# CI: the `test-privacy` workflow (see .replit) runs this script with
# FAIL_ON_SLOWDOWN=1, so a sustained slow-down fails the run there. The very
# first run on a fresh checkout has no baseline (.local/privacy-test-durations.json
# is untracked working state), so nothing can be flagged until a baseline exists
# — early runs always pass while history accumulates.
FAIL_ON_SLOWDOWN="${FAIL_ON_SLOWDOWN:-0}"
case "${FAIL_ON_SLOWDOWN}" in
  1 | true | TRUE | yes | YES) FAIL_ON_SLOWDOWN=1 ;;
  *) FAIL_ON_SLOWDOWN=0 ;;
esac

# Set when a slow-down regression is detected, so the final exit logic can
# fail the run if FAIL_ON_SLOWDOWN is enabled.
SLOWDOWN_DETECTED=0

TOTAL=${#SUITES[@]}
INDEX=0

# Formats a whole-second duration as e.g. "1m 05s" or "42s".
format_duration() {
  local total=$1
  local mins=$((total / 60))
  local secs=$((total % 60))
  if [ "${mins}" -gt 0 ]; then
    printf '%dm %02ds' "${mins}" "${secs}"
  else
    printf '%ds' "${secs}"
  fi
}

# Fail fast if the slow-down detector's own logic is broken, before spending
# time on the long privacy suites. This is a quick, hermetic bash test that
# does not touch the live database.
DETECTOR_TEST="$(dirname "${BASH_SOURCE[0]}")/../test/slowdown-detection.test.sh"
if [ -f "${DETECTOR_TEST}" ]; then
  echo "▶ Self-test: slow-down detector logic"
  if bash "${DETECTOR_TEST}"; then
    echo "✅ slow-down detector self-test passed"
  else
    echo "🚨 slow-down detector self-test FAILED — aborting before running suites."
    exit 1
  fi
fi

for suite in "${SUITES[@]}"; do
  INDEX=$((INDEX + 1))
  echo ""
  echo "════════════════════════════════════════════════════════════════════════"
  echo "▶ [${INDEX}/${TOTAL}] Running ${suite}"
  echo "════════════════════════════════════════════════════════════════════════"

  start=$(date +%s)
  npx tsx "${suite}"
  status=$?
  end=$(date +%s)
  elapsed=$((end - start))
  DURATIONS+=("${elapsed}")

  if [ "${status}" -eq 0 ]; then
    echo "✅ PASS: ${suite} ($(format_duration "${elapsed}"))"
    PASSED+=("${suite}")
  else
    echo "❌ FAIL (exit ${status}): ${suite} ($(format_duration "${elapsed}"))"
    FAILED+=("${suite}")
  fi
done

echo ""
echo "════════════════════════════════════════════════════════════════════════"
echo "TEST SUITE SUMMARY"
echo "════════════════════════════════════════════════════════════════════════"
echo "Total suites:  ${TOTAL}"
echo "✅ Passed:     ${#PASSED[@]}"
echo "❌ Failed:     ${#FAILED[@]}"

TOTAL_ELAPSED=0
for d in "${DURATIONS[@]}"; do
  TOTAL_ELAPSED=$((TOTAL_ELAPSED + d))
done
echo "⏱  Total time: $(format_duration "${TOTAL_ELAPSED}")"

echo ""
echo "Suite durations (slowest first):"
# Build "seconds<TAB>suite" lines, sort numerically descending, then print
# each with a human-readable duration alongside the raw seconds.
for i in "${!SUITES[@]}"; do
  printf '%s\t%s\n' "${DURATIONS[$i]}" "${SUITES[$i]}"
done | sort -rn | while IFS=$'\t' read -r secs suite; do
  printf '  %8s  %s\n' "$(format_duration "${secs}")" "${suite}"
done

# ── Slow-down regression detection ──────────────────────────────────────────
# Compare each suite's duration against a STABLE baseline: the median of its
# older recorded runs, EXCLUDING the most recent recorded run (so a fresh slow
# sample can't re-anchor the baseline and hide itself). A slow-down is only
# treated as a real regression when it persists across two consecutive runs
# (this run AND the previous recorded run both slow); a single noisy run is a
# warning only. Then append this run's duration to each suite's rolling history.
if command -v jq >/dev/null 2>&1; then
  echo ""

  # Suites slow this run but not (yet) sustained — surfaced as warnings only.
  WARNINGS=()
  # Suites slow this run AND the previous recorded run — these fail CI when
  # FAIL_ON_SLOWDOWN is enabled.
  REGRESSIONS=()

  # Classify each suite against its stable baseline BEFORE recording this run,
  # so the current duration never pollutes its own baseline. sd_evaluate lives
  # in scripts/lib/slowdown-detect.sh and returns "VERDICT|baseline|prev|pct".
  for i in "${!SUITES[@]}"; do
    suite="${SUITES[$i]}"
    now="${DURATIONS[$i]}"

    result="$(sd_evaluate "${HISTORY_FILE}" "${suite}" "${now}" \
      "${REGRESSION_MIN_SECONDS}" "${REGRESSION_THRESHOLD}" "${MIN_BASELINE_POINTS}")"
    IFS='|' read -r verdict baseline _prev pct <<< "${result}"

    case "${verdict}" in
      FAIL) REGRESSIONS+=("${suite}|${baseline}|${now}|${pct}") ;;
      WARN) WARNINGS+=("${suite}|${baseline}|${now}|${pct}") ;;
    esac
  done

  pct_threshold="$(awk -v t="${REGRESSION_THRESHOLD}" 'BEGIN { printf "%d", t * 100 }')"

  if [ "${#REGRESSIONS[@]}" -gt 0 ]; then
    SLOWDOWN_DETECTED=1
    echo "⚠️  Sustained slow-down regressions (>${pct_threshold}% above median baseline for 2+ runs):"
    for entry in "${REGRESSIONS[@]}"; do
      IFS='|' read -r suite base now pct <<< "${entry}"
      printf '  🐌 %s  baseline %s → %s  (+%s%%)\n' \
        "${suite}" "$(format_duration "${base}")" "$(format_duration "${now}")" "${pct}"
    done
  fi

  if [ "${#WARNINGS[@]}" -gt 0 ]; then
    echo "ℹ️  One-off slow runs (>${pct_threshold}% above median baseline, not yet sustained — warning only):"
    for entry in "${WARNINGS[@]}"; do
      IFS='|' read -r suite base now pct <<< "${entry}"
      printf '  ⏳ %s  baseline %s → %s  (+%s%%)\n' \
        "${suite}" "$(format_duration "${base}")" "$(format_duration "${now}")" "${pct}"
    done
  fi

  if [ "${#REGRESSIONS[@]}" -eq 0 ] && [ "${#WARNINGS[@]}" -eq 0 ]; then
    echo "No slow-down regressions detected."
  fi

  # Persist this run's durations AFTER classifying, appending to each suite's
  # rolling list and capping to HISTORY_WINDOW (legacy single-number entries
  # are upgraded transparently). See sd_history_append in the lib.
  for i in "${!SUITES[@]}"; do
    sd_history_append "${HISTORY_FILE}" "${SUITES[$i]}" "${DURATIONS[$i]}" "${HISTORY_WINDOW}"
  done
else
  echo ""
  echo "(jq not found — skipping slow-down regression tracking.)"
fi

if [ "${#FAILED[@]}" -gt 0 ]; then
  echo ""
  echo "Failed suites:"
  for suite in "${FAILED[@]}"; do
    echo "  ❌ ${suite}"
  done
  echo ""
  echo "🚨 One or more suites failed."
  exit 1
fi

if [ "${SLOWDOWN_DETECTED}" -eq 1 ] && [ "${FAIL_ON_SLOWDOWN}" -eq 1 ]; then
  echo ""
  echo "🚨 Slow-down regression detected and FAIL_ON_SLOWDOWN is enabled."
  exit 1
fi

echo ""
echo "🎉 All suites passed!"
exit 0
