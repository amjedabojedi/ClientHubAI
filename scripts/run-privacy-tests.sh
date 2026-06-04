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

# Where per-suite durations from the previous run are persisted, so this run
# can flag suites that have gotten significantly slower over time. Lives under
# .local/ (untracked working state) and is keyed by suite path.
HISTORY_FILE=".local/privacy-test-durations.json"

# A suite is flagged as a regression when it is at least this fraction slower
# than its previous recorded run. 0.5 == "more than 50% slower".
REGRESSION_THRESHOLD="0.5"

# Suites this fast (whole seconds) are ignored for regression flagging: a jump
# from 1s to 3s is 200% slower but almost always just scheduling noise.
REGRESSION_MIN_SECONDS=5

# Opt-in: when FAIL_ON_SLOWDOWN is set to a truthy value (1/true/yes), a
# detected slow-down regression makes the overall run exit non-zero. Default
# (unset/0) is warning-only — the run still passes. Useful in CI to catch
# performance regressions automatically.
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
# Compare each suite's duration against the previous recorded run (if any) and
# flag suites that have gotten significantly slower. Then persist this run's
# durations so the next run has a baseline to compare against.
if command -v jq >/dev/null 2>&1; then
  echo ""

  # Read the previous run's duration for a suite (empty string if unknown).
  prev_duration() {
    local suite=$1
    if [ -f "${HISTORY_FILE}" ]; then
      jq -r --arg s "${suite}" '.suites[$s] // empty' "${HISTORY_FILE}" 2>/dev/null
    fi
  }

  REGRESSIONS=()
  for i in "${!SUITES[@]}"; do
    suite="${SUITES[$i]}"
    now="${DURATIONS[$i]}"
    prev="$(prev_duration "${suite}")"

    # Skip if no prior baseline, or current run is too fast to be meaningful.
    [ -n "${prev}" ] || continue
    [ "${prev}" -gt 0 ] 2>/dev/null || continue
    [ "${now}" -ge "${REGRESSION_MIN_SECONDS}" ] || continue

    # Flag when (now - prev) / prev > REGRESSION_THRESHOLD.
    if awk -v now="${now}" -v prev="${prev}" -v t="${REGRESSION_THRESHOLD}" \
        'BEGIN { exit !((now - prev) / prev > t) }'; then
      pct="$(awk -v now="${now}" -v prev="${prev}" \
        'BEGIN { printf "%d", ((now - prev) / prev) * 100 }')"
      REGRESSIONS+=("${suite}|${prev}|${now}|${pct}")
    fi
  done

  if [ "${#REGRESSIONS[@]}" -gt 0 ]; then
    SLOWDOWN_DETECTED=1
    echo "⚠️  Slow-down regressions (>$(awk -v t="${REGRESSION_THRESHOLD}" 'BEGIN { printf "%d", t * 100 }')% slower than last run):"
    for entry in "${REGRESSIONS[@]}"; do
      IFS='|' read -r suite prev now pct <<< "${entry}"
      printf '  🐌 %s  %s → %s  (+%s%%)\n' \
        "${suite}" "$(format_duration "${prev}")" "$(format_duration "${now}")" "${pct}"
    done
  else
    echo "No slow-down regressions detected."
  fi

  # Persist this run's durations as the new baseline for next time.
  mkdir -p "$(dirname "${HISTORY_FILE}")"
  {
    printf '{\n  "updated": "%s",\n  "suites": {\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
    for i in "${!SUITES[@]}"; do
      sep=","
      [ "${i}" -eq $(( ${#SUITES[@]} - 1 )) ] && sep=""
      printf '    %s: %s%s\n' \
        "$(printf '%s' "${SUITES[$i]}" | jq -R .)" "${DURATIONS[$i]}" "${sep}"
    done
    printf '  }\n}\n'
  } > "${HISTORY_FILE}"
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
