---
name: Privacy integration tests must run serially
description: Why the standalone tsx privacy/transcription tests collide when run in parallel against the shared dev DB.
---

The standalone tsx privacy tests (`test/communications-transcribe-privacy.test.ts`,
`test/session-transcribe-privacy.test.ts`, `test/assessment-report-privacy.test.ts`)
each spin up the real Express app and seed clients via `storage.createClient`.

**Rule:** Run these suites serially (one process at a time), never in parallel.

**Why:** `storage.createClient` always generates the business `client_id` as
`CL-<year>-<MAX+1>` (it ignores any passed-in clientId). Two suites running
concurrently compute the same MAX and collide on the
`clients_client_id_unique` constraint, so every parallel run fails with a
duplicate-key error even though each suite passes alone.

**How to apply:** Don't register one workflow per suite (workflows auto-start
and run in parallel). Instead chain them in a single serial validation command
with `&&` (registered as validation `test-privacy`). If adding more app-level
integration tests that create clients, fold them into the same serial chain.

**Belt-and-suspenders (don't rely on serial-only):** in practice the suite CAN
still run twice at once — the `test-privacy` workflow and a `mark_task_complete`
validation trigger overlap. So make each suite robust to a concurrent twin, not
just serial:
- The `daily-schedule-email-*` tests call `processDailyScheduleEmails`, which
  loops over ALL therapists. A concurrent twin deleting its own seeded
  therapists mid-loop used to crash the whole run on the therapist_id FK (PG
  `23503`). Production now skips a therapist whose claim insert hits `23503`
  (deleted between `getTherapists()` and the claim) instead of aborting everyone.
- Those tests isolate `daily_schedule_emails` rows by date and clean up by date.
  Hardcoded dates collided across concurrent runs (one run's cleanup-by-date
  wiped the other's rows → bogus assert failures). Fix: derive a
  per-process-unique far-future date offset (`process.pid` + random over a
  ~130-year window) so two instances never share a send date.

**Tooling gotcha:** the serial chain must be a *validation* (`isValidation`),
created via `setValidationCommand`, NOT a plain workflow. A workflow created
with `configureWorkflow` is a non-validation workflow and cannot later be
converted (`setValidationCommand` errors `PROHIBITED_ACTION ... already exists
as a non-validation workflow`). To re-home it: `removeWorkflow` first, then
`setValidationCommand`.

**Also:** the openai SDK captures its fetch impl at client construction. The
module-level chat client in `server/ai/openai.ts` is built when routes are
statically imported, so a global-fetch stub must be installed BEFORE importing
server modules — import them dynamically. Whisper clients are built lazily
per-request, so they pick up a stub installed later.
