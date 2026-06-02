---
name: Quiet hours & weekend muting storage
description: Where account-wide notification delivery settings live and how delivery honors them
---

# Quiet hours / weekend muting

Quiet hours (`quietHoursStart`/`quietHoursEnd`) and weekend muting (`weekendsEnabled`)
are **account-wide**, not per-event. They are stored on ONE reserved
`notificationPreferences` row per user keyed by `triggerType = "__global__"`
(`GLOBAL_NOTIFICATION_PREFERENCES_TRIGGER`, mirrored in client + server). Per-event
rows still carry these columns in the schema but delivery only reads the global row.

**Why:** the schema has the columns on every row, but the UX is a single window +
single weekend toggle. A reserved row avoids writing the same window onto every
per-trigger row and keeps the existing per-channel rows untouched. `"__global__"`
never collides with a real `notificationTriggers.eventType`, so it is invisible to
the per-trigger UI list and to the daily-digest lookup.

**How to apply:**
- Suppression is applied to EMAIL delivery only (the external "ping"), inside
  `sendEmailNotifications`. In-app notifications are still created so no record is
  lost when the user returns. Clients (role === "client") are never gated — they
  have no global row and must get transactional mail.
- Times are interpreted in `PRACTICE_TZ` ("America/New_York") via `toZonedTime`, so
  the window matches the therapist's local clock. Quiet windows may wrap midnight
  (22:00→08:00) — see `isWithinQuietWindow`.
- Quiet hours are "on" only when BOTH start and end are non-null. Toggling off sends
  `{quietHoursStart: null, quietHoursEnd: null}`. Stored as 'HH:MM:SS'; the time
  input uses 'HH:MM' (convert on save/load).
- The daily 8 AM schedule digest is intentionally NOT gated by quiet hours/weekends.

## Defer-to-summary (catch-up) option

A per-user `quietHoursDeferToSummary` boolean (also on the `"__global__"` row) chooses
what happens to an email the global gate suppresses:
- OFF (default): the email is DROPPED (only the in-app record survives).
- ON: instead of dropping, `sendEmailNotifications` renders subject/body and ENQUEUES a
  row in `deferredNotificationEmails` (status pending). A scheduler interval
  (`runDeferredSummaryEmailsIfDue` → `processDeferredSummaryEmails`) sends ONE
  consolidated catch-up email per user once that user is no longer muted, then marks
  rows 'sent'.

**Why:** suppression should not silently lose the external ping for users who want it;
the consolidation avoids a flood of pings the moment quiet hours end.

**How to apply:**
- Subject/body must be rendered BEFORE the suppression check so the enqueued row carries
  final content (no template re-render at flush time).
- The flush job re-checks the SAME global gate per user (`isDeliverySuppressedByQuietHours`)
  and skips anyone still muted — it processes all users with pending rows, so a per-user
  send-count, not a global count, is the reliable assertion in tests.
- At-most-once / idempotency: rows are CLAIMED (pending→processing) before send; a crash
  after the provider accepts leaves rows 'processing' and they are NEVER auto-re-sent.
  Provider rejection releases rows back to pending (or 'failed' at the attempts cap,
  `DEFERRED_SUMMARY_EMAIL_MAX_ATTEMPTS=3`).
- DDL applied additively via executeSql (db:push blocked by practice_configuration drift).
