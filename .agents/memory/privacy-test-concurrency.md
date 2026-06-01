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
