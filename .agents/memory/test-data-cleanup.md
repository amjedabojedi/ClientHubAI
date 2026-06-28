---
name: Test-data pollution & safe cleanup
description: How to tell SmartHub test/fake records from real data and delete them from the shared (live) DB without harming real data.
---

The shared dev DATABASE_URL is effectively the practice's LIVE data. The privacy/regression suite (workflow `test-privacy`) had been polluting it by creating fake accounts on every run.

## Identifying fake vs real
- **Fake STAFF/therapist accounts** = `email ILIKE '%@example.test'`. Real staff use real domains (resiliencec.com, gmail, etc.). Clean, reliable discriminator. (Once observed: 743 fake vs 30 real.)
- **Test CLIENTS are NOT identifiable by client_id era.** `CL-2026-*` contains REAL clients added in 2026 (~243 real). Identify test clients by **generated-name patterns** instead: 8+ digit timestamps, "Drawer Client", "consent-client tNN", "no-consent", "Patient X ins-", "client thr-/ins-", "-ui-", "def/dla/ddl/sf-client", plus `client_id LIKE 'T%'`, `email ILIKE '%@example.test'`, and assignment to a fake therapist.
- **Always audit the predicate**: confirm it catches 0 `CL-2025-*` rows, and eyeball matches with non-`example` emails for false positives — a "Test Client"-named row can carry a real staff email and must be excluded by hand.

## Why: deleting on a live DB is irreversible
Checkpoint rollback may not cover this external DB. Always: back up the to-delete sets to CSV first, scope strictly to confirmed-test rows, and run inside an atomic block so a missed FK rolls everything back.

## How to apply: FK-safe delete order
Deleting fake users requires clearing their NO ACTION FK children first. The session sub-tree must go **bottom-up**:
payment_transactions (note `session_billing` → payment_transactions is **RESTRICT**) → insurance_statement_lines → therapist_payout_items / therapist_payment_allocations / therapist_earnings → room_bookings → session_billing → sessions (which CASCADEs session_notes/ratings/transcripts/scheduled_notifications). Also clear report_supporting_files→client_reports→report_templates and the assessment_* chain, documents, supervisor_assignments. Then `DELETE FROM users` (CASCADEs notif prefs/notifications/pay_rules/user_profiles/user_sessions; SET NULL on audit_logs/client_history).
- For a **staff-only** pass, DETACH test clients via `assigned_therapist_id=NULL` (and `duplicate_marked_by=NULL`) instead of deleting them.
- Wrap the whole thing in a single `DO $$ ... END $$;` block (atomic; any error rolls back). Verify after: fake count 0, real_users unchanged (30), CL-2025 count unchanged.

## Stopping the leak
The `test-privacy` workflow was REMOVED to stop new fakes. Recreate when needed with command:
`FAIL_ON_SLOWDOWN=1 AUTO_UPDATE_BASELINE=1 bash scripts/run-privacy-tests.sh`
Root issue to fix properly: the suite runs against the real DATABASE_URL; it should target a throwaway DB.
