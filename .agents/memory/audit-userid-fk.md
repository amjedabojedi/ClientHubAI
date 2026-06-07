---
name: audit_logs.user_id FK on system-initiated audits
description: Why a client id can't be used as audit userId, and what to use instead for non-user (webhook/system) actions.
---

# audit_logs.user_id is FK-constrained to users

`audit_logs.user_id` has a real Postgres FK to `users.id`. Any `AuditLogger.logAction({ userId })`
with an id that is NOT a real user row fails the DB insert (error 23503) and the
audit only lands in the emergency fallback file — a silent HIPAA audit gap that
looks "fine" because logAction never throws.

**Why it bites:** several portal consent endpoints pass `userId: session.clientId`
(a client id, not a user id). For a client whose id collides with no user row,
that audit write fails to the fallback file. The *client* belongs in the
`clientId` field, never `userId`.

**How to apply:** for actions initiated by an external system or webhook (e.g. the
Twilio inbound-SMS opt-out webhook `POST /api/sms/inbound`), set `userId` to the
system user (`SYSTEM_USER_ID = 6`, the established convention used by the
notification-service SMS/email audits) and record the affected client via the
separate `clientId` field. Do not put a client id in `userId`.
