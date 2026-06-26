---
name: Audit log enum drift
description: audit_logs.action/result are pg ENUMs in the DB but varchar in Drizzle; db:push never syncs them, so newer values silently fail to log.
---

# Audit log enum drift

`audit_logs.action` and `audit_logs.result` are backed by Postgres ENUM types
(`audit_action`, `audit_result`) created by an early migration, but the Drizzle
schema models both columns as plain `varchar` (with a TS-level enum on `action`
via `AUDIT_ACTIONS`). Because Drizzle does not manage these pg ENUMs, `db:push`
never adds new values to them.

**Symptom:** `AuditLogger.logAction()` swallows the DB error and only prints
`CRITICAL: Audit log failed to record: ... invalid input value for enum ...`.
The HTTP request still succeeds, so the audit row is silently dropped — a
HIPAA/GDPR audit-trail gap. Seen with `voice_transcription_processed`,
`ai_processing_blocked` (action) and `denied` (result).

**Fix in place:** `scripts/ensure-audit-enums.ts` reconciles both enums with
`ALTER TYPE ... ADD VALUE IF NOT EXISTS` (additive, idempotent). It is wired
into `scripts/post-merge.sh` after `db:push`. Both value sets are the single
source of truth in `shared/schema.ts`: `AUDIT_ACTIONS` and `AUDIT_RESULTS` (the
`result` column is typed via `{ enum: AUDIT_RESULTS }`, so a bad result value is
now a compile error).

**No longer fails open:** `AuditLogger.logAction` previously swallowed DB errors.
It now, on DB write failure, persists the record to an append-only fallback file
(`AUDIT_FALLBACK_DIR` env, default `audit-fallback/audit-fallback.jsonl`,
gitignored — may contain PHI) and throws only if the fallback also fails.

**Guard:** `verifyAuditEnums()` / `assertAuditEnumsAtStartup()` in
`server/audit-enum-check.ts` compares the DB enums to the code value sets.
Startup logs a loud CRITICAL (non-fatal) on drift; `scripts/verify-audit-enums.ts`
exits non-zero on drift and runs in post-merge after the reconcile.

**Why:** matches the project's existing "apply additive DDL idempotently instead
of trusting db:push" approach to schema drift.

**How to apply:** add new values only to `AUDIT_ACTIONS` / `AUDIT_RESULTS` in
`shared/schema.ts`; the reconcile + guard pick them up automatically. A DB-failed
audit write is now surfaced (fallback file + logs), not silently dropped.

**Frontend label map also gates the build:** `client/src/pages/hipaa-audit.tsx`
has an action→label object typed `satisfies Record<AuditAction, string>`, so
adding any new value to `AUDIT_ACTIONS` makes `npm run check` fail until you add a
matching human-readable label there too. Easy to miss — the error names the
missing action property, not the schema.
