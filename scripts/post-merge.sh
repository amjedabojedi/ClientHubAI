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
