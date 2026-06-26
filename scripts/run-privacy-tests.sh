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
  "test/phone-e164-derive-privacy.test.ts"
  "test/sms-notification-privacy.test.ts"
  "test/sms-notification-staff-privacy.test.ts"
  "test/sms-series-notification-privacy.test.ts"
  "test/email-series-notification-privacy.test.ts"
  "test/email-single-notification-privacy.test.ts"
  "test/sms-inbound-optout.test.ts"
  "test/sms-log-privacy.test.ts"
  "test/sms-log-search-privacy.test.ts"
  "test/sms-log-export-privacy.test.ts"
  "test/sms-log-export-audit.test.ts"
  "test/sms-log-export-count.test.ts"
  "test/communications-log-privacy.test.ts"
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
  "test/insurance-statement-double-payment.test.ts"
  "test/insurance-voided-statement-locked.test.ts"
  "test/insurance-reconciliation-voided-ui.test.ts"
  "test/insurance-reconciliation-posted-line-ui.test.ts"
  "test/therapist-statement-earning-dedup.test.ts"
  "test/therapist-statement-monthly-running-agree.test.ts"
  "test/therapist-earning-self-correct.test.ts"
  "test/insurance-void-repost-corrects-pay.test.ts"
  "test/therapist-statement-corrected-pay-ui.test.ts"
  "test/therapist-owed-corrected-pay-ui.test.ts"
  "test/therapist-statement-corrected-pay-monthly-ui.test.ts"
  "test/insurance-reopen-repost-ui.test.ts"
  "test/insurance-repost-doublecount-ui.test.ts"
  "test/insurance-reopen-reject-ui.test.ts"
  "test/insurance-void-reject-ui.test.ts"
  "test/insurance-post-reject-ui.test.ts"
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

# A TRACKED, committed baseline that survives fresh checkouts. The rolling
# HISTORY_FILE above lives under .local/ which is gitignored, so on an ephemeral
# CI checkout it starts empty every time and the rolling-median baseline never
# accumulates — the slow-down safety net would never fire in CI. This committed
# file fixes that: when the rolling history is missing/empty (i.e. a fresh
# checkout), it is seeded from here so the detector has a meaningful baseline
# from the very first run. Same JSON shape as HISTORY_FILE. Refresh it by
# running this script with UPDATE_BASELINE=1 (see below).
BASELINE_FILE="$(dirname "${BASH_SOURCE[0]}")/privacy-test-baseline.json"

# When UPDATE_BASELINE is truthy (1/true/yes) AND no suite failed, this run's
# rolling history is written back to the committed BASELINE_FILE so the next
# fresh checkout starts from up-to-date numbers. Use this to deliberately
# (re-)bless the baseline after an intentional, ACCEPTED runtime change — it
# absorbs the new numbers even if they tripped a slow-down (that is the whole
# point of re-blessing). Default is read-only: the baseline is only consumed for
# seeding, never modified.
UPDATE_BASELINE="${UPDATE_BASELINE:-0}"
case "${UPDATE_BASELINE}" in
  1 | true | TRUE | yes | YES) UPDATE_BASELINE=1 ;;
  *) UPDATE_BASELINE=0 ;;
esac

# AUTO_UPDATE_BASELINE keeps the committed baseline fresh WITHOUT manual upkeep.
# When truthy (1/true/yes) the committed BASELINE_FILE is rolled forward from
# this run's rolling history automatically — but ONLY on a fully GREEN run: no
# suite failed AND no slow-down was detected. The "no slow-down" gate is the
# safety net required by design: a genuine sustained slow-down sets
# SLOWDOWN_DETECTED, which (a) skips this auto-refresh so the regression is
# never silently absorbed into the baseline, and (b) fails the run when
# FAIL_ON_SLOWDOWN is enabled, forcing it to be fixed or deliberately re-blessed
# with UPDATE_BASELINE=1 first. The CI `test-privacy` workflow (see .replit)
# enables this so the baseline tracks legitimate, gradual slow-downs on its own.
AUTO_UPDATE_BASELINE="${AUTO_UPDATE_BASELINE:-0}"
case "${AUTO_UPDATE_BASELINE}" in
  1 | true | TRUE | yes | YES) AUTO_UPDATE_BASELINE=1 ;;
  *) AUTO_UPDATE_BASELINE=0 ;;
