#!/bin/bash
set -e
npm install
npm run db:push
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
# table + therapist_payouts ledger columns). Idempotent additive DDL.
npx tsx scripts/ensure-therapist-ledger.ts
