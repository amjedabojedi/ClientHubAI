---
name: SMS appointment notifications
description: Consent-gated Twilio SMS for appointments — what the body may contain, how the gate fails closed, and where reminders come from.
---

# SMS appointment notifications (Twilio)

Consent-gated SMS for booking/reschedule confirmations + 24h reminders, sent
through the existing notification engine (not a new scheduler).

## What the SMS body may contain (settled policy)
- Allowed: practice name, that an appointment exists, and its **date/time**, plus a STOP notice.
- Forbidden: client name, any clinical detail, diagnosis, session content.
- **Why:** The owner explicitly accepted that appointment date/time (tied to a
  phone number) is acceptable to include for usefulness as a reminder, even
  though it reveals the appointment exists. They rejected the "no date/time,
  log into portal" minimal variant. Do not strip the date/time back out without
  re-asking — it was a deliberate, owner-approved tradeoff.

## Fail-closed gate (client path)
- SMS is OFF by default per client. A send requires BOTH `checkSmsConsent()` true
  (consentType `sms_notifications`, mirrors AI-consent helper) AND a phone that
  normalizes to E.164. Missing/withdrawn/unverifiable consent, bad/missing phone,
  OR any unexpected exception => NO send, and a `sms_notification_blocked` audit row.
- Every attempt is audited (`sent`/`failed`/`blocked`, resourceType `sms_notification`),
  including the catch-all error path — "every attempt audit-logged" must hold even on throw.

## Staff path (Path 2, preference-gated) audit
- Staff SMS is also fully audited via `auditStaffSms`, mirroring the client `auditSms`
  but the SUBJECT is the staff user: `resourceId = String(userId)`, `clientId = null`
  (no client in scope, stays PHI-free), `userId = null`/`username "system"` (system is the actor).
- Actions: `sms_notification_sent` (success) / `sms_notification_skipped` (blocked —
  opted out, no preference row, or unusable phone) / `sms_notification_failed` (failure).
  `sms_notification_skipped` is a pg ENUM value reconciled by `scripts/ensure-audit-enums.ts`.
- The staff loop iterates ALL non-client recipients (filter is `role !== "client"`, NOT
  also `&& r.phone`) so opted-out / no-pref / bad-phone staffers each get a `skipped` row —
  the whole point is a durable record of who was *not* texted and why.
- Staff test keys audit lookups on `resourceId = String(staffUserId)` (vs client test on clientId).

## Gotchas
- 24h reminders are **scheduled `session_scheduled` triggers** (`isScheduled=true`),
  not a distinct eventType. `generateSmsBody` branches on `trigger.isScheduled`
  FIRST to use reminder wording instead of "confirmed".
- Client SMS re-derives clientId from `entityData.clientId` (gated on
  `recipientRules.sessionClient`), so a client who opted OUT of email still gets SMS.
- Test seam `__setSmsClientForTests` in `server/sms-service.ts` injects a fake
  Twilio client for hermetic tests; it throws if `NODE_ENV==='production'`.
- New `sms_notification_*` audit actions are pg ENUM values — added via
  `scripts/ensure-audit-enums.ts` (db:push never syncs enum labels).