esac

# Cross-run persistence (the real fix for ephemeral CI). The committed
# BASELINE_FILE only provides a COLD-START baseline; on its own it can't let CI
# catch a *newly introduced* sustained slow-down, because confirming "sustained"
# needs the *previous run's* duration and ephemeral checkouts never carry one
# forward. This helper restores the previous run's rolling history from Replit
# Object Storage BEFORE classifying and saves the updated history AFTER, so the
# "previous run" survives across independent CI runs:
#   run 1 (empty store): seed from committed baseline, record slow run -> WARN
#   run 2 (store has slow prev): slow now + slow prev -> FAIL.
# It degrades gracefully: if object storage is unavailable (helper exits
# non-zero) the run still works using only the committed-baseline seed. Disable
# entirely with PERSIST_HISTORY=0 (e.g. for fully offline local runs).
HISTORY_STORE_HELPER="$(dirname "${BASH_SOURCE[0]}")/privacy-history-store.ts"
PERSIST_HISTORY="${PERSIST_HISTORY:-1}"
case "${PERSIST_HISTORY}" in
  1 | true | TRUE | yes | YES) PERSIST_HISTORY=1 ;;
  *) PERSIST_HISTORY=0 ;;
esac

# history_pull — restore persisted history into HISTORY_FILE. Returns 0 only
# when a non-empty history was actually restored from the store.
history_pull() {
  [ "${PERSIST_HISTORY}" -eq 1 ] || return 1
  [ -f "${HISTORY_STORE_HELPER}" ] || return 1
  npx tsx "${HISTORY_STORE_HELPER}" pull "${HISTORY_FILE}" >/dev/null 2>&1
}

# history_push — persist the current HISTORY_FILE to the store. Best-effort:
# never fails the run.
history_push() {
  [ "${PERSIST_HISTORY}" -eq 1 ] || return 0
  [ -f "${HISTORY_STORE_HELPER}" ] || return 0
  npx tsx "${HISTORY_STORE_HELPER}" push "${HISTORY_FILE}" >/dev/null 2>&1
}

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
# FAIL_ON_SLOWDOWN=1, so a sustained slow-down fails the run there. The rolling
# HISTORY_FILE is untracked working state (.local/ is gitignored) and starts
# empty on a fresh CI checkout, so on its own it would never accumulate a
# baseline in CI. To fix that, this script seeds the rolling history from the
# committed BASELINE_FILE on a fresh checkout (see seeding step below), so CI
# runs have a meaningful baseline — and a sustained slow-down recorded in that
# committed baseline is caught — from the very first run.
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
# time on the long privacy suites. These are quick, hermetic bash tests that do
# not touch the live database or real object storage:
#   - slowdown-detection.test.sh:          the detector math/baseline rules
#   - privacy-baseline-persistence.test.sh: cross-run persistence (sustained
#     slow-down is caught across fresh checkouts)
#   - baseline-refresh.test.sh:            committed-baseline auto-refresh gating
#     (a sustained slow-down is never silently absorbed; no-churn copy)
for selftest in \
  "$(dirname "${BASH_SOURCE[0]}")/../test/slowdown-detection.test.sh" \
  "$(dirname "${BASH_SOURCE[0]}")/../test/privacy-baseline-persistence.test.sh" \
  "$(dirname "${BASH_SOURCE[0]}")/../test/baseline-refresh.test.sh"; do
  [ -f "${selftest}" ] || continue
  echo "▶ Self-test: $(basename "${selftest}")"
  if bash "${selftest}"; then
    echo "✅ self-test passed: $(basename "${selftest}")"
  else
    echo "🚨 self-test FAILED ($(basename "${selftest}")) — aborting before running suites."
    exit 1
  fi
done

