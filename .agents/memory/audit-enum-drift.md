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
into `scripts/post-merge.sh` after `db:push`. `audit_action` values come from
`AUDIT_ACTIONS` in `shared/schema.ts`; `audit_result` uses the fixed set
`success/failure/blocked/warning/denied`.

**Why:** matches the project's existing "apply additive DDL idempotently instead
of trusting db:push" approach to schema drift.

**How to apply:** whenever you add a new value to `AUDIT_ACTIONS`, or use a new
`result:` string in an audit call, it will not persist until the enum has it.
Run/extend `scripts/ensure-audit-enums.ts`. Don't assume a logged audit action
actually wrote — the writer fails open.
