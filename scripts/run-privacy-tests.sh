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

TOTAL=${#SUITES[@]}
INDEX=0

for suite in "${SUITES[@]}"; do
  INDEX=$((INDEX + 1))
  echo ""
  echo "════════════════════════════════════════════════════════════════════════"
  echo "▶ [${INDEX}/${TOTAL}] Running ${suite}"
  echo "════════════════════════════════════════════════════════════════════════"

  npx tsx "${suite}"
  status=$?

  if [ "${status}" -eq 0 ]; then
    echo "✅ PASS: ${suite}"
    PASSED+=("${suite}")
  else
    echo "❌ FAIL (exit ${status}): ${suite}"
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

echo ""
echo "🎉 All suites passed!"
exit 0
