---
name: Notification preference delivery
description: How notificationPreferences rows control in-app/email delivery and what defaults apply.
---

# Notification preference delivery

Per-trigger notification delivery is controlled by `notificationPreferences` rows
keyed by `(userId, triggerType)` where `triggerType` equals the trigger's
`eventType` (e.g. "session_scheduled").

**Source of truth = the boolean flags** `enableInApp` / `enableEmail`. The legacy
`deliveryMethods` text column is fragile (the readers do
`typeof x === 'string' ? [x] : x`, so a JSON-array string like `'["email"]'`
does NOT match `.includes("email")`) — treat it as a fallback only, never write
a JSON array into it.

**Default = ON for both channels when no row exists.** Note the DB column default
for `enable_email` is `false`, so a row created without it would read as
email-OFF. Therefore the UI must always write BOTH `enableInApp` and
`enableEmail` together on every toggle to keep rows internally consistent.

**Where delivery checks live** (`server/notification-service.ts`):
- Email: `sendEmailNotifications` — checks `enableEmail` (then deliveryMethods fallback); no row => ON.
- In-app: `createNotificationsFromTrigger` — filters recipients whose `enableInApp === false`; no row => ON.
- Daily digest (`daily_schedule_email`) is a SEPARATE path (`isDailyDigestEmailEnabled`), not the trigger system.

**Why:** the email path historically only read deliveryMethods and the in-app
path ignored preferences entirely; both were unified onto the booleans so the
Preferences UI toggles actually mute delivery.
