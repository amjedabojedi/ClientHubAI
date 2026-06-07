---
name: phoneE164 derived SMS copy
description: How the standardized E.164 phone copy is derived/stored and the undefined-vs-null recompute rule
---

`clients.phoneE164` / `users.phoneE164` are a SEPARATE, auto-derived E.164 copy of
the free-text `phone`, used ONLY for sending SMS. The typed `phone` is never
modified. Pure normalizer lives in `shared/phone.ts` (no twilio/node deps) and is
shared by client forms and server; `server/sms-service.ts` re-exports it.

**Rule:** create/update derive phoneE164 from phone. On update, recompute ONLY when
`patch.phone !== undefined`.

**Why:** Drizzle's `.set()` ignores `undefined`, so it leaves the typed `phone`
column alone. If we treated a `phone: undefined` payload (common when routes coerce
empty strings to undefined) as a change, we'd run `normalize(undefined) -> null` and
clear phoneE164 while the typed phone stays — drifting the two columns. An explicit
`null`/`""` is a real clear and DOES recompute (to null).

**How to apply:** any new write path that touches phone must go through
storage.createX/updateX (don't write phoneE164 directly). SMS send sites should read
`row.phoneE164 || normalizePhoneE164(row.phone)` (fallback covers pre-backfill rows).
Backfill is `scripts/backfill-phone-e164.ts` (idempotent; fills null phoneE164 only).