# ── Restore / seed the rolling history before running ────────────────────────
# Two layers, in priority order, so the slow-down detector always has a usable
# baseline AND can confirm sustained regressions across independent CI runs:
#   1. Cross-run persistence: restore the previous run's history from object
#      storage (history_pull). This is what carries the "previous run" forward
#      across ephemeral checkouts so a sustained slow-down can actually FAIL.
#   2. Cold-start seed: if nothing was restored (first ever run, or persistence
#      disabled/unavailable) and the local history is empty, seed from the
#      committed BASELINE_FILE so even the very first run has a baseline.
# Neither layer ever clobbers an already-populated local history.
if command -v jq >/dev/null 2>&1; then
  history_suites=0
  if [ -f "${HISTORY_FILE}" ]; then
    history_suites="$(jq -r '(.suites // {}) | length' "${HISTORY_FILE}" 2>/dev/null || echo 0)"
  fi

  # 1. Restore persisted history when local history is empty.
  if [ "${history_suites:-0}" -eq 0 ] 2>/dev/null; then
    if history_pull; then
      history_suites="$(jq -r '(.suites // {}) | length' "${HISTORY_FILE}" 2>/dev/null || echo 0)"
      if [ "${history_suites:-0}" -gt 0 ] 2>/dev/null; then
        echo "ℹ️  Restored slow-down history from object storage (${history_suites} suites)."
      fi
    fi
  fi

  # 2. Cold-start seed from the committed baseline if still empty.
  if [ "${history_suites:-0}" -eq 0 ] 2>/dev/null && [ -f "${BASELINE_FILE}" ]; then
    mkdir -p "$(dirname "${HISTORY_FILE}")"
    cp "${BASELINE_FILE}" "${HISTORY_FILE}"
    echo "ℹ️  No persisted slow-down history yet — seeded from committed baseline ${BASELINE_FILE}."
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

  # Persist the updated rolling history to object storage so the NEXT run (even
  # on a fresh, independent checkout) sees this run as its "previous run". Only
  # when no suite failed, so a broken run never poisons the persisted baseline.
  # This is what lets a sustained slow-down actually FAIL in CI.
  if [ "${#FAILED[@]}" -eq 0 ]; then
    if history_push; then
      [ "${PERSIST_HISTORY}" -eq 1 ] && echo "ℹ️  Persisted updated slow-down history to object storage."
    fi
  fi

  # ── Refresh the committed cold-start baseline ──────────────────────────────
  # The committed BASELINE_FILE seeds the rolling history on fresh checkouts; if
  # it is never refreshed it drifts stale as suites legitimately get slower and
  # eventually emits false slow-down warnings. Roll it forward from this run's
  # rolling history in two situations (never when a suite failed, so a broken run
  # can't poison it):
  #   • UPDATE_BASELINE=1      — manual, deliberate re-bless after an ACCEPTED
  #                              runtime change; absorbs the new numbers even if
  #                              they tripped a slow-down (that is the point).
  #   • AUTO_UPDATE_BASELINE=1 — automatic roll-forward, but ONLY on a fully
  #                              GREEN run (also requires no slow-down detected),
  #                              so a sustained slow-down fails CI and is fixed
  #                              or re-blessed BEFORE it can be absorbed.
  # The decision and the change-only copy live in scripts/lib/slowdown-detect.sh
  # (sd_baseline_refresh_mode / sd_refresh_baseline_if_changed) so they can be
  # unit-tested without running the real suite.
  refresh_mode="$(sd_baseline_refresh_mode \
    "${#FAILED[@]}" "${SLOWDOWN_DETECTED}" "${UPDATE_BASELINE}" "${AUTO_UPDATE_BASELINE}")"
  refresh_label=""
  case "${refresh_mode}" in
    UPDATE) refresh_label="UPDATE_BASELINE=1" ;;
    AUTO) refresh_label="AUTO_UPDATE_BASELINE=1 (green run)" ;;
  esac
  if [ -n "${refresh_label}" ]; then
    refresh_outcome="$(sd_refresh_baseline_if_changed "${HISTORY_FILE}" "${BASELINE_FILE}")"
    echo ""
    case "${refresh_outcome}" in
      REFRESHED)
        echo "ℹ️  ${refresh_label} — refreshed committed baseline ${BASELINE_FILE} from this run." ;;
      NOCHANGE)
        echo "ℹ️  ${refresh_label} — committed baseline ${BASELINE_FILE} already current, left unchanged." ;;
    esac
  fi
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
