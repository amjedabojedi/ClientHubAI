#!/bin/bash
set -e
npm install
# Apply additive, idempotent schema FIRST, before db:push. This repo has known
# practice_configuration drift that can make an unguarded `db:push` prompt or
# fail; running these additive scripts first guarantees the feature tables/enums
# exist even if a later db:push aborts on that unrelated drift (the task's
# "do not rely on db:push for these additive changes" constraint).
#
# Reconcile the Postgres audit enums (audit_action / audit_result) with the
# values the app writes (db:push does not manage these pg ENUMs). Idempotent.
npx tsx scripts/ensure-audit-enums.ts
# Guard: fail the merge setup loudly if the audit enums still don't cover every
# value the code can write (prevents silently-dropped audit rows from shipping).
npx tsx scripts/verify-audit-enums.ts
# Ensure the report-template feature tables exist (idempotent DDL; avoids relying
# on db:push for these tables given known practice_configuration drift).
npx tsx scripts/ensure-report-tables.ts
# Ensure the therapist running-statement schema exists (therapist_payment_allocations
# + therapist_earnings tables + therapist_payouts ledger columns). Idempotent DDL.
npx tsx scripts/ensure-therapist-ledger.ts
# Ensure payment_transactions has the insurance-statement provenance columns
# (source_statement_id / source_statement_line_id). Idempotent DDL.
npx tsx scripts/ensure-statement-payment-link.ts
# Finally reconcile the rest of the schema via Drizzle. Runs last so the additive
# feature schema above is already in place if this aborts on known drift.
npm run db:push
