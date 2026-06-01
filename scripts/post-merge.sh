#!/bin/bash
set -e
npm install
npm run db:push
# Reconcile the Postgres audit enums (audit_action / audit_result) with the
# values the app writes (db:push does not manage these pg ENUMs). Idempotent.
npx tsx scripts/ensure-audit-enums.ts
